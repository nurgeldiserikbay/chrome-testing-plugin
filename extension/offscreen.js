// Offscreen-документ: запись видео вкладки и голоса с микрофона.
// Голос подмешивается в звуковую дорожку видео и одновременно пишется отдельным файлом.
let mix = null; // общий микшер звука
let video = null;
let mic = null;
let keepAlive = null;

const pick = (types) => types.find((t) => MediaRecorder.isTypeSupported(t)) || '';

function getMix() {
  if (!mix) {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    // тихий генератор, чтобы звуковая дорожка видео была непрерывной
    const g = ctx.createGain();
    g.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.connect(g).connect(dest);
    osc.start();
    mix = { ctx, dest };
  }
  mix.ctx.resume().catch(() => {});
  return mix;
}

function updateKeepAlive() {
  const busy = video || mic;
  if (busy && !keepAlive) keepAlive = setInterval(() => chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {}), 20000);
  if (!busy && keepAlive) { clearInterval(keepAlive); keepAlive = null; }
}

async function videoStart({ streamId, tabAudio, key }) {
  if (video) return { ok: true };
  const src = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { mandatory: { ...src, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 } },
    audio: tabAudio ? { mandatory: src } : false,
  });
  const m = getMix();
  let tabSrc = null;
  if (stream.getAudioTracks().length) {
    tabSrc = m.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    tabSrc.connect(m.dest);
    tabSrc.connect(m.ctx.destination); // чтобы тестировщик продолжал слышать звук вкладки
  }
  const out = new MediaStream([...stream.getVideoTracks(), ...m.dest.stream.getAudioTracks()]);
  const mime = pick(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
  const rec = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  rec.start(1000);
  const vt = stream.getVideoTracks()[0];
  if (vt) vt.onended = () => chrome.runtime.sendMessage({ type: 'off-video-ended' }).catch(() => {});
  video = { rec, chunks, stream, key, tabSrc, mime };
  updateKeepAlive();
  return { ok: true };
}

async function videoStop() {
  if (!video) return { ok: false, error: 'Видео не записывалось' };
  const v = video;
  video = null;
  if (v.rec.state !== 'inactive') await new Promise((r) => { v.rec.onstop = r; v.rec.stop(); });
  v.stream.getTracks().forEach((t) => t.stop());
  try { v.tabSrc && v.tabSrc.disconnect(); } catch (_) {}
  const blob = new Blob(v.chunks, { type: 'video/webm' });
  await QADB.put('blobs', v.key, blob);
  updateKeepAlive();
  return { ok: true, size: blob.size, mime: v.mime };
}

async function micStart({ key }) {
  if (mic) return { ok: true };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    return { ok: false, permission: ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(e.name), error: e.message || e.name };
  }
  const m = getMix();
  const src = m.ctx.createMediaStreamSource(stream);
  src.connect(m.dest);
  const rec = new MediaRecorder(stream, { mimeType: pick(['audio/webm;codecs=opus', 'audio/webm']) });
  const chunks = [];
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  rec.start(1000);
  mic = { stream, rec, chunks, key, src };
  updateKeepAlive();
  return { ok: true };
}

async function micStop() {
  if (!mic) return { ok: false, error: 'Голос не записывался' };
  const v = mic;
  mic = null;
  if (v.rec.state !== 'inactive') await new Promise((r) => { v.rec.onstop = r; v.rec.stop(); });
  v.stream.getTracks().forEach((t) => t.stop());
  try { v.src.disconnect(); } catch (_) {}
  const blob = new Blob(v.chunks, { type: 'audio/webm' });
  await QADB.put('blobs', v.key, blob);
  updateKeepAlive();
  return { ok: true, size: blob.size };
}

const H = { 'video-start': videoStart, 'video-stop': videoStop, 'mic-start': micStart, 'mic-stop': micStop };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || !H[msg.type]) return false;
  H[msg.type](msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
