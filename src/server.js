// server.js — Express API + static dashboard host for TikTok Studio.
import 'dotenv/config';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { db, listVideos, upsertVideo, ensureStats, getSetting, setSetting } from './db.js';
import { analyze } from './analysis.js';
import { sendMail, emailShell, mailerReady } from './mailer.js';
import { startScheduler, buildDailyDigest, buildWeeklyReport } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(resolve(__dirname, '../public')));

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

// ---- health -----------------------------------------------------------------
app.get('/api/health', (_req, res) => ok(res, { mailer: mailerReady ? 'configured' : 'dry', time: new Date().toISOString() }));

// ---- videos + stats ---------------------------------------------------------
app.get('/api/videos', (_req, res) => ok(res, { videos: listVideos() }));

app.post('/api/videos', (req, res) => {
  const v = req.body || {};
  if (!v.id || !v.name) return fail(res, 400, 'id and name required');
  upsertVideo.run({
    id: v.id, name: v.name, cat: v.cat || 'value', title: v.title || '', path: v.path || '',
    pin: v.pin || '', hook: v.hook || '', wizual: v.wizual || '', glos: v.glos || '',
    tempo: v.tempo || '', temat: v.temat || '', cta: v.cta || '', batch: v.batch || ''
  });
  ensureStats.run(v.id);
  ok(res, { id: v.id });
});

app.delete('/api/videos/:id', (req, res) => {
  db.prepare('DELETE FROM videos WHERE id=?').run(req.params.id);
  ok(res, {});
});

// update measured stats for a video
const STAT_FIELDS = ['posted', 'publish_date', 'views', 'avg_watch', 'completion', 'likes', 'saves', 'shares', 'comments', 'followers', 'notes'];
app.put('/api/stats/:id', (req, res) => {
  ensureStats.run(req.params.id);
  const sets = [], vals = [];
  for (const f of STAT_FIELDS) {
    if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  }
  if (!sets.length) return fail(res, 400, 'no fields');
  sets.push("updated_at=datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE stats SET ${sets.join(',')} WHERE video_id=?`).run(...vals);
  ok(res, {});
});

// ---- schedule ---------------------------------------------------------------
app.get('/api/schedule', (_req, res) => {
  const rows = db.prepare(`
    SELECT sc.*, v.title, v.name FROM schedule sc
    LEFT JOIN videos v ON v.id = sc.video_id ORDER BY sc.scheduled_at ASC`).all();
  ok(res, { schedule: rows });
});
app.post('/api/schedule', (req, res) => {
  const { video_id, scheduled_at, platform = 'tiktok', caption = '' } = req.body || {};
  if (!video_id || !scheduled_at) return fail(res, 400, 'video_id and scheduled_at required');
  const r = db.prepare('INSERT INTO schedule(video_id,scheduled_at,platform,caption) VALUES(?,?,?,?)')
    .run(video_id, scheduled_at, platform, caption);
  ok(res, { id: r.lastInsertRowid });
});
app.put('/api/schedule/:id', (req, res) => {
  const allowed = ['scheduled_at', 'platform', 'caption', 'status', 'reminded'];
  const sets = [], vals = [];
  for (const f of allowed) if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  if (!sets.length) return fail(res, 400, 'no fields');
  vals.push(req.params.id);
  db.prepare(`UPDATE schedule SET ${sets.join(',')} WHERE id=?`).run(...vals);
  // posting a schedule row also flips the video's stats.posted
  if (req.body.status === 'posted') {
    const row = db.prepare('SELECT video_id, scheduled_at FROM schedule WHERE id=?').get(req.params.id);
    if (row?.video_id) {
      ensureStats.run(row.video_id);
      db.prepare("UPDATE stats SET posted=1, publish_date=? WHERE video_id=?")
        .run(row.scheduled_at.slice(0, 10), row.video_id);
    }
  }
  ok(res, {});
});
app.delete('/api/schedule/:id', (req, res) => {
  db.prepare('DELETE FROM schedule WHERE id=?').run(req.params.id);
  ok(res, {});
});

// ---- render queue -----------------------------------------------------------
app.get('/api/queue', (_req, res) => ok(res, { queue: db.prepare('SELECT * FROM queue ORDER BY priority ASC, created_at ASC').all() }));
app.post('/api/queue', (req, res) => {
  const { topic, hook = '', angle = '', status = 'idea', priority = 2, notes = '' } = req.body || {};
  if (!topic) return fail(res, 400, 'topic required');
  const r = db.prepare('INSERT INTO queue(topic,hook,angle,status,priority,notes) VALUES(?,?,?,?,?,?)')
    .run(topic, hook, angle, status, priority, notes);
  ok(res, { id: r.lastInsertRowid });
});
app.put('/api/queue/:id', (req, res) => {
  const allowed = ['topic', 'hook', 'angle', 'status', 'priority', 'notes', 'video_id'];
  const sets = [], vals = [];
  for (const f of allowed) if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  if (!sets.length) return fail(res, 400, 'no fields');
  sets.push("updated_at=datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE queue SET ${sets.join(',')} WHERE id=?`).run(...vals);
  ok(res, {});
});
app.delete('/api/queue/:id', (req, res) => {
  db.prepare('DELETE FROM queue WHERE id=?').run(req.params.id);
  ok(res, {});
});

// ---- analysis ---------------------------------------------------------------
app.get('/api/analysis', (_req, res) => ok(res, { analysis: analyze() }));

// ---- settings ---------------------------------------------------------------
app.get('/api/settings', (_req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {}; for (const r of rows) out[r.key] = r.value;
  ok(res, { settings: out, mailerReady });
});
app.put('/api/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) setSetting(k, v);
  ok(res, {});
});

// ---- mail actions -----------------------------------------------------------
app.post('/api/mail/test', async (req, res) => {
  const to = req.body?.to || getSetting('mail_to');
  const r = await sendMail({ to, subject: '✅ TikTok Studio — test', html: emailShell('Test maila', '<p style="color:#9aa3b2">Jeśli to widzisz, Brevo działa i digesty będą wychodzić.</p>') });
  ok(res, { result: r });
});
app.post('/api/mail/digest', async (_req, res) => {
  const { subject, html } = buildDailyDigest();
  const r = await sendMail({ subject, html });
  ok(res, { result: r });
});
app.post('/api/mail/weekly', async (_req, res) => {
  const { subject, html } = buildWeeklyReport();
  const r = await sendMail({ subject, html });
  ok(res, { result: r });
});

// ---- boot -------------------------------------------------------------------
// auto-seed on first run if DB is empty and a seed file exists
if (db.prepare('SELECT COUNT(*) c FROM videos').get().c === 0 &&
    existsSync(resolve(__dirname, '../data/seed.json'))) {
  await import('./seed.js');
}

const PORT = Number(process.env.PORT || 4317);
app.listen(PORT, () => {
  console.log(`\n  TikTok Studio  ▸  http://localhost:${PORT}`);
  console.log(`  mailer: ${mailerReady ? 'Brevo configured ✓' : 'DRY (set BREVO_SMTP_* in .env)'}`);
  startScheduler();
});
