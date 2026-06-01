/* TikTok Studio SPA — vanilla JS, talks to the Express API. */
const $ = (s, r = document) => r.querySelector(s);
const api = {
  async get(p) { return (await fetch(p)).json(); },
  async send(p, m, b) { return (await fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json(); },
  post(p, b) { return this.send(p, 'POST', b); },
  put(p, b) { return this.send(p, 'PUT', b); },
  del(p) { return this.send(p, 'DELETE'); }
};
const esc = (s = '') => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Number(n) || 0).toLocaleString('pl-PL');
const num = (v) => { const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n; };

let STATE = { videos: [], schedule: [], queue: [], settings: {}, analysis: null, mailerReady: false };
let VIEW = 'dashboard';

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  setTimeout(() => t.className = 'toast', 2200);
}

async function loadAll() {
  const [v, s, q, set, a] = await Promise.all([
    api.get('/api/videos'), api.get('/api/schedule'), api.get('/api/queue'),
    api.get('/api/settings'), api.get('/api/analysis')
  ]);
  STATE.videos = v.videos || [];
  STATE.schedule = s.schedule || [];
  STATE.queue = q.queue || [];
  STATE.settings = set.settings || {};
  STATE.mailerReady = set.mailerReady;
  STATE.analysis = a.analysis;
}

/* ---------------- health ---------------- */
async function health() {
  try {
    const h = await api.get('/api/health');
    $('#health-dot').className = 'dot' + (h.mailer === 'configured' ? '' : ' dry');
    $('#health-txt').textContent = h.mailer === 'configured' ? 'Brevo: aktywny' : 'Brevo: tryb dry';
  } catch { $('#health-txt').textContent = 'serwer offline'; $('#health-dot').className = 'dot dry'; }
}

/* ================= VIEWS ================= */
const views = {};

/* ---- Dashboard ---- */
views.dashboard = () => {
  const v = STATE.videos;
  const posted = v.filter(x => x.posted);
  const ready = v.filter(x => !x.posted && x.path);
  const totalViews = posted.reduce((a, b) => a + Number(b.views || 0), 0);
  const avgComp = posted.length ? (posted.reduce((a, b) => a + Number(b.completion || 0), 0) / posted.length).toFixed(1) : 0;
  const upcoming = STATE.schedule.filter(s => s.status === 'planned').slice(0, 6);
  const bestId = STATE.analysis?.top?.[0]?.id;
  const best = v.find(x => x.id === bestId);

  return `
  <div class="page-head"><div><h1>Pulpit</h1><p>Pełny obraz Twojej maszyny do TikToków.</p></div>
    <div class="actions">
      <button class="btn" onclick="mailDigest()">✉️ Wyślij digest teraz</button>
      <button class="btn primary" onclick="openVideoModal()">＋ Nowy film</button>
    </div></div>
  <div class="stats">
    <div class="stat" style="--glow:rgba(124,92,255,.25)"><div class="v">${v.length}</div><div class="l">Filmów w bazie</div><div class="sub">${STATE.queue.length} w kolejce produkcji</div></div>
    <div class="stat" style="--glow:rgba(25,211,107,.22)"><div class="v">${posted.length}</div><div class="l">Opublikowanych</div><div class="sub">${ready.length} gotowych, czeka</div></div>
    <div class="stat" style="--glow:rgba(58,160,255,.22)"><div class="v">${fmt(totalViews)}</div><div class="l">Suma wyświetleń</div><div class="sub">średnio ${posted.length ? fmt(Math.round(totalViews / posted.length)) : 0}/film</div></div>
    <div class="stat" style="--glow:rgba(255,179,0,.22)"><div class="v">${avgComp}%</div><div class="l">Śr. oglądalność do końca</div><div class="sub">${upcoming.length} zaplanowanych publikacji</div></div>
  </div>
  <div class="split">
    <div class="panel"><h2>📅 Najbliższe publikacje</h2>
      ${upcoming.length ? upcoming.map(s => `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">
        <div><b>${esc(s.title || s.name || '—')}</b><div class="muted" style="font-size:12px">${esc(s.caption || '')}</div></div>
        <div class="muted" style="white-space:nowrap;font-size:12.5px">${s.scheduled_at.replace('T', ' ')}</div></div>`).join('')
        : '<div class="empty">Brak zaplanowanych. Wejdź w Kalendarz, by zaplanować.</div>'}
      <div style="margin-top:14px"><button class="btn sm" onclick="go('calendar')">Otwórz kalendarz →</button></div>
    </div>
    <div class="panel"><h2>🏆 Lider wyników</h2>
      ${best ? `<div class="vtitle" style="font-size:17px">${esc(best.title)}</div>
        <div class="factors">
          <span class="chip"><b>Hook:</b> ${esc(best.hook)}</span>
          <span class="chip"><b>Wizual:</b> ${esc(best.wizual)}</span>
        </div>
        <div class="metrics"><div class="metric"><div class="mv">${fmt(best.views)}</div><div class="ml">Wyśw.</div></div>
          <div class="metric"><div class="mv">${best.completion}%</div><div class="ml">Do końca</div></div>
          <div class="metric"><div class="mv">${fmt(best.likes)}</div><div class="ml">Lajki</div></div>
          <div class="metric"><div class="mv">${fmt(best.saves)}</div><div class="ml">Zapisy</div></div></div>`
        : '<div class="empty">Dodaj statystyki opublikowanym filmom, by wyłonić lidera.</div>'}
      <div style="margin-top:14px"><button class="btn sm" onclick="go('analysis')">Pełna analiza →</button></div>
    </div>
  </div>`;
};

