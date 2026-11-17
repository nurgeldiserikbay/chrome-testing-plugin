importScripts('db.js');

// ================= настройки и лимиты =================
const DEFAULT_SETTINGS = { bufferMin: 5, videoOnStart: false, tabAudio: false, cdp: false, reactRenders: true };
const BUF_LIM = { console: 800, network: 500, actions: 300, nav: 100, events: 1500, samples: 60, resources: 400 };
const SES_LIM = { console: 5000, network: 3000, actions: 2000, nav: 500, events: 10000, samples: 2000, resources: 3000 };
const BUF_BODY = 4000;

let buffers = {}; // tabId -> {console, network, actions, nav}
let S = null; // активный баг-репорт (сессия)

const ready = (async () => {
  try {
    const r = await chrome.storage.session.get('qa_buf');
    buffers = r.qa_buf || {};
  } catch (_) {}
  try {
    const r = await chrome.storage.local.get('qa_active');
    if (r.qa_active) {
      const s = await QADB.get('reports', r.qa_active);
      S = s && s.active ? s : null;
      if (!S) await chrome.storage.local.remove('qa_active');
    }
  } catch (_) {}
})();

async function getSettings() {
  const r = await chrome.storage.local.get('qa_settings');
  return Object.assign({}, DEFAULT_SETTINGS, r.qa_settings || {});
}

const throttle = (fn, ms) => {
  let t = null;
  return () => {
    if (t) return;
    t = setTimeout(() => { t = null; fn(); }, ms);
  };
};
const saveBuf = throttle(() => chrome.storage.session.set({ qa_buf: buffers }).catch(() => {}), 2000);
const saveSession = throttle(() => { if (S) QADB.put('reports', S.id, S).catch(() => {}); }, 1000);
const saveSessionNow = async () => { if (S) await QADB.put('reports', S.id, S); };

// ================= фоновый буфер =================
const KINDS = ['console', 'network', 'actions', 'nav', 'events', 'samples', 'resources'];
function getBuf(tabId) {
  const b = (buffers[tabId] ||= {});
  for (const k of KINDS) b[k] ||= [];
  return b;
}
function pushBuf(tabId, kind, e) {
  const arr = getBuf(tabId)[kind];
  arr.push(e);
  const cut = Date.now() - 15 * 60 * 1000; // буфер храним максимум 15 минут
  while (arr.length && (arr.length > BUF_LIM[kind] || arr[0].ts < cut)) arr.shift();
}

function ingest(tabId, kind, e) {
  e.ts = e.ts || Date.now();
  const inSession = S && S.active && S.tabId === tabId;
  if (inSession) {
    const skipHookNet = (kind === 'network' || kind === 'resources') && S.meta.cdp && e.source !== 'cdp';
    if (!skipHookNet) {
      S[kind] ||= [];
      if (S[kind].length < SES_LIM[kind]) S[kind].push(e);
      else S.meta.truncated = true;
      saveSession();
    }
  }
  if (e.source === 'cdp') return; // данные DevTools-протокола только в сессию
  const be = kind === 'network' && e.body && e.body.length > BUF_BODY ? { ...e, body: e.body.slice(0, BUF_BODY) + '\n… [обрезано]' } : e;
  pushBuf(tabId, kind, be);
  saveBuf();
}

// ================= жизненный цикл бага =================
const status = () => ({
  active: !!(S && S.active),
  id: S && S.id,
  tabId: S && S.tabId,
  startTime: S && S.startTime,
  annotations: S ? S.annotations.length : 0,
  network: S ? S.network.length : 0,
  console: S ? S.console.length : 0,
  errors: S ? S.console.filter((c) => c.level === 'error').length + S.network.filter((n) => n.failed || n.status >= 400).length : 0,
  actions: S ? S.actions.length : 0,
  events: S ? (S.events || []).length : 0,
  video: !!(S && S.videos.some((v) => v.recording)),
  videoStart: S && (S.videos.find((v) => v.recording) || {}).start,
  voice: !!(S && S.voice.some((v) => v.recording)),
  voiceStart: S && (S.voice.find((v) => v.recording) || {}).start,
  cdp: !!(S && S.meta.cdp),
});

function pushOverlayState() {
  if (!S || !S.active) return;
  chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-state', state: status() }).catch(() => {});
}
function toast(text, kind = 'info') {
  if (!S || !S.active) return;
  chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-toast', text, kind }).catch(() => {});
}

async function injectOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js', 'overlay.js'] });
  } catch (_) {}
}

