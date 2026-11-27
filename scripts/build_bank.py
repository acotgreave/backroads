#!/usr/bin/env python3
"""
Build the Backroads answer bank from Wikidata + Wikipedia page views.

  python3 scripts/build_bank.py            # live (needs query.wikidata.org, en.wikipedia.org, wikimedia.org)
  python3 scripts/build_bank.py --mock     # offline dry run with fake page views
  python3 scripts/build_bank.py --only states,parks

Input : data/curated.json  (from scripts/extract_curated.js: prompt wording, hand answers, aliases, traps)
Output: data/bank.js       (const BANK=[...]; const BANK_META={...})
        data/report.csv    (every answer: Wikipedia title, views, share above, miles, source)

Rarity is Krillion's "more popular answers" idea: for each answer, add up the page-view share of
every answer in the same prompt that is MORE viewed. The more attention sits above you, the rarer you are.
Python 3 standard library only.
"""
import csv, datetime, hashlib, json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
CACHE = os.path.join(ROOT, '.cache')
UA = 'BackroadsQuiz/1.0 (https://backroads.howtospeakdata.com; trivia game build, weekly)'
MOCK = '--mock' in sys.argv
ONLY = next((a.split('=', 1)[1] if '=' in a else sys.argv[sys.argv.index(a) + 1] for a in sys.argv if a.startswith('--only')), None)
ONLY = set(ONLY.split(',')) if ONLY else None
os.makedirs(CACHE, exist_ok=True)
FAILED = []   # page-view lookups that failed after retries

MILES = [10, 25, 40, 60, 80, 100]
TIER_CUTS = [0.25, 0.50, 0.70, 0.85, 0.95]          # share of views held by MORE popular answers
END = datetime.date.today().replace(day=1) - datetime.timedelta(days=1)
START = (END.replace(year=END.year - 2) + datetime.timedelta(days=1)).replace(day=1)   # 24 full months

