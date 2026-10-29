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
//  - megaForms: every released Mega and Primal FORM (Mega Charizard X and Y
//    are two), as { key, dex, kind, types, boostTypes }. `key` is the name
//    dictionary's key ("6_2"), through which the app names it in every
//    locale; `types` are the form's own, from tempEvoOverrides. `boostTypes`
//    are the types whose catches the active form boosts: the form's own types
//    for a Mega, and for a Primal the pinned PRIMAL_BOOST_TYPES below, since
//    the game master does not publish those. Released means PvPoke lists the
//    form with `released: true`; the game master carries a Mega's data ahead of
//    its launch, and recommending one nobody can evolve yet would be wrong.
//    Feeds the "best Mega for these spawns" panel on the wild-spawn card.
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

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, writeJson, readPreviousJson } from "./lib/json.mjs";
import {
  batchMsFromIso,
  evoParentsFromSteps,
  evolutionChainsFromSteps,
  evolutionStepsFromGameMaster,
  fetchGameMaster,
  fetchPvpokeGameMaster,
  gameMasterProvenance,
  pokemonTemplates,
  releasedDexFromPvpoke,
  tempEvoOverridesByDex,
  defaultFormByDex,
  templateNode,
  templateList,
  tempEvoWords,
  temporaryEvolutionNames,
  warnIfStale,
} from "./lib/game-master.mjs";
import { lowestDexPerGeneration } from "./lib/generations.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "species-meta.json");
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");

// The types a Primal boosts catches of, beyond nothing the game master says:
// its megaEvoLevelSettings carry the same sameTypeExtraCatchCandy effect as a
// Mega's but no type list, and its tempEvoOverrides give only the form's own
// types (Primal Kyogre is plain water). Fixed when Primal Reversion launched
// and unchanged since, so pinned like the trade-evolution set rather than
// fetched. Source: https://pokemongo.com/en/news/primal-reversion-2023
// A Primal missing here falls back to its own types, with a warning.
export const PRIMAL_BOOST_TYPES = {
  382: ["water", "electric", "bug"],
  383: ["ground", "fire", "grass"],
};

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

// Released Mega and Primal forms, as megaForms entries (see the header).
// `pvpoke` is PvPoke's game master: its speciesId for a temporary evolution is
// the species id and the tempEvoId's words, "charizard_mega_x",
// "kyogre_primal". Exported for the offline test in scripts/check-mega-boost.mjs.
export function megaFormsFromGameMaster(templates, names, pvpoke) {
  const released = new Set(
    (pvpoke?.pokemon || []).filter((p) => p?.released).map((p) => p.speciesId),
  );
  const idByDex = new Map();
  for (const { dex, settings } of pokemonTemplates(templates)) {
    if (settings?.pokemonId && !idByDex.has(dex)) idByDex.set(dex, settings.pokemonId);
  }
  const forms = [];
  const unreleased = [];
  for (const evo of temporaryEvolutionNames(tempEvoOverridesByDex(templates), names)) {
    const words = tempEvoWords(evo.tempEvoId);
    const kind = words[0] === "primal" ? "primal" : "mega";
    const speciesId = [String(idByDex.get(evo.dex) || "").toLowerCase(), ...words].join("_");
    if (!released.has(speciesId)) {
      unreleased.push(evo.en);
      continue;
    }
    let boostTypes = evo.types;
    if (kind === "primal") {
      if (PRIMAL_BOOST_TYPES[evo.dex]) boostTypes = PRIMAL_BOOST_TYPES[evo.dex];
      else console.warn(`  ⚠ ${evo.en} has no pinned PRIMAL_BOOST_TYPES; using its own types`);
    }
    forms.push({ key: evo.key, dex: evo.dex, kind, types: evo.types, boostTypes });
  }
  forms.sort((a, b) => a.dex - b.dex || a.key.localeCompare(b.key));
  return { forms, unreleased: unreleased.sort() };
}

