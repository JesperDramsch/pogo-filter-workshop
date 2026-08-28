#!/usr/bin/env node
// Derives the species pools the friend-collect suggestion packs in App.jsx
// consume, from the Niantic game master plus PvPoke's release roster.
// Replaces the hand-curated RARE_COLLECT_DEX constant — same rationale as
// fetch-meta-rankings.mjs: derived lists stay current without code changes.
//
// Source note: rarity, generations, evolutions, stats and release status came
// from pogoapi.net until August 2026. That service stopped publishing in
// November 2025 and carries no freshness signal of its own — its
// released_pokemon feed was missing seventeen live species by the time this
// was measured, and nothing in the pipeline could have said so. Every fact it
// supplied is now read first-hand:
//
//   pogoapi feed        → replacement
//   pokemon_rarity      → game master `pokemonSettings.pokemonClass`
//   pokemon_evolutions  → game master `evolutionBranch` (form-granular)
//   pokemon_stats       → game master `pokemonSettings.stats`
//   released_pokemon    → PvPoke game master `released` flag
//   pokemon_generations → scripts/lib/generations.mjs (a dex-range constant)
//
// See scripts/lib/game-master.mjs and docs/upstream-sources.md.
//
//  - specialTradeDex: species that can only move in a Special Trade and
//    therefore never belong in a regular-trade "collect for me" pack.
//    Read from the game master's `pokemonSettings.pokemonClass` —
//    POKEMON_CLASS_LEGENDARY / _MYTHIC / _ULTRA_BEAST, the game's own classes
//    that the Special-Trade rule keys off.
//    This used to union in pogoapi's rarity feed as a second opinion, which
//    was a mistake dressed as caution: that feed follows main-series taxonomy,
//    where Ultra Beasts are NOT legendaries, and the first live run tripped
//    the Nihilego assertion below exactly because of it. Measured on the
//    migration, the two sources agreed on all 111 species, so the union was
//    contributing nothing but a stale upstream. The assertions below are the
//    real guard, and they are what will catch a pokemonClass reshape.
//    The raid-exclusive roster was dropped as a source earlier for a similar
//    reason: a live run tripped the specialTradeDex ∩ starterDex guard,
//    showing "raid-only" is not a special-trade signal (shadow/event raids
//    feature regular species, starters included).
//    Meltan/Melmetal stay IN this set: they're the one mythical line that
//    is tradeable at all, but the trade is still a Special Trade (mythic
//    class) — App.jsx's `!mythical,808,809` wishlist guard re-includes
//    them because it answers a different question ("can the friend trade
//    it at all"), not "is it a regular trade".
//
//  - starterDex: the three starter BASE species of every generation.
//    Derived by rule, not list: each generation's regional dex opens with
//    its three starter lines as three consecutive trios (Bulbasaur 1-3,
//    Charmander 4-6, Squirtle 7-9 — the pattern holds in every gen), so
//    per generation we take the nine lowest dex ids and keep offsets
//    0/3/6. Bases only — that's what friends actually catch; the evolved
//    forms ride along implicitly once curated.
//    The generation boundaries themselves are a constant now
//    (scripts/lib/generations.mjs). That is a deliberate trade: pogoapi's
//    pokemon_generations payload had changed shape often enough that the
//    parser handled seven of them, and a boundary is fixed the day a
//    generation ships — one edit per new generation buys the removal of an
//    upstream nobody could tell had stalled.
//
//  - powerLineDex: "pseudo-legendary-style" lines — released 3-stage
//    chains with ≥125 cumulative candy whose FINAL stage ranks in the
//    top-N by base stat product. Catches Dratini/Larvitar/Beldum/Bagon/
//    Gible/Deino/Goomy/Jangmo-o/Dreepy/Frigibax plus legit non-pseudo
//    grinds (Axew, Litwick, Rhyhorn, …). Starter lines and trade-evo
//    lines are excluded here — they get their own packs. Emits the BASE
//    dex of each qualifying chain (the species a friend actually catches).
//
//  - megaDex: every species that can Mega Evolve, read straight from the
//    game's own temporary-evolution data — so a newly released Mega joins
//    the friend-collect "Mega evolutions" pack on the next daily sync with
//    no code change (the whole point of deriving it instead of curating it).
//    Game master ONLY, deliberately — there was never a second source worth
//    unioning: pogoapi's mega_pokemon feed listed Primal Kyogre/Groudon
//    alongside the real megas and carried no field this script could key a
//    Mega-vs-Primal split off, so a first live run tripped the Kyogre
//    assertion below (gm 48 · pogoapi 47 · union 50). The game master is the
//    one source that names the mechanic outright (TEMP_EVOLUTION_MEGA vs
//    TEMP_EVOLUTION_PRIMAL). A game-master outage empties megaDex and the
//    size gate below reddens the sync — the intended intervention signal,
//    same as every other assertion here. Emitted as the MEGA-CAPABLE species
//    dex (Charizard, not Charmander) — App.jsx's collectible-base remap turns
//    that into the species a friend actually catches.
//
//  - evoParentByDex: child dex → parent dex for every evolution step, so
//    App.jsx can walk any species down to the base of its line (the
//    friend-collect packs only suggest collectible bases — a lucky
//    Skwovet must prune a meta-pack Greedent, not coexist with it).
//    Form-aware and cross-dex: Galarian Meowth → Perrserker lands as
//    863→52, while same-species form changes never appear because a step
//    is only emitted when parent and child dex differ.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evoParentsFromSteps,
  evolutionChainsFromSteps,
  evolutionStepsFromGameMaster,
  fetchGameMaster,
  fetchPvpokeGameMaster,
  pokemonTemplates,
  releasedDexFromPvpoke,
} from "./lib/game-master.mjs";
import { lowestDexPerGeneration } from "./lib/generations.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "species-meta.json");

