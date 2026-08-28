# Pokémon GO PvP "Keep This" Analysis: Great and Ultra League, Late August 2026

> **Editor's note.** Research doc written by Jesper, late August 2026. Committed verbatim as
> the provenance record behind the repo's PvP data pipeline. See `../CLAUDE.md` for the rule it
> justifies, and the **Corrections** block at the end of this file for claims that did not
> survive verification against the raw feeds.

## TL;DR
- The current ranking snapshot (PvPoke via Dittobase, updated 24 August 2026) puts Mimikyu and Lickilicky at the very top of both Great and Ultra League; the single biggest recent shift is that Mimikyu became GBL-legal only on 23 June 2026 with the new PvP battle system, so if you have a low-attack Mimikyu, keep it. The season is Forever Forward (Season 27, 2 June to 8 September 2026), and the late-August rotation (25 August to 1 September) is plain Great/Ultra/Master with no type-restricted cup.
- For automation, the best single starting point is the PvPoke GitHub repo (MIT-licensed): poll the raw rankings JSON for 1500 and 2500, plus gamemaster.json. Back it with PokeMiners game_masters latest.json (for pre-announcement move/stat rebalances) and pogoapi.net's api_hashes.json for cheap change detection. Use timestamp/hash files rather than blind polling, because unauthenticated GitHub raw requests are capped at 60 requests per hour per IP.
- Keep low-attack, high-bulk copies of meta staples that either need XL candy, depend on a legacy/unavailable move, or are pre-evolutions of not-yet-released or hard-to-build species. Mythicals and box legendaries are banned from Play! Pokémon tournaments but are legal in casual GBL, so the "keep" decision differs depending on whether you play tournaments.

## Key Findings

### Current meta state (dated)
- Season 27, "Forever Forward", runs 2 June to 8 September 2026 (Pokémon GO Wiki/Fandom; pokemongo.com news).
- The rebuilt PvP battle system rolled out 23 June 2026. It moved battle resolution server-side and, critically, made Mimikyu eligible in GBL for the first time (pokemongo.com "Trainer Battle Update", 23 June 2026). Mimikyu is excluded from the Competitors Cup, the legacy-system format used for the 2026 World Championships, which ends 30 August 2026.
- Late-August rotation: Great, Ultra and Master League run together from 25 August to 1 September 2026, with 4x Stardust from win rewards; all Pokémon eligible, no type cup (LeekDuck; buffhub 2026 PvP tier list; theclick.gg). The following week (1 to 8 September) is also Great/Ultra/Master. From 1 September, Master League: Mega Edition and Great/Ultra Mega Editions begin.
- Ranking snapshot: PvPoke-derived, as surfaced by Dittobase "updated Aug 24, 2026". Great League top 16: Lickilicky #1 (93.7), Tinkaton #2, Altaria #3, Empoleon #4, Mimikyu #5, then Shadow Altaria, Shadow Empoleon, Shadow Quagsire, Quagsire, Jellicent, Forretress, Ninetales, Cramorant, Shadow Ninetales, Feraligatr, Shadow Forretress. Note: Pokémon GO Hub's database and buffhub instead show Mimikyu #1 in both Great and Ultra; the two differ because of how each treats Mimikyu's optimal IVs and scoring date. I flag this as an unresolved discrepancy between snapshots taken within the same week.
- Ultra League: Mimikyu and Lickilicky lead; Corviknight is called the standout safe-swap (resists all but two types with Sand Attack/Air Cutter/Payback), per buffhub and ldshop.gg tier writeups dated 2026.

### Season 27 move rebalance (relevant to what to keep)
From the GBL Season 27 rebalance (Pokémon GO Hub analysis by JRE47, 31 May 2026; changes live 2 June 2026 at 1:00 p.m. PDT per the Fandom Season 27 page):
- Earthquake: "Power increased from 110 to 120 in Trainer Battles." This buffs Earthquake users, notably Galarian Stunfisk and Steelix.
- Drill Run: "Power decreased from 80 to 70 and energy cost decreased from 45 to 40 in Trainer Battles." Now added to Rhyperior.
- Earth Power: energy cost decreased.
- Flash Cannon: "Energy cost decreased from 70 to 65 in Trainer Battles."

### Bucket A: Prohibited / restricted right now

