const X = window.QAExport;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };

let R = null; // текущий отчёт
let shots = {}; // n -> dataURL
let mediaBlobs = {}; // key -> Blob
let tab = 'timeline';
let filters = { console: 'all', network: 'all', timeline: 'important' };

// ================= загрузка =================
async function init() {
  const all = (await QADB.all('reports')).sort((a, b) => b.startTime - a.startTime);
  renderList(all);
  const id = new URLSearchParams(location.search).get('id') || (all[0] && all[0].id);
  if (!id) { $('#empty').hidden = false; return; }
  R = await QADB.get('reports', id);
  if (!R) { $('#empty').hidden = false; return; }
  for (const k of ['events', 'samples', 'resources', 'nav', 'actions', 'console', 'network']) R[k] = R[k] || [];
  R.resources.forEach((r, i) => (r.id = r.id || 'res' + i));
  R.errors = R.errors || [];
  for (const a of R.annotations) shots[a.n] = await QADB.get('blobs', a.shotKey);
  for (const x of R.errors) if (x.shotKey) shots['e' + x.n] = await QADB.get('blobs', x.shotKey);
  for (const v of [...R.videos, ...R.voice]) {
    const b = await QADB.get('blobs', v.key);
    if (b) mediaBlobs[v.key] = b;
  }
  if (!R.fields) {
    R.fields = { title: '', severity: 'Значительный', priority: '', steps: autoSteps(), expected: '', actual: '', notes: '' };
    saveR();
  }
  $('#report').hidden = false;
  renderAll();
}

function renderList(all) {
  const cur = new URLSearchParams(location.search).get('id') || (all[0] && all[0].id);
  $('#list').innerHTML = all.length
    ? all
        .map((r) => {
          const t = (r.fields && r.fields.title) || (r.annotations[0] && r.annotations[0].comment) || r.meta.title || 'Без названия';
          const d = new Date(r.startTime).toLocaleString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU'), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          return `<a class="item ${r.id === cur ? 'on' : ''}" href="?id=${r.id}"><b>${esc(short(t, 60))}</b><small>${r.active ? '<span class="live">● идёт · </span>' : ''}${d} · ${r.annotations.length} пом.</small><button class="del" data-id="${r.id}" title="Удалить">×</button></a>`;
        })
        .join('')
    : '<div class="muted" style="padding:0 8px">Пусто</div>';
  $('#list').onclick = async (e) => {
    const b = e.target.closest('.del');
    if (!b) return;
    e.preventDefault();
    if (!confirm('Удалить этот баг-репорт вместе со скриншотами и видео?')) return;
    await QADB.del('reports', b.dataset.id);
    await QADB.delPrefix('blobs', b.dataset.id + '_');
    location.href = 'report.html';
  };
}

let saveT = null;
function saveR() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    // не перетираем данные, пока фиксация ещё идёт в service worker
    if (R.active) {
      const fresh = await QADB.get('reports', R.id);
      if (fresh) {
        fresh.fields = R.fields;
        fresh.aiSummary = R.aiSummary;
        const merge = (arr, mine, keys) => (arr || []).forEach((a) => { const m = (mine || []).find((x) => x.n === a.n); if (m) keys.forEach((k) => (a[k] = m[k])); });
        merge(fresh.annotations, R.annotations, ['comment', 'severity', 'ai']);
        merge(fresh.errors, R.errors, ['severity', 'ai']);
        merge(fresh.videos, R.videos, ['severity', 'ai']);
        await QADB.put('reports', R.id, fresh);
        return;
      }
    }
    await QADB.put('reports', R.id, R);
  }, 400);
}

// ================= шаги =================
function timeline() {
  const ev = [...R.nav.filter((n) => /^(https?|file):/.test(n.url)).map((n) => ({ ...n, kind: 'nav' })), ...R.actions].sort((a, b) => a.ts - b.ts);
  return ev;
}
function autoSteps() {
  const ev = timeline();
  const lines = [];
  let lastUrl = null, last = '';
  const start = ev.find((e) => e.kind === 'nav');
  const firstUrl = (start && start.url) || R.meta.startUrl;
  lines.push(`Открыть ${firstUrl}`);
  lastUrl = firstUrl;
  const seen = R.events.filter((e) => ['dialog', 'invalid', 'appeared'].includes(e.kind) && e.level !== 'info');
  const items = [...ev.map((e) => ({ ts: e.ts, e })), ...R.annotations.map((a) => ({ ts: a.ts, a })), ...seen.map((o) => ({ ts: o.ts, o }))].sort((x, y) => x.ts - y.ts);
  // действия после последнего пункта к воспроизведению не относятся
  const lastItem = Math.max(0, ...R.annotations.map((x) => x.ts), ...(R.errors || []).map((x) => x.ts || 0), ...(R.videos || []).map((x) => x.end || x.start || 0));
  for (const it of items) {
    if (lastItem && it.ts > lastItem + 1000) break;
    let s;
    if (it.a) s = `Наблюдаем: ${it.a.comment || 'см. пометку'} (пометка #${it.a.n})`;
    else if (it.o) s = `Наблюдаем: ${it.o.text}`;
    else if (it.e.kind === 'nav') {
      if (it.e.url === lastUrl) continue;
      lastUrl = it.e.url;
      s = `Перейти на ${it.e.url}`;
    } else s = X.describeAction(it.e);
    if (s === last) continue;
    last = s;
    lines.push(s);
  }
  const keep = lines.length > 30 ? [lines[0], '…', ...lines.slice(-28)] : lines;
  let i = 0;
  return keep.map((l) => (l === '…' ? '…' : `${++i}. ${l}`)).join('\n');
}

// ================= окружение =================
function parseUA(ua) {
  let browser = 'Chrome';
  let m;
  if ((m = ua.match(/Edg\/([\d.]+)/))) browser = 'Microsoft Edge ' + m[1];
  else if ((m = ua.match(/OPR\/([\d.]+)/))) browser = 'Opera ' + m[1];
  else if ((m = ua.match(/YaBrowser\/([\d.]+)/))) browser = 'Яндекс Браузер ' + m[1];
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) browser = 'Chrome ' + m[1];
  let os = 'Неизвестно';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if ((m = ua.match(/Windows NT ([\d.]+)/))) os = 'Windows NT ' + m[1];
  else if ((m = ua.match(/Mac OS X ([\d_]+)/))) os = 'macOS ' + m[1].replace(/_/g, '.');
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if ((m = ua.match(/Android ([\d.]+)/))) os = 'Android ' + m[1];
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
}
function env() {
  const { browser, os } = parseUA(R.meta.userAgent || '');
  const vp = R.meta.viewport;
  const rows = [
    ['Страница', R.meta.startUrl],
    ['Заголовок страницы', R.meta.title || ''],
  ];
  if (R.meta.endUrl && R.meta.endUrl !== R.meta.startUrl) rows.push(['Страница в конце', R.meta.endUrl]);
  rows.push(
    ['Браузер', browser],
    ['ОС', os + (R.meta.platform ? ` (${R.meta.platform})` : '')],
    ['Размер окна', vp ? `${vp.w}×${vp.h}, масштаб ${vp.dpr}x` : '—'],
    ['Язык браузера', R.meta.language || ''],
    ['Начало проверки', new Date(R.startTime).toLocaleString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU'))],
    ['Длительность проверки', X.fmtDur((R.endTime || Date.now()) - R.startTime)],
    ['User-Agent', R.meta.userAgent || '']
  );
  const sn = R.snapshot;
  if (sn) {
    rows.push(
      ['Экран', `${sn.screen.w}×${sn.screen.h}` + (sn.zoomHint && sn.zoomHint !== 100 ? `, масштаб страницы ≈${sn.zoomHint}%` : '')],
      ['Тема системы', sn.colorScheme + (sn.reducedMotion ? ', уменьшение анимации' : '')],
      ['Часовой пояс', sn.timezone],
      ['Сеть', (sn.online ? 'онлайн' : 'офлайн') + (sn.connection ? `, ${sn.connection.type}, ~${sn.connection.downlink} Мбит/с, задержка ${sn.connection.rtt} мс` : '')],
      ['Процессор / память устройства', `${sn.cpu || '?'} ядер` + (sn.deviceMemory ? `, ${sn.deviceMemory} ГБ` : '')],
      ['Сенсорный экран', sn.touch ? `да (${sn.touch} касаний)` : 'нет'],
      ['DOM-узлов на странице', String(sn.domNodes)],
      ['Память JS', sn.heapMB != null ? `${sn.heapMB} МБ из ${sn.heapLimitMB} МБ` : '—'],
      ['Прокрутка в начале проверки', `${sn.scroll.y} px из ${sn.scroll.height} px`],
      ['Service Worker', sn.serviceWorker ? 'активен' : 'нет'],
      ['Откуда пришли (referrer)', sn.referrer || '—']
    );
  }
  return rows;
}

// ================= маскирование =================
const SECRET_H = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|x-amz-security-token)$/i;
const SECRET_K = 'password|passwd|pwd|pass|token|access_token|refresh_token|id_token|secret|client_secret|api_key|apikey|session|sessionid|otp|pin|cvv|card_number';
const reJson = new RegExp(`("(?:${SECRET_K})"\\s*:\\s*)"[^"]*"`, 'gi');
const reForm = new RegExp(`([?&;\\s]|^)((?:${SECRET_K})=)[^&\\s#]*`, 'gi');
const maskH = (h) => (h ? Object.fromEntries(Object.entries(h).map(([k, v]) => [k, SECRET_H.test(k) ? '••• скрыто •••' : v])) : h);
const maskS = (s) => (s ? String(s).replace(reJson, '$1"•••"').replace(reForm, '$1$2•••') : s);

// ================= модель для экспорта =================
function opts() {
  return {
    console: $('#o-console').value,
    network: $('#o-network').value,
    before: $('#o-before').checked,
    details: $('#o-details').checked,
    mask: $('#o-mask').checked,
    embed: $('#o-embed').checked,
    events: $('#o-events').value,
    perf: $('#o-perf').checked,
    storage: $('#o-storage').checked,
    audit: $('#o-audit').checked,
    remarks: $('#o-remarks').checked,
    errors: $('#o-errors').checked,
    recordings: $('#o-recordings').checked,
    appendix: $('#o-appendix').checked,
  };
}
const netErr = (e) => !e.mocked && (e.failed || e.status >= 400);
function filterConsole(list, mode) {
  if (mode === 'none') return [];
  if (mode === 'warn') return list.filter((c) => c.level === 'error' || c.level === 'warn');
  if (mode === 'error') return list.filter((c) => c.level === 'error');
  return list;
}
function filterNet(list, mode) {
  if (mode === 'none') return [];
  if (mode === 'api') return list.filter((e) => ['XHR', 'Fetch', 'EventSource', 'WebSocket'].includes(e.type) || netErr(e));
  if (mode === 'errors') return list.filter(netErr);
  return list;
}
const b64bytes = (dataUrl) => {
  const b = atob(dataUrl.split(',')[1]);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
};
const imgSize = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 0, h: 0 }); i.src = src; });

async function buildModel(o, only) {
  const st = R.startTime;
  const keep = (e) => o.before || e.ts >= st;
  const items = [];
  for (const i of itemList()) {
    if (only === 'audit') continue;
    if (only ? i.key !== only : !((i.kind === 'remark' && o.remarks) || (i.kind === 'error' && o.errors) || (i.kind === 'recording' && o.recordings))) continue;
    items.push(await itemModel(i, o));
  }
  const apx = !only && o.appendix;
  if (itemSort === 'sev') items.sort((a, b) => sevOf(b.sev).rank - sevOf(a.sev).rank);
  const net = filterNet(allNet().filter(keep), o.network).map((e) => {
    const x = { ...e, rel: e.ts - st };
    if (o.mask) { x.reqHeaders = maskH(e.reqHeaders); x.resHeaders = maskH(e.resHeaders); x.url = maskS(e.url); x.postData = maskS(e.postData); x.body = maskS(e.body); }
    if (!o.details) { delete x.reqHeaders; delete x.resHeaders; delete x.postData; delete x.body; }
    return x;
  });
  const media = (arr, kind) => arr.filter((v) => mediaBlobs[v.key]).map((v) => ({ ...v, rel: v.start - st, durationMs: (v.end || Date.now()) - v.start, size: mediaBlobs[v.key].size, file: `media/${kind}-${v.n}.webm` }));
  const f = R.fields;
  const usedVoice = new Set(items.flatMap((it) => (it.voice || []).map((v) => v.key)));
  const one = only && only !== 'audit' && items[0];
  return {
    title: one ? (one.kind === 'remark' ? one.comment || 'Замечание' : one.kind === 'error' ? one.title : 'Запись видео') : only === 'audit' ? 'Автопроверка: ' + (R.meta.title || R.meta.startUrl) : f.title || 'Отчёт о проверке',
    severity: one ? one.sevLabel : '', priority: f.priority, steps: one ? '' : f.steps, expected: one ? '' : f.expected, actual: one ? '' : f.actual, notes: one ? '' : f.notes,
    createdAt: new Date(st).toLocaleString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU')),
    generatedAt: new Date().toLocaleString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU')),
    env: one ? env().filter(([k]) => ['Страница', 'Браузер', 'ОС', 'Размер окна', 'Экран', 'Язык браузера'].includes(k)) : env(),
    items,
    audit: (only === 'audit' || (!only && o.audit)) ? auditModel() : [],
    aiSummary: only ? '' : (R.aiSummary && R.aiSummary.text) || '',
    sevSummary: SEV.map((x) => [x, items.filter((it) => it.sev === x.id).length]).filter(([, n]) => n).map(([x, n]) => `${x.icon} ${x.name}: ${n}`).join(' · '),
    appendix: apx,
    annotations: [],
    actions: !apx ? [] : timeline().filter(keep).map((a) => ({ rel: a.ts - st, text: a.kind === 'nav' ? 'Переход: ' + (o.mask ? maskS(a.url) : a.url) : X.describeAction(a), page: a.page || a.url || '' })),
    console: !apx ? [] : filterConsole(R.console.filter(keep), o.console).map((c) => ({ ...c, rel: c.ts - st, text: o.mask ? maskS(c.text) : c.text })),
    network: apx ? net : items.flatMap((it) => [...(it.requests || []), ...(it.requestsNear || [])]).filter((e, k, arr) => arr.findIndex((y) => y.id === e.id && y.ts === e.ts) === k),
    videos: [],
    voice: only ? [] : media(R.voice, 'voice').filter((v) => !usedVoice.has(v.key)),
    details: o.details,
    findings: !apx ? [] : findings().filter((f) => f.level !== 'ok').map((f) => ({ level: f.level, title: f.title, text: f.plain || stripTags(f.text) })),
    events: !apx || o.events === 'none' ? [] : timelineItems(o.events === 'all' ? 'all-events' : 'important-events').filter(keep).map((x) => ({ rel: x.ts - st, cat: CAT_RU[x.cat] || x.cat, level: x.level, text: o.mask ? maskS(x.text) : x.text })),
    perf: apx && o.perf ? perfModel() : null,
    storage: apx && o.storage && R.snapshot ? storageModel(o.mask) : null,
  };
}

// ================= пункты: замечания, ошибки, записи =================
let itemFilter = 'all';
let sevFilter = 'all';
let itemSort = 'time';
const ITEM_ICON = { remark: '💬', error: '⚠', recording: '🎬' };
function itemList() {
  const list = [];
  R.annotations.forEach((a) => list.push({ kind: 'remark', key: 'r' + a.n, ts: a.ts, a }));
  (R.errors || []).forEach((x) => list.push({ kind: 'error', key: 'e' + x.n, ts: x.ts, x }));
  R.videos.filter((v) => mediaBlobs[v.key]).forEach((v) => list.push({ kind: 'recording', key: 'v' + v.n, ts: v.start, v }));
  return list.sort((a, b) => a.ts - b.ts);
}
const between = (arr, from, to) => arr.filter((e) => e.ts >= from && e.ts <= to);
const findReq = (ref) => {
  const net = allNet();
  return net.find((e) => ref.id && e.id === ref.id) || net.filter((e) => e.url === ref.url && e.method === ref.method).sort((a, b) => Math.abs(a.ts - ref.ts) - Math.abs(b.ts - ref.ts))[0];
};
/** контекст пункта «Ошибка» */
function errorCtx(x) {
  const t0 = x.ts, t1 = x.lastTs || x.ts;
  const jsErrors = x.refs.filter((r) => r.type === 'js').map((r) => ({ text: r.text, loc: r.loc }));
  const requests = x.refs.filter((r) => r.type === 'request').map(findReq).filter(Boolean);
  const before = timeline().filter((a) => a.ts <= t0 + 500 && a.ts >= t0 - 120000).slice(-10)
    .map((a) => ({ ts: a.ts, text: a.kind === 'nav' ? 'Переход: ' + a.url : X.describeAction(a) }));
  const consoleNear = between(R.console, t0 - 15000, t1 + 3000).filter((c) => c.level === 'error' || c.level === 'warn').slice(-20);
  const requestsNear = between(allNet(), t0 - 15000, t1 + 3000).filter((e) => !noise(e) && (['XHR', 'Fetch'].includes(e.type) || netErr(e))).slice(-20);
  const eventsNear = between(R.events, t0 - 15000, t1 + 3000).filter((e) => e.kind !== 'vital' && isImportantEvent(e)).slice(-15);
  return { jsErrors, requests, before, consoleNear, requestsNear, eventsNear };
}
/** контекст пункта «Запись»: всё за время записи + 1–2 минуты до неё */
function recCtx(v) {
  const pre = ((R.options && R.options.bufferMin) || 2) * 60000;
  const from = v.start - Math.min(pre, 120000), to = v.end || Date.now();
  const tl = timelineItems('important').filter((x) => x.ts >= from && x.ts <= to && x.cat !== 'net' && x.cat !== 'console');
  return {
    from, to,
    timeline: tl,
    requests: between(allNet(), from, to).filter((e) => !noise(e) && (['XHR', 'Fetch'].includes(e.type) || netErr(e))),
    console: between(R.console, from, to).filter((c) => c.level === 'error' || c.level === 'warn'),
    perf: between(R.events, from, to).filter((e) => ['long-frame', 'slow-interaction', 'fps', 'layout-shift', 'rerender'].includes(e.kind) && e.level !== 'info'),
  };
}
const voiceFor = (a) => R.voice.filter((v) => mediaBlobs[v.key] && a.ts >= v.start - 2000 && a.ts <= (v.end || Date.now()) + 2000);

