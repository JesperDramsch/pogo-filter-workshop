# pogo.filter.workshop

A search-string builder for Pokémon GO. You tell it what you want to keep, and it writes the search strings you paste into the game: one to bulk-transfer the rest, one for trades, and a few dozen more for sorting, evolving, purifying, raids, Team GO Rocket and PvP.

**Open it at [pogo.amplt.de](https://pogo.amplt.de/).** It runs in the browser, installs as an app on your phone, and needs no account.

## The idea

The usual trash filter lists what to throw away, and it breaks as soon as your storage holds more than hundos and junk. This one works the other way round. You list everything you want to keep (favourites, shinies, hundos, trade evolutions, costumes, legacy moves, regionals you travelled for, PvP spreads, Pokémon tagged for a friend), and the trash filter is everything else.

A perfect-IV Pokémon is never in the trash. That rule comes out of the logic itself, so no combination of settings can switch it off by accident.

The in-app explainer walks through the whole thing in five short chapters, from "keep the high-IV ones" to the set algebra that turns a keep-list into a string the in-game search box can parse.

## How to use it

1. **Quick setup.** Swipe through "Toss or Keep?" cards, or start from a preset (Casual, Collector, Aggressive, PvP focus) and adjust from there.
2. **Where.** Set your home location on the map. Regionals that spawn near you drop out of protection, since you can catch more next week. Regionals from your travels stay protected.
3. **What.** Pick your protections: favourites, shinies, luckies, legendaries, mythicals, Ultra Beasts, shadows and purified, costumes, backgrounds, legacy moves, sizes, babies, Dynamax and Gigantamax, old buddies, lucky-trade candidates, and your own tags.
4. **Have.** List your hundos and luckies. Once you own a hundo of a family, the spare 3★s of that family become trade or trash material, except the ones with two perfect stats.
5. **Filter.** Copy a string and paste it into the Pokémon GO search bar. A counter shows how close you are to the game's 5,000-character limit.

Every string comes with the clauses it is built from and the reason each one is there. If you're not sure what a filter will do, the "check a Pokémon" tester takes a species, IVs and flags and tells you whether it would show up.

## What it generates

**Storage**

- **Trash:** everything outside your keep-list, safe to bulk-transfer.
- **Trade:** untraded, non-shadow, non-lucky Pokémon you can give away, plus pre-staged trades you tagged per trade buddy (`#auri`, `#julia`, ...).
- **Distant friends:** catches worth sending abroad, including your home regionals.
- **Sorting:** hundo families, lucky families, nundos (0/0/0) and a traded-trash review.

**Evolving and purifying**

- Pokédex++ (evolutions that add a new dex entry), cheap full-evolves for XP, EvoSwap for candy-heavy and item-gated lines, and Pokémon ready to Mega Evolve.
- Shadows: cheap purifies, safe purifies, purify-to-hundo candidates and Frustration-TM targets. Raid-relevant shadows are kept by default.

**Battle**

- **Raids and Max Battles:** counters for each current boss, sorted by tier, including event raids, plus a Max Battle charger filter.
- **Team GO Rocket:** per-phase counters for the leaders and Giovanni, counters for typed and generic grunts, and a lookup that tells you which grunt you're facing from (part of) their pre-battle quote.
- **PvP:** Great, Ultra and Master League meta filters and the active GBL cups, read from the latest PvPoke rankings.

**Events and friends**

- **Wild spawns:** for each running event, which Mega to have active for the best catch bonus, and filters to keep souvenirs and IV keepers, review what's left, and clear the rest.
- **Friend wishlists:** strings you hand to a friend so they can find what you're missing as a lucky or a hundo, with ready-made packs (trade evolutions, starters, Mega-capable species, PvP and raid picks, current egg pools).

## Languages

The interface and the generated strings work in English, German, Spanish, French, Traditional Chinese, Hindi and Japanese. Search keywords and species names come from Niantic's own text files, so a string pasted into a German client uses the German keywords and names the game expects.

## Privacy

Everything runs in your browser, with no analytics and no backend. The only network requests are the web fonts (Google Fonts) and the world-map outline (one TopoJSON file from jsDelivr, with unpkg as fallback). Your hundos, buddies, home location and tags live in your browser's local storage, and Settings → Backup & Restore exports them to a JSON file you can move to another device.

## Where the data comes from

Raid bosses, Rocket lineups, PvP rankings, events and translations change every week, so the app ships snapshots that the daily `.github/workflows/sync-data.yml` job refreshes. The scripts in `scripts/` do the fetching; you can also run them on demand, and `prebuild` runs them with `--offline-ok` so a build without network falls back to the cached snapshots. The list below says where each snapshot comes from, and why.

- **Team GO Rocket lineups** from [bigfoott/ScrapedDuck](https://github.com/bigfoott/ScrapedDuck), which scrapes [LeekDuck.com](https://leekduck.com). During a Team GO Rocket takeover the fetcher also reads [LeekDuck's lineup page](https://leekduck.com/rocket-lineups/) directly, at most once a day and only until it shows the new lineup, because ScrapedDuck's Rocket feed can silently freeze (see [`docs/upstream-sources.md`](docs/upstream-sources.md)); `source` in the snapshot records which one produced it. Snapshot at `src/data/rocket-lineups.json`, refreshed by `npm run fetch-rocket-lineups`.
- **Team GO Rocket grunt quotes** (in-game pre-battle dialogue, all 7 supported locales) from [sora10pls/holoholo-text](https://github.com/sora10pls/holoholo-text), Niantic's own localised text export. It reads `Release/` (the strings in the shipped client) and skips `Remote/` (server-pushed, may carry unreleased content). Snapshot at `src/data/rocket-grunt-quotes.json`, refreshed by `npm run fetch-rocket-grunt-quotes`. This moved off [PokeMiners/pogo_assets](https://github.com/PokeMiners/pogo_assets), whose `Texts/` directory last changed in August 2025 while the repo kept committing images daily: a frozen source that looks alive.
- **PvP rankings (Great / Ultra / Master + GBL cups)** from [pvpoke/pvpoke](https://github.com/pvpoke/pvpoke) (MIT), `rankings/{all,<cup>}/overall/rankings-{cp}.json`. PvPoke's ranking entries carry `speciesId` but no dex number, so the dex is joined from its `gamemaster.min.json`; cups are enumerated from that file's `formats[]` (the only place carrying the `{cup, cp, title}` triple) and paired with the GBL event windows from ScrapedDuck. Snapshot at `src/data/pvp-rankings.json`, refreshed by `npm run fetch-pvp-rankings`. lily-dex-api stays as the fallback, so an upstream reshape degrades the snapshot instead of publishing a hole; `source` in the snapshot records which feed produced it.
- **Type chart, raid bosses, Max Battles** from [mknepprath/lily-dex-api](https://github.com/mknepprath/lily-dex-api), with event raids and event Max Battles (Max Mondays, Max Battle Days) from [ScrapedDuck's event feed](https://github.com/bigfoott/ScrapedDuck). lily-dex-api's standing Max Battle list has been empty since June 2026, so the event ones are usually all the Max Battle panel has. Snapshot at `src/data/raid-bosses.json`, refreshed by `npm run fetch-raid-bosses`. The Rocket-counter logic also pulls the type chart from here. Raid-day/raid-hour and Max Battle events carry only a marketing title, so the bosses named in it are resolved against a species→type index built from the game master and this repo's own name dictionary.
- **Event wild spawns and egg pools** from [zhenga8533/leak-duck](https://github.com/zhenga8533/leak-duck), which scrapes LeekDuck's event pages. Snapshot at `src/data/events.json`, refreshed by `npm run fetch-events`. Each spawn's form and types are resolved against the game master, so the wild-spawn card can rank which Mega or Primal to have active: a Mega gives a catch bonus to every Pokémon sharing a type with it, and the card counts how many of the event's species each released Mega form covers (Mega types and the release roster come from `species-meta.json`). Spawn rates are not published anywhere, so every species counts once.
- **Move rebalance watch:** two independent streams snapshotted at `src/data/game-master-watch.json`, refreshed by `npm run fetch-game-master-watch`. Nothing imports it; it exists so a rebalance shows up as a commit naming which moves moved, days before it propagates into re-scored rankings. **PvP** stats (`power`, `energy`, `energyGain`, `cooldown`, `turns`, buffs) come from [PvPoke's game master](https://github.com/pvpoke/pvpoke); **PvE** mechanics (`power`, `durationMs`, `energyDelta`, type) come from the Niantic game master via the mirror preference in `scripts/lib/game-master.mjs`, because PvPoke carries no PvE block at all. The two are kept separate because they key differently and answer different questions: the Season 27 rebalance changed 14 PvP move templates and not one PvE value. The PvE stream replaced a `HEAD`-only probe of [PokeMiners/game_masters](https://github.com/PokeMiners/game_masters), which as of August 2026 was ~4 months stale and could not fire. PokeMiners carries no OSS licence, only an educational-use notice.
- **Species pools for the friend-collect packs:** snapshot at `src/data/species-meta.json`, refreshed by `npm run fetch-species-meta` and the daily `sync-data` workflow. *Special-trade classes* (`pokemonClass`), *evolution parents* and *chain candy costs*, per-form *base stats* and the *Mega-capable roster* all come from the game master; *release status* from [PvPoke's game master](https://github.com/pvpoke/pvpoke); *generation boundaries* are a pinned dex-range constant in `scripts/lib/generations.mjs`. The Mega roster is game-master-only because it is the one source that separates a Mega (`TEMP_EVOLUTION_MEGA`) from a Primal Reversion, so a newly released Mega joins the "Mega evolutions" pack without a code change. Until August 2026 most of this came from PoGoAPI.net; see [`docs/upstream-sources.md`](docs/upstream-sources.md) for why it no longer does.

  **PoGoAPI.net is gone from this repo as of August 2026.** Audited 2026-08-28: every feed read from it carried `Last-Modified: 2025-11-11`, except `released_pokemon.json` at 2026-01-31, and that one was missing 17 species Pokémon GO had released since, while `api_hashes.json` still answered 200 and well-formed, so nothing in the pipeline could tell. The four fetchers that read it (species pools, evolution costs, regional forms, raid-boss name resolution) now read the game master and PvPoke instead. [`docs/upstream-sources.md`](docs/upstream-sources.md) is the record.
- **Raid-attacker, Shadow-keeper and Max-Battle rankings** from the game master ([alexelgt](https://github.com/alexelgt/game_masters) primary, [PokeMiners](https://github.com/PokeMiners/game_masters) fallback) for mechanics, overlaid with [PvPoke](https://github.com/pvpoke/pvpoke) for the released/Shadow roster (see the provenance note below). Snapshot at `src/data/meta-rankings.json`, refreshed by `npm run fetch-meta-rankings` and the daily `sync-data` workflow. `scripts/fetch-meta-rankings.mjs` simulates a raid against a generic tier-5 boss (cycle DPS from each species' real fast/charged moveset, mixed with the damage it survives long enough to deal) and takes the best few of every type. Three lists come out of it:
  - `topAttackers` seeds the raid-counter allowlist.
  - `shadowKeepers` seeds `shadowKeeperSpecies` (the "never purify" roster), scored with the Shadow multipliers the game master publishes (×1.2 attack, ×0.8333333 defence) and restricted to species that actually *have* a Shadow form. It drives the shadowSafe and Frustration-TM pro-tools **and** the fourth clause of the trash crypto floor, so a meta Shadow is never released even with blanket crypto protection off.
  - `topMaxAttackers` / `gigantamaxSpecies` come from the game master's own Dynamax flags. Niantic calls the mechanic "bread" internally, so `BREAD_MODE` marks a Dynamax-capable species and `BREAD_DOUGH_MODE` a Gigantamax one. A newly Dynamax-enabled species joins the list without a code change.

  Two sources, split by what each is good for. **Mechanics** (PvE move power, duration and energy, the live Shadow multipliers, and the Dynamax flags) come from the game master, the only feed that publishes them. It is read from [alexelgt/game_masters](https://github.com/alexelgt/game_masters), which republishes the Niantic dump every one to three days, with [PokeMiners](https://github.com/PokeMiners/game_masters) as fallback. PokeMiners is the better-known mirror but it stalls: it served a 2026-04-17 batch for at least 133 days. Measured 2026-08-28, that cost this pipeline 32 Dynamax-capable species and six new moves. Those were additions, and no existing values changed: the two batches agree on every PvE `moveSettings` field, because the Season 27 rebalance touched the PvP block only. (alexelgt is also, transitively, where DialgaDex's numbers come from: its resource repo regenerates from that file.) **The roster** (which species are released, and which have a Shadow form) comes from [PvPoke's game master](https://github.com/pvpoke/pvpoke), the same feed `fetch-pvp-rankings` and `fetch-game-master-watch` already read, so a stalled mechanics mirror can never silently shrink the species list. The fetcher warns when the winning mirror is over 30 days behind, and records which mirror answered plus both batch stamps in the snapshot's `sources` block.

  Keying species by dex number means every emitted name is read from this repo's own `pokemon-names.json` and therefore resolves by construction.
- **Translations & Pokémon names** (EN, DE, ES, FR, zh-TW, HI, JA: 1025+ species, moves, in-game UI strings) from [sora10pls/holoholo-text](https://github.com/sora10pls/holoholo-text) `Release/`, the same Niantic text export the grunt quotes come from. Snapshots at `src/locales/`, refreshed by `npm run fetch-translations`. Each bundle is ~42,000 keys and the app needs 115 of them, so `scripts/fetch-translations.mjs` selects: the `filter_key_*`, `filter_friend_key_*` and `pokemon_type_*` families wholesale (those *are* the in-game search-keyword vocabulary, so a keyword Niantic adds reaches the app on the next sync), plus a named list of individual labels the filter builder borrows, plus three keywords the game accepts verbatim in every client and therefore has no localised entry for. Values are emitted byte-for-byte as published (trimmed, never Unicode-normalised): a keyword that does not match the game's search box fails silently.

  This replaced a community-maintained Google Sheet. The sheet was accurate (every one of its 112 Niantic in-game values and all 371 of its move names matched Niantic's export exactly), but it was one volunteer between this app and the game, its Hindi column was legacy-font mojibake repaired here by a lookup table, and it carried two species that do not exist in Pokémon GO ("Mega Raichu X", "Mega Lucario Z").
- **Regional forms** (which forms of a species differ by type, and the minimal has-type/lacks-type predicate that isolates each) derived from the game master's per-form `type`/`type2`. Snapshot at `src/data/regional-forms.json`, refreshed by `npm run fetch-regional-forms`.
- **Evolution costs** (candy-heavy and item-gated lines, for the EvoSwap cards) derived from the game master's `evolutionBranch`, at form granularity so a per-form cost like Antique Sinistea's 400 candy is not averaged away. Snapshot at `src/data/evolution-costs.json`, refreshed by `npm run fetch-evolution-costs`.
- **Regional polygons** from the community KMZ originally by u/zoglandboy / u/Mattman243 / pokemoncalendar.com (March 2022) plus manually-added Hawlucha (Mexico) and Stonjourner (UK) post-2022 regionals.
- **World topology** for the basemap fetched at runtime from `cdn.jsdelivr.net/npm/world-atlas` (with `unpkg.com` fallback).
- **Generated skill reference** at `skills/pokemon-go-filters/references/`: `META.md` and `pvp-meta.json`, produced by `npm run generate-pvp-meta-reference` in the same CI job that syncs the ranking snapshot, and consumed by the `pokemon-go-filters` Claude skill via its `refresh-meta.py`. Same shape as how the `pokemon-name-translate` skill pulls `src/locales/pokemon-names.json` from here: the repo is the endpoint. See [`skills/README.md`](skills/README.md).

## Running it locally

Needs Node 24 or newer.

```bash
npm install
npm run dev          # http://localhost:5173
```

The stack is Vite and React 19, Tailwind CSS 4 through `@tailwindcss/vite` (CSS-first config in `src/index.css`, no `tailwind.config.js`), d3 for the map projection, Motion for animation and lucide-react for icons. There is no backend and no TypeScript.

Tests are plain scripts in `scripts/check-*.mjs`, run with `vite-node` through `npm run test:<name>` (see `package.json` for the full list). `npm run test:fixtures` pins the output of the default configuration, and `npm run fixtures:update` regenerates it after an intentional change.

## Deploying your own copy

Pushing to `main` builds and publishes to GitHub Pages through `.github/workflows/deploy.yml`. To run a fork:

1. Fork the repo, then in Settings → Pages set the source to **GitHub Actions**.
2. Delete `public/CNAME` (it points at `pogo.amplt.de`) or replace it with your own domain.
3. Set `base` in `vite.config.js`: `"/"` for a custom domain or a `username.github.io` repo, `"/pogo-filter-workshop/"` (your repo name) for a project page.
4. Push to `main`. The site is live about a minute later.

If you'd rather not use the Action, `npm run deploy` builds and pushes `dist/` to a `gh-pages` branch with the `gh-pages` package; point Pages at that branch instead.

## Disclaimer

A fan project, not affiliated with Niantic, Nintendo or The Pokémon Company. Pokémon and Pokémon GO names, game data and in-game text belong to their respective owners.

## License

MIT or whatever you like. The regional polygon data is community-sourced, and credit goes to the original KMZ authors.
