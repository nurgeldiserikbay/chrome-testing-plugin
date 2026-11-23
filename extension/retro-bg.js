// ⏪ «Нашёл баг» задним числом: тестировщику не нужно ничего включать заранее.
// Пока вкладка открыта, расширение помнит последние минуты: повтор страницы (rrweb),
// скриншоты после действий, действия, запросы и консоль. По кнопке всё за выбранный
// период становится пунктом отчёта, а действия можно превратить в автотест.
// Подключается из background.js (importScripts) и пользуется его функциями.

// сколько помнить — настройка «⏪ Помнить последние» (MEM_MIN в background.js)
const rrKeep = () => memMs();
const rrCap = () => Math.min(120e6, 40e6 * Math.max(1, MEM_MIN / 10)); // и не больше ~40 МБ на 10 минут
const shotKeep = () => memMs();
const shotLim = () => Math.round(90 * Math.max(1, MEM_MIN / 10));
const RETRO_DEF = 60;             // период по умолчанию, секунд

let RR = {}; // tabId -> { seq, size, chunks: [{ key, t0, t1, meta, size }] }
const rrReady = chrome.storage.session.get('qa_rr').then((r) => { RR = r.qa_rr || {}; }).catch(() => {});
const saveRR = throttle(() => chrome.storage.session.set({ qa_rr: RR }).catch(() => {}), 1500);

async function retroEnabled() {
  const [st, c] = await Promise.all([getSettings(), chrome.storage.local.get('qa_consent')]);
  return { consent: !!(c.qa_consent && c.qa_consent.v >= 2), replay: st.replay !== false, actShots: st.actShots !== false, st };
}

// ---------- повтор страницы ----------
async function rrIngest(tabId, chunks) {
  await rrReady;
  const events = [];
  for (const c of chunks || []) { try { events.push(...JSON.parse(c)); } catch (_) {} }
  if (!events.length) return;
  const r = (RR[tabId] ||= { seq: 0, size: 0, chunks: [] });
  const size = (chunks || []).reduce((s, c) => s + c.length, 0);
  const key = `rr_${tabId}_${++r.seq}`;
  const ts = events.map((e) => e.timestamp).filter(Boolean);
  await QADB.put('blobs', key, events);
  r.chunks.push({ key, t0: Math.min(...ts), t1: Math.max(...ts), meta: events.some((e) => e.type === 4), size });
  r.size += size;
  await rrPrune(tabId);
  saveRR();
}
async function rrDrop(r, n) {
  const gone = r.chunks.splice(0, n);
  for (const c of gone) { r.size -= c.size; await QADB.del('blobs', c.key).catch(() => {}); }
}
async function rrPrune(tabId) {
  const r = RR[tabId];
  if (!r) return;
  const cut = Date.now() - rrKeep();
  // оставляем последний «полный снимок» до границы — без него повтор не собрать
  let keep = -1;
  r.chunks.forEach((c, i) => { if (c.meta && c.t0 <= cut) keep = i; });
  if (keep > 0) await rrDrop(r, keep);
  while (r.size > rrCap()) {
    const next = r.chunks.findIndex((c, i) => i > 0 && c.meta);
    if (next <= 0) break;
    await rrDrop(r, next);
  }
}
/** события повтора за период: начиная с ближайшего полного снимка до from */
async function rrEvents(tabId, from, to) {
  await rrReady;
  const r = RR[tabId];
  if (!r || !r.chunks.length) return [];
  let start = -1;
  r.chunks.forEach((c, i) => { if (c.meta && c.t0 <= from) start = i; });
  if (start < 0) start = r.chunks.findIndex((c) => c.meta);
  if (start < 0) return [];
  const out = [];
  for (const c of r.chunks.slice(start)) {
    if (c.t0 > to + 2000) break;
    const ev = await QADB.get('blobs', c.key).catch(() => null);
    if (ev) out.push(...ev);
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  const first = out.findIndex((e) => e.type === 4);
  return first < 0 ? [] : out.slice(first).filter((e) => e.timestamp <= to + 1000);
}
async function rrClear(tabId) {
  await rrReady;
  const r = RR[tabId];
  if (r) await rrDrop(r, r.chunks.length);
  delete RR[tabId];
  saveRR();
}

// ---------- скриншоты после действий ----------
const shotBusy = {};
async function actShot(tab, label, url) {
  if (!tab || !tab.active || shotBusy[tab.id]) return;
  const en = await retroEnabled();
  if (!en.consent || !en.actShots) return;
  shotBusy[tab.id] = true;
  try {
    await new Promise((r) => setTimeout(r, 350)); // даём странице отреагировать на действие
    const [cur] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (!cur || cur.id !== tab.id) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 55 });
    const ts = Date.now();
    const key = `as_${tab.id}_${ts}`;
    await QADB.put('blobs', key, dataUrl);
    const arr = (getBuf(tab.id).shots ||= []);
    arr.push({ ts, key, label: String(label || '').slice(0, 140), url: url || cur.url });
    const cut = ts - shotKeep();
    while (arr.length && (arr.length > shotLim() || arr[0].ts < cut)) QADB.del('blobs', arr.shift().key).catch(() => {});
    saveBuf();
  } catch (_) {
    // лимит Chrome на частоту скриншотов или служебная страница — просто пропускаем
  } finally {
    setTimeout(() => { delete shotBusy[tab.id]; }, 600);
  }
}

