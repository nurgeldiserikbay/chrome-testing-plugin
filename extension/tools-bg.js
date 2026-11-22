// Фоновая часть инструментов: автотесты (запись и прогон), условия (сеть, процессор, устройство),
// скриншоты на разных экранах. Подключается в конце background.js через importScripts
// и использует его общие функции (S, buffers, ingest, startBug, QADB…).

// ================= общее =================
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTabLoaded(tabId, timeout = 20000) {
  const t0 = Date.now();
  await sleepMs(250);
  while (Date.now() - t0 < timeout) {
    let t;
    try { t = await chrome.tabs.get(tabId); } catch (_) { return false; }
    if (t.status === 'complete') return true;
    await sleepMs(150);
  }
  return false;
}
function openTools(hash, tabId) {
  const q = tabId ? '?tab=' + tabId : '';
  return chrome.tabs.create({ url: chrome.runtime.getURL('tools.html' + q + (hash ? '#' + hash : '')) });
}
function sessionNote(text) {
  if (S && S.active) ingest(S.tabId, 'events', { ts: Date.now(), cat: 'env', kind: 'conditions', text, level: 'info' });
}

// ================= 📶 условия: сеть, процессор, устройство =================
const NET_PRESETS = {
  none: { label: 'Без ограничений' },
  '4g': { label: '4G', latency: 60, down: 9000, up: 3000 },
  '3g': { label: '3G', latency: 560, down: 1440, up: 675 },
  slow3g: { label: 'Медленный 3G', latency: 2000, down: 400, up: 400 },
  offline: { label: 'Нет сети', offline: true },
};
const CPU_PRESETS = { 1: 'Обычный', 4: 'Процессор ×4 медленнее', 6: 'Процессор ×6 медленнее' };
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DEVICES = {
  none: { label: 'Как есть' },
  iphonese: { label: 'iPhone SE', w: 375, h: 667, dpr: 2, mobile: true, ua: IOS_UA },
  iphone15: { label: 'iPhone 15', w: 393, h: 852, dpr: 3, mobile: true, ua: IOS_UA },
  android: { label: 'Android (Pixel 8)', w: 412, h: 915, dpr: 2.625, mobile: true, ua: MOBILE_UA },
  ipad: { label: 'iPad Air', w: 820, h: 1180, dpr: 2, mobile: true, ua: IPAD_UA },
  laptop: { label: 'Ноутбук 1366×768', w: 1366, h: 768, dpr: 1, mobile: false },
  fhd: { label: 'Монитор 1920×1080', w: 1920, h: 1080, dpr: 1, mobile: false },
};
const EMU = {}; // tabId -> {net, cpu, device}
const dbgOwned = new Set();
const emuActive = (tabId) => { const e = EMU[tabId]; return !!(e && (e.net !== 'none' || +e.cpu > 1 || e.device !== 'none')); };
function emuLabel(tabId) {
  const e = EMU[tabId];
  if (!emuActive(tabId)) return '';
  return [e.net !== 'none' && 'Сеть: ' + NET_PRESETS[e.net].label, +e.cpu > 1 && CPU_PRESETS[e.cpu], e.device !== 'none' && 'Устройство: ' + DEVICES[e.device].label + ` (${DEVICES[e.device].w}×${DEVICES[e.device].h})`].filter(Boolean).join(' · ');
}
async function ensureDebugger(tabId) {
  if (dbgOwned.has(tabId) || (S && S.active && S.tabId === tabId && S.meta.cdp)) return;
  if (!chrome.debugger || !(await hasDebugger())) throw new Error('Нужно разрешение «Отладка вкладки» — выберите условие или «Экраны» ещё раз и нажмите «Разрешить».');
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(e.message)) throw new Error('Не удалось подключиться к вкладке: ' + e.message + '. Закройте DevTools на этой вкладке и попробуйте снова.');
  }
  dbgOwned.add(tabId);
}
async function applyDevice(tabId, d, keepNoUA) {
  if (!d || !d.w) {
    await cdp(tabId, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    await cdp(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
    if (!keepNoUA) await cdp(tabId, 'Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => {});
    return;
  }
  await cdp(tabId, 'Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: d.dpr || 1, mobile: !!d.mobile, screenWidth: d.w, screenHeight: d.h });
  await cdp(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: !!d.mobile, maxTouchPoints: d.mobile ? 5 : 0 }).catch(() => {});
  if (d.ua) await cdp(tabId, 'Emulation.setUserAgentOverride', { userAgent: d.ua }).catch(() => {});
}
async function setEmulation(tabId, conf) {
  const prev = EMU[tabId] || { net: 'none', cpu: 1, device: 'none' };
  const next = { ...prev, ...conf };
  const anyOn = next.net !== 'none' || +next.cpu > 1 || next.device !== 'none';
  if (!anyOn) {
    await clearEmulation(tabId);
    return { ok: true, label: '' };
  }
  await ensureDebugger(tabId);
  const n = NET_PRESETS[next.net] || NET_PRESETS.none;
  await cdp(tabId, 'Network.enable').catch(() => {});
  await cdp(tabId, 'Network.emulateNetworkConditions', n.latency || n.offline
    ? { offline: !!n.offline, latency: n.latency || 0, downloadThroughput: n.down ? (n.down * 1024) / 8 : -1, uploadThroughput: n.up ? (n.up * 1024) / 8 : -1 }
    : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp(tabId, 'Emulation.setCPUThrottlingRate', { rate: Math.max(1, +next.cpu || 1) });
  if (next.device !== prev.device) {
    await applyDevice(tabId, DEVICES[next.device]);
    if ((DEVICES[next.device] || {}).ua || (DEVICES[prev.device] || {}).ua) chrome.tabs.reload(tabId).catch(() => {}); // новый user-agent нужен сайту с первой загрузки
  }
  EMU[tabId] = next;
  const label = emuLabel(tabId);
  sessionNote('Условия проверки: ' + (label || 'обычные'));
  return { ok: true, label };
}
async function clearEmulation(tabId) {
  const had = EMU[tabId];
  delete EMU[tabId];
  if (dbgOwned.has(tabId) && !(S && S.active && S.tabId === tabId && S.meta.cdp)) {
    dbgOwned.delete(tabId);
    try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  } else {
    await cdp(tabId, 'Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
    await cdp(tabId, 'Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await applyDevice(tabId, null).catch(() => {});
  }
  if (had && had.device !== 'none' && (DEVICES[had.device] || {}).ua) chrome.tabs.reload(tabId).catch(() => {});
  if (had) sessionNote('Условия проверки: обычные');
}
function onToolsDbgDetach(src) {
  if (src.tabId == null) return;
  dbgOwned.delete(src.tabId);
  if (EMU[src.tabId]) { delete EMU[src.tabId]; sessionNote('Условия сброшены: отладка вкладки закрыта'); }
}
chrome.tabs.onRemoved.addListener((tabId) => { delete EMU[tabId]; dbgOwned.delete(tabId); });

// ---------- 📐 скриншоты на разных экранах ----------
const SCREENS = [
  { w: 375, h: 812, mobile: true, label: 'телефон' },
  { w: 768, h: 1024, mobile: true, label: 'планшет' },
  { w: 1280, h: 800, mobile: false, label: 'ноутбук' },
  { w: 1920, h: 1080, mobile: false, label: 'большой монитор' },
];
async function responsiveShots(tabId) {
  await ready;
  if (!S || !S.active || S.tabId !== tabId) {
    const r = await startBug(tabId);
    if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'Не удалось начать проверку' };
  }
  await ensureDebugger(tabId);
  const tab = await chrome.tabs.get(tabId);
  const made = [];
  try {
    for (const s of SCREENS) {
      await cdp(tabId, 'Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.mobile, screenWidth: s.w, screenHeight: s.h });
      await sleepMs(1200);
      const m = await cdp(tabId, 'Page.getLayoutMetrics');
      const full = Math.ceil((m.cssContentSize || m.contentSize).height);
      const h = Math.min(full, 5000);
      const shot = await cdp(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: true, clip: { x: 0, y: 0, width: s.w, height: h, scale: 1 } });
      const dataUrl = 'data:image/jpeg;base64,' + shot.data;
      const n = S.annotations.reduce((mx, a) => Math.max(mx, a.n), 0) + 1;
      const key = `${S.id}_shot_${n}`;
      await QADB.put('blobs', key, dataUrl);
      S.annotations.push({
        n, ts: Date.now(), kind: 'screen', severity: 'trivial',
        comment: `📐 Экран ${s.w} px — ${s.label}${full > h ? ` (показаны первые ${h} px из ${full})` : ''}`,
        element: null, shape: null, viewport: { w: s.w, h: s.h, dpr: 1 }, url: tab.url, title: tab.title, shotKey: key, cond: emuLabel(tabId),
      });
      made.push(s.w);
    }
  } finally {
    const e = EMU[tabId];
    if (e && e.device !== 'none') await applyDevice(tabId, DEVICES[e.device], true).catch(() => {});
    else await cdp(tabId, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    if (!emuActive(tabId) && dbgOwned.has(tabId) && !(S && S.meta.cdp)) { dbgOwned.delete(tabId); try { await chrome.debugger.detach({ tabId }); } catch (_) {} }
  }
  await saveSessionNow();
  pushOverlayState();
  toast(`📐 Добавлено ${made.length} пунктов: скриншоты страницы на ширине ${made.join(', ')} px`);
  return { ok: true, count: made.length };
}

// ================= 🤖 автотесты: запись =================
const REC = {}; // tabId -> {steps, startUrl, startedAt, lastStepTs, lastUrl}
async function injectRecorder(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [...(await i18nFiles()), 'recorder.js'] }); } catch (_) {}
  pushRec(tabId);
}
function pushRec(tabId) {
  const r = REC[tabId];
  chrome.tabs.sendMessage(tabId, { type: 'qa-rec-state', rec: r ? { steps: r.steps.length, last: r.steps[r.steps.length - 1] || null } : null }, { frameId: 0 }).catch(() => {});
}
async function recStart(tabId, url) {
  if (url) { await chrome.tabs.update(tabId, { url }); await waitTabLoaded(tabId); }
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/.test(tab.url || '')) return { ok: false, error: 'Запись автотеста работает только на обычных страницах сайта (http/https).' };
  REC[tabId] = { steps: [], startUrl: tab.url, startedAt: Date.now(), lastStepTs: Date.now(), lastUrl: tab.url, viewport: null };
  await chrome.storage.session.set({ qa_rec: REC }).catch(() => {});
  await injectRecorder(tabId);
  return { ok: true };
}
async function recSave(tabId, name) {
  const r = REC[tabId];
  if (!r) return { ok: false, error: 'Запись не идёт' };
  if (!r.steps.length) return { ok: false, error: 'В сценарии нет шагов' };
  const { qa_tests = [] } = await chrome.storage.local.get('qa_tests');
  const t = { id: 't' + Date.now().toString(36), name: name || 'Сценарий ' + (qa_tests.length + 1), startUrl: r.startUrl, steps: r.steps, created: Date.now(), updated: Date.now(), viewport: r.viewport };
  qa_tests.push(t);
  await chrome.storage.local.set({ qa_tests });
  delete REC[tabId];
  await chrome.storage.session.set({ qa_rec: REC }).catch(() => {});
  pushRec(tabId);
  return { ok: true, id: t.id };
}
async function recCancel(tabId) {
  delete REC[tabId];
  await chrome.storage.session.set({ qa_rec: REC }).catch(() => {});
  pushRec(tabId);
  return { ok: true };
}
// восстановление после перезапуска service worker
chrome.storage.session.get('qa_rec').then((o) => { if (o && o.qa_rec) Object.assign(REC, o.qa_rec); }).catch(() => {});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const r = REC[tabId];
  if (!r) return;
  if (info.url && info.url.replace(/#.*$/, '') !== (r.lastUrl || '').replace(/#.*$/, '')) {
    // переход не после клика/ввода — значит, тестировщик сам открыл адрес
    if (Date.now() - r.lastStepTs > 3000 && /^(https?|file):/.test(info.url)) {
      r.steps.push({ type: 'goto', url: info.url });
      r.lastStepTs = Date.now();
    }
    r.lastUrl = info.url;
    chrome.storage.session.set({ qa_rec: REC }).catch(() => {});
  }
  if (info.status === 'complete') injectRecorder(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => { if (REC[tabId]) { delete REC[tabId]; chrome.storage.session.set({ qa_rec: REC }).catch(() => {}); } });

// ================= 🤖 автотесты: прогон =================
// Функция выполняется в странице (изолированный мир): ищет элемент и выполняет шаг.
async function qaRunStep(step, timeout) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const find = () => {
    for (const l of step.loc || []) {
      try {
        if (l.css) {
          const els = [...document.querySelectorAll(l.css)];
          const v = els.find(visible) || (step.type === 'fill' || step.type === 'select' ? els[0] : null);
          if (v) return v;
        } else if (l.text) {
          const want = norm(l.text);
          const els = [...document.querySelectorAll(l.tag || 'a,button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],label,summary,li,span,div')];
          const v = els.find((e) => visible(e) && norm(e.innerText || e.textContent) === want) || els.find((e) => visible(e) && norm(e.innerText || e.textContent).includes(want));
          if (v) return v;
        }
      } catch (_) {}
    }
    return null;
  };
  const t0 = Date.now();
  const until = t0 + (timeout || 10000);
  if (step.type === 'assertUrl') {
    while (Date.now() < until) { if (location.href.includes(step.value)) return { ok: true }; await sleep(150); }
    return { ok: false, error: `Адрес страницы не содержит «${step.value}». Сейчас: ${location.href}` };
  }
  if (step.type === 'assertText' && !(step.loc && step.loc.length)) {
    while (Date.now() < until) { if (norm(document.body.innerText).includes(norm(step.value))) return { ok: true }; await sleep(200); }
    return { ok: false, error: `На странице нет текста «${step.value}»` };
  }
  let el = null;
  while (Date.now() < until) { el = find(); if (el) break; await sleep(150); }
  if (step.type === 'assertHidden') return el && visible(el) ? { ok: false, error: 'Элемент всё ещё виден' } : { ok: true };
  if (!el) return { ok: false, error: `Элемент не найден за ${Math.round((timeout || 10000) / 1000)} с: ${step.desc || ''}`, notFound: true };
  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
  const flash = () => { const o = el.style.outline; el.style.outline = '3px solid #7c3aed'; setTimeout(() => (el.style.outline = o), 400); };
  if (step.type === 'assertVisible') { flash(); return { ok: true }; }
  if (step.type === 'assertText') {
    while (Date.now() < until) {
      const t = norm(el.innerText || el.textContent || el.value);
      if (t.includes(norm(step.value))) { flash(); return { ok: true }; }
      await sleep(200); const e2 = find(); if (e2) el = e2;
    }
    return { ok: false, error: `Текст элемента не содержит «${step.value}». Сейчас: «${norm(el.innerText || el.textContent || el.value).slice(0, 160)}»` };
  }
  if (step.type === 'assertValue') {
    while (Date.now() < until) { if (String(el.value) === String(step.value)) { flash(); return { ok: true }; } await sleep(200); }
    return { ok: false, error: `Значение поля «${el.value}», ожидалось «${step.value}»` };
  }
  // ждём, пока элемент станет доступен
  while (Date.now() < until && (el.disabled || el.getAttribute('aria-disabled') === 'true')) await sleep(150);
  if (el.disabled) return { ok: false, error: 'Элемент неактивен (disabled)' };
  flash();
  const setVal = (v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (step.type === 'click') {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: window };
    el.dispatchEvent(new PointerEvent('pointerover', o)); el.dispatchEvent(new MouseEvent('mouseover', o));
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.focus({ preventScroll: true }); } catch (_) {}
    el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
    return { ok: true };
  }
  if (step.type === 'fill') {
    try { el.focus(); } catch (_) {}
    if (el.isContentEditable) { el.textContent = step.value; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    else setVal(step.value);
    return { ok: true };
  }
  if (step.type === 'select') { setVal(step.value); return { ok: true }; }
  if (step.type === 'check') { if (!!el.checked !== !!step.value) el.click(); return { ok: true }; }
  if (step.type === 'press') {
    const o = { key: step.key, code: step.key, keyCode: step.key === 'Enter' ? 13 : 27, which: step.key === 'Enter' ? 13 : 27, bubbles: true, cancelable: true };
    const down = el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
    if (down && step.key === 'Enter' && el.form && el.tagName === 'INPUT') { try { el.form.requestSubmit(); } catch (_) { el.form.submit(); } }
    return { ok: true };
  }
  return { ok: false, error: 'Неизвестный шаг: ' + step.type };
}

let RUN = null;
const progress = () => chrome.runtime.sendMessage({ type: 'qa-test-progress', run: RUN }).catch(() => {});
async function getTests() { return (await chrome.storage.local.get('qa_tests')).qa_tests || []; }
async function runTests(ids, opts = {}) {
  if (RUN && RUN.status === 'running') return { ok: false, error: 'Прогон уже идёт' };
  const all = await getTests();
  const list = ids && ids.length ? ids.map((id) => all.find((t) => t.id === id)).filter(Boolean) : all;
  if (!list.length) return { ok: false, error: 'Нет сценариев' };
  const { qa_test_opts: to = {} } = await chrome.storage.local.get('qa_test_opts');
  const failOnErrors = to.failOnErrors !== false;
  const stepTimeout = (+to.timeout || 10) * 1000;
  RUN = { id: 'r' + Date.now().toString(36), ts: Date.now(), status: 'running', results: list.map((t) => ({ sid: t.id, name: t.name, status: 'queued', steps: t.steps.map((s) => ({ status: 'queued' })), errors: [] })) };
  progress();
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true, windowId: win ? win.id : undefined });
  RUN.tabId = tab.id;
  try {
    for (let k = 0; k < list.length; k++) {
      if (RUN.stop) break;
      await runOne(list[k], RUN.results[k], tab.id, { failOnErrors, stepTimeout });
      progress();
    }
  } finally {
    RUN.status = RUN.stop ? 'stopped' : 'done';
    RUN.end = Date.now();
    RUN.passed = RUN.results.filter((r) => r.status === 'passed').length;
    RUN.failed = RUN.results.filter((r) => r.status === 'failed').length;
    const { qa_test_runs = [] } = await chrome.storage.local.get('qa_test_runs');
    const keep = { ...RUN };
    delete keep.tabId;
    qa_test_runs.unshift(keep);
    const drop = qa_test_runs.splice(30);
    for (const r of drop) await QADB.delPrefix('blobs', 'run_' + r.id + '_').catch(() => {});
    await chrome.storage.local.set({ qa_test_runs });
    // результат — в сценарий, чтобы видеть статус в списке
    const tests = await getTests();
    RUN.results.forEach((r) => { const t = tests.find((x) => x.id === r.sid); if (t) t.last = { status: r.status, ts: RUN.ts, ms: r.ms, failedStep: r.failedStep }; });
    await chrome.storage.local.set({ qa_tests: tests });
    progress();
    try { await chrome.tabs.remove(tab.id); } catch (_) {}
    const tt = await chrome.tabs.query({ url: chrome.runtime.getURL('tools.html') + '*' });
    if (tt[0]) chrome.tabs.update(tt[0].id, { active: true }).catch(() => {});
  }
  return { ok: true, id: RUN.id };
}
async function runOne(t, res, tabId, { failOnErrors, stepTimeout }) {
  res.status = 'running';
  res.start = Date.now();
  progress();
  delete buffers[tabId];
  await chrome.tabs.update(tabId, { url: t.startUrl });
  await waitTabLoaded(tabId);
  await sleepMs(300);
  const t0 = Date.now();
  let failed = false;
  for (let i = 0; i < t.steps.length; i++) {
    const step = t.steps[i], sr = res.steps[i];
    if (failed || RUN.stop) { sr.status = 'skipped'; continue; }
    if (step.off) { sr.status = 'off'; continue; }
    sr.status = 'running';
    progress();
    const s0 = Date.now();
    let r;
    if (step.type === 'goto') {
      await chrome.tabs.update(tabId, { url: step.url });
      r = { ok: await waitTabLoaded(tabId) };
      if (!r.ok) r.error = 'Страница не загрузилась';
    } else {
      try {
        const [x] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: qaRunStep, args: [step, step.timeout ? step.timeout * 1000 : stepTimeout] });
        r = x && x.result ? x.result : { ok: false, error: 'Страница не ответила' };
      } catch (e) {
        // шаг вызвал переход на другую страницу — скрипт выгружен, это нормально
        r = /removed|closed|navigat|unload|No frame|Frame with ID/i.test(e.message) ? { ok: true } : { ok: false, error: e.message };
      }
      await waitTabLoaded(tabId, 15000);
      await sleepMs(step.type === 'click' || step.type === 'press' ? 350 : 80);
    }
    sr.ms = Date.now() - s0;
    sr.status = r.ok ? 'passed' : 'failed';
    if (!r.ok) {
      failed = true;
      sr.error = r.error;
      res.failedStep = i + 1;
      try {
        const tb = await chrome.tabs.get(tabId);
        const shot = await chrome.tabs.captureVisibleTab(tb.windowId, { format: 'jpeg', quality: 75 });
        sr.shotKey = `run_${RUN.id}_${t.id}_${i}`;
        await QADB.put('blobs', sr.shotKey, shot);
        sr.url = tb.url;
      } catch (_) {}
    }
    progress();
  }
  // ошибки консоли и упавшие запросы за время сценария
  const b = buffers[tabId] || {};
  let site = '';
  try { site = siteOf(t.startUrl); } catch (_) {}
  const own = (u) => { try { return !u || siteOf(u) === site; } catch (_) { return true; } };
  const errs = [];
  (b.console || []).filter((c) => c.ts >= t0 && c.level === 'error').forEach((c) => errs.push({ kind: 'console', text: String(c.text || '').split('\n')[0].slice(0, 300), loc: c.loc || '' }));
  (b.network || []).filter((n) => n.ts >= t0 && !n.mocked && (n.failed && !n.canceled || n.status >= 400) && own(n.url) && !noiseUrl(n.url))
    .forEach((n) => errs.push({ kind: 'net', text: `${n.method} ${n.failed ? 'ошибка' : n.status} ${n.url}`.slice(0, 300) }));
  res.errors = errs.slice(0, 20);
  res.ms = Date.now() - res.start;
  res.status = failed ? 'failed' : failOnErrors && errs.length ? 'failed' : 'passed';
  if (!failed && res.status === 'failed') res.reason = 'Шаги выполнены, но были ошибки консоли или упавшие запросы';
}

