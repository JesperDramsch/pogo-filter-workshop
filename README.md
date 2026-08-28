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
- **Team GO Rocket grunt quotes** (in-game pre-battle dialogue, all 7 supported locales) from [sora10pls/holoholo-text](https://github.com/sora10pls/holoholo-text) — Niantic's own localized text export, `Release/` (the strings in the shipped client) rather than `Remote/` (server-pushed, may carry unreleased content). Snapshot at `src/data/rocket-grunt-quotes.json`, refreshed by `npm run fetch-rocket-grunt-quotes`. This moved off [PokeMiners/pogo_assets](https://github.com/PokeMiners/pogo_assets), whose `Texts/` directory last changed in August 2025 while the repo kept committing images daily — a frozen source that looks alive.
- **PvP rankings (Great / Ultra / Master + GBL cups)** from [pvpoke/pvpoke](https://github.com/pvpoke/pvpoke) (MIT) — `rankings/{all,<cup>}/overall/rankings-{cp}.json`. PvPoke's ranking entries carry `speciesId` but no dex number, so the dex is joined from its `gamemaster.min.json`; cups are enumerated from that file's `formats[]` (the only place carrying the `{cup, cp, title}` triple) and paired with the GBL event windows from ScrapedDuck. Snapshot at `src/data/pvp-rankings.json`, refreshed by `npm run fetch-pvp-rankings`. lily-dex-api stays as the fallback, so an upstream reshape degrades instead of publishing a hole; `source` in the snapshot records which feed produced it.
- **Type chart, raid bosses, Max Battles** from [mknepprath/lily-dex-api](https://github.com/mknepprath/lily-dex-api). Snapshot at `src/data/raid-bosses.json`, refreshed by `npm run fetch-raid-bosses`. The Rocket-counter logic also pulls the type chart from here.
- **Move rebalance watch** — two independent streams snapshotted at `src/data/game-master-watch.json`, refreshed by `npm run fetch-game-master-watch`. Nothing imports it; it exists so a rebalance shows up as a commit naming which moves moved, days before it propagates into re-scored rankings. **PvP** stats (`power`, `energy`, `energyGain`, `cooldown`, `turns`, buffs) come from [PvPoke's game master](https://github.com/pvpoke/pvpoke); **PvE** mechanics (`power`, `durationMs`, `energyDelta`, type) come from the Niantic game master via the mirror preference in `scripts/lib/game-master.mjs`, because PvPoke carries no PvE block at all. The two are kept separate — they key differently and answer different questions: the Season 27 rebalance changed 14 PvP move templates and not one PvE value. The PvE stream replaced a `HEAD`-only probe of [PokeMiners/game_masters](https://github.com/PokeMiners/game_masters), which as of August 2026 was ~4 months stale and could not fire. PokeMiners carries no OSS licence, only an educational-use notice.
- **Species pools for the friend-collect packs** — snapshot at `src/data/species-meta.json`, refreshed by `npm run fetch-species-meta` and the daily `sync-species-meta` workflow. Provenance differs per pool: *special-trade classes* and *evolution parents* union the Niantic game master (read through the mirror preference in `scripts/lib/game-master.mjs`) with [PoGoAPI.net](https://pogoapi.net/); *starters* and *power lines* are derived from PoGoAPI feeds alone (generations, evolutions, stats, released — minus the special-trade set); the *Mega-capable roster* comes from the game master alone, the only source that separates a Mega (`TEMP_EVOLUTION_MEGA`) from a Primal Reversion. A newly released Mega therefore joins the "Mega evolutions" pack without a code change. The snapshot's `sources` block records which mirror answered and its batch stamp.

  **PoGoAPI.net is the one upstream here that is not moving.** Audited 2026-08-28: every feed this repo reads from it carries `Last-Modified: 2025-11-11`, except `released_pokemon.json` at 2026-01-31, and it is missing 17 species that Pokémon GO has released since. Everything taken from it is now available from sources already in the tree — `pokemon_stats`/`pokemon_types`/`pokemon_evolutions`/`pokemon_rarity` from the game master, `released_pokemon` from PvPoke's `released` flag, `pokemon_generations` from dex ranges. Migrating off it is tracked separately and is not part of the change that introduced this note; the assertions in `scripts/fetch-species-meta.mjs` are what currently keep a stale feed from shipping a wrong pool.
- **Raid-attacker, Shadow-keeper and Max-Battle rankings** from the game master ([alexelgt](https://github.com/alexelgt/game_masters) primary, [PokeMiners](https://github.com/PokeMiners/game_masters) fallback) for mechanics, overlaid with [PvPoke](https://github.com/pvpoke/pvpoke) for the released/Shadow roster — see the provenance note below. Snapshot at `src/data/meta-rankings.json`, refreshed by `npm run fetch-meta-rankings` and the daily `sync-meta-rankings` workflow. `scripts/fetch-meta-rankings.mjs` simulates a raid against a generic tier-5 boss — cycle DPS from each species' real fast/charged moveset, mixed with the damage it survives long enough to deal — and takes the best few of every type. Three lists come out of it:
  - `topAttackers` seeds the raid-counter allowlist.
  - `shadowKeepers` seeds `shadowKeeperSpecies` (the "never purify" roster), scored with the Shadow multipliers the game master publishes (×1.2 attack, ×0.8333333 defence) and restricted to species that actually *have* a Shadow form. It drives the shadowSafe and Frustration-TM pro-tools **and** the fourth clause of the trash crypto floor, so a meta Shadow is never released even with blanket crypto protection off.
  - `topMaxAttackers` / `gigantamaxSpecies` come from the game master's own Dynamax flags — Niantic calls the mechanic "bread" internally, so `BREAD_MODE` marks a Dynamax-capable species and `BREAD_DOUGH_MODE` a Gigantamax one. A newly Dynamax-enabled species joins the list without a code change.

  Two sources, split by what each is good for. **Mechanics** — PvE move power, duration and energy, the live Shadow multipliers, and the Dynamax flags — come from the game master, the only feed that publishes them. It is read from [alexelgt/game_masters](https://github.com/alexelgt/game_masters), which republishes the Niantic dump every one to three days, with [PokeMiners](https://github.com/PokeMiners/game_masters) as fallback. PokeMiners is the better-known mirror but it stalls: it served a 2026-04-17 batch for at least 133 days. Measured 2026-08-28, that cost this pipeline 32 Dynamax-capable species and six new moves — additions, not changed values: the two batches agree on every PvE `moveSettings` field, because the Season 27 rebalance touched the PvP block only. (alexelgt is also, transitively, where DialgaDex's numbers come from — its resource repo regenerates from that file.) **The roster** — which species are released, and which have a Shadow form — comes from [PvPoke's game master](https://github.com/pvpoke/pvpoke), the same feed `fetch-pvp-rankings` and `fetch-game-master-watch` already read, so a stalled mechanics mirror can never silently shrink the species list. The fetcher warns when the winning mirror is over 30 days behind, and records which mirror answered plus both batch stamps in the snapshot's `sources` block.

  Keying species by dex number means every emitted name is read from this repo's own `pokemon-names.json` and therefore resolves by construction.
- **Translations & Pokémon names** (EN, DE, ES, FR, zh-TW, HI, JA — 1025+ species, moves, in-game UI strings) from [sora10pls/holoholo-text](https://github.com/sora10pls/holoholo-text) `Release/`, the same Niantic text export the grunt quotes come from. Snapshots at `src/locales/`, refreshed by `npm run fetch-translations`. Each bundle is ~42,000 keys and the app needs 115 of them, so `scripts/fetch-translations.mjs` selects: the `filter_key_*`, `filter_friend_key_*` and `pokemon_type_*` families wholesale — those *are* the in-game search-keyword vocabulary, so a keyword Niantic adds reaches the app on the next sync — plus a named list of individual labels the filter builder borrows, plus three keywords the game accepts verbatim in every client and therefore has no localized entry for. Values are emitted byte-for-byte as published (trimmed, never Unicode-normalised): a keyword that does not match the game's search box fails silently.

  This replaced a community-maintained Google Sheet. The sheet was accurate — every one of its 112 Niantic in-game values and all 371 of its move names matched Niantic's export exactly — but it was one volunteer between this app and the game, its Hindi column was legacy-font mojibake repaired here by a lookup table, and it carried two species that do not exist in Pokémon GO ("Mega Raichu X", "Mega Lucario Z").
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