**A1. Restricted in the current GBL season formats**
- No species ban applies to the plain Great/Ultra rotation live in late August 2026 (all Pokémon eligible under the CP cap). Species/type bans apply only inside cups, and no cup is live in the 25 August to 1 September week.
- Mimikyu is barred specifically from the Competitors Cup (the legacy-system format for Worlds), through 30 August 2026, even though it is legal in normal GBL. If you play Competitors Cup you cannot use it there.
- Earlier Season 27 cups had their own type bans (for example the NAIC 2026 Cup: only Fairy/Normal/Psychic/Water, with Dark/Grass/Steel banned). These are historical for late August and only matter if a similar cup returns.

**A2. Play! Pokémon (tournament) banned list**
Per the official Play! Pokémon Pokémon GO Championship Series Banned Pokémon List (pokemon.com), the following are prohibited in sanctioned tournaments (Great League format). Where marked with *, the Shadow variant is still permitted:
- Zacian (all forms), Zamazenta (all forms), Enamorus (Incarnate and Therian), Groudon*, Kyogre*, Dialga* and Dialga Origin Forme, Palkia* and Palkia Origin Forme, Thundurus (Incarnate* and Therian), Tornadus (Incarnate* and Therian), Mewtwo*, Xerneas, Yveltal, Volcanion, Ditto, Shedinja, Mudbray, Mudsdale.
- Shadow-only bans: Ponyta-Shadow, Rapidash-Shadow, Kabuto-Shadow, Kabutops-Shadow. Purified-only: Giratina Altered Forme-Purified.
- Move-specific bans: Grimer/Muk/Koffing/Weezing with Acid; Chansey with Psybeam; Staryu/Starmie/Porygon/Pichu with Quick Attack.
- The Tournament Handbook (last revised 21 May 2026) also caps Best Buddy CP-boosted Pokémon at one per team and forbids Mega/Primal Pokémon in the Great League tournament format.
- Interpretation: mythicals and box legendaries are banned from tournaments but perfectly legal in casual GBL Ultra League (for example, Cresselia is a top Ultra pick and is not on this list). Keep tournament legality separate from GBL viability.

**A3. Strong but currently unobtainable or hard to obtain / legacy-move dependent**
- Legacy/Elite-TM-dependent picks: many staples need a move that is not in the current level-up or event pool and can only be applied via an Elite TM. Examples documented over multiple seasons: Registeel wants Zap Cannon (Elite/legacy), Swampert wants Hydro Cannon (Community Day legacy), Poliwrath benefits from Icy Wind, Sableye historically wanted Return (Purified). If your copy already has the legacy move, keep it; you cannot re-apply that move without an Elite TM while the move is not currently event-available. This is the single most important "do not transfer" filter: viability is often move-gated, not species-gated.
- Regional / limited encounters: bulky meta picks that are hard to farm for XL (Jellicent is a rare spawn; Trevenant needs 200 candy plus rare Phantump; Cresselia is legendary-raid-locked).

**A4. XL-candy long-term holds**
XL candy turns these into multi-month projects, so keep good-IV copies as you find them:
- Great League: Lickilicky/Lickitung (near-nonexistent in the wild, flagged as a top XL candidate by GO Hub), Carbink, Bastiodon, Lanturn, Trevenant, and Cresselia (Ultra).
- Ultra League specifically: Jellicent, Registeel, Poliwrath, Cresselia are all flagged as prime Rare Candy XL sinks (sportskeeda 2026 and prior), because they need to be pushed toward level 45 to 50 to reach 2500 CP with good bulk.

### Bucket B: Speculated to be good in future

**Confirmed via datamine/official:**
- Move rebalance already live (Season 27): Galarian Stunfisk and Steelix are the concrete winners of the Earthquake buff; Rhyperior gained Drill Run. Per the Pokémon GO Hub database, Galarian Stunfisk currently ranks 71 of 1143 in Great League with Mud Shot, Rock Slide and Earthquake, rank-1 IVs 0/13/14 at level 27 and 1499 CP. JRE47's Season 27 analysis argued the Earthquake buff pushes it back to roughly a 60% Great League win rate; I could not verify that specific win-rate figure against a second dated source, so treat it as one analyst's simulation estimate rather than established fact.
- Mimikyu's eligibility is confirmed and already in effect.