function renderItems() {
  const all = itemList();
  const cnt = { remark: 0, error: 0, recording: 0 };
  all.forEach((i) => cnt[i.kind]++);
  const errRepeats = (R.errors || []).reduce((s, x) => s + (x.count > 1 ? x.count - 1 : 0), 0);
  const sc = {};
  all.forEach((i) => { const v = itemSev(i); sc[v] = (sc[v] || 0) + 1; });
  $('#counts').innerHTML = `<span>💬 Замечаний: ${cnt.remark}</span><span class="${cnt.error ? 'e' : ''}">⚠ Ошибок поймано: ${cnt.error}${errRepeats ? ` (+${errRepeats} повторов)` : ''}</span><span>🎬 Записей: ${cnt.recording}</span>` +
    SEV.filter((x) => sc[x.id]).map((x) => `<span class="sevb s-${x.id}">${x.icon} ${x.name}: ${sc[x.id]}</span>`).join('');
  const fb = (k, t) => `<button data-f="${k}" class="${itemFilter === k ? 'on' : ''}">${t}</button>`;
  $('#ifil').innerHTML = fb('all', `Все (${all.length})`) + fb('remark', `💬 Замечания (${cnt.remark})`) + fb('error', `⚠ Ошибки (${cnt.error})`) + fb('recording', `🎬 Записи (${cnt.recording})`);
  $('#ifil').innerHTML += `<span class="sep2"></span><select id="sevf" title="Фильтр по серьёзности"><option value="all">Любая серьёзность</option>${SEV.map((x) => `<option value="${x.id}" ${sevFilter === x.id ? 'selected' : ''}>${x.icon} ${x.name}</option>`).join('')}</select>` +
    `<select id="isort" title="Порядок"><option value="time">По времени</option><option value="sev" ${itemSort === 'sev' ? 'selected' : ''}>Сначала серьёзные</option></select>`;
  $('#ifil').querySelectorAll('button').forEach((b) => (b.onclick = () => { itemFilter = b.dataset.f; renderItems(); }));
  $('#sevf').onchange = () => { sevFilter = $('#sevf').value; renderItems(); };
  $('#isort').onchange = () => { itemSort = $('#isort').value; renderItems(); };
  const list = all.filter((i) => (itemFilter === 'all' || i.kind === itemFilter) && (sevFilter === 'all' || itemSev(i) === sevFilter));
  if (itemSort === 'sev') list.sort((a, b) => sevOf(itemSev(b)).rank - sevOf(itemSev(a)).rank || a.ts - b.ts);
  if (!list.length) {
    $('#items').innerHTML = `<div class="card muted">${all.length ? 'Нет пунктов этого вида.' : 'Пунктов нет. На странице используйте 🎯 Элемент, ➚ Стрелка, ▭ Область, 💬 Заметка или ⏺ Записать видео. Ошибки консоли и запросов сохраняются автоматически.'}</div>`;
    return;
  }
  const dl = (key) => `<details class="dl"><summary>⬇ Скачать пункт</summary><div class="menu"><button data-dl="${key}" data-f="docx">📄 Word</button><button data-dl="${key}" data-f="md">📝 Markdown (.zip)</button><button data-dl="${key}" data-f="html">🌐 HTML</button><button data-dl="${key}" data-f="gdocs">📄 Google Docs</button></div></details>`;
  const cp = (i) => `<details class="dl"><summary>📋 Копировать</summary><div class="menu"><button data-cp="${i.key}" data-w="text">📝 Текст для задачи</button>${i.kind !== 'recording' ? `<button data-cp="${i.key}" data-w="img">🖼 Скриншот</button><button data-cp="${i.key}" data-w="both">📄 Текст + скриншот<br><small>для Google Docs, Word, Notion</small></button>` : ''}</div></details>`;
  const sevSel = (i) => { const v = itemSev(i); return `<select class="isev s-${v}" data-sev="${i.key}" title="Серьёзность${i.kind === 'error' && !i.x.severity ? ' (подобрана автоматически)' : ''}">${SEV.map((x) => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${x.icon} ${x.name}</option>`).join('')}</select>`; };
  const head = (i, num, title, extra = '') => `<div class="it-h"><span class="ic">${ITEM_ICON[i.kind]} ${num}</span>${sevSel(i)}<b>${esc(title)}</b><span class="chip time" data-ts="${i.ts}" title="Перейти к моменту в видео">${X.fmtRel(i.ts - R.startTime)}</span>${extra}<span class="acts"><button class="aib" data-ai="${i.key}" title="AI оформит баг и подскажет причину">🤖 AI</button>${cp(i)}${dl(i.key)}${i.kind === 'error' ? `<button data-ign="${i.key}" title="Удалить и больше не сохранять такие ошибки">🙈</button>` : ''}<button data-del="${i.key}" title="Удалить пункт">🗑</button></span></div>`;
  const tbl = (head2, rows) => (rows.length ? `<table><tr>${head2.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>` : '<div class="zero">Нет данных</div>');
  const cls = (l) => (l === 'error' ? 'err' : l === 'warn' ? 'warn' : '');
  const reqRows = (arr) => arr.map((e) => `<tr class="${netErr(e) ? 'err' : ''}">${relCell(e.ts)}<td>${esc(e.method)}</td><td><b>${esc(X.statusLabel(e))}</b></td><td class="u mono">${esc(short(e.url, 180))}</td><td>${X.fmtDur(e.duration)}</td></tr>`);
  const conRows = (arr) => arr.map((c) => `<tr class="${cls(c.level)}">${relCell(c.ts)}<td>${X.LEVEL_RU[c.level] || c.level}</td><td class="mono msg">${esc(short(c.text, 1500))}</td></tr>`);
  const reqDet = (e) => {
    const h = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `<div class="fact"><div class="fl">Запрос</div><pre>${esc(`${e.method} ${e.url}\n→ ${X.statusLabel(e)} ${e.statusText || ''}${e.duration != null ? ' · ' + X.fmtDur(e.duration) : ''}${e.error ? '\n' + e.error : ''}`)}</pre></div>` +
      (e.postData ? `<div class="fact"><div class="fl">Тело запроса</div><pre>${esc(e.postData)}</pre></div>` : '') +
      (e.body ? `<div class="fact"><div class="fl">Ответ сервера</div><pre>${esc(e.body)}</pre></div>` : '') +
      (e.reqHeaders && Object.keys(e.reqHeaders).length ? `<div class="fact"><div class="fl">Заголовки запроса</div><pre>${esc(h(e.reqHeaders))}</pre></div>` : '') +
      (e.resHeaders && Object.keys(e.resHeaders).length ? `<div class="fact"><div class="fl">Заголовки ответа</div><pre>${esc(h(e.resHeaders))}</pre></div>` : '');
  };
  const mini = (key, tabs) => {
    const ok = tabs.filter((t) => t);
    return `<div class="mt" data-k="${key}">${ok.map((t, i) => `<button data-i="${i}" class="${i ? '' : 'on'}">${t[0]}</button>`).join('')}</div>` +
      ok.map((t, i) => `<div class="mb" data-k="${key}" data-i="${i}" ${i ? 'hidden' : ''}>${t[1]}</div>`).join('');
  };

  $('#items').innerHTML = list.map((i) => {
    if (i.kind === 'remark') {
      const a = i.a;
      const vo = voiceFor(a);
      return `<div class="it remark">${head(i, a.n, a.comment || '(без комментария)')}
        <div class="it-b ${shots[a.n] ? '' : 'one'}">${shots[a.n] ? `<img src="${shots[a.n]}" alt=""${a.kind === 'screen' ? ' class="scr"' : ''}>` : ''}
        <div class="facts">
          <div class="fact"><div class="fl">Замечание</div><textarea rows="3" data-c="${a.n}">${esc(a.comment)}</textarea></div>
          ${a.element ? `<div class="fact"><div class="fl">Элемент</div><div class="sel">${esc(a.element.selector)}<br>&lt;${esc(a.element.tag)}&gt; ${Math.round(a.element.rect.w)}×${Math.round(a.element.rect.h)}${a.element.text ? ' · «' + esc(short(a.element.text, 80)) + '»' : ''}</div></div>` : ''}
          ${vo.map((v) => `<div class="fact"><div class="fl">🎤 Голос</div><audio controls data-key="${v.key}"></audio></div>`).join('')}
          <div class="fact"><div class="fl">Страница</div><div class="url">${esc(a.url)}</div></div>
          ${a.cond ? `<div class="fact"><div class="fl">Условия</div><div>📶 ${esc(a.cond)}</div></div>` : ''}
        </div></div>${aiBox(i)}</div>`;
    }
    if (i.kind === 'error') {
      const x = i.x;
      const c = errorCtx(x);
      const req = c.requests[0];
      const facts = [
        c.jsErrors.length ? `<div class="fact"><div class="fl">Ошибка JavaScript</div><pre>${esc(c.jsErrors.map((j) => j.text + (j.loc ? '\n@ ' + j.loc : '')).join('\n\n'))}</pre></div>` : '',
        req ? `<div class="fact"><div class="fl">Запрос с ошибкой</div><pre>${esc(`${req.method} ${X.statusLabel(req)} ${req.url}`)}</pre></div>` : '',
        c.before.length ? `<div class="fact"><div class="fl">Перед ошибкой пользователь</div><ol>${c.before.slice(-5).map((b) => `<li>${esc(b.text)}</li>`).join('')}</ol></div>` : '',
        `<div class="fact"><div class="fl">Страница</div><div class="url">${esc(x.url || '')}</div></div>`,
        x.cond ? `<div class="fact"><div class="fl">Условия</div><div>📶 ${esc(x.cond)}</div></div>` : '',
      ].join('');
      const tabs = [
        c.requests.length ? ['Детали запроса', `<div class="facts" style="padding:12px 16px">${c.requests.map(reqDet).join('')}</div>`] : null,
        ['Действия перед ошибкой', tbl(['Время', 'Действие'], c.before.map((b) => `<tr>${relCell(b.ts)}<td>${esc(b.text)}</td></tr>`))],
        c.eventsNear.length ? ['События на странице', tbl(['Время', 'Событие'], c.eventsNear.map((e) => `<tr class="${cls(e.level)}">${relCell(e.ts)}<td>${esc(e.text)}</td></tr>`))] : null,
        ['Консоль рядом', tbl(['Время', 'Уровень', 'Сообщение'], conRows(c.consoleNear))],
        ['Запросы рядом', tbl(['Время', 'Метод', 'Статус', 'URL', 'Время отв.'], reqRows(c.requestsNear))],
      ];
      return `<div class="it error">${head(i, x.n, x.title, x.count > 1 ? `<span class="pill bad">повторялась ${x.count} раз</span>` : '')}
        <div class="it-b ${x.shotKey && shots['e' + x.n] ? '' : 'one'}">${shots['e' + x.n] ? `<img src="${shots['e' + x.n]}" alt="">` : ''}<div class="facts">${facts}</div></div>
        ${aiBox(i)}${mini(i.key, tabs)}</div>`;
    }
    const v = i.v;
    const c = recCtx(v);
    const tabs = [
      ['Что происходило', tbl(['Время', 'Тип', 'Событие'], c.timeline.map((x) => `<tr class="${x.cat === 'mark' ? 'mark' : x.level === 'error' ? 'ev-err' : x.level === 'warn' ? 'ev-warn' : ''}">${relCell(x.ts)}<td><span class="cat cat-${x.cat}">${CAT_RU[x.cat] || x.cat}</span></td><td>${esc(x.text)}</td></tr>`))],
      ['Запросы', tbl(['Время', 'Метод', 'Статус', 'URL', 'Время отв.'], reqRows(c.requests))],
      ['Консоль', tbl(['Время', 'Уровень', 'Сообщение'], conRows(c.console))],
      c.perf.length ? ['Производительность', tbl(['Время', 'Событие'], c.perf.map((e) => `<tr class="${cls(e.level)}">${relCell(e.ts)}<td>${esc(e.text)}</td></tr>`))] : null,
    ];
    return `<div class="it recording">${head(i, v.n, `Запись видео · ${X.fmtDur((v.end || Date.now()) - v.start)}`, `<span class="muted">${X.fmtSize(mediaBlobs[v.key].size)} · данные за ${Math.round((v.start - c.from) / 1000)} с до начала и во время записи</span>`)}
      <div class="it-b one"><video controls preload="metadata" data-key="${v.key}" data-start="${v.start}"></video></div>
      ${aiBox(i)}${mini(i.key, tabs)}</div>`;
  }).join('');

  // медиа
  $('#items').querySelectorAll('video[data-key],audio[data-key]').forEach((el) => {
    el.src = URL.createObjectURL(mediaBlobs[el.dataset.key]);
    el.addEventListener('loadedmetadata', function fix() {
      el.removeEventListener('loadedmetadata', fix);
      if (el.duration === Infinity) { el.currentTime = 1e101; el.addEventListener('timeupdate', function back() { el.removeEventListener('timeupdate', back); el.currentTime = 0; }); }
    });
  });
  $('#items').querySelectorAll('img').forEach((im) => (im.onclick = () => { $('#lightbox img').src = im.src; $('#lightbox').hidden = false; }));
  $('#items').querySelectorAll('[data-c]').forEach((t) => (t.oninput = () => {
    const a = R.annotations.find((x) => x.n === +t.dataset.c);
    a.comment = t.value;
    const b = t.closest('.it').querySelector('.it-h b');
    b.textContent = t.value || '(без комментария)';
    saveR();
  }));
  $('#items').querySelectorAll('.it-h .time').forEach((c) => (c.onclick = () => seekTo(+c.dataset.ts)));
  $('#items').querySelectorAll('.mt button').forEach((b) => (b.onclick = () => {
    const k = b.parentElement.dataset.k;
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    $('#items').querySelectorAll(`.mb[data-k="${k}"]`).forEach((m) => (m.hidden = m.dataset.i !== b.dataset.i));
  }));
  $('#items').querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => { b.closest('details').open = false; doExport(b.dataset.f, b.dataset.dl); }));
  $('#items').querySelectorAll('[data-sev]').forEach((sel) => (sel.onchange = () => {
    const i = itemList().find((x) => x.key === sel.dataset.sev);
    setItemSev(i, sel.value);
    renderItems();
  }));
  $('#items').querySelectorAll('[data-ai]').forEach((b) => (b.onclick = () => runAI(b.dataset.ai, b)));
  $('#items').querySelectorAll('[data-aicopy]').forEach((b) => (b.onclick = () => copyItem(b.dataset.aicopy, 'text')));
  $('#items').querySelectorAll('[data-aisev]').forEach((b) => (b.onclick = () => {
    const i = itemList().find((x) => x.key === b.dataset.aisev);
    setItemSev(i, objOf(i).ai.severity);
    renderItems();
    flash('Серьёзность изменена');
  }));
  $('#items').querySelectorAll('[data-aidel]').forEach((b) => (b.onclick = () => {
    const i = itemList().find((x) => x.key === b.dataset.aidel);
    delete objOf(i).ai;
    saveR();
    renderItems();
  }));
  $('#items').querySelectorAll('[data-cp]').forEach((b) => (b.onclick = () => { b.closest('details').open = false; copyItem(b.dataset.cp, b.dataset.w); }));
  // только одно открытое меню
  $('#items').querySelectorAll('details.dl').forEach((d) => d.addEventListener('toggle', () => { if (d.open) $('#items').querySelectorAll('details.dl[open]').forEach((x) => x !== d && (x.open = false)); }));
  $('#items').querySelectorAll('[data-ign]').forEach((b) => (b.onclick = async () => {
    const n = +b.dataset.ign.slice(1);
    const x = R.errors.find((y) => y.n === n);
    if (!confirm(`Удалить этот пункт и больше не сохранять такие ошибки?\n\n${x.title}\n\nСписок игнорируемых — в настройках расширения.`)) return;
    const { qa_ignore: list = [] } = await chrome.storage.local.get('qa_ignore');
    x.sigs.forEach((sig) => { if (!list.some((l) => l.sig === sig)) list.push({ sig, title: x.title, added: Date.now() }); });
    await chrome.storage.local.set({ qa_ignore: list });
    R.errors = R.errors.filter((y) => y !== x);
    if (x.shotKey) await QADB.del('blobs', x.shotKey).catch(() => {});
    saveR();
    renderItems();
    flash('Такие ошибки больше не будут сохраняться');
  }));
  $('#items').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const key = b.dataset.del;
    if (!confirm('Удалить этот пункт из отчёта?')) return;
    const n = +key.slice(1);
    if (key[0] === 'r') {
      const a = R.annotations.find((x) => x.n === n);
      R.annotations = R.annotations.filter((x) => x !== a);
      await QADB.del('blobs', a.shotKey).catch(() => {});
    } else if (key[0] === 'e') {
      const x = R.errors.find((y) => y.n === n);
      R.errors = R.errors.filter((y) => y !== x);
      if (x.shotKey) await QADB.del('blobs', x.shotKey).catch(() => {});
    } else {
      const v = R.videos.find((y) => y.n === n);
      R.videos = R.videos.filter((y) => y !== v);
      await QADB.del('blobs', v.key).catch(() => {});
      delete mediaBlobs[v.key];
    }
    saveR();
    renderItems();
  }));
}

// ================= 🤖 AI =================
const objOf = (i) => (i.kind === 'remark' ? i.a : i.kind === 'error' ? i.x : i.v);
const SIDE_ICON = { frontend: '🖥', backend: '🗄', both: '🖥🗄', unknown: '❔' };
function aiBox(i) {
  const ai = objOf(i).ai;
  if (!ai) return '';
  const cur = itemSev(i);
  return `<div class="aibox">
    <div class="aih"><b>🤖 Разбор AI</b><span class="muted">${esc(ai.model)} · ${new Date(ai.at).toLocaleString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU'), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      <span class="acts">${ai.severity && ai.severity !== cur ? `<button data-aisev="${i.key}" title="Поставить серьёзность, предложенную AI">${sevLabel(ai.severity)}?</button>` : ''}<button data-aicopy="${i.key}" title="Скопировать пункт вместе с разбором — для задачи в трекере">📋 Копировать как задачу</button><button data-ai="${i.key}" title="Разобрать ещё раз">↻</button><button data-aidel="${i.key}" title="Удалить разбор">✕</button></span></div>
    ${ai.title ? `<div class="ait">${esc(ai.title)}</div>` : ''}
    <div class="aig">
      ${ai.steps.length ? `<div><div class="fl">Шаги воспроизведения</div><ol>${ai.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
      <div>${ai.expected ? `<div class="fl">Ожидалось</div><p>${esc(ai.expected)}</p>` : ''}${ai.actual ? `<div class="fl">Фактически</div><p>${esc(ai.actual)}</p>` : ''}</div>
    </div>
    ${ai.cause ? `<div class="fl">Вероятная причина <span class="side s-${ai.side}">${SIDE_ICON[ai.side]} ${QAInt.SIDE_RU[ai.side]}</span></div><p>${esc(ai.cause)}</p>` : ''}
    ${ai.fix ? `<div class="fl">Что проверить</div><p class="pw">${esc(ai.fix)}</p>` : ''}
    ${ai.questions.length ? `<div class="fl">Стоит уточнить</div><ul>${ai.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
  </div>`;
}
/** текст пункта для AI: данные пункта + контекст, токены скрыты */
async function aiContext(i) {
  const it = await itemModel(i, { ...opts(), details: true, mask: true });
  const e = env();
  const envLine = e.filter(([k]) => ['Браузер', 'ОС', 'Размер окна'].includes(k)).map(([k, v]) => `${k}: ${v}`).join('; ');
  const L = [`Сайт: ${R.meta.title || ''} ${maskS(R.meta.startUrl || '')}`, envLine, '', X.itemText({ ...it, ai: null })];
  if (i.kind === 'remark') {
    const a = i.a;
    if (a.element && a.element.text) L.push(`Текст элемента: «${short(a.element.text, 300)}»`);
    const acts = timeline().filter((x) => x.ts <= a.ts && x.ts >= a.ts - 180000).slice(-8);
    if (acts.length) { L.push('', 'Действия пользователя перед замечанием:'); acts.forEach((x, k) => L.push(`${k + 1}. ${x.kind === 'nav' ? 'Переход: ' + maskS(x.url) : X.describeAction(x)}`)); }
    const errs = between(R.console, a.ts - 30000, a.ts + 2000).filter((c) => c.level === 'error').slice(-5);
    if (errs.length) { L.push('', 'Ошибки консоли незадолго до замечания:'); errs.forEach((c) => L.push('- ' + short(maskS(c.text), 400))); }
    const bad = between(allNet(), a.ts - 30000, a.ts + 2000).filter(netErr).slice(-5);
    if (bad.length) { L.push('', 'Упавшие запросы незадолго до замечания:'); bad.forEach((r) => L.push(`- ${r.method} ${X.statusLabel(r)} ${maskS(r.url)}`)); }
  }
  return { text: short(L.join('\n'), 14000), image: it.dataUrl };
}
async function runAI(key, btn) {
  const i = itemList().find((x) => x.key === key);
  if (!i) return;
  const ctx = await aiContext(i);
  const s = await QAInt.getAI();
  if (!QAInt.aiReady(s)) {
    await navigator.clipboard.writeText(QAInt.promptForChat(ctx.text));
    flash('AI не подключён. Запрос скопирован — вставьте его в Claude или ChatGPT. Подключить ключ: «🔌 Интеграции» вверху.');
    return;
  }
  const old = btn.textContent;
  document.querySelectorAll(`[data-ai="${key}"]`).forEach((b) => { b.disabled = true; b.textContent = '🤖 Думаю…'; });
  try {
    objOf(i).ai = await QAInt.analyzeItem(ctx.text, ctx.image);
    saveR();
    renderItems();
    flash('Готово: разбор AI добавлен к пункту и попадёт в выгрузку');
  } catch (e) {
    console.error(e);
    flash('AI: ' + e.message);
    document.querySelectorAll(`[data-ai="${key}"]`).forEach((b) => { b.disabled = false; b.textContent = old; });
  }
}
function summaryContext() {
  const L = [`Сайт: ${R.meta.title || ''} ${maskS(R.meta.startUrl || '')}`, `Длительность проверки: ${X.fmtDur((R.endTime || Date.now()) - R.startTime)}`, '', 'Пункты:'];
  for (const i of itemList()) {
    const o = objOf(i);
    const sv = sevLabel(itemSev(i));
    if (i.kind === 'remark') L.push(`- Замечание ${o.n} [${sv}]: ${short(o.comment || '(без комментария)', 300)}${o.element ? ` (элемент ${o.element.selector})` : ''} — ${maskS(o.url)}`);
    else if (i.kind === 'error') L.push(`- Ошибка ${o.n} [${sv}]: ${short(maskS(o.title), 300)}${o.count > 1 ? ` (×${o.count})` : ''} — ${maskS(o.url || '')}`);
    else L.push(`- Запись ${o.n} [${sv}]: видео ${X.fmtDur((o.end || Date.now()) - o.start)}`);
    if (o.ai && o.ai.cause) L.push(`  Разбор AI: ${o.ai.title}. Причина (${QAInt.SIDE_RU[o.ai.side]}): ${short(o.ai.cause, 300)}`);
  }
  const au = auditModel();
  if (au.length) { L.push('', 'Автопроверка:'); au.slice(0, 25).forEach((f) => L.push(`- [${sevLabel(f.sev)}] ${f.title}`)); }
  return short(L.join('\n'), 16000);
}
function renderAISummary() {
  const el = $('#ai-summary');
  const sm = R.aiSummary;
  el.hidden = !sm;
  if (!sm) return;
  el.innerHTML = `<div class="aih"><b>🤖 Резюме AI</b><span class="muted">${esc(sm.model)} · ${new Date(sm.at).toLocaleString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU'), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · попадёт в начало выгрузки</span>
    <span class="acts"><button id="sum-copy">📋 Копировать</button><button id="sum-redo" title="Составить заново">↻</button><button id="sum-del" title="Удалить резюме">✕</button></span></div><div class="sumbody">${X.mdLite(sm.text)}</div>`;
  $('#sum-copy').onclick = async () => { await navigator.clipboard.writeText(sm.text); flash('Резюме скопировано'); };
  $('#sum-redo').onclick = () => runSummary();
  $('#sum-del').onclick = () => { delete R.aiSummary; saveR(); renderAISummary(); };
}
async function runSummary() {
  const text = summaryContext();
  const s = await QAInt.getAI();
  if (!QAInt.aiReady(s)) {
    await navigator.clipboard.writeText('Составь краткое резюме отчёта о тестировании для команды: итог, что исправить в первую очередь (с номерами пунктов), общие причины.\n\n' + text);
    flash('AI не подключён. Запрос скопирован — вставьте его в Claude или ChatGPT. Подключить ключ: «🔌 Интеграции».');
    return;
  }
  const b = $('#ai-sum');
  b.disabled = true; b.textContent = '🤖 Составляю резюме…';
  try {
    R.aiSummary = await QAInt.summarize(text);
    saveR();
    renderAISummary();
    $('#ai-summary').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    console.error(e);
    flash('AI: ' + e.message);
  } finally {
    b.disabled = false; b.textContent = '🤖 Резюме отчёта';
  }
}

// ---------- копирование пункта в буфер обмена ----------
function flash(text) {
  let t = $('#flash');
  if (!t) { t = document.createElement('div'); t.id = 'flash'; document.body.appendChild(t); }
  t.textContent = text;
  t.className = 'show';
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ''), 2600);
}
async function copyItem(key, what) {
  try {
    const i = itemList().find((x) => x.key === key);
    const it = await itemModel(i, { ...opts(), details: true });
    const text = X.itemText(it);
    const png = it.dataUrl ? await (await fetch(it.dataUrl)).blob() : null;
    if (what === 'text') {
      await navigator.clipboard.writeText(text);
      flash('Текст скопирован — вставьте в задачу (Ctrl+V)');
    } else if (what === 'img') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      flash('Скриншот скопирован — вставьте в задачу или чат (Ctrl+V)');
    } else {
      const html = `<div>${esc(text).replace(/\n/g, '<br>')}</div>${it.dataUrl ? `<p><img src="${it.dataUrl}" style="max-width:100%"></p>` : ''}`;
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      flash('Текст и скриншот скопированы — вставьте в Google Docs, Word или Notion');
    }
  } catch (e) {
    console.error(e);
    flash('Не удалось скопировать: ' + e.message);
  }
}

/** модель одного пункта для выгрузки */
async function itemModel(i, o) {
  const st = R.startTime;
  const m = (e) => {
    const x = { ...e, rel: e.ts - st };
    if (o.mask) { x.reqHeaders = maskH(e.reqHeaders); x.resHeaders = maskH(e.resHeaders); x.url = maskS(e.url); x.postData = maskS(e.postData); x.body = maskS(e.body); }
    if (!o.details) { delete x.reqHeaders; delete x.resHeaders; delete x.postData; delete x.body; }
    return x;
  };
  const shot = async (dataUrl, file, target) => {
    if (!dataUrl) return;
    Object.assign(target, { dataUrl, file, bytes: b64bytes(dataUrl) }, await imgSize(dataUrl));
  };
  if (i.kind === 'remark') {
    const a = i.a;
    const it = { kind: 'remark', ai: a.ai, cond: a.cond || '', key: i.key, sev: itemSev(i), sevLabel: sevLabel(itemSev(i)), n: a.n, rel: a.ts - st, url: a.url, comment: a.comment, element: a.element,
      voice: voiceFor(a).map((v) => ({ key: v.key, file: `media/voice-${v.n}.webm` })) };
    await shot(shots[a.n], `screenshots/zamechanie-${String(a.n).padStart(2, '0')}.png`, it);
    return it;
  }
  if (i.kind === 'error') {
    const x = i.x;
    const c = errorCtx(x);
    const it = {
      kind: 'error', ai: x.ai, cond: x.cond || '', key: i.key, sev: itemSev(i), sevLabel: sevLabel(itemSev(i)), n: x.n, rel: x.ts - st, url: o.mask ? maskS(x.url) : x.url, title: o.mask ? maskS(x.title) : x.title, count: x.count,
      jsErrors: c.jsErrors.map((j) => ({ text: o.mask ? maskS(j.text) : j.text, loc: j.loc })),
      requests: c.requests.map(m),
      before: c.before.map((b) => ({ rel: b.ts - st, text: o.mask ? maskS(b.text) : b.text })),
      consoleNear: c.consoleNear.map((cc) => ({ rel: cc.ts - st, level: cc.level, text: o.mask ? maskS(cc.text) : cc.text, loc: cc.loc })),
      requestsNear: c.requestsNear.map(m),
      eventsNear: c.eventsNear.map((e) => ({ rel: e.ts - st, level: e.level, text: e.text })),
    };
    await shot(shots['e' + x.n], `screenshots/oshibka-${String(x.n).padStart(2, '0')}.png`, it);
    return it;
  }
  const v = i.v;
  const c = recCtx(v);
  return {
    kind: 'recording', ai: v.ai, key: i.key, sev: itemSev(i), sevLabel: sevLabel(itemSev(i)), n: v.n, rel: v.start - st, durationMs: (v.end || Date.now()) - v.start, size: mediaBlobs[v.key].size,
    file: `media/video-${v.n}.webm`, videoKey: v.key,
    timeline: c.timeline.map((x) => ({ rel: x.ts - st, cat: CAT_RU[x.cat] || x.cat, level: x.level, text: o.mask ? maskS(x.text) : x.text })),
    requests: c.requests.map(m),
    console: c.console.map((cc) => ({ rel: cc.ts - st, level: cc.level, text: o.mask ? maskS(cc.text) : cc.text })),
    perf: c.perf.map((e) => ({ rel: e.ts - st, text: e.text })),
  };
}

// ================= серьёзность =================
const SEV = [
  { id: 'blocker', icon: '🔴', name: 'Блокирующий', rank: 5 },
  { id: 'critical', icon: '🟠', name: 'Критический', rank: 4 },
  { id: 'major', icon: '🟡', name: 'Значительный', rank: 3 },
  { id: 'minor', icon: '🔵', name: 'Незначительный', rank: 2 },
  { id: 'trivial', icon: '⚪', name: 'Тривиальный', rank: 1 },
];
const sevOf = (id) => SEV.find((x) => x.id === id) || SEV[2];
const sevLabel = (id) => `${sevOf(id).icon} ${sevOf(id).name}`;
/** подсказка серьёзности для автоматически пойманной ошибки */
function suggestErrSev(x) {
  const c = errorCtx(x);
  const userAct = timeline().some((a) => a.kind !== 'nav' && a.ts <= x.ts && x.ts - a.ts < 4000);
  const req = c.requests[0];
  if (req) {
    const write = /^(POST|PUT|PATCH|DELETE)$/.test(req.method);
    if (req.failed || req.status >= 500) return write || userAct ? 'blocker' : 'critical';
    if (req.status === 401 || req.status === 403) return 'major';
    return 'major';
  }
  return userAct ? 'critical' : 'major';
}
function itemSev(i) {
  if (i.kind === 'remark') return i.a.severity || 'minor';
  if (i.kind === 'error') return i.x.severity || suggestErrSev(i.x);
  return i.v.severity || 'major';
}
function setItemSev(i, v) {
  (i.kind === 'remark' ? i.a : i.kind === 'error' ? i.x : i.v).severity = v;
  saveR();
}

// ================= 🩺 автопроверка: анализ =================
const AUDIT_CAT = { seo: '🔎 SEO', perf: '⚡ Скорость', a11y: '♿ Доступность', sem: '🏷 Семантика', best: '✅ Практики и безопасность', net: '🌐 Сеть', render: '🔁 Перерисовки', img: '🖼 Изображения', console: '⚠️ Предупреждения', dom: '🧱 DOM' };
const IMPACT_SEV = { critical: 'critical', serious: 'major', moderate: 'minor', minor: 'trivial' };
let auditFilter = 'all';
const normPath = (u) => { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/\d+(?=\/|$)/g, '/#').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '#'); } catch (_) { return u; } };
const shortUrl = (u) => { try { const x = new URL(u); return x.pathname + (x.search ? short(x.search, 50) : ''); } catch (_) { return u; } };

function auditIssues() {
  const I = [];
  const add = (cat, sev, title, why, fix, examples, count) => I.push({ cat, sev, title, why, fix, examples: examples.slice(0, 8), count: count || examples.length });
  const api = allNet().filter((e) => !noise(e) && ['XHR', 'Fetch'].includes(e.type)).sort((a, b) => a.ts - b.ts);

  // --- сеть: дубли подряд
  const dupMap = new Map();
  for (let k = 1; k < api.length; k++) {
    const a = api[k], key = `${a.method} ${a.url} ${a.postData || ''}`;
    const prev = api.slice(Math.max(0, k - 6), k).reverse().find((p) => `${p.method} ${p.url} ${p.postData || ''}` === key);
    if (prev && a.ts - prev.ts < (a.method === 'GET' ? 1500 : 2500)) {
      const d = dupMap.get(key) || { method: a.method, url: a.url, n: 0, ts: a.ts };
      d.n++; dupMap.set(key, d);
    }
  }
  const dups = [...dupMap.values()];
  const dupWrite = dups.filter((d) => d.method !== 'GET');
  const dupRead = dups.filter((d) => d.method === 'GET');
  if (dupWrite.length) add('net', 'major', `Повторная отправка данных: ${dupWrite.length}`,
    'Один и тот же POST/PUT/DELETE ушёл несколько раз подряд — возможны двойные заказы, платежи или записи.',
    'Блокировать кнопку на время запроса, добавить ключ идемпотентности на сервере.',
    dupWrite.map((d) => `${d.method} ${shortUrl(d.url)} — лишних повторов: ${d.n}`));
  if (dupRead.length) add('net', dupRead.some((d) => d.n >= 2) ? 'minor' : 'trivial', `Дублирующиеся запросы: ${dupRead.length}`,
    'Одинаковый запрос отправляется несколько раз подряд: лишняя нагрузка на сервер и медленнее интерфейс. Часто причина — эффект в React срабатывает дважды или данные запрашивают несколько компонентов.',
    'Кэшировать ответ (React Query, SWR), поднять запрос выше по дереву, проверить зависимости useEffect.',
    dupRead.map((d) => `GET ${shortUrl(d.url)} — лишних повторов: ${d.n}`));

  // --- сеть: N+1
  const n1 = [];
  const byPat = new Map();
  api.forEach((e) => { const k = e.method + ' ' + normPath(e.url); (byPat.get(k) || byPat.set(k, []).get(k)).push(e); });
  byPat.forEach((arr, k) => {
    if (!k.includes('#')) return;
    for (let s0 = 0; s0 < arr.length; s0++) {
      const win = arr.filter((e) => e.ts >= arr[s0].ts && e.ts - arr[s0].ts < 3000);
      const distinct = new Set(win.map((e) => e.url)).size;
      if (distinct >= 5) { n1.push(`${k.replace(/^(\w+) https?:\/\/[^/]+/, '$1 ')} — ${distinct} запросов за 3 с`); break; }
    }
  });
  if (n1.length) add('net', 'major', `Запросы по одному элементу (N+1): ${n1.length}`,
    'Для списка данные загружаются отдельным запросом на каждый элемент. С ростом списка страница будет грузиться всё дольше.',
    'Сделать один запрос на весь список (batch-эндпоинт, параметр ids=…) или отдавать данные вместе со списком.', n1);

  // --- сеть: частый опрос
  const poll = [];
  byPat.forEach((arr, k) => {
    if (arr.length < 15) return;
    const span = (arr[arr.length - 1].ts - arr[0].ts) / 1000;
    if (span > 0 && span / arr.length < 5) poll.push(`${k.replace(/^(\w+) https?:\/\/[^/]+/, '$1 ')} — ${arr.length} раз за ${Math.round(span)} с`);
  });
  if (poll.length) add('net', 'minor', `Слишком частые запросы: ${poll.length}`,
    'Один и тот же адрес опрашивается чаще раза в 5 секунд: нагрузка на сервер и батарею.',
    'Увеличить интервал, опрашивать только при видимой вкладке, перейти на WebSocket/SSE.', poll);

  // --- сеть: медленные и тяжёлые
  const slow = api.filter((e) => e.duration > 1000).sort((a, b) => b.duration - a.duration);
  if (slow.length) add('net', slow[0].duration > 3000 ? 'major' : 'minor', `Медленные запросы (дольше 1 с): ${slow.length}`,
    'Пользователь ждёт ответа сервера больше секунды.', 'Проверить запрос на сервере (индексы БД, N+1 на бэкенде), добавить кэш или пагинацию.',
    slow.map((e) => `${e.method} ${shortUrl(e.url)} — ${X.fmtDur(e.duration)}`));
  const heavy = api.filter((e) => e.size > 1048576);
  if (heavy.length) add('net', 'minor', `Тяжёлые ответы (больше 1 МБ): ${heavy.length}`,
    'Большие ответы долго грузятся на мобильном интернете.', 'Пагинация, выбор нужных полей, сжатие gzip/brotli.',
    heavy.map((e) => `${e.method} ${shortUrl(e.url)} — ${X.fmtSize(e.size)}`));

  // --- перерисовки
  const storms = R.events.filter((e) => e.cat === 'render' && e.level === 'warn');
  if (storms.length) {
    const comps = new Map();
    storms.forEach((e) => Object.entries((e.detail || {}).components || {}).forEach(([n, v]) => comps.set(n, (comps.get(n) || 0) + v[0])));
    add('render', storms.length >= 5 ? 'major' : 'minor', `Шторм перерисовок: ${storms.length} с с 20+ обновлениями в секунду`,
      'Интерфейс обновляется непрерывно — тратится процессор, страница может тормозить и разряжать батарею.',
      'Найти источник частых setState (таймеры, подписки, анимации через state), использовать memo/useMemo, перенести анимацию в CSS.',
      [...comps.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} — ${c} перерисовок в эти секунды`));
  }
  // перерисовки DOM — для любого сайта
  const da = domAgg();
  const rec = da.list.filter((x) => x.recreated > 0).sort((a, b) => b.recreated - a.recreated);
  if (da.recreated >= 10) add('render', da.recreated >= 200 ? 'major' : 'minor', `Элементы пересоздаются без изменений: ${da.recreated} раз`,
    'Блок удаляется и вставляется заново с тем же содержимым. Браузер заново строит элементы, пересчитывает стили и макет, теряется фокус и состояние (выделение, прокрутка, ввод). Частая причина — перерисовка всего списка или innerHTML ради одного изменения.',
    'Обновлять только изменившиеся элементы: точечные изменения DOM, стабильные key в списках (React/Vue), не пересоздавать разметку целиком.',
    rec.map((x) => `${x.selector} — пересоздан ${x.recreated} раз`), da.recreated);
  const nop = da.list.filter((x) => x.noop > 0).sort((a, b) => b.noop - a.noop);
  if (da.noop >= 20) add('render', da.noop >= 300 ? 'minor' : 'trivial', `Пустые обновления DOM: ${da.noop}`,
    'В атрибут, класс, стиль или текст записывается то же значение, что уже было. Изменений не видно, но браузер всё равно проверяет и пересчитывает.',
    'Сравнивать значение перед записью, не обновлять стили/классы в цикле или на каждый кадр без изменений.',
    nop.map((x) => `${x.selector} — ${x.noop} раз`), da.noop);
  const hot = da.list.filter((x) => x.secs >= 15 && x.changes / x.secs >= 10).sort((a, b) => b.changes - a.changes);
  if (hot.length) add('render', 'trivial', `Постоянно меняющиеся области: ${hot.length}`,
    'Блок меняется десятки раз в секунду на протяжении долгого времени. Это нормально для таймеров и анимаций, но если область не должна меняться — это лишняя работа браузера.',
    'Проверить, нужен ли такой частый апдейт; анимации делать через CSS (transform/opacity), таймеры обновлять не чаще, чем видно глазу.',
    hot.map((x) => `${x.selector} — ${x.changes} изменений за ${x.secs} с`));
  const ma = R.meta.cdpMetricsStart, mb = R.meta.cdpMetricsEnd;
  if (ma && mb) {
    const secs = Math.max(1, ((R.endTime || Date.now()) - R.startTime) / 1000);
    const lay = (mb.LayoutCount || 0) - (ma.LayoutCount || 0), sty = (mb.RecalcStyleCount || 0) - (ma.RecalcStyleCount || 0);
    if (lay / secs > 10 || sty / secs > 20) add('render', 'minor', `Частые пересчёты макета и стилей`,
      'Браузер пересчитывал расположение элементов (layout) и стили очень часто — это одна из главных причин подтормаживаний.',
      'Не читать размеры элементов (offsetHeight, getBoundingClientRect) сразу после изменения стилей в цикле, группировать изменения DOM.',
      [`layout: ${lay} раз за ${Math.round(secs)} с (${(lay / secs).toFixed(1)}/с)`, `стили: ${sty} раз (${(sty / secs).toFixed(1)}/с)`]);
  }
  const ra = rendersAgg();
  const heavyComp = ra.list.filter(([, v]) => v[0] >= 100);
  if (heavyComp.length) add('render', heavyComp[0][1][0] >= 300 ? 'major' : 'minor', `Компоненты перерисовываются слишком часто: ${heavyComp.length}`,
    'Компонент перерисовался сотни раз за время проверки — скорее всего, без изменения данных.',
    'React.memo для компонента, стабильные пропсы (useCallback/useMemo), разделение контекста.',
    heavyComp.map(([n, v]) => `${n} — ${v[0]} перерисовок, ${v[1]} монтирований`));

  // --- предупреждения консоли
  const warns = R.console.filter((c) => c.level === 'warn' || (c.level === 'error' && /^Warning:/.test(c.text)));
  const KNOWN = [
    [/unique "?key"? prop/i, 'major', 'React: у элементов списка нет уникального key', 'Без key React путает элементы списка: сбрасывается ввод, мигают элементы, лишние перерисовки.', 'Добавить стабильный key (id из данных, не индекс массива).'],
    [/unmounted component|Can't perform a React state update/i, 'minor', 'React: обновление состояния после размонтирования', 'Асинхронный код обновляет компонент, которого уже нет — признак утечки подписок или запросов.', 'Отменять запросы/подписки в cleanup-функции useEffect (AbortController).'],
    [/Maximum update depth/i, 'critical', 'React: бесконечный цикл обновлений', 'setState вызывается в цикле — страница может зависнуть.', 'Проверить setState в useEffect без условий и зависимости эффекта.'],
    [/validateDOMNesting/i, 'minor', 'Неверная вложенность HTML', 'Например <div> внутри <p> или <a> внутри <a>: браузер «чинит» разметку, вёрстка и поведение ломаются.', 'Исправить разметку компонента.'],
    [/changing an uncontrolled input|controlled input/i, 'minor', 'React: поле ввода переключается между controlled/uncontrolled', 'Значение поля может «прыгать» или сбрасываться.', 'Задавать value всегда (пустая строка вместо undefined).'],
    [/deprecated/i, 'trivial', 'Используются устаревшие API', 'Устаревшие функции удалят в будущих версиях.', 'Заменить на рекомендуемые аналоги из текста предупреждения.'],
  ];
  const groups = new Map();
  warns.forEach((c) => {
    const first = String(c.text).split('\n')[0];
    const known = KNOWN.find(([re]) => re.test(c.text));
    const key = known ? known[2] : first.replace(/\d+/g, '#').slice(0, 120);
    const g = groups.get(key) || { known, first, n: 0 };
    g.n++; groups.set(key, g);
  });
  groups.forEach((g) => {
    if (g.known) add('console', g.known[1], `${g.known[2]} (×${g.n})`, g.known[3], g.known[4], [short(g.first, 200)], g.n);
    else if (g.n >= 3) add('console', 'trivial', `Повторяющееся предупреждение (×${g.n})`, 'Одно и то же предупреждение в консоли много раз — шум мешает замечать настоящие проблемы.', 'Разобраться с причиной или убрать лишний вывод.', [short(g.first, 200)], g.n);
  });

  // --- производительность (из собранных метрик)
  allFindings().filter((f) => ['slow', 'frames', 'fps', 'vitals', 'shifts', 'memory'].includes(f.cat)).forEach((f) => {
    const why = { slow: 'Интерфейс отвечает на клик или ввод с заметной задержкой.', frames: 'Главный поток браузера был занят дольше 100 мс — страница «замирает».', fps: 'Анимации и прокрутка дёргаются.', vitals: 'Метрика Web Vitals хуже рекомендуемой Google.', shifts: 'Элементы «прыгают» во время загрузки или действий.', memory: 'Память растёт — возможна утечка.' }[f.cat];
    const fix = { slow: 'Разбить тяжёлые обработчики, вынести вычисления из обработчика клика, debounce.', frames: 'Найти тяжёлый скрипт (указан в примере), разбить работу на части, Web Worker.', fps: 'Убрать тяжёлые вычисления из анимаций, анимировать transform/opacity.', vitals: 'См. рекомендации web.dev для этой метрики.', shifts: 'Задать размеры картинкам и блокам заранее, не вставлять контент над видимой областью.', memory: 'Проверить отписку от событий и таймеров, кэши без ограничения.' }[f.cat];
    add('perf', f.level === 'error' ? 'major' : 'minor', f.title, why, fix, [f.plain || stripTags(f.text)], 1);
  });

  // --- данные проверок страниц (axe, изображения, DOM)
  const audits = R.audits || [];
  const rules = new Map();
  audits.forEach((a) => a.a11y.forEach((v) => {
    const r = rules.get(v.id) || { ...v, nodes: [], count: 0, pages: new Set() };
    r.count += v.count; r.pages.add(a.url);
    v.nodes.forEach((n) => r.nodes.length < 8 && r.nodes.push(n));
    rules.set(v.id, r);
  }));
  [...rules.values()].sort((a, b) => sevOf(IMPACT_SEV[b.impact]).rank - sevOf(IMPACT_SEV[a.impact]).rank).forEach((r) =>
    add('a11y', IMPACT_SEV[r.impact] || 'minor', `${(A11Y_RU[r.id] && A11Y_RU[r.id][0]) || r.help} (${r.count} эл.)`,
      (A11Y_RU[r.id] && A11Y_RU[r.id][1]) || `Правило: ${r.description.replace(/^Убедитесь, что /, '')}`,
      `${(A11Y_RU[r.id] && A11Y_RU[r.id][2]) || 'Исправить у элементов из списка ниже.'} Справка с примерами: ${r.helpUrl}`,
      r.nodes.map((n) => `${n.target} — ${short(n.html, 160)}`), r.count));
  const imgs = audits.flatMap((a) => a.images);
  const big = imgs.filter((i) => i.ratio >= 4);
  if (big.length) add('img', 'minor', `Картинки больше, чем нужно для экрана: ${big.length}`, 'Загружается изображение в несколько раз больше, чем показывается — лишний трафик и медленная загрузка.', 'Отдавать уменьшенные версии (srcset, CDN-ресайз), формат WebP/AVIF.',
    big.map((i) => `${shortUrl(i.src)} — файл ${i.natural}, показано ${i.shown} (в ${i.ratio}× больше)${i.bytes ? ', ' + X.fmtSize(i.bytes) : ''}`));
  const heavyImg = imgs.filter((i) => i.bytes > 500000);
  if (heavyImg.length) add('img', 'minor', `Тяжёлые картинки (больше 500 КБ): ${heavyImg.length}`, 'Долгая загрузка страницы, особенно на мобильном интернете.', 'Сжать изображения, WebP/AVIF, lazy-загрузка картинок ниже первого экрана.',
    heavyImg.map((i) => `${shortUrl(i.src)} — ${X.fmtSize(i.bytes)}`));
  const dup = audits.flatMap((a) => a.dom.dupIds || []);
  if (dup.length) add('dom', 'minor', `Повторяющиеся id: ${dup.length}`, 'id должен быть уникальным: ломаются связи label/поле, автотесты и скрипты.', 'Сделать id уникальными или заменить на классы/data-атрибуты.', dup.map((d) => `#${d.id} — ${d.count} раз`));
  const bigDom = audits.filter((a) => a.dom.nodes > 3000);
  if (bigDom.length) add('dom', 'trivial', `Очень большой DOM`, 'Больше 3000 элементов замедляет отрисовку и работу скриптов.', 'Виртуализация длинных списков, ленивая отрисовка скрытых блоков.', bigDom.map((a) => `${shortUrl(a.url)} — ${a.dom.nodes} элементов, глубина ${a.dom.depth}`));

  // ================= 🔎 SEO =================
  const pg = (a) => shortUrl(a.url);
  const A = audits.filter((a) => a.seo);
  const each = (cond, line) => A.filter(cond).map((a) => `${pg(a)}${line ? ' — ' + line(a) : ''}`);
  const closed = A.filter((a) => /noindex/i.test(a.seo.robots || '') || /noindex/i.test(a.seo.xRobots || ''));
  if (closed.length) add('seo', 'critical', `Страница закрыта от поисковиков (noindex): ${closed.length}`,
    'Google и Яндекс не будут показывать эти страницы в поиске. Частая ошибка после релиза: на проде остался noindex со стейджа.',
    'Если страницы должны быть в поиске — убрать noindex из <meta name="robots"> и заголовка X-Robots-Tag.',
    closed.map((a) => `${pg(a)} — ${[a.seo.robots, a.seo.xRobots && 'X-Robots-Tag: ' + a.seo.xRobots].filter(Boolean).join('; ')}`));
  const rtx = A.find((a) => a.seo.robotsTxt && a.seo.robotsTxt.blockAll);
  if (rtx) add('seo', 'critical', 'Весь сайт закрыт в robots.txt', 'В robots.txt для всех роботов стоит «Disallow: /» — поисковики не обходят сайт.',
    'Если сайт должен быть в поиске — убрать «Disallow: /» из группы «User-agent: *».', [new URL(rtx.url).origin + '/robots.txt']);
  const noRt = A.find((a) => a.seo.robotsTxt && !a.seo.robotsTxt.found);
  if (noRt) add('seo', 'trivial', 'Нет robots.txt', 'Поисковики обходят сайт без подсказок: что не индексировать и где карта сайта.', 'Добавить /robots.txt со ссылкой на sitemap.xml.', [new URL(noRt.url).origin + '/robots.txt']);
  else if (A.some((a) => a.seo.robotsTxt && a.seo.robotsTxt.found && !a.seo.robotsTxt.sitemap)) add('seo', 'trivial', 'В robots.txt нет ссылки на карту сайта', 'Карта сайта помогает поисковикам быстрее находить новые страницы.', 'Добавить строку «Sitemap: https://…/sitemap.xml» в robots.txt.', [new URL(A[0].url).origin + '/robots.txt']);
  let x = each((a) => !a.seo.title);
  if (x.length) add('seo', 'major', `Нет заголовка страницы <title>: ${x.length}`, 'Заголовок — это ссылка в результатах поиска и название вкладки. Без него страница почти не получает переходов.', 'Заполнить <title>: суть страницы и название сайта, 30–60 символов.', x);
  x = each((a) => a.seo.title && (a.seo.title.length < 15 || a.seo.title.length > 70), (a) => `${a.seo.title.length} симв.: «${short(a.seo.title, 80)}»`);
  if (x.length) add('seo', 'trivial', `Заголовок <title> слишком короткий или длинный: ${x.length}`, 'Короткий заголовок мало говорит о странице, длинный поисковик обрежет.', 'Оптимально 30–60 символов.', x);
  x = each((a) => !a.seo.description);
  if (x.length) add('seo', 'minor', `Нет описания страницы (meta description): ${x.length}`, 'Поисковик сам выберет кусок текста для сниппета — часто неудачный, и по ссылке кликают реже.', 'Добавить <meta name="description" content="…"> — 70–160 символов о содержании страницы.', x);
  x = each((a) => a.seo.description && (a.seo.description.length < 50 || a.seo.description.length > 170), (a) => `${a.seo.description.length} симв.`);
  if (x.length) add('seo', 'trivial', `Описание страницы слишком короткое или длинное: ${x.length}`, 'Короткое описание неинформативно, длинное обрежется в поиске.', 'Оптимально 70–160 символов.', x);
  const dupBy = (f) => { const m = new Map(); A.forEach((a) => { const v = f(a); if (v) (m.get(v) || m.set(v, []).get(v)).push(a); }); return [...m.entries()].filter(([, l]) => new Set(l.map((a) => a.url.replace(/[?#].*$/, ''))).size > 1); };
  x = dupBy((a) => a.seo.title);
  if (x.length) add('seo', 'minor', `Одинаковые заголовки на разных страницах: ${x.length}`, 'Поисковик не понимает, какая страница главная по запросу, и может показывать не ту.', 'Сделать <title> уникальным для каждой страницы.', x.map(([t, l]) => `«${short(t, 70)}» — ${l.length} стр.: ${l.slice(0, 3).map(pg).join(', ')}`));
  x = dupBy((a) => a.seo.description);
  if (x.length) add('seo', 'trivial', `Одинаковые описания на разных страницах: ${x.length}`, 'Одинаковые сниппеты в поиске выглядят как дубли.', 'Сделать description уникальным для каждой страницы.', x.map(([t, l]) => `«${short(t, 60)}» — ${l.length} стр.`));
  x = each((a) => a.seo.h1.length === 0);
  if (x.length) add('seo', 'minor', `Нет заголовка <h1>: ${x.length}`, 'H1 — главный заголовок страницы: по нему поисковики и читалки понимают, о чём она.', 'Сделать главный заголовок страницы тегом <h1> (один на страницу).', x);
  x = each((a) => a.seo.h1.length > 1, (a) => `${a.seo.h1.length} шт.: ${a.seo.h1.slice(0, 3).map((h) => '«' + short(h, 40) + '»').join(', ')}`);
  if (x.length) add('seo', 'trivial', `Несколько <h1> на странице: ${x.length}`, 'Непонятно, какой заголовок главный.', 'Оставить один <h1>, остальные сделать <h2>.', x);
  x = each((a) => !a.seo.canonical && /^https?:/.test(a.url));
  if (x.length) add('seo', 'trivial', `Нет канонического адреса (canonical): ${x.length}`, 'Одна страница с метками (utm, сортировка, фильтры) выглядит для поисковика как много разных — дубли и потеря позиций.', 'Добавить <link rel="canonical" href="основной адрес страницы">.', x);
  x = each((a) => !a.seo.viewport);
  if (x.length) add('seo', 'major', `Не адаптировано для телефонов (нет meta viewport): ${x.length}`, 'На телефоне страница откроется как уменьшенная десктопная; Google понижает такие страницы в мобильном поиске.', 'Добавить <meta name="viewport" content="width=device-width, initial-scale=1">.', x);
  x = each((a) => !a.seo.og.title || !a.seo.og.image, (a) => ['og:title', 'og:image'].filter((k) => !a.seo.og[k.slice(3)]).join(', '));
  if (x.length) add('seo', 'trivial', `Нет превью для соцсетей и мессенджеров (Open Graph): ${x.length}`, 'Ссылка на страницу в Telegram, WhatsApp, Facebook будет без картинки и с неудачным заголовком.', 'Добавить og:title, og:description, og:image (1200×630).', x);
  if (A.length && A.every((a) => !a.seo.jsonld)) add('seo', 'trivial', 'Нет структурированных данных (schema.org)', 'Без разметки поисковик не покажет расширенный сниппет: цены, рейтинг, хлебные крошки, FAQ.', 'Добавить JSON-LD разметку для типа страницы (Organization, Product, Article, FAQPage…).', A.slice(0, 3).map(pg));
  if (A.length && A.every((a) => !a.seo.favicon)) add('seo', 'trivial', 'Нет иконки сайта (favicon)', 'Во вкладках, закладках и в поиске Google будет пустая иконка.', 'Добавить <link rel="icon" href="/favicon.svg"> или /favicon.ico.', [new URL(A[0].url).origin]);

  // ================= 🏷 семантика и формы =================
  const S2 = audits.filter((a) => a.sem);
  const flat = (f) => S2.flatMap((a) => f(a).map((v) => ({ a, v })));
  x = flat((a) => a.sem.clickable);
  if (x.length) add('sem', 'major', `Кликабельные элементы — не кнопки и не ссылки: ${x.length}`,
    'Блок выглядит кликабельным (курсор-рука), но это <div>/<span>. С клавиатуры до него не дойти, читалка не скажет, что это кнопка, у ссылок не работает «открыть в новой вкладке».',
    'Использовать <button> для действий и <a href> для переходов. Если нельзя — role="button", tabindex="0" и обработка Enter/пробела.',
    x.map(({ a, v }) => `${v.sel}${v.text ? ' «' + v.text + '»' : ''}${v.tab ? '' : ' — недоступен с клавиатуры'} · ${pg(a)}`), x.length);
  x = flat((a) => a.sem.fakeLinks);
  if (x.length) add('sem', 'minor', `Ссылки-заглушки (href="#" или javascript:): ${x.length}`, 'Ссылка, которая на самом деле кнопка: «открыть в новой вкладке» даёт пустую страницу, href="#" прокручивает страницу наверх.', 'Для действий использовать <button>, для переходов — настоящий адрес.',
    x.map(({ a, v }) => `${v.sel}${v.text ? ' «' + v.text + '»' : ''} — ${v.href} · ${pg(a)}`), x.length);
  x = flat((a) => a.sem.formButtons);
  if (x.length) add('sem', 'minor', `В форме несколько кнопок без type: ${x.length}`, 'Кнопка без type внутри формы — это «Отправить». Нажатие на «Добавить», «Показать пароль» и т. п. случайно отправит форму.', 'Указать type="button" у всех кнопок, кроме отправки (type="submit").',
    x.map(({ a, v }) => `${v.sel}: ${v.buttons.map((b) => '«' + b + '»').join(', ')} · ${pg(a)}`));
  x = flat((a) => a.sem.inputTypes);
  if (x.length) add('sem', 'trivial', `Поля email/телефона с type="text": ${x.length}`, 'На телефоне откроется обычная клавиатура вместо удобной (с @ или цифрами), браузер хуже подставляет автозаполнение.', 'Указать type="email" / type="tel" / type="url" и подходящий autocomplete.',
    x.map(({ a, v }) => `${v.sel} → type="${v.want}"${v.hint ? ' («' + v.hint + '»)' : ''} · ${pg(a)}`));

  // ================= ✅ лучшие практики и безопасность =================
  const B = audits.filter((a) => a.best);
  x = B.filter((a) => a.best.passOnHttp).map(pg);
  if (x.length) add('best', 'critical', `Пароль вводится на странице без HTTPS: ${x.length}`, 'Пароль передаётся открытым текстом — его может перехватить любой в той же сети Wi-Fi. Браузер помечает страницу как небезопасную.', 'Перевести сайт на HTTPS (Let\'s Encrypt бесплатно) и включить редирект с http.', x);
  else { x = B.filter((a) => a.best.noHttps).map(pg); if (x.length) add('best', 'major', `Сайт работает без HTTPS: ${x.length}`, 'Браузер показывает «Не защищено», данные можно перехватить, поисковики понижают такие сайты.', 'Перевести сайт на HTTPS и включить редирект с http.', x); }
  x = B.flatMap((a) => a.best.mixed.map((u) => `${u} · ${pg(a)}`));
  if (x.length) add('best', 'major', `Смешанный контент (http на https-странице): ${x.length}`, 'Браузер блокирует такие скрипты и стили или помечает страницу как небезопасную — часть сайта может не работать.', 'Загружать все ресурсы по https://.', x, x.length);
  x = B.flatMap((a) => (a.best.formHttp || []).map((u) => `${u} · ${pg(a)}`));
  if (x.length) add('best', 'major', `Форма отправляет данные по http: ${x.length}`, 'Введённые данные уходят незашифрованными.', 'Указать https:// в action формы.', x);
  x = B.flatMap((a) => a.best.brokenLinks.map((l) => `${shortUrl(l.url)} — ${l.status} · на странице ${pg(a)}`));
  if (x.length) add('best', 'major', `Битые ссылки: ${x.length}`, 'Ссылка ведёт на несуществующую страницу — пользователь видит ошибку, поисковики понижают сайт.', 'Исправить адреса ссылок или настроить редирект.', x, x.length);
  x = B.flatMap((a) => a.best.brokenRes.map((r) => `${shortUrl(r.url)} — ${r.status} (${r.type}) · ${pg(a)}`));
  if (x.length) add('best', 'minor', `Ресурсы не загрузились (4xx/5xx): ${x.length}`, 'Картинки, стили, шрифты или скрипты отвечают ошибкой — что-то на странице не отображается или не работает.', 'Проверить пути к файлам, удалить ссылки на несуществующие ресурсы.', x, x.length);
  const dep = new Map();
  R.events.filter((e) => e.kind === 'deprecation' || e.kind === 'intervention').forEach((e) => { const d = e.detail || {}; const k = d.id || d.message; const g = dep.get(k) || { e, d, n: 0 }; g.n++; dep.set(k, g); });
  if (dep.size) add('best', 'trivial', `Браузер предупреждает об устаревших API: ${dep.size}`, 'Эти возможности удалят из браузера в будущих версиях — код перестанет работать.', 'Заменить на современные аналоги (подробности в тексте предупреждения).',
    [...dep.values()].map((g) => `${short(g.d.message || g.d.id, 180)}${g.d.source ? ' — ' + shortUrl(g.d.source) : ''}${g.d.removal ? ' (удалят ' + new Date(g.d.removal).toLocaleDateString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU')) + ')' : ''}`));
  const hdr = B.find((a) => a.best.headers && /^https:/.test(a.url));
  if (hdr) {
    const h = hdr.best.headers, miss = [];
    if (!h['strict-transport-security']) miss.push('Strict-Transport-Security — браузер всегда будет открывать сайт по HTTPS');
    if (!h['content-security-policy']) miss.push('Content-Security-Policy — защита от внедрения чужих скриптов (XSS)');
    if (!h['x-content-type-options']) miss.push('X-Content-Type-Options: nosniff');
    if (!h['x-frame-options'] && !/frame-ancestors/i.test(h['content-security-policy'] || '')) miss.push('X-Frame-Options или frame-ancestors — защита от встраивания сайта в чужой iframe (кликджекинг)');
    if (!h['referrer-policy']) miss.push('Referrer-Policy — не передавать полный адрес страницы другим сайтам');
    if (miss.length) add('best', miss.length >= 3 ? 'minor' : 'trivial', `Не хватает заголовков безопасности: ${miss.length}`, 'Заголовки ответа сервера, которые включают защиту в браузере. Их проверяют аудиты безопасности и пентесты.', 'Добавить в настройках веб-сервера (nginx, CDN) или фреймворка.', miss);
    const leak = ['server', 'x-powered-by'].filter((k) => h[k] && /\d/.test(h[k])).map((k) => `${k}: ${h[k]}`);
    if (leak.length) add('best', 'trivial', 'Сервер раскрывает версии ПО', 'По точной версии злоумышленнику проще подобрать известную уязвимость.', 'Скрыть версии в заголовках Server и X-Powered-By (nginx: server_tokens off).', leak);
  }

  // ================= ⚡ скорость загрузки =================
  const P = audits.filter((a) => a.perfx);
  x = P.flatMap((a) => a.perfx.blocking.map((r) => `${shortUrl(r.url)} — ${r.ms} мс${r.kb ? ', ' + r.kb + ' КБ' : ''} · ${pg(a)}`));
  if (x.length >= 3) add('perf', 'minor', `Ресурсы блокируют отрисовку: ${x.length}`, 'Пока эти скрипты и стили не загрузятся, браузер показывает белый экран.', 'Скриптам — defer или async; критичный CSS встроить, остальной грузить асинхронно; объединить мелкие файлы.', x, x.length);
  x = P.flatMap((a) => a.perfx.uncompressed.map((r) => `${shortUrl(r.url)} — ${r.kb} КБ без сжатия · ${pg(a)}`));
  if (x.length) add('perf', 'minor', `Файлы отдаются без сжатия: ${x.length}`, 'Текстовые файлы (JS, CSS, HTML, JSON) можно сжать в 3–5 раз — страница загрузится заметно быстрее.', 'Включить gzip или brotli на сервере или CDN.', x, x.length);
  x = P.flatMap((a) => a.perfx.bigJs.map((r) => `${shortUrl(r.url)} — ${r.kb} КБ${r.gz ? ' (по сети ' + r.gz + ' КБ)' : ''} · ${pg(a)}`));
  const jsMax = Math.max(0, ...P.map((a) => a.perfx.jsTotal));
  if (x.length || jsMax > 1500000) add('perf', jsMax > 3000000 ? 'major' : 'minor', `Слишком много JavaScript: до ${X.fmtSize(jsMax)} на странице`, 'Браузер должен скачать, разобрать и выполнить весь этот код — на слабых телефонах страница долго не реагирует.', 'Разделить код по страницам (code splitting, динамический import), убрать неиспользуемые библиотеки, проверить бандл (webpack-bundle-analyzer, source-map-explorer).', x.length ? x : P.map((a) => `${pg(a)} — JS ${X.fmtSize(a.perfx.jsTotal)}`));
  x = P.filter((a) => a.perfx.weight > 3000000).map((a) => `${pg(a)} — ${X.fmtSize(a.perfx.weight)}, ${a.perfx.requests} запросов`);
  if (x.length) add('perf', 'minor', `Тяжёлые страницы (больше 3 МБ): ${x.length}`, 'На мобильном интернете такая страница грузится долго и тратит трафик.', 'Сжать картинки, убрать лишние скрипты и шрифты, ленивая загрузка.', x);
  x = P.filter((a) => a.perfx.requests > 150).map((a) => `${pg(a)} — ${a.perfx.requests} запросов`);
  if (x.length) add('perf', 'trivial', `Очень много запросов при загрузке: ${x.length}`, 'Каждый запрос — накладные расходы; страница загружается дольше.', 'Объединить мелкие файлы, спрайты/иконочные шрифты → SVG-спрайт, убрать лишние сторонние скрипты.', x);
  x = [...new Set(P.flatMap((a) => a.perfx.fonts))];
  if (x.length) add('perf', 'trivial', `Шрифты без font-display: ${x.length}`, 'Пока шрифт грузится, текст невидим (до 3 секунд) — пользователь видит пустую страницу.', 'Добавить font-display: swap в @font-face (для Google Fonts — &display=swap в ссылке).', x);
  x = P.flatMap((a) => a.perfx.lazyFirst.map((u) => `${shortUrl(u)} · ${pg(a)}`));
  if (x.length) add('perf', 'minor', `Картинки первого экрана с loading="lazy": ${x.length}`, 'Главная картинка начинает грузиться позже, чем могла бы, — ухудшается LCP (скорость появления основного контента).', 'Убрать loading="lazy" у картинок первого экрана, главной добавить fetchpriority="high".', x);
  x = P.filter((a) => a.perfx.noLazy >= 5).map((a) => `${pg(a)} — ${a.perfx.noLazy} картинок`);
  if (x.length) add('perf', 'trivial', `Картинки ниже первого экрана грузятся сразу: ${x.length}`, 'Браузер качает картинки, до которых пользователь может и не долистать.', 'Добавить loading="lazy" картинкам ниже первого экрана.', x);
  x = P.flatMap((a) => a.perfx.oldFormat.map((r) => `${shortUrl(r.url)} — ${r.kb} КБ · ${pg(a)}`));
  if (x.length) add('perf', 'trivial', `Тяжёлые JPEG/PNG: ${x.length}`, 'В формате WebP или AVIF та же картинка весит в 2–3 раза меньше.', 'Конвертировать в WebP/AVIF (тег <picture> для старых браузеров).', x);
  x = P.flatMap((a) => a.perfx.noSizeImgs.map((u) => `${shortUrl(u)} · ${pg(a)}`));
  if (x.length) add('perf', 'trivial', `Картинки без размеров: ${x.length}`, 'Пока картинка не загрузилась, место под неё не зарезервировано — текст «прыгает» (CLS).', 'Указать width и height у <img> (или aspect-ratio в CSS).', x);
  x = P.flatMap((a) => a.perfx.cache.map((r) => `${shortUrl(r.url)} — ${r.cc}`));
  if (x.length) add('perf', 'minor', `Статика не кэшируется браузером: ${x.length}`, 'При каждом заходе браузер заново скачивает скрипты, стили и картинки.', 'Отдавать статику с Cache-Control: public, max-age=31536000, immutable (имена файлов с хэшем).', [...new Set(x)]);
  const old = P.find((a) => a.perfx.protocol === 'http/1.1' && /^https:/.test(a.url));
  if (old) add('perf', 'trivial', 'Сервер работает по HTTP/1.1', 'По HTTP/1.1 файлы грузятся по несколько штук за раз; HTTP/2 и HTTP/3 загружают всё параллельно в одном соединении.', 'Включить HTTP/2 (и HTTP/3) на веб-сервере или CDN.', [pg(old)]);
  const tp = new Map();
  P.forEach((a) => a.perfx.thirdParty.forEach((t) => { const g = tp.get(t.host) || { n: 0, kb: 0 }; g.n = Math.max(g.n, t.n); g.kb = Math.max(g.kb, t.kb); tp.set(t.host, g); }));
  const tpKb = [...tp.values()].reduce((s2, t) => s2 + t.kb, 0);
  if (tp.size >= 8 || tpKb > 1000) add('perf', 'trivial', `Много сторонних сервисов: ${tp.size} доменов, ~${Math.round(tpKb)} КБ`, 'Счётчики, чаты, реклама и виджеты замедляют загрузку, и если один из них упадёт — может пострадать весь сайт.', 'Убрать неиспользуемые, остальные грузить отложенно (после загрузки страницы или по действию).',
    [...tp.entries()].sort((p1, p2) => p2[1].kb - p1[1].kb).slice(0, 10).map(([h, t]) => `${h} — ${t.n} запросов, ${t.kb} КБ`));

  return I.sort((a, b) => sevOf(b.sev).rank - sevOf(a.sev).rank);
}

function renderAudit() {
  const all = auditIssues();
  const audits = R.audits || [];
  const cats = {};
  all.forEach((x) => (cats[x.cat] = (cats[x.cat] || 0) + 1));
  const fb = (k, t) => `<button data-f="${k}" class="${auditFilter === k ? 'on' : ''}">${t}</button>`;
  $('#afil').innerHTML = fb('all', `Все (${all.length})`) + Object.keys(AUDIT_CAT).filter((k) => cats[k]).map((k) => fb(k, `${AUDIT_CAT[k]} (${cats[k]})`)).join('');
  $('#afil').querySelectorAll('button').forEach((b) => (b.onclick = () => { auditFilter = b.dataset.f; renderAudit(); }));
  const list = all.filter((x) => auditFilter === 'all' || x.cat === auditFilter);
  const pages = audits.length ? `Проверено страниц: <b>${audits.length}</b> — ${audits.slice(0, 12).map((a) => esc(shortUrl(a.url))).join(', ')}${audits.length > 12 ? '…' : ''}.` : 'Страницы ещё не проверялись — нажмите 🩺 на панели (или включите «Проверять каждую открытую страницу» в настройках).';
  $('#audit-note').innerHTML = `Что улучшить на сайте: SEO, скорость, доступность, семантика, безопасность. Это не баги сценария, а рекомендации. ${pages}`;
  // оценки по направлениям: 100 минус штрафы за находки
  const PEN = { blocker: 30, critical: 25, major: 12, minor: 5, trivial: 1 };
  const SC = [['seo', '🔎 SEO', true], ['perf', '⚡ Скорость', false], ['a11y', '♿ Доступность', true], ['sem', '🏷 Семантика', true], ['best', '✅ Практики и безопасность', true]];
  $('#ascore').innerHTML = SC.filter(([, , needAudit]) => !needAudit || audits.length).map(([k, t]) => {
    const v = Math.max(0, 100 - all.filter((x) => x.cat === k).reduce((acc, x) => acc + (PEN[x.sev] || 1), 0));
    const c = v >= 90 ? 'good' : v >= 60 ? 'mid' : 'bad';
    return `<button class="sc sc-${c}${auditFilter === k ? ' on' : ''}" data-f="${k}"><b>${v}</b><span>${t}</span></button>`;
  }).join('');
  $('#ascore').querySelectorAll('button').forEach((b) => (b.onclick = () => { auditFilter = auditFilter === b.dataset.f ? 'all' : b.dataset.f; renderAudit(); }));
  $('#audit').innerHTML = list.length
    ? list.map((x) => `<details class="aud"><summary><span class="sevb s-${x.sev}">${sevLabel(x.sev)}</span><span class="acat">${AUDIT_CAT[x.cat]}</span><b>${esc(x.title)}</b></summary>
        <div class="aud-b"><p><b>Почему это плохо:</b> ${esc(x.why)}</p><p><b>Как исправить:</b> ${esc(x.fix).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')}</p>
        ${x.examples.length ? `<div class="fl">Примеры</div><ul>${x.examples.map((e) => `<li class="mono">${esc(e)}</li>`).join('')}</ul>` : ''}</div></details>`).join('')
    : `<div class="card muted">${all.length ? 'Нет находок в этой категории.' : 'Автопроверка проблем не нашла 👍'}</div>`;
}

/** модель автопроверки для выгрузки */
function auditModel() {
  return auditIssues().map((x) => ({ cat: AUDIT_CAT[x.cat], sev: x.sev, sevLabel: sevLabel(x.sev), title: x.title, why: x.why, fix: x.fix, examples: x.examples }));
}

/** понятные формулировки для частых правил доступности: [заголовок, почему плохо, как исправить] */
const A11Y_RU = {
  'color-contrast': ['Низкий контраст текста', 'Текст плохо читается на этом фоне: людям со слабым зрением, на ярком солнце или на дешёвом мониторе. Нужно соотношение не меньше 4.5:1 (для крупного текста — 3:1).', 'Сделать текст темнее или фон светлее (или наоборот). Проверить можно в DevTools: кликнуть на цвет текста в Styles — Chrome покажет контраст.'],
  'landmark-one-main': ['Нет основной области <main>', 'Экранные читалки не могут быстро перейти к основному содержимому — человеку приходится слушать всё меню заново на каждой странице.', 'Обернуть основное содержимое страницы (всё, кроме шапки и подвала) в один <main>.'],
  region: ['Содержимое вне ориентиров', 'Часть страницы не находится ни в <header>, <nav>, <main>, <footer>, ни в другом ориентире — пользователь читалки может её пропустить.', 'Поместить блоки внутрь <main> (или <header>/<footer>/<nav>/<aside>).'],
  'image-alt': ['Картинки без описания (alt)', 'Незрячий пользователь не узнает, что на картинке; если картинка — ссылка или кнопка, он не поймёт, куда она ведёт.', 'Добавить alt с описанием; для декоративных картинок — пустой alt="".'],
  'button-name': ['Кнопки без названия', 'Кнопка без текста (например, только иконка) читается как «кнопка» — непонятно, что она делает.', 'Добавить текст внутри или aria-label="…" с действием кнопки.'],
  'link-name': ['Ссылки без текста', 'Ссылка-иконка без текста читается как «ссылка» — непонятно, куда ведёт.', 'Добавить текст или aria-label="…".'],
  label: ['Поля формы без подписи', 'Пользователь читалки не узнает, что вводить в поле; плейсхолдер подписью не считается.', 'Связать поле с <label for="…"> или добавить aria-label.'],
  'html-has-lang': ['Не указан язык страницы', 'Читалка прочитает русский текст английским произношением.', 'Добавить lang="ru" в тег <html>.'],
  'document-title': ['Нет заголовка страницы', 'Вкладку и страницу невозможно опознать в списке вкладок, истории и читалке.', 'Заполнить <title>.'],
  'heading-order': ['Нарушен порядок заголовков', 'Заголовки идут с пропуском уровня (например, h2 → h4): по ним сложно ориентироваться читалкой.', 'Использовать уровни заголовков по порядку, внешний вид менять через CSS.'],
  'page-has-heading-one': ['Нет заголовка первого уровня', 'На странице нет <h1> — по заголовкам непонятно, о чём страница.', 'Сделать главный заголовок страницы тегом <h1>.'],
  'duplicate-id': ['Повторяющиеся id', 'Несколько элементов с одним id: ломаются подписи полей, ссылки-якоря и скрипты.', 'Сделать id уникальными.'],
  'aria-hidden-focus': ['Скрытые элементы получают фокус', 'Элемент скрыт от читалки (aria-hidden), но на него можно перейти табом — пользователь попадает «в пустоту».', 'Убрать aria-hidden или запретить фокус (tabindex="-1", inert).'],
  'nested-interactive': ['Вложенные интерактивные элементы', 'Кнопка внутри ссылки (или наоборот): непонятно, что сработает при нажатии, читалка объявляет неправильно.', 'Разнести элементы, не вкладывать одну кнопку/ссылку в другую.'],
  'list': ['Неправильная разметка списка', 'Внутри <ul>/<ol> есть элементы, кроме <li> — читалка неверно считает пункты.', 'Внутри списков использовать только <li>.'],
  'listitem': ['<li> вне списка', 'Пункт списка вне <ul>/<ol> — читалка не понимает, что это список.', 'Обернуть пункты в <ul> или <ol>.'],
  'meta-viewport': ['Запрещено масштабирование на телефоне', 'Пользователь не может увеличить мелкий текст пальцами.', 'Убрать user-scalable=no и maximum-scale из meta viewport.'],
  'frame-title': ['Фреймы без названия', 'Читалка объявляет iframe без пояснения, что внутри.', 'Добавить title к <iframe>.'],
  'target-size': ['Слишком маленькие кнопки и ссылки', 'В элемент меньше 24×24 px сложно попасть пальцем на телефоне — пользователь промахивается и нажимает соседнее.', 'Увеличить область нажатия (padding) до 24×24 px, лучше 44×44, или раздвинуть элементы.'],
  'empty-heading': ['Пустые заголовки', 'Заголовок без текста: читалка объявляет пустой заголовок, структура страницы ломается.', 'Удалить пустой заголовок или заменить на элемент без смысловой роли.'],
  'select-name': ['Выпадающие списки без подписи', 'Непонятно, что выбирать в списке.', 'Связать <select> с <label> или добавить aria-label.'],
};

// ================= экспорт =================
const baseName = () => {
  const d = new Date(R.startTime);
  const p = (n) => String(n).padStart(2, '0');
  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
  const slug = (R.fields.title || '')
    .toLowerCase()
    .replace(/./g, (c) => (c in TR ? TR[c] : c))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `bug_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}${slug ? '_' + slug : ''}`;
};
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const blobToDataUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer());

function consoleTxt(m) {
  return m.console.map((c) => `[${X.fmtRel(c.rel)}] ${c.level.toUpperCase()} ${c.text}${c.loc ? '  @ ' + c.loc : ''}`).join('\n');
}
async function mediaFiles(m) {
  const files = [];
  for (const it of m.items) {
    if (it.kind === 'recording' && mediaBlobs[it.videoKey]) files.push({ name: it.file, data: await blobBytes(mediaBlobs[it.videoKey]) });
    for (const v of it.voice || []) if (mediaBlobs[v.key]) files.push({ name: v.file, data: await blobBytes(mediaBlobs[v.key]) });
  }
  for (const v of m.voice) if (mediaBlobs[v.key]) files.push({ name: v.file, data: await blobBytes(mediaBlobs[v.key]) });
  return files.filter((f, i, arr) => arr.findIndex((x) => x.name === f.name) === i);
}
async function embedMedia(m) {
  const media = {};
  for (const it of m.items) {
    if (it.kind === 'recording' && mediaBlobs[it.videoKey]) media[it.file] = await blobToDataUrl(mediaBlobs[it.videoKey]);
    for (const v of it.voice || []) if (mediaBlobs[v.key]) media[v.file] = await blobToDataUrl(mediaBlobs[v.key]);
  }
  for (const v of m.voice) media[v.file] = await blobToDataUrl(mediaBlobs[v.key]);
  return media;
}
const shotFiles = (m) => m.items.filter((it) => it.bytes).map((it) => ({ name: it.file, data: it.bytes }));

async function doExport(kind, only) {
  const st = $('#ex-status');
  const btns = document.querySelectorAll('[data-ex]');
  btns.forEach((b) => (b.disabled = true));
  st.textContent = 'Готовлю файл…';
  try {
    const o = opts();
    const m = await buildModel(o, only);
    if (!m.items.length && !m.appendix && !m.audit.length) { st.textContent = 'Нечего выгружать: нет пунктов выбранных видов. Отметьте их в «⚙ Что включать в отчёт».'; return; }
    const base = baseName() + (only === 'audit' ? '_avtoproverka' : only ? '_' + ({ r: 'zamechanie', e: 'oshibka', v: 'zapis' }[only[0]]) + '-' + only.slice(1) : '');
    const hasMedia = m.items.some((it) => it.kind === 'recording' || (it.voice || []).length) || m.voice.length;
    if (kind === 'docx') {
      if (hasMedia) {
        const files = [{ name: 'report.docx', data: await blobBytes(X.exportDOCX(m)) }, ...(await mediaFiles(m))];
        download(QAZip.makeZip(files), base + '_word.zip');
        st.textContent = 'Готово: архив с Word и видео/голосом (в .docx видео не встраивается)';
      } else {
        download(X.exportDOCX(m), base + '.docx');
        st.textContent = 'Готово: ' + base + '.docx';
      }
    } else if (kind === 'md') {
      const files = [{ name: 'report.md', data: X.exportMarkdown(m) }, ...shotFiles(m), ...(await mediaFiles(m))];
      if (m.network.length) files.push({ name: 'network.har', data: JSON.stringify(X.exportHAR(m), null, 2) });
      if (m.console.length) files.push({ name: 'console.log', data: consoleTxt(m) });
      download(QAZip.makeZip(files), base + '_markdown.zip');
      st.textContent = 'Готово: report.md + скриншоты' + (hasMedia ? ', медиа' : '') + (m.network.length ? ' и HAR' : '') + ' в архиве';
    } else if (kind === 'html') {
      const media = o.embed ? await embedMedia(m) : {};
      download(new Blob([X.exportHTML(m, media)], { type: 'text/html' }), base + '.html');
      st.textContent = 'Готово: один HTML-файл' + (Object.keys(media).length ? ' со встроенным видео/голосом' : '');
    } else if (kind === 'gdocs') {
      const gd = await QAInt.getGD();
      if (!gd.clientId) {
        const html = X.exportHTML(m, {});
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([X.exportMarkdown(m)], { type: 'text/plain' }) })]);
        chrome.tabs.create({ url: 'https://docs.new' });
        st.innerHTML = '✓ Отчёт скопирован и открыт новый Google-документ — нажмите в нём <b>Ctrl+V</b>' + (hasMedia ? ' (видео и голос так не переносятся)' : '') + '. <a href="settings.html#gd" target="_blank">Настроить выгрузку в один клик →</a>';
        return;
      }
      st.textContent = 'Вход в Google…';
      await QAInt.googleToken(true);
      const parent = await QAInt.folderId();
      const up = async (blob, file) => (await QAInt.upload(blob, `${base}_${file.split('/').pop()}`, { parent })).webViewLink;
      let k = 0;
      for (const it of m.items) {
        if (it.kind === 'recording' && mediaBlobs[it.videoKey]) { st.textContent = `Загружаю видео ${++k}…`; it.link = await up(mediaBlobs[it.videoKey], it.file); }
        for (const v of it.voice || []) if (mediaBlobs[v.key]) { st.textContent = `Загружаю голос ${++k}…`; v.link = await up(mediaBlobs[v.key], v.file); }
      }
      for (const v of m.voice) if (mediaBlobs[v.key]) { st.textContent = `Загружаю голос ${++k}…`; v.link = await up(mediaBlobs[v.key], v.file); }
      st.textContent = 'Создаю документ…';
      const doc = await QAInt.upload(X.exportDOCX(m), base, { convert: true, parent });
      chrome.tabs.create({ url: doc.webViewLink });
      st.innerHTML = `✓ Готово: <a href="${esc(doc.webViewLink)}" target="_blank">${esc(doc.name)}</a> в папке «QA Bug Recorder» на Google Диске${k ? ' · видео и голос загружены рядом, ссылки в документе' : ''}`;
    } else if (kind === 'har') {
      const full = await buildModel({ ...o, appendix: true, network: 'all', details: true });
      download(new Blob([JSON.stringify(X.exportHAR(full), null, 2)], { type: 'application/json' }), base + '.har');
      st.textContent = 'Готово: HAR открывается в DevTools → Network → Import';
    } else if (kind === 'all') {
      const files = [
        { name: 'report.docx', data: await blobBytes(X.exportDOCX(m)) },
        { name: 'report.html', data: X.exportHTML(m, {}) },
        { name: 'report.md', data: X.exportMarkdown(m) },
        ...shotFiles(m),
        ...(await mediaFiles(m)),
      ];
      const full = await buildModel({ ...o, appendix: true, network: 'all', details: true, console: 'all' });
      files.push({ name: 'network.har', data: JSON.stringify(X.exportHAR(full), null, 2) });
      files.push({ name: 'console.log', data: consoleTxt(full) });
      download(QAZip.makeZip(files), base + '.zip');
      st.textContent = 'Готово: Word + HTML + Markdown + скриншоты + медиа + HAR';
    }
  } catch (e) {
    console.error(e);
    st.textContent = 'Ошибка экспорта: ' + e.message;
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// ================= отрисовка =================
function renderAll() {
  const f = R.fields;
  $('#f-title').value = f.title;
  $('#f-priority').value = f.priority || '';
  $('#f-steps').value = f.steps;
  $('#f-expected').value = f.expected;
  $('#f-actual').value = f.actual;
  $('#f-notes').value = f.notes || '';
  $('#created').textContent = 'Проверка ' + new Date(R.startTime).toLocaleString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU')) + ' · ' + short(R.meta.startUrl, 80);
  document.title = (f.title || 'Отчёт о проверке') + ' — QA Bug Recorder';

  const warns = [];
  if (R.active) warns.push('Проверка ещё идёт. Нажмите «✓ Готово» на панели на странице, затем обновите отчёт.');
  if (R.meta.truncated) warns.push('Часть записей не сохранена: превышен лимит объёма.');
  if (R.meta.cdpError) warns.push('Полный захват сети не включился: ' + R.meta.cdpError);
  [...R.videos, ...R.voice].filter((v) => v.error).forEach((v) => warns.push('Ошибка записи: ' + v.error));
  $('#banner').hidden = !warns.length;
  $('#banner').innerHTML = warns.map(esc).join('<br>');

  renderMedia();
  renderAISummary();
  renderItems();
  renderAudit();
  renderSummary();
  renderTab();
  $('#t-timeline').textContent = timelineItems('important').length;
  const pf = findings().filter((f) => f.tab === 'perf' && f.level !== 'ok').length;
  $('#t-perf').textContent = pf ? pf + ' пробл.' : '✓';
  $('#t-perf').className = 'pill' + (pf ? ' bad' : '');
  ['actions', 'console', 'network'].forEach((k) => {
    const n = k === 'actions' ? timeline().length : k === 'network' ? allNet().length : R[k].length;
    const bad = k === 'console' ? R.console.filter((c) => c.level === 'error').length : k === 'network' ? allNet().filter(netErr).length : 0;
    $('#t-' + k).textContent = bad ? `${n} · ${bad} ош.` : n;
    $('#t-' + k).className = 'pill' + (bad ? ' bad' : '');
  });
}

function renderMedia() {
  const items = [];
  for (const v of []) {
    const b = mediaBlobs[v.key];
    if (!b) continue;
    items.push(`<div class="card"><div class="lbl">Видео ${v.n} · ${X.fmtDur((v.end || Date.now()) - v.start)} · ${X.fmtSize(b.size)} <button class="link" data-dl="${v.key}" data-name="video-${v.n}.webm">⬇ скачать</button></div><video controls preload="metadata" data-key="${v.key}" data-start="${v.start}"></video></div>`);
  }
  for (const v of R.voice) {
    const b = mediaBlobs[v.key];
    if (!b) continue;
    if (R.annotations.some((a) => voiceFor(a).includes(v))) continue; // голос показан в замечании
    items.push(`<div class="card"><div class="lbl">🎤 Голос ${v.n} · ${X.fmtRel(v.start - R.startTime)} · ${X.fmtDur((v.end || Date.now()) - v.start)} <button class="link" data-dl="${v.key}" data-name="voice-${v.n}.webm">⬇ скачать</button></div><audio controls data-key="${v.key}"></audio></div>`);
  }
  $('#media-sec').hidden = !items.length;
  $('#media').innerHTML = items.join('');
  $('#media').querySelectorAll('video,audio').forEach((el) => {
    el.src = URL.createObjectURL(mediaBlobs[el.dataset.key]);
    // у WebM из MediaRecorder нет длительности — «прокручиваем» один раз, чтобы работала перемотка
    el.addEventListener('loadedmetadata', function fix() {
      el.removeEventListener('loadedmetadata', fix);
      if (el.duration === Infinity) {
        el.currentTime = 1e101;
        el.addEventListener('timeupdate', function back() { el.removeEventListener('timeupdate', back); el.currentTime = 0; });
      }
    });
  });
  $('#media').querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => download(mediaBlobs[b.dataset.dl], baseName() + '_' + b.dataset.name)));
}

function seekTo(ts) {
  const vids = [...document.querySelectorAll('video[data-start]')];
  const v = vids.find((el) => {
    const rec = R.videos.find((x) => x.key === el.dataset.key);
    return rec && ts >= rec.start && ts <= (rec.end || Infinity);
  });
  if (!v) return false;
  v.currentTime = Math.max(0, (ts - +v.dataset.start) / 1000 - 2);
  v.scrollIntoView({ behavior: 'smooth', block: 'center' });
  v.play().catch(() => {});
  return true;
}

function relCell(ts) { return `<td class="mono">${X.fmtRel(ts - R.startTime)}</td>`; }
function dividerRow(cols) { return `<tr class="divider"><td colspan="${cols}">▼ начало проверки</td></tr>`; }

function withDivider(list, cols, rowFn) {
  let out = '', placed = false;
  for (const e of list) {
    if (!placed && e.ts >= R.startTime) { out += dividerRow(cols); placed = true; }
    out += rowFn(e);
  }
  if (!placed && list.length) out += dividerRow(cols);
  return out;
}

function renderTab() {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const q = $('#search').value.trim().toLowerCase();
  const match = (...parts) => !q || parts.some((p) => String(p || '').toLowerCase().includes(q));
  const body = $('#tabbody');

  if (tab === 'actions') {
    const list = timeline().filter((a) => match(a.url, a.text, a.label, a.value, a.selector));
    body.innerHTML = `<div class="tf"><span class="muted">Клики, ввод и переходы. «−» — до начала проверки. Пароли не сохраняются.</span></div>` + (list.length
      ? `<table><tr><th style="width:80px">Время</th><th>Действие</th><th style="width:34%">Элемент / страница</th></tr>${withDivider(list, 3, (a) =>
          `<tr class="${a.ts < R.startTime ? 'before' : ''}">${relCell(a.ts)}<td>${esc(a.kind === 'nav' ? 'Переход: ' + a.url : X.describeAction(a))}</td><td class="u mono">${esc(a.kind === 'nav' ? a.title || '' : a.selector || '')}</td></tr>`)}</table>`
      : '<div class="zero">Действий нет. Сбор идёт с момента загрузки страницы после установки расширения.</div>');
  } else if (tab === 'console') {
    const lv = filters.console;
    const list = R.console.filter((c) => (lv === 'all' || (lv === 'warn' ? ['warn', 'error'].includes(c.level) : c.level === lv)) && match(c.text, c.loc, c.source));
    body.innerHTML =
      `<div class="tf">${[['all', 'Все'], ['error', 'Ошибки'], ['warn', 'Предупр. и ошибки'], ['log', 'Лог'], ['info', 'Инфо']].map(([k, t]) => `<button data-f="${k}" class="${lv === k ? 'on' : ''}">${t}</button>`).join('')}</div>` +
      (list.length
        ? `<table><tr><th style="width:80px">Время</th><th style="width:90px">Уровень</th><th>Сообщение</th><th style="width:24%">Источник</th></tr>${withDivider(list, 4, (c) =>
            `<tr class="${c.level === 'error' ? 'err' : c.level === 'warn' ? 'warn' : ''} ${c.ts < R.startTime ? 'before' : ''}">${relCell(c.ts)}<td>${X.LEVEL_RU[c.level] || c.level}</td><td class="mono msg">${esc(short(c.text, 4000))}</td><td class="u mono">${esc(c.loc || c.source || '')}</td></tr>`)}</table>`
        : '<div class="zero">Нет записей</div>');
    body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filters.console = b.dataset.f; renderTab(); }));
  } else if (tab === 'network') {
    const fm = filters.network;
    const list = allNet().filter((e) => (fm === 'all' || (fm === 'api' ? ['XHR', 'Fetch'].includes(e.type) : fm === 'res' ? e.source === 'perf' : netErr(e))) && match(e.url, e.method, e.status, e.body));
    body.innerHTML =
      `<div class="tf">${[['all', 'Все'], ['api', 'XHR / Fetch'], ['res', 'Ресурсы (картинки, скрипты, стили)'], ['errors', 'Ошибки 4xx/5xx/сбои']].map(([k, t]) => `<button data-f="${k}" class="${fm === k ? 'on' : ''}">${t}</button>`).join('')}<span class="muted" style="margin-left:auto">Клик по строке — заголовки и тело</span></div>` +
      (list.length
        ? `<table><tr><th style="width:80px">Время</th><th style="width:60px">Метод</th><th style="width:64px">Статус</th><th style="width:60px">Тип</th><th>URL</th><th style="width:80px">Время отв.</th><th style="width:70px">Размер</th></tr>${withDivider(list, 7, (e) =>
            `<tr class="click ${netErr(e) ? 'err' : ''} ${e.ts < R.startTime ? 'before' : ''}" data-id="${esc(e.id)}">${relCell(e.ts)}<td>${esc(e.method)}</td><td><b>${esc(X.statusLabel(e))}</b></td><td>${esc(e.type || '')}</td><td class="u mono">${esc(short(e.url, 260))}${e.error ? '<br>' + esc(e.error) : ''}</td><td>${X.fmtDur(e.duration)}</td><td>${X.fmtSize(e.size)}</td></tr>`)}</table>`
        : '<div class="zero">Нет запросов</div>');
    body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filters.network = b.dataset.f; renderTab(); }));
    body.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = () => {
      if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('det')) { tr.nextElementSibling.remove(); return; }
      const e = allNet().find((x) => x.id === tr.dataset.id);
      const h = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
      const d = document.createElement('tr');
      d.className = 'det';
      d.innerHTML = `<td colspan="7"><div class="dlbl">URL</div><pre>${esc(e.url)}</pre>
        ${e.reqHeaders && Object.keys(e.reqHeaders).length ? `<div class="dlbl">Заголовки запроса</div><pre>${esc(h(e.reqHeaders))}</pre>` : ''}
        ${e.postData ? `<div class="dlbl">Тело запроса</div><pre>${esc(e.postData)}</pre>` : ''}
        ${e.resHeaders ? `<div class="dlbl">Заголовки ответа</div><pre>${esc(h(e.resHeaders))}</pre>` : ''}
        ${e.body ? `<div class="dlbl">Ответ</div><pre>${esc(e.body)}</pre>` : ''}</td>`;
      tr.after(d);
    }));
  } else if (tab === 'timeline') {
    renderTimeline(body, match);
  } else if (tab === 'perf') {
    renderPerf(body);
  } else if (tab === 'storage') {
    renderStorage(body, match);
  } else {
    body.innerHTML = `<div class="tf"><span class="muted">Окружение определено автоматически</span></div><table>${env().map(([k, v]) => `<tr><th style="width:230px;position:static">${esc(k)}</th><td class="u">${esc(v)}</td></tr>`).join('')}</table>`;
  }
}