/* ---- Videos ---- */
views.videos = () => {
  const batches = {};
  for (const v of STATE.videos) (batches[v.batch || 'Inne'] ||= []).push(v);
  const blocks = Object.entries(batches).map(([b, list]) => `
    <h2 style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--mut);margin:20px 2px 12px">${esc(b)} · ${list.length}</h2>
    <div class="grid">${list.map(videoCard).join('')}</div>`).join('');
  return `
  <div class="page-head"><div><h1>Filmy</h1><p>${STATE.videos.length} filmów · klikaj, by wpisać wyniki i planować.</p></div>
    <div class="actions"><button class="btn primary" onclick="openVideoModal()">＋ Nowy film</button></div></div>
  ${STATE.videos.length ? blocks : '<div class="empty">Brak filmów. Dodaj pierwszy.</div>'}`;
};

function videoCard(v) {
  const st = v.posted ? '<span class="badge posted">opublikowany</span>' : (v.path ? '<span class="badge ready">gotowy</span>' : '');
  return `<div class="card">
    <div class="top"><div><div class="vname">${esc(v.name)}</div><div class="vtitle">${esc(v.title || '—')}</div></div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <span class="badge ${v.cat === 'trick' ? 'trick' : 'value'}">${v.cat}</span>${st}</div></div>
    ${v.pin ? `<div class="pin">📌 ${esc(v.pin)}</div>` : ''}
    <div class="factors">
      ${v.hook ? `<span class="chip"><b>H:</b> ${esc(short(v.hook))}</span>` : ''}
      ${v.wizual ? `<span class="chip"><b>W:</b> ${esc(short(v.wizual))}</span>` : ''}
      ${v.glos ? `<span class="chip"><b>G:</b> ${esc(short(v.glos))}</span>` : ''}
      ${v.tempo ? `<span class="chip"><b>T:</b> ${esc(short(v.tempo))}</span>` : ''}
    </div>
    <div class="metrics">
      <div class="metric"><div class="mv">${fmt(v.views)}</div><div class="ml">Wyśw.</div></div>
      <div class="metric"><div class="mv">${v.completion || 0}%</div><div class="ml">Do końca</div></div>
      <div class="metric"><div class="mv">${fmt(v.likes)}</div><div class="ml">Lajki</div></div>
      <div class="metric"><div class="mv">${fmt(v.saves)}</div><div class="ml">Zapisy</div></div>
    </div>
    <div class="editbtns">
      <button class="btn sm" onclick="openStatsModal('${v.id}')">📈 Wyniki</button>
      <button class="btn sm" onclick="openScheduleModal('${v.id}')">📅 Zaplanuj</button>
      <button class="btn sm" onclick="copyText(\`${esc(v.pin)}\`)">📋 Pin</button>
      <button class="btn sm danger" onclick="delVideo('${v.id}')">🗑</button>
    </div></div>`;
}
const short = (s, n = 26) => s.length > n ? s.slice(0, n - 1) + '…' : s;