async function startBug(tabId) {
  await ready;
  if (S && S.active) {
    if (S.tabId === tabId) {
      await injectOverlay(tabId);
      return status();
    }
    await finishBug({ open: false });
  }
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/.test(tab.url || '')) throw new Error('На служебных страницах Chrome фиксация недоступна. Откройте тестируемый сайт.');
  const st = await getSettings();
  const now = Date.now();
  const from = now - st.bufferMin * 60 * 1000;
  const b = getBuf(tabId);
  const within = (arr) => arr.filter((e) => e.ts >= from).map((e) => ({ ...e }));
  S = {
    id: 'r' + now,
    active: true,
    tabId,
    startTime: now,
    endTime: 0,
    options: { tabAudio: st.tabAudio, bufferMin: st.bufferMin },
    meta: {
      startUrl: tab.url,
      title: tab.title,
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: (navigator.userAgentData && navigator.userAgentData.platform) || '',
      bufferFrom: from,
    },
    console: within(b.console),
    network: within(b.network),
    actions: within(b.actions),
    nav: within(b.nav),
    events: within(b.events),
    samples: within(b.samples),
    resources: within(b.resources),
    snapshot: null,
    annotations: [],
    videos: [],
    voice: [],
    fields: null,
  };
  if (!S.nav.length || S.nav[S.nav.length - 1].url !== tab.url) S.nav.push({ ts: now, url: tab.url, title: tab.title });
  await chrome.storage.local.set({ qa_active: S.id });
  if (st.cdp) await attachCdp(tabId);
  S.snapshot = await takeSnapshot(tabId);
  if (S.meta.cdp) S.meta.cdpMetricsStart = await cdpMetrics(tabId);
  await saveSessionNow();
  setBadge(true);
  await injectOverlay(tabId);
  if (st.videoOnStart) {
    try { await startVideo(); } catch (e) { toast(e.message, 'error'); }
  }
  return status();
}

let finishing = null;
function finishBug(opts) {
  if (!finishing) finishing = doFinish(opts).finally(() => (finishing = null));
  return finishing;
}
async function doFinish({ open = true } = {}) {
  await ready;
  if (!S || !S.active) return { ok: false, error: 'Нет активного бага' };
  try { await stopVoice(); } catch (_) {}
  try { await stopVideo(); } catch (_) {}
  S.snapshotEnd = await takeSnapshot(S.tabId);
  if (S.meta.cdp) {
    S.meta.cdpMetricsEnd = await cdpMetrics(S.tabId);
    try { await chrome.debugger.detach({ tabId: S.tabId }); } catch (_) {}
    S.meta.cdp = false;
  }
  S.active = false;
  S.endTime = Date.now();
  try { S.meta.endUrl = (await chrome.tabs.get(S.tabId)).url; } catch (_) {}
  chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-remove' }).catch(() => {});
  const id = S.id;
  await saveSessionNow();
  await chrome.storage.local.remove('qa_active');
  S = null;
  setBadge(false);
  await maybeCloseOffscreen();
  if (open) await chrome.tabs.create({ url: chrome.runtime.getURL('report.html?id=' + id) });
  return { ok: true, id };
}

async function cancelBug() {
  await ready;
  if (!S || !S.active) return { ok: false };
  const id = S.id;
  try { await stopVoice(); } catch (_) {}
  try { await stopVideo(); } catch (_) {}
  if (S.meta.cdp) { try { await chrome.debugger.detach({ tabId: S.tabId }); } catch (_) {} }
  chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-remove' }).catch(() => {});
  S = null;
  await chrome.storage.local.remove('qa_active');
  await QADB.del('reports', id).catch(() => {});
  await QADB.delPrefix('blobs', id + '_').catch(() => {});
  setBadge(false);
  await maybeCloseOffscreen();
  return { ok: true };
}

