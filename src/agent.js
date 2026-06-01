// agent.js — the bridge from the dashboard to a headless Claude Code agent.
//
// When the user clicks "✨ Generuj" on a render-queue item, we spawn
//   claude --print --output-format stream-json … "<prompt>"
// in the monorepo root, let it build + render the HyperFrames video and
// register it back into the Studio via the REST API, and stream its progress
// into the `jobs` table so the dashboard can show a live feed.
//
// This only runs where the `claude` CLI exists (your Mac). On the VPS the
// binary isn't present, so /api/generate just reports "agent unavailable".
import { spawn, execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Monorepo root — the agent needs to see HyperFrames (ai-sales-funnel-short/)
// and ALL-RENDERS/. tiktok-studio lives one level below it.
const REPO_ROOT = process.env.AGENT_REPO_ROOT || resolve(__dirname, '../..');
const AGENT_CMD = process.env.AGENT_CMD || 'claude';
const AGENT_MODEL = process.env.AGENT_MODEL || 'sonnet';
const MAX_CONCURRENT = Number(process.env.AGENT_MAX_CONCURRENT || 1);
const SELF_PORT = Number(process.env.PORT || 4317);

// in-memory handles for running child processes, keyed by job id
const running = new Map();

// Build a clean environment for the spawned `claude`. If the Studio server was
// itself launched from inside a Claude Code session (e.g. during development),
// it inherits session-scoped auth (ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY and
// CLAUDE_CODE_* markers) that only work for THAT session — a fresh child would
// hit 401. Strip them so the child falls back to the host's normal OAuth login
// (keychain). Set AGENT_KEEP_ENV=1 to disable this (e.g. to use your own key).
function cleanEnv() {
  const env = { ...process.env };
  if (process.env.AGENT_KEEP_ENV === '1') return env;
  for (const k of Object.keys(env)) {
    if (/^CLAUDE_CODE_/.test(k) || k === 'CLAUDECODE' || /^CLAUDE_AGENT_SDK/.test(k) ||
        k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_BASE_URL' || k === 'ANTHROPIC_AUTH_TOKEN' ||
        k === 'CLAUDE_CODE_ENTRYPOINT' || k === 'AI_AGENT') {
      delete env[k];
    }
  }
  // explicit per-agent key override, if the operator wants one
  if (process.env.AGENT_ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.AGENT_ANTHROPIC_API_KEY;
  return env;
}

/** Is the headless agent usable on this machine? */
export function agentAvailable() {
  if (process.env.AGENT_ENABLED === '0') return false;
  try { execSync(`command -v ${AGENT_CMD}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

const _insertJob = db.prepare(
  'INSERT INTO jobs(queue_id,topic,hook,prompt,status) VALUES(?,?,?,?,?)'
);
const _appendLog = db.prepare(
  "UPDATE jobs SET log = substr(log || ? , -8000) WHERE id=?"
);
const _setJob = (id, fields) => {
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k}=?`); vals.push(v); }
  vals.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(',')} WHERE id=?`).run(...vals);
};

export const listJobs = (limit = 20) =>
  db.prepare('SELECT id,queue_id,topic,hook,status,video_id,cost_usd,created_at,finished_at,result FROM jobs ORDER BY id DESC LIMIT ?').all(limit);
export const getJob = (id) => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);

function log(id, line) {
  _appendLog.run(line.endsWith('\n') ? line : line + '\n', id);
}

/** Build the task prompt handed to the headless agent. */
function buildPrompt({ topic, hook, angle, cat, glos, notes }) {
  return [
    `Zadanie: wygeneruj NOWY pionowy filmik na TikToka (1080x1920) w systemie HyperFrames i zarejestruj go w TikTok Studio.`,
    ``,
    `Brief:`,
    `- Temat: ${topic}`,
    hook ? `- Hook: ${hook}` : '',
    angle ? `- Angle / kąt: ${angle}` : '',
    cat ? `- Kategoria: ${cat}` : '- Kategoria: value',
    glos ? `- Głos lektora: ${glos}` : '',
    notes ? `- Notatki: ${notes}` : '',
    ``,
    `Kroki:`,
    `1. Pracuj w katalogu ai-sales-funnel-short/. Jako wzór skopiuj strukturę istniejącego, działającego wariantu (np. free-money-stop) do nowego folderu o czytelnym slugu.`,
    `2. Napisz kompozycję index.html zgodnie z konwencją HyperFrames w tym repo (czytaj sąsiednie warianty + CLAUDE.md, nie zgaduj API).`,
    `3. Jeśli wariant ma narrację: wygeneruj TTS i ZMIKSUJ głos+muzykę w JEDEN plik mixbed.mp3`,
    `   (ffmpeg amix: głos volume=1.0, muzyka volume=0.4, normalize=0) — HyperFrames peak-normalizuje każdą ścieżkę osobno, więc rozdzielony głos i muzyka rozjadą się głośnościowo.`,
    `4. Wyrenderuj wariant do pliku MP4.`,
    `5. Skopiuj GOTOWY mp4 do ai-sales-funnel-short/ALL-RENDERS/ z datą w nazwie (format: <slug>_2026-06-01.mp4).`,
    `6. Zarejestruj film w Studio jednym requestem:`,
    `   curl -s -X POST http://localhost:${SELF_PORT}/api/videos -H 'Content-Type: application/json' -d '{"id":"<slug>","name":"<slug>","title":"<tytuł>","cat":"${cat || 'value'}","hook":"${hook || ''}","glos":"${glos || ''}","path":"<absolutna ścieżka do mp4 w ALL-RENDERS>","batch":"Auto-generator"}'`,
    `   Wypełnij też wizual/tempo/cta jeśli je zaprojektowałeś.`,
    ``,
    `Na samym końcu wypisz dokładnie jedną linię: RESULT video_id=<slug> mp4=<ścieżka>`,
    `Nie pytaj o potwierdzenia — działaj autonomicznie do końca.`
  ].filter(Boolean).join('\n');
}