// ---------- 🐞 «Нашёл баг»: пункт «Последние N секунд» ----------
const ALL_PARTS = { replay: true, shots: true, steps: true, console: true, network: true, events: true };
async function addRetro(tabId, sec, parts) {
  parts = { ...ALL_PARTS, ...(parts || (await getSettings()).retroParts || {}) };
  if (!S || !S.active || S.tabId !== tabId) return { ok: false, error: 'Фиксация бага не активна' };
  const to = Date.now();
  const from = to - sec * 1000;
  const n = (S.videos || []).reduce((m, v) => Math.max(m, v.n || 0), 0) + 1;
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch (_) {}
  // повтор страницы
  const ev = parts.replay ? await rrEvents(tabId, from, to) : [];
  let replayKey = null;
  if (ev.length > 2) { replayKey = `${S.id}_replay_${n}`; await QADB.put('blobs', replayKey, ev); }
  // скриншоты после действий + снимок «сейчас»
  const shots = [];
  const src = parts.shots ? (getBuf(tabId).shots || []).filter((x) => x.ts >= from - 1500) : [];
  for (const [i, x] of src.entries()) {
    const d = await QADB.get('blobs', x.key).catch(() => null);
    if (!d) continue;
    const key = `${S.id}_rs_${n}_${i}`;
    await QADB.put('blobs', key, d);
    shots.push({ ts: x.ts, key, label: x.label, url: x.url });
  }
  if (tab && tab.active) {
    try {
      const ready = await chrome.tabs.sendMessage(tabId, { type: 'qa-capture-prep' }).catch(() => null);
      const d = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
      if (ready) chrome.tabs.sendMessage(tabId, { type: 'qa-capture-done' }).catch(() => {});
      const key = `${S.id}_rs_${n}_now`;
      await QADB.put('blobs', key, d);
      shots.push({ ts: Date.now(), key, label: 'Момент, когда нажали «Нашёл баг»', url: tab.url, now: true });
    } catch (_) {}
  }
  S.videos.push({ n, retro: true, parts, start: from, end: to, sec, replayKey, shots, url: tab && tab.url, title: tab && tab.title, cond: emuLabel(tabId) });
  await saveSessionNow();
  pushOverlayState();
  const what = [replayKey ? 'повтор экрана' : null, shots.length ? `скриншотов после действий: ${shots.length}` : null, parts.steps ? 'шаги' : null, parts.console ? 'консоль' : null, parts.network ? 'запросы' : null, parts.events ? 'события страницы' : null].filter(Boolean);
  toast(`⏪ Сохранено за последние ${fmtSec(sec)}: ${what.join(', ')}. Отметьте проблему (🎯 ➚ ▭ 💬) и нажмите «✓ Готово».`);
  return { ok: true, n, replay: !!replayKey, shots: shots.length };
}
const fmtSec = (s) => (s < 60 ? `${s} с` : `${Math.round(s / 60)} мин`);

async function foundBug(tabId, sec, parts) {
  await ready;
  const st = await getSettings();
  sec = +sec || st.retroSec || RETRO_DEF;
  if (!S || !S.active || S.tabId !== tabId) {
    const r = await startBug(tabId, { retroSec: sec });
    if (r && r.ok === false) return r;
  }
  const r = await addRetro(tabId, sec, parts);
  if (r.ok === false) return r;
  return { ...status(), retro: r };
}

