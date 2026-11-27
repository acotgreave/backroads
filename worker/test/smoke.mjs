// Smoke test against a running worker: `npm run dev` in one terminal, `npm test` in another.
// API=https://backroads-api.<sub>.workers.dev npm test   to check a deployed one (writes a test drive dated today).
const API = process.env.API || 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:8000';
const day = new Date().toISOString().slice(0, 10);
const ids = ['states', 'parks', 'cereal', 'nfl', 'rivers', 'dogs', 'cars'];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const post = (b, origin = ORIGIN) => fetch(API + '/api/run', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: origin }, body: JSON.stringify(b) });
const run = (pid, tiers, extra = {}) => ({
  day, pid, miles: tiers.reduce((s, t) => s + (t < 0 ? 0 : [10, 25, 40, 60, 80, 100][t]), 0),
  ans: ids.map((id, i) => ({ id, a: tiers[i] < 0 ? '' : `Answer ${id} ${tiers[i]}`, tier: tiers[i] })), ...extra,
});

const pid = () => 'test-' + crypto.randomUUID();
const before = await (await fetch(`${API}/api/day?d=${day}`, { headers: { Origin: ORIGIN } })).json();
const n0 = before.players || 0;

let r = await post(run(pid(), [0, 1, 2, 3, 4, 5, -1], { misses: { states: ['Puerto Rico', 'puerto  rico!', 'x'], nope: ['ignored'] } }));
ok(r.status === 201, `first drive saved (${r.status})`);
let j = await r.json();
ok(j.players === n0 + 1, `player count went up to ${j.players}`);
ok(r.headers.get('access-control-allow-origin') === ORIGIN, 'CORS header for allowed origin');

const p2 = pid();
r = await post(run(p2, [0, 0, 0, 0, 0, 0, 0], { misses: { states: ['Puerto Rico'] } }));
ok(r.status === 201, 'second player saved');
r = await post(run(p2, [5, 5, 5, 5, 5, 5, 5]));
j = await r.json();
ok(r.status === 200 && j.duplicate === true, 'same player, same day: not saved twice');
ok(j.players === n0 + 2, 'count unchanged by repeat');
ok((j.prompts.states.misses.find(m => m[0] === 'puerto rico') || [])[1] >= 2, 'shared wrong guess shows once 2 players tried it');
ok(!JSON.stringify(j).includes('"x"') && !JSON.stringify(j).includes('ignored'), 'junk guesses dropped');
ok(j.prompts.cars.passes >= 1, 'passes counted');

r = await post({ ...run(pid(), [5, 5, 5, 5, 5, 5, 5]), miles: 700 + 1 });
ok(r.status === 400, 'miles that do not add up are refused');
r = await post({ ...run(pid(), [0, 0, 0, 0, 0, 0, 0]), day: '2001-01-01' });
ok(r.status === 400, 'old dates refused');
r = await post(run(pid(), [0, 0, 0, 0, 0, 0, 0]), 'https://evil.example');
ok(r.status === 403, 'other websites refused');
r = await fetch(`${API}/api/day?d=nonsense`);
ok(r.status === 400, 'bad day refused');

console.log(fails ? `\n${fails} failed` : '\nall good');
process.exit(fails ? 1 : 0);
