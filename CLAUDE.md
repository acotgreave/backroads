# Backroads: handover for Claude Code

Read this first. It covers what the project is, where it stands, and what to do next.

## What this is

**Backroads** is a daily US trivia game for Andy Cotgreave (How To Speak Data). It's a US take on **Boreen**, which is itself a UK reskin of **Krillion**. A friend who is American and lives in the UK couldn't play Boreen because it assumes UK knowledge.

- Each day has 7 prompts ("Name a US national park"), with 25 seconds each. A timer toggle helps non-US players.
- Rarer right answers score more. The six tiers are 10, 25, 40, 60, 80 and 100 miles, each shown as an animal on a yellow wildlife-crossing sign: squirrel, raccoon, deer, coyote, black bear, bald eagle.
- Every day is a named US road, such as Route 66 or the Pacific Coast Highway. Points drive you along it.
- The Daily mode uses a date-seeded set of prompts, one per category. Unlimited mode is random. The share text uses animal emoji and ends with the URL.
- Target URL: **https://backroads.howtospeakdata.com**

## Design direction: a journey, not a dive

Andy wants Boreen's **journey** feel, not Krillion's **dive** feel. This is a fixed rule for every change.

- Points move you **forward along a road**: miles, landmarks, an odometer, the car driving on. Never "descending", depth, or an ocean or underwater look.
- Each day is a trip with a start and a destination. Progress shows as distance covered and stops reached, and the result is "how far you got".
- Rarity reads as **what you spotted along the way** (the wildlife-crossing animals), not how deep you went.
- New features should extend the journey: new roads, roadside stops, a trip log or road atlas of past days, "furthest drive" streaks, souvenirs from rare answers.
- When borrowing from OpenKrillion (see the roadmap), take **backend patterns only**. Leave out its ocean scene, depth zones, dive wording and sounds.

## Repo layout

| Path | What it is |
|---|---|
| `src/template.html` | **The whole game**, a single file. The `P` list near the top of the script holds the curated prompts (wording, answers, `=alias;alias`, traps). `/*BANK*/` is where the generated bank is injected. |
| `scripts/extract_curated.js` | Reads `P` out of the template and writes `data/curated.json`. Keeps the template as the single source of truth. |
| `scripts/build_bank.py` | Pulls answer lists from Wikidata, gets 24 months of Wikipedia page views, assigns tiers, and writes `data/bank.js` and `data/report.csv`. Python stdlib only. Flags: `--mock` (offline fake views), `--only states,parks`. |
| `scripts/check_answers.js` | Runs the game's own matching code over every answer and alias. Fails on aliases shared by two answers, aliases that score as a different answer, and traps that shadow a right answer. CI runs it hard on the hand lists and as warnings on the built bank. |
| `scripts/build_site.py` | Copies `public/` into `dist/` and writes `dist/index.html` with the bank baked in. It refuses to publish a mock bank. |
| `public/` | `CNAME` (backroads.howtospeakdata.com), `og.png` share card, `favicon.svg`, `.nojekyll` |
| `.github/workflows/deploy.yml` | On push, every Monday at 04:23 UTC, or a manual run: extract, then build bank (`continue-on-error`), commit the refreshed `data/`, build the site, and deploy to GitHub Pages. API responses are cached per ISO week in `.cache/`. |

### Rarity rule

For each answer, add up the page-view share held by the answers in that prompt that have **more** views. Thresholds: under 0.25 is tier 0, under 0.50 tier 1, under 0.70 tier 2, under 0.85 tier 3, under 0.95 tier 4, and anything else tier 5. Views use the median month × 24, so one news spike can't make an answer "common".

Exceptions:
- `amwords` keeps hand tiers.
- The state subsets (`mstates`, `twoword`, `atlantic`, `canada`) reuse the `states` page views.
- Answers with no usable Wikipedia page fall back to their hand rank.
- If under 60% of a prompt's answers get page views, the whole prompt falls back to hand tiers.

### Wikidata prompts

These are set in the `WD` dict in `build_bank.py`: states, capitals, parks, presidents, signers, nfl, mlb, nba, rivers (>400 km), simpsons, friends, sesame, dogs, cars, airlines.

- Each query has a `min` sanity check. If a query returns fewer results than that, the prompt falls back to the hand list. **The QIDs have never been checked against live Wikidata**, because the dev sandbox couldn't reach it. Check every prompt in the first real run's console output for "wikidata (N found)" versus "hand list".
- Hand answers are merged into the Wikidata results, keeping the nicer hand name, aliases and rank. Hand answers that Wikidata missed are kept.
- `TITLES` maps hand answers whose bare name lands on the wrong Wikipedia page (for example "Life" → "Life (cereal)").

## Current status (27 Nov 2026)

