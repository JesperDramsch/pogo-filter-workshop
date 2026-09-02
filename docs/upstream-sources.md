# Upstream sources

Every snapshot in `src/data/` is derived, not hand-written. This page is the
inventory: which upstream supplies which fact, and — the part that turned out to
matter — how anyone would notice if one of them stopped moving.

## The current set

| Upstream | Supplies | Freshness signal |
|---|---|---|
| [alexelgt/game_masters](https://github.com/alexelgt/game_masters) | The Niantic game master: move mechanics, per-form types and stats, `evolutionBranch`, `pokemonClass`, temp-evolution (Mega/Primal) and Dynamax flags | `timestamp.json` → `batchId`, ms since epoch. Read on every fetch; a batch over 30 days old warns |
| [PokeMiners/game_masters](https://github.com/PokeMiners/game_masters) | The same dump, as fallback | `timestamp.txt`. Stalled at 2026-04-17 for at least 133 days — kept because a second source costs one request, never preferred |
| [pvpoke/pvpoke](https://github.com/pvpoke/pvpoke) (MIT) | PvP rankings, cup formats, the PvP move stream for the rebalance watch, and the per-species `released` / `shadoweligible` roster | `timestamp` field in `gamemaster.min.json`, rebuilt daily |
| [sora10pls/holoholo-text](https://github.com/sora10pls/holoholo-text) | Niantic's own localized text export: UI strings, move and species names, Rocket grunt dialogue, seven locales | Tracks the client release |
| [mknepprath/lily-dex-api](https://github.com/mknepprath/lily-dex-api) | Type chart, current raid-boss and Max-Battle rotation | Refreshes every 6h; the rotation itself is the signal |
| [bigfoott/ScrapedDuck](https://github.com/bigfoott/ScrapedDuck) | Events (GBL windows, raid days/hours, spotlight hours), Rocket lineups | Event windows are dated; a stopped feed shows as an empty lookahead |
| [zhenga8533/leak-duck](https://github.com/zhenga8533/leak-duck) | Event wild-spawn and egg pools for the tidy-up card | Event windows are dated, and the feed **drops an event the moment it ends** — the just-ended events on the card are carried forward from the previous snapshot by `scripts/lib/event-window.mjs`, never read from the feed |

Two facts are deliberately **not** fetched at all:

- **Generation boundaries** (`scripts/lib/generations.mjs`). A boundary is fixed
  the day a generation ships and never moves again. Pinning it costs one edit per
  new generation — and `scripts/check-friend-collect.mjs` fails if a named
  species falls outside the table, so the edit cannot be forgotten silently.
- **Trade-evolution and regional-polygon sets**, for the same reason: fixed game
  mechanics and hand-verified geography, neither of which any upstream publishes.

Access to the game master goes through `scripts/lib/game-master.mjs`, which owns
the mirror preference list, the batch stamp, the staleness warning and
provenance helpers, the shared species parsers, and a download cache keyed on the
batch id — six fetchers read the same 19 MB file, and `npm run prebuild` runs five
of them back to back.

## Retired: pogoapi.net (August 2026)

Four fetchers read [pogoapi.net](https://pogoapi.net/) for species metadata:
`fetch-species-meta` (rarity, generations, evolutions, stats, released),
`fetch-evolution-costs` (evolutions), `fetch-regional-forms` (types) and
`fetch-raid-bosses` (types, for resolving bosses named in event titles).

It had stopped publishing. Measured 2026-08-28 on the feeds this repo actually
read — `Last-Modified` is the only freshness signal it offers:

| feed | `Last-Modified` | age |
|---|---|---|
| `pokemon_stats.json` | 2025-11-11 | 290d |
| `pokemon_types.json` | 2025-11-11 | 290d |
| `pokemon_evolutions.json` | 2025-11-11 | 290d |
| `pokemon_rarity.json` | 2025-11-11 | 290d |
| `pokemon_generations.json` | 2025-11-11 | 290d |
| `released_pokemon.json` | 2026-01-31 | 209d |

Nothing was visibly broken, which is the point. `api_hashes.json` answered 200
and well-formed, so a reachability check passed; the hashes simply never changed.
`released_pokemon.json` was missing seventeen species Pokémon GO had released
(Mimikyu, Zeraora, the Blipbug, Silicobra, Arrokuda, Toxel, Sinistea,
Squawkabilly, Flittle, Orthworm and Flamigo lines), and Gimmighoul's Coin
requirement never appeared in `pokemon_evolutions.json` at all. A stale mirror
that answers 200 is worse than one that answers 500.

Everything it supplied is published first-hand by feeds already in the tree:

| pogoapi feed | replacement |
|---|---|
| `pokemon_stats` | game master `pokemonSettings.stats` |
| `pokemon_types` | game master `type` / `type2` |
| `pokemon_evolutions` | game master `evolutionBranch` |
| `pokemon_rarity` | game master `pokemonClass` |
| `released_pokemon` | PvPoke game master `released` flag |
| `pokemon_generations` | `scripts/lib/generations.mjs` (a pinned constant) |

Three things were learned in the migration and are worth keeping in mind before
touching this code:

**Evolution data is form-granular, and collapsing it is wrong in both
directions.** Galarian Zigzagoon evolves for 25 candy and only that form goes on
to Obstagoon for 100; the Kanto form costs 50 and stops at Linoone. Antique
Sinistea costs 400 candy where the Phony form costs 50. Merge a step onto its
dex pair and keep the cheapest, and Sinistea drops out of the candy-heavy pool;
keep the dearest, and you invent a 150-candy Zigzagoon line no player can walk.
`evolutionStepsFromGameMaster` therefore keys steps by form node, and
`scripts/check-game-master.mjs` pins both cases.

**Rarity was never a like-for-like swap.** pogoapi's rarity feed follows
main-series taxonomy, where Ultra Beasts are not Legendaries; the game's own
`pokemonClass` is what the Special-Trade rule keys off. The old two-source union
existed because of that mismatch. Measured on the migration the two agreed on all
111 species, so the union was contributing nothing but a stale upstream — the
Nihilego assertion in `fetch-species-meta.mjs` is the guard that stays.

**The mirror mattered more than the migration.** `fetch-species-meta` had the
PokeMiners URL hardcoded, and moving it onto the shared mirror-preferring fetch
picked up eight Mega-capable species the stalled mirror was missing (Raichu,
Starmie, Mewtwo, Skarmory, Chesnaught, Delphox, Greninja, Falinks) — 48 → 56 —
with no change to the parser at all. That half landed separately, ahead of this
migration; the point survives it. Which mirror answers is worth more scrutiny
than which parser reads it.

The migration itself changed almost nothing about the derived pools, which is
the result to want: `specialTradeDex` (111), `starterDex` (27), `powerLineDex`,
`megaDex` (56) and `evoParentByDex` (478 steps) all come out byte-identical to
what the pogoapi-fed version produced on the same day. The only differences
anywhere are `evolution-costs` gaining Gimmighoul, and species names in
`regional-forms.json` now being spelled the way this repo's own dictionary
spells them.
