// Runs the game's own Wikipedia answer check against live Wikipedia for a set of known right and wrong answers.
// Usage: node scripts/check_wiki.js   (needs network; CI runs it on branch pushes that touch the template)
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'src/template.html'), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return html.slice(i, j); };
const code = cut('const norm=', '\n') + '\n' + cut('function lev(', '\nfunction judge') + '\n' + cut('// ---------- wikipedia check', '// ---------- end wikipedia check');
const { wikiCheck } = new Function(code + '\nreturn {wikiCheck};')();
const UA = { headers: { 'User-Agent': 'BackroadsQuiz/1.0 (https://backroads.howtospeakdata.com; answer-check test)' } };
let seen = [];
const f = async (u, o) => { const r = await fetch(u, { ...(o || {}), ...UA }); const j = await r.json(); seen.push(j); return { json: async () => j }; };
const cases = [
  // [prompt, answer, should count?]
  ['beer', 'Fremont Brewing', 1], ['beer', 'Elysian Brewing', 1], ['beer', 'Pliny the Younger', 1], ['beer', 'Pliny the Elder', 0], ['beer', 'Russian River Brewing', 1],
  ['beer', 'Seattle', 0], ['beer', 'Heineken', 0], ['beer', 'Guinness', 0], ['beer', 'Coors Field', 0],
  ['soda', 'Moxie', 1], ['soda', 'Cheerwine', 1], ['soda', 'Irn-Bru', 0],
  ['cereal', 'Kaboom', 1], ['cereal', 'Weetabix', 0],
  ['candy', 'Abba-Zaba', 1], ['candy', 'Cadbury', 0],
  ['fastfood', 'Del Taco', 1], ['fastfood', 'Greggs', 0],
  ['stores', 'Big Lots', 1], ['stores', 'Tesco', 0],
  ['cars', 'Saleen', 1], ['cars', 'Toyota', 0],
  ['airlines', 'Breeze Airways', 1], ['airlines', 'Ryanair', 0],
  ['rivers', 'Snoqualmie River', 1], ['rivers', 'Thames', 0],
  ['dogs', 'Boykin Spaniel', 1], ['dogs', 'Labrador Retriever', 0],
  ['simpsons', 'Hans Moleman', 1], ['simpsons', 'Peter Griffin', 0],
  ['sesame', 'Snuffleupagus', 1], ['friends', 'Gunther', 1], ['simpsons', 'Disco Stu', 1], ['candy', 'Goo Goo Cluster', 1], ['candy', 'Dairy Milk', 0], ['soda', 'Vimto', 0], ['friends', 'Sheldon Cooper', 0],
];
(async () => {
  let wrong = 0;
  for (const [id, a, want] of cases) {
    seen = [];
    const got = await wikiCheck({ id }, a, f);
    const ok = !!got === !!want; if (!ok) wrong++;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${id.padEnd(9)} ${a.padEnd(22)} want ${want ? 'yes' : 'no '}  got ${got || '-'}`);
    if (!ok) for (const j of seen) for (const pg of ((j.query && j.query.pages) || []).sort((x, y) => x.index - y.index))
      console.log(`       · ${pg.title} — ${pg.description || '(no description)'} — ${(pg.categories || []).map(c => c.title.slice(9)).slice(0, 12).join(' | ')}`);
  }
  console.log(`${cases.length - wrong}/${cases.length} as expected`);
})();
