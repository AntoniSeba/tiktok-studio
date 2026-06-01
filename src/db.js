// db.js — SQLite schema + typed helpers for TikTok Studio.
// Single source of truth for all persistent state (videos, stats, schedule,
// render queue, settings). Uses better-sqlite3 (synchronous, fast, zero-config).
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || resolve(__dirname, '../data/studio.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cat         TEXT DEFAULT 'value',         -- value | trick
  title       TEXT DEFAULT '',
  path        TEXT DEFAULT '',              -- absolute path to rendered mp4
  pin         TEXT DEFAULT '',              -- pinned comment
  hook        TEXT DEFAULT '',
  wizual      TEXT DEFAULT '',
  glos        TEXT DEFAULT '',
  tempo       TEXT DEFAULT '',
  temat       TEXT DEFAULT '',
  cta         TEXT DEFAULT '',
  batch       TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stats (
  video_id    TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  posted      INTEGER DEFAULT 0,
  publish_date TEXT DEFAULT '',
  views       INTEGER DEFAULT 0,
  avg_watch   REAL DEFAULT 0,               -- seconds
  completion  REAL DEFAULT 0,               -- percent
  likes       INTEGER DEFAULT 0,
  saves       INTEGER DEFAULT 0,
  shares      INTEGER DEFAULT 0,
  comments    INTEGER DEFAULT 0,
  followers   INTEGER DEFAULT 0,            -- new follows from this video
  notes       TEXT DEFAULT '',
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedule (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT REFERENCES videos(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,               -- ISO datetime of intended publish
  platform    TEXT DEFAULT 'tiktok',
  caption     TEXT DEFAULT '',
  status      TEXT DEFAULT 'planned',       -- planned | posted | skipped
  reminded    INTEGER DEFAULT 0,            -- email reminder already sent?
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic       TEXT NOT NULL,
  hook        TEXT DEFAULT '',
  angle       TEXT DEFAULT '',
  status      TEXT DEFAULT 'idea',          -- idea | script | render | qa | done
  priority    INTEGER DEFAULT 2,            -- 1 high, 2 med, 3 low
  notes       TEXT DEFAULT '',
  video_id    TEXT REFERENCES videos(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT DEFAULT ''
);
`);

// ---- settings helpers -------------------------------------------------------
const _getSetting = db.prepare('SELECT value FROM settings WHERE key=?');
const _setSetting = db.prepare(
  'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
);
export const getSetting = (k, fallback = '') => _getSetting.get(k)?.value ?? fallback;
export const setSetting = (k, v) => _setSetting.run(k, String(v));

// seed sensible defaults once
const DEFAULTS = {
  mail_to: process.env.MAIL_TO || 'softsynerg@gmail.com',
  digest_hour: '8',          // local hour for the daily digest
  weekly_day: '1',           // 1 = Monday for the weekly performance report
  digest_enabled: '1',
  reminders_enabled: '1',
  cadence_per_day: '2'       // target posts/day, surfaced on the dashboard
};
for (const [k, v] of Object.entries(DEFAULTS)) {
  if (_getSetting.get(k) === undefined) _setSetting.run(k, v);
}

// ---- video + stats helpers --------------------------------------------------
export const upsertVideo = db.prepare(`
  INSERT INTO videos(id,name,cat,title,path,pin,hook,wizual,glos,tempo,temat,cta,batch)
  VALUES(@id,@name,@cat,@title,@path,@pin,@hook,@wizual,@glos,@tempo,@temat,@cta,@batch)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, cat=excluded.cat, title=excluded.title, path=excluded.path,
    pin=excluded.pin, hook=excluded.hook, wizual=excluded.wizual, glos=excluded.glos,
    tempo=excluded.tempo, temat=excluded.temat, cta=excluded.cta, batch=excluded.batch
`);

export const ensureStats = db.prepare(
  'INSERT INTO stats(video_id) VALUES(?) ON CONFLICT(video_id) DO NOTHING'
);

export function listVideos() {
  return db.prepare(`
    SELECT v.*,
           COALESCE(s.posted,0) posted, COALESCE(s.publish_date,'') publish_date,
           COALESCE(s.views,0) views, COALESCE(s.avg_watch,0) avg_watch,
           COALESCE(s.completion,0) completion, COALESCE(s.likes,0) likes,
           COALESCE(s.saves,0) saves, COALESCE(s.shares,0) shares,
           COALESCE(s.comments,0) comments, COALESCE(s.followers,0) followers,
           COALESCE(s.notes,'') notes
    FROM videos v LEFT JOIN stats s ON s.video_id = v.id
    ORDER BY v.created_at ASC, v.rowid ASC
  `).all();
}

export default db;
