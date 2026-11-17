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
  for (const a of R.annotations) shots[a.n] = await QADB.get('blobs', a.shotKey);
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
          const d = new Date(r.startTime).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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
      if (fresh) { fresh.fields = R.fields; fresh.annotations.forEach((a) => { const m = R.annotations.find((x) => x.n === a.n); if (m) a.comment = m.comment; }); await QADB.put('reports', R.id, fresh); return; }
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
  for (const it of items) {
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
    ['Баг зафиксирован', new Date(R.startTime).toLocaleString('ru-RU')],
    ['Длительность фиксации', X.fmtDur((R.endTime || Date.now()) - R.startTime)],
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
      ['Прокрутка в момент бага', `${sn.scroll.y} px из ${sn.scroll.height} px`],
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
  };
}
const netErr = (e) => e.failed || e.status >= 400;
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

async function buildModel(o) {
  const st = R.startTime;
  const keep = (e) => o.before || e.ts >= st;
  const anns = [];
  for (const a of R.annotations) {
    const dataUrl = shots[a.n];
    const item = { ...a, rel: a.ts - st, dataUrl, file: `screenshots/pometka-${String(a.n).padStart(2, '0')}.png` };
    if (dataUrl) { item.bytes = b64bytes(dataUrl); Object.assign(item, await imgSize(dataUrl)); }
    anns.push(item);
  }
  const net = filterNet(allNet().filter(keep), o.network).map((e) => {
    const x = { ...e, rel: e.ts - st };
    if (o.mask) { x.reqHeaders = maskH(e.reqHeaders); x.resHeaders = maskH(e.resHeaders); x.url = maskS(e.url); x.postData = maskS(e.postData); x.body = maskS(e.body); }
    if (!o.details) { delete x.reqHeaders; delete x.resHeaders; delete x.postData; delete x.body; }
    return x;
  });
  const media = (arr, kind) => arr.filter((v) => mediaBlobs[v.key]).map((v) => ({ ...v, rel: v.start - st, durationMs: (v.end || Date.now()) - v.start, size: mediaBlobs[v.key].size, file: `media/${kind}-${v.n}.webm` }));
  const f = R.fields;
  return {
    title: f.title || 'Баг-репорт',
    severity: f.severity, priority: f.priority, steps: f.steps, expected: f.expected, actual: f.actual, notes: f.notes,
    createdAt: new Date(st).toLocaleString('ru-RU'),
    generatedAt: new Date().toLocaleString('ru-RU'),
    env: env(),
    annotations: anns,
    actions: timeline().filter(keep).map((a) => ({ rel: a.ts - st, text: a.kind === 'nav' ? 'Переход: ' + (o.mask ? maskS(a.url) : a.url) : X.describeAction(a), page: a.page || a.url || '' })),
    console: filterConsole(R.console.filter(keep), o.console).map((c) => ({ ...c, rel: c.ts - st, text: o.mask ? maskS(c.text) : c.text })),
    network: net,
    videos: media(R.videos, 'video'),
    voice: media(R.voice, 'voice'),
    details: o.details,
    findings: findings().filter((f) => f.level !== 'ok').map((f) => ({ level: f.level, title: f.title, text: f.plain || stripTags(f.text) })),
    events: o.events === 'none' ? [] : timelineItems(o.events === 'all' ? 'all-events' : 'important-events').filter(keep).map((x) => ({ rel: x.ts - st, cat: CAT_RU[x.cat] || x.cat, level: x.level, text: o.mask ? maskS(x.text) : x.text })),
    perf: o.perf ? perfModel() : null,
    storage: o.storage && R.snapshot ? storageModel(o.mask) : null,
  };
}

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
  for (const v of [...m.videos, ...m.voice]) files.push({ name: v.file, data: await blobBytes(mediaBlobs[v.key]) });
  return files;
}

