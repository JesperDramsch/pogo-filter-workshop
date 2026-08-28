# Pokémon GO PvP "Keep This" Analysis: Great and Ultra League, Late August 2026

> **Editor's note.** Research doc by Jesper, late August 2026, behind the repo's PvP data
> pipeline. Their original draft was written before the feeds were byte-verified; on 2026-08-28
> every automation claim in it was checked against the raw sources and **the text below was
> corrected in place**, so what you read is what is actually true. The
> [Verification log](#verification-log) at the end records what changed and how it was checked.
> See `../CLAUDE.md` for the rule this doc justifies.

## TL;DR
- The current ranking snapshot (PvPoke, verified 28 August 2026) puts **Lickilicky #1 in Great League** (score 93.7) and **Mimikyu #1 in Ultra League** (95.9), with the two swapping places between the leagues rather than topping both. The single biggest recent shift is that Mimikyu became GBL-legal only on 23 June 2026 with the new PvP battle system, so if you have a low-attack Mimikyu, keep it. The season is Forever Forward (Season 27, 2 June to 8 September 2026), and the late-August rotation (25 August to 1 September) is plain Great/Ultra/Master with no type-restricted cup.
- For automation, the best single starting point is the PvPoke GitHub repo (MIT-licensed): poll the raw rankings JSON for 1500 and 2500, plus `gamemaster.min.json` — which you need regardless, because the rankings carry `speciesId` but **no dex number**, and the game master is where the two are joined. It is also the reliable source for current move stats. PokeMiners' `latest.json` would be the earliest possible rebalance signal, but its mirror is months stale (see source 2), so treat it as a probe rather than a feed, and detect changes on it with the HTTP `ETag` from a `HEAD` request — **not** the `timestamp.txt` its README advertises. Use change tokens rather than blind polling, because unauthenticated GitHub raw requests are capped at 60 requests per hour per IP.
- Keep low-attack, high-bulk copies of meta staples that either need XL candy, depend on a legacy/unavailable move, or are pre-evolutions of not-yet-released or hard-to-build species. Mythicals and box legendaries are banned from Play! Pokémon tournaments but are legal in casual GBL, so the "keep" decision differs depending on whether you play tournaments.

## Key Findings

### Current meta state (dated)
- Season 27, "Forever Forward", runs 2 June to 8 September 2026 (Pokémon GO Wiki/Fandom; pokemongo.com news).
- The rebuilt PvP battle system rolled out 23 June 2026. It moved battle resolution server-side and, critically, made Mimikyu eligible in GBL for the first time (pokemongo.com "Trainer Battle Update", 23 June 2026). Mimikyu is excluded from the Competitors Cup, the legacy-system format used for the 2026 World Championships, which ends 30 August 2026.
- Late-August rotation: Great, Ultra and Master League run together from 25 August to 1 September 2026, with 4x Stardust from win rewards; all Pokémon eligible, no type cup (LeekDuck; buffhub 2026 PvP tier list; theclick.gg). The following week (1 to 8 September) is also Great/Ultra/Master. From 1 September, Master League: Mega Edition and Great/Ultra Mega Editions begin.
- Ranking snapshot, read directly from PvPoke's `rankings-1500.json` on 28 August 2026. Great League top 12: Lickilicky #1 (93.7), Tinkaton, Altaria, Empoleon, Mimikyu, Shadow Altaria, Shadow Empoleon, Shadow Quagsire, Quagsire, Jellicent, Forretress, Ninetales.
- The apparent conflict between snapshots — Dittobase showing Lickilicky #1, Pokémon GO Hub and buffhub showing Mimikyu #1 — **is not a conflict.** PvPoke has Lickilicky #1 in Great and Mimikyu #1 in Ultra; the two sources were reporting different leagues. There is no IV-treatment or scoring-date disagreement to resolve. A secondary effect worth knowing: any feed that dedupes by base dex (as this repo does) reorders the list relative to PvPoke's raw output, because entries like `altaria_shadow` fold into `altaria`.
- Ultra League: Mimikyu #1 (95.9), Lickilicky #2 (93.8), Corviknight #3 (93.4). Corviknight is called the standout safe-swap (resists all but two types with Sand Attack/Air Cutter/Payback), per buffhub and ldshop.gg tier writeups dated 2026.

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

**Pre-evolutions to keep now:** if an evolution is not yet in the game, hold the best-IV pre-evolution. I could not verify a specific list of not-yet-released PvP-relevant evolutions from a current dated source, so I am not inventing one. To find unreleased forms, check PvPoke's `gamemaster.min.json` — its `pokemon[]` carries a `released` flag per species — rather than the PokeMiners mirror, which is months behind and would miss exactly the recent additions you are looking for.

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
- Cup/format rankings: `src/data/rankings/{cupId}/{category}/rankings-{cp}.json`, where cupId is `all` for open leagues or a cup id, and category is one of overall/leads/closers/switches/chargers/attackers/consistency. **Enumerate cups from `gamemaster.min.json`'s `formats[]`, not its `cups[]`** — `formats[]` (15 entries) is the only place carrying the `{cup, cp, title}` triple the ranking path needs, while `cups[]` (30) has no CP field and includes the non-cups `all` and `custom`. Note that a cup can be published at several caps: `mega` exists at 1500, 2500 and 10000, so a cup map keyed on the bare cup id will collide. Most pairs resolve — `mega/1500`, `premier/10000` and `catch/1500` were all verified returning real content — but some 404 (`fantasy` does), so tolerate a miss per cup rather than failing the run.
- Game master: `https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json` (plus gamemaster.min.json).

Format: JSON array, sorted by `score` descending. **Byte-verified 28 August 2026**: each entry carries `speciesId, speciesName, rating, score, scores, moves, moveset, matchups, counters, stats, editorNotes, editorScore` — 1145 entries at 1500, 843 at 2500. There is **no dex number**; join it from `gamemaster.min.json`'s `pokemon[]`, which is keyed by the same `speciesId` and covers 1742 entries including every shadow, mega, regional and alternate form. Sort by `score`, not `rating` — `rating` is a separate figure and is not the ranking order. Update cadence: the README states a two-week development cycle plus ad-hoc data/ranking updates "for newly released Pokemon, moves, or mechanics", so data changes land whenever the game changes. No public REST API; you scrape static files from GitHub. Licence: MIT for the code.

**2. PokeMiners/game_masters — currently stale; probe it, do not depend on it.** Raw: `https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json` (18,724,770 bytes) and `.../latest/timestamp.txt`. In principle this is where move and stat rebalances are datamined before Niantic's blog announces them, which would make it the earliest machine-readable signal. **In practice, as of 28 August 2026 the mirror is roughly four months behind.** `timestamp.txt` returns the bare epoch-millis integer `1776386930700` — 17 April 2026 — and not the `gm gm_version apk_version year-month-day hour-minute-second` string the README documents. Worse, `latest.json` still carries the *pre*-Season-27 values for every move that rebalance touched: Earthquake power 110 (live: 120), Drill Run 80/45 (live: 70/40), Flash Cannon energy 70 (live: 65), Earth Power energy 55 (live: 50). A rebalance watch built on this feed would never fire.

So: **`timestamp.txt` is not a usable change trigger.** `raw.githubusercontent.com` also serves no `Last-Modified` header on this file, which leaves the HTTP `ETag` from a `HEAD` request as the only cheap change token — and a `HEAD` costs nothing and downloads none of the 18 MB. Keep the probe, because the mirror waking up is worth knowing about, but take current move stats from PvPoke's game master (source 1), which was verified carrying all four live Season 27 values. Terms (verbatim): "This repo is for educational use only. All content found within this repo is the property of The Pokemon Company and Niantic." No OSS licence; usage restriction only.

**3. pogoapi.net (convenient pre-parsed JSON REST).** *Superseded — see [`upstream-sources.md`](upstream-sources.md). Measured 2026-08-28, every feed this repo read was 209–290 days stale while still answering 200, and `api_hashes.json` was stable because the content behind it had not changed. The four fetchers that read it were migrated to the game master and PvPoke; the notes below are kept as the record of what was evaluated at the time.* Base `https://pogoapi.net/api/v1/{file}.json` (pokemon_stats.json, fast_moves.json, charged_moves.json, type_effectiveness.json, released_pokemon.json, pokemon_max_cp.json, etc.). Change detection via `https://pogoapi.net/api/v1/api_hashes.json`, which returns md5/sha1/sha256 per file so you only re-download changed endpoints. Unauthenticated JSON; the author explicitly recommends caching locally to reduce load. No stated numeric rate limit and no formal licence found; data derives from Niantic's game master.

**4. ScrapedDuck (LeekDuck mirror, for events/rotation not rankings).** Repo github.com/bigfoott/ScrapedDuck; data is pushed to the `data` branch. Events JSON is conventionally at `https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json` (plus events.min.json); field docs at docs/EVENTS.md, keyed by the LeekDuck URL slug as eventID. Code is MIT; data-usage terms (verbatim from the README): applications "cannot be hidden behind a paywall", "cannot be monetized with advertisements", and must "Give credit to ScrapedDuck and LeekDuck.com." Scraped "with permission". Update cadence: a scheduled GitHub Action that has run tens of thousands of times, so it runs far more often than the commonly cited "every 12 hours"; confirm the workflow cron before hard-coding an interval. This is the feed the user's go-calendar already relies on.

**5. PokeAPI (pokeapi.co/api/v2/).** Free, no auth, RESTful JSON. Per its own docs: "Since the move to static hosting in November 2018, rate limiting has been removed entirely, but we still encourage you to limit the frequency of requests... Locally cache resources whenever you request them." Weakness: it is main-series data, not Pokémon GO PvP; it does not carry GO CP multipliers, GO move stats, or PvP rankings. Use only for static species metadata, not for GBL viability.

**6. DialgaDex (dialgadex.com; source github.com/mgrann03/dialgadex) and GO Stadium / stadiumgaming.gg rank checker:** primarily raid/attacker tooling (DialgaDex) and a PvP rank-checking UI (Stadium). Useful as human-facing references; I could not verify a documented public JSON API for either, so treat them as scrape-only and secondary.

**7. Play! Pokémon rules and ban list (pokemon.com):** the banned list and Tournament Handbook (last revised 21 May 2026) are HTML/PDF only and sit behind an Incapsula bot wall, so they are not cleanly machine-readable via automated fetch. There is no machine-readable Niantic feed for GBL season rules or cup ban lists; the pokemongo.com news blog is the canonical source and is HTML only. For structured season/cup data, ScrapedDuck/LeekDuck or the Fandom season wiki are the practical scrape targets.

**8. RSS/webhooks for rebalance announcements:** Pokémon GO Hub publishes an RSS feed (`https://pokemongohub.net/feed/`) that carries the seasonal move-rebalance analyses. PokeMiners post datamines to Threads and Discord. There is no official Niantic webhook for move rebalances. A datamine would in principle be the earliest machine-readable signal, but with the PokeMiners mirror months behind (source 2), the earliest *reliable* one is a change in PvPoke's game master `moves[]` — diff the Trainer-Battle stats (`power`, `energy`, `energyGain`, `cooldown`, `turns`, buffs) between fetches and trigger on a field actually moving, rather than on any timestamp.

**GitHub polling note:** unauthenticated requests to api.github.com and raw.githubusercontent.com are capped at 60 requests per hour per IP. Per GitHub Docs: "The primary rate limit for unauthenticated requests is 60 requests per hour... associated with the originating IP address, not with the user or application." GitHub's May 2025 changelog extended this class of limit to raw.githubusercontent.com downloads. Avoid re-downloading unchanged files, and cache locally. For change tokens, use the HTTP **`ETag`** from a `HEAD` request (raw.githubusercontent sends no `Last-Modified`) and pogoapi's `api_hashes.json` — **not** PokeMiners' `timestamp.txt`, which as of August 2026 is stale and does not track its own repo (see source 2). In practice a full PvP sync is ~6-9 requests per day against a 60/hour cap, which is comfortable.

## Recommendations

1. **Immediate keeps (do this now):** bank low-attack, high-bulk copies of the species in the current Great and Ultra League pools — read them from [`skills/pokemon-go-filters/references/META.md`](../skills/pokemon-go-filters/references/META.md), or copy the ready-made filter out of the app, which builds it from `src/data/pvp-rankings.json`. For Great League target roughly 0/15/15-shaped spreads, but use a PvP IV checker for the exact rank-1 per species rather than a blanket spread.

   This recommendation deliberately names **no species**. The list that used to sit here was transcribed from the tier-list articles cited above, and four of its fifteen entries — Lickitung, Poliwrath, Lanturn and Galarian Stunfisk — were already absent from every league and cup of the snapshot on the day this document was written (line 59 concedes as much for Galarian Stunfisk, at rank 71/1143). It had no regeneration path and no check, so it would have drifted exactly like the hand-maintained tier list this whole document argues against. Per `CLAUDE.md`, a PvP species list in a doc must derive from the snapshot; a keep list is only worth writing down if it is generated.
2. **Legacy-move triage:** before transferring anything, check whether its viability depends on a move you cannot currently re-roll (Hydro Cannon, Zap Cannon, and similar). If it has the legacy move, keep it; if not, and the move is not event-available, its ceiling is lower and it is a lower-priority hold.
3. **Tournament vs casual split:** if you play Play! Pokémon events, do not rely on mythicals/box legendaries; if you only play GBL, Cresselia and similar are fine and worth XL investment.
4. **Build the automation in this order:** (a) PvPoke `rankings-1500/2500/10000.json` as your primary "is this still meta" signal, joined to dex numbers through `gamemaster.min.json`; (b) that same game master's `moves[]` as your rebalance signal — it is current, where PokeMiners is not — with a one-request `HEAD` probe on PokeMiners so a mirror recovery is still visible; (c) pogoapi `api_hashes.json` for cheap change detection; (d) ScrapedDuck `events.json` for knowing which cup/rotation is live, matched against the game master's `formats[]`. Poll a few times per day at most, keyed off ETag/hash changes, to stay under GitHub's 60/hour cap.
5. **Benchmarks that change the plan:** a move rebalance appearing in the game master (re-run your keep list); a cup with type bans returning (re-check eligibility); PokeMiners' mirror catching up, which would restore genuine pre-announcement lead time; and the 1 September shift to Mega Editions, which adds Mega Great/Ultra/Master cups on top of the standing leagues.

## Caveats

What is still uncertain, after the 28 August verification pass:

- Several IV spreads and XL flags are drawn from sportskeeda and Pokémon GO Hub articles of varying dates; where I could not confirm a spread against a current dated source I said so rather than inventing numbers. These were **not** re-verified — treat the Bucket C spreads as the weakest material in this doc.
- The Galarian Stunfisk "~60% Great League win rate" is one analyst's simulation claim (JRE47, 31 May 2026) and I could not corroborate the exact figure; its GO Hub DB rank (71/1143) and rank-1 spread (0/13/14) are verified.
- The ScrapedDuck "every 12 hours" figure is contradicted by its very frequent Action run history; verify the workflow cron before hard-coding an interval.
- Play! Pokémon and Niantic sources are not machine-readable; any automation of ban lists or season rules requires scraping HTML/PDF or relying on community mirrors. The Play! Pokémon banned list in Bucket A2 was not re-verified in the August pass.
- German names are given only where verified on PokéWiki (Mimigma, Schlurplek, Altaria); others omitted deliberately. For any other name, use the repo's `src/locales/pokemon-names.json` rather than guessing.
- pogoapi.net could not be reached during the August verification pass (blocked by an egress proxy), so its endpoints and `api_hashes.json` behaviour are as documented by the site, not independently confirmed.

---

## Verification log

On 2026-08-28 every automation claim in this doc was checked against the raw feeds while the
pipeline it specifies was being built. The prose above was **corrected in place** rather than
left standing with errata, so the doc reads as true. This log records what changed, so the
original judgement stays auditable.

| # | Original claim | What verification found | Where it now says so |
|---|---|---|---|
| 1 | PvPoke ranking fields, inferred from downstream consumers, flagged "verify before shipping a parser" | Correct to flag. The fields are `speciesId, speciesName, rating, score, scores, moves, moveset, matchups, counters, stats, editorNotes, editorScore` — **no dex**, so the dex must be joined from `gamemaster.min.json`. Order is by `score`, not `rating`. | Source 1, TL;DR bullet 2 |
| 2 | PokeMiners `timestamp.txt` detects a new game master before pulling the large JSON | The file returns bare epoch-millis `1776386930700` (2026-04-17), not the documented format, and the mirror is ~4 months stale — `latest.json` still holds the pre-Season-27 values for Earthquake, Drill Run, Flash Cannon and Earth Power. A watch on it would never fire. `ETag` via `HEAD` is the working token; current move stats come from PvPoke. | Source 2, TL;DR bullet 2, polling note, Recommendation 4 |
| 3 | Dittobase and GO Hub disagree about Mimikyu; flagged as an unresolved discrepancy | Not a discrepancy. PvPoke has Lickilicky #1 in **Great** (93.7) and Mimikyu #1 in **Ultra** (95.9); the two sources were reporting different leagues. | TL;DR bullet 1, meta-state section |
| 4 | Cup rankings: "not every (cup, cap) pair exists, so expect 404s" | True but not the main risk. Most pairs resolve (`mega/1500`, `premier/10000`, `catch/1500` all verified); `fantasy` 404s. The real trap is enumerating cups from `cups[]`, which carries no CP field — use `formats[]`, and key on `{cup}-{cp}` because `mega` is published at three caps. | Source 1 |

Two things this doc got right that were worth confirming: PvPoke is genuinely the upstream every
other community feed derives from, and the 60-requests-per-hour unauthenticated cap on
raw.githubusercontent is real and does constrain the design.

Not re-verified in this pass, and so unchanged above: the Bucket C IV spreads, the Play! Pokémon
banned list, and the German name translations beyond the three already sourced to PokéWiki.