// The three starter BASE species per generation: each generation's regional
// dex opens with its three starter lines as three consecutive trios — ONCE
// excluded species are skipped. That carve-out exists for exactly one reason:
// Unova's dex opens with Victini (494, mythical) ahead of the
// Snivy/Tepig/Oshawott trios, which a live run caught via the
// specialTradeDex ∩ starterDex guard. Skipping the exclusions first, take the
// nine lowest dex ids of each generation and keep offsets 0/3/6.
// Exported for the offline test in scripts/check-friend-collect.mjs.
export function starterDexFromGenerations(perGeneration = 9, excludeDex = new Set()) {
  const starters = new Set();
  for (const ids of lowestDexPerGeneration(perGeneration, excludeDex).values()) {
    ids.filter((_, idx) => idx % 3 === 0).forEach((id) => starters.add(id));
  }
  return starters;
}

// Game-master pokemonClass values whose species require a Special Trade.
const SPECIAL_TRADE_CLASSES = /LEGENDARY|MYTHIC|ULTRA_BEAST/i;

// Extract the Set of dex ids whose game-master entry carries a special-trade
// pokemonClass. Template ids look like "V0793_POKEMON_NIHILEGO"; the settings
// node carries pokemonClass only for legendary/mythic/UB species. Exported
// for the offline parse test in scripts/check-friend-collect.mjs.
export function specialTradeDexFromGameMaster(templates) {
  const ids = new Set();
  for (const { dex, settings } of pokemonTemplates(templates)) {
    if (settings?.pokemonClass && SPECIAL_TRADE_CLASSES.test(settings.pokemonClass)) ids.add(dex);
  }
  return ids;
}

// Extract child-dex → parent-dex evolution pairs from the game master.
// Thin wrapper over the shared form-granular step parser: every per-form
// template repeats its species' branches, and where two parents ever claim
// one child the lowest parent dex wins. Exported for the offline parse test
// in scripts/check-friend-collect.mjs.
export function evoParentsFromGameMaster(templates) {
  return evoParentsFromSteps(evolutionStepsFromGameMaster(templates));
}

