import re, json, glob, os
SRC='/home/claude/chrome-testing-plugin/extension'
files=[f for f in glob.glob(SRC+'/*.js')+glob.glob(SRC+'/*.html') if not f.endswith(('i18n.js','i18n-dict.js'))]
RUN=re.compile(r"[А-Яа-яЁё][А-Яа-яЁё\s ,.:;!?«»()\-–—/%№’]*")
SEP=re.compile(r"\s*[:—·«»\n]\s*|\.\s+|\s+–\s+|\(\s*|\s*\)|;\s*|!\s+|\?\s+")
EDGE='  ,.:;!?«»()-–—/%№’\n\t'
def strip_comments(t, html):
    if html: return re.sub(r'<!--.*?-->', '', t, flags=re.S)
    t=re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    t=re.sub(r'(^|\s)//\s[^\n]*', r'\1', t)
    t=re.sub(r'^\s*//[^\n]*', '', t, flags=re.M)
    return t
pieces={}
for f in files:
    t=open(f,encoding='utf8').read()
    t=strip_comments(t, f.endswith('.html'))
    for m in RUN.finditer(t):
        run=re.sub(r'\s+',' ',m.group(0))
        for p in SEP.split(run):
            p=p.strip(EDGE)
            if p and re.search('[А-Яа-яЁё]',p):
                pieces.setdefault(p, set()).add(os.path.basename(f))
keys=sorted(pieces, key=lambda k:(min(pieces[k]),k))
json.dump({k:sorted(v) for k,v in pieces.items()}, open('pieces.json','w'), ensure_ascii=False, indent=0)
print(len(keys), sum(len(k) for k in keys))