/* ---- Calendar ---- */
let calMonth = new Date();
views.calendar = () => {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1), start = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const byDay = {};
  for (const s of STATE.schedule) { const d = s.scheduled_at.slice(0, 10); (byDay[d] ||= []).push(s); }
  const dows = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
  let cells = dows.map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < start; i++) cells += `<div class="cell out"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const evs = (byDay[ds] || []).map(s => `<div class="ev ${s.status === 'posted' ? 'posted' : ''}" onclick="openScheduleEdit(${s.id})">${esc(short(s.title || s.name || '—', 18))}<br><span style="opacity:.7">${s.scheduled_at.slice(11, 16)}</span></div>`).join('');
    cells += `<div class="cell ${ds === todayStr ? 'today' : ''}"><div class="dn">${d}</div>${evs}</div>`;
  }
  const mname = calMonth.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  return `
  <div class="page-head"><div><h1>Kalendarz publikacji</h1><p>Plan wrzutek. Cel: ${esc(STATE.settings.cadence_per_day || '2')}/dzień. Przypomnienia mailowe lecą automatycznie.</p></div>
    <div class="actions">
      <button class="btn" onclick="calNav(-1)">←</button>
      <button class="btn">${esc(mname)}</button>
      <button class="btn" onclick="calNav(1)">→</button>
      <button class="btn primary" onclick="openScheduleModal()">＋ Zaplanuj</button>
    </div></div>
  <div class="panel"><div class="cal">${cells}</div></div>`;
};
window.calNav = (d) => { calMonth.setMonth(calMonth.getMonth() + d); paint(); };

/* ---- Queue (kanban) ---- */
const QCOLS = [['idea', 'Pomysł'], ['script', 'Skrypt'], ['render', 'Render'], ['qa', 'QA'], ['done', 'Gotowe']];
views.queue = () => {
  const cols = QCOLS.map(([k, label]) => {
    const items = STATE.queue.filter(q => q.status === k);
    return `<div class="col"><h3>${label}<span class="cnt">${items.length}</span></h3>
      ${items.map(qcard).join('')}</div>`;
  }).join('');
  return `
  <div class="page-head"><div><h1>Kolejka renderów</h1><p>Od pomysłu do gotowego MP4. Przesuwaj statusy przyciskami ◀ ▶.</p></div>
    <div class="actions"><button class="btn primary" onclick="openQueueModal()">＋ Nowy temat</button></div></div>
  <div class="kanban">${cols}</div>`;
};
function qcard(q) {
  const idx = QCOLS.findIndex(c => c[0] === q.status);
  return `<div class="qcard">
    <div class="qt">${esc(q.topic)}</div>
    ${q.hook ? `<div class="qh">🪝 ${esc(q.hook)}</div>` : ''}
    <div class="qmeta">
      <span class="prio p${q.priority}"></span>
      <span style="display:flex;gap:5px">
        ${idx > 0 ? `<button class="btn sm" onclick="qMove(${q.id},'${QCOLS[idx - 1][0]}')">◀</button>` : ''}
        ${idx < QCOLS.length - 1 ? `<button class="btn sm" onclick="qMove(${q.id},'${QCOLS[idx + 1][0]}')">▶</button>` : ''}
        <button class="btn sm danger" onclick="qDel(${q.id})">🗑</button>
      </span></div></div>`;
}

/* ---- Analysis ---- */
views.analysis = () => {
  const a = STATE.analysis;
  if (!a || !a.sampleSize) return `<div class="page-head"><h1>Analiza</h1></div>
    <div class="panel"><div class="empty">Za mało danych. Opublikuj filmy i wpisz wyniki (Wyświetlenia + % do końca), a tu pojawią się zwycięskie hooki, wizualizacje i głosy.</div></div>`;
  const FNAMES = { hook: 'Hook', wizual: 'System wizualny', glos: 'Głos', tempo: 'Tempo', temat: 'Temat', cta: 'CTA', cat: 'Kategoria' };
  const block = (f) => {
    const rows = a.perFactor[f] || [];
    const max = Math.max(...rows.map(r => r.score), 1);
    return `<div class="factorblock"><h3>${FNAMES[f] || f}</h3>
      ${rows.map(r => `<div class="bar"><div class="track"><div class="fill" style="--w:${Math.round(r.score / max * 100)}%"></div>
        <div class="lbl">${esc(short(r.value, 34))} <span class="n">n=${r.n} · ${fmt(r.avgViews)} wyśw · ${r.avgCompletion}%</span></div></div>
        <div class="sc">${r.score}</div></div>`).join('')}</div>`;
  };
  return `
  <div class="page-head"><div><h1>Analiza zwycięzców</h1><p>Na bazie ${a.sampleSize} opublikowanych filmów. Score = retencja×6 + zaangażowanie×4 + zasięg.</p></div>
    <div class="actions"><button class="btn" onclick="mailWeekly()">✉️ Wyślij raport</button></div></div>
  <div class="split">
    <div class="panel"><h2>🎯 Rekomendacje — rób tego więcej</h2>
      ${a.recommendations.length ? a.recommendations.map(r => `<div class="rec"><div class="k">${esc(r.factor)}</div>
        <div><b>${esc(r.winner)}</b><div class="muted" style="font-size:12px">${esc(r.detail)}</div></div></div>`).join('')
        : '<div class="empty">Potrzeba ≥2 filmów na wariant, by wskazać zwycięzcę.</div>'}
    </div>
    <div class="panel"><h2>🔝 Ranking filmów</h2>
      <table><thead><tr><th>#</th><th>Film</th><th>Wyśw.</th><th>%</th><th>Score</th></tr></thead><tbody>
      ${a.top.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(short(t.title, 30))}</td><td>${fmt(t.views)}</td><td>${t.completion}%</td><td><b>${t.score}</b></td></tr>`).join('')}
      </tbody></table></div>
  </div>
  <div class="panel"><h2>📊 Czynniki wg skuteczności</h2>
    <div class="split">${['hook', 'wizual', 'glos'].map(block).join('')}</div>
    <div class="split">${['tempo', 'cta', 'temat'].map(block).join('')}</div>
  </div>`;
};

