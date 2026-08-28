# pogo.filter.workshop

Pokémon GO Suchstring-Generator. Hundo-aware Trash & Trade filters, regional map (KMZ-driven), Tausch-Buddies.

## Quickstart

```bash
npm install
npm run dev          # http://localhost:5173
```

## Build & deploy to GitHub Pages

### One-time setup

1. **Create the repo** on GitHub (e.g. `pogo-filter-workshop`) and push this code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin git@github.com:YOUR_USERNAME/pogo-filter-workshop.git
   git push -u origin main
   ```

2. **Update the base path** in `vite.config.js` to match your repo name:
   ```js
   base: "/pogo-filter-workshop/",
   ```
   - Repo at `github.com/jesper/pogo-filter-workshop` → `base: "/pogo-filter-workshop/"`
   - Custom domain or `username.github.io` repo → `base: "/"`

3. **Enable GitHub Pages**:
   - Repo → Settings → Pages
   - Source: **GitHub Actions**

### Deploy

Just push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes automatically.

```bash
git push
```

Site goes live at `https://YOUR_USERNAME.github.io/pogo-filter-workshop/` after ~1 minute.

### Manual deploy (alternative)

If you don't want the GitHub Action:
```bash
npm run deploy
```
This uses the `gh-pages` package to push `dist/` to a `gh-pages` branch. Set Pages source to "Deploy from branch" → `gh-pages` in repo settings.

## Stack

- **Vite** + React 18
- **Tailwind CSS** (JIT, scans JSX directly)
- **d3-geo** for map projection
- **lucide-react** for icons
- **localStorage** for state persistence (no backend, fully client-side)

## Data sources

Snapshots are refreshed by the scripts in `scripts/` (run on demand, also wired into `npm run prebuild --offline-ok` and the `.github/workflows/sync-*.yml` schedules).

- **Team GO Rocket lineups** from [bigfoott/ScrapedDuck](https://github.com/bigfoott/ScrapedDuck), which scrapes [LeekDuck.com](https://leekduck.com). Snapshot at `src/data/rocket-lineups.json`, refreshed by `npm run fetch-rocket-lineups`.
- **Team GO Rocket grunt quotes** (in-game pre-battle dialogue, all 7 supported locales) from [PokeMiners/pogo_assets](https://github.com/PokeMiners/pogo_assets) — Niantic's localized text exports. Snapshot at `src/data/rocket-grunt-quotes.json`, refreshed by `npm run fetch-rocket-grunt-quotes`.
- **PvP rankings (Great / Ultra / Master + GBL cups)** from [pvpoke/pvpoke](https://github.com/pvpoke/pvpoke) (MIT) — `rankings/{all,<cup>}/overall/rankings-{cp}.json`. PvPoke's ranking entries carry `speciesId` but no dex number, so the dex is joined from its `gamemaster.min.json`; cups are enumerated from that file's `formats[]` (the only place carrying the `{cup, cp, title}` triple) and paired with the GBL event windows from ScrapedDuck. Snapshot at `src/data/pvp-rankings.json`, refreshed by `npm run fetch-pvp-rankings`. lily-dex-api stays as the fallback, so an upstream reshape degrades instead of publishing a hole; `source` in the snapshot records which feed produced it.
- **Type chart, raid bosses, Max Battles** from [mknepprath/lily-dex-api](https://github.com/mknepprath/lily-dex-api). Snapshot at `src/data/raid-bosses.json`, refreshed by `npm run fetch-raid-bosses`. The Rocket-counter logic also pulls the type chart from here.
- **Move rebalance watch** — PvP-relevant move stats snapshotted from PvPoke's game master at `src/data/game-master-watch.json`, refreshed by `npm run fetch-game-master-watch`. Nothing imports it; it exists so a Trainer-Battle rebalance shows up as a commit naming which moves moved, days before it propagates into re-scored rankings. It also probes [PokeMiners/game_masters](https://github.com/PokeMiners/game_masters) with a single `HEAD` request per day and records the ETag — that mirror would be the earliest possible signal, but as of August 2026 it is ~4 months stale (still carrying the pre-Season-27 values for Earthquake, Drill Run, Flash Cannon and Earth Power), so it is recorded rather than trusted. PokeMiners carries no OSS licence, only an educational-use notice.
- **Species pools for the friend-collect packs** — snapshot at `src/data/species-meta.json`, refreshed by `npm run fetch-species-meta` and the daily `sync-species-meta` workflow. Provenance differs per pool: *special-trade classes* and *evolution parents* union the [PokeMiners game master](https://github.com/PokeMiners/game_masters) with [PoGoAPI.net](https://pogoapi.net/); *starters* and *power lines* are derived from PoGoAPI feeds alone (generations, evolutions, stats, released — minus the special-trade set); the *Mega-capable roster* comes from the game master alone, the only source that separates a Mega (`TEMP_EVOLUTION_MEGA`) from a Primal Reversion. A newly released Mega therefore joins the "Mega evolutions" pack without a code change.
- **Pokémon stats & moves** from [PoGoAPI.net](https://pogoapi.net/). Snapshot at `src/data/meta-rankings.json`, refreshed by `npm run fetch-meta-rankings`.
- **Translations & Pokémon names** (EN, DE, ES, FR, zh-TW, HI, JA — 1025+ species, moves, in-game UI strings) from a community-maintained [Google Sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vSQubiAFnRgCUp9BSJaCq0-XSGU0-x3LvOwzWdAj-JlrXsdkBWrGrlfmvFmGcbjUnCa5XFSnv4C1Nzs/pub). Snapshots at `src/locales/`, refreshed by `npm run fetch-translations`.
- **Regional polygons** from the community KMZ originally by u/zoglandboy / u/Mattman243 / pokemoncalendar.com (March 2022) plus manually-added Hawlucha (Mexico) and Stonjourner (UK) post-2022 regionals.
- **World topology** for the basemap fetched at runtime from `cdn.jsdelivr.net/npm/world-atlas` (with `unpkg.com` fallback).

- **Generated skill reference** at `skills/pokemon-go-filters/references/` — `META.md` and `pvp-meta.json`, produced by `npm run generate-pvp-meta-reference` in the same CI job that syncs the ranking snapshot, and consumed by the `pokemon-go-filters` Claude skill via its `refresh-meta.py`. Same shape as how the `pokemon-name-translate` skill pulls `src/locales/pokemon-names.json` from here: the repo is the endpoint. See [`skills/README.md`](skills/README.md).

## Data provenance

PvP species lists are data, never prose — see [`CLAUDE.md`](CLAUDE.md) for the rule and
[`docs/gbl-collection-research.md`](docs/gbl-collection-research.md) for the research behind it.
The chain is PvPoke → `src/data/pvp-rankings.json` → the app *and* the skill reference, so the two
cannot disagree about what the meta is.

## Privacy

100% client-side. No analytics, no API calls beyond the world topology basemap. All your data (hundos, buddies, home location, tagged Pokémon list) lives in your browser's localStorage.

## License

MIT or whatever you like — the regional polygon data is community-sourced and credit goes to the original KMZ authors.
