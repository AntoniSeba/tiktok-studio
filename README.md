# 🎬 TikTok Studio — Soft Synergy

Pełen system do prowadzenia maszyny contentowej na TikToka: **tracker filmów, kalendarz publikacji, kolejka renderów (kanban), analiza zwycięskich czynników i automatyczne maile** (dzienny digest + przypomnienia o publikacji + tygodniowy raport).

Zastępuje stary `tracker.html` (czysty `localStorage`) prawdziwym backendem, który **chodzi 24/7 na VPS** i sam wysyła maile — nawet gdy masz zamkniętą przeglądarkę.

> Ciemny, gęsty dashboard z lewym menu: Pulpit · Filmy · Kalendarz · Kolejka renderów · Analiza · Ustawienia.

---

## Co to potrafi

| Moduł | Co robi |
|---|---|
| **📊 Pulpit** | Przegląd: ile filmów, ile opublikowanych, suma wyświetleń, średnia oglądalność, najbliższe publikacje, lider wyników. |
| **🎞️ Filmy** | Karty filmów pogrupowane w batche. Wpisujesz wyniki (wyświetlenia, % do końca, lajki, zapisy, udostępnienia, komentarze, nowi obserwujący), planujesz publikację, kopiujesz pinned comment. |
| **📅 Kalendarz** | Miesięczny widok publikacji. Planujesz datę+godzinę, oznaczasz jako opublikowane/pominięte. Oznaczenie „opublikowane" automatycznie ustawia status filmu. |
| **🗂️ Kolejka renderów** | Kanban: Pomysł → Skrypt → Render → QA → Gotowe. Przesuwasz tematy między etapami. Przycisk **„✨ Generuj filmik"** odpala agenta Claude Code, który sam buduje i renderuje film. |
| **🏆 Analiza** | Liczy, **które hooki / systemy wizualne / głosy / tempa / CTA wygrywają** (score = retencja×6 + zaangażowanie×4 + zasięg) i daje rekomendacje „rób tego więcej". |
| **⚙️ Ustawienia** | Adres maila, godzina digestu, dzień raportu, cel publikacji/dzień, przyciski testowych maili. |

### Automatyzacja (scheduler, `node-cron`)
- **Codzienny digest** o ustawionej godzinie — co opublikować dziś + które rendery gotowe.
- **Przypomnienia** — co godzinę sprawdza zaplanowane publikacje, których czas minął, i wysyła maila (raz na wpis).
- **Tygodniowy raport** — w wybrany dzień podsumowanie zwycięskich czynników.

---

## Architektura

```
┌──────────────┐     fetch/JSON      ┌─────────────────────────────┐
│  public/     │ ──────────────────▶ │  Express API (src/server.js)│
│  SPA (vanilla│ ◀────────────────── │  ├─ better-sqlite3  (db.js) │
│  JS, 0 build)│                     │  ├─ node-cron    (scheduler)│
└──────────────┘                     │  ├─ nodemailer → Brevo SMTP │
                                     │  └─ analiza czynników       │
                                     └─────────────┬───────────────┘
                                                   ▼
                                          data/studio.db (SQLite)
```

- **Zero kroku build** — frontend to czysty HTML/CSS/JS, backend to ES modules. Łatwo deployować i debugować.
- **SQLite** (`better-sqlite3`) — jeden plik `data/studio.db`, zero osobnej bazy do stawiania.
- **Maile przez Brevo** — dopóki nie wkleisz klucza, mailer działa w trybie **DRY** (loguje co by wysłał), więc reszta działa od razu.

---

## Szybki start (lokalnie)

```bash
npm install
cp .env.example .env      # (opcjonalnie) wpisz dane Brevo
npm start                 # http://localhost:4317
```

Przy pierwszym uruchomieniu baza zostaje **automatycznie zaseedowana** z `data/seed.json` (18 filmów wyeksportowanych ze starego trackera).

Inne komendy:
```bash
npm run dev        # auto-restart przy zmianach (node --watch)
npm run seed       # ręczny re-import seed.json
```

---

## Konfiguracja maili (Brevo)

