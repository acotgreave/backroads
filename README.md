# Backroads

A US road-trip take on Boreen / Krillion. Seven prompts a day; the rarer your right answer, the further you drive.
Live at **https://backroads.howtospeakdata.com**. Static site on GitHub Pages; no server, no database.

## How the questions are built

Every Monday (and on every push) `.github/workflows/deploy.yml`:

1. `scripts/extract_curated.js` reads the hand-written prompts, answers, aliases and "nice try" traps from `src/template.html`.
2. `scripts/build_bank.py` pulls full answer lists from **Wikidata** for 14 prompts (states, capitals, national parks, presidents, Declaration signers, NFL/MLB/NBA, rivers, Simpsons/Friends/Sesame Street, dog breeds, car makers, airlines), merges in the hand answers, then scores every answer from **24 months of Wikipedia page views**.
3. The result is committed to `data/bank.js` (plus `data/report.csv` for checking), baked into the page, and deployed.

If Wikidata or the page-view API is down, the build keeps last week's `data/bank.js`. A prompt whose Wikidata query returns too few results falls back to the hand list.

**Rarity rule:** for each answer, add up the page-view share of the answers in that prompt that are *more* viewed. Under 25% = 10 mi, under 50% = 25, under 70% = 40, under 85% = 60, under 95% = 80, otherwise 100. The median month is used, so one viral month can't make an answer "common". "American words" keeps hand-set tiers.

## Everyday edits

| To change… | Edit |
|---|---|
| A prompt's wording, answers, aliases or traps | the `P` list in `src/template.html` |
| Which prompts come from Wikidata, or a query | `WD` in `scripts/build_bank.py` |
| An answer that lands on the wrong Wikipedia page | `TITLES` in `scripts/build_bank.py` |

Commit to `main` and the site rebuilds in about two minutes. Force a refresh from **Actions → Build questions and deploy → Run workflow**.

## Run locally

    node scripts/extract_curated.js
    node scripts/check_answers.js        # alias clashes, answers that score as the wrong answer
    python3 scripts/build_bank.py        # --mock for an offline dry run; --only states,parks for a quick test
    python3 scripts/build_site.py        # writes dist/index.html
