// scheduler.js — cron jobs that make the system "alive" 24/7.
//  * daily digest  : what to post today, which renders are ready, yesterday's numbers
//  * due reminders : hourly check for schedule rows whose time has passed (email once)
//  * weekly report : Monday performance summary with winning factors
import cron from 'node-cron';
import { db, listVideos, getSetting } from './db.js';
import { sendMail, emailShell } from './mailer.js';
import { analyze } from './analysis.js';

const TZ = process.env.TZ || 'Europe/Warsaw';
const li = (s) => `<div style="padding:8px 0;border-bottom:1px solid #20242e">${s}</div>`;

// ---------- digest content builders -----------------------------------------
export function buildDailyDigest() {
  const today = new Date().toISOString().slice(0, 10);
  const due = db.prepare(`
    SELECT sc.*, v.title FROM schedule sc JOIN videos v ON v.id = sc.video_id
    WHERE sc.status='planned' AND substr(sc.scheduled_at,1,10) <= ?
    ORDER BY sc.scheduled_at ASC`).all(today);

  const all = listVideos();
  const ready = all.filter(v => !v.posted && v.path);
  const cadence = Number(getSetting('cadence_per_day', '2'));

  const body = `
    <p style="color:#9aa3b2;font-size:15px;margin:0 0 16px">Plan na dziś (${today}). Cel: ${cadence} publikacje/dzień.</p>
    <h2 style="font-size:16px;color:#7c5cff;text-transform:uppercase;letter-spacing:1px">📅 Do opublikowania (${due.length})</h2>
    ${due.length ? due.map(d => li(`<b>${esc(d.title)}</b> <span style="color:#9aa3b2">— ${d.scheduled_at.replace('T', ' ')}</span>`)).join('')
                 : '<p style="color:#6b7280">Nic zaplanowane na dziś. Dodaj wpisy w Kalendarzu.</p>'}
    <h2 style="font-size:16px;color:#19d36b;text-transform:uppercase;letter-spacing:1px;margin-top:22px">🎬 Gotowe, nie wstawione (${ready.length})</h2>
    ${ready.slice(0, 12).map(v => li(`${esc(v.title || v.name)}`)).join('') || '<p style="color:#6b7280">Brak — czas wyprodukować nowe (zob. Kolejka renderów).</p>'}
  `;
  return { subject: `📅 TikTok plan na ${today} — ${due.length} do wstawienia, ${ready.length} gotowych`, html: emailShell('Twój plan na dziś', body) };
}

export function buildWeeklyReport() {
  const a = analyze();
  if (!a.sampleSize) {
    return { subject: '📊 Raport tygodniowy — brak danych', html: emailShell('Raport tygodniowy', '<p style="color:#9aa3b2">Za mało opublikowanych filmów z wynikami, żeby liczyć zwycięzców. Uzupełnij statystyki.</p>') };
  }
  const recs = a.recommendations.map(r =>
    li(`<b style="color:#7c5cff">${r.factor.toUpperCase()}</b> → <b>${esc(r.winner)}</b><br><span style="color:#9aa3b2;font-size:13px">${esc(r.detail)}</span>`)).join('');
  const top = a.top.map((t, i) =>
    li(`<b>#${i + 1}</b> ${esc(t.title)} <span style="color:#9aa3b2">— ${t.views} wyśw · ${t.completion}% · score ${t.score}</span>`)).join('');
  const body = `
    <p style="color:#9aa3b2;margin:0 0 16px">Na podstawie ${a.sampleSize} opublikowanych filmów.</p>
    <h2 style="font-size:16px;color:#19d36b;text-transform:uppercase;letter-spacing:1px">🏆 Co wygrywa — rób tego więcej</h2>
    ${recs || '<p style="color:#6b7280">Potrzeba ≥2 filmów na wariant, żeby wyłonić zwycięzcę.</p>'}
    <h2 style="font-size:16px;color:#7c5cff;text-transform:uppercase;letter-spacing:1px;margin-top:22px">🔝 Top 5 filmów</h2>
    ${top}`;
  return { subject: `📊 Raport tygodniowy — TOP czynniki (${a.sampleSize} filmów)`, html: emailShell('Raport tygodniowy', body) };
}

// ---------- jobs -------------------------------------------------------------
async function runDailyDigest() {
  if (getSetting('digest_enabled', '1') !== '1') return;
  const { subject, html } = buildDailyDigest();
  await sendMail({ subject, html });
}

async function runDueReminders() {
  if (getSetting('reminders_enabled', '1') !== '1') return;
  const now = new Date().toISOString();
  const due = db.prepare(`
    SELECT sc.*, v.title FROM schedule sc JOIN videos v ON v.id = sc.video_id
    WHERE sc.status='planned' AND sc.reminded=0 AND sc.scheduled_at <= ?`).all(now);
  if (!due.length) return;
  const body = due.map(d => li(`<b>${esc(d.title)}</b> — zaplanowane na ${d.scheduled_at.replace('T', ' ')}<br>
    <span style="color:#9aa3b2;font-size:13px">${esc(d.caption || '')}</span>`)).join('');
  const r = await sendMail({ subject: `⏰ Czas wstawić ${due.length} TikTok(i)`, html: emailShell('Pora publikować', body) });
  if (r.ok) {
    const mark = db.prepare('UPDATE schedule SET reminded=1 WHERE id=?');
    for (const d of due) mark.run(d.id);
  }
}

async function runWeeklyReport() {
  if (getSetting('digest_enabled', '1') !== '1') return;
  const { subject, html } = buildWeeklyReport();
  await sendMail({ subject, html });
}

export function startScheduler() {
  const hour = Number(getSetting('digest_hour', '8'));
  const weeklyDay = Number(getSetting('weekly_day', '1'));
  // daily digest at configured hour
  cron.schedule(`0 ${hour} * * *`, runDailyDigest, { timezone: TZ });
  // due reminders every hour on the hour
  cron.schedule('0 * * * *', runDueReminders, { timezone: TZ });
  // weekly report
  cron.schedule(`0 ${hour} * * ${weeklyDay}`, runWeeklyReport, { timezone: TZ });
  console.log(`[scheduler] daily digest @${hour}:00, hourly reminders, weekly report on day ${weeklyDay} (${TZ})`);
}

function esc(s = '') { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