// Mega temporary evolutions. TEMP_EVOLUTION_MEGA covers plain megas and the
// X/Y split (TEMP_EVOLUTION_MEGA_X / _MEGA_Y) — both collapse onto the one
// species dex, since a friend catches the same Charmander either way.
// TEMP_EVOLUTION_PRIMAL (Groudon/Kyogre) deliberately does NOT match: Primal
// Reversion is a different mechanic, and both species are special-trade anyway.
const MEGA_TEMP_EVO = /^TEMP_EVOLUTION_MEGA/;

// Extract the Set of dex ids whose game-master entry offers a Mega. Two
// independent signals live in the same pokemonSettings node and are unioned —
// the live game master agrees on both today (48 species each), and a union
// survives either one being reshaped upstream:
//   1. evolutionBranch[].temporaryEvolution — the mega "evolution" offered.
//   2. tempEvoOverrides[].tempEvoId — the stat block the mega form swaps in.
// Exported for the offline parse test in scripts/check-friend-collect.mjs.
export function megaDexFromGameMaster(templates) {
  const ids = new Set();
  for (const { dex, settings } of pokemonTemplates(templates)) {
    const branchMega =
      Array.isArray(settings.evolutionBranch) &&
      settings.evolutionBranch.some((b) => MEGA_TEMP_EVO.test(b?.temporaryEvolution || ""));
    const overrideMega =
      Array.isArray(settings.tempEvoOverrides) &&
      settings.tempEvoOverrides.some((o) => MEGA_TEMP_EVO.test(o?.tempEvoId || ""));
    if (branchMega || overrideMega) ids.add(dex);
  }
  return ids;
}

// Best base stat product per dex, across every form template. "Best" rather
// than "the base form's": the pool this feeds ranks lines by how strong their
// final stage gets, and a regional form that outclasses the original (Hisuian
// Typhlosion, Galarian Darmanitan) is exactly what makes that line worth the
// grind. Exported for the offline test in scripts/check-friend-collect.mjs.
export function statProductByDex(templates) {
  const products = new Map();
  for (const { dex, settings } of pokemonTemplates(templates)) {
    const stats = settings?.stats;
    if (!stats) continue;
    const product = (stats.baseAttack || 0) * (stats.baseDefense || 0) * (stats.baseStamina || 0);
    if (product > (products.get(dex) || 0)) products.set(dex, product);
  }
  return products;
}

// Tunables. The plan defaults — change here, not at consumer side.
const STARTERS_PER_GENERATION = 9;   // 3 lines × 3 stages open every regional dex
const POWER_LINE_CUMULATIVE_CANDY = 125; // pseudo baseline (25 + 100)
const POWER_LINE_MIN_STAGES = 3;
const POWER_LINE_TOP = 20;           // strongest qualifying lines by final stat product

// Trade-evo bases (Kadabra/Machoke/… lines): these chains would qualify as
// power lines on candy+stats, but they already have a dedicated pack. Keyed
// by base dex — the fixed game mechanic, same set as App.jsx
// TRADE_EVO_FAMILIES.
const TRADE_EVO_BASE_DEX = new Set([63, 66, 74, 92, 524, 532, 588, 616, 708, 710]);

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