// ================= аналитика: таймлайн, производительность, находки =================
const CAT_RU = { action: 'Действие', nav: 'Переход', mark: 'Пометка', console: 'Консоль', net: 'Сеть', dom: 'DOM', render: 'React', perf: 'Производит.', user: 'Страница', ws: 'WebSocket', storage: 'Хранилище' };
const stripTags = (h) => String(h).replace(/<[^>]+>/g, '');
const allNet = () => [...R.network, ...R.resources].sort((a, b) => a.ts - b.ts);
const noise = (e) => /\/favicon\.ico(\?|$)/.test(e.url || '');
const IMPORTANT_KINDS = new Set(['dialog', 'invalid', 'appeared', 'navigation', 'open', 'close', 'clear', 'network']);
const isImportantEvent = (e) => e.kind !== 'vital' && (e.level === 'warn' || e.level === 'error' || IMPORTANT_KINDS.has(e.kind));

function eventSub(e) {
  const d = e.detail || {};
  if (e.kind === 'long-frame' && d.scripts && d.scripts.length) return d.scripts.map((x) => `${x.duration} мс · ${x.src}${x.invoker ? ' (' + x.invoker + ')' : ''}`).join('\n');
  if (e.kind === 'slow-interaction' && d.processing != null) return `худший случай: задержка ввода ${d.input} мс · обработчик ${d.processing} мс · отрисовка ${d.presentation} мс`;
  if (e.kind === 'messages' && (d.lastIn || d.lastOut)) return (d.lastIn ? '↓ ' + d.lastIn : '') + (d.lastIn && d.lastOut ? '\n' : '') + (d.lastOut ? '↑ ' + d.lastOut : '');
  if (e.kind === 'mutations' && d.top && d.top.length) return d.top.map((t) => `${t.selector} — ${t.count}`).join('\n');
  if (e.kind === 'rerender') return [...(d.recreated || []).map((t) => `пересоздано: ${t.selector} — ${t.count}`), ...(d.noop || []).map((t) => `пустые обновления: ${t.selector} — ${t.count}`)].join('\n');
  if (e.kind === 'react' && d.components) return Object.entries(d.components).slice(0, 8).map(([n, v]) => `${n} ×${v[0] + v[1]}${v[1] ? ` (новых ${v[1]})` : ''}`).join(', ');
  return '';
}

