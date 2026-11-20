// Запись автотеста: фиксирует клики, ввод, выбор и проверки, которые ставит тестировщик.
// Внедряется в страницу на время записи (и после каждого перехода). Изолированный мир.
(() => {
  if (globalThis.__qaRecorder) { globalThis.__qaRecorder.hello(); return; }
  const HOST_TAG = 'qa-rec-bar';
  let on = false, asserting = false, stepsCount = 0;

  // ---------- устойчивые локаторы ----------
  const TEST_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-test-id', 'data-automation-id'];
  const esc = (v) => CSS.escape(v);
  const qv = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const genId = (id) => /\d{3,}|^:r|^(ember|react|radix|headlessui|mui|rc_|downshift|chakra)/i.test(id) || id.length > 40;
  const textOf = (el) => norm(el.innerText || el.textContent || el.value || '');
  const unique = (css, el) => { try { const l = document.querySelectorAll(css); return l.length === 1 && l[0] === el; } catch (_) { return false; } };
  function cssPath(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 6; e = e.parentElement) {
      if (e.id && !genId(e.id)) { parts.unshift('#' + esc(e.id)); break; }
      const ta = TEST_ATTRS.find((a) => e.getAttribute(a));
      if (ta) { parts.unshift(`[${ta}=${qv(e.getAttribute(ta))}]`); break; }
      let p = e.tagName.toLowerCase();
      const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  }
  function locators(el) {
    const tag = el.tagName.toLowerCase();
    const L = [];
    const add = (css) => { if (css && unique(css, el) && !L.some((x) => x.css === css)) L.push({ css }); };
    TEST_ATTRS.forEach((a) => el.getAttribute(a) && add(`[${a}=${qv(el.getAttribute(a))}]`));
    if (el.id && !genId(el.id)) add('#' + esc(el.id));
    if (el.getAttribute('name')) add(`${tag}[name=${qv(el.getAttribute('name'))}]`);
    if (el.getAttribute('aria-label')) add(`${tag}[aria-label=${qv(el.getAttribute('aria-label'))}]`);
    if (el.getAttribute('placeholder')) add(`${tag}[placeholder=${qv(el.getAttribute('placeholder'))}]`);
    const t = textOf(el);
    if (t && t.length <= 60 && /^(a|button|summary|label|li|option|h[1-6]|span|div|td|th|p)$/.test(tag)) {
      const same = [...document.querySelectorAll(tag)].filter((e) => textOf(e) === t);
      if (same.length === 1) L.push({ text: t, tag });
    }
    if (tag === 'a' && el.getAttribute('href') && !/^(#|javascript:)/.test(el.getAttribute('href'))) add(`a[href=${qv(el.getAttribute('href'))}]`);
    add(cssPath(el));
    if (!L.length) L.push({ css: cssPath(el) });
    return L.slice(0, 4);
  }
  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,option,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[role=radio],[onclick],[tabindex]';
  function target(el) {
    const i = el.closest(INTERACTIVE);
    if (i) return i;
    // кликабельный блок без семантики (курсор-рука): берём верхний такой элемент
    let best = el;
    for (let e = el; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).cursor === 'pointer') best = e;
    return best;
  }
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const field = /^(input|textarea|select)$/.test(tag);
    const lbl = field && el.labels && el.labels[0] ? norm(el.labels[0].innerText || el.labels[0].textContent) : '';
    const t = (field ? lbl || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') : textOf(el)).slice(0, 50) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '';
    const kind = tag === 'a' ? 'ссылка' : tag === 'button' || el.getAttribute('role') === 'button' ? 'кнопка' : tag === 'input' ? 'поле' : tag === 'select' ? 'список' : tag === 'textarea' ? 'поле' : 'элемент';
    return t ? `${kind} «${t}»` : `${kind} ${tag}`;
  };
  const textField = (el) => (el.tagName === 'INPUT' && !/^(checkbox|radio|submit|button|reset|file|image|range|color)$/i.test(el.type)) || el.tagName === 'TEXTAREA' || el.isContentEditable;
  const SECRET = /pass|pwd|secret|token|card|cvv|cvc|otp|pin\b/i;

  // ---------- отправка шагов ----------
  const vp = () => ({ w: innerWidth, h: innerHeight });
  function send(step) {
    if (!on) return;
    chrome.runtime.sendMessage({ type: 'rec-step', step, viewport: vp() }).catch(() => {});
  }
  const fromBar = (e) => e.composedPath().some((n) => n && n.tagName && n.tagName.toLowerCase() === HOST_TAG);

  document.addEventListener('click', (e) => {
    if (!on || !e.isTrusted || fromBar(e)) return;
    if (asserting) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); openAssert(e.target); return; }
    const el = target(e.target);
    if (textField(el) || el.tagName === 'SELECT' || el.tagName === 'OPTION') return;
    if (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type)) return; // записываем через change
    if (el.tagName === 'LABEL' && el.control && /^(checkbox|radio)$/i.test(el.control.type)) return;
    send({ type: 'click', loc: locators(el), desc: describe(el) });
  }, true);
  document.addEventListener('input', (e) => {
    if (!on || !e.isTrusted || fromBar(e)) return;
    const el = e.target;
    if (!(el instanceof Element) || !textField(el)) return;
    const value = el.isContentEditable ? el.textContent : el.value;
    const secret = SECRET.test(`${el.type} ${el.name} ${el.id} ${el.autocomplete}`);
    send({ type: 'fill', loc: locators(el), desc: describe(el), value, secret });
  }, true);
  document.addEventListener('change', (e) => {
    if (!on || !e.isTrusted || fromBar(e)) return;
    const el = e.target;
    if (el.tagName === 'SELECT') send({ type: 'select', loc: locators(el), desc: describe(el), value: el.value, label: el.selectedOptions[0] ? norm(el.selectedOptions[0].text) : el.value });
    else if (el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type)) {
      const lbl = el.labels && el.labels[0] ? textOf(el.labels[0]) : '';
      send({ type: 'check', loc: locators(el), desc: lbl ? `«${lbl.slice(0, 50)}»` : describe(el), value: el.checked });
    } else if (el.tagName === 'INPUT' && el.type === 'file') toast('Загрузку файлов автотест не повторит — этот шаг пропущен');
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!on || !e.isTrusted || fromBar(e)) return;
    if (e.key === 'Escape' && asserting) { setAsserting(false); return; }
    if (e.key === 'Enter' && e.target instanceof Element && e.target.tagName === 'INPUT' && textField(e.target)) {
      setTimeout(() => send({ type: 'press', key: 'Enter', loc: locators(e.target), desc: describe(e.target) }), 0);
    }
  }, true);

  // ---------- подсветка в режиме проверки ----------
  let hl = null;
  document.addEventListener('mousemove', (e) => {
    if (!on || !asserting || fromBar(e)) { if (hl) hl.style.display = 'none'; return; }
    const el = e.target;
    if (!hl) {
      hl = document.createElement('div');
      hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:4px;transition:all .05s';
      document.documentElement.appendChild(hl);
    }
    const r = el.getBoundingClientRect();
    Object.assign(hl.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }, true);

  // ---------- панель записи ----------
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'all:initial;position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647';
  const sh = host.attachShadow({ mode: 'closed' });
  sh.innerHTML = `<style>
    *{box-sizing:border-box;font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .bar{display:flex;align-items:center;gap:6px;background:#1f1b2e;color:#fff;border-radius:14px;padding:6px 8px 6px 12px;box-shadow:0 12px 32px -10px rgba(0,0,0,.6)}
    .dot{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:p 1.2s infinite}
    @keyframes p{50%{opacity:.35}}
    .t{font-weight:700;white-space:nowrap}.n{color:#c4b5fd;white-space:nowrap}
    button{border:0;border-radius:9px;padding:7px 10px;background:#352f4d;color:#fff;cursor:pointer;font-weight:600;white-space:nowrap}
    button:hover{background:#463f63}
    button.on{background:#7c3aed}
    button.save{background:#16a34a}button.save:hover{background:#15803d}
    .last{color:#a1a1aa;font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pop{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#fff;color:#111827;border-radius:12px;padding:14px;width:380px;box-shadow:0 16px 40px -12px rgba(0,0,0,.45)}
    .pop h4{margin:0 0 8px;font-weight:700;font-size:14px}
    .pop label{display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer}
    .pop input[type=text]{width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:8px;margin-top:4px}
    .pop .row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
    .pop .row button{background:#f3f4f6;color:#111827}.pop .row button.ok{background:#7c3aed;color:#fff}
    .pop small{color:#6b7280}
    .toast{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 12px;border-radius:10px;white-space:nowrap}
  </style>
  <div class="bar"><span class="dot"></span><span class="t">Запись автотеста</span><span class="n">0 шагов</span><span class="last"></span>
    <button data-a="assert" title="Кликните по элементу, чтобы проверить, что он есть, или его текст">✓ Проверка</button>
    <button data-a="url" title="Проверить адрес текущей страницы">🔗 Адрес</button>
    <button data-a="text" title="Проверить, что на странице есть текст">🔤 Текст</button>
    <button data-a="undo" title="Удалить последний шаг">↶</button>
    <button data-a="save" class="save">💾 Сохранить</button>
    <button data-a="cancel" title="Отменить запись">✕</button></div>
  <div class="pop" hidden></div><div class="toast" hidden></div>`;
  const $ = (q) => sh.querySelector(q);
  const pop = $('.pop');
  let toastT;
  function toast(t) { const el = $('.toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 2600); }
  function setAsserting(v) {
    asserting = v;
    $('[data-a=assert]').classList.toggle('on', v);
    if (!v && hl) hl.style.display = 'none';
    if (v) toast('Кликните по элементу, который нужно проверить (Esc — отмена)');
  }
  const STEP_RU = { click: 'Клик', fill: 'Ввод', select: 'Выбор', check: 'Отметка', press: 'Клавиша', goto: 'Переход', assertVisible: 'Проверка', assertText: 'Проверка текста', assertValue: 'Проверка значения', assertUrl: 'Проверка адреса', assertHidden: 'Проверка' };
  function dialog(html, onOk) {
    pop.innerHTML = html + '<div class="row"><button data-x>Отмена</button><button class="ok" data-ok>Добавить</button></div>';
    pop.hidden = false;
    const inp = pop.querySelector('input[type=text]');
    if (inp) { inp.focus(); inp.select(); }
    pop.querySelector('[data-x]').onclick = () => (pop.hidden = true);
    pop.querySelector('[data-ok]').onclick = () => { if (onOk() !== false) pop.hidden = true; };
    pop.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') pop.querySelector('[data-ok]').click(); if (e.key === 'Escape') pop.hidden = true; };
  }
  function openAssert(raw) {
    setAsserting(false);
    const el = raw.closest('input,select,textarea') || raw;
    const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    const t = textOf(el).slice(0, 120);
    dialog(`<h4>Проверка: ${describe(el).replace(/</g, '&lt;')}</h4>
      <label><input type="radio" name="k" value="visible" ${t && !isField ? '' : 'checked'}> Элемент есть на странице и виден</label>
      ${isField ? `<label><input type="radio" name="k" value="value" checked> Значение поля равно<br></label><input type="text" data-v="value" value="${String(el.value).replace(/"/g, '&quot;')}">` : `<label><input type="radio" name="k" value="text" ${t ? 'checked' : ''}> Текст элемента содержит</label><input type="text" data-v="text" value="${t.replace(/"/g, '&quot;')}">`}
      <small>Совет: проверяйте то, что подтверждает результат — «Заказ оформлен», имя в шапке, сумма в корзине.</small>`, () => {
      const k = pop.querySelector('input[name=k]:checked').value;
      const loc = locators(el), desc = describe(el);
      if (k === 'visible') send({ type: 'assertVisible', loc, desc });
      else if (k === 'text') { const v = pop.querySelector('[data-v=text]').value.trim(); if (!v) return false; send({ type: 'assertText', loc, desc, value: v }); }
      else send({ type: 'assertValue', loc, desc, value: pop.querySelector('[data-v=value]').value });
    });
  }
  sh.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'assert') setAsserting(!asserting);
    else if (a === 'url') dialog(`<h4>Проверка адреса страницы</h4><label>Адрес содержит:</label><input type="text" value="${(location.pathname + location.search).replace(/"/g, '&quot;')}"><small>Например, /order/success</small>`, () => {
      const v = pop.querySelector('input').value.trim(); if (!v) return false; send({ type: 'assertUrl', value: v, desc: 'адрес содержит «' + v + '»' });
    });
    else if (a === 'text') dialog(`<h4>Проверка текста на странице</h4><label>На странице есть текст:</label><input type="text" value="${norm(String(getSelection() || '')).slice(0, 100).replace(/"/g, '&quot;')}"><small>Можно сначала выделить текст на странице мышкой.</small>`, () => {
      const v = pop.querySelector('input').value.trim(); if (!v) return false; send({ type: 'assertText', value: v, desc: 'на странице есть «' + v + '»' });
    });
    else if (a === 'undo') chrome.runtime.sendMessage({ type: 'rec-undo' }).catch(() => {});
    else if (a === 'save') dialog(`<h4>Сохранить сценарий</h4><label>Название:</label><input type="text" value="${document.title.replace(/"/g, '&quot;').slice(0, 60)}"><small>Например: «Оформление заказа», «Вход в личный кабинет».</small>`, () => {
      if (!stepsCount) { toast('Сначала выполните действия на странице'); return false; }
      const name = pop.querySelector('input').value.trim();
      chrome.runtime.sendMessage({ type: 'rec-save', name }).then((r) => {
        if (r && r.ok) { toast('✓ Сценарий сохранён'); setTimeout(() => chrome.runtime.sendMessage({ type: 'open-tools', hash: 'tests' }).catch(() => {}), 700); }
        else toast(r && r.error || 'Не удалось сохранить');
      }).catch(() => {});
    });
    else if (a === 'cancel') { if (!stepsCount || confirm('Отменить запись автотеста? Шаги будут удалены.')) chrome.runtime.sendMessage({ type: 'rec-cancel' }).catch(() => {}); }
  });
  ['keydown', 'keyup', 'keypress', 'input', 'mousedown', 'pointerdown'].forEach((t) => sh.addEventListener(t, (e) => e.stopPropagation()));

  function setState(rec) {
    on = !!rec;
    if (!on) { host.remove(); if (hl) hl.remove(); hl = null; asserting = false; return; }
    if (!host.isConnected) document.documentElement.appendChild(host);
    stepsCount = rec.steps;
    $('.n').textContent = `${rec.steps} ${rec.steps % 10 === 1 && rec.steps % 100 !== 11 ? 'шаг' : rec.steps % 10 >= 2 && rec.steps % 10 <= 4 && (rec.steps % 100 < 10 || rec.steps % 100 >= 20) ? 'шага' : 'шагов'}`;
    $('.last').textContent = rec.last ? `· ${STEP_RU[rec.last.type] || rec.last.type}: ${rec.last.desc || rec.last.url || ''}${rec.last.type === 'fill' ? ' = ' + (rec.last.secret ? '••••' : '«' + String(rec.last.value).slice(0, 20) + '»') : ''}` : '';
  }
  chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'qa-rec-state') setState(m.rec); });
  const hello = () => chrome.runtime.sendMessage({ type: 'rec-hello' }).catch(() => {});
  globalThis.__qaRecorder = { hello };
  hello();
})();