async function doExport(kind) {
  const st = $('#ex-status');
  const btns = document.querySelectorAll('[data-ex]');
  btns.forEach((b) => (b.disabled = true));
  st.textContent = 'Готовлю файл…';
  try {
    const o = opts();
    const m = await buildModel(o);
    const base = baseName();
    if (kind === 'docx') {
      download(X.exportDOCX(m), base + '.docx');
      if (m.videos.length || m.voice.length) st.textContent = 'Word сохранён. Видео и голос в .docx не встраиваются — используйте «Всё одним архивом» или скачайте их под плеером.';
      else st.textContent = 'Готово: ' + base + '.docx';
    } else if (kind === 'md') {
      const files = [{ name: 'report.md', data: X.exportMarkdown(m) }];
      m.annotations.forEach((a) => a.bytes && files.push({ name: a.file, data: a.bytes }));
      files.push(...(await mediaFiles(m)));
      if (m.network.length) files.push({ name: 'network.har', data: JSON.stringify(X.exportHAR(m), null, 2) });
      if (m.console.length) files.push({ name: 'console.log', data: consoleTxt(m) });
      download(QAZip.makeZip(files), base + '_markdown.zip');
      st.textContent = 'Готово: report.md + скриншоты, медиа и HAR в архиве';
    } else if (kind === 'html') {
      const media = {};
      if (o.embed) for (const v of [...m.videos, ...m.voice]) media[v.file] = await blobToDataUrl(mediaBlobs[v.key]);
      download(new Blob([X.exportHTML(m, media)], { type: 'text/html' }), base + '.html');
      st.textContent = 'Готово: один HTML-файл' + (o.embed && Object.keys(media).length ? ' со встроенным видео/голосом' : '');
    } else if (kind === 'har') {
      download(new Blob([JSON.stringify(X.exportHAR(m), null, 2)], { type: 'application/json' }), base + '.har');
      st.textContent = 'Готово: HAR открывается в DevTools → Network → Import';
    } else if (kind === 'all') {
      const files = [
        { name: 'report.docx', data: await blobBytes(X.exportDOCX(m)) },
        { name: 'report.html', data: X.exportHTML(m, {}) },
        { name: 'report.md', data: X.exportMarkdown(m) },
      ];
      m.annotations.forEach((a) => a.bytes && files.push({ name: a.file, data: a.bytes }));
      files.push(...(await mediaFiles(m)));
      files.push({ name: 'network.har', data: JSON.stringify(X.exportHAR(m), null, 2) });
      files.push({ name: 'console.log', data: consoleTxt(m) });
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
  $('#f-severity').value = f.severity;
  $('#f-priority').value = f.priority || '';
  $('#f-steps').value = f.steps;
  $('#f-expected').value = f.expected;
  $('#f-actual').value = f.actual;
  $('#f-notes').value = f.notes || '';
  $('#created').textContent = 'Зафиксирован ' + new Date(R.startTime).toLocaleString('ru-RU') + ' · ' + short(R.meta.startUrl, 80);
  document.title = (f.title || 'Баг-репорт') + ' — QA Bug Recorder';

  const warns = [];
  if (R.active) warns.push('Фиксация этого бага ещё идёт. Нажмите «✓ Готово» на панели на странице, затем обновите отчёт.');
  if (R.meta.truncated) warns.push('Часть записей не сохранена: превышен лимит объёма.');
  if (R.meta.cdpError) warns.push('Полный захват сети не включился: ' + R.meta.cdpError);
  [...R.videos, ...R.voice].filter((v) => v.error).forEach((v) => warns.push('Ошибка записи: ' + v.error));
  $('#banner').hidden = !warns.length;
  $('#banner').innerHTML = warns.map(esc).join('<br>');

  renderMedia();
  renderAnns();
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
  for (const v of R.videos) {
    const b = mediaBlobs[v.key];
    if (!b) continue;
    items.push(`<div class="card"><div class="lbl">Видео ${v.n} · ${X.fmtDur((v.end || Date.now()) - v.start)} · ${X.fmtSize(b.size)} <button class="link" data-dl="${v.key}" data-name="video-${v.n}.webm">⬇ скачать</button></div><video controls preload="metadata" data-key="${v.key}" data-start="${v.start}"></video></div>`);
  }
  for (const v of R.voice) {
    const b = mediaBlobs[v.key];
    if (!b) continue;
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

function renderAnns() {
  $('#ann-count').textContent = R.annotations.length;
  if (!R.annotations.length) {
    $('#anns').innerHTML = '<div class="muted">Пометок нет. На странице используйте 🎯 Элемент, ➚ Стрелка, ▭ Область или 💬 Заметка.</div>';
    return;
  }
  $('#anns').innerHTML = R.annotations
    .map((a) => `<div class="ann">
      ${shots[a.n] ? `<img src="${shots[a.n]}" data-n="${a.n}" alt="">` : ''}
      <div class="ab">
        <div class="ah"><span class="num">${a.n}</span><span class="chip">${X.KIND_RU[a.kind] || a.kind}</span>
          <span class="chip time" data-ts="${a.ts}" title="Перейти к моменту в видео">${X.fmtRel(a.ts - R.startTime)}</span>
          <button class="rm" data-rm="${a.n}" title="Удалить пометку">🗑</button></div>
        <textarea rows="2" data-c="${a.n}" placeholder="Комментарий">${esc(a.comment)}</textarea>
        ${a.element ? `<div class="sel" title="CSS-селектор элемента">${esc(a.element.selector)}<br>&lt;${esc(a.element.tag)}&gt; ${Math.round(a.element.rect.w)}×${Math.round(a.element.rect.h)}${a.element.text ? ' · «' + esc(short(a.element.text, 80)) + '»' : ''}</div>` : ''}
        <div class="url">${esc(a.url)}</div>
      </div></div>`)
    .join('');
  $('#anns').querySelectorAll('img').forEach((i) => (i.onclick = () => { $('#lightbox img').src = i.src; $('#lightbox').hidden = false; }));
  $('#anns').querySelectorAll('[data-c]').forEach((t) => (t.oninput = () => { R.annotations.find((a) => a.n === +t.dataset.c).comment = t.value; saveR(); }));
  $('#anns').querySelectorAll('.time').forEach((c) => (c.onclick = () => { if (!seekTo(+c.dataset.ts)) c.title = 'Видео на этот момент нет'; }));
  $('#anns').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Удалить пометку #' + b.dataset.rm + '?')) return;
    const a = R.annotations.find((x) => x.n === +b.dataset.rm);
    R.annotations = R.annotations.filter((x) => x !== a);
    await QADB.del('blobs', a.shotKey);
    saveR();
    renderAnns();
  }));
}

function relCell(ts) { return `<td class="mono">${X.fmtRel(ts - R.startTime)}</td>`; }
function dividerRow(cols) { return `<tr class="divider"><td colspan="${cols}">▼ нажато «Нашёл баг»</td></tr>`; }

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
    body.innerHTML = `<div class="tf"><span class="muted">Клики, ввод и переходы. «−» — до нажатия «Нашёл баг». Пароли не сохраняются.</span></div>` + (list.length
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

function findings() {
  const F = [];
  const add = (level, title, text, tab, filter, plain) => F.push({ level, title, text, tab, filter, plain });
  const errs = R.console.filter((c) => c.level === 'error');
  if (errs.length) add('error', `Ошибки JavaScript: ${errs.length}`, `<code>${esc(short(errs[errs.length - 1].text.split('\n')[0], 140))}</code>`, 'console', 'error', short(errs[errs.length - 1].text.split('\n')[0], 140));
  const nerr = allNet().filter((e) => netErr(e) && !noise(e));
  if (nerr.length) {
    const t = nerr.slice(-3).map((e) => { let p = e.url; try { p = new URL(e.url).pathname; } catch (_) {} return `${e.method} ${X.statusLabel(e)} ${short(p, 50)}`; });
    add('error', `Ошибки запросов: ${nerr.length}`, t.map((x) => `<code>${esc(x)}</code>`).join('<br>'), 'network', 'errors', t.join('; '));
  }
  const appeared = evOf('appeared').filter((e) => e.level === 'error');
  if (appeared.length) add('error', 'Сообщения об ошибке на странице', esc(short(appeared[appeared.length - 1].text, 160)), 'timeline', 'dom');
  const dialogs = evOf('dialog');
  if (dialogs.length) add('warn', `Всплывающие диалоги: ${dialogs.length}`, esc(short(dialogs[dialogs.length - 1].text, 160)), 'timeline', 'user');
  const invalid = evOf('invalid');
  if (invalid.length) add('warn', `Ошибки валидации форм: ${invalid.length}`, esc(short(invalid[invalid.length - 1].text, 160)), 'timeline', 'user');
  const wsBad = R.events.filter((e) => e.cat === 'ws' && e.level === 'error');
  if (wsBad.length) add('error', `Проблемы WebSocket: ${wsBad.length}`, esc(short(wsBad[wsBad.length - 1].text, 160)), 'timeline', 'ws');
  if (R.events.some((e) => e.kind === 'network' && e.level === 'error')) add('error', 'Пропадала сеть', 'Браузер переходил в офлайн во время теста', 'timeline', 'user');
  const slow = evOf('slow-interaction');
  if (slow.length) {
    const w = slow.reduce((a, b) => (b.value > a.value ? b : a));
    add(w.value >= 500 ? 'error' : 'warn', `Медленные отклики интерфейса: ${slow.length}`, `Худший: ${w.value} мс${w.selector ? ` · <code>${esc(short(w.selector, 60))}</code>` : ''}`, 'perf', null, `Худший: ${w.value} мс ${w.selector || ''}`);
  }
  const lf = evOf('long-frame');
  if (lf.length) {
    const w = lf.reduce((a, b) => (b.value > a.value ? b : a));
    const src = w.detail && w.detail.scripts && w.detail.scripts[0] ? w.detail.scripts[0].src : '';
    add(w.value >= 250 ? 'error' : 'warn', `Долгие кадры (зависания): ${lf.length}`, `Худший: ${w.value} мс${src ? ` · <code>${esc(short(src, 70))}</code>` : ''}`, 'perf', null, `Худший: ${w.value} мс ${src}`);
  }
  const fps = evOf('fps');
  if (fps.length) add('warn', `Просадки FPS: ${fps.length}`, `Минимум ${Math.min(...fps.map((e) => e.value))} кадров/с`, 'perf');
  vitalsOf().filter((v) => v.value != null && v.rating !== 'good').forEach((v) =>
    add(v.rating === 'poor' ? 'error' : 'warn', `${v.name} — ${v.ratingRu.toLowerCase()}: ${v.fmt}`, `${v.title}${v.selector ? ` · <code>${esc(short(v.selector, 60))}</code>` : ''}`, 'perf', null, `${v.title} ${v.selector || ''}`));
  const ra = rendersAgg();
  if (ra.list.length && (ra.busy || ra.list[0][1][0] >= 50)) {
    const top = ra.list.slice(0, 3).map(([n, v]) => `${n} ×${v[0] + v[1]}`).join(', ');
    add('warn', 'Частые перерисовки React', esc(top), 'perf', null, top);
  }
  if (R.samples.length >= 3) {
    const h = R.samples.map((x) => x.heap).filter((x) => x != null);
    if (h.length >= 3 && h[h.length - 1] - h[0] > 20 && h[h.length - 1] > h[0] * 1.3) add('warn', 'Растёт потребление памяти', `${h[0]} → ${h[h.length - 1]} МБ за время записи`, 'perf');
  }
  if (R.snapshot && R.snapshot.domNodes > 3000) add('info', `Тяжёлая страница: ${R.snapshot.domNodes} DOM-узлов`, 'Больше 3000 узлов может замедлять отрисовку', 'perf');
  if (!F.length) add('ok', 'Явных технических ошибок не найдено', 'Консоль и запросы без ошибок. Смотрите пометки, шаги и видео.', null);
  return F;
}

function renderSummary() {
  const F = findings();
  $('#summary').innerHTML = F.map((f, i) => `<div class="find ${f.level}" data-i="${i}"><b>${esc(f.title)}</b><div class="fd">${f.text}</div></div>`).join('');
  $('#summary').querySelectorAll('.find').forEach((el) => (el.onclick = () => {
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
    <div class="muted" style="margin-top:-8px">Пунктир — момент нажатия «Нашёл баг».</div>

    <div class="ph">Перерисовки React <small>${ra.list.length ? `всего обновлений: ${ra.commits}` : ''}</small></div>
    ${ra.list.length ? tbl(['Компонент', 'Перерисовок', 'Монтирований', ''], ra.list.slice(0, 25).map(([n, v]) =>
      `<tr><td class="mono">${esc(n)}</td><td><b>${v[0]}</b></td><td>${v[1]}</td><td style="width:40%"><span class="bar" style="width:${Math.max(2, ((v[0] + v[1]) / maxR) * 100)}%"></span></td></tr>`))
      : '<div class="muted">Нет данных: страница не на React или подсчёт выключен в настройках расширения.</div>'}

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
  body.innerHTML = `<div class="tf"><span class="muted">Снимок в момент нажатия «Нашёл баг». Значения с секретными именами (token, session, password…) не сохраняются.</span></div><div class="stor">
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
$('#f-severity').onchange = () => { R.fields.severity = $('#f-severity').value; saveR(); };
$('#f-priority').onchange = () => { R.fields.priority = $('#f-priority').value; saveR(); };
$('#regen').onclick = () => {
  if ($('#f-steps').value.trim() && !confirm('Заменить текущие шаги автоматически собранными?')) return;
  $('#f-steps').value = R.fields.steps = autoSteps();
  saveR();
};
document.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = () => doExport(b.dataset.ex)));
document.querySelectorAll('.tabs [data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderTab(); }));
$('#search').oninput = () => renderTab();
$('#lightbox').onclick = () => ($('#lightbox').hidden = true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#lightbox').hidden = true; });

// сохраняем выбор опций экспорта
const OPT_IDS = ['o-console', 'o-network', 'o-events', 'o-perf', 'o-storage', 'o-before', 'o-details', 'o-mask', 'o-embed'];
chrome.storage.local.get('qa_export_opts').then(({ qa_export_opts: s }) => {
  if (s) OPT_IDS.forEach((id) => { const el = document.getElementById(id); if (id in s) el.type === 'checkbox' ? (el.checked = s[id]) : (el.value = s[id]); });
});
OPT_IDS.forEach((id) => (document.getElementById(id).onchange = () => {
  const s = {};
  OPT_IDS.forEach((i) => { const el = document.getElementById(i); s[i] = el.type === 'checkbox' ? el.checked : el.value; });
  chrome.storage.local.set({ qa_export_opts: s });
}));

init();