function setBadge(on) {
  const rec = on && S && S.videos.some((v) => v.recording);
  chrome.action.setBadgeText({ text: on ? (rec ? 'REC' : 'BUG') : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff2d55' });
}

// ================= пометки и скриншоты =================
async function addAnnotation(m, sender) {
  await ready;
  if (!S || !S.active || !sender.tab || sender.tab.id !== S.tabId) return { ok: false, error: 'Фиксация бага не активна' };
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
  } catch (e) {
    return { ok: false, error: 'Не удалось сделать скриншот: ' + e.message };
  }
  const n = S.annotations.reduce((m, a) => Math.max(m, a.n), 0) + 1; // номера не переиспользуются после удаления
  const key = `${S.id}_shot_${n}`;
  await QADB.put('blobs', key, dataUrl);
  S.annotations.push({
    n,
    ts: Date.now(),
    kind: m.kind,
    comment: m.comment || '',
    element: m.element || null,
    shape: m.shape || null,
    viewport: m.viewport || null,
    url: sender.tab.url,
    title: sender.tab.title,
    shotKey: key,
    voiceRecording: S.voice.some((v) => v.recording),
  });
  if (m.viewport && !S.meta.viewport) S.meta.viewport = m.viewport;
  await saveSessionNow();
  pushOverlayState();
  return { ok: true, n, count: S.annotations.length };
}

async function deleteAnnotation(m) {
  await ready;
  if (!S || !S.active) return { ok: false, error: 'Фиксация бага не активна' };
  const a = S.annotations.find((x) => x.n === m.n);
  if (!a) return { ok: false, error: 'Пометка не найдена' };
  S.annotations = S.annotations.filter((x) => x !== a);
  await QADB.del('blobs', a.shotKey).catch(() => {});
  await saveSessionNow();
  pushOverlayState();
  return { ok: true, count: S.annotations.length };
}

async function updateAnnotation(m, sender) {
  await ready;
  if (!S || !S.active) return { ok: false, error: 'Фиксация бага не активна' };
  const a = S.annotations.find((x) => x.n === m.n);
  if (!a) return { ok: false, error: 'Пометка не найдена' };
  a.comment = m.comment || '';
  if (m.recapture && sender.tab && sender.tab.id === S.tabId) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      await QADB.put('blobs', a.shotKey, dataUrl);
      if (m.shape) a.shape = m.shape;
      if (m.viewport) a.viewport = m.viewport;
      a.url = sender.tab.url;
    } catch (e) {
      await saveSessionNow();
      return { ok: false, error: 'Текст сохранён, но скриншот не обновился: ' + e.message };
    }
  }
  a.edited = Date.now();
  await saveSessionNow();
  return { ok: true, count: S.annotations.length };
}

// ================= offscreen: видео и микрофон =================
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Запись видео вкладки и голосовых комментариев тестировщика',
  });
}
async function maybeCloseOffscreen() {
  if (S && (S.videos.some((v) => v.recording) || S.voice.some((v) => v.recording))) return;
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (ctx.length) await chrome.offscreen.closeDocument();
  } catch (_) {}
}
const sendOff = (msg) => chrome.runtime.sendMessage({ target: 'offscreen', ...msg });

async function startVideo(streamId) {
  if (!S || !S.active) throw new Error('Сначала нажмите «Нашёл баг»');
  if (S.videos.some((v) => v.recording)) return status();
  try {
    if (!streamId) streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: S.tabId });
  } catch (e) {
    throw new Error('Chrome требует подтверждения для записи: нажмите иконку расширения → «⏺ Видео». (' + e.message + ')');
  }
  await ensureOffscreen();
  const n = S.videos.length + 1;
  const key = `${S.id}_video_${n}`;
  const r = await sendOff({ type: 'video-start', streamId, tabAudio: !!S.options.tabAudio, key });
  if (!r || !r.ok) {
    await maybeCloseOffscreen();
    throw new Error('Не удалось начать запись видео: ' + ((r && r.error) || 'неизвестная ошибка'));
  }
  S.videos.push({ n, key, start: Date.now(), recording: true });
  setBadge(true);
  await saveSessionNow();
  pushOverlayState();
  return status();
}
async function stopVideo() {
  const v = S && S.videos.find((x) => x.recording);
  if (!v) return status();
  let r = null;
  try { r = await sendOff({ type: 'video-stop' }); } catch (e) { r = { ok: false, error: e.message }; }
  v.recording = false;
  v.end = Date.now();
  v.saved = !!(r && r.ok);
  v.size = r && r.size;
  v.mime = r && r.mime;
  if (!v.saved) v.error = r && r.error;
  if (S.active) setBadge(true);
  await saveSessionNow();
  await maybeCloseOffscreen();
  pushOverlayState();
  return status();
}