1. Załóż konto na [brevo.com](https://app.brevo.com) → **SMTP & API** → **SMTP**.
2. Skopiuj login (Twój e-mail/identyfikator) i wygenerowany **SMTP key**.
3. Wpisz do `.env`:
   ```env
   BREVO_SMTP_USER=twoj-login@smtp-brevo.com
   BREVO_SMTP_KEY=xxxxxxxxxxxxxxxx
   MAIL_FROM=TikTok Studio <softsynerg@gmail.com>
   MAIL_TO=softsynerg@gmail.com
   ```
4. Restart. W zakładce **Ustawienia** kliknij **„Wyślij testowy mail"**.

> Kropka przy „Brevo" w stopce zmieni się z 🟡 (dry) na 🟢 (aktywny).

---

## Deploy na VPS (24/7)

Maile i scheduler wymagają, by proces **chodził cały czas** — dlatego PM2 na serwerze.

```bash
bash scripts/deploy.sh
```

Skrypt: rsync źródła → `npm install` → `pm2 startOrReload ecosystem.config.js` → `pm2 save`.

Potem na serwerze raz:
```bash
ssh admin@193.180.211.30 'nano /home/admin/tiktok-studio/.env'   # wklej BREVO_*
ssh admin@193.180.211.30 'pm2 restart tiktok-studio'
```

### nginx (subdomena `studio.soft-synergy.com`)
```nginx
server {
  server_name studio.soft-synergy.com;
  location / { proxy_pass http://127.0.0.1:4317; proxy_set_header Host $host; }
}
# potem: certbot --nginx -d studio.soft-synergy.com
```

> ⚠️ Dashboard nie ma jeszcze logowania — za nginx dołóż Basic Auth albo whitelistę IP, jeśli wystawiasz publicznie.

---

## ✨ Generator filmów (headless agent Claude Code)

W **Kolejce renderów** każda karta ma przycisk **„✨ Generuj filmik"**. Kliknięcie odpala
**agenta Claude Code w tle** (`claude --print --output-format stream-json …`), który:

1. buduje nowy wariant w HyperFrames (`ai-sales-funnel-short/`),
2. miksuje narrację+muzykę w jeden `mixbed.mp3` (bo HF normalizuje ścieżki osobno),
3. renderuje MP4 i kopiuje go do `ALL-RENDERS/`,
4. rejestruje gotowy film w Studio (`POST /api/videos`).

Postęp lecisz **na żywo** w panelu „🤖 Generator" — log narzędzi agenta, status (⏳/✅/❌),
koszt w \$, przycisk **stop**. Pozycja w kanbanie sama przeskakuje `pomysł → render → QA`.

```
┌── przeglądarka ──┐  POST /api/generate   ┌── Studio (Express) ──┐  spawn   ┌── claude (headless) ──┐
│ „✨ Generuj"     │ ────────────────────▶ │ src/agent.js          │ ───────▶ │ buduje + renderuje HF │
│ panel + live log │ ◀──  GET /api/jobs ── │ parsuje stream-json   │ ◀─────── │ POST /api/videos      │
└──────────────────┘     (polling 2s)      └───────────────────────┘  stdout  └───────────────────────┘
```

**Wymagania:**
- Działa tam, gdzie jest zainstalowany `claude` CLI — czyli **lokalnie na Macu**, nie na VPS.
  (Na serwerze przycisk jest ukryty, a `/api/generate` zwraca `503` — dashboard tam tylko planuje i wysyła maile.)
- Headless agent potrzebuje **własnego klucza Anthropic** (nie pożyczy zalogowanej sesji człowieka).
  Wklej go do `.env` — tak samo jak Brevo — i zrestartuj:
  ```env
  AGENT_ANTHROPIC_API_KEY=sk-ant-…
  # opcjonalnie: AGENT_MODEL=sonnet · AGENT_MAX_CONCURRENT=1 · AGENT_ENABLED=0 (wyłącz)
  ```
- Kropka **„Agent"** w lewym menu: 🟢 gotowy (jest `claude`) / 🟡 niedostępny.

---

## API (skrót)

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/videos` | lista filmów + statystyki |
| POST/DELETE | `/api/videos[/:id]` | dodaj / usuń film |
| PUT | `/api/stats/:id` | zapisz wyniki filmu |
| GET/POST/PUT/DELETE | `/api/schedule[/:id]` | kalendarz publikacji |
| GET/POST/PUT/DELETE | `/api/queue[/:id]` | kolejka renderów |
| POST | `/api/generate` | odpal agenta generującego film (z `queue_id` lub `topic`) |
| GET | `/api/jobs[/:id]` | status zadań generatora + live log |
| POST | `/api/jobs/:id/cancel` | zatrzymaj agenta |
| GET | `/api/analysis` | zwycięskie czynniki + ranking |
| GET/PUT | `/api/settings` | ustawienia |
| POST | `/api/mail/{test,digest,weekly}` | wyślij maila ręcznie |

---

## Powiązanie z HyperFrames

Filmy renderujesz w `ai-sales-funnel-short/` (HyperFrames), gotowe MP4 lądują w `ALL-RENDERS/`. W `path` filmu wskazujesz ten plik. Kolejka renderów odwzorowuje pipeline: pomysł → skrypt → render → QA → gotowe.

## Stack
Node 20+ · Express · better-sqlite3 · node-cron · nodemailer (Brevo) · waniliowy frontend. Licencja MIT.
