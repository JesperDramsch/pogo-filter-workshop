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
- **Type chart, PvP rankings, raid bosses, Max Battles** from [mknepprath/lily-dex-api](https://github.com/mknepprath/lily-dex-api). Snapshots at `src/data/{pvp-rankings,raid-bosses}.json`, refreshed by `npm run fetch-pvp-rankings` and `npm run fetch-raid-bosses`. The Rocket-counter logic also pulls the type chart from here.
- **Species pools for the friend-collect packs** — snapshot at `src/data/species-meta.json`, refreshed by `npm run fetch-species-meta` and the daily `sync-species-meta` workflow. Provenance differs per pool: *special-trade classes* and *evolution parents* union the [PokeMiners game master](https://github.com/PokeMiners/game_masters) with [PoGoAPI.net](https://pogoapi.net/); *starters* and *power lines* are derived from PoGoAPI feeds alone (generations, evolutions, stats, released — minus the special-trade set); the *Mega-capable roster* comes from the game master alone, the only source that separates a Mega (`TEMP_EVOLUTION_MEGA`) from a Primal Reversion. A newly released Mega therefore joins the "Mega evolutions" pack without a code change.
- **Raid-attacker, Shadow-keeper and Max-Battle rankings** from the [PokeMiners game master](https://github.com/PokeMiners/game_masters) alone. Snapshot at `src/data/meta-rankings.json`, refreshed by `npm run fetch-meta-rankings` and the daily `sync-meta-rankings` workflow. `scripts/fetch-meta-rankings.mjs` simulates a raid against a generic tier-5 boss — cycle DPS from each species' real fast/charged moveset, mixed with the damage it survives long enough to deal — and takes the best few of every type. Three lists come out of it:
  - `topAttackers` seeds the raid-counter allowlist.
  - `shadowKeepers` seeds `shadowKeeperSpecies` (the "never purify" roster), scored with the Shadow multipliers the game master publishes (×1.2 attack, ×0.8333333 defence) and restricted to species that actually *have* a Shadow form. It drives the shadowSafe and Frustration-TM pro-tools **and** the fourth clause of the trash crypto floor, so a meta Shadow is never released even with blanket crypto protection off.
  - `topMaxAttackers` / `gigantamaxSpecies` come from the game master's own Dynamax flags — Niantic calls the mechanic "bread" internally, so `BREAD_MODE` marks a Dynamax-capable species and `BREAD_DOUGH_MODE` a Gigantamax one. A newly Dynamax-enabled species joins the list without a code change.

  The game master is the only upstream here on purpose: it is the sole source carrying the live Shadow multipliers, the per-species Shadow flag and the Dynamax flags, and keying species by dex number means every emitted name is read from this repo's own `pokemon-names.json` and therefore resolves by construction.
- **Translations & Pokémon names** (EN, DE, ES, FR, zh-TW, HI, JA — 1025+ species, moves, in-game UI strings) from a community-maintained [Google Sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vSQubiAFnRgCUp9BSJaCq0-XSGU0-x3LvOwzWdAj-JlrXsdkBWrGrlfmvFmGcbjUnCa5XFSnv4C1Nzs/pub). Snapshots at `src/locales/`, refreshed by `npm run fetch-translations`.
- **Regional polygons** from the community KMZ originally by u/zoglandboy / u/Mattman243 / pokemoncalendar.com (March 2022) plus manually-added Hawlucha (Mexico) and Stonjourner (UK) post-2022 regionals.
- **World topology** for the basemap fetched at runtime from `cdn.jsdelivr.net/npm/world-atlas` (with `unpkg.com` fallback).

## Privacy

100% client-side. No analytics, no API calls beyond the world topology basemap. All your data (hundos, buddies, home location, tagged Pokémon list) lives in your browser's localStorage.

## License

MIT or whatever you like — the regional polygon data is community-sourced and credit goes to the original KMZ authors.