**Community speculation (treat as opinion, not fact):**
- Analysts (GO Hub's XL-candy guide) previously flagged Trevenant as likely to outclass Cofagrigus before release; that has since borne out, but the same "hold the pre-evolution" logic applies to any newly datamined evolution.
- The general PvP-analyst consensus in the 2026 tier writeups (ldshop.gg, buffhub) is to finish existing builds rather than chase new #1s, and to bank low-attack copies of anything sitting just below the CP cap.

**Pre-evolutions to keep now:** if an evolution is not yet in the game, hold the best-IV pre-evolution. I could not verify a specific list of not-yet-released PvP-relevant evolutions from a current dated source, so I am not inventing one; check the PokeMiners game master for unreleased forms.

### Bucket C: Keep criteria per Pokémon

General rule for Great and Ultra League: prefer low Attack, high Defence and HP, to maximise stat product under the CP cap. Some low-base-stat Pokémon that max out below the cap (Medicham, Sableye) instead want high Attack. Specific rank-1 IV spreads I could verify from dated sources:
- **Lickilicky (Great):** rank-1 IVs 0/12/14 at level 23.5, 1500 CP; moves Rollout + Body Slam and Shadow Ball. Ultra: 0/14/15 at level 48.5 (near-max, XL). (Pokémon GO Hub DB.)
- **Mimikyu (Great):** rank-1 IVs 1/14/15 at level 25.5, 1499 CP; Shadow Claw + Shadow Sneak and Play Rough. (Pokémon GO Hub DB.) Ultra needs powering to near level 50, so it is an XL/high-investment build.
- **Quagsire (Great):** 0/15/14, no XL required; Mud Shot + Aqua Tail and Mud Bomb (sportskeeda). Shadow Quagsire ranks just above non-shadow, so Shadow is preferred if you have one with good IVs.
- **Cresselia (Ultra):** 2/13/15, no XL required; Psycho Cut + Moonblast and Grass Knot (sportskeeda).
- **Lanturn (Great):** 0/13/14, no XL; Spark + Surf/Thunderbolt.
- **Poliwrath (Ultra):** 0/14/14, XL recommended not required; Counter + Icy Wind and Scald.
- **Registeel (Ultra):** best IVs cited 1/10/15, XL recommended; wants Zap Cannon (Elite TM candidate).
- **Galarian Stunfisk (Great):** 0/13/14 at level 27, 1499 CP; Mud Shot + Rock Slide and Earthquake (Pokémon GO Hub DB).

Shadow vs non-shadow: Shadow forms (Altaria, Empoleon, Quagsire, Ninetales, Forretress) rank near their non-shadow versions and should be treated as separate builds; keep both if you have good IVs, since Shadow adds damage but removes bulk. For the exact rank-1 spread per species, use a PvP IV checker rather than a blanket spread; the numbers above are the ones I could confirm.

### Naming (English primary, verified German)
Verified from PokéWiki (pokewiki.de):
- Mimikyu = **Mimigma** (Ghost/Fairy).
- Lickilicky = **Schlurplek** (Normal).
- Altaria = **Altaria** (identical in German), per PokéWiki/Bisafans.
I did not verify German names for the other species listed and am deliberately omitting them rather than guessing.

## Details: Part 2, Automatable data sources

Ranked by reliability and ease of automation.

**1. PvPoke GitHub (best single starting point).** Repo github.com/pvpoke/pvpoke, MIT-licensed (confirmed on the repo page). Raw ranking files:
- Great: `https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-1500.json`
- Ultra: `https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-2500.json`
- Master: `rankings-10000.json`; a 500-cap "Little" file also exists.
- Cup/format rankings: `src/data/rankings/{cupId}/{category}/rankings-{cp}.json`, where cupId is `all` for open leagues or a cup id (published ids include spring, retro, jungle, fantasy, premier, championship, naic2026, catch, electric, little), and category is one of overall/leads/closers/switches/chargers/attackers/consistency. Not every (cup, cap) pair exists, so expect 404s.
- Game master: `https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json` (plus gamemaster.min.json).

Format: JSON. Each entry carries speciesId, speciesName, rating, moveset, scores, matchups and counters (field names inferred from downstream consumers such as the lily dex API and pogo-pvp-mcp, so verify against the raw file once before hard-coding a parser). Update cadence: the README states a two-week development cycle plus ad-hoc data/ranking updates "for newly released Pokemon, moves, or mechanics", so data changes land whenever the game changes. No public REST API; you scrape static files from GitHub. Licence: MIT for the code.

**2. PokeMiners/game_masters (authoritative for raw game data and pre-announcement rebalances).** Raw: `https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json` and `.../latest/timestamp.txt`. The timestamp file exists specifically so you can detect a new game master before pulling the large JSON; the README says it "can be used to check if a new Game Master has been updated", with format "gm gm_version apk_version year-month-day hour-minute-second". Move and stat rebalances are datamined here, typically before Niantic's blog announces them. Format JSON/TXT. Terms (verbatim): "This repo is for educational use only. All content found within this repo is the property of The Pokemon Company and Niantic." No OSS licence; usage restriction only. Update cadence: event-driven, on each new game master push.

**3. pogoapi.net (convenient pre-parsed JSON REST).** Base `https://pogoapi.net/api/v1/{file}.json` (pokemon_stats.json, fast_moves.json, charged_moves.json, type_effectiveness.json, released_pokemon.json, pokemon_max_cp.json, etc.). Change detection via `https://pogoapi.net/api/v1/api_hashes.json`, which returns md5/sha1/sha256 per file so you only re-download changed endpoints. Unauthenticated JSON; the author explicitly recommends caching locally to reduce load. No stated numeric rate limit and no formal licence found; data derives from Niantic's game master.

**4. ScrapedDuck (LeekDuck mirror, for events/rotation not rankings).** Repo github.com/bigfoott/ScrapedDuck; data is pushed to the `data` branch. Events JSON is conventionally at `https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json` (plus events.min.json); field docs at docs/EVENTS.md, keyed by the LeekDuck URL slug as eventID. Code is MIT; data-usage terms (verbatim from the README): applications "cannot be hidden behind a paywall", "cannot be monetized with advertisements", and must "Give credit to ScrapedDuck and LeekDuck.com." Scraped "with permission". Update cadence: a scheduled GitHub Action that has run tens of thousands of times, so it runs far more often than the commonly cited "every 12 hours"; confirm the workflow cron before hard-coding an interval. This is the feed the user's go-calendar already relies on.

**5. PokeAPI (pokeapi.co/api/v2/).** Free, no auth, RESTful JSON. Per its own docs: "Since the move to static hosting in November 2018, rate limiting has been removed entirely, but we still encourage you to limit the frequency of requests... Locally cache resources whenever you request them." Weakness: it is main-series data, not Pokémon GO PvP; it does not carry GO CP multipliers, GO move stats, or PvP rankings. Use only for static species metadata, not for GBL viability.

**6. DialgaDex (dialgadex.com; source github.com/mgrann03/dialgadex) and GO Stadium / stadiumgaming.gg rank checker:** primarily raid/attacker tooling (DialgaDex) and a PvP rank-checking UI (Stadium). Useful as human-facing references; I could not verify a documented public JSON API for either, so treat them as scrape-only and secondary.

**7. Play! Pokémon rules and ban list (pokemon.com):** the banned list and Tournament Handbook (last revised 21 May 2026) are HTML/PDF only and sit behind an Incapsula bot wall, so they are not cleanly machine-readable via automated fetch. There is no machine-readable Niantic feed for GBL season rules or cup ban lists; the pokemongo.com news blog is the canonical source and is HTML only. For structured season/cup data, ScrapedDuck/LeekDuck or the Fandom season wiki are the practical scrape targets.

**8. RSS/webhooks for rebalance announcements:** Pokémon GO Hub publishes an RSS feed (`https://pokemongohub.net/feed/`) that carries the seasonal move-rebalance analyses. PokeMiners post datamines to Threads and Discord. There is no official Niantic webhook for move rebalances; the datamine (PokeMiners game master) is the earliest machine-readable signal, and the game master timestamp change is the event you would trigger on.

**GitHub polling note:** unauthenticated requests to api.github.com and raw.githubusercontent.com are capped at 60 requests per hour per IP. Per GitHub Docs: "The primary rate limit for unauthenticated requests is 60 requests per hour... associated with the originating IP address, not with the user or application." GitHub's May 2025 changelog extended this class of limit to raw.githubusercontent.com downloads. Use the PokeMiners timestamp.txt and pogoapi api_hashes.json to avoid re-downloading unchanged files, and cache locally.

## Recommendations

1. **Immediate keeps (do this now):** bank low-attack, high-bulk copies of Lickilicky/Lickitung, Mimikyu, Quagsire (and Shadow), Tinkaton, Altaria (and Shadow), Empoleon (and Shadow), Jellicent, Forretress, Cresselia, Registeel, Poliwrath, Lanturn, Galarian Stunfisk and Steelix. For Great League target roughly 0/15/15-shaped spreads, but use a PvP IV checker for the exact rank-1 per species rather than a blanket spread.
2. **Legacy-move triage:** before transferring anything, check whether its viability depends on a move you cannot currently re-roll (Hydro Cannon, Zap Cannon, and similar). If it has the legacy move, keep it; if not, and the move is not event-available, its ceiling is lower and it is a lower-priority hold.
3. **Tournament vs casual split:** if you play Play! Pokémon events, do not rely on mythicals/box legendaries; if you only play GBL, Cresselia and similar are fine and worth XL investment.
4. **Build the automation in this order:** (a) PvPoke rankings-1500/2500 JSON as your primary "is this still meta" signal; (b) PokeMiners latest.json + timestamp.txt as your early warning for rebalances; (c) pogoapi api_hashes.json for cheap change detection; (d) ScrapedDuck events.json for knowing which cup/rotation is live. Poll a few times per day at most, keyed off timestamp/hash changes, to stay under GitHub's 60/hour cap.
5. **Benchmarks that change the plan:** a new move rebalance appearing in the PokeMiners game master (re-run your keep list); a cup with type bans returning (re-check eligibility); the Mimikyu IV/scoring discrepancy resolving once more players build it; and the 1 September shift to Mega Editions, which changes Master League but not your Great/Ultra keeps.

## Caveats
- Ranking snapshots are dated: the Dittobase/PvPoke Great League order is from 24 August 2026; Pokémon GO Hub's database shows Mimikyu #1 in both capped leagues. I flagged this discrepancy rather than picking one; both are within the same week and reflect scoring/IV-treatment differences.
- Several IV spreads and XL flags are drawn from sportskeeda and Pokémon GO Hub articles of varying dates; where I could not confirm a spread against a current dated source I said so rather than inventing numbers.
- The Galarian Stunfisk "~60% Great League win rate" is one analyst's simulation claim (JRE47, 31 May 2026) and I could not corroborate the exact figure; its GO Hub DB rank (71/1143) and rank-1 spread (0/13/14) are verified.
- The PvPoke rankings JSON field names are inferred from downstream consumers, not byte-verified this session; confirm once against the raw file before shipping a parser.
- The ScrapedDuck "every 12 hours" figure is contradicted by its very frequent Action run history; verify the workflow cron before hard-coding an interval.
- Play! Pokémon and Niantic sources are not machine-readable; any automation of ban lists or season rules requires scraping HTML/PDF or relying on community mirrors.
- German names are given only where verified on PokéWiki (Mimigma, Schlurplek, Altaria); others omitted deliberately.

---

## Corrections

Verified against the raw feeds on 2026-08-28 while building the pipeline this doc specifies.
The doc above is left unedited; these supersede it where they conflict.

1. **PvPoke ranking entries carry no dex number.** The doc lists the fields as inferred from
   downstream consumers and flags them for verification — correctly. The actual keys are
   `speciesId, speciesName, rating, score, scores, moves, moveset, matchups, counters, stats,
   editorNotes, editorScore`. There is no `dex` and no `dexNr`. The dex must be joined from
   `gamemaster.min.json`'s `pokemon[]`, which is keyed by the same `speciesId`. Sorting is by
   `score` descending, not `rating`.

2. **PokeMiners `latest/timestamp.txt` is not a usable change trigger.** It currently returns the
   bare epoch-millis integer `1776386930700` — **17 April 2026**, four months stale — and not the
   `gm gm_version apk_version year-month-day hour-minute-second` format the README describes.
   `raw.githubusercontent.com` also serves no `Last-Modified` header. The reliable token is the
   HTTP `ETag` on `latest.json`, obtained with a `HEAD` request; that avoids downloading the
   18,724,770-byte body on the ~364 days a year it has not changed. This repo's
   `scripts/fetch-game-master-watch.mjs` uses the ETag.

3. **The "unresolved Mimikyu discrepancy" is not a discrepancy.** PvPoke has **Lickilicky #1 in
   Great League** (score 93.7) and **Mimikyu #1 in Ultra League** (score 95.9). The Dittobase and
   GO Hub snapshots were reporting different leagues, not disagreeing about one. A secondary
   effect: feeds that dedupe by base dex (as this repo does, and as lily-dex-api does) reorder the
   list relative to PvPoke's raw output, because entries like `altaria_shadow` fold into `altaria`.

4. **Cup rankings are reliably available**, contrary to the doc's caution being the whole story.
   Probed `mega/overall/rankings-1500`, `premier/overall/rankings-10000` and
   `catch/overall/rankings-1500` — all HTTP 200 with real content. `fantasy` does 404, so the
   "expect 404s" warning stands, but as a per-cup exception rather than a general risk. Cups
   should be enumerated from `gamemaster.min.json`'s `formats[]` (15 entries, each carrying the
   `{cup, cp, title}` triple the ranking path needs) rather than its `cups[]` (30 entries, no CP
   field, includes the non-cups `all` and `custom`).