async function startVoice() {
  if (!S || !S.active) throw new Error('Сначала нажмите «Нашёл баг»');
  if (S.voice.some((v) => v.recording)) return status();
  await ensureOffscreen();
  const n = S.voice.length + 1;
  const key = `${S.id}_voice_${n}`;
  const r = await sendOff({ type: 'mic-start', key });
  if (!r || !r.ok) {
    await maybeCloseOffscreen();
    if (r && r.permission) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('mic.html'), active: true });
      throw new Error('Нужно один раз разрешить микрофон: подтвердите доступ в открывшейся вкладке и нажмите 🎤 снова.');
    }
    throw new Error('Микрофон недоступен: ' + ((r && r.error) || 'неизвестная ошибка'));
  }
  S.voice.push({ n, key, start: Date.now(), recording: true });
  await saveSessionNow();
  pushOverlayState();
  return status();
}
async function stopVoice() {
  const v = S && S.voice.find((x) => x.recording);
  if (!v) return status();
  let r = null;
  try { r = await sendOff({ type: 'mic-stop' }); } catch (e) { r = { ok: false, error: e.message }; }
  v.recording = false;
  v.end = Date.now();
  v.saved = !!(r && r.ok);
  v.size = r && r.size;
  if (!v.saved) v.error = r && r.error;
  await saveSessionNow();
  await maybeCloseOffscreen();
  pushOverlayState();
  return status();
}

// ================= DevTools-протокол (полный захват сети) =================
const cdpReq = {};
const cdp = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);
async function attachCdp(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await cdp(tabId, 'Network.enable', { maxPostDataSize: 20000 });
    await cdp(tabId, 'Log.enable');
    await cdp(tabId, 'Performance.enable').catch(() => {});
    S.meta.cdp = true;
    S.meta.cdpUsed = true;
  } catch (e) {
    S.meta.cdpError = e.message;
  }
}
async function cdpMetrics(tabId) {
  try {
    const r = await cdp(tabId, 'Performance.getMetrics');
    return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
  } catch (_) {
    return null;
  }
}
async function takeSnapshot(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'qa-snapshot' }, { frameId: 0 });
  } catch (_) {
    return null;
  }
}

// ================= подключение счётчика перерисовок React =================
async function syncReactProbe() {
  try {
    const st = await getSettings();
    const ex = await chrome.scripting.getRegisteredContentScripts({ ids: ['qa-react'] });
    if (st.reactRenders && !ex.length) {
      await chrome.scripting.registerContentScripts([
        { id: 'qa-react', js: ['react-probe.js'], matches: ['<all_urls>'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
      ]);
    } else if (!st.reactRenders && ex.length) {
      await chrome.scripting.unregisterContentScripts({ ids: ['qa-react'] });
    }
  } catch (e) {
    console.warn('[QA Bug Recorder] react probe', e);
  }
}
syncReactProbe();
chrome.storage.onChanged.addListener((ch) => { if (ch.qa_settings) syncReactProbe(); });

const trunc = (s, n) => (s == null ? s : s.length > n ? s.slice(0, n) + `\n… [обрезано, всего ${s.length} символов]` : s);
function applyResp(e, r) {
  e.status = r.status;
  e.statusText = r.statusText;
  e.mime = r.mimeType;
  e.resHeaders = r.headers;
  e.remoteIP = r.remoteIPAddress;
  e.protocol = r.protocol;
  e.fromCache = !!(r.fromDiskCache || r.fromPrefetchCache || r.fromServiceWorker);
}

chrome.debugger.onEvent.addListener(async (src, method, p) => {
  await ready;
  if (!S || !S.active || src.tabId !== S.tabId) return;
  const tabId = src.tabId;
  switch (method) {
    case 'Network.requestWillBeSent': {
      const prev = cdpReq[p.requestId];
      if (p.redirectResponse && prev) {
        applyResp(prev, p.redirectResponse);
        prev.redirectedTo = p.request.url;
        prev.finished = true;
      }
      const e = {
        id: p.requestId,
        ts: p.wallTime ? Math.round(p.wallTime * 1000) : Date.now(),
        method: p.request.method,
        url: p.request.url,
        type: p.type || 'Other',
        reqHeaders: p.request.headers,
        postData: trunc(p.request.postData, 20000),
        initiator: p.initiator && p.initiator.type,
        source: 'cdp',
        _t: p.timestamp,
      };
      cdpReq[p.requestId] = e;
      ingest(tabId, 'network', e);
      break;
    }
    case 'Network.responseReceived': {
      const e = cdpReq[p.requestId];
      if (e) { applyResp(e, p.response); if (p.type) e.type = p.type; saveSession(); }
      break;
    }
    case 'Network.loadingFinished': {
      const e = cdpReq[p.requestId];
      if (!e) break;
      e.finished = true;
      e.size = p.encodedDataLength;
      e.duration = Math.round((p.timestamp - e._t) * 1000);
      delete cdpReq[p.requestId];
      if (['XHR', 'Fetch'].includes(e.type)) {
        try {
          const b = await cdp(tabId, 'Network.getResponseBody', { requestId: p.requestId });
          e.body = b.base64Encoded ? `[бинарные данные, ${b.body.length} символов base64]` : trunc(b.body, 20000);
        } catch (_) {}
      }
      saveSession();
      break;
    }
    case 'Network.loadingFailed': {
      const e = cdpReq[p.requestId];
      if (!e) break;
      e.failed = true;
      e.error = p.errorText;
      e.canceled = p.canceled;
      e.blocked = p.blockedReason || (p.corsErrorStatus && 'CORS: ' + p.corsErrorStatus.corsError);
      e.duration = Math.round((p.timestamp - e._t) * 1000);
      delete cdpReq[p.requestId];
      saveSession();
      break;
    }
    case 'Log.entryAdded': {
      const en = p.entry;
      ingest(tabId, 'console', {
        ts: en.timestamp ? Math.round(en.timestamp) : Date.now(),
        level: en.level === 'verbose' ? 'debug' : en.level === 'warning' ? 'warn' : en.level,
        source: 'browser:' + en.source,
        text: en.text + (en.url ? ' — ' + en.url : ''),
        loc: en.url ? `${en.url}${en.lineNumber != null ? ':' + (en.lineNumber + 1) : ''}` : '',
      });
      break;
    }
  }
});

chrome.debugger.onDetach.addListener(async (src, reason) => {
  await ready;
  if (S && S.active && src.tabId === S.tabId) {
    S.meta.cdp = false;
    S.meta.cdpDetached = reason;
    saveSession();
    if (reason !== 'target_closed') toast('Расширенный захват сети отключён (панель отладки закрыта). Сбор продолжается в обычном режиме.', 'warn');
  }
});

// ================= события вкладок =================
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  await ready;
  if (info.url && /^(https?|file):/.test(info.url)) ingest(tabId, 'nav', { ts: Date.now(), url: info.url, title: tab.title });
  if (S && S.active && tabId === S.tabId && info.status === 'complete') injectOverlay(tabId);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  delete buffers[tabId];
  saveBuf();
  if (S && S.active && S.tabId === tabId) finishBug({ open: true });
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  await ready;
  try {
    const t = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!t) return;
    if (cmd === 'found-bug') await startBug(t.id);
    else if (cmd === 'finish') await finishBug({ open: true });
    else if (cmd === 'pick-element' || cmd === 'annotate') {
      if (!S || !S.active) await startBug(t.id);
      chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-tool', tool: cmd === 'pick-element' ? 'element' : 'arrow' }).catch(() => {});
    }
  } catch (e) {
    console.warn('[QA Bug Recorder]', e);
  }
});

