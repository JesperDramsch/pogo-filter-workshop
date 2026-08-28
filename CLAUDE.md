# CLAUDE.md

Orientation and the one rule that is easy to break by accident.

## The repo in three lines

Vite + React 18 SPA, no TypeScript, no backend — everything is client-side and ships to GitHub
Pages. `src/App.jsx` is the monolith: all filter generation, the evaluator and most of the UI.
Tests are hand-rolled `scripts/check-*.mjs` run under `vite-node` via `npm run test:*`; there is
no vitest or jest.

## The rule: PvP species lists are data, never prose

**Any PvP species list — in a filter, a doc, a test, a commit message, or an answer to the user —
must derive from `src/data/pvp-rankings.json`, or from the reference generated out of it at
`skills/pokemon-go-filters/references/pvp-meta.json`.**

Naming a meta species from memory or from a tier-list article is a defect of exactly the same
kind as hardcoding a translated species name instead of calling `pokemonNameFor()`. The meta
moves every move rebalance; a list written down by hand is wrong within weeks and gives no
signal that it has gone wrong.

This is not hypothetical. The `pokemon-go-filters` skill carried a hand-maintained tier list
headed *"April 2026 … GBL Season 26"* whose entire Great League S-tier — Azumarill, Galarian
Stunfisk, Medicham — had fallen out of the live top 30 by August 2026, while the app, reading the
snapshot, was correct the whole time. That divergence is what this rule exists to prevent.

In practice:

- Building a filter → read the snapshot. `buildLeagueFilter` (`src/App.jsx`) already does; match it.
- Snapshot looks stale → `npm run fetch-pvp-rankings`. Never hand-patch the list.
- A species you believe is meta is missing → fix the fetcher, not the data file.
- Answering a question about the meta → quote the generated reference and its `fetchedAt`. If it
  is stale and cannot be refreshed, say so rather than falling back on remembered tiers.

Background and provenance: [`docs/gbl-collection-research.md`](docs/gbl-collection-research.md).
Source chain: PvPoke (MIT) → `scripts/fetch-pvp-rankings.mjs` → `src/data/pvp-rankings.json` →
the app *and* `scripts/generate-pvp-meta-reference.mjs` → the skill.

## Conventions worth knowing before you touch things

**Fetchers** (`scripts/fetch-*.mjs`) all share three properties. Keep them:
`--offline-ok` tolerates a failed fetch when a cache exists; `canonicalStringify` compares content
so `fetchedAt` is preserved when nothing changed (otherwise every sync is a churn commit); and an
empty or shrunken result refuses to overwrite the cache rather than publishing a hole.

**Game-master access goes through `scripts/lib/game-master.mjs`.** Six fetchers read the
same 19 MB Niantic dump. The mirror preference list (alexelgt primary, PokeMiners fallback —
the latter has stalled before), the batch stamp, the staleness warning, the batch-keyed download
cache and the shared species parsers live in that one file. Do not re-declare a mirror URL in a
fetcher, and do not add a new species-fact upstream before checking whether the game master
already publishes it — [`docs/upstream-sources.md`](docs/upstream-sources.md) is the inventory,
and it records what nine months of a silently-stale upstream cost.

**Fixtures vs property checks.** `src/__fixtures__/default-filter-output.json` pins *config-derived*
output only — filters that move when someone changes logic on purpose. Data-derived families
(raids, Rocket, PvP) are deliberately excluded and covered by property assertions in
`scripts/check-data-filters.mjs` instead. See the long comment in `scripts/lib/fixture.mjs`. Do not
pin daily-syncing data into a snapshot: it heals itself in the same job and nobody ever reviews it.

**Locale correctness.** Filter keywords come from `src/i18n/pogo-keywords.js` (`kw.iv.atk`,
`kw.numeric.cp`), species names from `pokemonNameFor()` over `src/locales/pokemon-names.json`.
A literal German keyword or species name in a clause is a bug in all seven locales.
