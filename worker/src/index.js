// Backroads crowd results: a tiny Cloudflare Worker + D1.
// Records each finished daily drive anonymously and serves the day's totals to the results page.
// No accounts, cookies, names or IP addresses are stored. See worker/README.md.
//
// GET  /api/day?d=YYYY-MM-DD   the day's totals
// POST /api/run                one finished daily drive (body: JSON, sent as text/plain to skip CORS preflight)
// GET  /api/health

const PTS = [10, 25, 40, 60, 80, 100];   // miles per tier, same as the game
const MISS_MIN = 2;      // a wrong guess is only shown once this many different players tried it
const MISS_TOP = 3;      // wrong guesses returned per prompt
const POST_PER_HOUR = 20;
const GET_PER_HOUR = 600;
const CACHE_MS = 15000;  // per-isolate cache of a day's totals

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PID_RE = /^[A-Za-z0-9-]{8,64}$/;
const QID_RE = /^[\w-]{1,40}$/;

const cache = new Map();

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/api/health') return json({ ok: true }, 200, cors);
      if (url.pathname === '/api/day' && req.method === 'GET') return await getDay(req, env, url, cors);
      if (url.pathname === '/api/run' && req.method === 'POST') return await postRun(req, env, cors);
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      console.error(e && e.stack || e);
      return json({ error: 'server error' }, 500, cors);
    }
  },
  // daily: forget rate-limit counters (they hold hashed IPs) after two days
  async scheduled(_ev, env) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE win < ?').bind(hourNow() - 48).run();
  },
};

// ---------- requests ----------

async function getDay(req, env, url, cors) {
  const day = url.searchParams.get('d') || '';
  if (!DAY_RE.test(day) || !nearToday(day, 400, 2)) return json({ error: 'bad day' }, 400, cors);
  if (!(await allow(req, env, 'g', GET_PER_HOUR))) return json({ error: 'slow down' }, 429, cors);
  return json(await dayStats(env, day), 200, { ...cors, 'Cache-Control': 'public, max-age=15' });
}

async function postRun(req, env, cors) {
  if (!cors['Access-Control-Allow-Origin']) return json({ error: 'origin not allowed' }, 403, cors);
  const text = await req.text();
  if (text.length > 20000) return json({ error: 'too big' }, 413, cors);
  let b;
  try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400, cors); }
  const run = validate(b);
  if (typeof run === 'string') return json({ error: run }, 400, cors);
  if (!(await allow(req, env, 'p', POST_PER_HOUR))) return json({ error: 'slow down' }, 429, cors);

  const db = env.DB, { day } = run, stmts = [
    db.prepare('INSERT INTO runs (day,pid,miles,tiers,qs,created) VALUES (?,?,?,?,?,?)')
      .bind(day, run.pid, run.miles, run.ans.map(a => a.tier).join(','), run.ans.map(a => a.id).join(','), Math.floor(Date.now() / 1000)),
    db.prepare('INSERT INTO day_miles (day,mi,n) VALUES (?,?,1) ON CONFLICT(day,mi) DO UPDATE SET n=n+1')
      .bind(day, run.miles),
  ];
  for (const a of run.ans) stmts.push(
    db.prepare('INSERT INTO day_answers (day,prompt,answer,tier,n) VALUES (?,?,?,?,1) ON CONFLICT(day,prompt,answer) DO UPDATE SET n=n+1, tier=excluded.tier')
      .bind(day, a.id, a.a, a.tier));
  for (const [id, gs] of Object.entries(run.misses)) for (const g of gs) stmts.push(
    db.prepare('INSERT INTO day_misses (day,prompt,guess,n) VALUES (?,?,?,1) ON CONFLICT(day,prompt,guess) DO UPDATE SET n=n+1')
      .bind(day, id, g));
  let dup = false;
  try { await db.batch(stmts); }   // one transaction: a repeat drive changes nothing
  catch (e) { if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(e && e.message))) dup = true; else throw e; }
  cache.delete(day);
  return json({ ...(await dayStats(env, day)), saved: !dup, duplicate: dup }, dup ? 200 : 201, cors);
}

// ---------- the day's totals ----------