// ================= сообщения =================
const handlers = {
  buf: async (m, sender) => {
    await ready;
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) return {};
    for (const it of m.items || []) {
      const kind = { console: 'console', net: 'network', action: 'actions', event: 'events', sample: 'samples', res: 'resources' }[it.kind];
      if (kind) ingest(tabId, kind, it.data);
    }
    return {};
  },
  keepalive: async () => ({ ok: true }),
  status: async () => { await ready; return status(); },
  'start-bug': async (m) => startBug(m.tabId),
  finish: async () => finishBug({ open: true }),
  cancel: async () => cancelBug(),
  'video-toggle': async (m) => {
    await ready;
    return S && S.videos.some((v) => v.recording) ? stopVideo() : startVideo(m.streamId);
  },
  'voice-toggle': async () => {
    await ready;
    return S && S.voice.some((v) => v.recording) ? stopVoice() : startVoice();
  },
  tool: async (m) => {
    await ready;
    if (!S || !S.active) return { ok: false };
    await chrome.tabs.update(S.tabId, { active: true });
    chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-tool', tool: m.tool }).catch(() => {});
    return { ok: true };
  },
  annotation: (m, sender) => addAnnotation(m, sender),
  'annotation-delete': (m) => deleteAnnotation(m),
  'annotation-update': (m, sender) => updateAnnotation(m, sender),
  'annotations-list': async () => {
    await ready;
    return { ok: true, items: S && S.active ? S.annotations.map((a) => ({ n: a.n, kind: a.kind, comment: a.comment, url: a.url })) : [] };
  },
  'overlay-hello': async (m, sender) => {
    await ready;
    const st = status();
    st.mine = !!(sender.tab && S && S.tabId === sender.tab.id);
    return st;
  },
  'off-video-ended': async () => { await ready; if (S) { await stopVideo(); toast('Запись видео остановлена'); } return {}; },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  const h = handlers[msg.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg, sender))
    .then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
