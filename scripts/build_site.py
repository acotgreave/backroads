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
open(os.path.join(dist, 'index.html'), 'w', encoding='utf8').write(html)
print('wrote dist/index.html')
