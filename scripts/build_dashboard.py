#!/usr/bin/env python3
"""Build the engine dashboard: dist/dash/index.html (served at /dash/).

Reads what the build already makes, so it is always in step with the live game:
  data/report.csv     every answer, its page views and miles      -> tier mix per prompt
  data/checks.json    answer tests from content/answer_tests.yaml -> tests and warnings per prompt
  data/schedule.json  the planned daily prompts                   -> rotation for the next four weeks
  data/bank.js        BANK_META.notes: where each prompt's list came from
  data/curated.json   prompt wording
Python 3 standard library only. Everything shown is already public in the repo, so the page needs no key.
"""
import csv, datetime, html, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(ROOT, 'dist', 'dash')
MILES = [10, 25, 40, 60, 80, 100]
DAY1 = datetime.date(2026, 11, 27)
e = html.escape


def load(name, default):
    p = os.path.join(DATA, name)
    if not os.path.exists(p): return default
    with open(p, encoding='utf8') as f:
        return json.load(f) if name.endswith('.json') else f.read()


def main():
    curated = {p['id']: p for p in load('curated.json', [])}
    checks = load('checks.json', {}).get('prompts', {})
    sched = load('schedule.json', {}).get('days', {})
    bank_src = load('bank.js', '')
    m = re.search(r'const BANK_META=(\{.*\});', bank_src)
    meta = json.loads(m.group(1)) if m else {}
    notes = meta.get('notes', {})
    rows = []
    rp = os.path.join(DATA, 'report.csv')
    if os.path.exists(rp):
        with open(rp, encoding='utf8') as f: rows = list(csv.DictReader(f))

    # ---- tier mix per prompt
    mix = {}
    for r in rows:
        t = MILES.index(int(r['miles']))
        mix.setdefault(r['prompt'], [0] * 6)[t] += 1
    ids = sorted(mix, key=lambda i: -mix[i][5] / max(1, sum(mix[i])))
    total = sum(sum(v) for v in mix.values()) or 1
    top = sum(v[5] for v in mix.values())

    # ---- tests
    tests_n = sum((c.get('hand', {}).get('checks', 0)) for c in checks.values())
    tests_fail = sum(len(c.get('hand', {}).get('failed', [])) + len(c.get('bank', {}).get('failed', [])) for c in checks.values())
    warns = sum(len(c.get('bank', {}).get('warnings', [])) for c in checks.values())

    # ---- schedule
    today = (datetime.date.today() - DAY1).days + 1
    span = [d for d in range(today, today + 28)]
    planned = sum(1 for d in sched if int(d) >= today)

    q = lambda i: curated.get(i, {}).get('q', i)

    # tier-mix chart: one row per prompt, a 100% bar in six shades of one blue, 100 mi darkest
    W, left, bw, rh = 760, 290, 380, 22
    H = 40 + rh * len(ids) + 40
    svg = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Share of each prompt\'s answers at each tier" class="chart">']
    for k, mi in enumerate(MILES):
        x = left + k * 64
        svg.append(f'<rect x="{x}" y="6" width="12" height="12" class="t{k}"/><text x="{x + 16}" y="16" class="small">{mi} mi</text>')
    for n, i in enumerate(ids):
        y = 34 + n * rh
        v = mix[i]; s = sum(v) or 1; x = left
        svg.append(f'<text x="{left - 10}" y="{y + 14}" text-anchor="end" class="lbl">{e(q(i)[:40])}</text>')
        for k in range(6):
            w = bw * v[k] / s
            if w > 0:
                svg.append(f'<rect x="{x:.1f}" y="{y + 3}" width="{w:.1f}" height="{rh - 7}" class="t{k}"><title>{e(q(i))}: {v[k]} answers at {MILES[k]} mi ({v[k] / s:.0%})</title></rect>')
            x += w
        pct = v[5] / s
        svg.append(f'<text x="{left + bw + 8}" y="{y + 14}" class="val{" hot" if pct > .3 else ""}">{pct:.0%} at 100 mi · {s} answers</text>')
    svg.append('</svg>')

    # checks table
    trs = []
    for i in sorted(curated, key=lambda i: q(i)):
        c = checks.get(i, {}); h, b = c.get('hand', {}), c.get('bank', {})
        fails = h.get('failed', []) + b.get('failed', [])
        ws = b.get('warnings', [])
        n = h.get('checks', 0)
        status = '<span class="bad">fails</span>' if fails else '<span class="warn">check</span>' if ws else '<span class="ok">ok</span>' if n else '<span class="none">no tests</span>'
        detail = '<br>'.join(e(x) for x in fails + ws) or ''
        v = mix.get(i, [0] * 6)
        trs.append(f'<tr><td>{e(q(i))}</td><td class="num">{sum(v)}</td><td>{e(notes.get(i, ""))}</td>'
                   f'<td class="num">{n - len(h.get("failed", []))}/{n}</td><td>{status}</td><td class="detail">{detail}</td></tr>')

    # rotation grid: prompts x next 28 days
    order = [i for i in curated]
    gw, gl, cell = 760, 290, 16
    GH = 34 + cell * len(order) + 10
    g = [f'<svg viewBox="0 0 {gw} {GH}" role="img" aria-label="Which prompts are planned on each of the next 28 days" class="chart">']
    for k, d in enumerate(span):
        x = gl + k * cell
        dt = DAY1 + datetime.timedelta(days=d - 1)
        if dt.weekday() == 0 or (k == 0 and dt.weekday() < 5):
            g.append(f'<text x="{x}" y="14" class="small">{dt:%b} {dt.day}</text>')
    for n, i in enumerate(order):
        y = 24 + n * cell
        g.append(f'<text x="{gl - 10}" y="{y + 12}" text-anchor="end" class="lbl">{e(q(i)[:40])}</text>')
        for k, d in enumerate(span):
            if i in sched.get(str(d), []):
                dt = DAY1 + datetime.timedelta(days=d - 1)
                g.append(f'<rect x="{gl + k * cell + 2}" y="{y + 2}" width="{cell - 4}" height="{cell - 4}" rx="2" class="{"today" if k == 0 else "used"}"><title>{e(q(i))}: {dt:%a %b} {dt.day}</title></rect>')
    g.append('</svg>')

    kpi = lambda big, small: f'<div class="kpi"><b>{big}</b><span>{small}</span></div>'
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Backroads engine</title><meta name="robots" content="noindex">
<style>
:root{{--bg:#f6f0e1;--card:#fffaf0;--ink:#2b2a26;--mute:#6f6a5e;--line:#e2d8c0;--accent:#1d4f9c;--bad:#b3261e;--warn:#9a6a00;--ok:#1b7a4b}}
@media (prefers-color-scheme:dark){{:root{{--bg:#1d1c19;--card:#262521;--ink:#ece6d8;--mute:#a59f90;--line:#3a3832;--accent:#7fa7ea;--bad:#ef8a83;--warn:#e0b44c;--ok:#6cc79a}}}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}}
main{{max-width:820px;margin:0 auto;padding:20px 16px 60px}}
h1{{font-size:24px;margin:0 0 2px}} h2{{font-size:17px;margin:0 0 4px}} .sub{{color:var(--mute);margin:0 0 14px}}
section{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}}
.kpi{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}} .kpi b{{display:block;font-size:26px}} .kpi span{{color:var(--mute);font-size:13px}}
.chart{{width:100%;height:auto;display:block}} .chart text{{fill:var(--ink);font-size:12px}} .chart .small{{fill:var(--mute);font-size:11px}} .chart .val{{fill:var(--mute)}} .chart .hot{{fill:var(--bad);font-weight:600}}
.t0{{fill:var(--accent);opacity:.14}} .t1{{fill:var(--accent);opacity:.28}} .t2{{fill:var(--accent);opacity:.44}} .t3{{fill:var(--accent);opacity:.6}} .t4{{fill:var(--accent);opacity:.78}} .t5{{fill:var(--accent)}}
.used{{fill:var(--accent);opacity:.55}} .today{{fill:var(--accent)}}
.scroll{{overflow-x:auto}} table{{border-collapse:collapse;width:100%;font-size:13px}} th,td{{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}} th{{color:var(--mute);font-weight:600}}
.num{{text-align:right;white-space:nowrap}} .detail{{color:var(--mute);font-size:12px}} .bad{{color:var(--bad);font-weight:600}} .warn{{color:var(--warn);font-weight:600}} .ok{{color:var(--ok)}} .none{{color:var(--mute)}}
footer{{color:var(--mute);font-size:12px}}
</style></head><body><main>
<h1>Backroads engine</h1><p class="sub">Question and answer health · bank built {e(meta.get("built", "?"))}{" (MOCK data)" if meta.get("mock") else ""} · page made {datetime.date.today():%b} {datetime.date.today().day}</p>
<div class="kpis">{kpi(f"{top / total:.0%}", f"of {total:,} accepted answers score 100 mi")}{kpi(f"{tests_n - tests_fail}/{tests_n}", "answer tests passing")}{kpi(warns, "common answers scoring over 40 mi")}{kpi(planned, "days planned ahead")}</div>
<section><h2>Tier mix by prompt</h2><p class="sub">Share of each prompt's accepted answers at each tier, most 100 mi first. Over 30% at 100 mi is shown in red: those make big scores too easy.</p>{"".join(svg)}</section>
<section><h2>Answer tests</h2><p class="sub">From content/answer_tests.yaml: answers that must count, must not count, and common answers that should score 40 mi or less.</p><div class="scroll"><table><tr><th>Prompt</th><th class="num">Answers</th><th>List source</th><th class="num">Tests</th><th>Status</th><th>Details</th></tr>{"".join(trs)}</table></div></section>
<section><h2>Next four weeks</h2><p class="sub">Planned prompts by day (from data/schedule.json). Today is the darker column. A prompt rests at least 3 days between uses.</p><div class="scroll">{"".join(g)}</div></section>
<footer>Built by scripts/build_dashboard.py from the files in data/. Rebuilt on every deploy.</footer>
</main></body></html>'''
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf8') as f: f.write(page)
    print(f'wrote dist/dash/index.html · {len(ids)} prompts, {total} answers, {top / total:.0%} at 100 mi')


if __name__ == '__main__':
    main()
