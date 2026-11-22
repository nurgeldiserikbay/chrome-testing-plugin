const $ = (id) => document.getElementById(id);
const L = globalThis.QAI18N;
$('lang').innerHTML = [['auto', 'Как в браузере / Browser']].concat(Object.entries(L.LANGS)).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
chrome.storage.local.get(['qa_lang', 'qa_consent']).then((o) => {
  $('lang').value = o.qa_lang || 'auto';
  if (o.qa_consent && o.qa_consent.v >= 2) { $('ok').style.display = 'block'; $('agree').textContent = '✓'; $('agree').disabled = true; }
});
$('lang').onchange = async () => { await chrome.storage.local.set({ qa_lang: $('lang').value }); location.reload(); };
$('agree').onclick = async () => {
  await chrome.storage.local.set({ qa_consent: { ts: Date.now(), v: 2 } });
  $('ok').style.display = 'block';
  $('agree').disabled = true;
};
$('copy').onclick = async () => {
  await navigator.clipboard.writeText($('card').textContent.replace(/\s/g, ''));
  $('cst').textContent = '✓ Скопировано';
  $('cst').className = 'st ok';
};

// политика конфиденциальности на языке интерфейса
(async () => {
  await (L.ready || Promise.resolve());
  const l = L.lang ? (typeof L.lang === 'function' ? L.lang() : L.lang) : 'ru';
  if (l && l !== 'ru' && L.LANGS[l]) $('pp').href = `https://nurgeldiserikbay.github.io/chrome-testing-plugin/${l}/privacy.html`;
})();