/* ---- Settings ---- */
views.settings = () => {
  const s = STATE.settings;
  return `
  <div class="page-head"><div><h1>Ustawienia</h1><p>Maile, harmonogram digestów i cele publikacji.</p></div></div>
  <div class="split">
    <div class="panel"><h2>✉️ Powiadomienia mailowe</h2>
      <div class="field"><label>Adres odbiorcy</label><input id="set-mail_to" value="${esc(s.mail_to || '')}"></div>
      <div class="row2">
        <div class="field"><label>Godzina dziennego digestu</label><input id="set-digest_hour" type="number" min="0" max="23" value="${esc(s.digest_hour || '8')}"></div>
        <div class="field"><label>Dzień raportu tyg. (1=Pon)</label><input id="set-weekly_day" type="number" min="0" max="6" value="${esc(s.weekly_day || '1')}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Dzienny digest</label><select id="set-digest_enabled"><option value="1" ${s.digest_enabled === '1' ? 'selected' : ''}>Włączony</option><option value="0" ${s.digest_enabled !== '1' ? 'selected' : ''}>Wyłączony</option></select></div>
        <div class="field"><label>Przypomnienia o publikacji</label><select id="set-reminders_enabled"><option value="1" ${s.reminders_enabled === '1' ? 'selected' : ''}>Włączone</option><option value="0" ${s.reminders_enabled !== '1' ? 'selected' : ''}>Wyłączone</option></select></div>
      </div>
      <div class="field"><label>Cel publikacji / dzień</label><input id="set-cadence_per_day" type="number" min="1" max="10" value="${esc(s.cadence_per_day || '2')}"></div>
      <button class="btn primary" onclick="saveSettings()">💾 Zapisz ustawienia</button>
    </div>
    <div class="panel"><h2>🔌 Status integracji</h2>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="rec" style="background:${STATE.mailerReady ? 'rgba(25,211,107,.07)' : 'rgba(255,179,0,.07)'};border-color:${STATE.mailerReady ? 'rgba(25,211,107,.22)' : 'rgba(255,179,0,.25)'}">
          <div class="k" style="color:${STATE.mailerReady ? 'var(--green)' : 'var(--amber)'}">Brevo</div>
          <div>${STATE.mailerReady ? 'Skonfigurowany — maile wychodzą.' : 'Tryb DRY. Wklej BREVO_SMTP_USER i BREVO_SMTP_KEY do pliku .env na serwerze i zrestartuj.'}</div>
        </div>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <button class="btn" onclick="mailTest()">✉️ Wyślij testowy mail</button>
          <button class="btn" onclick="mailDigest()">📅 Digest teraz</button>
          <button class="btn" onclick="mailWeekly()">📊 Raport teraz</button>
        </div>
        <div class="muted" style="font-size:12.5px;line-height:1.5">Scheduler chodzi w procesie serwera (node-cron). Dopóki backend działa na VPS (PM2), digesty i przypomnienia wychodzą same — nawet przy zamkniętej przeglądarce.</div>
      </div>
    </div>
  </div>`;
};