/** mode: important | all | <категория> | important-events | all-events */
function timelineItems(mode) {
  const out = [];
  const eventsOnly = mode === 'important-events' || mode === 'all-events';
  if (!eventsOnly) {
    R.actions.forEach((a) => out.push({ ts: a.ts, cat: 'action', level: 'info', text: X.describeAction(a), sub: a.selector || '' }));
    R.nav.filter((n) => /^(https?|file):/.test(n.url)).forEach((n) => out.push({ ts: n.ts, cat: 'nav', level: 'info', text: 'Переход: ' + n.url }));
    R.annotations.forEach((a) => out.push({ ts: a.ts, cat: 'mark', level: 'mark', text: `Пометка #${a.n}: ${a.comment || '(без комментария)'}`, sub: a.element ? a.element.selector : '' }));
    R.console.forEach((c) => out.push({ ts: c.ts, cat: 'console', level: c.level === 'error' ? 'error' : c.level === 'warn' ? 'warn' : 'info', text: short(c.text, 400), sub: c.loc || '', imp: c.level === 'error' || c.level === 'warn' }));
    allNet().forEach((e) => out.push({
      ts: e.ts, cat: 'net', level: netErr(e) ? 'error' : 'info',
      text: `${e.method} ${X.statusLabel(e)} ${short(e.url, 160)}${e.duration != null ? ` · ${X.fmtDur(e.duration)}` : ''}`,
      sub: e.error || '', imp: !noise(e) && (netErr(e) || ['XHR', 'Fetch'].includes(e.type)),
    }));
  }
  R.events.forEach((e) => {
    if (e.kind === 'vital') return;
    out.push({ ts: e.ts, cat: e.cat, level: e.level || 'info', text: e.text, sub: eventSub(e), imp: isImportantEvent(e) });
  });
  let res = out;
  if (mode === 'important' || mode === 'important-events') res = out.filter((x) => x.imp || ['action', 'nav', 'mark'].includes(x.cat));
  else if (CAT_RU[mode]) res = out.filter((x) => x.cat === mode || (mode === 'action' && x.cat === 'nav'));
  return res.sort((a, b) => a.ts - b.ts);
}

