// Sanity-check every prompt's answers using the game's own matching code from src/template.html.
//   node scripts/check_answers.js              # hand lists, plus data/bank.js if it exists
//   node scripts/check_answers.js --hand-only  # skip data/bank.js
//   node scripts/check_answers.js --warn-only  # print problems but exit 0
// Fails (exit 1) when a typed answer or alias would score as a different answer, when two answers
// share an alias, or when a "nice try" trap shadows a right answer.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`could not find "${from}" in template.html`);
  return html.slice(a, b);
}
const code = [
  slice('const P=[', '/*BANK*/'),
  slice('const CUTS=', '\n') + '\n',
  slice('const norm=', '// ---------- state'),
].join('\n');

function load(bankSrc) {
  return new Function(code + '\n' + (bankSrc || '') +
    "\nif(typeof BANK!=='undefined'){const m=Object.fromEntries(BANK.map(b=>[b.id,b]));for(const p of P){const b=m[p.id];if(b&&b.bank&&b.bank.length)p.bank=b.bank}}" +
    '\nreturn {P,prep,judge,norm};')();
}

let hard = 0;   // problems that always fail the build, even with --warn-only
function check(label, env) {
  const { P, prep, judge, norm } = env;
  const problems = [];
  for (const raw of P) {
    const p = prep(raw);
    if (!p.items.some(it => it.tier === 5)) { problems.push(`${p.id}: no 100-mile answer (rarest tier is ${Math.max(...p.items.map(it => it.tier))})`); hard++; }
    const owner = new Map();
    for (const it of p.items) {
      for (const a of it.al) {
        if (!a) { problems.push(`${p.id}: "${it.name}" has an alias that is empty after normalising`); continue; }
        const prev = owner.get(a);
        if (prev && prev !== it) problems.push(`${p.id}: "${a}" belongs to both "${prev.name}" and "${it.name}"`);
        else owner.set(a, it);
      }
    }
    for (const it of p.items) {
      for (const a of new Set(it.al)) {
        if (!a || owner.get(a) !== it) continue;          // already reported as a clash
        const r = judge(p, a);
        if (!r || r.trap) problems.push(`${p.id}: typing "${a}" hits a trap instead of "${it.name}"`);
        else if (!r.it) problems.push(`${p.id}: typing "${a}" isn't accepted at all (meant for "${it.name}")`);
        else if (r.it !== it) problems.push(`${p.id}: typing "${a}" scores as "${r.it.name}", not "${it.name}"`);
      }
    }
    for (const t of Object.keys(p.traps || {})) {
      if (owner.has(norm(t))) problems.push(`${p.id}: trap "${t}" is also a right answer`);
    }
  }
  console.log(`${label}: ${P.length} prompts, ${problems.length ? problems.length + ' problem(s)' : 'all clear'}`);
  problems.forEach(s => console.log('  ' + s));
  return problems.length;
}

// ---- answer tests from content/answer_tests.yaml (prompt: accept / reject / common, values split by |)
function readTests() {
  const p = path.join(root, 'content/answer_tests.yaml');
  if (!fs.existsSync(p)) return {};
  const out = {}; let cur = null;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const m = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
    if (!m) throw new Error(`content/answer_tests.yaml line ${i + 1}: expected "name: value"`);
    if (!m[1]) { cur = out[m[2]] = {}; return; }
    if (!cur) throw new Error(`content/answer_tests.yaml line ${i + 1}: indented line before any prompt`);
    cur[m[2]] = m[3].split('|').map(s => s.trim()).filter(Boolean);
  });
  return out;
}
const TESTS = readTests();
const RESULTS = {};   // per prompt, for the dashboard (data/checks.json)
function runTests(label, env, bank) {
  const { P, prep, judge } = env, fails = [], warns = [];
  for (const [id, t] of Object.entries(TESTS)) {
    const raw = P.find(p => p.id === id);
    if (!raw) { fails.push(`${id}: no such prompt`); continue; }
    const p = prep(raw), f0 = fails.length, w0 = warns.length;
    for (const a of t.accept || []) { const r = judge(p, a); if (!r || !r.it) fails.push(`${id}: "${a}" should count but ${r && r.trap ? 'hits a trap' : 'is not accepted'}`); }
    for (const a of t.reject || []) { const r = judge(p, a); if (r && r.it) fails.push(`${id}: "${a}" should NOT count but scores as "${r.it.name}"`); }
    if (bank) for (const a of t.common || []) { const r = judge(p, a);
      if (!r || !r.it) fails.push(`${id}: common answer "${a}" is not accepted`);
      else if (r.it.tier > 2) warns.push(`${id}: common answer "${a}" scores ${[10, 25, 40, 60, 80, 100][r.it.tier]} mi`); }
    const n = (t.accept || []).length + (t.reject || []).length + (bank ? (t.common || []).length : 0);
    RESULTS[id] = { [bank ? 'bank' : 'hand']: { checks: n, failed: fails.slice(f0).map(x => x.replace(id + ': ', '')), warnings: warns.slice(w0).map(x => x.replace(id + ': ', '')) }, ...(RESULTS[id] || {}) };
  }
  const n = Object.values(TESTS).reduce((s, t) => s + (t.accept || []).length + (t.reject || []).length + (bank ? (t.common || []).length : 0), 0);
  console.log(`answer tests on ${label}: ${n} checks, ${fails.length ? fails.length + ' failed' : 'all pass'}${warns.length ? `, ${warns.length} warning(s)` : ''}`);
  fails.forEach(s => console.log('  FAIL ' + s)); warns.forEach(s => console.log('  warn ' + s));
  return fails.length;
}

let bad = check('hand lists', load());
hard += runTests('hand lists', load(), false);
const bankPath = path.join(root, 'data/bank.js');
if (fs.existsSync(bankPath) && !process.argv.includes('--hand-only')) {
  const env = load(fs.readFileSync(bankPath, 'utf8'));
  bad += check('data/bank.js', env);
  bad += runTests('data/bank.js', env, true);   // a weekly bank that drops an answer warns; it never blocks the deploy
}
if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(root, 'data/checks.json'), JSON.stringify({ updated: new Date().toISOString().slice(0, 10), prompts: RESULTS }) + '\n');
  console.log('wrote data/checks.json');
}
if (hard || (bad && !process.argv.includes('--warn-only'))) process.exit(1);
