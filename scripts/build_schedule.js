// Plans the daily prompts ahead and freezes them in data/schedule.json, using the game's own dayPrompts().
// Days already in the file never change, so adding or retiring prompts only affects days not yet planned.
//   node scripts/build_schedule.js          # plan up to 90 days ahead of today
//   node scripts/build_schedule.js --days 120
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
const grab = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return src.slice(i, j); };
const code = grab('const CATS=', '\n') + '\n' + grab('function rng(', 'function newGame');
const { dayPrompts } = new Function(code + ';return {dayPrompts}')();
const file = path.join(root, 'data/schedule.json');
const sched = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { days: {} };
sched.days = sched.days || {};
const ahead = +(process.argv[process.argv.indexOf('--days') + 1] || 0) || 90;
const day1 = Date.parse('2026-11-27T00:00:00Z'), todayNo = Math.floor((Date.now() - day1) / 864e5) + 1;
let added = 0;
for (let d = 1; d <= todayNo + ahead; d++) {
  if (sched.days[d]) continue;
  sched.days[d] = dayPrompts(d, sched); added++;
}
const date = d => new Date(day1 + (d - 1) * 864e5).toISOString().slice(0, 10);
sched.updated = new Date().toISOString().slice(0, 10);
// one line per day, so a diff shows exactly which days changed
const lines = Object.keys(sched.days).sort((a, b) => a - b).map(d => `  ${JSON.stringify(d)}: ${JSON.stringify(sched.days[d])}`);
fs.writeFileSync(file, `{"updated": ${JSON.stringify(sched.updated)},\n "note": "Day number (day 1 = 2026-11-27) -> the seven prompt ids. Planned days are frozen; edit a day by hand only before it is played.",\n "days": {\n${lines.join(',\n')}\n }}\n`);
console.log(`data/schedule.json: ${Object.keys(sched.days).length} days planned (${added} new), through day ${todayNo + ahead} (${date(todayNo + ahead)})`);
