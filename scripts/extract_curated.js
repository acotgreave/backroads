// Pull the hand-curated prompts (wording, answers, aliases, traps) out of src/template.html
// so the game page stays the single source of truth. Writes data/curated.json.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
const a = html.indexOf('const P=[');
const b = html.indexOf('];\n/*BANK*/');
if (a < 0 || b < 0) throw new Error('could not find the prompt list in template.html');
const P = new Function(html.slice(a, b + 2) + '\nreturn P;')();
const out = P.map(p => ({
  id: p.id, q: p.q, rule: p.rule || null, strip: p.strip || [], people: !!p.people, traps: p.traps || {},
  items: p.list.split('|').map(e => { const [n, al] = e.split('='); return { name: n.trim(), aliases: al ? al.split(';') : [] }; }),
}));
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/curated.json'), JSON.stringify(out, null, 1));
console.log(`curated.json: ${out.length} prompts, ${out.reduce((s, p) => s + p.items.length, 0)} answers`);
