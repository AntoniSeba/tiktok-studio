// seed.js — import the legacy VIDEOS array (data/seed.json, exported from the
// old tracker.html) into the SQLite DB. Idempotent: re-running updates rows.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertVideo, ensureStats } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(__dirname, '../data/seed.json');

const videos = JSON.parse(readFileSync(seedPath, 'utf8'));

// crude batch inference from id prefixes, just for grouping in the UI
function batchOf(v) {
  if (v.id.startsWith('free-money')) return 'BATCH 4 — Freelancer / Darmowa kasa';
  if (v.id.startsWith('codex-')) return 'BATCH 3 — Codex from scratch';
  if (['pensja-hook-pl', 'liczba-szok-pl', 'nie-przewijaj-pl', 'znajdz-blad-pl', 'twarz-szok-pl'].includes(v.id))
    return 'BATCH 2 — Hook experiment';
  return 'BATCH 1 — Baseline';
}

let n = 0;
for (const v of videos) {
  const f = v.factors || {};
  upsertVideo.run({
    id: v.id,
    name: v.name || v.id,
    cat: v.cat || 'value',
    title: v.title || '',
    path: v.path || '',
    pin: v.pin || '',
    hook: f.hook || '',
    wizual: f.wizual || '',
    glos: f.glos || '',
    tempo: f.tempo || '',
    temat: f.temat || '',
    cta: f.cta || '',
    batch: batchOf(v)
  });
  ensureStats.run(v.id);
  n++;
}
console.log(`Seeded ${n} videos into the studio DB.`);