- [x] Repo `acotgreave/backroads` live; Pages source = GitHub Actions; DNS CNAME at GoDaddy. Site live at https://backroads.howtospeakdata.com.
- [x] First live Wikidata build: every `WD` prompt returns live results (states/capitals give 49, merged with hand answers). Team queries now restricted to sports teams.
- [x] First review of `report.csv`: extremes look right (California/Texas/Yellowstone/Homer 10 mi, North Dakota/Kobuk Valley 100 mi). Fixed: Wikidata aliases stored with strip words removed, shared/foreign aliases dropped, same-name items merged, hand answers merged with the Wikidata answer on the same page, answers that share another answer's page fall back to hand rank, ~45 `TITLES` fixes. `TITLES` value `None` = no page of its own.
- [x] Journey features: trip log, day streak, furthest drive, souvenirs (80/100 mi answers). Daily drive rolls over at local midnight.
- [ ] Re-check the next build's report for leftover `disambiguation`/`missing` rows and odd 10 mi answers.
- [ ] Share the link with Aaron.

The older prototype is a claude.ai artifact titled "Backroad: US edition". This repo supersedes it.

## First real build: review checklist

1. In the Actions log, every `WD` prompt should say `wikidata (N found)`. For any that fell back, fix the SPARQL in `WD` (check the QID at query.wikidata.org).
2. In `report.csv`, look for:
   - `title_status` values of `missing` or `disambiguation`. Add these to `TITLES`.
   - Sports teams, Simpsons characters and similar that are mis-tiered because the article title pulls views from something else.
   - Junk answers from loose queries, such as cargo airlines or tiny car makers. Tighten the query or lower `cap`.
   - Gut-check the extremes: California, Texas, Homer and Yellowstone should be 10 mi; North Dakota or Kobuk Valley should be 80–100.
3. Test the answer matching by playing in Unlimited mode with the timer off. Wikidata aliases can be noisy, and each prompt keeps up to 10.

## Working conventions

- Keep the game a **single self-contained HTML file** with no framework or build step beyond the Python injection. Python is stdlib only.
- The prompt wording, traps and hand aliases live in `P` in `src/template.html`. Edit them there; never hand-edit `data/curated.json`, which is generated.
- Commit messages are short and plain. Push to `main` deploys, and the site goes live about 2 minutes later.
- Before pushing a game change, run `node scripts/extract_curated.js && node scripts/check_answers.js --hand-only && python3 scripts/build_bank.py --mock` and play a round locally. Don't commit a mock `bank.js`, because `build_site.py` refuses to publish one anyway.
- Tone in the game: short, friendly road-trip lines, US spelling in the UI.
- Credit stays in the footer: "A US take on Boreen and Krillion". Don't use either game's name or visuals in marketing.
- Andy's sister site is `acotgreave/howtospeakdata-website` (Astro, also on GitHub Pages via Actions). Use its `deploy.yml` as the house pattern.

## Roadmap (agreed direction, not built yet)

1. **Crowd rarity (the long-term engine).** Page views are a proxy. The real Krillion/Boreen model tiers answers by how often players actually give them. The plan:
   - Add a small **Cloudflare Worker + D1** that logs each daily answer, with no personal data: an anonymous player id cookie and one daily run per player.
   - Run a nightly job that blends page-view tiers with crowd frequency, shifting toward the crowd as play counts grow.
   - Keep the static GitHub Pages site. The Worker is just an `/api` endpoint, so if it's down the game still works on page-view tiers.
2. **Reference implementation for (1):** [VulcanEon/openkrillion.com-service](https://github.com/VulcanEon/openkrillion.com-service) is MIT licensed, Cloudflare Worker + D1, last updated Oct 2026.
   - Borrow server code only, never its dive/ocean presentation (see "Design direction").
   - Worth borrowing: the schema (`runs`, `answers`, `rate_limits`), the one-daily-run-per-player unique index, the cookie and CSRF handling, rate limiting, and the D1 test setup with in-memory SQLite.
   - Keep its MIT notice in anything copied.
   - **Don't** use its "reference sync". It pulls krillion.io's daily prompts and tiers, which isn't ours to use and isn't US content anyway.
   - Note that it doesn't compute tiers from its own players; it only uses them for "better than X%". The crowd-tier blend in (1) is new work.
3. **More prompts.** Add whatever Wikidata can list cleanly: Supreme Court justices, Oscar Best Picture winners, interstate highways, US cities over 500k, Broadway musicals. Each needs a `WD` entry and a curated stub in `P`.
4. **Results page.** Add "how others answered" once crowd data exists.

## Scale notes

- The page is about 20 KB gzipped plus about 40 KB for the bank. GitHub Pages has a 100 GB/month soft limit, which is roughly 1.5M plays a month. If a spike gets close, put free Cloudflare in front.
- Wikimedia APIs are hit only by the weekly build, never by players. Keep the polite `User-Agent` in `build_bank.py`.
