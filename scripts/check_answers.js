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

function check(label, env) {
  const { P, prep, judge, norm } = env;
  const problems = [];
  for (const raw of P) {
    const p = prep(raw);
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

let bad = check('hand lists', load());
const bankPath = path.join(root, 'data/bank.js');
if (fs.existsSync(bankPath) && !process.argv.includes('--hand-only')) bad += check('data/bank.js', load(fs.readFileSync(bankPath, 'utf8')));
if (bad && !process.argv.includes('--warn-only')) process.exit(1);
