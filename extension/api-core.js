// Тестирование API по спецификации: импорт OpenAPI/Swagger и Postman, генерация проверок,
// цепочки запросов, прогон и разбор «что не так». Работает на странице расширения (api.html).
(function (g) {
  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const rnd = () => Math.random().toString(36).slice(2, 8);
  const short = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };

  // ================= импорт =================
  function parseText(text) {
    const t = String(text || '').trim();
    if (!t) throw new Error('Пустой файл');
    if (/^[{[]/.test(t)) return JSON.parse(t);
    if (!g.jsyaml) throw new Error('YAML не поддерживается');
    return g.jsyaml.load(t);
  }
  function detect(doc) {
    if (doc && (doc.openapi || doc.swagger)) return 'openapi';
    if (doc && doc.info && (doc.item || (doc.info.schema || '').includes('postman'))) return 'postman';
    throw new Error('Не похоже на Swagger/OpenAPI или коллекцию Postman');
  }

  // ---------- $ref ----------
  function makeResolver(doc) {
    const get = (ref) => {
      if (!/^#\//.test(ref)) return {};
      return ref.slice(2).split('/').reduce((o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), doc) || {};
    };
    // раскрывает ссылки на глубину depth (рекурсивные схемы обрезаются)
    const deref = (s, depth = 0, seen = []) => {
      if (!s || typeof s !== 'object') return s;
      if (Array.isArray(s)) return s.map((x) => deref(x, depth, seen));
      if (s.$ref) {
        if (seen.includes(s.$ref) || depth > 12) return { type: 'object', description: '(рекурсия ' + s.$ref.split('/').pop() + ')' };
        const r = deref(get(s.$ref), depth + 1, seen.concat(s.$ref));
        const rest = { ...s };
        delete rest.$ref;
        return Object.keys(rest).length ? { ...r, ...deref(rest, depth + 1, seen) } : r;
      }
      const o = {};
      for (const k of Object.keys(s)) o[k] = k === 'example' || k === 'examples' || k === 'default' || k === 'enum' ? s[k] : deref(s[k], depth + 1, seen);
      return o;
    };
    return { get, deref };
  }
  const jsonCt = (content) => {
    if (!content) return null;
    const k = Object.keys(content).find((c) => /json/i.test(c)) || Object.keys(content).find((c) => /form/i.test(c)) || Object.keys(content)[0];
    return k ? { type: k, media: content[k] } : null;
  };

  function fromOpenAPI(doc) {
    const R = makeResolver(doc);
    const v2 = !!doc.swagger;
    let base = '';
    if (v2) base = doc.host ? `${(doc.schemes || ['https'])[0]}://${doc.host}${doc.basePath || ''}` : doc.basePath || '';
    else if (doc.servers && doc.servers[0]) {
      base = doc.servers[0].url || '';
      const vars = doc.servers[0].variables || {};
      base = base.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ? vars[k].default : m));
    }
    const servers = v2 ? [base] : (doc.servers || []).map((s) => s.url);
    const globalSec = doc.security || [];
    const schemes = v2 ? doc.securityDefinitions || {} : (doc.components && doc.components.securitySchemes) || {};
    const eps = [];
    for (const [path, item0] of Object.entries(doc.paths || {})) {
      const item = R.deref(item0, 0);
      const common = item.parameters || [];
      for (const m of METHODS) {
        const op = item[m];
        if (!op) continue;
        const params = [...common, ...(op.parameters || [])].map((p) => R.deref(p)).filter((p) => p && p.in !== 'body' && p.in !== 'formData');
        let body = null;
        if (v2) {
          const bp = [...common, ...(op.parameters || [])].map((p) => R.deref(p)).find((p) => p && p.in === 'body');
          const fd = [...common, ...(op.parameters || [])].map((p) => R.deref(p)).filter((p) => p && p.in === 'formData');
          if (bp) body = { contentType: (op.consumes || doc.consumes || ['application/json'])[0], schema: R.deref(bp.schema || {}), required: !!bp.required, example: bp.schema && bp.schema.example };
          else if (fd.length) body = { contentType: 'application/x-www-form-urlencoded', schema: { type: 'object', required: fd.filter((p) => p.required).map((p) => p.name), properties: Object.fromEntries(fd.map((p) => [p.name, { type: p.type, format: p.format, enum: p.enum }])) }, required: true };
        } else if (op.requestBody) {
          const rb = R.deref(op.requestBody);
          const c = jsonCt(rb.content);
          if (c) body = { contentType: c.type, schema: R.deref(c.media.schema || {}), required: !!rb.required, example: c.media.example || (c.media.examples && Object.values(c.media.examples)[0] && R.deref(Object.values(c.media.examples)[0]).value) };
        }
        const responses = {};
        for (const [code, r0] of Object.entries(op.responses || {})) {
          const r = R.deref(r0);
          const schema = v2 ? r.schema : jsonCt(r.content) && jsonCt(r.content).media.schema;
          responses[code] = { description: r.description || '', schema: schema ? R.deref(schema) : null };
        }
        const sec = op.security !== undefined ? op.security : globalSec;
        const secured = Array.isArray(op.security) && !op.security.length ? false : Array.isArray(sec) && sec.some((x) => Object.keys(x).length) ? true : Object.keys(schemes).length ? false : undefined;
        eps.push({
          id: m.toUpperCase() + ' ' + path,
          method: m.toUpperCase(), path, summary: op.summary || op.operationId || '', tag: (op.tags || [])[0] || path.split('/').filter(Boolean)[0] || 'other',
          params: params.map((p) => ({ name: p.name, in: p.in, required: !!p.required || p.in === 'path', schema: v2 ? { type: p.type, format: p.format, enum: p.enum, items: p.items, minimum: p.minimum, maximum: p.maximum } : p.schema || {}, example: p.example })),
          body, responses, secured, deprecated: !!op.deprecated,
        });
      }
    }
    return { kind: 'openapi', title: (doc.info && doc.info.title) || 'API', version: (doc.info && doc.info.version) || '', base, servers, endpoints: eps, securitySchemes: Object.keys(schemes).map((k) => ({ name: k, ...schemes[k] })) };
  }

  // ---------- Postman ----------
  function inferSchema(v, depth = 0) {
    if (v === null) return { nullable: true };
    if (Array.isArray(v)) return { type: 'array', items: v.length ? inferSchema(v[0], depth + 1) : {} };
    if (typeof v === 'object') {
      if (depth > 6) return { type: 'object' };
      return { type: 'object', required: Object.keys(v), properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inferSchema(x, depth + 1)])) };
    }
    if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'number' };
    if (typeof v === 'boolean') return { type: 'boolean' };
    const s = String(v);
    const f = /^\d{4}-\d{2}-\d{2}T/.test(s) ? 'date-time' : /^[^@\s]+@[^@\s]+\.\w+$/.test(s) ? 'email' : /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) ? 'uuid' : undefined;
    return { type: 'string', format: f };
  }
  const SET_RE = /pm\.(?:environment|collectionVariables|globals|variables)\.set\(\s*["'`]([\w.-]+)["'`]\s*,\s*([^)]+)\)/g;
  function extractRules(events) {
    const out = [];
    for (const ev of events || []) {
      if (ev.listen !== 'test' || !ev.script) continue;
      const code = [].concat(ev.script.exec || []).join('\n');
      const aliases = new Set(['pm.response.json()']);
      (code.match(/(?:var|let|const)\s+(\w+)\s*=\s*pm\.response\.json\(\)/g) || []).forEach((l) => aliases.add(l.match(/(?:var|let|const)\s+(\w+)/)[1]));
      let m;
      SET_RE.lastIndex = 0;
      while ((m = SET_RE.exec(code))) {
        const expr = m[2].trim();
        const a = [...aliases].find((x) => expr === x || expr.startsWith(x + '.') || expr.startsWith(x + '['));
        if (a) out.push({ var: m[1], path: '$' + expr.slice(a.length) });
      }
    }
    return out;
  }
  function fromPostman(doc) {
    const eps = [];
    const vars = {};
    (doc.variable || []).forEach((v) => (vars[v.key] = v.value));
    const walk = (items, folder) => {
      for (const it of items || []) {
        if (it.item) { walk(it.item, it.name); continue; }
        const rq = it.request;
        if (!rq) continue;
        const req = typeof rq === 'string' ? { method: 'GET', url: rq } : rq;
        const raw = typeof req.url === 'string' ? req.url : (req.url && (req.url.raw || [((req.url.protocol ? req.url.protocol + '://' : '') + [].concat(req.url.host || []).join('.')), [].concat(req.url.path || []).join('/')].join('/'))) || '';
        let body = null;
        const b = req.body;
        if (b && b.mode === 'raw' && b.raw) {
          let parsed = null;
          try { parsed = JSON.parse(b.raw.replace(/\{\{[\w.-]+\}\}/g, (m) => '"' + m + '"').replace(/""\{\{/g, '"{{').replace(/\}\}""/g, '}}"')); } catch (_) {}
          body = { contentType: (b.options && b.options.raw && b.options.raw.language === 'json') || parsed ? 'application/json' : 'text/plain', raw: b.raw, example: parsed, schema: parsed ? inferSchema(parsed) : null, required: true };
        } else if (b && (b.mode === 'urlencoded' || b.mode === 'formdata')) {
          const o = {};
          (b[b.mode] || []).filter((x) => !x.disabled && x.type !== 'file').forEach((x) => (o[x.key] = x.value));
          body = { contentType: 'application/x-www-form-urlencoded', example: o, schema: inferSchema(o), required: true };
        }
        const responses = {};
        (it.response || []).forEach((r) => {
          let j = null;
          try { j = JSON.parse(r.body); } catch (_) {}
          responses[String(r.code || 200)] = { description: r.name || '', schema: j != null ? inferSchema(j) : null, inferred: true };
        });
        const path = raw.replace(/^\{\{[\w.-]+\}\}/, '').replace(/^https?:\/\/[^/]+/, '').split('?')[0] || '/';
        const query = (req.url && req.url.query) || [];
        const pathVars = (req.url && req.url.variable) || [];
        eps.push({
          id: (req.method || 'GET') + ' ' + raw + ' #' + eps.length,
          method: (req.method || 'GET').toUpperCase(), path, rawUrl: raw, summary: it.name || '', tag: folder || 'Коллекция',
          params: query.filter((q) => !q.disabled).map((q) => ({ name: q.key, in: 'query', required: false, schema: { type: 'string' }, example: q.value }))
            .concat(pathVars.map((v) => ({ name: v.key, in: 'path', required: true, schema: inferSchema(/^\d+$/.test(String(v.value)) ? +v.value : String(v.value || '')), example: v.value }))),
          headers: (req.header || []).filter((h) => !h.disabled).map((h) => ({ key: h.key, value: h.value })),
          body, responses, secured: !!(req.auth && req.auth.type !== 'noauth') || !!(doc.auth && doc.auth.type !== 'noauth'),
          extract: extractRules(it.event),
        });
      }
    };
    walk(doc.item);
    const baseVar = (eps[0] && (eps[0].rawUrl.match(/^\{\{([\w.-]+)\}\}/) || [])[1]) || '';
    return { kind: 'postman', title: (doc.info && doc.info.name) || 'Коллекция', version: '', base: baseVar ? vars[baseVar] || '' : ((eps[0] && eps[0].rawUrl.match(/^https?:\/\/[^/]+/)) || [''])[0], baseVar, vars, endpoints: eps, auth: doc.auth || null };
  }
  function importSpec(text) {
    const doc = parseText(text);
    const kind = detect(doc);
    return kind === 'openapi' ? fromOpenAPI(doc) : fromPostman(doc);
  }

  // ================= данные по схеме =================
  const allOf = (s) => {
    if (!s || !s.allOf) return s;
    const m = { ...s, type: 'object', properties: {}, required: [] };
    delete m.allOf;
    for (const p of s.allOf) {
      const x = allOf(p) || {};
      Object.assign(m.properties, x.properties || {});
      m.required = m.required.concat(x.required || []);
      if (x.type && x.type !== 'object') m.type = x.type;
    }
    Object.assign(m.properties, s.properties || {});
    m.required = [...new Set(m.required.concat(s.required || []))];
    return m;
  };
  const typeOf = (s) => (s ? (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type) || (s.properties ? 'object' : s.items ? 'array' : undefined) : undefined);
  function sample(s, name = '', depth = 0) {
    s = allOf(s);
    if (!s) return null;
    if (s.example !== undefined) return clone(s.example);
    if (s.examples && Array.isArray(s.examples) && s.examples.length) return clone(s.examples[0]);
    if (s.default !== undefined) return clone(s.default);
    if (s.enum && s.enum.length) return s.enum[0];
    if (s.const !== undefined) return s.const;
    if (s.oneOf || s.anyOf) return sample((s.oneOf || s.anyOf)[0], name, depth + 1);
    const t = typeOf(s);
    const n = String(name).toLowerCase();
    if (t === 'object' || (!t && s.properties)) {
      if (depth > 5) return {};
      const o = {};
      for (const [k, p] of Object.entries(s.properties || {})) if (!(p && p.readOnly)) o[k] = sample(p, k, depth + 1);
      return o;
    }
    if (t === 'array') return depth > 5 ? [] : [sample(s.items || {}, name, depth + 1)].filter((x) => x !== undefined);
    if (t === 'integer' || t === 'number') {
      let v = /price|amount|sum|cost/.test(n) ? 100 : /count|qty|quantity/.test(n) ? 1 : /age/.test(n) ? 30 : 1;
      if (s.minimum != null && v < s.minimum) v = s.minimum;
      if (s.exclusiveMinimum != null && typeof s.exclusiveMinimum === 'number' && v <= s.exclusiveMinimum) v = s.exclusiveMinimum + 1;
      if (s.maximum != null && v > s.maximum) v = s.maximum;
      return t === 'integer' ? Math.round(v) : v;
    }
    if (t === 'boolean') return true;
    const f = s.format || '';
    let v;
    if (f === 'email' || /e-?mail/.test(n)) v = `qa.${rnd()}@example.com`;
    else if (f === 'date-time') v = new Date().toISOString();
    else if (f === 'date' || /date|birth/.test(n)) v = new Date().toISOString().slice(0, 10);
    else if (f === 'uuid') v = crypto.randomUUID();
    else if (f === 'uri' || f === 'url' || /url|link|site/.test(n)) v = 'https://example.com/qa-' + rnd();
    else if (f === 'password' || /pass/.test(n)) v = 'Qa!' + rnd() + 'A1';
    else if (/phone|tel/.test(n)) v = '+77001234567';
    else if (/^(first_?name|name|title|username|login)$/.test(n)) v = 'QA ' + rnd();
    else if (/description|comment|text|message/.test(n)) v = 'Создано автотестом QA Bug Recorder';
    else if (f === 'ipv4') v = '127.0.0.1';
    else v = 'qa-' + rnd();
    if (s.pattern) { try { if (!new RegExp(s.pattern).test(v)) v = s.minLength ? 'a'.repeat(s.minLength) : v; } catch (_) {} }
    if (s.minLength && v.length < s.minLength) v = v.padEnd(s.minLength, 'x');
    if (s.maxLength && v.length > s.maxLength) v = v.slice(0, s.maxLength);
    return v;
  }

  // ================= проверка ответа по схеме =================
  const FMT = {
    'date-time': (v) => !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v),
    date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
    email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
    uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    uri: (v) => /^[a-z][a-z0-9+.-]*:/i.test(v),
  };
  const jtype = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
  function validate(s, v, path = '$', errs = [], depth = 0) {
    if (!s || errs.length > 30 || depth > 30) return errs;
    s = allOf(s);
    if (s.oneOf || s.anyOf) {
      const opts = s.oneOf || s.anyOf;
      if (!opts.some((o) => !validate(o, v, path, [], depth + 1).length)) errs.push({ path, text: 'не подходит ни под один из вариантов схемы (oneOf/anyOf)' });
      return errs;
    }
    const nullable = s.nullable || (Array.isArray(s.type) && s.type.includes('null'));
    if (v === null) { if (!nullable && typeOf(s)) errs.push({ path, text: `пришёл null, а по схеме ${typeOf(s)} (не nullable)` }); return errs; }
    const t = typeOf(s);
    const jt = jtype(v);
    if (t && !(t === jt || (t === 'number' && jt === 'integer'))) { errs.push({ path, text: `ожидался ${t}, пришёл ${jt}${jt === 'string' ? ` («${short(v, 30)}»)` : ''}` }); return errs; }
    if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) errs.push({ path, text: `значение ${short(JSON.stringify(v), 40)} не из списка допустимых: ${short(s.enum.join(', '), 80)}` });
    if (jt === 'string') {
      if (s.format && FMT[s.format] && !FMT[s.format](v)) errs.push({ path, text: `не соответствует формату ${s.format}: «${short(v, 40)}»` });
      if (s.maxLength != null && v.length > s.maxLength) errs.push({ path, text: `длина ${v.length} больше maxLength ${s.maxLength}` });
    }
    if ((jt === 'number' || jt === 'integer') && ((s.minimum != null && v < s.minimum) || (s.maximum != null && v > s.maximum))) errs.push({ path, text: `значение ${v} вне диапазона ${s.minimum ?? '−∞'}…${s.maximum ?? '∞'}` });
    if (jt === 'object') {
      for (const r of s.required || []) if (!(r in v) && !(s.properties && s.properties[r] && s.properties[r].writeOnly)) errs.push({ path: `${path}.${r}`, text: 'обязательное поле отсутствует в ответе' });
      for (const [k, p] of Object.entries(s.properties || {})) if (k in v) validate(p, v[k], `${path}.${k}`, errs, depth + 1);
    }
    if (jt === 'array' && s.items) v.slice(0, 5).forEach((x, i) => validate(s.items, x, `${path}[${i}]`, errs, depth + 1));
    return errs;
  }

  // ================= переменные и запросы =================
  const getPath = (obj, p) => {
    if (!p || p === '$') return obj;
    const parts = p.replace(/^\$\.?/, '').match(/[^.[\]]+|\[\d+\]/g) || [];
    return parts.reduce((o, k) => (o == null ? undefined : o[/^\[\d+\]$/.test(k) ? +k.slice(1, -1) : k]), obj);
  };
  const subst = (str, vars) => String(str).replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (m, k) => (k === '$randomInt' ? String(Math.floor(Math.random() * 1e6)) : k === '$guid' || k === '$randomUUID' ? crypto.randomUUID() : k === '$timestamp' ? String(Math.floor(Date.now() / 1000)) : k === '$randomEmail' ? `qa.${rnd()}@example.com` : vars[k] != null ? String(vars[k]) : m));
  const substDeep = (v, vars) => (typeof v === 'string' ? (/^\{\{[\w.$-]+\}\}$/.test(v.trim()) && vars[v.trim().slice(2, -2)] != null && typeof vars[v.trim().slice(2, -2)] !== 'string' ? vars[v.trim().slice(2, -2)] : subst(v, vars)) : Array.isArray(v) ? v.map((x) => substDeep(x, vars)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substDeep(x, vars)])) : v);
  function pathParamValue(ep, p, vars) {
    const seg = ep.path.split('/{' + p.name + '}')[0].split('/').filter(Boolean).pop();
    for (const k of [seg + '_' + p.name, p.name, ep.tag + '_' + p.name]) if (vars[k] != null) return vars[k];
    return p.example != null ? p.example : sample(p.schema || { type: 'string' }, p.name);
  }

  /** собирает запрос: {method, url, headers, body, bodyText} */
  function buildRequest(ep, env, vars, over = {}) {
    let path = (over.path || ep.path).replace(/\{([\w.-]+)\}/g, (m, k) => {
      if (over.pathParams && k in over.pathParams) return encodeURIComponent(over.pathParams[k]);
      const p = (ep.params || []).find((x) => x.in === 'path' && x.name === k) || { name: k, schema: { type: 'string' } };
      return encodeURIComponent(pathParamValue(ep, p, vars));
    });
    let url;
    if (ep.rawUrl && !over.path) {
      url = subst(ep.rawUrl, vars).replace(/\/:([\w-]+)/g, (m, k) => {
        if (over.pathParams && k in over.pathParams) return '/' + encodeURIComponent(over.pathParams[k]);
        const p = (ep.params || []).find((x) => x.in === 'path' && x.name === k) || { name: k, schema: { type: 'string' } };
        return '/' + encodeURIComponent(subst(pathParamValue(ep, p, vars), vars));
      });
      if (!/^https?:/.test(url)) url = (env.baseUrl || '').replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
      else if (env.baseUrl && !/^\{\{/.test(ep.rawUrl)) url = url.replace(/^https?:\/\/[^/]+/, env.baseUrl.replace(/\/$/, '').replace(/^(https?:\/\/[^/]+).*$/, '$1'));
    } else url = (env.baseUrl || '').replace(/\/$/, '') + subst(path, vars);
    const u = new URL(url);
    for (const p of (ep.params || []).filter((x) => x.in === 'query')) {
      if (over.query && p.name in over.query) { if (over.query[p.name] !== undefined) u.searchParams.set(p.name, over.query[p.name]); continue; }
      if (ep.rawUrl) continue;
      if (p.required || p.example != null) u.searchParams.set(p.name, subst(p.example != null ? p.example : sample(p.schema || {}, p.name), vars));
    }
    const headers = {};
    (ep.headers || []).forEach((h) => (headers[h.key] = subst(h.value, vars)));
    for (const p of (ep.params || []).filter((x) => x.in === 'header')) if (p.required) headers[p.name] = String(p.example != null ? p.example : sample(p.schema || {}, p.name));
    (env.headers || []).forEach((h) => h.key && (headers[h.key] = subst(h.value, vars)));
    // авторизация
    const a = over.noAuth ? { type: 'none' } : over.badAuth ? { ...env.auth, bad: true } : env.auth || { type: 'none' };
    if (a.type === 'bearer' && a.token) headers.Authorization = 'Bearer ' + (a.bad ? 'invalid.' + rnd() : subst(a.token, vars));
    if (a.type === 'basic' && a.user) headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(`${a.user}:${a.bad ? 'wrong-' + rnd() : a.pass || ''}`)));
    if (a.type === 'apikey' && a.key && a.name) { if (a.where === 'query') u.searchParams.set(a.name, a.bad ? 'invalid-' + rnd() : a.key); else headers[a.name] = a.bad ? 'invalid-' + rnd() : subst(a.key, vars); }
    if (over.noAuth) { delete headers.Authorization; if (env.auth && env.auth.type === 'apikey' && env.auth.name) { delete headers[env.auth.name]; u.searchParams.delete(env.auth.name); } }
    if (over.headers) Object.assign(headers, over.headers);
    let bodyText;
    if (over.rawBody != null) bodyText = over.rawBody;
    else if (over.body !== undefined || ep.body) {
      const b = over.body !== undefined ? over.body : ep.body.example != null ? substDeep(clone(ep.body.example), vars) : ep.body.raw ? subst(ep.body.raw, vars) : sample(ep.body.schema || {});
      const ct = (ep.body && ep.body.contentType) || 'application/json';
      if (b !== undefined && b !== null || over.body === null) {
        if (/form-urlencoded/.test(ct) && b && typeof b === 'object') bodyText = new URLSearchParams(Object.entries(b).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])).toString();
        else bodyText = typeof b === 'string' ? b : JSON.stringify(b);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = /json/.test(ct) ? 'application/json' : ct;
      }
    }
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'accept')) headers.Accept = 'application/json, */*';
    return { method: over.method || ep.method, url: u.toString(), headers, bodyText, cookies: a.type === 'cookie' };
  }

  const SECRET_H = /authorization|cookie|token|api[-_]?key|secret|x-auth/i;
  const maskHeaders = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k, SECRET_H.test(k) ? String(v).slice(0, 10) + '…' : v]));

  async function send(req, env, signal) {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), (env.timeout || 15) * 1000);
    if (signal) signal.addEventListener('abort', () => ctrl.abort());
    try {
      const r = await fetch(req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.bodyText, credentials: req.cookies ? 'include' : 'omit', redirect: 'follow', signal: ctrl.signal, cache: 'no-store' });
      const text = await r.text();
      const ms = Math.round(performance.now() - t0);
      let json;
      try { json = text ? JSON.parse(text) : undefined; } catch (_) {}
      const headers = {};
      r.headers.forEach((v, k) => (headers[k] = v));
      return { status: r.status, ms, headers, text: text.length > 50000 ? text.slice(0, 50000) + '…' : text, json, size: text.length };
    } catch (e) {
      return { status: 0, ms: Math.round(performance.now() - t0), error: e.name === 'AbortError' ? `Нет ответа за ${env.timeout || 15} с` : 'Сетевая ошибка: ' + e.message + ' (сервер недоступен, неверный адрес или сертификат)' };
    } finally { clearTimeout(to); }
  }

  // ================= генерация проверок =================
  const successCodes = (ep) => Object.keys(ep.responses || {}).filter((c) => /^2/.test(c) || c === '2XX');
  const documented = (ep, st) => Object.keys(ep.responses || {}).some((c) => c === String(st) || c === String(st)[0] + 'XX' || c === 'default');
  function wrongTypeValue(s) {
    const t = typeOf(s);
    if (t === 'integer' || t === 'number') return 'не-число';
    if (t === 'boolean') return 'не-булево';
    if (t === 'array') return 'не-массив';
    if (t === 'object') return 'не-объект';
    return 12345;
  }
  /** набор проверок для одного эндпоинта; destructive — нужен тестовый стенд */
  function casesFor(ep, opts = {}) {
    const C = [];
    const add = (c) => C.push({ ep: ep.id, ...c });
    const write = WRITE.includes(ep.method);
    if (ep.method === 'DELETE') add({ kind: 'positive', title: 'Удаление проверяется в цепочке', expect: '2xx', destructive: true, chainOnly: true });
    else add({ kind: 'positive', title: 'Правильный запрос', expect: '2xx', destructive: write });
    const bs = ep.body && ep.body.schema ? allOf(ep.body.schema) : null;
    const base = () => (ep.body ? (ep.body.example != null ? clone(ep.body.example) : sample(ep.body.schema || {})) : undefined);
    if (bs && typeOf(bs) === 'object' && bs.properties) {
      const req = (bs.required || []).filter((r) => bs.properties[r] && !bs.properties[r].readOnly);
      req.slice(0, opts.maxFields || 6).forEach((f) => add({ kind: 'missing', title: `Нет обязательного поля «${f}»`, field: f, expect: '4xx', destructive: write, mutate: (b) => { if (b && typeof b === 'object') delete b[f]; return b; } }));
      Object.entries(bs.properties).filter(([, p]) => !p.readOnly && typeOf(p)).slice(0, opts.maxFields || 6).forEach(([f, p]) => add({ kind: 'type', title: `Неверный тип поля «${f}» (ожидается ${typeOf(p)})`, field: f, expect: '4xx', destructive: write, mutate: (b) => { if (b && typeof b === 'object') b[f] = wrongTypeValue(p); return b; } }));
      req.slice(0, 3).forEach((f) => add({ kind: 'null', title: `null в обязательном поле «${f}»`, field: f, expect: '4xx', destructive: write, mutate: (b) => { if (b && typeof b === 'object' && !(allOf(bs.properties[f]) || {}).nullable) b[f] = null; return b; } }));
      Object.entries(bs.properties).filter(([, p]) => !p.readOnly).forEach(([f, p0]) => {
        const p = allOf(p0) || {};
        if (p.enum) add({ kind: 'enum', title: `Значение не из списка в «${f}»`, field: f, expect: '4xx', destructive: write, mutate: (b) => { b[f] = typeOf(p) === 'string' || !typeOf(p) ? 'нет-такого-значения' : 987654; return b; } });
        else if (typeOf(p) === 'string' && p.maxLength) add({ kind: 'long', title: `Слишком длинное «${f}» (> ${p.maxLength} симв.)`, field: f, expect: '4xx', destructive: write, mutate: (b) => { b[f] = 'x'.repeat(p.maxLength + 1); return b; } });
        else if (typeOf(p) === 'string' && p.format && FMT[p.format]) add({ kind: 'format', title: `Неверный формат «${f}» (${p.format})`, field: f, expect: '4xx', destructive: write, mutate: (b) => { b[f] = 'не-' + p.format; return b; } });
        else if ((typeOf(p) === 'integer' || typeOf(p) === 'number') && p.minimum != null) add({ kind: 'range', title: `«${f}» меньше минимума (${p.minimum})`, field: f, expect: '4xx', destructive: write, mutate: (b) => { b[f] = p.minimum - 1; return b; } });
      });
      if (req.length) add({ kind: 'empty', title: 'Пустое тело {}', expect: '4xx', destructive: write, mutate: () => ({}) });
    }
    if (ep.body && /json/.test(ep.body.contentType || 'json')) add({ kind: 'badjson', title: 'Битый JSON в теле', expect: '4xx', destructive: write, raw: '{"broken": ' });
    const pp = (ep.params || []).filter((p) => p.in === 'path');
    if (pp.length) {
      const last = pp[pp.length - 1];
      const t = typeOf(last.schema || {});
      add({ kind: 'notfound', title: `Несуществующий ${last.name}`, expect: '404', destructive: write && ep.method !== 'GET', pathOver: { [last.name]: t === 'integer' || t === 'number' ? 2147483000 + Math.floor(Math.random() * 600) : (last.schema || {}).format === 'uuid' ? crypto.randomUUID() : 'qa-nonexistent-' + rnd() } });
      if (t === 'integer' || t === 'number' || (last.schema || {}).format === 'uuid') add({ kind: 'badid', title: `${last.name} неверного формата («abc»)`, expect: '4xx', destructive: write && ep.method !== 'GET', pathOver: { [last.name]: 'abc' } });
    }
    (ep.params || []).filter((p) => p.in === 'query' && p.required).slice(0, 3).forEach((p) => add({ kind: 'noquery', title: `Нет обязательного параметра «${p.name}»`, expect: '4xx', destructive: write, queryOver: { [p.name]: undefined } }));
    if (opts.authOn && ep.secured !== false && !(opts.publicOk || []).includes(ep.id)) {
      add({ kind: 'noauth', title: 'Без авторизации', expect: '401/403', destructive: false, noAuth: true });
      if (opts.canBadAuth) add({ kind: 'badauth', title: 'С неверным токеном', expect: '401/403', destructive: false, badAuth: true });
    }
    return C;
  }

  // ================= цепочки: CRUD и порядок запросов =================
  function crudChains(spec) {
    const eps = spec.endpoints;
    const chains = [];
    const byPath = new Map();
    eps.forEach((e) => (byPath.get(e.path) || byPath.set(e.path, []).get(e.path)).push(e));
    for (const [p, list] of byPath) {
      const create = list.find((e) => e.method === 'POST');
      if (!create || /\{[^}]+\}$/.test(p)) continue;
      const itemPath = [...byPath.keys()].find((q) => q.startsWith(p + '/{') && /^\/\{[^}/]+\}$/.test(q.slice(p.length)));
      if (!itemPath) continue;
      const items = byPath.get(itemPath);
      const idName = itemPath.slice(p.length + 2, -1);
      const name = p.split('/').filter(Boolean).pop() || 'resource';
      const v = `${name}_${idName}`;
      const get = items.find((e) => e.method === 'GET'), put = items.find((e) => e.method === 'PUT') || items.find((e) => e.method === 'PATCH'), del = items.find((e) => e.method === 'DELETE');
      const S = [];
      S.push({ ep: create.id, title: 'Создать', expect: '2xx', extract: [{ var: v, path: '$.id' }, { var: v, path: '$.data.id' }, { var: v, header: 'location' }], compareSaved: true });
      if (get) S.push({ ep: get.id, title: 'Получить созданное', expect: '200', pathParams: { [idName]: `{{${v}}}` }, checkSaved: true });
      if (put) S.push({ ep: put.id, title: 'Изменить', expect: '2xx', pathParams: { [idName]: `{{${v}}}` }, setUpdated: true });
      if (put && get) S.push({ ep: get.id, title: 'Получить после изменения', expect: '200', pathParams: { [idName]: `{{${v}}}` }, checkUpdated: true });
      if (del) S.push({ ep: del.id, title: 'Удалить', expect: '2xx', pathParams: { [idName]: `{{${v}}}` } });
      if (del && get) S.push({ ep: get.id, title: 'Получить удалённое', expect: '404', pathParams: { [idName]: `{{${v}}}` }, order: true });
      if (del) S.push({ ep: del.id, title: 'Удалить повторно', expect: '404', pathParams: { [idName]: `{{${v}}}` }, order: true });
      if (del && put) S.push({ ep: put.id, title: 'Изменить удалённое', expect: '404', pathParams: { [idName]: `{{${v}}}` }, order: true });
      chains.push({ id: 'c_' + name + '_' + rnd(), name: `CRUD: ${p}`, auto: true, steps: S });
    }
    return chains;
  }
  function postmanChain(spec) {
    if (spec.kind !== 'postman') return [];
    return [{ id: 'c_pm_' + rnd(), name: 'Коллекция по порядку', auto: true, steps: spec.endpoints.map((e) => ({ ep: e.id, title: e.summary, expect: '2xx', extract: e.extract || [] })) }];
  }

  // ================= прогон =================
  const statusOk = (expect, st) => {
    if (!st) return false;
    if (expect === '2xx') return st >= 200 && st < 300;
    if (expect === '4xx') return st >= 400 && st < 500;
    if (expect === '401/403') return st === 401 || st === 403;
    if (expect === '404') return st === 404 || st === 410;
    return String(st) === String(expect);
  };
  const LEAK = /(Traceback \(most recent|at [\w$.<>]+ \([^)]*:\d+:\d+\)|Exception in|SQLSTATE|ORA-\d{5}|PG::|SequelizeDatabaseError|stack":\s*"|NullPointerException|\.java:\d+\)|Fatal error:|on line \d+)/;
  const SLOW = 1000, VERY_SLOW = 3000;

  /** проверяет ответ и возвращает список проблем */
  function judge(ep, c, req, res) {
    const P = [];
    const prob = (sev, code, text, extra) => P.push({ sev, code, text, ...extra });
    const NEG = ['missing', 'type', 'null', 'enum', 'long', 'format', 'range', 'empty', 'badjson', 'noquery', 'badid', 'notfound'];
    if (!res.status) {
      if (NEG.includes(c.kind) || c.order) prob('major', '5xx-bad', `Сервер оборвал соединение на «${c.title}» — вероятно, упал обработчик`);
      else prob('critical', 'down', res.error || 'Нет ответа');
      return P;
    }
    const st = res.status;
    if (st >= 500) {
      if (c.kind === 'positive' || c.kind === 'chain') prob('critical', '5xx-ok', `Сервер вернул ${st} на правильный запрос`);
      else prob('major', '5xx-bad', `Сервер упал (${st}) на неверных данных: «${c.title}». Ожидался ${c.expect}`);
    } else if (!statusOk(c.expect, st)) {
      if (['missing', 'type', 'null', 'enum', 'long', 'format', 'range', 'empty', 'badjson', 'noquery'].includes(c.kind) && st >= 200 && st < 300) prob('major', 'accepts-bad', `Принял неверные данные (${st}): «${c.title}». Ожидалась ошибка 400/422`);
      else if ((c.kind === 'noauth' || c.kind === 'badauth') && st >= 200 && st < 300) {
        if (ep.secured) prob('critical', 'no-auth', `Отвечает ${st} ${c.kind === 'noauth' ? 'без авторизации' : 'с неверным токеном'} — данные доступны без доступа`);
        else prob('minor', 'maybe-public', `Отвечает ${st} ${c.kind === 'noauth' ? 'без авторизации' : 'с неверным токеном'}, а авторизация в спецификации не описана — публичный ли это эндпоинт?`);
      }
      else if (c.kind === 'notfound' && st >= 200 && st < 300) prob('major', 'notfound-200', `Несуществующий объект — ответ ${st} вместо 404`);
      else if (c.order) prob('major', 'order', `${c.title}: ответ ${st}, ожидался ${c.expect}`);
      else prob(c.kind === 'positive' || c.kind === 'chain' ? 'major' : 'minor', 'status', `Статус ${st}, ожидался ${c.expect}`);
    }
    if (st && !documented(ep, st) && Object.keys(ep.responses || {}).length && !(ep.responses[Object.keys(ep.responses)[0]] || {}).inferred) prob('minor', 'undoc', `Статус ${st} не описан в спецификации`);
    // схема ответа
    const rs = (ep.responses[String(st)] || ep.responses[String(st)[0] + 'XX'] || (st < 300 ? null : ep.responses.default) || {}).schema;
    if (rs && st < 300 && !NEG.includes(c.kind)) {
      if (res.json === undefined && res.text) prob('major', 'not-json', 'Ответ не JSON, хотя по спецификации должен быть', { detail: short(res.text, 200) });
      else if (res.json !== undefined) {
        const errs = validate(rs, res.json);
        if (errs.length) prob((ep.responses[String(st)] || {}).inferred ? 'minor' : 'major', 'schema', `Ответ не соответствует схеме: ${errs.length} расхождений`, { detail: errs.slice(0, 12).map((e) => `${e.path}: ${e.text}`).join('\n') });
      }
    }
    if (st >= 400 && res.text && LEAK.test(res.text)) prob('major', 'leak', 'В ответе об ошибке видны внутренности сервера (стек, SQL, пути файлов)', { detail: short(res.text.match(LEAK)[0], 120) });
    if (st >= 400 && st < 500 && res.text && res.json === undefined && /json/.test(req.headers.Accept || '')) prob('trivial', 'err-format', 'Ошибка возвращается не в JSON — клиенту сложно показать понятное сообщение', { detail: short(res.text, 120) });
    if (res.ms > VERY_SLOW) prob('major', 'slow', `Очень медленный ответ: ${res.ms} мс`);
    else if (res.ms > SLOW && (c.kind === 'positive' || c.kind === 'chain')) prob('minor', 'slow', `Медленный ответ: ${res.ms} мс`);
    if (res.text && !res.headers['content-type']) prob('trivial', 'no-ct', 'В ответе нет заголовка Content-Type');
    return P;
  }

  const sevRank = { critical: 4, major: 3, minor: 2, trivial: 1 };
  function caseVerdict(P) { return !P.length ? 'pass' : P.some((p) => sevRank[p.sev] >= 3) ? 'fail' : 'warn'; }

  /** запуск: возвращает объект прогона; onProgress(run) вызывается по ходу */
  async function run(project, opts = {}, onProgress = () => {}) {
    const spec = project.spec;
    const env = project.env;
    const vars = { ...(spec.vars || {}), ...Object.fromEntries((env.vars || []).filter((v) => v.key).map((v) => [v.key, v.value])) };
    if (spec.baseVar && env.baseUrl) vars[spec.baseVar] = env.baseUrl.replace(/\/$/, '');
    const writes = !!env.testStand;
    const authOn = env.auth && env.auth.type && env.auth.type !== 'none';
    const R = { id: 'a' + Date.now().toString(36), ts: Date.now(), status: 'running', results: [], chains: [], skipped: 0, total: 0, done: 0, writes };
    const sel = new Set(opts.endpoints || spec.endpoints.map((e) => e.id));
    const eps = spec.endpoints.filter((e) => sel.has(e.id));
    const plan = [];
    for (const ep of eps) for (const c of casesFor(ep, { authOn, canBadAuth: env.auth && ['bearer', 'basic', 'apikey'].includes(env.auth.type) })) plan.push({ ep, c });
    const chains = (opts.chains !== false ? project.chains || [] : []).filter((ch) => ch.on !== false);
    R.total = plan.length + chains.reduce((s, ch) => s + ch.steps.length, 0);
    onProgress(R);
    const delay = Math.max(0, +env.delay || 0);
    // настоящие id: берём первый элемент из списочных GET (/users → users_id), чтобы проверки по /users/{id} работали
    R.discovered = {};
    if (spec.kind === 'openapi') {
      for (const ep of spec.endpoints.filter((e) => e.method === 'GET' && !/\{/.test(e.path))) {
        const itemPath = spec.endpoints.map((e) => e.path).find((q) => q.startsWith(ep.path + '/{') && /^\/\{[^}/]+\}$/.test(q.slice(ep.path.length)));
        if (!itemPath) continue;
        const idName = itemPath.slice(ep.path.length + 2, -1);
        const name = ep.path.split('/').filter(Boolean).pop();
        const res = await send(buildRequest(ep, env, vars), env, opts.signal);
        const j = res.json;
        const arr = Array.isArray(j) ? j : j && ['data', 'items', 'results', 'content', 'list', 'rows', name].map((k) => j[k]).find(Array.isArray);
        const first = arr && arr[0];
        const id = first && typeof first === 'object' ? first[idName] ?? first.id ?? first.uuid ?? first._id : null;
        if (id != null) { vars[`${name}_${idName}`] = id; R.discovered[`${ep.path}/{${idName}}`] = id; }
      }
    }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const doCase = async ({ ep, c }) => {
      if (opts.signal && opts.signal.aborted) return;
      if (c.chainOnly) { R.done++; R.results.push({ ep: ep.id, case: c.title, kind: c.kind, verdict: 'skip', reason: 'удаление существующих данных не выполняется — его проверяет цепочка на созданном ею объекте' }); return; }
      if (c.destructive && !writes) { R.skipped++; R.done++; R.results.push({ ep: ep.id, case: c.title, kind: c.kind, verdict: 'skip', reason: 'изменяющий запрос — включите «тестовый стенд»' }); return; }
      const over = { noAuth: c.noAuth, badAuth: c.badAuth, pathParams: c.pathOver, query: c.queryOver };
      if (c.mutate) { const b = ep.body ? (ep.body.example != null ? substDeep(clone(ep.body.example), vars) : sample(ep.body.schema || {})) : {}; over.body = c.mutate(b); }
      if (c.raw) over.rawBody = c.raw;
      let req;
      try { req = buildRequest(ep, env, vars, over); } catch (e) { R.done++; R.results.push({ ep: ep.id, case: c.title, kind: c.kind, verdict: 'fail', problems: [{ sev: 'major', code: 'build', text: 'Не удалось собрать запрос: ' + e.message }] }); return; }
      const res = await send(req, env, opts.signal);
      const P = judge(ep, c, req, res);
      R.done++;
      R.results.push({ ep: ep.id, case: c.title, kind: c.kind, expect: c.expect, verdict: caseVerdict(P), problems: P, req: { method: req.method, url: req.url, headers: maskHeaders(req.headers), body: short(req.bodyText, 4000) }, res: { status: res.status, ms: res.ms, headers: res.headers, body: short(res.text || res.error || '', 6000) } });
      onProgress(R);
      if (delay) await wait(delay);
    };
    // независимые проверки — по 3 параллельно (GET), изменяющие — по одной
    const reads = plan.filter((x) => !x.c.destructive), writesP = plan.filter((x) => x.c.destructive);
    for (let i = 0; i < reads.length; i += delay ? 1 : 3) { if (opts.signal && opts.signal.aborted) break; await Promise.all(reads.slice(i, i + (delay ? 1 : 3)).map(doCase)); }
    for (const x of writesP) { if (opts.signal && opts.signal.aborted) break; await doCase(x); }
    // цепочки
    for (const ch of chains) {
      if (opts.signal && opts.signal.aborted) break;
      const cr = { id: ch.id, name: ch.name, steps: [], verdict: 'pass' };
      R.chains.push(cr);
      const cv = { ...vars };
      let saved = null, updated = null, broken = false;
      for (const st of ch.steps) {
        const ep = spec.endpoints.find((e) => e.id === st.ep);
        if (!ep) { cr.steps.push({ title: st.title, verdict: 'skip', reason: 'эндпоинт не найден' }); R.done++; continue; }
        if (WRITE.includes(ep.method) && !writes) { cr.steps.push({ title: st.title, ep: ep.id, verdict: 'skip', reason: 'изменяющий запрос — включите «тестовый стенд»' }); R.skipped++; R.done++; broken = true; continue; }
        if (broken && st.order) { cr.steps.push({ title: st.title, ep: ep.id, verdict: 'skip', reason: 'предыдущий шаг не выполнен' }); R.done++; continue; }
        const pp = st.pathParams ? Object.fromEntries(Object.entries(st.pathParams).map(([k, v]) => [k, subst(v, cv)])) : undefined;
        if (pp && Object.values(pp).some((v) => /\{\{/.test(v))) { cr.steps.push({ title: st.title, ep: ep.id, verdict: 'skip', reason: 'нет id из предыдущего шага' }); R.done++; broken = true; continue; }
        let body;
        if (ep.body && WRITE.includes(ep.method)) {
          body = st.body != null ? substDeep(clone(st.body), cv) : ep.body.example != null ? substDeep(clone(ep.body.example), cv) : sample(ep.body.schema || {});
          if (st.setUpdated && body && typeof body === 'object') {
            // при изменении отправляем другие значения, чтобы было видно, что они сохранились
            const sch = allOf(ep.body.schema || {}) || {};
            for (const [k, v] of Object.entries(body)) {
              const ps = (sch.properties || {})[k] || {};
              if (typeof v === 'number') { let n = v + 1; if (ps.maximum != null && n > ps.maximum) n = v - 1; body[k] = n; }
              else if (typeof v === 'boolean') body[k] = !v;
              else if (typeof v === 'string' && !ps.enum && !ps.format && !/pass/i.test(k)) body[k] = (ps.maxLength && v.length + 4 > ps.maxLength ? v.slice(0, ps.maxLength - 4) : v) + ' upd';
            }
            updated = body;
          }
          if (st.compareSaved) saved = body;
        }
        const req = buildRequest(ep, env, cv, { pathParams: pp, body });
        const res = await send(req, env, opts.signal);
        const c = { kind: st.order ? 'order' : 'chain', title: st.title, expect: st.expect || '2xx', order: st.order };
        const P = judge(ep, c, req, res);
        // извлечение переменных
        const got = new Set();
        for (const ex of st.extract || []) {
          if (got.has(ex.var)) continue;
          let v;
          if (ex.header) { const h = res.headers[ex.header]; if (h) v = h.split('/').filter(Boolean).pop(); }
          else v = getPath(res.json, ex.path);
          if (v != null && typeof v !== 'object') { cv[ex.var] = v; got.add(ex.var); }
        }
        if (st.compareSaved && res.status < 300 && st.extract && st.extract.length && !got.size) P.push({ sev: 'major', code: 'no-id', text: 'В ответе на создание нет id — нельзя получить созданный объект', detail: short(res.text, 200) });
        const cmp = (exp, label) => {
          if (!exp || !res.json || typeof exp !== 'object') return;
          const got = res.json.data && typeof res.json.data === 'object' ? res.json.data : res.json;
          const diff = Object.entries(exp).filter(([k, v]) => typeof v !== 'object' && k in got && String(got[k]) !== String(v) && !/pass/i.test(k)).slice(0, 8);
          if (diff.length) P.push({ sev: 'major', code: 'mismatch', text: `${label}: сохранились не те данные`, detail: diff.map(([k, v]) => `${k}: отправили «${v}», получили «${got[k]}»`).join('\n') });
        };
        if (st.checkSaved) cmp(saved, 'После создания');
        if (st.checkUpdated) cmp(updated, 'После изменения');
        const verdict = caseVerdict(P);
        if (verdict === 'fail') cr.verdict = 'fail'; else if (verdict === 'warn' && cr.verdict === 'pass') cr.verdict = 'warn';
        if (!st.order && res.status >= 400) broken = true;
        cr.steps.push({ title: st.title, ep: ep.id, verdict, problems: P, req: { method: req.method, url: req.url, headers: maskHeaders(req.headers), body: short(req.bodyText, 4000) }, res: { status: res.status, ms: res.ms, headers: res.headers, body: short(res.text || res.error || '', 6000) } });
        R.done++;
        onProgress(R);
        if (delay) await wait(delay);
      }
    }
    R.status = opts.signal && opts.signal.aborted ? 'stopped' : 'done';
    R.end = Date.now();
    onProgress(R);
    return R;
  }

  // ================= «что не так с API» =================
  const ISSUE = {
    'down': ['critical', 'Эндпоинт недоступен', 'Запрос не дошёл до сервера или не получил ответа.', 'Проверьте базовый адрес, доступность стенда, сертификат HTTPS и таймауты.'],
    '5xx-ok': ['critical', 'Ошибка сервера на правильном запросе', 'Корректный запрос по спецификации приводит к 500 — функция не работает.', 'Посмотрите логи сервера по времени запроса; проверьте, что пример из спецификации актуален.'],
    '5xx-bad': ['major', 'Сервер падает на неверных данных', 'Вместо понятной ошибки 400/422 сервер отвечает 500: нет проверки входных данных, клиент не узнает, что исправить, а в логах — лишние аварии.', 'Валидировать тело и параметры до бизнес-логики (схема, DTO, class-validator, pydantic, Joi), возвращать 400/422 с описанием поля.'],
    'accepts-bad': ['major', 'Принимает неверные данные', 'Сервер сохраняет или обрабатывает запрос без обязательных полей или с неверными типами — в базу попадают битые данные.', 'Проверять обязательные поля, типы, форматы и допустимые значения по схеме; отвечать 400/422.'],
    'no-auth': ['critical', 'Доступ без авторизации', 'Эндпоинт отдаёт или меняет данные без токена или с неверным токеном — уязвимость.', 'Проверить middleware авторизации на этом маршруте; если эндпоинт должен быть публичным — убрать security в спецификации.'],
    'notfound-200': ['major', 'Нет 404 для несуществующего объекта', 'По несуществующему id сервер отвечает успехом (часто пустым объектом) — клиент не может отличить «нет данных» от ошибки.', 'Возвращать 404, если объект не найден.'],
    'order': ['major', 'Неверная реакция на порядок запросов', 'Запрос к удалённому объекту, повторное удаление или изменение после удаления обрабатываются некорректно.', 'После удаления — 404 (или 410) на получение, изменение и повторное удаление; не 200 и не 500.'],
    'maybe-public': ['minor', 'Работает без авторизации (в спецификации не описано)', 'Эндпоинт отвечает без токена, а в Swagger не указано, нужна ли авторизация. Если данные не публичные — это уязвимость.', 'Если доступ должен быть закрыт — включить проверку токена; если открыт — указать security: [] в спецификации.'],
    'status': ['minor', 'Неожиданный статус ответа', 'Код ответа отличается от ожидаемого по спецификации.', 'Сверить реализацию и спецификацию, поправить одно из двух.'],
    'undoc': ['minor', 'Статусы не описаны в спецификации', 'Сервер возвращает коды, которых нет в Swagger — фронтенд и интеграторы не знают, как их обрабатывать.', 'Описать все возможные ответы (400, 401, 404, 422…) в спецификации.'],
    'schema': ['major', 'Ответ не соответствует схеме', 'Типы, обязательные поля или форматы в ответе отличаются от Swagger — клиенты, сгенерированные по спецификации, сломаются.', 'Исправить сериализацию ответа или обновить спецификацию.'],
    'not-json': ['major', 'Ответ не JSON', 'По спецификации ожидается JSON, а приходит текст или HTML (часто страница ошибки прокси).', 'Проверить маршрут и обработчик ошибок.'],
    'leak': ['major', 'Утечка внутренних деталей в ошибках', 'Стек вызовов, SQL или пути файлов в ответе помогают атакующему.', 'Отдавать клиенту короткое сообщение и код ошибки, подробности — только в логи.'],
    'err-format': ['trivial', 'Ошибки не в JSON', 'Клиенту сложно показать понятное сообщение пользователю.', 'Единый формат ошибок, например { "error": { "code", "message", "fields" } } или RFC 9457 (problem+json).'],
    'slow': ['minor', 'Медленные ответы', 'Ответ дольше 1 секунды заметен пользователю; больше 3 секунд — воспринимается как зависание.', 'Индексы в БД, пагинация, кэш, отсутствие N+1 запросов к базе.'],
    'no-ct': ['trivial', 'Нет Content-Type', 'Без заголовка клиент может неправильно разобрать ответ.', 'Всегда указывать Content-Type.'],
    'no-id': ['major', 'Создание не возвращает id', 'После создания нельзя получить или изменить объект.', 'Возвращать созданный объект с id (или заголовок Location).'],
    'mismatch': ['major', 'Сохраняются не те данные', 'Значения после сохранения отличаются от отправленных.', 'Проверить маппинг полей при сохранении и чтении.'],
    'build': ['minor', 'Не удалось собрать запрос', 'В спецификации не хватает данных для запроса.', 'Добавить примеры (example) в спецификацию.'],
  };
  function issues(R, spec) {
    const map = new Map();
    const push = (p, ep, where) => {
      const meta = ISSUE[p.code] || ['minor', p.text, '', ''];
      const g0 = map.get(p.code) || { code: p.code, sev: meta[0], title: meta[1], why: meta[2], fix: meta[3], items: [] };
      if (sevRank[p.sev] > sevRank[g0.sev]) g0.sev = p.sev;
      g0.items.push({ ep, where, text: p.text, detail: p.detail });
      map.set(p.code, g0);
    };
    const seen = new Set();
    const once = (p, ep) => { if (p.code !== 'undoc' && p.code !== 'slow') return true; const k = p.code + ep + p.text; if (seen.has(k)) return false; seen.add(k); return true; };
    R.results.forEach((r) => (r.problems || []).forEach((p) => once(p, r.ep) && push(p, r.ep, r.case)));
    R.chains.forEach((ch) => ch.steps.forEach((s) => (s.problems || []).forEach((p) => once(p, s.ep) && push(p, s.ep, `${ch.name} → ${s.title}`))));
    return [...map.values()].sort((a, b) => sevRank[b.sev] - sevRank[a.sev] || b.items.length - a.items.length);
  }
  function stats(R) {
    const all = R.results.concat(R.chains.flatMap((c) => c.steps));
    const n = (v) => all.filter((x) => x.verdict === v).length;
    return { pass: n('pass'), warn: n('warn'), fail: n('fail'), skip: n('skip'), total: all.length };
  }

  g.QAApi = { importSpec, casesFor, crudChains, postmanChain, run, issues, stats, buildRequest, sample, validate, WRITE, ISSUE, sevRank, maskHeaders };
})(globalThis);