/* ================= MODALS ================= */
const overlay = $('#overlay'), modal = $('#modal');
function showModal(html) { modal.innerHTML = html; overlay.classList.add('show'); }
window.closeModal = () => overlay.classList.remove('show');
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

window.openVideoModal = () => showModal(`
  <h2>Nowy film</h2>
  <div class="row2"><div class="field"><label>ID (slug)</label><input id="m-id" placeholder="np. free-money-hook2"></div>
    <div class="field"><label>Nazwa</label><input id="m-name" placeholder="free-money-hook2"></div></div>
  <div class="field"><label>Tytuł / opis publikacji</label><input id="m-title" placeholder="Jeśli jesteś freelancerem…"></div>
  <div class="row2"><div class="field"><label>Kategoria</label><select id="m-cat"><option value="value">value</option><option value="trick">trick</option></select></div>
    <div class="field"><label>Pinned comment</label><input id="m-pin" placeholder="Którą usługę testujesz? 👇"></div></div>
  <div class="row2"><div class="field"><label>Hook</label><input id="m-hook"></div><div class="field"><label>Wizual</label><input id="m-wizual"></div></div>
  <div class="row2"><div class="field"><label>Głos</label><input id="m-glos"></div><div class="field"><label>Tempo</label><input id="m-tempo"></div></div>
  <div class="row2"><div class="field"><label>Temat</label><input id="m-temat"></div><div class="field"><label>CTA</label><input id="m-cta"></div></div>
  <div class="field"><label>Ścieżka MP4</label><input id="m-path" placeholder="/…/ALL-RENDERS/…mp4"></div>
  <div class="foot"><button class="btn ghost" onclick="closeModal()">Anuluj</button><button class="btn primary" onclick="saveVideo()">Dodaj film</button></div>`);

window.saveVideo = async () => {
  const g = id => $('#m-' + id).value.trim();
  const id = g('id') || g('name');
  if (!id) return toast('Podaj ID', true);
  const r = await api.post('/api/videos', { id, name: g('name') || id, cat: g('cat'), title: g('title'), pin: g('pin'),
    hook: g('hook'), wizual: g('wizual'), glos: g('glos'), tempo: g('tempo'), temat: g('temat'), cta: g('cta'), path: g('path'),
    batch: 'Dodane ręcznie' });
  if (r.ok) { toast('Dodano film'); closeModal(); await refresh(); } else toast(r.error || 'Błąd', true);
};

