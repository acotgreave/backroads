// Runs the game's own Wikipedia answer check against live Wikipedia for a set of known right and wrong answers.
// Usage: node scripts/check_wiki.js   (needs network; CI runs it on branch pushes that touch the template)
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'src/template.html'), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return html.slice(i, j); };
const code = cut('const norm=', '\n') + '\n' + cut('function lev(', '\nfunction judge') + '\n' + cut('// ---------- wikipedia check', '// ---------- end wikipedia check');
const { wikiCheck, liveTier } = new Function(code + '\nreturn {wikiCheck, liveTier};')();
const UA = { headers: { 'User-Agent': 'BackroadsQuiz/1.0 (https://backroads.howtospeakdata.com; answer-check test)' } };
let seen = [], limited = false;
const f = async (u, o) => {
  const r = await fetch(u, { ...(o || {}), ...UA });
  if (r.status === 429) limited = true; else if (!r.ok) console.log(`       ! HTTP ${r.status} ${(await r.clone().text()).slice(0, 160)}`);
  const j = await r.json(); seen.push(j); return { json: async () => j }; };
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
  ['holidays', 'Juneteenth', 1], ['holidays', 'Arbor Day', 1], ['holidays', 'Boxing Day', 0], ['holidays', 'Bonfire Night', 0], ['holidays', 'Guy Fawkes Night', 0],
  ['firstladies', 'Lou Henry Hoover', 1], ['firstladies', 'Harriet Lane', 1], ['firstladies', 'Princess Diana', 0],
];
(async () => {
  let wrong = 0, skipped = 0;
  for (const [id, a, want] of cases) {
    try {
    seen = []; limited = false; await new Promise(r => setTimeout(r, 1500));
    const got = await wikiCheck({ id }, a, f);
    if (limited) { skipped++; console.log(`SKIP ${id.padEnd(9)} ${a.padEnd(22)} (Wikipedia rate limit)`); continue; }
    const ok = !!got === !!want; if (!ok) wrong++;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${id.padEnd(9)} ${a.padEnd(22)} want ${want ? 'yes' : 'no '}  got ${got || '-'}`);
    if (!ok) for (const j of seen) for (const pg of ((j.query && j.query.pages) || []).sort((x, y) => x.index - y.index))
      console.log(`       · ${pg.title} — ${pg.description || '(no description)'} — ${(pg.categories || []).map(c => c.title.slice(9)).slice(0, 12).join(' | ')}`);
    } catch (e) { console.log('       ! ' + e.message); }
  }
  // live scoring: a famous page lands low on a prompt's scale, so a well-known answer missing from the list isn't 100 mi
  for (const [title, maxTier] of [['Easter', 2], ['Valentine\'s Day', 2], ['Christmas', 1]]) {
    try { await new Promise(r => setTimeout(r, 1500));
      const t = await liveTier({ cut: [2e6, 8e5, 3e5, 8e4, 1e4] }, title, f);
      if (limited) { skipped++; console.log(`SKIP tier ${title}`); continue; }
      const ok = t !== null && t <= maxTier; if (!ok) wrong++;
      console.log(`${ok ? 'ok  ' : 'MISS'} tier     ${title.padEnd(22)} want <= ${maxTier}  got ${t}`);
    } catch (e) { console.log('       ! ' + e.message); }
  }
  console.log(`${cases.length - wrong - skipped}/${cases.length - skipped} as expected${skipped ? `, ${skipped} skipped by rate limit` : ''}`);
})();
