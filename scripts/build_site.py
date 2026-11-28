#!/usr/bin/env python3
"""Assemble the site into dist/: the game page (with data/bank.js baked in, if present) plus static files."""
import os, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist = os.path.join(ROOT, 'dist')
shutil.rmtree(dist, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'public'), dist)
html = open(os.path.join(ROOT, 'src/template.html'), encoding='utf8').read()
bank_path = os.path.join(ROOT, 'data/bank.js')
if os.path.exists(bank_path):
    bank = open(bank_path, encoding='utf8').read()
    if 'mock' in bank and '"mock": true' in bank:
        raise SystemExit('refusing to publish a MOCK bank; run build_bank.py without --mock')
    html = html.replace('/*BANK*/', bank)
    print('baked in data/bank.js')
else:
    print('no data/bank.js: publishing hand-set tiers')
# the planned daily prompts (scripts/build_schedule.js)
sched_path = os.path.join(ROOT, 'data/schedule.json')
if os.path.exists(sched_path):
    import json as _j
    sched = _j.load(open(sched_path, encoding='utf8'))
    html = html.replace('/*SCHED*/{}', _j.dumps({'days': sched['days']}, separators=(',', ':')))
    print(f"baked in data/schedule.json ({len(sched['days'])} days)")
# site wording from content/copy.yaml
import json, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from copy_yaml import parse
copy_path = os.path.join(ROOT, 'content/copy.yaml')
try:
    copy = parse(open(copy_path, encoding='utf8').read())
except ValueError as e:
    raise SystemExit(f'content/copy.yaml: {e}')
html = html.replace('/*COPY*/{}', json.dumps(copy, ensure_ascii=False).replace('</', '<\\/'))
print('baked in content/copy.yaml')
# crowd results API (the Cloudflare Worker in worker/); empty = the results page keeps its estimates
api = os.environ.get('CROWD_API', '').strip().rstrip('/')
if api and not api.startswith('https://'):
    raise SystemExit(f'CROWD_API must start with https:// (got {api!r})')
html = html.replace("/*API*/''", json.dumps(api))
print(f'crowd API: {api or "none (estimates only)"}')
open(os.path.join(dist, 'index.html'), 'w', encoding='utf8').write(html)
print('wrote dist/index.html')