window.openStatsModal = (vid) => {
  const v = STATE.videos.find(x => x.id === vid); if (!v) return;
  showModal(`<h2>Wyniki — ${esc(v.title || v.name)}</h2>
    <div class="row2"><div class="field"><label>Opublikowany?</label><select id="s-posted"><option value="1" ${v.posted ? 'selected' : ''}>Tak</option><option value="0" ${!v.posted ? 'selected' : ''}>Nie</option></select></div>
      <div class="field"><label>Data publikacji</label><input id="s-publish_date" type="date" value="${esc(v.publish_date || '')}"></div></div>
    <div class="row2"><div class="field"><label>Wyświetlenia</label><input id="s-views" value="${v.views || ''}" placeholder="275"></div>
      <div class="field"><label>% do końca</label><input id="s-completion" value="${v.completion || ''}" placeholder="4"></div></div>
    <div class="row2"><div class="field"><label>Śr. czas (s)</label><input id="s-avg_watch" value="${v.avg_watch || ''}" placeholder="6.4"></div>
      <div class="field"><label>Lajki</label><input id="s-likes" value="${v.likes || ''}"></div></div>
    <div class="row2"><div class="field"><label>Zapisy</label><input id="s-saves" value="${v.saves || ''}"></div>
      <div class="field"><label>Udostępnienia</label><input id="s-shares" value="${v.shares || ''}"></div></div>
    <div class="row2"><div class="field"><label>Komentarze</label><input id="s-comments" value="${v.comments || ''}"></div>
      <div class="field"><label>Nowi obserwujący</label><input id="s-followers" value="${v.followers || ''}"></div></div>
    <div class="field"><label>Notatki</label><textarea id="s-notes" placeholder="Co zadziałało, co nie…">${esc(v.notes || '')}</textarea></div>
    <div class="foot"><button class="btn ghost" onclick="closeModal()">Anuluj</button><button class="btn primary" onclick="saveStats('${vid}')">💾 Zapisz wyniki</button></div>`);
};
window.saveStats = async (vid) => {
  const g = id => $('#s-' + id).value;
  const body = { posted: Number($('#s-posted').value), publish_date: g('publish_date'),
    views: Math.round(num(g('views'))), completion: num(g('completion')), avg_watch: num(g('avg_watch')),
    likes: Math.round(num(g('likes'))), saves: Math.round(num(g('saves'))), shares: Math.round(num(g('shares'))),
    comments: Math.round(num(g('comments'))), followers: Math.round(num(g('followers'))), notes: g('notes') };
  const r = await api.put('/api/stats/' + vid, body);
  if (r.ok) { toast('Zapisano wyniki'); closeModal(); await refresh(); } else toast('Błąd', true);
};

window.openScheduleModal = (presetVid = '') => {
  const opts = STATE.videos.map(v => `<option value="${v.id}" ${v.id === presetVid ? 'selected' : ''}>${esc(v.title || v.name)}</option>`).join('');
  const now = new Date(); now.setMinutes(0); const iso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  showModal(`<h2>Zaplanuj publikację</h2>
    <div class="field"><label>Film</label><select id="sc-video">${opts}</select></div>
    <div class="row2"><div class="field"><label>Data i godzina</label><input id="sc-when" type="datetime-local" value="${iso}"></div>
      <div class="field"><label>Platforma</label><select id="sc-plat"><option>tiktok</option><option>instagram</option><option>youtube</option></select></div></div>
    <div class="field"><label>Opis / caption</label><textarea id="sc-cap" placeholder="Hook + hashtagi…"></textarea></div>
    <div class="foot"><button class="btn ghost" onclick="closeModal()">Anuluj</button><button class="btn primary" onclick="saveSchedule()">📅 Zaplanuj</button></div>`);
};
window.saveSchedule = async () => {
  const r = await api.post('/api/schedule', { video_id: $('#sc-video').value, scheduled_at: $('#sc-when').value,
    platform: $('#sc-plat').value, caption: $('#sc-cap').value });
  if (r.ok) { toast('Zaplanowano'); closeModal(); await refresh(); } else toast(r.error || 'Błąd', true);
};
window.openScheduleEdit = (id) => {
  const s = STATE.schedule.find(x => x.id === id); if (!s) return;
  showModal(`<h2>${esc(s.title || s.name || 'Publikacja')}</h2>
    <div class="field"><label>Status</label><select id="se-status">
      <option value="planned" ${s.status === 'planned' ? 'selected' : ''}>Zaplanowane</option>
      <option value="posted" ${s.status === 'posted' ? 'selected' : ''}>Opublikowane</option>
      <option value="skipped" ${s.status === 'skipped' ? 'selected' : ''}>Pominięte</option></select></div>
    <div class="field"><label>Data i godzina</label><input id="se-when" type="datetime-local" value="${esc((s.scheduled_at || '').slice(0, 16))}"></div>
    <div class="field"><label>Caption</label><textarea id="se-cap">${esc(s.caption || '')}</textarea></div>
    <div class="foot"><button class="btn danger" onclick="delSchedule(${id})">🗑 Usuń</button>
      <button class="btn ghost" onclick="closeModal()">Anuluj</button>
      <button class="btn primary" onclick="updSchedule(${id})">💾 Zapisz</button></div>`);
};
window.updSchedule = async (id) => {
  const r = await api.put('/api/schedule/' + id, { status: $('#se-status').value, scheduled_at: $('#se-when').value, caption: $('#se-cap').value });
  if (r.ok) { toast('Zaktualizowano'); closeModal(); await refresh(); } else toast('Błąd', true);
};
window.delSchedule = async (id) => { await api.del('/api/schedule/' + id); toast('Usunięto'); closeModal(); await refresh(); };