# Prompts whose answer lists come from Wikidata. body binds ?item.
#   min: fewer results than this means the query is wrong -> fall back to the hand list
#   cap: keep only the N most-viewed (plus every hand-picked answer) to trim long tails
WD = {
 'states':   dict(body='?item wdt:P31 wd:Q35657.', min=45),   # live: 49 found; missing hand answers are merged back in
 'capitals': dict(body='?s wdt:P31 wd:Q35657; wdt:P36 ?item.', min=45),
 'parks':    dict(body='?item wdt:P31 wd:Q34918903.', min=55),
 'presidents': dict(body='?item wdt:P39 wd:Q11696.', min=44),
 'signers':  dict(body='wd:Q127912 wdt:P1891 ?item.', min=50),
 'nfl':      dict(body='?item wdt:P118 wd:Q1215884; wdt:P31/wdt:P279* wd:Q12973014. FILTER NOT EXISTS{?item wdt:P576 []}', min=30, cap=40),
 'mlb':      dict(body='?item wdt:P118 wd:Q1163715; wdt:P31/wdt:P279* wd:Q12973014. FILTER NOT EXISTS{?item wdt:P576 []}', min=28, cap=36),
 'nba':      dict(body='?item wdt:P118 wd:Q155223; wdt:P31/wdt:P279* wd:Q12973014. FILTER NOT EXISTS{?item wdt:P576 []}', min=28, cap=36),
 'rivers':   dict(body='?item wdt:P31 wd:Q4022; wdt:P17 wd:Q30; wdt:P2043 ?len. FILTER(?len > 400)', min=40, cap=90),
 'simpsons': dict(body='?item wdt:P1441 wd:Q886. FILTER NOT EXISTS{?item wdt:P31 wd:Q5}', min=30, cap=90),
 'friends':  dict(body='?item wdt:P1441 wd:Q79784. FILTER NOT EXISTS{?item wdt:P31 wd:Q5}', min=10, cap=60),
 'sesame':   dict(body='?item wdt:P1441 wd:Q155629. FILTER NOT EXISTS{?item wdt:P31 wd:Q5}', min=15, cap=60),
 'dogs':     dict(body='?item wdt:P31 wd:Q39367; wdt:P495 wd:Q30.', min=15, cap=50),
 'cars':     dict(body='?item wdt:P31/wdt:P279* wd:Q786820; wdt:P17 wd:Q30.', min=20, cap=60),
 'airlines': dict(body='?item wdt:P31 wd:Q46970; wdt:P17 wd:Q30.', min=20, cap=60),
}
# answer sets that are a subset of another prompt reuse its page views
SUBSET_OF = {'mstates': 'states', 'twoword': 'states', 'atlantic': 'states', 'canada': 'states'}
# page views say nothing about how often people SAY these: keep hand tiers
HAND_TIERS = {'amwords'}
# hand answers whose bare name lands on the wrong Wikipedia page
TITLES = {
 'Life':'Life (cereal)','Total':'Total (cereal)','Trix':'Trix (cereal)','Kix':'Kix (cereal)','Honeycomb':'Honeycomb (cereal)',
 'Heath':'Heath bar','Nerds':'Nerds (candy)','Mounds':'Mounds (candy bar)','PayDay':'PayDay (candy bar)','Whoppers':'Whoppers (candy)',
 'Starburst':'Starburst (confectionery)','Airheads':'Airheads (candy)','Milky Way':'Milky Way (chocolate bar)','Mary Jane':'Mary Jane (candy)',
 'Sugar Daddy':'Sugar Daddy (candy)','100 Grand':'100 Grand Bar',
 'Sonic':'Sonic Drive-In','Subway':'Subway (restaurant)','Checkers':'Checkers and Rally\'s','Krystal':'Krystal (restaurant)','Cook Out':'Cook Out (restaurant)',
 'A&W':'A&W Restaurants','Freddy\'s':'Freddy\'s Frozen Custard & Steakburgers','Panera':'Panera Bread',
 'Tab':'Tab (drink)','Surge':'Surge (drink)','Crush':'Crush (soft drink)','Mug':'Mug Root Beer','Squirt':'Squirt (soda)','Big Red':'Big Red (soda)',
 'IBC':'IBC Root Beer','Dad\'s':'Dad\'s Root Beer','Shasta':'Shasta (soft drink)','Root beer':'Root beer',
 'Miller':'Miller Brewing Company','Coors':'Coors Brewing Company','Busch':'Busch Beer','Olympia':'Olympia Brewing Company',
 'Bell\'s':'Bell\'s Brewery','Founders':'Founders Brewing Company','Keystone':'Keystone (beer)','Genesee':'Genesee Brewing Company',
 'Target':'Target Corporation','Ross':'Ross Stores','Hudson\'s':'Hudson\'s (department store)','Ames':'Ames (department store)',
 'Corn':'Maize','Dinner rolls':'Bread roll','Turkey':'Turkey as food','Gravy':'Gravy','Stuffing':'Stuffing',
 'Halloween':'Halloween','Christmas':'Christmas','Columbus Day':'Columbus Day',
}

# ---------------------------------------------------------------- http + cache
def get_json(url, key=None, tries=6):
    path = os.path.join(CACHE, (key or hashlib.sha1(url.encode()).hexdigest()) + '.json')
    if os.path.exists(path):
        with open(path) as f: return json.load(f)
    for t in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=90) as r: data = json.load(r)
            with open(path, 'w') as f: json.dump(data, f)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            wait = e.headers.get('Retry-After', '') if e.headers else ''
            time.sleep(int(wait) if wait.isdigit() else 2 ** t + (5 if e.code == 429 else 0))
        except Exception:
            time.sleep(2 ** t)
    raise RuntimeError('failed after retries: ' + url[:120])

def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').replace('&', ' and ')
    s = re.sub(r"['’`.]", '', s); s = re.sub(r'[^a-z0-9 ]', ' ', s)
    s = re.sub(r'\b(the|jr|sr)\b', ' ', s); s = re.sub(r'\bst\b', 'saint', s); s = re.sub(r'\bmt\b', 'mount', s)
    return re.sub(r'\s+', ' ', s).strip()