// Species with a Mega the game master already carries but players can't use
// yet: a Mega tempEvoOverride that the name dictionary doesn't name (datamined,
// e.g. Chandelure in 2026-10), or one it names that PvPoke doesn't list as
// released. The sorting workflow's watchlist reads this: a species about to
// get a Mega is worth a few keepers before its raids arrive.
export function upcomingMegaDexFromGameMaster(templates, names, pvpoke) {
  const released = new Set((pvpoke?.pokemon || []).filter((p) => p?.released).map((p) => p.speciesId));
  const idByDex = new Map();
  for (const { dex, settings } of pokemonTemplates(templates)) {
    if (settings?.pokemonId && !idByDex.has(dex)) idByDex.set(dex, settings.pokemonId);
  }
  const named = new Set(
    temporaryEvolutionNames(tempEvoOverridesByDex(templates), names).map((e) => `${e.dex}|${e.tempEvoId}`),
  );
  const out = new Set();
  for (const [dex, overrides] of tempEvoOverridesByDex(templates)) {
    for (const o of overrides || []) {
      const id = o?.tempEvoId || "";
      if (!MEGA_TEMP_EVO.test(id)) continue;
      const speciesId = [String(idByDex.get(dex) || "").toLowerCase(), ...tempEvoWords(id)].join("_");
      if (!named.has(`${dex}|${id}`) || !released.has(speciesId)) out.add(dex);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// The showcase calculator's inputs (docs/sorting-workflow-spec.md, "XXL score
// calculator"): each species' mean height and weight, from its default form's
// template (pokedexHeightM / pokedexWeightKg), and the score coefficients from
// CONTEST_SETTINGS. The size class (an XXL's maximum: 1.55, 1.75 or 2.00× the
// mean) is not in the game master, so the app shows the range across classes.
export function showcaseFromGameMaster(templates) {
  const defaults = defaultFormByDex(templates);
  const sizeByDex = {};
  for (const t of pokemonTemplates(templates)) {
    if (t.form !== null && t.form !== defaults.get(t.dex)) continue;
    const { pokedexHeightM: h, pokedexWeightKg: w } = t.settings;
    if (!(h > 0 && w > 0) || sizeByDex[t.dex]) continue;
    sizeByDex[t.dex] = [h, w];
  }
  let coefficients = null;
  for (const entry of templateList(templates)) {
    const node = templateNode(entry);
    const c = node?.contestSettings?.contestScoreCoefficient?.find((x) => x?.pokemonSize)?.pokemonSize;
    if (c) coefficients = { height: c.heightCoefficient, weight: c.weightCoefficient, iv: c.ivCoefficient, xxlAdjustmentFactor: c.xxlAdjustmentFactor ?? null };
  }
  return { coefficients, sizeByDex };
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

function assertOrDie(cond, label) {
  if (!cond) {
    console.error(`✗ sanity check failed: ${label}`);
    process.exit(1);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let templates, gmSource = { mirror: null, batchMs: null }, pvpoke, released;
  try {
    console.log("→ Fetching game master (pokemonClass / megaDex / evolutionBranch / stats source) + PvPoke release roster");
    // PvPoke is started first so it overlaps the big download.
    const pvpokePromise = fetchPvpokeGameMaster({
      userAgent: "pogo-filter-workshop species-meta-fetcher/1.0",
    });
    // Floored at the batch this snapshot was built from, so a fallback mirror
    // that is behind fails like an outage instead of rolling it back.
    const gm = await fetchGameMaster({
      userAgent: "pogo-filter-workshop species-meta-fetcher/1.0",
      minBatchMs: batchMsFromIso(readPreviousJson(OUT_PATH)?.sources?.gameMasterBatch),
    });
    templates = gm.templates;
    gmSource = { mirror: gm.mirror, batchMs: gm.batchMs };
    if (gm.failures.length > 0) {
      console.warn(`⚠  fell back to ${gm.mirror} after ${gm.failures.join("; ")}`);
    }
    console.log(`  game master: ${gm.mirror}, ${templates.length} templates`);
    warnIfStale(gmSource, "Newly released Megas and evolution branches may be missing.");
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

  // ── megaForms ──
  const names = JSON.parse(readFileSync(NAMES_PATH, "utf8"));
  const { forms: megaForms, unreleased: unreleasedMegas } = megaFormsFromGameMaster(templates, names, pvpoke);
  if (unreleasedMegas.length > 0) {
    console.log(`  not yet released per PvPoke, left out of megaForms: ${unreleasedMegas.join(", ")}`);
  }
  const upcomingMegaDex = upcomingMegaDexFromGameMaster(templates, names, pvpoke);
  const showcase = showcaseFromGameMaster(templates);
  console.log(`  upcoming Megas (in the game master, not out yet): ${upcomingMegaDex.join(", ") || "none"}`);

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

  const provenance = gameMasterProvenance(gmSource);
  console.log(`  ${steps.length} evolution steps · ${chains.size} base species` +
    ` · PvPoke roster ${pvpoke?.timestamp || "?"} (${released.size} released)`);

  const newContent = {
    // Provenance, the way meta-rankings.json records it: which upstream
    // answered each half of this snapshot, and the game master's batch stamp.
    // Every species fact here now comes from a feed that stamps its batches —
    // which is exactly what pogoapi.net, this file's previous source for five
    // of them, never did. See docs/upstream-sources.md.
    sources: {
      classes: "game master",
      released: "pvpoke/pvpoke",
      generations: "scripts/lib/generations.mjs (pinned dex ranges)",
      gameMaster: provenance.mirror,
      gameMasterBatch: provenance.batch,
    },
    startersPerGeneration: STARTERS_PER_GENERATION,
    powerLineCumulativeCandy: POWER_LINE_CUMULATIVE_CANDY,
    powerLineTop: POWER_LINE_TOP,
    specialTradeDex: [...specialTrade].sort((a, b) => a - b),
    starterDex: [...starters].sort((a, b) => a - b),
    powerLineDex: [...powerLines].sort((a, b) => a - b),
    megaDex: [...megas].sort((a, b) => a - b),
    megaForms,
    upcomingMegaDex,
    showcase,
    evoParentByDex,
  };

  // Sanity gates — exit 1 turns the sync workflow red, which is the only
  // intervention signal the user wants.
  assertOrDie(newContent.showcase.coefficients?.height > 0 && newContent.showcase.coefficients?.weight > 0,
    "showcase coefficients read from CONTEST_SETTINGS");
  assertOrDie(Object.keys(newContent.showcase.sizeByDex).length >= 900,
    `showcase sizes for ${Object.keys(newContent.showcase.sizeByDex).length} species (expected ≥ 900)`);
  assertOrDie(newContent.showcase.sizeByDex[7]?.[0] === 0.5 && newContent.showcase.sizeByDex[7]?.[1] === 9,
    "Squirtle's mean size is 0.5 m / 9 kg (the Hub's worked example)");
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
  const megaForm = (key) => newContent.megaForms.find((f) => f.key === key);
  assertOrDie(
    megaForm("6_2")?.types.join("/") === "fire/dragon" && megaForm("6_3")?.types.join("/") === "fire/flying",
    "Mega Charizard X is fire/dragon and Y fire/flying — two forms, each with its own types",
  );
  assertOrDie(
    megaForm("130_1")?.types.join("/") === "water/dark",
    "Mega Gyarados (130_1) is water/dark — the Mega's types, not the base form's",
  );
  assertOrDie(
    newContent.megaForms.some((f) => f.dex === 382 && f.kind === "primal" && f.boostTypes.includes("electric")),
    "Primal Kyogre boosts electric catches (PRIMAL_BOOST_TYPES)",
  );
  assertOrDie(
    newContent.megaForms.length >= 40 && newContent.megaForms.length <= 200,
    `megaForms covers the released roster (${newContent.megaForms.length} in 40..200)`,
  );
  assertOrDie(
    newContent.megaForms.every((f) => f.kind === "primal" || newContent.megaDex.includes(f.dex)),
    "every Mega in megaForms is a megaDex species",
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
  console.log(`  mega forms:    ${newContent.megaForms.length} released (Primals included)`);
}

// Only run when executed directly — check-friend-collect.mjs imports the
// parsers above without triggering a fetch.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
