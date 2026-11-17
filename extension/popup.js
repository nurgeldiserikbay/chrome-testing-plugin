const $ = (id) => document.getElementById(id);
const DEF = { bufferMin: 5, videoOnStart: false, tabAudio: false, cdp: false, reactRenders: true };
let st = null;

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const send = (m) => chrome.runtime.sendMessage(m);
function showErr(t) { $('err').textContent = t; $('err').hidden = !t; }

async function loadSettings() {
  const { qa_settings } = await chrome.storage.local.get('qa_settings');
  const s = Object.assign({}, DEF, qa_settings);
  ['videoOnStart', 'tabAudio', 'cdp', 'reactRenders'].forEach((k) => {
    $('s-' + k).checked = !!s[k];
    $('s-' + k).onchange = save;
  });
  $('s-bufferMin').value = String(s.bufferMin);
  $('s-bufferMin').onchange = save;
}
async function save() {
  await chrome.storage.local.set({
    qa_settings: {
      videoOnStart: $('s-videoOnStart').checked,
      tabAudio: $('s-tabAudio').checked,
      cdp: $('s-cdp').checked,
      reactRenders: $('s-reactRenders').checked,
      bufferMin: +$('s-bufferMin').value,
    },
  });
}

async function refresh() {
  st = await send({ type: 'status' });
  $('idle').hidden = st.active;
  $('active').hidden = !st.active;
  if (st.active) {
    $('timer').textContent = fmt(Date.now() - st.startTime);
    $('c-ann').textContent = st.annotations;
    $('c-act').textContent = st.actions;
    $('c-net').textContent = st.network;
    $('c-err').textContent = st.errors;
    $('voice').classList.toggle('rec', st.voice);
    $('voice').textContent = st.voice ? '■ Голос ' + fmt(Date.now() - st.voiceStart) : '🎤 Голос';
    $('video').classList.toggle('rec', st.video);
    $('video').textContent = st.video ? '■ Видео ' + fmt(Date.now() - st.videoStart) : '⏺ Видео';
  }
}

async function bufferInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    const { qa_buf } = await chrome.storage.session.get('qa_buf');
    const b = qa_buf && qa_buf[tab.id];
    if (!b) { $('buf').innerHTML = '<span>Буфер пуст — обновите страницу, чтобы начать сбор</span>'; return; }
    const errs = b.console.filter((c) => c.level === 'error').length;
    const netErr = b.network.filter((n) => n.failed || n.status >= 400).length;
    $('buf').innerHTML = `<span>${b.actions.length} действий</span><span>${b.network.length} запросов</span><span>${b.console.length} логов</span>` +
      (errs + netErr ? `<span class="bad">${errs + netErr} ошибок</span>` : '');
  } catch (_) {}
}

$('found').onclick = async () => {
  showErr('');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('found').disabled = true;
  const r = await send({ type: 'start-bug', tabId: tab.id });
  $('found').disabled = false;
  if (r && r.ok === false) { showErr(r.error); return; }
  window.close();
};

document.querySelectorAll('[data-tool]').forEach((b) => {
  b.onclick = async () => { await send({ type: 'tool', tool: b.dataset.tool }); window.close(); };
});

$('voice').onclick = async () => {
  showErr('');
  const r = await send({ type: 'voice-toggle' });
  if (r && r.ok === false) showErr(r.error);
  refresh();
};
$('video').onclick = async () => {
  showErr('');
  let streamId;
  if (!st.video) {
    try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: st.tabId }); } catch (e) { showErr('Не удалось получить доступ к вкладке: ' + e.message); return; }
  }
  const r = await send({ type: 'video-toggle', streamId });
  if (r && r.ok === false) showErr(r.error);
  refresh();
};
$('finish').onclick = async () => { $('finish').disabled = true; await send({ type: 'finish' }); window.close(); };
$('cancel').onclick = async () => {
  if ($('cancel').dataset.armed) { await send({ type: 'cancel' }); refresh(); return; }
  $('cancel').dataset.armed = '1';
  $('cancel').textContent = 'Нажмите ещё раз, чтобы удалить';
};
$('reports').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('report.html') }); window.close(); };
$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

loadSettings();
bufferInfo();
refresh();
setInterval(refresh, 1000);
