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
  const KIND_RU = { element: 'Элемент', arrow: 'Стрелка', rect: 'Область', note: 'Заметка' };
  const isErr = (e) => !!(e.failed || e.status >= 400);
  const statusLabel = (e) => (e.failed ? (e.canceled ? 'отменён' : e.blocked ? 'блок.' : 'ошибка') : e.status == null ? '…' : String(e.status));
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
    return '<h2>Cookies и хранилище</h2><p class="meta">Снимок в момент нажатия «Нашёл баг».</p>' +
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
      .map((v) => (media[v.file] ? `<div class="card"><div class="label">Голосовой комментарий ${v.n} · ${fmtRel(v.rel)} · ${fmtDur(v.durationMs)}</div><audio controls src="${media[v.file]}"></audio></div>` : `<div class="card">Голос ${v.n}: файл <b>${escH(v.file)}</b> (${fmtSize(v.size)})</div>`))
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
<h1>${escH(m.title)}</h1><span class="sev">${escH(m.severity)}</span>${m.priority ? ` <span class="sev" style="background:#e0e7ff;color:#3730a3">Приоритет: ${escH(m.priority)}</span>` : ''}
<p class="meta">Создан ${escH(m.createdAt)} · QA Bug Recorder</p>
<h2>Описание</h2>
${block('Шаги воспроизведения', m.steps)}
<div class="grid">${block('Ожидаемый результат', m.expected) || '<div></div>'}${block('Фактический результат', m.actual) || '<div></div>'}</div>
${block('Дополнительно', m.notes)}
${m.findings && m.findings.length ? `<h2>Что найдено автоматически</h2><div class="finds">${m.findings.map((f) => `<div class="find ${f.level}"><b>${escH(f.title)}</b><span>${escH(f.text)}</span></div>`).join('')}</div>` : ''}
<h2>Окружение</h2>${tblEnv}
${m.videos.length || m.voice.length ? `<h2>Видео и голос</h2>${videos}${voices}` : ''}
${m.annotations.length ? `<h2>Пометки (${m.annotations.length})</h2><div class="ann">${anns}</div>` : ''}
<h2>Действия пользователя (${m.actions.length})</h2><p class="meta">Время отсчитывается от нажатия «Нашёл баг», «−» — действия до нажатия.</p>${steps}
<h2>Консоль (${m.console.length})</h2>${consoleT}
<h2>Сетевые запросы (${m.network.length})</h2>${netT}
${details ? `<h2>Детали запросов</h2>${details}` : ''}
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
    let md = `# ${m.title}\n\n**Серьёзность:** ${m.severity}${m.priority ? ` · **Приоритет:** ${m.priority}` : ''}  \n**Создан:** ${m.createdAt}\n\n`;
    if (m.steps) md += `## Шаги воспроизведения\n\n${m.steps}\n\n`;
    if (m.expected) md += `## Ожидаемый результат\n\n${m.expected}\n\n`;
    if (m.actual) md += `## Фактический результат\n\n${m.actual}\n\n`;
    if (m.notes) md += `## Дополнительно\n\n${m.notes}\n\n`;
    if (m.findings && m.findings.length) {
      md += `## Что найдено автоматически\n\n` + m.findings.map((f) => `- ${f.level === 'error' ? '🔴' : f.level === 'warn' ? '🟡' : 'ℹ️'} **${f.title}** — ${f.text}`).join('\n') + '\n\n';
    }
    md += `## Окружение\n\n` + mdTable(['Параметр', 'Значение'], m.env.map(([k, v]) => [mdCell(k), mdCell(v, 1000)])) + '\n';
    if (m.videos.length || m.voice.length) {
      md += `## Видео и голос\n\n`;
      m.videos.forEach((v) => (md += `- 🎬 [Видео ${v.n}](${v.file}) — начато в ${fmtRel(v.rel)}, ${fmtDur(v.durationMs)}, ${fmtSize(v.size)}\n`));
      m.voice.forEach((v) => (md += `- 🎤 [Голосовой комментарий ${v.n}](${v.file}) — ${fmtRel(v.rel)}, ${fmtDur(v.durationMs)}\n`));
      md += '\n';
    }
    if (m.annotations.length) {
      md += `## Пометки\n\n`;
      m.annotations.forEach((a) => {
        md += `### ${a.n}. ${a.comment ? short(a.comment.split('\n')[0], 100) : '(без комментария)'}\n\n`;
        md += `*${KIND_RU[a.kind] || a.kind} · ${fmtRel(a.rel)} · ${a.url}*\n\n`;
        if (a.comment && a.comment.includes('\n')) md += a.comment + '\n\n';
        if (a.element) {
          md += `**Элемент:** \`${a.element.selector}\` — <${a.element.tag}>, ${Math.round(a.element.rect.w)}×${Math.round(a.element.rect.h)}${a.element.text ? `, текст: «${short(a.element.text, 120)}»` : ''}\n\n`;
          md += `<details><summary>HTML и стили элемента</summary>\n\n` + fence(a.element.html, 'html') + '\n' + fence(Object.entries(a.element.styles || {}).map(([k, v]) => `${k}: ${v};`).join('\n'), 'css') + '\n</details>\n\n';
        }
        if (a.file) md += `![Пометка ${a.n}](${a.file})\n\n`;
      });
    }
    md += `## Действия пользователя\n\n_Время от нажатия «Нашёл баг»; «−» — до нажатия._\n\n`;
    md += m.actions.length ? mdTable(['Время', 'Действие', 'Страница'], m.actions.map((a) => [fmtRel(a.rel), mdCell(a.text), mdCell(a.page, 120)])) : '_Нет данных._\n';
    md += `\n## Консоль\n\n`;
    md += m.console.length
      ? mdTable(['Время', 'Уровень', 'Сообщение', 'Источник'], m.console.map((c) => [fmtRel(c.rel), (c.level === 'error' ? '🔴 ' : c.level === 'warn' ? '🟡 ' : '') + (LEVEL_RU[c.level] || c.level), mdCell(c.text, 600), mdCell(c.loc || c.source, 150)]))
      : '_Нет записей._\n';
    md += `\n## Сетевые запросы\n\n`;
    md += m.network.length
      ? mdTable(['Время', 'Метод', 'Статус', 'Тип', 'URL', 'Время отв.', 'Размер'], m.network.map((e) => [fmtRel(e.rel), e.method, (isErr(e) ? '🔴 ' : '') + statusLabel(e), e.type || '', mdCell(e.url + (e.error ? ` — ${e.error}` : ''), 250), fmtDur(e.duration), fmtSize(e.size)]))
      : '_Нет запросов._\n';
    if (m.details) {
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
      md += `\n## Cookies и хранилище\n\n_Снимок в момент нажатия «Нашёл баг»._\n` + t('Cookies', st.cookies, ['Имя', 'Размер', 'Значение']) + t('localStorage', st.local, ['Ключ', 'Размер', 'Значение']) + t('sessionStorage', st.session, ['Ключ', 'Размер', 'Значение']) + t('Изменения во время теста', st.changes, ['Время', 'Операция']);
    }
    md += `\n---\n_Сформировано QA Bug Recorder · ${m.generatedAt}_\n`;
    return md;
  }

  // ---------------- DOCX ----------------
  function exportDOCX(m) {
    const d = new g.DocxBuilder();
    d.docTitle = m.title;
    const W = g.DOCX_TEXT_WIDTH;
    d.title(m.title);
    d.p([d.run('Серьёзность: ', { bold: true }), d.run(m.severity, { color: 'B91C1C', bold: true }), m.priority ? d.run('   Приоритет: ', { bold: true }) + d.run(m.priority) : '', d.run('   Создан: ', { bold: true }), d.run(m.createdAt)]);

    const section = (title, text) => { if (text) { d.h(title, 2); d.p(text); } };
    if (m.steps || m.expected || m.actual || m.notes) d.h('Описание', 1);
    section('Шаги воспроизведения', m.steps);
    section('Ожидаемый результат', m.expected);
    section('Фактический результат', m.actual);
    section('Дополнительно', m.notes);

    if (m.findings && m.findings.length) {
      d.h('Что найдено автоматически', 1);
      d.table([['', 'Находка', 'Подробности'], ...m.findings.map((f) => {
        const fill = f.level === 'error' ? 'FEF2F2' : f.level === 'warn' ? 'FFFBEB' : 'EFF6FF';
        return [{ text: f.level === 'error' ? '●' : f.level === 'warn' ? '▲' : 'i', fill, color: f.level === 'error' ? 'B91C1C' : f.level === 'warn' ? 'B45309' : '1D4ED8', bold: true }, { text: f.title, fill, bold: true }, { text: f.text, fill }];
      })], { widths: [400, 3800, W - 4200], size: 18 });
    }
    d.h('Окружение', 1);
    d.table([['Параметр', 'Значение'], ...m.env.map(([k, v]) => [{ text: k, bold: true }, String(v)])], { widths: [2700, W - 2700], size: 18 });

    if (m.videos.length || m.voice.length) {
      d.h('Видео и голос', 1);
      m.videos.forEach((v) => d.p(`🎬 Видео ${v.n}: файл «${v.file.split('/').pop()}», начато в ${fmtRel(v.rel)}, длительность ${fmtDur(v.durationMs)}, ${fmtSize(v.size)}. Прикладывается отдельным файлом.`));
      m.voice.forEach((v) => d.p(`🎤 Голосовой комментарий ${v.n}: файл «${v.file.split('/').pop()}», ${fmtRel(v.rel)}, ${fmtDur(v.durationMs)}.`));
    }

    if (m.annotations.length) {
      d.h(`Пометки (${m.annotations.length})`, 1);
      m.annotations.forEach((a) => {
        d.h(`${a.n}. ${a.comment ? short(a.comment.split('\n')[0], 90) : '(без комментария)'}`, 2);
        d.p([d.run(`${KIND_RU[a.kind] || a.kind} · ${fmtRel(a.rel)} · `, { color: '6B7280', size: 18 }), d.run(a.url, { color: '6B7280', size: 18 })]);
        if (a.comment && a.comment.includes('\n')) d.p(a.comment);
        if (a.element) {
          d.table(
            [
              ['Свойство', 'Значение'],
              ['Селектор', { text: a.element.selector, mono: true }],
              ['Тег / размер', `<${a.element.tag}>  ${Math.round(a.element.rect.w)}×${Math.round(a.element.rect.h)} px`],
              ['Текст', short(a.element.text, 300)],
              ['Стили', { text: Object.entries(a.element.styles || {}).map(([k, v]) => `${k}: ${v}`).join('\n'), mono: true }],
            ],
            { widths: [2000, W - 2000], size: 16 }
          );
        }
        if (a.bytes && a.w) d.image(a.bytes, a.w, a.h);
      });
    }

    d.h(`Действия пользователя (${m.actions.length})`, 1);
    d.p('Время отсчитывается от нажатия «Нашёл баг»; «−» — действия до нажатия.', { run: { color: '6B7280', size: 18 } });
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

    if (m.details) {
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
      d.p('Снимок в момент нажатия «Нашёл баг».', { run: { color: '6B7280', size: 18 } });
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

  g.QAExport = { exportHTML, exportMarkdown, exportDOCX, exportHAR, describeAction, fmtRel, fmtDur, fmtSize, statusLabel, isErr, LEVEL_RU, KIND_RU };
})(typeof window !== 'undefined' ? window : globalThis);