def strip_words(s, words):
    s = norm(s)
    for w in words: s = re.sub(r'\b' + re.escape(norm(w)) + r'\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def clean(label): return re.sub(r'\s*\(.*?\)\s*', ' ', label).strip()

def good_alias(a, name):
    a = clean(a)
    return 2 < len(a) <= 40 and not re.search(r'\d{4}', a) and norm(a) != norm(name)

def sparql(body):
    q = f'''SELECT ?item ?itemLabel ?article (GROUP_CONCAT(DISTINCT ?alt;separator="|") AS ?alts) WHERE {{
      {body}
      OPTIONAL {{ ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }}
      OPTIONAL {{ ?item skos:altLabel ?alt FILTER(LANG(?alt)="en") }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }} GROUP BY ?item ?itemLabel ?article'''
    data = get_json('https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(q))
    seen, out = set(), []
    for b in data['results']['bindings']:
        label, qid = b['itemLabel']['value'], b['item']['value'].rsplit('/', 1)[1]
        if re.fullmatch(r'Q\d+', label) or qid in seen: continue
        seen.add(qid)
        art = b.get('article', {}).get('value')
        title = urllib.parse.unquote(art.rsplit('/', 1)[1]).replace('_', ' ') if art else None
        alts = [a for a in b.get('alts', {}).get('value', '').split('|') if a]
        out.append(dict(name=clean(label), title=title, aliases=alts, qid=qid))
    return out

def resolve_titles(titles):
    """Follow redirects; flag disambiguation and missing pages."""
    res, titles = {}, list(dict.fromkeys(t for t in titles if t))
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        d = get_json('https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=disambiguation&titles='
                     + urllib.parse.quote('|'.join(chunk))) or {}
        q = d.get('query', {})
        hop = {n['from']: n['to'] for n in q.get('normalized', [])}
        red = {r['from']: r['to'] for r in q.get('redirects', [])}
        pages = {p['title']: p for p in q.get('pages', {}).values()}
        for t in chunk:
            v = hop.get(t, t); v = red.get(v, v)
            p = pages.get(v, {})
            res[t] = (None, 'missing') if 'missing' in p else (None, 'disambiguation') if 'disambiguation' in p.get('pageprops', {}) else (v, 'ok')
    return res

def views(title):
    if MOCK:
        h = int(hashlib.md5(title.encode()).hexdigest()[:8], 16)
        return int(1e7 / (1 + (h % 997)) ** 1.3)
    t = urllib.parse.quote(title.replace(' ', '_'), safe='')
    url = (f'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{t}/monthly/'
           f'{START:%Y%m%d}00/{END:%Y%m%d}00')
    try:
        d = get_json(url, key='pv_' + hashlib.sha1(url.encode()).hexdigest())
    except RuntimeError:
        FAILED.append(title); return 0   # one stubborn page shouldn't sink the whole build
    months = sorted(x['views'] for x in (d or {}).get('items', []))
    return months[len(months) // 2] * 24 if months else 0   # median month: one viral month can't make an answer common

def tierize(items):
    have = sorted([it for it in items if it.get('views')], key=lambda it: -it['views'])
    total = sum(it['views'] for it in have) or 1
    above = 0.0
    for it in have:
        it['above'], it['tier'] = above, next((k for k, c in enumerate(TIER_CUTS) if above < c), 5)
        above += it['views'] / total

# ---------------------------------------------------------------- build
def main():
    curated = json.load(open(os.path.join(DATA, 'curated.json')))
    out, report, parent, title_cache, notes = [], [], {}, {}, {}
    # parents first so subset prompts can reuse their views
    curated.sort(key=lambda p: p['id'] in SUBSET_OF)
    for p in curated:
        pid = p['id']
        if ONLY and pid not in ONLY and pid not in {SUBSET_OF.get(o) for o in ONLY}: continue
        hand = [dict(name=i['name'], aliases=list(i['aliases']), hand=k, title=TITLES.get(i['name'], i['name']), src='hand')
                for k, i in enumerate(p['items'])]
        n_hand, items, note = len(hand), hand, 'hand list'

        if pid in WD and not MOCK:
            try:
                wd = sparql(WD[pid]['body'])
                if len(wd) >= WD[pid]['min']:
                    items = []
                    for w in wd:
                        if not w['title']: continue
                        al = [a for a in w['aliases'] if good_alias(a, w['name'])]
                        short = strip_words(w['name'], p['strip'])
                        if short and short != norm(w['name']): al.append(short)
                        items.append(dict(name=w['name'], aliases=al, title=w['title'], src='wikidata', qid=w['qid']))
                    idx = {}
                    for it in items:
                        for a in [it['name']] + it['aliases']: idx.setdefault(norm(a), it)
                    for h in hand:   # merge hand answers: keep their nicer names, aliases and rank
                        keys = [norm(h['name'])] + [norm(a) for a in h['aliases']]
                        hit = next((idx[k] for k in keys if k in idx), None)
                        if hit:
                            hit['aliases'] = list(dict.fromkeys(hit['aliases'] + [hit['name']] + h['aliases']))
                            hit['name'], hit['hand'] = h['name'], h['hand']
                        else:
                            items.append(h)   # Wikidata missed it: keep it
                    note = f'wikidata ({len(wd)} found)'
                else:
                    note = f'wikidata gave {len(wd)} (< {WD[pid]["min"]}): hand list'
            except Exception as e:
                note = f'wikidata failed ({e}): hand list'

        if pid in SUBSET_OF and SUBSET_OF[pid] in parent:
            pv = parent[SUBSET_OF[pid]]
            for it in items:
                it['title'], it['views'] = pv.get(norm(it['name']), (None, 0)); it['why'] = 'ok' if it['title'] else 'not in parent'
            note = f'hand list, views from {SUBSET_OF[pid]}'
        elif pid in HAND_TIERS:
            for it in items: it['views'], it['why'] = None, 'hand tiers'
        else:
            need = [it['title'] for it in items if it['src'] == 'hand' and it['title'] not in title_cache]
            if need and not MOCK: title_cache.update(resolve_titles(need))
            for it in items:
                if it['src'] == 'hand':
                    it['title'], it['why'] = (it['title'], 'ok') if MOCK else title_cache.get(it['title'], (None, 'unresolved'))
                else: it['why'] = 'ok'
            with ThreadPoolExecutor(4) as ex:
                vs = list(ex.map(lambda it: views(it['title']) if it.get('title') else 0, items))
            for it, v in zip(items, vs): it['views'] = v

        cap = WD.get(pid, {}).get('cap')
        if cap and len(items) > cap:
            items.sort(key=lambda it: -(it['views'] or 0))
            items = [it for k, it in enumerate(items) if k < cap or 'hand' in it]

        # if page views mostly failed for this prompt, don't trust them
        with_views = sum(1 for it in items if it.get('views'))
        if pid not in HAND_TIERS and with_views < 0.6 * len(items):
            note += f'; only {with_views}/{len(items)} have views: hand tiers'
            for it in items: it['views'] = None
        parent[pid] = {norm(a): (it.get('title'), it.get('views') or 0) for it in items for a in [it['name']] + it['aliases']}
        tierize(items)
        cuts = [.12, .28, .48, .68, .86, 1.01]
        for it in items:   # no views -> hand rank decides (unranked extras count as rare)
            if 'tier' in it: it['tier_src'] = 'views'
            else:
                h = it.get('hand', n_hand - 1)
                it['tier'], it['tier_src'] = next(k for k, c in enumerate(cuts) if h / n_hand < c), 'hand'
        items.sort(key=lambda it: (it['tier'], -(it.get('views') or 0)))

        out.append(dict(id=pid, bank=[[it['name'], [a for a in it['aliases'] if a][:10], it['tier']] for it in items]))
        for it in items:
            report.append([pid, it['name'], it.get('title') or '', it.get('why', ''), it['views'] if it.get('views') is not None else '',
                           f"{it['above']:.3f}" if 'above' in it else '', MILES[it['tier']], it['tier_src'], it['src']])
        notes[pid] = note
        print(f'{pid:12s} {len(items):4d} answers · {note}', flush=True)

    if not out: sys.exit('nothing built')
    meta = dict(built=datetime.date.today().isoformat(), window=f'{START:%b %Y}–{END:%b %Y}', mock=MOCK, notes=notes)
    with open(os.path.join(DATA, 'bank.js'), 'w') as f:
        f.write('const BANK=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
                'const BANK_META=' + json.dumps(meta, ensure_ascii=False) + ';\n')
    with open(os.path.join(DATA, 'report.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['prompt', 'answer', 'wikipedia_title', 'title_status', 'views_24m', 'share_above', 'miles', 'tier_source', 'source'])
        w.writerows(sorted(report, key=lambda r: (r[0], r[6])))
    print(f'\nwrote data/bank.js and data/report.csv · {len(report)} answers')
    if FAILED: print(f'page views failed for {len(FAILED)} titles (scored as no views): ' + ', '.join(FAILED[:30]))

if __name__ == '__main__':
    main()