/** Number of jobs currently executing. */
export const runningCount = () => running.size;

/**
 * Start a generation job. Returns { id } immediately; the agent runs async.
 * Throws if the agent isn't available or we're at the concurrency cap.
 */
export function startJob(brief) {
  if (!agentAvailable()) throw new Error('agent niedostępny na tym hoście (brak claude CLI)');
  if (running.size >= MAX_CONCURRENT) throw new Error(`limit równoległych zadań (${MAX_CONCURRENT}) — poczekaj aż bieżące się skończy`);

  const prompt = buildPrompt(brief);
  const info = _insertJob.run(brief.queue_id ?? null, brief.topic || '', brief.hook || '', prompt, 'running');
  const id = info.lastInsertRowid;

  log(id, `▸ Start: "${brief.topic}"  (model: ${AGENT_MODEL})`);

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--model', AGENT_MODEL,
    prompt
  ];
  const child = spawn(AGENT_CMD, args, {
    cwd: REPO_ROOT,
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],   // no stdin → no "waiting on stdin" warning
  });
  running.set(id, child);
  _setJob(id, { pid: child.pid });

  // if this job came from a queue item, mark it as rendering
  if (brief.queue_id) {
    try { db.prepare("UPDATE queue SET status='render', updated_at=datetime('now') WHERE id=?").run(brief.queue_id); } catch {}
  }

  let buf = '';
  let finalText = '';
  let cost = 0;
  let videoId = null;

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      handleEvent(ev);
    }
  });

  function handleEvent(ev) {
    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          log(id, '💬 ' + block.text.trim().slice(0, 400));
          const m = block.text.match(/RESULT\s+video_id=(\S+)/);
          if (m) videoId = m[1];
        } else if (block.type === 'tool_use') {
          log(id, '🔧 ' + toolLine(block));
        }
      }
    } else if (ev.type === 'result') {
      finalText = ev.result || '';
      cost = ev.total_cost_usd || 0;
      const m = (finalText || '').match(/RESULT\s+video_id=(\S+)/);
      if (m) videoId = m[1];
    } else if (ev.type === 'system' && ev.subtype === 'init') {
      log(id, `⚙️  sesja gotowa (${ev.tools?.length || 0} narzędzi)`);
    }
  }

  child.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) log(id, '⚠️ ' + s.slice(0, 300)); });

  child.on('close', (code) => {
    running.delete(id);
    const canceled = getJob(id)?.status === 'canceled';
    const okExit = code === 0 && !canceled;
    _setJob(id, {
      status: canceled ? 'canceled' : (okExit ? 'done' : 'error'),
      result: (finalText || (canceled ? 'anulowano' : `agent zakończył kodem ${code}`)).slice(0, 4000),
      video_id: videoId,
      cost_usd: cost,
      finished_at: new Date().toISOString()
    });
    const authFail = /authenticat|401|invalid api key/i.test(finalText || '') || /authenticat|401/i.test(getJob(id)?.log || '');
    log(id, okExit ? `✅ Gotowe${videoId ? ' — film: ' + videoId : ''}  (koszt ~$${cost.toFixed(2)})`
                   : (canceled ? '🛑 Anulowano' : `❌ Błąd (exit ${code})`));
    if (!okExit && !canceled && authFail) {
      log(id, 'ℹ️ Agent nie ma autoryzacji. Wklej AGENT_ANTHROPIC_API_KEY=sk-ant-… do .env i zrestartuj serwer (analogicznie do Brevo).');
    }
    // advance the source queue item
    if (brief.queue_id && okExit) {
      try { db.prepare("UPDATE queue SET status='qa', video_id=?, updated_at=datetime('now') WHERE id=?").run(videoId, brief.queue_id); } catch {}
    }
  });

  child.on('error', (err) => {
    running.delete(id);
    _setJob(id, { status: 'error', result: String(err).slice(0, 1000), finished_at: new Date().toISOString() });
    log(id, '❌ Nie udało się uruchomić agenta: ' + err.message);
  });

  return { id };
}

function toolLine(block) {
  const n = block.name || 'tool';
  const i = block.input || {};
  if (n === 'Bash') return `Bash: ${(i.command || '').slice(0, 120)}`;
  if (n === 'Write') return `Write: ${i.file_path || ''}`;
  if (n === 'Edit') return `Edit: ${i.file_path || ''}`;
  if (n === 'Read') return `Read: ${i.file_path || ''}`;
  return `${n}: ${JSON.stringify(i).slice(0, 100)}`;
}

export function cancelJob(id) {
  const child = running.get(id);
  if (!child) return false;
  _setJob(id, { status: 'canceled' });
  try { child.kill('SIGTERM'); } catch {}
  return true;
}
