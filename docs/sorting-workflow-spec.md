# Sorting workflow: piles and jobs

Status: implemented in PR #110 (milestones 1 to 9), 29 October 2026. Where the build settled a detail differently from this draft, the PR description lists it.

## Why

Pokémon storage fills up, and a full storage forces decisions under pressure. Two failure modes keep repeating:

1. **Blanket transfers.** When one category piles up (shadows during a takeover, XXL and XXS, event costumes), the quickest relief is to switch off its protection and run the trash filter. Everything in that category goes at once, including the last copies of a species and the copies that later Pokédex stages still need. Transfers are irreversible.
2. **Not knowing what matters.** Deciding whether a Pokémon is worth keeping needs current meta knowledge (raids, Max Battles, PvP, upcoming Megas and moves). Keeping up with videos and articles is a job in itself. Without that knowledge, fear of missing out turns into keeping everything, which turns into a full storage, which turns into a blanket transfer.

A third problem is invisible: each species has eight Pokédex columns per evolution stage (normal, shiny, hundo, lucky, XXL, XXS, shadow, purified). An entry counts once you've had it. `evolvenew` only checks the normal and Mega Pokédex ([Leidwesen SearchPhrases](https://leidwesen.github.io/SearchPhrases/): "Only considers direct evolutions with an unregistered entry in the main & mega pokedex"), so a shadow, lucky or XXL that still has to be evolved through never shows up in any search.

The workshop already has strong filters for all of this, but as a collection: sorting filters sit between raid and Rocket counters, and nothing tells the user where to start or how many to keep.

**Goal:** the user never needs outside knowledge or memory to decide what stays. The workshop brings the meta knowledge into the pile, and every kept Pokémon has a job.

## Core model

