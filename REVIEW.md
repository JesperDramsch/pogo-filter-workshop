# Review instructions

The "PR review" Routine reads this file from the base branch of every pull request to this repository. The contract in claude-tools [`coding/skills/review/SKILL.md`](https://github.com/JesperDramsch/claude-tools/blob/main/coding/skills/review/SKILL.md) sets what counts as a finding and the shape of the review; this file says what matters here. Keep it short: every line competes with the contract for the reviewer's attention.

## Important here

- A PvP species named from memory anywhere in the diff (a filter clause, a doc, a test, a commit message) instead of derived from `src/data/pvp-rankings.json` or `skills/pokemon-go-filters/references/pvp-meta.json`. [CLAUDE.md](CLAUDE.md) explains why this is the one rule.
- A literal keyword or species name in a filter clause instead of `kw.*` from `src/i18n/pogo-keywords.js` or `pokemonNameFor()`: a bug in every locale but the one it was typed in.
- A fetcher under `scripts/` that drops one of the three shared properties: `--offline-ok` tolerates a failed fetch when a cache exists, `canonicalStringify` keeps `fetchedAt` when nothing changed, and an empty or shrunken result never overwrites the cache. A mirror URL declared anywhere but `scripts/lib/game-master.mjs` is the same finding.
- A hand edit to a snapshot in `src/data/` or `src/locales/`: the daily [sync-data.yml](.github/workflows/sync-data.yml) overwrites it. The fix belongs in the fetcher.
- Data-derived output (raids, Rocket, PvP) pinned into `src/__fixtures__/default-filter-output.json`: the sync regenerates the snapshot, so the pin heals itself and tests nothing. Property checks in `scripts/check-data-filters.mjs` are where it goes.
- A change to `sync-data.yml` that lets a fetch fail without the run going red (the `OUTCOMES` check is the only alert), or that puts the app token anywhere but the push step.

## Leave alone

- Everything [test.yml](.github/workflows/test.yml) runs: actionlint with shellcheck over the workflows, every `npm run test:*` script and `npm run build`. Quote their output under Tests.
- Formatting, import order and naming: this repository has no linter or formatter, so style is at most a Nit.
- The size of `src/App.jsx`: it is the monolith on purpose.

## Checks

`npm ci`, then every `test:*` script in `package.json` in the order `test.yml` runs them, then `npm run build`. The `prebuild` step runs the fetchers with `--offline-ok`, so a sandbox without network still builds from the committed snapshots.