function renderTimeline(body, match) {
  const f = filters.timeline;
  const list = timelineItems(f).filter((x) => match(x.text, x.sub));
  const btn = (k, t) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${t}</button>`;
  body.innerHTML =
    `<div class="tf">${btn('important', 'Важное')}${btn('all', 'Всё')}<span class="sep"></span>${['action', 'net', 'console', 'dom', 'render', 'perf', 'user', 'ws', 'storage'].map((k) => btn(k, CAT_RU[k])).join('')}</div>` +
    (list.length
      ? `<table><tr><th style="width:80px">Время</th><th style="width:105px">Тип</th><th>Что произошло</th></tr>${withDivider(list, 3, (x) =>
          `<tr class="${x.cat === 'mark' ? 'mark' : x.level === 'error' ? 'ev-err' : x.level === 'warn' ? 'ev-warn' : ''} ${x.ts < R.startTime ? 'before' : ''}">${relCell(x.ts)}<td><span class="cat cat-${x.cat}">${CAT_RU[x.cat] || x.cat}</span></td><td>${x.level === 'error' ? '🔴 ' : x.level === 'warn' ? '🟡 ' : ''}${esc(x.text)}${x.sub ? `<span class="sub">${esc(x.sub)}</span>` : ''}</td></tr>`)}</table>`
      : '<div class="zero">Событий нет. Обновите страницу после установки или обновления расширения — сбор начинается с загрузки.</div>');
  body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filters.timeline = b.dataset.f; renderTab(); }));
}

// ---------- Web Vitals ----------
const VITALS = [
  ['LCP', 'Отрисовка главного контента', 2500, 4000],
  ['INP', 'Отклик на действия', 200, 500],
  ['CLS', 'Сдвиги макета', 0.1, 0.25],
  ['FCP', 'Первая отрисовка', 1800, 3000],
  ['TTFB', 'Ответ сервера', 800, 1800],
];
function vitalsOf() {
  const last = {};
  R.events.filter((e) => e.kind === 'vital').forEach((e) => (last[e.name] = e));
  return VITALS.map(([name, title, good, poor]) => {
    const e = last[name];
    if (!e) return { name, title, value: null };
    const v = e.value;
    const rating = v <= good ? 'good' : v <= poor ? 'ni' : 'poor';
    return { name, title, value: v, fmt: name === 'CLS' ? v.toFixed(3) : v >= 1000 ? (v / 1000).toFixed(2).replace('.', ',') + ' с' : Math.round(v) + ' мс', rating, ratingRu: { good: 'Хорошо', ni: 'Можно лучше', poor: 'Плохо' }[rating], selector: e.selector || '', page: e.page };
  });
}
function rendersAgg() {
  const map = new Map();
  let commits = 0, busy = 0;
  R.events.filter((e) => e.cat === 'render').forEach((e) => {
    const d = e.detail || {};
    commits += d.commits || 0;
    if (e.level === 'warn') busy++;
    Object.entries(d.components || {}).forEach(([n, v]) => {
      const s = map.get(n) || [0, 0];
      s[0] += v[0]; s[1] += v[1];
      map.set(n, s);
    });
  });
  return { commits, busy, list: [...map.entries()].sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1])) };
}
const evOf = (kind) => R.events.filter((e) => e.kind === kind);
/** перерисовки на уровне DOM — работает для любого сайта */
function domAgg() {
  const map = new Map();
  const get = (sel) => map.get(sel) || (map.set(sel, { selector: sel, recreated: 0, noop: 0, changes: 0, secs: 0 }), map.get(sel));
  evOf('rerender').forEach((e) => {
    const d = e.detail || {};
    (d.recreated || []).forEach((t) => (get(t.selector).recreated += t.count));
    (d.noop || []).forEach((t) => (get(t.selector).noop += t.count));
  });
  evOf('mutations').forEach((e) => ((e.detail && e.detail.top) || []).forEach((t) => { const g = get(t.selector); g.changes += t.count; g.secs++; }));
  const list = [...map.values()];
  return {
    list,
    recreated: list.reduce((a, b) => a + b.recreated, 0),
    noop: list.reduce((a, b) => a + b.noop, 0),
  };
}

function allFindings() {
  const F = [];
  const add = (cat, level, title, text, tab, filter, plain) => F.push({ cat, level, title, text, tab, filter, plain });
  const errs = R.console.filter((c) => c.level === 'error' && c.source !== 'resource');
  if (errs.length) add('js', 'error', `Ошибки JavaScript: ${errs.length}`, `<code>${esc(short(errs[errs.length - 1].text.split('\n')[0], 140))}</code>`, 'console', 'error', short(errs[errs.length - 1].text.split('\n')[0], 140));
  const nerr = allNet().filter((e) => netErr(e) && !noise(e));
  const apiErr = nerr.filter((e) => e.source !== 'perf' && !['Image', 'Script', 'Stylesheet', 'Font', 'Media'].includes(e.type));
  const resErr = nerr.filter((e) => !apiErr.includes(e));
  const pth = (e) => { let p = e.url; try { p = new URL(e.url).pathname; } catch (_) {} return p; };
  if (apiErr.length) {
    const t = apiErr.slice(-3).map((e) => `${e.method} ${X.statusLabel(e)} ${short(pth(e), 50)}`);
    add('requests', 'error', `Ошибки запросов: ${apiErr.length}`, t.map((x) => `<code>${esc(x)}</code>`).join('<br>'), 'network', 'errors', t.join('; '));
  }
  const resCon = R.console.filter((c) => c.source === 'resource');
  if (resErr.length || resCon.length) {
    const t = resErr.length ? resErr.slice(-3).map((e) => `${X.statusLabel(e)} ${short(pth(e), 60)}`) : resCon.slice(-3).map((c) => short(c.loc || c.text, 70));
    add('resources', 'error', `Не загрузились картинки, шрифты или стили: ${Math.max(resErr.length, resCon.length)}`, t.map((x) => `<code>${esc(x)}</code>`).join('<br>'), 'network', 'errors', t.join('; '));
  }
  const appeared = evOf('appeared').filter((e) => e.level === 'error');
  if (appeared.length) add('appeared', 'error', 'Сообщения об ошибке на странице', esc(short(appeared[appeared.length - 1].text, 160)), 'timeline', 'dom');
  const dialogs = evOf('dialog');
  if (dialogs.length) add('dialogs', 'warn', `Всплывающие диалоги: ${dialogs.length}`, esc(short(dialogs[dialogs.length - 1].text, 160)), 'timeline', 'user');
  const invalid = evOf('invalid');
  if (invalid.length) add('validation', 'warn', `Ошибки валидации форм: ${invalid.length}`, esc(short(invalid[invalid.length - 1].text, 160)), 'timeline', 'user');
  const wsBad = R.events.filter((e) => e.cat === 'ws' && e.level === 'error');
  if (wsBad.length) add('ws', 'error', `Проблемы WebSocket: ${wsBad.length}`, esc(short(wsBad[wsBad.length - 1].text, 160)), 'timeline', 'ws');
  if (R.events.some((e) => e.kind === 'network' && e.level === 'error')) add('offline', 'error', 'Пропадала сеть', 'Браузер переходил в офлайн во время теста', 'timeline', 'user');
  const slow = evOf('slow-interaction');
  if (slow.length) {
    const w = slow.reduce((a, b) => (b.value > a.value ? b : a));
    add('slow', w.value >= 500 ? 'error' : 'warn', `Медленные отклики интерфейса: ${slow.length}`, `Худший: ${w.value} мс${w.selector ? ` · <code>${esc(short(w.selector, 60))}</code>` : ''}`, 'perf', null, `Худший: ${w.value} мс ${w.selector || ''}`);
  }
  const lf = evOf('long-frame');
  if (lf.length) {
    const w = lf.reduce((a, b) => (b.value > a.value ? b : a));
    const src = w.detail && w.detail.scripts && w.detail.scripts[0] ? w.detail.scripts[0].src : '';
    add('frames', w.value >= 250 ? 'error' : 'warn', `Долгие кадры (зависания): ${lf.length}`, `Худший: ${w.value} мс${src ? ` · <code>${esc(short(src, 70))}</code>` : ''}`, 'perf', null, `Худший: ${w.value} мс ${src}`);
  }
  const fps = evOf('fps');
  if (fps.length) add('fps', 'warn', `Просадки FPS: ${fps.length}`, `Минимум ${Math.min(...fps.map((e) => e.value))} кадров/с`, 'perf');
  vitalsOf().filter((v) => v.value != null && v.rating !== 'good').forEach((v) =>
    add(v.name === 'CLS' ? 'shifts' : 'vitals', v.rating === 'poor' ? 'error' : 'warn', `${v.name} — ${v.ratingRu.toLowerCase()}: ${v.fmt}`, `${v.title}${v.selector ? ` · <code>${esc(short(v.selector, 60))}</code>` : ''}`, 'perf', null, `${v.title} ${v.selector || ''}`));
  const ra = rendersAgg();
  if (ra.list.length && (ra.busy || ra.list[0][1][0] >= 50)) {
    const top = ra.list.slice(0, 3).map(([n, v]) => `${n} ×${v[0] + v[1]}`).join(', ');
    add('react', 'warn', 'Частые перерисовки React', esc(top), 'perf', null, top);
  }
  if (R.samples.length >= 3) {
    const h = R.samples.map((x) => x.heap).filter((x) => x != null);
    if (h.length >= 3 && h[h.length - 1] - h[0] > 20 && h[h.length - 1] > h[0] * 1.3) add('memory', 'warn', 'Растёт потребление памяти', `${h[0]} → ${h[h.length - 1]} МБ за время записи`, 'perf');
  }
  if (R.snapshot && R.snapshot.domNodes > 3000) add('dom', 'info', `Тяжёлая страница: ${R.snapshot.domNodes} DOM-узлов`, 'Больше 3000 узлов может замедлять отрисовку', 'perf');
  return F;
}

// находки с учётом типа бага
function findings() {
  const all = allFindings();
  const F = all.slice();
  if (!F.length) F.push({ level: 'ok', title: 'Явных технических ошибок не найдено', text: 'Консоль и запросы без ошибок.' });
  return F;
}

function renderSummary() {
  const F = findings();
  $('#summary').innerHTML = F.map((f, i) => `<div class="find ${f.level}" data-i="${i}"><b>${esc(f.title)}</b><div class="fd">${f.text}</div></div>`).join('') +
    (F.hidden ? `<div class="find more" id="show-hidden"><b>Ещё ${F.hidden} ${F.hidden === 1 ? 'находка' : 'находки'} не относятся к этому типу</b><div class="fd">Нажмите, чтобы показать все данные</div></div>` : '');
  $('#summary').querySelectorAll('.find[data-i]').forEach((el) => (el.onclick = () => {
    const f = F[+el.dataset.i];
    if (!f.tab) return;
    tab = f.tab;
    if (f.filter) filters[f.tab === 'timeline' ? 'timeline' : f.tab] = f.filter;
    $('#search').value = '';
    renderTab();
    document.querySelector('.tabs').scrollIntoView({ behavior: 'smooth' });
  }));

}

// ---------- график ----------
function spark(points, color, unit) {
  if (points.length < 2) return '<div class="muted" style="padding:16px 0">Мало данных</div>';
  const W = 300, H = 60;
  const t0 = points[0][0], t1 = points[points.length - 1][0];
  const vs = points.map((p) => p[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v) => H - 4 - ((v - lo) / Math.max(1e-9, hi - lo)) * (H - 8);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const bx = R.startTime >= t0 && R.startTime <= t1 ? x(R.startTime) : null;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bx != null ? `<line x1="${bx}" x2="${bx}" y1="0" y2="${H}" stroke="#ff2d55" stroke-dasharray="3 3" stroke-width="1"/>` : ''}<path d="${d} L${W},${H} L0,${H} Z" fill="${color}" fill-opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

const CDP_LABELS = [
  ['Nodes', 'DOM-узлы', 1], ['JSEventListeners', 'Обработчики событий', 1], ['Frames', 'Фреймы', 1],
  ['LayoutCount', 'Пересчёты макета (layout)', 1], ['RecalcStyleCount', 'Пересчёты стилей', 1],
  ['LayoutDuration', 'Время layout, мс', 1000], ['RecalcStyleDuration', 'Время пересчёта стилей, мс', 1000],
  ['ScriptDuration', 'Время выполнения JS, мс', 1000], ['TaskDuration', 'Время всех задач, мс', 1000], ['JSHeapUsedSize', 'Память JS, МБ', 1 / 1048576],
];
function cdpRows() {
  const a = R.meta.cdpMetricsStart, b = R.meta.cdpMetricsEnd;
  if (!a) return [];
  return CDP_LABELS.filter(([k]) => k in a).map(([k, label, mul]) => {
    const f = (v) => (v == null ? '—' : String(Math.round(v * mul * 10) / 10).replace('.', ','));
    return [label, f(a[k]), b ? f(b[k]) : '—', b ? (b[k] - a[k] >= 0 ? '+' : '') + f(b[k] - a[k]) : '—'];
  });
}

function renderPerf(body) {
  const vit = vitalsOf();
  const ra = rendersAgg();
  const maxR = ra.list.length ? ra.list[0][1][0] + ra.list[0][1][1] : 1;
  const tbl = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
  const evRows = (kind, lim = 30) => evOf(kind).slice().sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, lim)
    .map((e) => `<tr class="${e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : ''}">${relCell(e.ts)}<td>${esc(e.text)}${eventSub(e) ? `<span class="sub">${esc(eventSub(e))}</span>` : ''}</td></tr>`);
  const pts = (k) => R.samples.filter((s) => s[k] != null).map((s) => [s.ts, s[k]]);
  const range = (k, u) => { const v = pts(k).map((p) => p[1]); return v.length ? `${Math.min(...v)}–${Math.max(...v)} ${u}` : ''; };
  const muts = evOf('mutations');
  const mutTot = muts.reduce((a, e) => { const d = e.detail || {}; a.add += d.added || 0; a.rem += d.removed || 0; a.attr += d.attrs || 0; return a; }, { add: 0, rem: 0, attr: 0 });
  const mutTop = new Map();
  muts.forEach((e) => ((e.detail && e.detail.top) || []).forEach((t) => mutTop.set(t.selector, (mutTop.get(t.selector) || 0) + t.count)));
  const nav = evOf('navigation').pop();
  const cdp = cdpRows();

  body.innerHTML = `<div class="perf">
    <div class="ph">Web Vitals <small>как в Lighthouse / PageSpeed: зелёный — хорошо, жёлтый — можно лучше, красный — плохо</small></div>
    <div class="vitals">${vit.map((v) => v.value == null
      ? `<div class="vital"><div class="vn">${v.name}</div><div class="vv">—</div><small>${v.title}: нет данных</small></div>`
      : `<div class="vital ${v.rating}" title="${esc(v.selector)}"><div class="vn">${v.name}</div><div class="vv">${v.fmt}</div><div class="vr">${v.ratingRu}</div><small>${v.title}</small></div>`).join('')}</div>
    ${nav ? `<div class="muted" style="margin:-6px 0 14px">${esc(nav.text)}</div>` : ''}
    <div class="charts">
      <div class="chart"><div class="ct"><span>Память JS</span><span>${range('heap', 'МБ')}</span></div>${spark(pts('heap'), '#7c3aed')}</div>
      <div class="chart"><div class="ct"><span>DOM-узлы</span><span>${range('nodes', '')}</span></div>${spark(pts('nodes'), '#0891b2')}</div>
      <div class="chart"><div class="ct"><span>FPS (минимум за 5 с)</span><span>${range('fps', 'к/с')}</span></div>${spark(pts('fps'), '#16a34a')}</div>
    </div>
    <div class="muted" style="margin-top:-8px">Пунктир — начало проверки.</div>

    ${(() => {
      const da = domAgg();
      const rows = da.list.filter((x) => x.recreated || x.noop || x.secs >= 5).sort((a, b) => b.recreated * 3 + b.noop - (a.recreated * 3 + a.noop) || b.changes - a.changes).slice(0, 15);
      return `<div class="ph">Перерисовки DOM <small>работает на любом сайте: пересоздание элементов без изменений, пустые обновления, постоянно меняющиеся области</small></div>` +
        (rows.length ? tbl(['Элемент', 'Пересоздан без изменений', 'Пустых обновлений', 'Всего изменений', 'Секунд с изменениями'], rows.map((x) => `<tr><td class="mono">${esc(x.selector)}</td><td><b>${x.recreated || ''}</b></td><td>${x.noop || ''}</td><td>${x.changes || ''}</td><td>${x.secs || ''}</td></tr>`)) : '<div class="muted">Лишних перерисовок не найдено 👍</div>');
    })()}
    <div class="ph">Перерисовки React <small>${ra.list.length ? `всего обновлений: ${ra.commits}` : ''}</small></div>
    ${ra.list.length ? tbl(['Компонент', 'Перерисовок', 'Монтирований', ''], ra.list.slice(0, 25).map(([n, v]) =>
      `<tr><td class="mono">${esc(n)}</td><td><b>${v[0]}</b></td><td>${v[1]}</td><td style="width:40%"><span class="bar" style="width:${Math.max(2, ((v[0] + v[1]) / maxR) * 100)}%"></span></td></tr>`))
      : '<div class="muted">Страница не на React (или подсчёт выключен в настройках) — смотрите «Перерисовки DOM» выше, они работают для любого сайта.</div>'}

    <div class="ph">Долгие кадры и зависания <small>кадр дольше 100 мс — интерфейс заметно подтормаживает</small></div>
    ${evOf('long-frame').length ? tbl(['Время', 'Что блокировало'], evRows('long-frame')) : '<div class="muted">Не обнаружено 👍</div>'}

    <div class="ph">Медленные отклики на действия <small>дольше 200 мс от клика до отрисовки</small></div>
    ${evOf('slow-interaction').length ? tbl(['Время', 'Действие'], evRows('slow-interaction')) : '<div class="muted">Не обнаружено 👍</div>'}

    <div class="ph">Сдвиги макета <small>элементы «прыгают» при загрузке или действиях</small></div>
    ${evOf('layout-shift').length ? tbl(['Время', 'Сдвиг и элементы'], evRows('layout-shift', 15)) : '<div class="muted">Не обнаружено 👍</div>'}

    <div class="ph">Изменения DOM <small>+${mutTot.add} / −${mutTot.rem} узлов, ${mutTot.attr} изменений атрибутов</small></div>
    ${mutTop.size ? tbl(['Где чаще всего меняется', 'Изменений'], [...mutTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s2, c]) => `<tr><td class="mono">${esc(s2)}</td><td>${c}</td></tr>`)) : '<div class="muted">Нет данных</div>'}

    ${cdp.length ? `<div class="ph">Метрики DevTools <small>начало → конец фиксации бага</small></div>${tbl(['Метрика', 'Начало', 'Конец', 'Разница'], cdp.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="mono"' : ''}>${esc(c)}</td>`).join('')}</tr>`))}`
      : '<div class="muted" style="margin-top:14px">Подробные метрики DevTools (пересчёты layout и стилей, время JS, обработчики) появятся, если включить «Полный захват сети» в настройках расширения.</div>'}
  </div>`;
}

function renderStorage(body, match) {
  const sn = R.snapshot;
  if (!sn) { body.innerHTML = '<div class="zero">Снимок не сделан: обновите страницу после установки расширения и зафиксируйте баг заново.</div>'; return; }
  const t = (rows, head) => rows.length
    ? `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`
    : '<div class="muted" style="padding:0 16px 8px">Пусто</div>';
  const kv = (arr, keyName) => arr.filter((x) => match(x[keyName], x.value)).map((x) => `<tr><td class="mono" style="width:28%">${esc(x[keyName])}</td><td style="width:70px">${X.fmtSize(x.size)}</td><td class="mono msg u">${esc(x.value)}</td></tr>`);
  const changes = R.events.filter((e) => e.cat === 'storage' && match(e.text));
  body.innerHTML = `<div class="tf"><span class="muted">Снимок в начале проверки. Значения с секретными именами (token, session, password…) не сохраняются.</span></div><div class="stor">
    <h4>Cookies (${sn.cookies.length})</h4>${t(kv(sn.cookies, 'name'), ['Имя', 'Размер', 'Значение'])}
    <h4>localStorage (${sn.localStorage.length})</h4>${t(kv(sn.localStorage, 'key'), ['Ключ', 'Размер', 'Значение'])}
    <h4>sessionStorage (${sn.sessionStorage.length})</h4>${t(kv(sn.sessionStorage, 'key'), ['Ключ', 'Размер', 'Значение'])}
    <h4>Изменения хранилища во время теста (${changes.length})</h4>${t(changes.map((e) => `<tr>${relCell(e.ts)}<td class="mono">${esc(e.text)}</td></tr>`), ['Время', 'Операция'])}
  </div>`;
}

// ---------- для экспорта ----------
function perfModel() {
  const st = R.startTime;
  const ra = rendersAgg();
  const top = (kind, n) => evOf(kind).slice().sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, n).map((e) => ({ rel: e.ts - st, text: e.text, sub: eventSub(e) }));
  const rng = (k, u) => { const v = R.samples.map((s) => s[k]).filter((x) => x != null); return v.length ? `${Math.min(...v)}–${Math.max(...v)} ${u}`.trim() : ''; };
  const nav = evOf('navigation').pop();
  return {
    vitals: vitalsOf().filter((v) => v.value != null).map((v) => ({ name: v.name, title: v.title, value: v.fmt, rating: v.ratingRu, level: v.rating })),
    navigation: nav ? nav.text : '',
    memory: rng('heap', 'МБ'), nodes: rng('nodes', ''), fps: rng('fps', 'кадров/с'),
    renders: ra.list.slice(0, 20).map(([n, v]) => [n, v[0], v[1]]),
    longFrames: top('long-frame', 15),
    slow: top('slow-interaction', 15),
    shifts: top('layout-shift', 10),
    cdp: cdpRows(),
  };
}
const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g;
function storageModel(mask) {
  const sn = R.snapshot;
  const v = (x) => (mask ? maskS(String(x.value)).replace(JWT, '•••') : x.value);
  return {
    cookies: sn.cookies.map((c) => [c.name, X.fmtSize(c.size), mask ? '•••' : c.value]),
    local: sn.localStorage.map((x) => [x.key, X.fmtSize(x.size), v(x)]),
    session: sn.sessionStorage.map((x) => [x.key, X.fmtSize(x.size), v(x)]),
    changes: R.events.filter((e) => e.cat === 'storage').map((e) => [X.fmtRel(e.ts - R.startTime), e.text]),
  };
}

// ================= события =================
const bindField = (id, key) => ($(id).oninput = () => {
  R.fields[key] = $(id).value;
  if (key === 'title') document.title = ($(id).value || 'Баг-репорт') + ' — QA Bug Recorder';
  saveR();
});
bindField('#f-title', 'title');
bindField('#f-steps', 'steps');
bindField('#f-expected', 'expected');
bindField('#f-actual', 'actual');
bindField('#f-notes', 'notes');
$('#f-priority').onchange = () => { R.fields.priority = $('#f-priority').value; saveR(); };
$('#regen').onclick = () => {
  if ($('#f-steps').value.trim() && !confirm('Заменить текущие шаги автоматически собранными?')) return;
  $('#f-steps').value = R.fields.steps = autoSteps();
  saveR();
};
document.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = () => doExport(b.dataset.ex)));
$('#ai-sum').onclick = () => runSummary();
document.querySelectorAll('.tabs [data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderTab(); }));
$('#search').oninput = () => renderTab();
document.querySelectorAll('[data-adl]').forEach((b) => (b.onclick = () => { b.closest('details').open = false; doExport(b.dataset.adl, 'audit'); }));
$('#o-appendix').onchange = () => $('#apx-opts').classList.toggle('on', $('#o-appendix').checked);
$('#lightbox').onclick = () => ($('#lightbox').hidden = true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#lightbox').hidden = true; });

// сохраняем выбор опций экспорта
const OPT_IDS = ['o-before', 'o-mask', 'o-embed']; // остальные настройки выгрузки задаёт тип бага
chrome.storage.local.get('qa_export_opts').then(({ qa_export_opts: s }) => {
  if (s) OPT_IDS.forEach((id) => { const el = document.getElementById(id); if (id in s) el.type === 'checkbox' ? (el.checked = s[id]) : (el.value = s[id]); });
});
OPT_IDS.forEach((id) => (document.getElementById(id).onchange = () => {
  const s = {};
  OPT_IDS.forEach((i) => { const el = document.getElementById(i); s[i] = el.type === 'checkbox' ? el.checked : el.value; });
  chrome.storage.local.set({ qa_export_opts: s });
}));

init();
