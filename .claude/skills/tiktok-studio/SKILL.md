---
name: tiktok-studio
description: Operate the TikTok Studio content-ops system — track TikTok videos and their stats, plan publishing on a calendar, manage the render queue, read winning-factor analytics, and send/automate email digests via Brevo. Use when the user asks to add a video, record TikTok results/views, schedule a post, move a render-queue item, see which hooks/visuals/voices are winning, or configure the studio's email digests. Backend is an Express + SQLite app (default http://localhost:4317, or studio.soft-synergy.com in prod).
---

# TikTok Studio

A full TikTok content-ops backend for Soft Synergy. This skill tells you how to
drive it through its REST API.

## Where it runs
- **Local:** `http://localhost:4317` (start with `npm start` in the repo root).
- **Prod:** `https://studio.soft-synergy.com` (PM2 process `tiktok-studio` on `admin@193.180.211.30`).
- Set `BASE` accordingly before running the curl commands below.

## First, check it's up
```bash
curl -s $BASE/api/health      # {ok, mailer:"configured"|"dry", agent:"ready"|"unavailable", jobsRunning}
```
If it's not running locally: `cd tiktok-studio && npm start` (auto-seeds 18 videos on first boot).

## Data model (SQLite, one file `data/studio.db`)
- **videos** — id, name, cat (value|trick), title, path (mp4), pin, and the six experimental factors: `hook, wizual, glos, tempo, temat, cta`, plus `batch`.
- **stats** — per video: posted, publish_date, views, avg_watch, completion (%), likes, saves, shares, comments, followers, notes.
- **schedule** — video_id, scheduled_at (ISO), platform, caption, status (planned|posted|skipped).
- **queue** — render pipeline: topic, hook, angle, status (idea|script|render|qa|done), priority (1 high…3 low).
- **settings** — mail_to, digest_hour, weekly_day, digest_enabled, reminders_enabled, cadence_per_day.
- **jobs** — generator runs: topic, status (queued|running|done|error|canceled), log (live feed), video_id, cost_usd.

## Common operations

### Add a video
```bash
curl -s -X POST $BASE/api/videos -H 'Content-Type: application/json' -d '{
  "id":"free-money-hook2","name":"free-money-hook2","cat":"value",
  "title":"Jeśli jesteś freelancerem…","pin":"Którą usługę testujesz? 👇",
  "hook":"SZOK-LICZBA","wizual":"cinematic glow","glos":"Eric","tempo":"18s","cta":"Zapisz to"}'
```

### Record TikTok results for a video
```bash
curl -s -X PUT $BASE/api/stats/free-money-500 -H 'Content-Type: application/json' -d '{
  "posted":1,"views":4200,"completion":31,"likes":210,"saves":95,"shares":40,"comments":18}'
```
Only send the fields you're updating. `posted:1` marks it published.

### Schedule a publication (drives email reminders)
```bash
curl -s -X POST $BASE/api/schedule -H 'Content-Type: application/json' -d '{
  "video_id":"free-money-stop","scheduled_at":"2026-06-02T18:00","caption":"STOP 🛑 #freelancer"}'
```
Mark it posted later: `PUT /api/schedule/:id {"status":"posted"}` (also flips the video's `posted`).

### Move a render-queue item
```bash
curl -s -X POST $BASE/api/queue -d '{"topic":"Jak wycenić AI usługę","hook":"STOP za darmo","priority":1}' -H 'Content-Type: application/json'
curl -s -X PUT  $BASE/api/queue/1 -d '{"status":"render"}' -H 'Content-Type: application/json'
```
Status flow: `idea → script → render → qa → done`.

### Generate a video automatically (headless Claude Code agent)
The dashboard's "✨ Generuj filmik" button — and this endpoint — spawn a background
`claude` agent that builds + renders a HyperFrames video and registers it back via
`POST /api/videos`. Kick it off from a queue item or a raw topic:
```bash
curl -s -X POST $BASE/api/generate -H 'Content-Type: application/json' -d '{"queue_id":1}'
# or:  -d '{"topic":"Jak wycenić usługę AI","hook":"STOP za darmo","glos":"Eric"}'
curl -s $BASE/api/jobs            # list jobs (status: queued|running|done|error)
curl -s $BASE/api/jobs/1          # one job: live `log`, video_id, cost_usd
curl -s -X POST $BASE/api/jobs/1/cancel
```
Only works where the `claude` CLI is installed (the Mac, not the VPS). The agent needs
its own key: `AGENT_ANTHROPIC_API_KEY=sk-ant-…` in `.env`. If `agent:"unavailable"` in
`/api/health`, generation is off on that host. Check `agent` + `jobsRunning` in health.

### Read the analytics (what's winning)
```bash
curl -s $BASE/api/analysis | jq '.analysis.recommendations'
```
Returns per-factor ranking + `recommendations` (best value per factor with ≥2 samples) + top/bottom videos. Use this to advise which hook/wizual/glos/tempo/cta to repeat in the next HyperFrames batch.

### Email
```bash
curl -s -X POST $BASE/api/mail/test       # send a test
curl -s -X POST $BASE/api/mail/digest     # send today's plan now
curl -s -X POST $BASE/api/mail/weekly     # send the winning-factors report now
```
Automated cron (when the server runs 24/7): daily digest at `digest_hour`, hourly due-reminders, weekly report on `weekly_day`. If `mailer:"dry"` in health, Brevo isn't configured — tell the user to put `BREVO_SMTP_USER`/`BREVO_SMTP_KEY` in `.env` and restart.

### Change settings
```bash
curl -s -X PUT $BASE/api/settings -H 'Content-Type: application/json' -d '{"digest_hour":"9","cadence_per_day":"3"}'
```

## Tips
- This system pairs with HyperFrames: rendered MP4s live in `ai-sales-funnel-short/ALL-RENDERS/`; put that path in the video's `path`.
- The six factors mirror the experiment design — keep them filled so `/api/analysis` can find winners.
- Don't expose the dashboard publicly without auth (no login built in yet) — use nginx Basic Auth / IP allowlist.
- Per repo memory: never auto-send client emails; these digests go only to the studio owner's `mail_to`.