function writeJson(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function assertOrDie(cond, label) {
  if (!cond) {
    console.error(`✗ sanity check failed: ${label}`);
    process.exit(1);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let templates, mirrorName, ageDays, pvpoke, released;
  try {
    console.log("→ Fetching game master + PvPoke release roster");
    // PvPoke is started first so it overlaps the big download.
    const pvpokePromise = fetchPvpokeGameMaster({
      userAgent: "pogo-filter-workshop species-meta-fetcher/1.0",
    });
    ({ templates, mirrorName, ageDays } = await fetchGameMaster({
      userAgent: "pogo-filter-workshop species-meta-fetcher/1.0",
      label: "species metadata",
    }));
    pvpoke = await pvpokePromise;
    // An unavailable or shrunken roster is a FETCH failure, not an empty
    // result: powerLineDex gates on it, so publishing with an empty roster
    // would quietly delete a whole suggestion pack. Raising it here routes it
    // through --offline-ok like any other outage.
    released = releasedDexFromPvpoke(pvpoke);
    if (released.size <= 700) {
      throw new Error(`PvPoke released roster is ${released.size} species (expected > 700)`);
    }
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  // ── specialTradeDex ──
  const specialTrade = specialTradeDexFromGameMaster(templates);

  // ── megaDex ──
  // Special-trade megas (Latias, Latios, Rayquaza, Diancie) stay in the
  // snapshot; App.jsx's pack builder drops them, and the raw roster is the
  // honest answer to "what can mega".
  const megas = megaDexFromGameMaster(templates);

  // ── starterDex ──
  const starters = starterDexFromGenerations(STARTERS_PER_GENERATION, specialTrade);

  // ── powerLineDex ──
  const statProduct = statProductByDex(templates);
  const steps = evolutionStepsFromGameMaster(templates);
  const chains = evolutionChainsFromSteps(steps);

  const qualifying = [];
  for (const [baseDex, chain] of chains) {
    if (!released.has(baseDex)) continue;
    if (specialTrade.has(baseDex)) continue;
    if (starters.has(baseDex)) continue;
    if (TRADE_EVO_BASE_DEX.has(baseDex)) continue;
    if (chain.maxStages < POWER_LINE_MIN_STAGES) continue;
    if (chain.maxCumulativeCandy < POWER_LINE_CUMULATIVE_CANDY) continue;
    let bestFinal = 0;
    for (const finalDex of chain.finalDex) {
      bestFinal = Math.max(bestFinal, statProduct.get(finalDex) || 0);
    }
    if (!bestFinal) continue;
    qualifying.push({ baseDex, bestFinal });
  }
  qualifying.sort((a, b) => b.bestFinal - a.bestFinal || a.baseDex - b.baseDex);
  const powerLines = new Set(qualifying.slice(0, POWER_LINE_TOP).map((q) => q.baseDex));

  // ── evoParentByDex ──
  const evoParents = evoParentsFromSteps(steps);
  const evoParentByDex = {};
  for (const child of [...evoParents.keys()].sort((a, b) => a - b)) {
    evoParentByDex[String(child)] = evoParents.get(child);
  }

  console.log(`  source: ${mirrorName}${ageDays != null ? ` (${ageDays}d old)` : " (unstamped)"}` +
    ` · ${steps.length} evolution steps · ${chains.size} base species` +
    ` · PvPoke roster ${pvpoke?.timestamp || "?"} (${released.size} released)`);

  const newContent = {
    startersPerGeneration: STARTERS_PER_GENERATION,
    powerLineCumulativeCandy: POWER_LINE_CUMULATIVE_CANDY,
    powerLineTop: POWER_LINE_TOP,
    specialTradeDex: [...specialTrade].sort((a, b) => a - b),
    starterDex: [...starters].sort((a, b) => a - b),
    powerLineDex: [...powerLines].sort((a, b) => a - b),
    megaDex: [...megas].sort((a, b) => a - b),
    evoParentByDex,
  };

  // Sanity gates — exit 1 turns the sync workflow red, which is the only
  // intervention signal the user wants.
  assertOrDie(newContent.specialTradeDex.includes(150), "Mewtwo (150) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(151), "Mew (151) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(793), "Nihilego (793, Ultra Beast) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(888), "Zacian (888) ∈ specialTradeDex");
  assertOrDie(
    newContent.specialTradeDex.includes(808),
    "Meltan (808) ∈ specialTradeDex — tradeable, but only as a Special Trade",
  );
  assertOrDie(
    newContent.specialTradeDex.length >= 100,
    `specialTradeDex covers the legendary/mythic/UB roster (${newContent.specialTradeDex.length} ≥ 100)`,
  );
  for (const dex of [1, 4, 7, 495, 906]) {
    assertOrDie(newContent.starterDex.includes(dex), `starter ${dex} ∈ starterDex`);
  }
  assertOrDie(
    !newContent.starterDex.includes(494),
    "Victini (494) ∉ starterDex — Unova's dex opens with a mythical, not the trios",
  );
  assertOrDie(newContent.powerLineDex.includes(147), "Dratini (147) ∈ powerLineDex");
  assertOrDie(
    newContent.powerLineDex.length === POWER_LINE_TOP,
    `powerLineDex is the full top-${POWER_LINE_TOP} cut (got ${newContent.powerLineDex.length})`,
  );
  for (const [dex, name] of [[3, "Venusaur"], [6, "Charizard"], [9, "Blastoise"], [15, "Beedrill"], [94, "Gengar"]]) {
    assertOrDie(newContent.megaDex.includes(dex), `${name} (${dex}) ∈ megaDex`);
  }
  assertOrDie(
    !newContent.megaDex.includes(1),
    "Bulbasaur (1) ∉ megaDex — the Mega sits on the evolved stage, not the base",
  );
  assertOrDie(
    !newContent.megaDex.includes(382),
    "Kyogre (382) ∉ megaDex — Primal Reversion is not a Mega Evolution",
  );
  // Lower gate: an emptied/halved roster means the game-master fetch or its
  // temp-evo shape broke. Upper gate: a shape drift leaking unrelated ids
  // would balloon this past a roster — better a red sync than a whole-dex pack.
  assertOrDie(
    newContent.megaDex.length >= 40,
    `megaDex covers the released Mega roster (${newContent.megaDex.length} ≥ 40)`,
  );
  assertOrDie(
    newContent.megaDex.length <= 200,
    `megaDex is a roster, not the whole dex (${newContent.megaDex.length} ≤ 200)`,
  );
  assertOrDie(
    newContent.starterDex.every((dex) => !specialTrade.has(dex)),
    "specialTradeDex ∩ starterDex = ∅",
  );
  assertOrDie(evoParentByDex["2"] === 1, "Ivysaur (2) → Bulbasaur (1) ∈ evoParentByDex");
  assertOrDie(evoParentByDex["25"] === 172, "Pikachu (25) → Pichu (172): baby stages are real parents");
  assertOrDie(evoParentByDex["820"] === 819, "Greedent (820) → Skwovet (819) ∈ evoParentByDex");
  assertOrDie(evoParentByDex["863"] === 52, "Perrserker (863) → Meowth (52): cross-dex regional-form evolutions land");
  assertOrDie(evoParentByDex["1"] === undefined, "Bulbasaur (1) is a base — no parent entry");
  assertOrDie(Object.keys(evoParentByDex).length > 400, "evoParentByDex covers the dex (>400 steps)");
  // No cycles: every species must reach a base within the longest real line.
  for (const start of Object.keys(evoParentByDex)) {
    let cur = parseInt(start, 10);
    for (let hops = 0; evoParentByDex[String(cur)] !== undefined; hops++) {
      assertOrDie(hops < 10, `evoParentByDex cycle detected walking up from dex ${start}`);
      cur = evoParentByDex[String(cur)];
    }
  }

  // Preserve fetchedAt when content is unchanged so a no-op sync doesn't
  // create a noisy commit. Same trick as fetch-meta-rankings.mjs.
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const { fetchedAt: _prevAt, bootstrap: _prevBoot, ...prevContent } = prev;
      if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  special-trade: ${newContent.specialTradeDex.length} dex`);
  console.log(`  starters:      ${newContent.starterDex.length} dex`);
  console.log(`  power lines:   ${newContent.powerLineDex.length} base dex`);
  console.log(`  megas:         ${newContent.megaDex.length} dex`);
}

// Only run when executed directly — check-friend-collect.mjs imports the
// parsers above without triggering a fetch.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