- **Job:** a reason for a Pokémon to stay, shown in-game by a tag or the favourite star.
- **No job:** transfer candidate.
- **Budget:** how many Pokémon a job holds per species (defaults below, editable in expert mode).
- **Pile:** a group of Pokémon sorted in one sitting (one category, or one event's spawns).
- **Keepers first:** in every pile, the user tags or stars the keepers, then transfers what is left of that same pile. A protection is never switched off to clear a category.

## Areas

The workshop splits by what the user is doing at that moment:

1. **Catching (out and about):** the field trash filter, unchanged. It is the lowest common denominator: safe to run on recent catches without thinking.
2. **Sorting (on the couch):** the guided piles described below.
3. **Battle:** raids, Max Battles, Team Rocket and PvP counters, unchanged in logic, moved out of the sorting area.
4. **Trade and friends:** wishlists, trade piles, buddy collecting, distant friends, unchanged in logic.

Nerd stuff (set theory, raw clauses, check a Pokémon) stays where it is.

## Sorting area

### Pile shape

Every pile has the same three steps. The event wild-spawn card already uses this shape for steps ① and ②.

| Step | What it shows | What the user does |
| --- | --- | --- |
| ① Keep | Lenses for this pile (for example shinies, costumes, backgrounds, high IV) | Tag or star the matches that have a job |
| ② Still to sort | The pile minus favourites and tagged (`pile & !favourite & !#`), with the pile card | Tag or star the remaining keepers |
| ③a Leftovers | The pile minus everything tagged, starred or always protected, minus the negation of every ① lens that has one (`pile & protection tail & !lens…`), so nothing a ① step would have kept is in it | Transfer the whole view; it is the visible transfer box |
| ③b Everything not starred or tagged | The pile minus everything tagged, starred or always protected (`pile & protection tail`), including what ① would have kept | Behind a reveal with an amber warning: open it after ① and ②, read the list, then transfer |

**Change from today:** step ③ of the wild-spawn card currently reuses the global trash filter. That filter only matches the lowest common denominator, which steps ① and ② have already handled, so step ③ always comes up empty. Step ③ must be pile-local: the same pile, with the protection tail instead of the trash filter.

### Protection tail

Hides everything that is always protected. Built from `src/i18n/pogo-keywords.js` tokens like every other clause; the German forms below are for reading only.

The tail is one fixed string per pile. It reads exactly two settings, protect nundos and the mythicals you have too many of (`protectNundos`, `mythTooManyOf`), plus the value of the lucky-trade year floor. Every other trash toggle (buddies, legacy moves, the Smeargle exception, shinies and the rest) leaves it as it is: switching a protection off to clear a category is what steps ① and ② replace.

| Protected | German form |
| --- | --- |
| Favourites | `!favorit` |
| Any tag | `!#` |
| Hundos | `!4*` |
| Nundos (0/0/0), only when protect nundos is on | `1-4angriffs-wert,1-4verteidigungs-wert,1-4kp` (one clause; PoGo ignores `!N` on IV tokens, so the positive form) |
| Guaranteed lucky-trade stock (existing year-floor setting, currently caught in 2020 or earlier) | `jahr21-,getauscht` (a traded one can't be traded again, so it is no stock) |
| Invested Dynamax | `!dynaattacke2-&!dynawall1-&!dynakampfgeist1-` |
| Buddies at Good level or higher | `!kumpel2-` |
| Mythicals, except the ones you have too many of | `!mysteriös`, or `!mysteriös,darkrai` with a carve (the same clause the trash emits; a listed species is a spare and shows in ③) |
| Shiny legendaries | `!schillernd,!legendär` (one clause) |
| Legendaries with a background | `!hintergrund,!legendär` (one clause) |
| Legacy moves | `!@spezial,@rückkehr,@frustration,farbeagle` (one clause, the trash's shape: a purified Return, a shadow's Frustration and a Smeargle, whose Sketched moves all carry the flag, are not legacy; Smeargle via `pokemonNameFor('235')`) |

The range-negation forms are deliberate: `!dynawall1-` matches a Pokémon with no Wall value at all, which is the wanted direction (see the range-versus-negation note in the filter skill).

**Property check** (`scripts/check-piles.mjs` P3, `scripts/check-data-filters.mjs` D18, cases in `scripts/lib/pile-cases.mjs`): step ③ of every pile never matches a Pokémon that is starred, tagged, a hundo, a nundo (when protected), inside the year floor, invested Dynamax, a Good buddy, mythical (unless carved out), carrying a legacy move, a shiny legendary or a legendary with a background; it runs under the default config and under one with nundos protected and a mythical carved out. A further section holds the tail to those two settings: flipping any other trash toggle changes nothing.

### Pile card

Shown in step ②. Per species in the pile:

- **Class:** meta, watchlist or non-meta, with the reason in words ("top 7 Fire raid attacker", "shadow keeper", "Great League rank 12", "Mega datamined").
- **Keep:** the budget per job for that species ("keep up to 6 for raids, 1 normal and 1 shadow for Great League, best 1 until a hundo").
- **Why:** one line explaining the number.

The workshop never sees the user's storage, so the card says "keep up to N", never "you have M".

### Which piles show first

Piles relevant to recent or running events float to the top. All other piles sit collapsed underneath and can be hidden.

| Event kind | Piles that float up |
| --- | --- |
| Event with wild spawns, just ended | Event spawns, costumes (if costumed spawns), backgrounds |
| Community Day | Community Day backgrounds, shinies |
| Team GO Rocket takeover | Shadows |
| Max Monday or Max Battle event | Dynamax |
| Double transfer candy day | A reminder card for the `crush` working tag (not a pile) |

Hiding is stateful and edge-triggered. `config.hiddenPiles` is the user's own list, edited under "N hidden" on the Sorting tab. A protection on the Catching tab edits that list once, on its on/off edge, wherever the change comes from (the swipe deck, a ConfigPanel toggle or a preset): turning a category's protection off adds its piles to the list, turning it back on removes them. Between edges the list is the truth: a pile the user brought back stays visible until the protection goes on and then off again, and a toggle never gates the render. Loading, importing, the cross-tab echo and reset write the config as it is and never re-hide. A pile that floats for a running event shows while it floats, hidden or not.

| Protection | Piles it hides and shows |
| --- | --- |
| XXL | XXL |
| XXS | XXS |
| Costumes | Costumes (both) |
| Backgrounds | Community Day backgrounds |
| Luckies | Luckies |
| Shinies | Shinies |
| Shadows | Shadows |
| Dynamax | Dynamax |
| Legendaries and Ultra Beasts | Legendaries, hidden on the edge that leaves both off, shown when either comes back on |

Piles without a category (Meta, Watchlist, Non-meta, Hundo sort, Received trades, the event piles, Evolve) are never touched by a protection. Nundos have no pile. The rule lives in `hiddenPileTransitions` and `withPileTransitions` (`src/App.jsx`) and is held by `scripts/check-piles.mjs`, "Protection toggles hide and show piles".

### Piles

| Pile | Pile head | ① Keep lenses | Notes |
| --- | --- | --- | --- |
| Event spawns | Event families (exists) | Souvenirs, high IV (exists) | Step ③ becomes pile-local |
| Hundo sort | Hundo families (exists) | Hundos | The stand-in loses its job once a hundo exists |
| Meta | Species on any meta list | Raid, Max and PvP keepers | Pile card shows the list and rank |
| Watchlist | Species on the watchlist | Shadows, best IV | Lower priority than meta |
| Non-meta | Everything else | Collection, stand-in | The big one |
| Shadows | Shadow | Purify-to-hundo candidates, Charge-TM'd, cheap purify stock | Never cleared by switching off shadow protection |
| Received trades | Traded | Souvenirs, luckies | Received Pokémon can't be traded again, so they are never tradebait |
| Luckies | Lucky | Best per species | |
| Dynamax | Dynamax-capable (`dynaattacke1-`, never the `dynamax` keyword) | Build candidates, parkers | `dynamax` is a search shortcut that silently drops the rest of the string |
| XXL | XXL | Showcase candidates | Score calculator (see below). Warning: the biggest XXL does not always score highest |
| XXS | XXS | Evolve | XXS only matter for Pokédex entries |
| Costumes | Costume | One per stage, shinies | |
| Community Day backgrounds | Background, Community Day species, not location background | 3 per species | |
| Shinies | Shiny | Hundos, high IV, PvP, still to evolve | One per evolution stage for the living shiny dex, plus untraded ones to trade. Plain shinies are not in the protection tail, so ③ offers them; floats with the Community Day piles |

`crush` is a working tag, not a pile: it marks Pokémon (often legendaries) to transfer on the next double transfer candy day. It protects them until then, like any tag.

### Budgets (defaults)

All numbers are editable in expert mode. Simple mode uses these defaults.

| Job | Budget | Why |
| --- | --- | --- |
| Evolve | 1 per missing column per evolution branch; 2 for a shadow line | One specimen evolved through registers every stage. Shadow lines need a second one, purified at the base stage, for the purified column. |
| Stand-in | Best IV per species until a hundo exists | Covers the hundo column's job until the hundo arrives |
| Shadow stand-in | Best 2 per species until better ones turn up (more if meta) | Shadows have higher IV variance. The same two cover the shadow and purified dex entries. |
| Raid, meta | Up to 6 per species | A full raid team |
| Raid, watchlist | 3 shadows, 1 normal per species | Enough to build if a Mega or move lands. Shadows only return with Rocket rotations, normals return through raids and spawns. |
| PvP | 1 normal and 1 shadow per species in the Great League or active cup top 30 | Great League and its cups share the 1,500 CP cap, so one copy covers both. A second copy only matters for Ultra League. |
| PvP, off-meta | 1 per species with the strict pattern (0 attack, 15 defence, 15 HP) | Cups bring off-meta species into play |
| Shinies | 1 per evolution stage (living shiny dex), plus 3 tradeable | |
| Costumes | 1 per costume per evolution stage, plus 3 tradeable | |
| Backgrounds | 1 per species and background, plus 3 tradeable | |
| Community Day backgrounds | 3 per species | Nobody asks for them in trades |
| Luckies | 1 per species and form, plus any lucky that holds another job | Luckies from lucky-trade farming pile up |
| XXL | Every XXL above a score threshold (default 1,000); the rest only via Evolve | Showcases allow several entries a week across types |
| XXS | Only via Evolve | |
| Dynamax builds | 1 per good species, up to 3 for the top ones | Max Particles are scarce |
| Dynamax parkers | 35 | Dynamax left at Power Spots to collect candy. About 30 out at once at most, plus 5 spare. IVs don't matter. |
| Cheap purify stock | 23 cheap shadows (1 km candy species) | Takeover research asks for purifies (the January 2026 takeover: 2 and 5 in special research, plus repeatable "Purify 3" field tasks) |
| Tradebait | Never shadows, luckies, received trades or mythicals | None of these can be traded (again) |

### Meta and watchlist

Per the rule in `CLAUDE.md`, every list is derived from data, never written by hand.

- **Meta:** `src/data/meta-rankings.json` (`topAttackers`, top 7 per type; `shadowKeepers`, top 7 per type; `topMaxAttackers`, the same top-7 cut over Dynamax-capable species) and `src/data/pvp-rankings.json` (Great League and active cups, top 30).
- **Watchlist**, in priority order:
  1. Species with an announced or datamined Mega, including Megas that come with a plus move.
  2. Species that gained a new or changed move (`src/data/game-master-watch.json` history).
  3. Rank 8 to 15 per type in the raid ranking model (lower priority).
- **Non-meta:** everything else.

### XXL score calculator

An approximate calculator inside the XXL pile. Inputs: species, height, weight, the three IVs. Output: a score range (the game rounds height and weight).

Formula ([Pokémon GO Hub, July 2023](https://pokemongohub.net/post/research/showcase-scores-xxs-and-xxl-pokemon-and-how-it-works/)):

```
score = 800 × scaled height + 150 × scaled weight + 50 × (IV sum / 45)
scaled height = (height / species mean height) / class height max (1.55, 1.75 or 2.00)
scaled weight = (weight / species mean weight) / class weight max (2.05, 2.25 or 2.50)
```

[PokémonDB](https://pokemondb.net/go/showcases) adds: an XXL gets a bonus of 178 points, a single-species showcase maxes out at 1,178, and since September 2024 type showcases score each Pokémon relative to its own species. Their formulas for types that have not had a showcase yet are estimates; say so in the UI.

### Tagging scheme

A suggested set of job tags for new users, shown in onboarding and in the sorting area. Users can rename them. A tag must never share its name with a search keyword (for example `shiny`), or searching it also returns every real shiny.

| Job | Suggested tag | Jesper's tag |
| --- | --- | --- |
| Waiting to evolve through for Pokédex entries | `Evolve` | `Evolve` |
| Tradebait | `Trade` | `Tausch-Basar` |
| Promised to a person | `Trade-<Name>` (existing trade-buddy prefix) | `Tausch-<Name>`, `Fern-Tausch` |
| Great League and cups | `PvP` | `Kolosseum` |
| Raid and Max attackers | `Raid` | `PvE-*` |
| Showcase candidates and winners | `Show` | `Showstar` |
| Special Pokémon from friends or occasions | `Souvenir` | `Souvenirs` |
| Exceptional shadows | `ShadowKeep` | `Cryptlysium` |
| Dynamax parked at Power Spots | `Parker` | not chosen yet |
| Working tag: transfer on the next double transfer candy day | `Crush` | `crush` |

Every tag is a job. `Evolve` and `Crush` are temporary: `Evolve` comes off once the line is evolved through, `Crush` empties on a candy day.

### Expert mode

The existing `expertMode` flag decides visibility. Simple mode shows the piles with default budgets and no budget editing. Expert mode shows the budget table as editable numbers and the protection toggles. The swipe onboarding stays as it is.

## Unchanged

- The field trash filter and its protections, including the shadow, XXL and XXS toggles.
- The logic of the battle, Rocket, PvP and trade filters (they only move to their area).

## Open items for implementation

Check each against `docs/upstream-sources.md` before adding a new upstream.

1. **Event kinds:** `src/data/events.json` currently holds wild-spawn events only (`Event`, `City Safari`). Community Day, takeovers and double transfer candy days need a source. `src/data/raid-bosses.json` already has `eventRaids` and `eventMaxBattles`.
2. **Community Day species list** for the Community Day background pile.
3. **Datamined Megas:** compare Mega forms in the game master with the released list (`species-meta.json` `megaDex`).
4. **Ranks 8 to 15:** `meta-rankings.json` stores only the top N per type; the watchlist needs ranks up to 15.
5. **Moves to species:** `game-master-watch.json` tracks moves, not which species learn them. The watchlist needs that mapping.
6. **XXL calculator data:** species mean height and weight, and the size class per species, from the game master. Verify the fields exist in `scripts/lib/game-master.mjs`.
7. **Budget storage:** where expert-mode budgets live in the config, and how the pile card reads them.
