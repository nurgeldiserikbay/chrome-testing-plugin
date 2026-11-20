// Экспорт баг-репорта в HTML, Markdown (ZIP), Word (DOCX) и HAR.
// Работает с готовой «моделью» отчёта, которую собирает report.js.
(function (g) {
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n, l = 2) => String(n).padStart(l, '0');

  function fmtRel(ms) {
    const neg = ms < 0;
    const a = Math.abs(Math.round(ms));
    const m = Math.floor(a / 60000), s = Math.floor(a / 1000) % 60;
    return (neg ? '−' : '') + pad(m) + ':' + pad(s) + '.' + String(Math.floor((a % 1000) / 100));
  }
  function fmtDur(ms) {
    if (ms == null || isNaN(ms)) return '';
    if (ms < 1000) return Math.round(ms) + ' мс';
    if (ms < 60000) return (ms / 1000).toFixed(1).replace('.', ',') + ' с';
    return Math.floor(ms / 60000) + ' мин ' + Math.round((ms % 60000) / 1000) + ' с';
  }
  function fmtSize(b) {
    if (b == null || b < 0) return '';
    if (b < 1024) return b + ' Б';
    if (b < 1048576) return (b / 1024).toFixed(1).replace('.', ',') + ' КБ';
    return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
  }
  const LEVEL_RU = { error: 'Ошибка', warn: 'Предупр.', info: 'Инфо', log: 'Лог', debug: 'Отладка' };
  const KIND_RU = { element: 'Элемент', arrow: 'Стрелка', rect: 'Область', note: 'Заметка', screen: 'Экран' };
  const isErr = (e) => !!(e.failed || e.status >= 400);
  const statusLabel = (e) => (e.mocked ? '🧪 ' : '') + (e.failed ? (e.canceled ? 'отменён' : e.blocked ? 'блок.' : 'ошибка') : e.status == null ? '…' : String(e.status));
  const hasH = (h) => !!h && Object.keys(h).length > 0;
  const hdrText = (h) => Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const short = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };

  function describeAction(a) {
    const t = a.text ? `«${a.text}»` : a.selector ? `\`${short(a.selector, 60)}\`` : a.tag;
    switch (a.kind) {
      case 'click': return `Клик: ${t}${a.tag && a.tag !== 'a' && a.tag !== 'button' ? ` (${a.tag})` : ''}`;
      case 'input': return `Ввод в поле «${a.label || a.selector}»: ${a.value === '' ? '(пусто)' : `«${a.value}»`}`;
      case 'select': return `Выбор в «${a.label || a.selector}»: «${a.value}»`;
      case 'toggle': return `Переключение «${a.label || a.selector}»: ${a.value}`;
      case 'submit': return `Отправка формы ${a.text ? `«${a.text}»` : ''}`.trim();
      case 'key': return `Нажатие ${a.key} в «${a.label || a.selector}»`;
      case 'nav': return `Переход: ${a.url}`;
      default: return a.kind;
    }
  }

  function htmlPerf(p) {
    if (!p) return '';
    const t = (head, rows) => `<table><tr>${head.map((h) => `<th>${escH(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
    const evT = (list) => t(['Время', 'Событие'], list.map((e) => [`<span class="mono">${fmtRel(e.rel)}</span>`, escH(e.text) + (e.sub ? `<span class="sub2">${escH(e.sub)}</span>` : '')]));
    let h = '<h2>Производительность</h2>';
    if (p.vitals.length) h += `<div class="vit">${p.vitals.map((v) => `<div class="${v.level}"><small>${v.name} · ${escH(v.title)}</small><b>${escH(v.value)}</b><small>${escH(v.rating)}</small></div>`).join('')}</div>`;
    const facts = [['Загрузка', p.navigation], ['Память JS', p.memory], ['DOM-узлы', p.nodes], ['FPS (минимум)', p.fps]].filter((x) => x[1]);
    if (facts.length) h += t(['Показатель', 'Значение'], facts.map(([a, b]) => [escH(a), escH(b)]));
    if (p.renders.length) h += '<h3>Перерисовки React</h3>' + t(['Компонент', 'Перерисовок', 'Монтирований'], p.renders.map((r) => [`<span class="mono">${escH(r[0])}</span>`, r[1], r[2]]));
    if (p.longFrames.length) h += '<h3>Долгие кадры (зависания)</h3>' + evT(p.longFrames);
    if (p.slow.length) h += '<h3>Медленные отклики</h3>' + evT(p.slow);
    if (p.shifts.length) h += '<h3>Сдвиги макета</h3>' + evT(p.shifts);
    if (p.cdp.length) h += '<h3>Метрики DevTools</h3>' + t(['Метрика', 'Начало', 'Конец', 'Разница'], p.cdp.map((r) => r.map(escH)));
    return h;
  }
  function htmlStorage(st) {
    if (!st) return '';
    const t = (title, rows, head) => `<h3>${title} (${rows.length})</h3>` + (rows.length ? `<table><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'mono u' : 'mono'}">${escH(c)}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="meta">Пусто</p>');
    return '<h2>Cookies и хранилище</h2><p class="meta">Снимок в момент начала проверки.</p>' +
      t('Cookies', st.cookies, ['Имя', 'Размер', 'Значение']) + t('localStorage', st.local, ['Ключ', 'Размер', 'Значение']) +
      t('sessionStorage', st.session, ['Ключ', 'Размер', 'Значение']) + t('Изменения во время теста', st.changes, ['Время', 'Операция']);
  }

  // ---------------- HTML ----------------
  function exportHTML(m, media = {}) {
    const css = `
      :root{--red:#e11d48;--muted:#6b7280;--line:#e5e7eb}
      *{box-sizing:border-box} body{margin:0;background:#f3f4f6;color:#111827;font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      .wrap{max-width:1100px;margin:0 auto;padding:32px 20px 60px}
      h1{font-size:26px;margin:0 0 6px} h2{font-size:18px;margin:34px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
      .sev{display:inline-block;padding:3px 10px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:600;font-size:12px}
      .meta{color:var(--muted);font-size:13px;margin:6px 0 0}
      .card{background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:14px}
      .ai{background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:12px 16px;margin-top:12px}.ai .label{color:#5b21b6}.ai ol,.ai ul{margin:4px 0 4px 20px;padding:0}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px} @media(max-width:800px){.grid{grid-template-columns:1fr}}
      .label{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
      .pre{white-space:pre-wrap;word-break:break-word}
      table{width:100%;border-collapse:collapse;background:#fff;font-size:12.5px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
      th{background:#f9fafb;font-weight:600;position:sticky;top:0} td.u{word-break:break-all} .mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}
      tr.err td{background:#fef2f2;color:#991b1b} tr.warn td{background:#fffbeb;color:#92400e} tr.before td{opacity:.75}
      .ann{display:grid;grid-template-columns:1fr;gap:10px} .ann img{width:100%;border:1px solid var(--line);border-radius:8px}
      .num{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--red);color:#fff;font-weight:700;margin-right:8px}
      .tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:6px;background:#eef2ff;color:#3730a3;margin-left:6px}
      details{background:#fff;border:1px solid var(--line);border-radius:8px;margin:6px 0;padding:8px 12px} summary{cursor:pointer;font-weight:600;word-break:break-all}
      pre{background:#f9fafb;border-radius:6px;padding:10px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:400px}
      video,audio{width:100%;border-radius:8px;background:#000} audio{background:none}
      .finds{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
      .find{background:#fff;border-radius:10px;padding:10px 14px;border-left:4px solid #9ca3af;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .find.error{border-left-color:#e11d48}.find.warn{border-left-color:#f59e0b}.find.info{border-left-color:#2563eb}
      .find b{display:block}.find span{font-size:12.5px;color:var(--muted);word-break:break-word}
      .vit{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px} .vit div{background:#fff;border-radius:10px;padding:10px 12px;border:1px solid var(--line)}
      .vit .good{background:#ecfdf5;border-color:#a7f3d0}.vit .ni{background:#fffbeb;border-color:#fde68a}.vit .poor{background:#fef2f2;border-color:#fecaca}
      .vit b{display:block;font-size:20px} .vit small{color:var(--muted)}
      h3{font-size:15px;margin:20px 0 8px} .sub2{display:block;color:var(--muted);font-family:ui-monospace,Consolas,monospace;font-size:11.5px;white-space:pre-wrap}
      .item .ih{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px} .item img{width:100%;border:1px solid var(--line);border-radius:8px;margin:6px 0}
      .errcard{border-left:4px solid var(--red)} .ih.error .num{background:#c2410c} .ih.recording .num{background:#1f2937}
      ol{padding-left:22px} .foot{color:var(--muted);font-size:12px;margin-top:40px;text-align:center}`;
    const tblEnv = `<table>${m.env.map(([k, v]) => `<tr><th style="width:220px">${escH(k)}</th><td class="u">${escH(v)}</td></tr>`).join('')}</table>`;

    const block = (lbl, txt) => (txt ? `<div class="card"><div class="label">${lbl}</div><div class="pre">${escH(txt)}</div></div>` : '');

    const anns = m.annotations
      .map((a) => {
        const el = a.element
          ? `<details><summary>Элемент: <span class="mono">${escH(a.element.selector)}</span></summary>
              <p><b>Тег:</b> ${escH(a.element.tag)} · <b>Размер:</b> ${Math.round(a.element.rect.w)}×${Math.round(a.element.rect.h)} · <b>Текст:</b> ${escH(short(a.element.text, 200))}</p>
              <pre>${escH(Object.entries(a.element.styles || {}).map(([k, v]) => `${k}: ${v};`).join('\n'))}</pre><pre>${escH(a.element.html)}</pre></details>`
          : '';
        return `<div class="card"><div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:8px">
          <span class="num">${a.n}</span><b>${escH(a.comment || '(без комментария)')}</b><span class="tag">${KIND_RU[a.kind] || a.kind}</span><span class="tag">${fmtRel(a.rel)}</span></div>
          <div class="meta" style="margin-bottom:10px;word-break:break-all">${escH(a.url)}</div>${el}
          ${a.dataUrl ? `<img src="${a.dataUrl}" alt="Скриншот ${a.n}">` : ''}</div>`;
      })
      .join('');

    const videos = m.videos
      .map((v) => (media[v.file] ? `<div class="card"><div class="label">Видео ${v.n} · начато в ${fmtRel(v.rel)} · ${fmtDur(v.durationMs)}</div><video controls preload="metadata" src="${media[v.file]}"></video></div>` : `<div class="card">Видео ${v.n}: файл <b>${escH(v.file)}</b> (${fmtSize(v.size)}) не встроено в HTML — приложите его отдельно.</div>`))
      .join('');
    const voices = m.voice
      .map((v) => (media[v.file] ? `<div class="card"><div class="label">Голосовой комментарий ${v.n} · ${fmtRel(v.rel)} · ${fmtDur(v.durationMs)}</div><audio controls src="${media[v.file]}"></audio></div>` : v.link ? `<div class="card">Голос ${v.n}: <a href="${escH(v.link)}">${escH(v.link)}</a></div>` : `<div class="card">Голос ${v.n}: файл <b>${escH(v.file)}</b> (${fmtSize(v.size)})</div>`))
      .join('');

    const steps = m.actions.length
      ? `<table><tr><th style="width:80px">Время</th><th>Действие</th><th style="width:35%">Страница</th></tr>${m.actions
          .map((a) => `<tr class="${a.rel < 0 ? 'before' : ''}"><td class="mono">${fmtRel(a.rel)}</td><td>${escH(a.text)}</td><td class="u mono">${escH(short(a.page, 120))}</td></tr>`)
          .join('')}</table>`
      : '<p class="meta">Действия не зафиксированы.</p>';

    const consoleT = m.console.length
      ? `<table><tr><th style="width:80px">Время</th><th style="width:90px">Уровень</th><th>Сообщение</th><th style="width:22%">Источник</th></tr>${m.console
          .map((c) => `<tr class="${c.level === 'error' ? 'err' : c.level === 'warn' ? 'warn' : ''}"><td class="mono">${fmtRel(c.rel)}</td><td>${LEVEL_RU[c.level] || c.level}</td><td class="mono pre">${escH(short(c.text, 3000))}</td><td class="u mono">${escH(c.loc || c.source || '')}</td></tr>`)
          .join('')}</table>`
      : '<p class="meta">Записей нет.</p>';

    const netT = m.network.length
      ? `<table><tr><th style="width:80px">Время</th><th style="width:60px">Метод</th><th style="width:60px">Статус</th><th style="width:60px">Тип</th><th>URL</th><th style="width:70px">Время отв.</th><th style="width:70px">Размер</th></tr>${m.network
          .map((e) => `<tr class="${isErr(e) ? 'err' : ''}"><td class="mono">${fmtRel(e.rel)}</td><td>${escH(e.method)}</td><td><b>${escH(statusLabel(e))}</b></td><td>${escH(e.type || '')}</td><td class="u mono">${escH(short(e.url, 300))}${e.error ? `<br>${escH(e.error)}${e.blocked ? ' · ' + escH(e.blocked) : ''}` : ''}</td><td>${fmtDur(e.duration)}</td><td>${fmtSize(e.size)}</td></tr>`)
          .join('')}</table>`
      : '<p class="meta">Запросов нет.</p>';

    const details = m.details
      ? m.network
          .filter((e) => hasH(e.reqHeaders) || hasH(e.resHeaders) || e.postData || e.body)
          .map((e) => `<details><summary>${escH(e.method)} ${escH(statusLabel(e))} ${escH(short(e.url, 200))}</summary>
            ${hasH(e.reqHeaders) ? `<div class="label">Заголовки запроса</div><pre>${escH(hdrText(e.reqHeaders))}</pre>` : ''}
            ${e.postData ? `<div class="label">Тело запроса</div><pre>${escH(e.postData)}</pre>` : ''}
            ${hasH(e.resHeaders) ? `<div class="label">Заголовки ответа</div><pre>${escH(hdrText(e.resHeaders))}</pre>` : ''}
            ${e.body ? `<div class="label">Ответ</div><pre>${escH(e.body)}</pre>` : ''}</details>`)
          .join('')
      : '';

    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(m.title)}</title><style>${css}</style></head><body><div class="wrap">
<h1>${escH(m.title)}</h1>${m.typeLabel ? `<span class="sev" style="background:#eff6ff;color:#1e3a8a">${escH(m.typeLabel)}</span> ` : ''}${m.severity ? `<span class="sev">${escH(m.severity)}</span>` : ''}${m.sevSummary && !m.severity ? `<span class="meta">${escH(m.sevSummary)}</span>` : ''}${m.priority ? ` <span class="sev" style="background:#e0e7ff;color:#3730a3">Приоритет: ${escH(m.priority)}</span>` : ''}
<p class="meta">Создан ${escH(m.createdAt)} · QA Bug Recorder</p>
${m.aiSummary ? `<h2>🤖 Резюме AI</h2><div class="card ai">${mdLite(m.aiSummary)}</div>` : ''}
<h2>Описание</h2>
${block('Шаги воспроизведения', m.steps)}
<div class="grid">${block('Ожидаемый результат', m.expected) || '<div></div>'}${block('Фактический результат', m.actual) || '<div></div>'}</div>
${block('Дополнительно', m.notes)}
<h2>Окружение</h2>${tblEnv}
${itemsHTML(m, media)}
${auditHTML(m)}
${m.voice.length ? `<h2>Голос</h2>${voices}` : ''}
${m.appendix ? `<h2 style="margin-top:56px;border-top:3px solid var(--line);padding-top:24px">Приложение: все данные сессии</h2>
${m.findings && m.findings.length ? `<h2>Что найдено автоматически</h2><div class="finds">${m.findings.map((f) => `<div class="find ${f.level}"><b>${escH(f.title)}</b><span>${escH(f.text)}</span></div>`).join('')}</div>` : ''}
<h2>Действия пользователя (${m.actions.length})</h2><p class="meta">Время отсчитывается от начала проверки, «−» — до начала.</p>${steps}
<h2>Консоль (${m.console.length})</h2>${consoleT}
<h2>Сетевые запросы (${m.network.length})</h2>${netT}
${details ? `<h2>Детали запросов</h2>${details}` : ''}` : ''}
${htmlPerf(m.perf)}
${m.events && m.events.length ? `<h2>События страницы (${m.events.length})</h2><table><tr><th style="width:80px">Время</th><th style="width:110px">Тип</th><th>Событие</th></tr>${m.events.map((e) => `<tr class="${e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : ''}"><td class="mono">${fmtRel(e.rel)}</td><td>${escH(e.cat)}</td><td>${escH(e.text)}</td></tr>`).join('')}</table>` : ''}
${htmlStorage(m.storage)}
<p class="foot">Сформировано расширением QA Bug Recorder · ${escH(m.generatedAt)}</p>
</div></body></html>`;
  }

  // ---------------- Markdown ----------------
  const mdCell = (s, n = 400) => short(s, n).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  function mdTable(head, rows) {
    return `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` + rows.map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n';
  }
  function fence(t, lang = '') {
    const s = String(t);
    const f = s.includes('```') ? '~~~~' : '```';
    return `${f}${lang}\n${s}\n${f}\n`;
  }

  function exportMarkdown(m) {
    let md = `# ${m.title}\n\n${m.typeLabel ? `**Тип:** ${m.typeLabel}  \n` : ''}${m.severity ? `**Серьёзность:** ${m.severity}  \n` : m.sevSummary ? `**Пункты:** ${m.sevSummary}  \n` : ''}${m.priority ? `**Приоритет:** ${m.priority}  \n` : ''}**Создан:** ${m.createdAt}\n\n`;
    if (m.aiSummary) md += `## 🤖 Резюме AI\n\n${m.aiSummary}\n\n`;
    if (m.steps) md += `## Шаги воспроизведения\n\n${m.steps}\n\n`;
    if (m.expected) md += `## Ожидаемый результат\n\n${m.expected}\n\n`;
    if (m.actual) md += `## Фактический результат\n\n${m.actual}\n\n`;
    if (m.notes) md += `## Дополнительно\n\n${m.notes}\n\n`;
    if (m.appendix && m.findings && m.findings.length) {
      md += `## Что найдено автоматически\n\n` + m.findings.map((f) => `- ${f.level === 'error' ? '🔴' : f.level === 'warn' ? '🟡' : 'ℹ️'} **${f.title}** — ${f.text}`).join('\n') + '\n\n';
    }
    md += `## Окружение\n\n` + mdTable(['Параметр', 'Значение'], m.env.map(([k, v]) => [mdCell(k), mdCell(v, 1000)])) + '\n';
    md += itemsMD(m);
    md += auditMD(m);
    if (m.voice.length) md += `## Голос\n\n` + m.voice.map((v) => `- 🎤 [Голосовой комментарий ${v.n}](${v.link || v.file}) — ${fmtRel(v.rel)}, ${fmtDur(v.durationMs)}`).join('\n') + '\n\n';
    if (m.appendix) {
    md += `# Приложение: все данные сессии\n\n`;
    md += `## Действия пользователя\n\n_Время от начала проверки; «−» — до начала._\n\n`;
    md += m.actions.length ? mdTable(['Время', 'Действие', 'Страница'], m.actions.map((a) => [fmtRel(a.rel), mdCell(a.text), mdCell(a.page, 120)])) : '_Нет данных._\n';
    md += `\n## Консоль\n\n`;
    md += m.console.length
      ? mdTable(['Время', 'Уровень', 'Сообщение', 'Источник'], m.console.map((c) => [fmtRel(c.rel), (c.level === 'error' ? '🔴 ' : c.level === 'warn' ? '🟡 ' : '') + (LEVEL_RU[c.level] || c.level), mdCell(c.text, 600), mdCell(c.loc || c.source, 150)]))
      : '_Нет записей._\n';
    md += `\n## Сетевые запросы\n\n`;
    md += m.network.length
      ? mdTable(['Время', 'Метод', 'Статус', 'Тип', 'URL', 'Время отв.', 'Размер'], m.network.map((e) => [fmtRel(e.rel), e.method, (isErr(e) ? '🔴 ' : '') + statusLabel(e), e.type || '', mdCell(e.url + (e.error ? ` — ${e.error}` : ''), 250), fmtDur(e.duration), fmtSize(e.size)]))
      : '_Нет запросов._\n';
    }
    if (m.appendix && m.details) {
      const det = m.network.filter((e) => hasH(e.reqHeaders) || hasH(e.resHeaders) || e.postData || e.body);
      if (det.length) {
        md += `\n## Детали запросов\n\n`;
        det.forEach((e) => {
          md += `<details><summary>${e.method} ${statusLabel(e)} ${short(e.url, 150).replace(/</g, '&lt;')}</summary>\n\n`;
          if (hasH(e.reqHeaders)) md += '**Заголовки запроса**\n\n' + fence(hdrText(e.reqHeaders), 'http');
          if (e.postData) md += '\n**Тело запроса**\n\n' + fence(e.postData);
          if (hasH(e.resHeaders)) md += '\n**Заголовки ответа**\n\n' + fence(hdrText(e.resHeaders), 'http');
          if (e.body) md += '\n**Ответ**\n\n' + fence(e.body);
          md += '\n</details>\n\n';
        });
      }
    }
    const p = m.perf;
    if (p) {
      md += `\n## Производительность\n\n`;
      if (p.vitals.length) md += mdTable(['Метрика', 'Значение', 'Оценка'], p.vitals.map((v) => [`${v.name} — ${v.title}`, v.value, (v.level === 'good' ? '🟢 ' : v.level === 'ni' ? '🟡 ' : '🔴 ') + v.rating])) + '\n';
      const facts = [['Загрузка', p.navigation], ['Память JS', p.memory], ['DOM-узлы', p.nodes], ['FPS (минимум)', p.fps]].filter((x) => x[1]);
      if (facts.length) md += facts.map(([a, b]) => `- **${a}:** ${b}`).join('\n') + '\n\n';
      const evT = (list) => mdTable(['Время', 'Событие'], list.map((e) => [fmtRel(e.rel), mdCell(e.text + (e.sub ? '\n' + e.sub : ''), 500)]));
      if (p.renders.length) md += `### Перерисовки React\n\n` + mdTable(['Компонент', 'Перерисовок', 'Монтирований'], p.renders.map((r) => ['`' + r[0] + '`', r[1], r[2]])) + '\n';
      if (p.longFrames.length) md += `### Долгие кадры (зависания)\n\n` + evT(p.longFrames) + '\n';
      if (p.slow.length) md += `### Медленные отклики\n\n` + evT(p.slow) + '\n';
      if (p.shifts.length) md += `### Сдвиги макета\n\n` + evT(p.shifts) + '\n';
      if (p.cdp.length) md += `### Метрики DevTools\n\n` + mdTable(['Метрика', 'Начало', 'Конец', 'Разница'], p.cdp) + '\n';
    }
    if (m.events && m.events.length) {
      md += `\n## События страницы\n\n` + mdTable(['Время', 'Тип', 'Событие'], m.events.map((e) => [fmtRel(e.rel), e.cat, (e.level === 'error' ? '🔴 ' : e.level === 'warn' ? '🟡 ' : '') + mdCell(e.text, 400)]));
    }
    if (m.storage) {
      const st = m.storage;
      const t = (title, rows, head) => `\n### ${title} (${rows.length})\n\n` + (rows.length ? mdTable(head, rows.map((r) => r.map((c) => mdCell(c, 300)))) : '_Пусто._\n');
      md += `\n## Cookies и хранилище\n\n_Снимок в момент начала проверки._\n` + t('Cookies', st.cookies, ['Имя', 'Размер', 'Значение']) + t('localStorage', st.local, ['Ключ', 'Размер', 'Значение']) + t('sessionStorage', st.session, ['Ключ', 'Размер', 'Значение']) + t('Изменения во время теста', st.changes, ['Время', 'Операция']);
    }
    md += `\n---\n_Сформировано QA Bug Recorder · ${m.generatedAt}_\n`;
    return md;
  }

  // ================= пункты: замечание / ошибка / запись =================
  const ITEM_RU = { remark: 'Замечание', error: 'Ошибка', recording: 'Запись видео' };
  const itemTitle = (it) =>
    it.kind === 'remark' ? `💬 Замечание ${it.n}: ${short(it.comment || '(без комментария)', 90)}`
      : it.kind === 'error' ? `⚠ Ошибка ${it.n}: ${short(it.title, 110)}`
        : `🎬 Запись ${it.n} · ${fmtDur(it.durationMs)}`;
  const reqLine = (e) => `${e.method} ${statusLabel(e)} ${e.url}${e.duration != null ? ` · ${fmtDur(e.duration)}` : ''}${e.error ? ` — ${e.error}` : ''}`;

  // ---------- 🤖 разбор AI ----------
  const SIDE_RU = { frontend: 'фронтенд', backend: 'бэкенд', both: 'фронтенд и бэкенд', unknown: 'не ясно' };
  const SEV_RU = { blocker: '🔴 Блокирующий', critical: '🟠 Критический', major: '🟡 Значительный', minor: '🔵 Незначительный', trivial: '⚪ Тривиальный' };
  function aiLines(ai) {
    if (!ai) return [];
    const L = [`🤖 **Разбор AI** (${ai.model}):`];
    if (ai.title) L.push(`**${ai.title}**`);
    if (ai.steps.length) { L.push('', 'Шаги воспроизведения:'); ai.steps.forEach((x, i) => L.push(`${i + 1}. ${x}`)); }
    if (ai.expected) L.push('', `Ожидалось: ${ai.expected}`);
    if (ai.actual) L.push(`Фактически: ${ai.actual}`);
    if (ai.cause) L.push('', `Вероятная причина (${SIDE_RU[ai.side] || 'не ясно'}): ${ai.cause}`);
    if (ai.fix) L.push('', 'Что проверить:', ai.fix);
    if (ai.severity) L.push('', `Предложенная серьёзность: ${SEV_RU[ai.severity]}`);
    if (ai.questions.length) { L.push('', 'Уточнить:'); ai.questions.forEach((q) => L.push('- ' + q)); }
    return L;
  }
  function aiHTML(ai) {
    if (!ai) return '';
    return `<div class="ai"><div class="label">🤖 Разбор AI · ${escH(ai.model)}</div>${ai.title ? `<b>${escH(ai.title)}</b>` : ''}
      ${ai.steps.length ? `<div class="label">Шаги воспроизведения</div><ol>${ai.steps.map((x) => `<li>${escH(x)}</li>`).join('')}</ol>` : ''}
      ${ai.expected ? `<div class="label">Ожидалось</div><div>${escH(ai.expected)}</div>` : ''}${ai.actual ? `<div class="label">Фактически</div><div>${escH(ai.actual)}</div>` : ''}
      ${ai.cause ? `<div class="label">Вероятная причина · ${escH(SIDE_RU[ai.side] || '')}</div><div>${escH(ai.cause)}</div>` : ''}
      ${ai.fix ? `<div class="label">Что проверить</div><div class="pre">${escH(ai.fix)}</div>` : ''}
      ${ai.questions.length ? `<div class="label">Уточнить</div><ul>${ai.questions.map((q) => `<li>${escH(q)}</li>`).join('')}</ul>` : ''}</div>`;
  }
  /** минимальный Markdown → HTML для резюме AI */
  function mdLite(t) {
    const out = []; let list = null;
    const inl = (x) => escH(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    String(t).split('\n').forEach((line) => {
      const m = line.match(/^\s*(?:(\d+)[.)]|[-*•])\s+(.*)$/);
      if (m) { const tag = m[1] ? 'ol' : 'ul'; if (!list || list !== tag) { if (list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; } out.push(`<li>${inl(m[2])}</li>`); return; }
      if (list) { out.push(`</${list}>`); list = null; }
      const h = line.match(/^#{1,4}\s+(.*)$/);
      if (h) out.push(`<p><b>${inl(h[1])}</b></p>`); else if (line.trim()) out.push(`<p>${inl(line)}</p>`);
    });
    if (list) out.push(`</${list}>`);
    return out.join('');
  }

  /** Короткий текст пункта для вставки в задачу / мессенджер (Markdown) */
  function itemText(it) {
    const L = [];
    const code = (t, n = 1500) => '```\n' + short(t, n) + '\n```';
    const sevLine = () => { if (it.sevLabel) L.push(`Серьёзность: ${it.sevLabel}`); };
    if (it.kind === 'remark') {
      L.push(`💬 **Замечание:** ${it.comment || '(без комментария)'}`);
      sevLine();
      if (it.url) L.push(`Страница: ${it.url}`);
      if (it.cond) L.push(`Условия: ${it.cond}`);
      if (it.element) L.push(`Элемент: \`${it.element.selector}\``);
    } else if (it.kind === 'error') {
      L.push(`⚠ **${it.title}**${it.count > 1 ? ` (повторялась ${it.count} раз)` : ''}`);
      sevLine();
      if (it.url) L.push(`Страница: ${it.url}`);
      if (it.cond) L.push(`Условия: ${it.cond}`);
      it.jsErrors.forEach((j) => { L.push('', 'Ошибка JavaScript:', code(j.text + (j.loc ? '\n@ ' + j.loc : ''), 1200)); });
      it.requests.forEach((e) => {
        L.push('', `Запрос: ${e.method} ${e.url} → ${statusLabel(e)}${e.statusText ? ' ' + e.statusText : ''}${e.duration != null ? ` · ${fmtDur(e.duration)}` : ''}${e.error ? ` — ${e.error}` : ''}`);
        if (e.postData) L.push('Тело запроса:', code(e.postData, 1000));
        if (e.body) L.push('Ответ сервера:', code(e.body, 1500));
      });
      if (it.before.length) { L.push('', 'Шаги перед ошибкой:'); it.before.slice(-8).forEach((b, i) => L.push(`${i + 1}. ${b.text}`)); }
    } else {
      L.push(`🎬 **Запись видео** · ${fmtDur(it.durationMs)} (видео — отдельным файлом)`);
      sevLine();
      const bad = it.timeline.filter((e) => e.level === 'error' || e.level === 'warn');
      const reqBad = it.requests.filter(isErr);
      if (reqBad.length) { L.push('', 'Запросы с ошибкой:'); reqBad.forEach((e) => L.push(`- ${e.method} ${statusLabel(e)} ${e.url}`)); }
      if (bad.length) { L.push('', 'Что пошло не так:'); bad.slice(0, 10).forEach((e) => L.push(`- ${fmtRel(e.rel)} ${e.text}`)); }
      const acts = it.timeline.filter((e) => e.cat === 'Действие' || e.cat === 'Переход');
      if (acts.length) { L.push('', 'Действия:'); acts.slice(-10).forEach((e, i) => L.push(`${i + 1}. ${e.text}`)); }
    }
    if (it.link) L.push('', `Видео: ${it.link}`);
    if (it.ai) L.push('', ...aiLines(it.ai));
    return L.join('\n');
  }

  function itemsHTML(m, media) {
    if (!m.items || !m.items.length) return '';
    const tbl = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
    const lvlCls = (l) => (l === 'error' ? 'err' : l === 'warn' ? 'warn' : '');
    const reqDetails = (e) => `<details open><summary class="mono">${escH(reqLine(e))}</summary>
      ${hasH(e.reqHeaders) ? `<div class="label">Заголовки запроса</div><pre>${escH(hdrText(e.reqHeaders))}</pre>` : ''}
      ${e.postData ? `<div class="label">Тело запроса</div><pre>${escH(e.postData)}</pre>` : ''}
      ${hasH(e.resHeaders) ? `<div class="label">Заголовки ответа</div><pre>${escH(hdrText(e.resHeaders))}</pre>` : ''}
      ${e.body ? `<div class="label">Ответ сервера</div><pre>${escH(e.body)}</pre>` : ''}</details>`;
    const body = m.items.map((it) => {
      const head = `<div class="ih ${it.kind}"><span class="num">${it.kind === 'error' ? '!' : it.kind === 'recording' ? '▶' : it.n}</span><b>${escH(itemTitle(it))}</b>${it.sevLabel ? `<span class="tag" style="background:#fff7ed;color:#9a3412">${escH(it.sevLabel)}</span>` : ''}<span class="tag">${fmtRel(it.rel)}</span>${it.count > 1 ? `<span class="tag">повторялась ${it.count} раз</span>` : ''}</div>${it.url ? `<div class="meta" style="margin:0 0 10px;word-break:break-all">${escH(it.url)}</div>` : ''}${it.cond ? `<div class="meta" style="margin:-6px 0 10px">📶 Условия: ${escH(it.cond)}</div>` : ''}`;
      const img = it.dataUrl ? `<img src="${it.dataUrl}" alt="">` : '';
      if (it.kind === 'remark') {
        return `<div class="card item">${head}
          ${it.comment && it.comment.includes('\n') ? `<div class="pre">${escH(it.comment)}</div>` : ''}
          ${it.element ? `<div class="meta mono" style="margin-bottom:8px">Элемент: ${escH(it.element.selector)} · &lt;${escH(it.element.tag)}&gt; ${Math.round(it.element.rect.w)}×${Math.round(it.element.rect.h)}</div>` : ''}
          ${(it.voice || []).map((v) => (media[v.file] ? `<audio controls src="${media[v.file]}"></audio>` : v.link ? `<div class="meta">🎤 Голос: <a href="${escH(v.link)}">${escH(v.link)}</a></div>` : `<div class="meta">🎤 Голос: ${escH(v.file)}</div>`)).join('')}
          ${img}${aiHTML(it.ai)}</div>`;
      }
      if (it.kind === 'error') {
        return `<div class="card item errcard">${head}${img}
          ${it.jsErrors.length ? `<h3>Ошибка JavaScript</h3>${it.jsErrors.map((j) => `<pre>${escH(j.text)}${j.loc ? '\n@ ' + escH(j.loc) : ''}</pre>`).join('')}` : ''}
          ${it.requests.length ? `<h3>Запрос с ошибкой</h3>${it.requests.map(reqDetails).join('')}` : ''}
          ${it.before.length ? `<h3>Что делал пользователь перед ошибкой</h3><ol>${it.before.map((a) => `<li>${escH(a.text)} <span class="meta">${fmtRel(a.rel)}</span></li>`).join('')}</ol>` : ''}
          ${it.eventsNear.length ? `<h3>Что происходило на странице</h3>${tbl(['Время', 'Событие'], it.eventsNear.map((e) => `<tr class="${lvlCls(e.level)}"><td class="mono">${fmtRel(e.rel)}</td><td>${escH(e.text)}</td></tr>`))}` : ''}
          ${it.consoleNear.length ? `<h3>Консоль рядом</h3>${tbl(['Время', 'Уровень', 'Сообщение'], it.consoleNear.map((c) => `<tr class="${lvlCls(c.level)}"><td class="mono">${fmtRel(c.rel)}</td><td>${LEVEL_RU[c.level] || c.level}</td><td class="mono pre">${escH(short(c.text, 1500))}</td></tr>`))}` : ''}
          ${aiHTML(it.ai)}
          ${it.requestsNear.length ? `<h3>Запросы рядом</h3>${tbl(['Время', 'Метод', 'Статус', 'URL', 'Время отв.'], it.requestsNear.map((e) => `<tr class="${isErr(e) ? 'err' : ''}"><td class="mono">${fmtRel(e.rel)}</td><td>${escH(e.method)}</td><td>${escH(statusLabel(e))}</td><td class="u mono">${escH(short(e.url, 200))}</td><td>${fmtDur(e.duration)}</td></tr>`))}` : ''}
        </div>`;
      }
      return `<div class="card item">${head}
        ${media[it.file] ? `<video controls preload="metadata" src="${media[it.file]}"></video>` : it.link ? `<p>🎬 Видео в Google Drive: <a href="${escH(it.link)}">${escH(it.link)}</a></p>` : `<p class="meta">Видео: файл <b>${escH(it.file)}</b> (${fmtSize(it.size)}) прикладывается отдельно.</p>`}
        ${aiHTML(it.ai)}
        ${it.timeline.length ? `<h3>Что происходило во время записи</h3>${tbl(['Время', 'Тип', 'Событие'], it.timeline.map((e) => `<tr class="${lvlCls(e.level)}"><td class="mono">${fmtRel(e.rel)}</td><td>${escH(e.cat)}</td><td>${escH(e.text)}</td></tr>`))}` : ''}
        ${it.requests.length ? `<h3>Запросы</h3>${tbl(['Время', 'Метод', 'Статус', 'URL', 'Время отв.'], it.requests.map((e) => `<tr class="${isErr(e) ? 'err' : ''}"><td class="mono">${fmtRel(e.rel)}</td><td>${escH(e.method)}</td><td>${escH(statusLabel(e))}</td><td class="u mono">${escH(short(e.url, 200))}</td><td>${fmtDur(e.duration)}</td></tr>`))}${it.requests.filter((e) => isErr(e) && (e.body || e.postData || hasH(e.reqHeaders))).map(reqDetails).join('')}` : ''}
        ${it.console.length ? `<h3>Консоль</h3>${tbl(['Время', 'Уровень', 'Сообщение'], it.console.map((c) => `<tr class="${lvlCls(c.level)}"><td class="mono">${fmtRel(c.rel)}</td><td>${LEVEL_RU[c.level] || c.level}</td><td class="mono pre">${escH(short(c.text, 1500))}</td></tr>`))}` : ''}
        ${it.perf.length ? `<h3>Производительность</h3><ul>${it.perf.map((p) => `<li>${fmtRel(p.rel)} — ${escH(p.text)}</li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('');
    return `<h2>Пункты (${m.items.length})</h2>${body}`;
  }

  function itemsMD(m) {
    if (!m.items || !m.items.length) return '';
    let md = `## Пункты (${m.items.length})\n\n`;
    const reqMD = (e) => {
      let s = `**${reqLine(e)}**\n\n`;
      if (hasH(e.reqHeaders)) s += 'Заголовки запроса:\n\n' + fence(hdrText(e.reqHeaders), 'http');
      if (e.postData) s += '\nТело запроса:\n\n' + fence(e.postData);
      if (hasH(e.resHeaders)) s += '\nЗаголовки ответа:\n\n' + fence(hdrText(e.resHeaders), 'http');
      if (e.body) s += '\nОтвет сервера:\n\n' + fence(e.body);
      return s + '\n';
    };
    m.items.forEach((it) => {
      md += `### ${itemTitle(it)}\n\n${it.sevLabel ? `**${it.sevLabel}** · ` : ''}_${ITEM_RU[it.kind]} · ${fmtRel(it.rel)}${it.count > 1 ? ` · повторялась ${it.count} раз` : ''}${it.url ? ` · ${it.url}` : ''}_\n\n${it.cond ? `📶 Условия: ${it.cond}\n\n` : ''}`;
      if (it.kind === 'remark') {
        if (it.comment && it.comment.includes('\n')) md += it.comment + '\n\n';
        if (it.element) md += `Элемент: \`${it.element.selector}\` — <${it.element.tag}>, ${Math.round(it.element.rect.w)}×${Math.round(it.element.rect.h)}\n\n`;
        (it.voice || []).forEach((v) => (md += `🎤 [Голосовой комментарий](${v.link || v.file})\n\n`));
        if (it.file) md += `![Замечание ${it.n}](${it.file})\n\n`;
      } else if (it.kind === 'error') {
        if (it.file) md += `![Ошибка ${it.n}](${it.file})\n\n`;
        if (it.jsErrors.length) md += '**Ошибка JavaScript**\n\n' + it.jsErrors.map((j) => fence(j.text + (j.loc ? '\n@ ' + j.loc : ''))).join('\n') + '\n';
        if (it.requests.length) md += '**Запрос с ошибкой**\n\n' + it.requests.map(reqMD).join('');
        if (it.before.length) md += '**Что делал пользователь перед ошибкой**\n\n' + it.before.map((a, i) => `${i + 1}. ${a.text}`).join('\n') + '\n\n';
        if (it.eventsNear.length) md += '**Что происходило на странице**\n\n' + mdTable(['Время', 'Событие'], it.eventsNear.map((e) => [fmtRel(e.rel), mdCell(e.text, 300)])) + '\n';
        if (it.consoleNear.length) md += '**Консоль рядом**\n\n' + mdTable(['Время', 'Уровень', 'Сообщение'], it.consoleNear.map((c) => [fmtRel(c.rel), LEVEL_RU[c.level] || c.level, mdCell(c.text, 500)])) + '\n';
        if (it.requestsNear.length) md += '**Запросы рядом**\n\n' + mdTable(['Время', 'Метод', 'Статус', 'URL', 'Время отв.'], it.requestsNear.map((e) => [fmtRel(e.rel), e.method, (isErr(e) ? '🔴 ' : '') + statusLabel(e), mdCell(e.url, 200), fmtDur(e.duration)])) + '\n';
      } else {
        md += `🎬 [Видео](${it.link || it.file}) — ${fmtDur(it.durationMs)}, ${fmtSize(it.size)}\n\n`;
        if (it.timeline.length) md += '**Что происходило во время записи**\n\n' + mdTable(['Время', 'Тип', 'Событие'], it.timeline.map((e) => [fmtRel(e.rel), e.cat, (e.level === 'error' ? '🔴 ' : e.level === 'warn' ? '🟡 ' : '') + mdCell(e.text, 300)])) + '\n';
        if (it.requests.length) md += '**Запросы**\n\n' + mdTable(['Время', 'Метод', 'Статус', 'URL', 'Время отв.'], it.requests.map((e) => [fmtRel(e.rel), e.method, (isErr(e) ? '🔴 ' : '') + statusLabel(e), mdCell(e.url, 200), fmtDur(e.duration)])) + '\n' + it.requests.filter((e) => isErr(e) && (e.body || e.postData)).map(reqMD).join('');
        if (it.console.length) md += '**Консоль**\n\n' + mdTable(['Время', 'Уровень', 'Сообщение'], it.console.map((c) => [fmtRel(c.rel), LEVEL_RU[c.level] || c.level, mdCell(c.text, 500)])) + '\n';
        if (it.perf.length) md += '**Производительность**\n\n' + it.perf.map((p) => `- ${fmtRel(p.rel)} — ${p.text}`).join('\n') + '\n\n';
      }
      if (it.ai) md += aiLines(it.ai).join('\n') + '\n\n';
      md += '---\n\n';
    });
    return md;
  }

  function itemsDOCX(d, m) {
    if (!m.items || !m.items.length) return;
    const W = g.DOCX_TEXT_WIDTH;
    d.h(`Пункты (${m.items.length})`, 1);
    const reqDoc = (e) => {
      d.p(reqLine(e), { run: { bold: true, mono: true, size: 18, color: isErr(e) ? 'B91C1C' : undefined } });
      if (hasH(e.reqHeaders)) { d.p('Заголовки запроса:', { run: { bold: true, size: 18 } }); d.code(hdrText(e.reqHeaders)); }
      if (e.postData) { d.p('Тело запроса:', { run: { bold: true, size: 18 } }); d.code(short(e.postData, 5000)); }
      if (hasH(e.resHeaders)) { d.p('Заголовки ответа:', { run: { bold: true, size: 18 } }); d.code(hdrText(e.resHeaders)); }
      if (e.body) { d.p('Ответ сервера:', { run: { bold: true, size: 18 } }); d.code(short(e.body, 5000)); }
    };
    const lvlFill = (l) => (l === 'error' ? 'FEF2F2' : l === 'warn' ? 'FFFBEB' : undefined);
    m.items.forEach((it) => {
      d.h(itemTitle(it), 2);
      d.p([it.sevLabel ? d.run(it.sevLabel + ' · ', { bold: true, size: 18 }) : '', d.run(`${ITEM_RU[it.kind]} · ${fmtRel(it.rel)}${it.count > 1 ? ` · повторялась ${it.count} раз` : ''}`, { color: '6B7280', size: 18 }), it.url ? d.run(' · ' + it.url, { color: '6B7280', size: 18 }) : '']);
      if (it.cond) d.p(`📶 Условия: ${it.cond}`, { run: { color: '6D28D9', size: 18 } });
      if (it.kind === 'remark') {
        if (it.comment && it.comment.includes('\n')) d.p(it.comment);
        if (it.element) d.p([d.run('Элемент: ', { bold: true, size: 18 }), d.run(`${it.element.selector} · <${it.element.tag}> ${Math.round(it.element.rect.w)}×${Math.round(it.element.rect.h)}`, { mono: true, size: 18 })]);
        (it.voice || []).forEach((v) => d.p(v.link ? `🎤 Голосовой комментарий: ${v.link}` : `🎤 Голосовой комментарий: файл «${v.file.split('/').pop()}», прикладывается отдельно.`, { run: { size: 18 } }));
        if (it.bytes && it.w) d.image(it.bytes, it.w, it.h);
      } else if (it.kind === 'error') {
        if (it.bytes && it.w) d.image(it.bytes, it.w, it.h);
        if (it.jsErrors.length) { d.h('Ошибка JavaScript', 3); it.jsErrors.forEach((j) => d.code(short(j.text, 3000) + (j.loc ? '\n@ ' + j.loc : ''))); }
        if (it.requests.length) { d.h('Запрос с ошибкой', 3); it.requests.forEach(reqDoc); }
        if (it.before.length) { d.h('Что делал пользователь перед ошибкой', 3); it.before.forEach((a, i) => d.p(`${i + 1}. ${a.text}`)); }
        if (it.eventsNear.length) { d.h('Что происходило на странице', 3); d.table([['Время', 'Событие'], ...it.eventsNear.map((e) => [{ text: fmtRel(e.rel), fill: lvlFill(e.level) }, { text: e.text, fill: lvlFill(e.level) }])], { widths: [1000, W - 1000] }); }
        if (it.consoleNear.length) { d.h('Консоль рядом', 3); d.table([['Время', 'Уровень', 'Сообщение'], ...it.consoleNear.map((c) => [{ text: fmtRel(c.rel), fill: lvlFill(c.level) }, { text: LEVEL_RU[c.level] || c.level, fill: lvlFill(c.level) }, { text: short(c.text, 1500), mono: true, fill: lvlFill(c.level) }])], { widths: [1000, 1300, W - 2300] }); }
        if (it.requestsNear.length) { d.h('Запросы рядом', 3); d.table([['Время', 'Метод', 'Статус', 'URL', 'Время отв.'], ...it.requestsNear.map((e) => { const f = isErr(e) ? 'FEF2F2' : undefined; return [{ text: fmtRel(e.rel), fill: f }, { text: e.method, fill: f }, { text: statusLabel(e), fill: f, bold: isErr(e) }, { text: short(e.url, 250), mono: true, fill: f }, { text: fmtDur(e.duration), fill: f }]; })], { widths: [950, 800, 850, W - 3500, 900] }); }
      } else {
        d.p(it.link ? `🎬 Видео в Google Drive (${fmtDur(it.durationMs)}): ${it.link}` : `🎬 Видео: файл «${it.file.split('/').pop()}», ${fmtDur(it.durationMs)}, ${fmtSize(it.size)}. Прикладывается отдельным файлом.`);
        if (it.timeline.length) { d.h('Что происходило во время записи', 3); d.table([['Время', 'Тип', 'Событие'], ...it.timeline.map((e) => [{ text: fmtRel(e.rel), fill: lvlFill(e.level) }, { text: e.cat, fill: lvlFill(e.level) }, { text: e.text, fill: lvlFill(e.level) }])], { widths: [1000, 1500, W - 2500] }); }
        if (it.requests.length) { d.h('Запросы', 3); d.table([['Время', 'Метод', 'Статус', 'URL', 'Время отв.'], ...it.requests.map((e) => { const f = isErr(e) ? 'FEF2F2' : undefined; return [{ text: fmtRel(e.rel), fill: f }, { text: e.method, fill: f }, { text: statusLabel(e), fill: f, bold: isErr(e) }, { text: short(e.url, 250), mono: true, fill: f }, { text: fmtDur(e.duration), fill: f }]; })], { widths: [950, 800, 850, W - 3500, 900] }); it.requests.filter((e) => isErr(e) && (e.body || e.postData)).forEach(reqDoc); }
        if (it.console.length) { d.h('Консоль', 3); d.table([['Время', 'Уровень', 'Сообщение'], ...it.console.map((c) => [{ text: fmtRel(c.rel), fill: lvlFill(c.level) }, { text: LEVEL_RU[c.level] || c.level, fill: lvlFill(c.level) }, { text: short(c.text, 1500), mono: true, fill: lvlFill(c.level) }])], { widths: [1000, 1300, W - 2300] }); }
        if (it.perf.length) { d.h('Производительность', 3); it.perf.forEach((p) => d.p(`${fmtRel(p.rel)} — ${p.text}`)); }
      }
      if (it.ai) aiDOCX(d, it.ai);
    });
  }

  function aiDOCX(d, ai) {
    d.h('🤖 Разбор AI', 3);
    d.p(ai.model, { run: { color: '6B7280', size: 16 } });
    if (ai.title) d.p(ai.title, { run: { bold: true } });
    if (ai.steps.length) { d.p('Шаги воспроизведения:', { run: { bold: true, size: 18 } }); ai.steps.forEach((x, i) => d.p(`${i + 1}. ${x}`)); }
    if (ai.expected) d.p([d.run('Ожидалось: ', { bold: true }), d.run(ai.expected)]);
    if (ai.actual) d.p([d.run('Фактически: ', { bold: true }), d.run(ai.actual)]);
    if (ai.cause) d.p([d.run(`Вероятная причина (${SIDE_RU[ai.side] || 'не ясно'}): `, { bold: true }), d.run(ai.cause)]);
    if (ai.fix) { d.p('Что проверить:', { run: { bold: true, size: 18 } }); ai.fix.split('\n').filter(Boolean).forEach((x) => d.p(x)); }
    if (ai.questions.length) { d.p('Уточнить:', { run: { bold: true, size: 18 } }); ai.questions.forEach((q) => d.p('• ' + q)); }
  }
  function summaryDOCX(d, t) {
    d.h('🤖 Резюме AI', 1);
    String(t).split('\n').forEach((line) => {
      if (!line.trim()) return;
      const clean = line.replace(/^#{1,4}\s+/, '').replace(/^\s*[-*•]\s+/, '• ');
      const parts = clean.split(/\*\*(.+?)\*\*/);
      d.p(parts.map((x, i) => d.run(x, i % 2 ? { bold: true } : {})));
    });
  }

  // ================= 🩺 автопроверка =================
  const SEV_FILL = { blocker: 'FEE2E2', critical: 'FFEDD5', major: 'FEF9C3', minor: 'DBEAFE', trivial: 'F3F4F6' };
  function auditHTML(m) {
    if (!m.audit || !m.audit.length) return '';
    return `<h2>🩺 Автопроверка (${m.audit.length})</h2><p class="meta">Технические проблемы, найденные автоматически: не баги сценария, а то, что стоит улучшить.</p>` +
      m.audit.map((x) => `<div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px"><span class="sev" style="background:#${SEV_FILL[x.sev]};color:#111827">${escH(x.sevLabel)}</span><span class="tag">${escH(x.cat)}</span><b>${escH(x.title)}</b></div>
        <p><b>Почему это плохо:</b> ${escH(x.why)}</p><p><b>Как исправить:</b> ${escH(x.fix)}</p>
        ${x.examples.length ? `<ul>${x.examples.map((e) => `<li class="mono">${escH(e)}</li>`).join('')}</ul>` : ''}</div>`).join('');
  }
  function auditMD(m) {
    if (!m.audit || !m.audit.length) return '';
    let md = `## 🩺 Автопроверка (${m.audit.length})\n\n_Технические проблемы, найденные автоматически: не баги сценария, а то, что стоит улучшить._\n\n`;
    m.audit.forEach((x) => {
      md += `### ${x.title}\n\n**${x.sevLabel}** · ${x.cat}\n\n**Почему это плохо:** ${x.why}\n\n**Как исправить:** ${x.fix}\n\n`;
      if (x.examples.length) md += x.examples.map((e) => `- \`${String(e).replace(/`/g, "'")}\``).join('\n') + '\n\n';
    });
    return md;
  }
  function auditDOCX(d, m) {
    if (!m.audit || !m.audit.length) return;
    d.h(`🩺 Автопроверка (${m.audit.length})`, 1);
    d.p('Технические проблемы, найденные автоматически: не баги сценария, а то, что стоит улучшить.', { run: { color: '6B7280', size: 18 } });
    m.audit.forEach((x) => {
      d.h(x.title, 3);
      d.p([d.run(x.sevLabel, { bold: true, fill: SEV_FILL[x.sev] }), d.run('  ' + x.cat, { color: '6B7280' })]);
      d.p([d.run('Почему это плохо: ', { bold: true }), d.run(x.why)]);
      d.p([d.run('Как исправить: ', { bold: true }), d.run(x.fix)]);
      x.examples.forEach((e) => d.p('• ' + e, { run: { mono: true, size: 16 }, indent: 280, after: 20 }));
    });
  }

  // ---------------- DOCX ----------------
  function exportDOCX(m) {
    const d = new g.DocxBuilder();
    d.docTitle = m.title;
    const W = g.DOCX_TEXT_WIDTH;
    d.title(m.title);
    if (m.typeLabel) d.p([d.run('Тип бага: ', { bold: true }), d.run(m.typeLabel)]);
    d.p([m.severity ? d.run('Серьёзность: ', { bold: true }) + d.run(m.severity + '   ', { color: 'B91C1C', bold: true }) : m.sevSummary ? d.run('Пункты: ', { bold: true }) + d.run(m.sevSummary + '   ') : '', m.priority ? d.run('Приоритет: ', { bold: true }) + d.run(m.priority + '   ') : '', d.run('Создан: ', { bold: true }), d.run(m.createdAt)]);

    if (m.aiSummary) summaryDOCX(d, m.aiSummary);
    const section = (title, text) => { if (text) { d.h(title, 2); d.p(text); } };
    if (m.steps || m.expected || m.actual || m.notes) d.h('Описание', 1);
    section('Шаги воспроизведения', m.steps);
    section('Ожидаемый результат', m.expected);
    section('Фактический результат', m.actual);
    section('Дополнительно', m.notes);

    if (false && m.findings && m.findings.length) {
      d.h('Что найдено автоматически', 1);
      d.table([['', 'Находка', 'Подробности'], ...m.findings.map((f) => {
        const fill = f.level === 'error' ? 'FEF2F2' : f.level === 'warn' ? 'FFFBEB' : 'EFF6FF';
        return [{ text: f.level === 'error' ? '●' : f.level === 'warn' ? '▲' : 'i', fill, color: f.level === 'error' ? 'B91C1C' : f.level === 'warn' ? 'B45309' : '1D4ED8', bold: true }, { text: f.title, fill, bold: true }, { text: f.text, fill }];
      })], { widths: [400, 3800, W - 4200], size: 18 });
    }
    d.h('Окружение', 1);
    d.table([['Параметр', 'Значение'], ...m.env.map(([k, v]) => [{ text: k, bold: true }, String(v)])], { widths: [2700, W - 2700], size: 18 });

    itemsDOCX(d, m);
    auditDOCX(d, m);
    if (m.voice.length) { d.h('Голос', 1); m.voice.forEach((v) => d.p(v.link ? `🎤 Голосовой комментарий ${v.n} (${fmtRel(v.rel)}): ${v.link}` : `🎤 Голосовой комментарий ${v.n}: файл «${v.file.split('/').pop()}», ${fmtRel(v.rel)}, ${fmtDur(v.durationMs)}.`)); }
    if (m.appendix) {
    d.pageBreak();
    d.title('Приложение: все данные сессии');
    if (m.findings && m.findings.length) {
      d.h('Что найдено автоматически', 1);
      d.table([['', 'Находка', 'Подробности'], ...m.findings.map((f) => {
        const fill = f.level === 'error' ? 'FEF2F2' : f.level === 'warn' ? 'FFFBEB' : 'EFF6FF';
        return [{ text: f.level === 'error' ? '●' : f.level === 'warn' ? '▲' : 'i', fill, color: f.level === 'error' ? 'B91C1C' : f.level === 'warn' ? 'B45309' : '1D4ED8', bold: true }, { text: f.title, fill, bold: true }, { text: f.text, fill }];
      })], { widths: [400, 3800, W - 4200], size: 18 });
    }
    d.h(`Действия пользователя (${m.actions.length})`, 1);
    d.p('Время отсчитывается от начала проверки; «−» — действия до начала.', { run: { color: '6B7280', size: 18 } });
    if (m.actions.length) d.table([['Время', 'Действие', 'Страница'], ...m.actions.map((a) => [fmtRel(a.rel), a.text, short(a.page, 100)])], { widths: [1000, 5422, 3500] });

    d.h(`Консоль (${m.console.length})`, 1);
    if (m.console.length) {
      const LIM = 1500;
      d.table(
        [['Время', 'Уровень', 'Сообщение', 'Источник'], ...m.console.slice(0, LIM).map((c) => {
          const fill = c.level === 'error' ? 'FEF2F2' : c.level === 'warn' ? 'FFFBEB' : undefined;
          const color = c.level === 'error' ? '991B1B' : c.level === 'warn' ? '92400E' : undefined;
          return [{ text: fmtRel(c.rel), fill }, { text: LEVEL_RU[c.level] || c.level, fill, color, bold: c.level === 'error' }, { text: short(c.text, 1500), fill, color, mono: true }, { text: short(c.loc || c.source, 150), fill }];
        })],
        { widths: [1000, 1100, 5322, 2500] }
      );
      if (m.console.length > LIM) d.p(`… и ещё ${m.console.length - LIM} записей (см. HTML/Markdown).`);
    } else d.p('Записей нет.');

    d.h(`Сетевые запросы (${m.network.length})`, 1);
    if (m.network.length) {
      const LIM = 1500;
      d.table(
        [['Время', 'Метод', 'Статус', 'URL', 'Время отв.', 'Размер'], ...m.network.slice(0, LIM).map((e) => {
          const bad = isErr(e);
          const fill = bad ? 'FEF2F2' : undefined;
          const color = bad ? '991B1B' : undefined;
          return [{ text: fmtRel(e.rel), fill }, { text: e.method, fill }, { text: statusLabel(e), fill, color, bold: bad }, { text: short(e.url, 300) + (e.error ? '\n' + e.error : ''), fill, color, mono: true }, { text: fmtDur(e.duration), fill }, { text: fmtSize(e.size), fill }];
        })],
        { widths: [950, 750, 800, 5622, 900, 900] }
      );
      if (m.network.length > LIM) d.p(`… и ещё ${m.network.length - LIM} запросов (см. HAR).`);
    } else d.p('Запросов нет.');

    }
    if (m.appendix && m.details) {
      const det = m.network.filter((e) => isErr(e) || ['XHR', 'Fetch'].includes(e.type)).filter((e) => hasH(e.reqHeaders) || e.body || e.postData).slice(0, 150);
      if (det.length) {
        d.h('Детали запросов (API и ошибки)', 1);
        det.forEach((e) => {
          d.h(`${e.method} ${statusLabel(e)} ${short(e.url, 110)}`, 3);
          if (hasH(e.reqHeaders)) { d.p('Заголовки запроса:', { run: { bold: true, size: 18 } }); d.code(hdrText(e.reqHeaders)); }
          if (e.postData) { d.p('Тело запроса:', { run: { bold: true, size: 18 } }); d.code(short(e.postData, 5000)); }
          if (hasH(e.resHeaders)) { d.p('Заголовки ответа:', { run: { bold: true, size: 18 } }); d.code(hdrText(e.resHeaders)); }
          if (e.body) { d.p('Ответ:', { run: { bold: true, size: 18 } }); d.code(short(e.body, 5000)); }
        });
      }
    }
    const p = m.perf;
    if (p) {
      d.h('Производительность', 1);
      if (p.vitals.length) d.table([['Метрика', 'Значение', 'Оценка'], ...p.vitals.map((v) => {
        const fill = v.level === 'good' ? 'ECFDF5' : v.level === 'ni' ? 'FFFBEB' : 'FEF2F2';
        return [{ text: `${v.name} — ${v.title}`, fill }, { text: v.value, fill, bold: true }, { text: v.rating, fill }];
      })], { widths: [5000, 2200, W - 7200], size: 18 });
      const facts = [['Загрузка', p.navigation], ['Память JS', p.memory], ['DOM-узлы', p.nodes], ['FPS (минимум)', p.fps]].filter((x) => x[1]);
      facts.forEach(([a, b]) => d.p([d.run(a + ': ', { bold: true }), d.run(b)]));
      const evT = (title, list) => { if (!list.length) return; d.h(title, 2); d.table([['Время', 'Событие'], ...list.map((e) => [fmtRel(e.rel), { text: e.text + (e.sub ? '\n' + e.sub : '') }])], { widths: [1000, W - 1000] }); };
      if (p.renders.length) { d.h('Перерисовки React', 2); d.table([['Компонент', 'Перерисовок', 'Монтирований'], ...p.renders.map((r) => [{ text: r[0], mono: true }, String(r[1]), String(r[2])])], { widths: [5922, 2000, 2000] }); }
      evT('Долгие кадры (зависания)', p.longFrames);
      evT('Медленные отклики', p.slow);
      evT('Сдвиги макета', p.shifts);
      if (p.cdp.length) { d.h('Метрики DevTools', 2); d.table([['Метрика', 'Начало', 'Конец', 'Разница'], ...p.cdp], { widths: [4422, 1800, 1800, 1900] }); }
    }
    if (m.events && m.events.length) {
      d.h(`События страницы (${m.events.length})`, 1);
      d.table([['Время', 'Тип', 'Событие'], ...m.events.slice(0, 1500).map((e) => {
        const fill = e.level === 'error' ? 'FEF2F2' : e.level === 'warn' ? 'FFFBEB' : undefined;
        return [{ text: fmtRel(e.rel), fill }, { text: e.cat, fill }, { text: e.text, fill }];
      })], { widths: [1000, 1500, W - 2500] });
    }
    if (m.storage) {
      const st = m.storage;
      d.h('Cookies и хранилище', 1);
      d.p('Снимок в момент начала проверки.', { run: { color: '6B7280', size: 18 } });
      const t = (title, rows, head) => { d.h(`${title} (${rows.length})`, 2); if (rows.length) d.table([head, ...rows.map((r) => r.map((c, i) => ({ text: short(c, 400), mono: i !== 1 })))], { widths: [2800, 1000, W - 3800] }); else d.p('Пусто'); };
      t('Cookies', st.cookies, ['Имя', 'Размер', 'Значение']);
      t('localStorage', st.local, ['Ключ', 'Размер', 'Значение']);
      t('sessionStorage', st.session, ['Ключ', 'Размер', 'Значение']);
      if (st.changes.length) { d.h('Изменения во время теста', 2); d.table([['Время', 'Операция'], ...st.changes.map((r) => [r[0], { text: r[1], mono: true }])], { widths: [1000, W - 1000] }); }
    }
    d.p(`Сформировано QA Bug Recorder · ${m.generatedAt}`, { run: { color: '9CA3AF', size: 16 }, before: 400 });
    return d.build();
  }

  // ---------------- HAR ----------------
  function exportHAR(m) {
    const arr = (h) => Object.entries(h || {}).map(([name, value]) => ({ name, value: String(value) }));
    const qs = (u) => { try { return [...new URL(u).searchParams].map(([name, value]) => ({ name, value })); } catch (_) { return []; } };
    return {
      log: {
        version: '1.2',
        creator: { name: 'QA Bug Recorder', version: '1.0.0' },
        pages: [],
        entries: m.network.map((e) => {
          const ct = Object.entries(e.reqHeaders || {}).find(([k]) => k.toLowerCase() === 'content-type');
          return {
            startedDateTime: new Date(e.ts).toISOString(),
            time: e.duration || 0,
            request: {
              method: e.method, url: e.url, httpVersion: e.protocol || 'HTTP/1.1', headers: arr(e.reqHeaders), queryString: qs(e.url), cookies: [],
              headersSize: -1, bodySize: e.postData ? e.postData.length : 0,
              ...(e.postData ? { postData: { mimeType: ct ? ct[1] : '', text: e.postData } } : {}),
            },
            response: {
              status: e.status || 0, statusText: e.statusText || e.error || '', httpVersion: e.protocol || 'HTTP/1.1', headers: arr(e.resHeaders), cookies: [],
              content: { size: e.size || 0, mimeType: e.mime || '', ...(e.body ? { text: e.body } : {}) },
              redirectURL: e.redirectedTo || '', headersSize: -1, bodySize: e.size || -1,
              ...(e.error ? { _error: e.error } : {}),
            },
            cache: {},
            timings: { send: 0, wait: e.duration || 0, receive: 0 },
            _resourceType: (e.type || '').toLowerCase(),
          };
        }),
      },
    };
  }

  const TR = (f) => (...a) => { const r = f(...a); return typeof r === 'string' && globalThis.QAI18N ? QAI18N.T(r) : r; };
  g.QAExport = { itemText: TR(itemText), aiLines, mdLite, exportHTML: TR(exportHTML), exportMarkdown: TR(exportMarkdown), exportDOCX, exportHAR, describeAction, fmtRel, fmtDur, fmtSize, statusLabel, isErr, LEVEL_RU, KIND_RU };
})(typeof window !== 'undefined' ? window : globalThis);