// ================= сообщения =================
Object.assign(handlers, {
  'open-tools': async (m, sender) => { await openTools(m.hash, m.tabId || (sender.tab && sender.tab.id)); return { ok: true }; },
  'tab-requests': async (m) => {
    const b = buffers[m.tabId] || {};
    const seen = new Set();
    const list = (b.network || []).slice().reverse().filter((e) => e.type === 'Fetch' || e.type === 'XHR').filter((e) => { const k = e.method + ' ' + e.url.split('?')[0]; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40)
      .map((e) => ({ method: e.method, url: e.url, status: e.status, failed: e.failed, mime: e.mime, body: e.body ? String(e.body).slice(0, 20000) : '', mocked: e.mocked }));
    let url = '';
    try { url = (await chrome.tabs.get(m.tabId)).url; } catch (_) {}
    return { ok: true, list, url };
  },
  'tab-auth': async (m) => {
    // ищем авторизацию в недавних запросах открытых вкладок к этому API
    let origin = '';
    try { origin = new URL(m.baseUrl).origin; } catch (_) {}
    const all = Object.values(buffers).flatMap((b) => b.network || []).filter((e) => e.reqHeaders && (!origin || e.url.startsWith(origin))).sort((a, b) => b.ts - a.ts);
    for (const e of all) {
      const h = Object.fromEntries(Object.entries(e.reqHeaders).map(([k, v]) => [k.toLowerCase(), v]));
      if (h.authorization && /^bearer\s+/i.test(h.authorization)) return { ok: true, auth: { type: 'bearer', token: h.authorization.replace(/^bearer\s+/i, '') }, from: e.url };
      if (h.authorization && /^basic\s+/i.test(h.authorization)) { try { const [u, ...p] = atob(h.authorization.slice(6)).split(':'); return { ok: true, auth: { type: 'basic', user: u, pass: p.join(':') }, from: e.url }; } catch (_) {} }
      const k = Object.keys(h).find((x) => /^(x-api-key|api-key|apikey|x-auth-token|x-access-token|x-token)$/.test(x));
      if (k) return { ok: true, auth: { type: 'apikey', where: 'header', name: k, key: h[k] }, from: e.url };
    }
    if (origin && all.length) return { ok: true, auth: { type: 'cookie' }, from: all[0].url, note: 'Токена в заголовках нет — сайт, похоже, работает через cookie' };
    return { ok: false, error: origin ? `Не нашёл запросов к ${origin} в открытых вкладках. Откройте сайт, войдите и сделайте пару действий — затем повторите.` : 'Сначала укажите базовый адрес API' };
  },
  'emu-get': async (m) => ({ ok: true, emu: EMU[m.tabId] || { net: 'none', cpu: 1, device: 'none' }, label: emuLabel(m.tabId), nets: Object.fromEntries(Object.entries(NET_PRESETS).map(([k, v]) => [k, v.label])), cpus: CPU_PRESETS, devices: Object.fromEntries(Object.entries(DEVICES).map(([k, v]) => [k, v.label + (v.w ? ` — ${v.w}×${v.h}` : '')])) }),
  'emu-set': async (m) => { try { return await setEmulation(m.tabId, m.conf); } catch (e) { return { ok: false, error: e.message }; } },
  'emu-clear': async (m) => { await clearEmulation(m.tabId); return { ok: true }; },
  'screens-shot': async (m) => { try { return await responsiveShots(m.tabId); } catch (e) { return { ok: false, error: e.message }; } },
  'rec-start': async (m) => recStart(m.tabId, m.url),
  'rec-start-url': async (m) => {
    const tab = await chrome.tabs.create({ url: m.url, active: true });
    await waitTabLoaded(tab.id);
    return recStart(tab.id);
  },
  'rec-step': async (m, sender) => {
    const tabId = sender.tab && sender.tab.id;
    const r = REC[tabId];
    if (!r) return { ok: false };
    const st = m.step;
    const last = r.steps[r.steps.length - 1];
    // ввод в то же поле — обновляем последний шаг, а не плодим новые
    if (st.type === 'fill' && last && last.type === 'fill' && JSON.stringify(last.loc) === JSON.stringify(st.loc)) last.value = st.value;
    else r.steps.push(st);
    if (m.viewport && !r.viewport) r.viewport = m.viewport;
    r.lastStepTs = Date.now();
    r.lastUrl = sender.tab.url;
    chrome.storage.session.set({ qa_rec: REC }).catch(() => {});
    pushRec(tabId);
    return { ok: true, count: r.steps.length };
  },
  'rec-undo': async (m, sender) => { const r = REC[sender.tab.id]; if (r) r.steps.pop(); pushRec(sender.tab.id); return { ok: true }; },
  'rec-save': async (m, sender) => recSave(sender.tab.id, m.name),
  'rec-cancel': async (m, sender) => recCancel(m.tabId || sender.tab.id),
  'rec-hello': async (m, sender) => { pushRec(sender.tab.id); return { ok: true, rec: !!REC[sender.tab.id] }; },
  'rec-status': async (m) => ({ rec: !!REC[m.tabId], steps: REC[m.tabId] ? REC[m.tabId].steps.length : 0 }),
  'tests-run': async (m) => { runTests(m.ids); return { ok: true }; },
  'tests-stop': async () => { if (RUN) RUN.stop = true; return { ok: true }; },
  'tests-state': async () => ({ run: RUN }),
});