async function dayStats(env, day) {
  const hit = cache.get(day);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  const db = env.DB;
  const [m, a, x] = await db.batch([
    db.prepare('SELECT mi, n FROM day_miles WHERE day=? ORDER BY mi').bind(day),
    db.prepare('SELECT prompt, answer, tier, n FROM day_answers WHERE day=? ORDER BY prompt, n DESC, answer').bind(day),
    db.prepare(`SELECT prompt, guess, n FROM (
        SELECT prompt, guess, n, ROW_NUMBER() OVER (PARTITION BY prompt ORDER BY n DESC, guess) AS r
        FROM day_misses WHERE day=? AND n>=?) WHERE r<=? ORDER BY prompt, n DESC`).bind(day, MISS_MIN, MISS_TOP),
  ]);
  const miles = m.results.map(r => [r.mi, r.n]);   // [miles, drivers]
  const players = miles.reduce((s, r) => s + r[1], 0);
  const prompts = {};
  const P = id => (prompts[id] ||= { players: 0, passes: 0, answers: [], misses: [] });
  for (const r of a.results) {
    const p = P(r.prompt); p.players += r.n;
    if (r.answer === '') p.passes += r.n; else p.answers.push([r.answer, r.tier, r.n]);
  }
  for (const r of x.results) P(r.prompt).misses.push([r.guess, r.n]);
  const v = { day, players, miles, prompts };
  cache.set(day, { t: Date.now(), v });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return v;
}

// ---------- checks ----------

function validate(b) {
  if (!b || typeof b !== 'object') return 'bad body';
  const { day, pid, miles, ans, misses } = b;
  if (typeof day !== 'string' || !DAY_RE.test(day) || !nearToday(day, 2, 2)) return 'bad day';
  if (typeof pid !== 'string' || !PID_RE.test(pid)) return 'bad pid';
  if (!Array.isArray(ans) || ans.length !== 7) return 'need 7 answers';
  const seen = new Set(), out = [];
  for (const x of ans) {
    if (!x || typeof x !== 'object') return 'bad answer';
    const id = x.id, tier = x.tier;
    const a = typeof x.a === 'string' ? x.a.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (typeof id !== 'string' || !QID_RE.test(id) || seen.has(id)) return 'bad prompt id';
    if (!Number.isInteger(tier) || tier < -1 || tier > 5) return 'bad tier';
    if ((tier === -1) !== (a === '')) return 'answer and tier disagree';
    seen.add(id); out.push({ id, a, tier });
  }
  if (miles !== out.reduce((s, x) => s + (x.tier < 0 ? 0 : PTS[x.tier]), 0)) return 'miles do not add up';
  const mx = {};
  if (misses && typeof misses === 'object') for (const [id, gs] of Object.entries(misses)) {
    if (!seen.has(id) || !Array.isArray(gs)) continue;
    const set = new Set();
    for (const g of gs.slice(0, 30)) { const n = cleanGuess(g); if (n) set.add(n); if (set.size >= 15) break; }
    if (set.size) mx[id] = [...set];
  }
  return { day, pid, miles, ans: out, misses: mx };
}

// lower-case, letters/digits/basic punctuation only, short
function cleanGuess(g) {
  if (typeof g !== 'string') return '';
  const s = g.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 '&.\-]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 2 && s.length <= 40 ? s : '';
}

// is `day` within `back` days before and `ahead` days after today (UTC)? Local dates run UTC-12 to UTC+14.
function nearToday(day, back, ahead) {
  const t = Date.parse(day + 'T00:00:00Z');
  if (Number.isNaN(t)) return false;
  const today = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const d = Math.round((t - today) / 86400000);
  return d >= -back && d <= ahead;
}

function hourNow() { return Math.floor(Date.now() / 3600000); }

// Count requests per hashed IP per hour. The hash changes daily and the rows are deleted after two days.
async function allow(req, env, kind, max) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const day = new Date().toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${day}|${env.SALT || 'backroads'}`));
  const k = kind + ':' + [...new Uint8Array(buf).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  const r = await env.DB.prepare('INSERT INTO rate_limits (k,win,n) VALUES (?,?,1) ON CONFLICT(k,win) DO UPDATE SET n=n+1 RETURNING n')
    .bind(k, hourNow()).first();
  return !r || r.n <= max;
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const list = (env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = list.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const h = { 'Vary': 'Origin' };
  if (ok) Object.assign(h, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  return h;
}

function json(v, status, headers) {
  return new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