window.openQueueModal = () => showModal(`<h2>Nowy temat do produkcji</h2>
  <div class="field"><label>Temat</label><input id="q-topic" placeholder="np. Jak wycenić usługę AI"></div>
  <div class="row2"><div class="field"><label>Hook</label><input id="q-hook" placeholder="STOP robić to za darmo"></div>
    <div class="field"><label>Priorytet</label><select id="q-prio"><option value="1">Wysoki</option><option value="2" selected>Średni</option><option value="3">Niski</option></select></div></div>
  <div class="field"><label>Angle / notatki</label><textarea id="q-notes"></textarea></div>
  <div class="foot"><button class="btn ghost" onclick="closeModal()">Anuluj</button><button class="btn primary" onclick="saveQueue()">＋ Dodaj</button></div>`);
window.saveQueue = async () => {
  const r = await api.post('/api/queue', { topic: $('#q-topic').value.trim(), hook: $('#q-hook').value, priority: Number($('#q-prio').value), notes: $('#q-notes').value });
  if (r.ok) { toast('Dodano do kolejki'); closeModal(); await refresh(); } else toast(r.error || 'Błąd', true);
};
window.qMove = async (id, status) => { await api.put('/api/queue/' + id, { status }); await refresh(); };
window.qDel = async (id) => { await api.del('/api/queue/' + id); toast('Usunięto'); await refresh(); };

/* ================= actions ================= */
window.delVideo = async (id) => { if (!confirm('Usunąć film ' + id + '?')) return; await api.del('/api/videos/' + id); toast('Usunięto'); await refresh(); };
window.copyText = (t) => { navigator.clipboard.writeText(t); toast('Skopiowano'); };
window.saveSettings = async () => {
  const keys = ['mail_to', 'digest_hour', 'weekly_day', 'digest_enabled', 'reminders_enabled', 'cadence_per_day'];
  const body = {}; for (const k of keys) body[k] = $('#set-' + k).value;
  await api.put('/api/settings', body); toast('Zapisano ustawienia'); await loadAll();
};
window.mailTest = async () => { const r = await api.post('/api/mail/test'); toast(r.result?.dry ? 'Tryb DRY — skonfiguruj Brevo' : 'Wysłano test ✓', !!r.result?.error); };
window.mailDigest = async () => { const r = await api.post('/api/mail/digest'); toast(r.result?.dry ? 'DRY: digest zalogowany' : 'Digest wysłany ✓'); };
window.mailWeekly = async () => { const r = await api.post('/api/mail/weekly'); toast(r.result?.dry ? 'DRY: raport zalogowany' : 'Raport wysłany ✓'); };

/* ================= router ================= */
function paint() { $('#main').innerHTML = views[VIEW] ? views[VIEW]() : '<div class="empty">—</div>'; }
window.go = (v) => {
  VIEW = v;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  paint();
};
async function refresh() { await loadAll(); paint(); }

$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.view); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

(async function init() {
  await Promise.all([loadAll(), health()]);
  paint();
  setInterval(health, 30000);
})();