// ---------- 🤖 автотест из последних действий ----------
function stepsFromActions(acts, navs) {
  const steps = [];
  let skipped = 0;
  const tl = [...acts.map((a) => ({ ...a, _k: 'a' })), ...navs.map((n) => ({ ...n, _k: 'n' }))].sort((a, b) => a.ts - b.ts);
  let lastActTs = 0;
  for (const a of tl) {
    if (a._k === 'n') {
      // переход без клика/Enter перед ним — тестировщик открыл адрес сам
      if (steps.length && a.ts - lastActTs > 3000 && !/^(click|press)$/.test((steps[steps.length - 1] || {}).type)) steps.push({ type: 'goto', url: a.url });
      continue;
    }
    lastActTs = a.ts;
    if (!a.loc || !a.loc.length) { if (a.kind !== 'submit') skipped++; continue; }
    const last = steps[steps.length - 1];
    if (a.kind === 'click') {
      if (a.forCheck || (a.tag === 'input' && /^(checkbox|radio)$/i.test(a.type))) continue; // отметку запишем через change
      steps.push({ type: 'click', loc: a.loc, desc: a.desc });
    } else if (a.kind === 'input') {
      if (a.type === 'file') { skipped++; continue; }
      const st = { type: 'fill', loc: a.loc, desc: a.desc, value: a.secret ? '' : a.value || '', secret: !!a.secret };
      if (last && last.type === 'fill' && JSON.stringify(last.loc) === JSON.stringify(a.loc)) Object.assign(last, st);
      else steps.push(st);
    } else if (a.kind === 'select') steps.push({ type: 'select', loc: a.loc, desc: a.desc, value: a.optValue != null ? a.optValue : a.value, label: a.value });
    else if (a.kind === 'toggle') steps.push({ type: 'check', loc: a.loc, desc: a.desc, value: !!a.checked });
    else if (a.kind === 'key' && a.key === 'Enter') steps.push({ type: 'press', key: 'Enter', loc: a.loc, desc: a.desc });
  }
  return { steps, skipped };
}
async function retroTest(tabId, sec) {
  await ready;
  sec = +sec || (await getSettings()).retroSec || RETRO_DEF;
  const from = Date.now() - sec * 1000;
  const b = getBuf(tabId);
  const acts = b.actions.filter((a) => a.ts >= from);
  if (!acts.length) return { ok: false, error: `За последние ${fmtSec(sec)} действий на этой вкладке не было. Выберите период больше или сделайте сценарий ещё раз.` };
  const navsBefore = b.nav.filter((n) => n.ts <= acts[0].ts);
  const startUrl = acts[0].page || (navsBefore.length ? navsBefore[navsBefore.length - 1].url : '');
  const { steps, skipped } = stepsFromActions(acts, b.nav.filter((n) => n.ts > acts[0].ts));
  if (!steps.length) return { ok: false, error: 'Не получилось собрать шаги: действия записаны до обновления расширения. Обновите страницу и пройдите сценарий ещё раз.' };
  const { qa_tests = [] } = await chrome.storage.local.get('qa_tests');
  const t = {
    id: 't' + Date.now().toString(36), name: `Из последних действий · ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
    startUrl, steps, created: Date.now(), updated: Date.now(), viewport: null, fromBuffer: { sec, skipped },
  };
  qa_tests.push(t);
  await chrome.storage.local.set({ qa_tests });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`tools.html?open=${t.id}${tabId ? '&tab=' + tabId : ''}#tests`) });
  return { ok: true, id: t.id, steps: steps.length, skipped };
}

// ---------- уборка ----------
chrome.tabs.onRemoved.addListener((tabId) => {
  rrClear(tabId);
  const sh = buffers[tabId] && buffers[tabId].shots;
  if (sh) sh.forEach((x) => QADB.del('blobs', x.key).catch(() => {}));
});
// после перезапуска браузера вкладки другие — удаляем осиротевшие повторы и скриншоты
setTimeout(async () => {
  await ready; await rrReady;
  const live = new Set([
    ...Object.values(RR).flatMap((r) => r.chunks.map((c) => c.key)),
    ...Object.values(buffers).flatMap((b) => (b.shots || []).map((x) => x.key)),
  ]);
  try {
    const keys = await QADB.keys('blobs');
    for (const k of keys) if (/^(rr|as)_/.test(k) && !live.has(k)) await QADB.del('blobs', k).catch(() => {});
  } catch (_) {}
}, 8000);

Object.assign(handlers, {
  rr: async (m, sender) => {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null || sender.frameId) return {};
    await rrIngest(tabId, m.chunks);
    return {};
  },
  'act-shot': async (m, sender) => { if (sender.tab && !sender.frameId) actShot(sender.tab, m.label, m.url); return {}; },
  'found-bug': async (m) => foundBug(m.tabId, m.sec, m.parts),
  'retro-add': async (m) => { await ready; return S && S.active ? addRetro(S.tabId, +m.sec || RETRO_DEF, m.parts) : { ok: false, error: 'Фиксация бага не активна' }; },
  'retro-test': async (m) => retroTest(m.tabId, m.sec),
  'retro-info': async (m) => {
    await ready; await rrReady;
    const b = buffers[m.tabId];
    const r = RR[m.tabId];
    const en = await retroEnabled();
    return {
      ok: true,
      replayFrom: r && r.chunks.length ? (r.chunks.find((c) => c.meta) || r.chunks[0]).t0 : null,
      shots: b && b.shots ? b.shots.length : 0,
      actions: b ? b.actions.length : 0,
      oldest: b ? Math.min(...['actions', 'network', 'console'].map((k) => (b[k] && b[k][0] ? b[k][0].ts : Date.now()))) : null,
      replay: en.replay, actShots: en.actShots, consent: en.consent, memoryMin: MEM_MIN,
    };
  },
});
