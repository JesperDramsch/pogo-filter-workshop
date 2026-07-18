#!/usr/bin/env node
// Pulls species metadata from pogoapi.net and derives the pools the
// friend-collect suggestion packs in App.jsx consume. Replaces the
// hand-curated RARE_COLLECT_DEX constant — same rationale as
// fetch-meta-rankings.mjs: derived lists stay current without code changes.
//
//  - specialTradeDex: species that can only move in a Special Trade and
//    therefore never belong in a regular-trade "collect for me" pack.
//    Two-source union, so no single upstream quirk can leak a species:
//      1. PokeMiners game master `pokemonSettings.pokemonClass` —
//         POKEMON_CLASS_LEGENDARY / _MYTHIC / _ULTRA_BEAST, the game's
//         own classes that the Special-Trade rule keys off. Authoritative
//         (pogoapi's rarity feed follows main-series taxonomy, where
//         Ultra Beasts are NOT legendaries — the first live run tripped
//         the Nihilego assertion exactly because of that).
//      2. pogoapi rarity: every non-"Standard" category (not just
//         Legendary/Mythic, in case Ultra Beasts sit in their own bucket).
//    The raid-exclusive roster was dropped as a source: a live run tripped
//    the specialTradeDex ∩ starterDex guard, showing "raid-only" is not a
//    special-trade signal (shadow/event raids feature regular species,
//    starters included).
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
//
//  - powerLineDex: "pseudo-legendary-style" lines — released 3-stage
//    chains with ≥125 cumulative candy whose FINAL stage ranks in the
//    top-N by base stat product. Catches Dratini/Larvitar/Beldum/Bagon/
//    Gible/Deino/Goomy/Jangmo-o/Dreepy/Frigibax plus legit non-pseudo
//    grinds (Axew, Litwick, Rhyhorn, …). Starter lines and trade-evo
//    lines are excluded here — they get their own packs. Emits the BASE
//    dex of each qualifying chain (the species a friend actually catches).
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "species-meta.json");

const ENDPOINTS = {
  rarity:      "https://pogoapi.net/api/v1/pokemon_rarity.json",
  generations: "https://pogoapi.net/api/v1/pokemon_generations.json",
  evolutions:  "https://pogoapi.net/api/v1/pokemon_evolutions.json",
  stats:       "https://pogoapi.net/api/v1/pokemon_stats.json",
  released:    "https://pogoapi.net/api/v1/released_pokemon.json",
  // PokeMiners game master (same org the grunt-quote fetcher uses). Big file
  // (~tens of MB) but this script only runs in the daily sync workflow.
  gameMaster:  "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json",
};

// Group dex ids by generation from pogoapi's pokemon_generations.json,
// whatever shape it arrives in — the first live run tripped the starter
// assertion because the real payload didn't match the shape we guessed.
// Handled shapes:
//   A. array of entries:            [{ pokemon_id, generation_number }, ...]
//      (incl. per-generation entries carrying a NESTED species list)
//   B. object gen → entry list:     { "generation_1": [{ pokemon_id }, ...] }
//   C. object gen → keyed-by-id:    { "generation_1": { "1": {...}, ... } }
//   D. object gen → dex range:      { "generation_1": { min_dex, max_dex } }
//   E. object id → generation:      { "1": "generation_1" | 1, ... }
//   F. object NAME → generation:    { "bulbasaur": 1, ... } (needs nameToDex,
//      built from the stats feed)
//   G. object id → entry w/ gen:    { "1": { generation_number: 1 }, ... }
// Exported for the offline shape tests in scripts/check-friend-collect.mjs.
export function generationDexSets(generations, nameToDex = new Map()) {
  const byGen = new Map();
  const add = (gen, id) => {
    if (!Number.isInteger(gen) || !Number.isInteger(id)) return;
    if (!byGen.has(gen)) byGen.set(gen, new Set());
    byGen.get(gen).add(id);
  };
  const genNum = (v) => {
    if (v == null) return null;
    const n = parseInt(String(v).replace(/\D+/g, ""), 10);
    return Number.isNaN(n) ? null : n;
  };
  // Entry id: the real feed (2026-07-18 log capture) names the field `id`,
  // not `pokemon_id` — accept both here. collectDexIds stays pokemon_id-only
  // on purpose: bare `id` fields in the rarity/raid feeds could mean anything.
  const entryId = (e) => parseInt(e?.pokemon_id ?? e?.id, 10);
  if (Array.isArray(generations)) {
    for (const e of generations || []) {
      const gen = genNum(e?.generation_number ?? e?.generation ?? e?.gen);
      if (gen == null) continue;
      add(gen, entryId(e)); // A — flat entry
      for (const id of collectDexIds(e)) add(gen, id); // A — nested species list
      for (const sub of Object.values(e || {})) {
        if (Array.isArray(sub)) for (const s of sub) add(gen, entryId(s)); // A — nested list with `id` fields
      }
    }
    return byGen;
  }
  for (const [key, val] of Object.entries(generations || {})) {
    if (val == null || typeof val !== "object") {
      const scalarGen = genNum(val);
      const keyId = parseInt(key, 10);
      if (!Number.isNaN(keyId)) add(scalarGen, keyId); // E — key is the pokemon id
      else if (nameToDex.has(normalizeName(key))) add(scalarGen, nameToDex.get(normalizeName(key))); // F
      continue;
    }
    const entryGen = genNum(val.generation_number ?? val.generation ?? val.gen);
    const keyId = parseInt(key, 10);
    if (entryGen != null && !Number.isNaN(keyId) && !/\D/.test(key)) {
      add(entryGen, keyId); // G — key is the pokemon id, gen sits in the entry
      continue;
    }
    const gen = genNum(key);
    if (gen == null) continue;
    for (const id of collectDexIds(val)) add(gen, id); // B (and C with pokemon_id fields)
    if (Array.isArray(val)) {
      // B — the live feed's actual shape: { "Generation 1": [{ id, name }] }
      for (const e of val) add(gen, entryId(e));
    }
    if (!Array.isArray(val)) {
      for (const k of Object.keys(val)) add(gen, parseInt(k, 10)); // C — ids as keys
      const lo = parseInt(val.min_dex ?? val.min ?? val.start ?? val.from, 10);
      const hi = parseInt(val.max_dex ?? val.max ?? val.end ?? val.to, 10);
      if (!Number.isNaN(lo) && !Number.isNaN(hi) && hi >= lo && hi - lo < 2000) {
        for (let i = lo; i <= hi; i++) add(gen, i); // D
      }
    }
  }
  return byGen;
}

// The three starter BASE species per generation: each generation's regional
// dex opens with its three starter lines as three consecutive trios — ONCE
// special-trade species are skipped. That carve-out exists for exactly one
// reason: Unova's dex opens with Victini (494, mythical) ahead of the
// Snivy/Tepig/Oshawott trios, which a live run caught via the
// specialTradeDex ∩ starterDex guard. Skipping the exclusions first, take
// the nine lowest dex ids and keep offsets 0/3/6.
export function starterDexFromGenerations(
  generations,
  perGeneration = 9,
  nameToDex = new Map(),
  excludeDex = new Set(),
) {
  const starters = new Set();
  for (const ids of generationDexSets(generations, nameToDex).values()) {
    [...ids]
      .filter((id) => !excludeDex.has(id))
      .sort((a, b) => a - b)
      .slice(0, perGeneration)
      .filter((_, idx) => idx % 3 === 0)
      .forEach((id) => starters.add(id));
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
  // latest.json is a plain array today, but older/mirrored game masters wrap
  // the list ({ template: [...] } / { templates: [...] } / { itemTemplate:
  // [...] }) — normalize instead of throwing on a non-iterable payload.
  const list = Array.isArray(templates)
    ? templates
    : templates?.template || templates?.templates || templates?.itemTemplate || [];
  for (const entry of list) {
    const node = entry?.data || entry;
    const ps = node?.pokemonSettings;
    if (!ps?.pokemonClass || !SPECIAL_TRADE_CLASSES.test(ps.pokemonClass)) continue;
    const tid = node?.templateId || entry?.templateId || "";
    const m = /^V(\d+)_POKEMON_/.exec(tid);
    if (m) ids.add(parseInt(m[1], 10));
  }
  return ids;
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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop species-meta-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Mirrors fetch-evolution-costs.mjs:normalizeName — lowercase, strip
// punctuation, hyphenate — so name-keyed payloads match the stats feed's
// pokemon_name entries in the name→dex lookup.
function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[.':]/g, "")
    .replace(/[♂]/g, "-m")
    .replace(/[♀]/g, "-f")
    .replace(/\s+/g, "-");
}

// pogoapi payloads come in three shapes: array of entries, object keyed by
// id, or object of category → entry-list. Pull every numeric pokemon_id out
// of whatever we got.
function collectDexIds(payload) {
  const ids = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node && typeof node === "object") {
      const id = parseInt(node.pokemon_id, 10);
      if (!Number.isNaN(id)) ids.add(id);
      for (const v of Object.values(node)) if (typeof v === "object") visit(v);
    }
  };
  visit(payload);
  return ids;
}

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

  let rarity, generations, evolutions, stats, released;
  try {
    console.log("→ Fetching pogoapi.net endpoints");
    [rarity, generations, evolutions, stats, released] = await Promise.all([
      fetchJson(ENDPOINTS.rarity),
      fetchJson(ENDPOINTS.generations),
      fetchJson(ENDPOINTS.evolutions),
      fetchJson(ENDPOINTS.stats),
      fetchJson(ENDPOINTS.released),
    ]);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }
  // The game master may fail independently of the pogoapi batch — the union
  // of whatever succeeds plus the assertions below is the gate.
  let gameMaster = null;
  try {
    console.log("→ Fetching PokeMiners game master (pokemonClass source)");
    gameMaster = await fetchJson(ENDPOINTS.gameMaster);
  } catch (e) {
    console.warn(`⚠  game master fetch failed (${e.message}).`);
  }

  // ── specialTradeDex ──
  // Per-source sets kept separate so an assertion failure can name the
  // source that leaked (see the overlap diagnostic below).
  const gmSet = specialTradeDexFromGameMaster(gameMaster);
  const raritySet = new Set();
  for (const [category, entries] of Object.entries(rarity || {})) {
    if (/standard/i.test(category)) continue;
    for (const id of collectDexIds(entries)) raritySet.add(id);
  }
  const specialTrade = new Set([...gmSet, ...raritySet]);

  // ── starterDex ──
  // Name→dex lookup (from the stats feed) lets the parser resolve
  // name-keyed generation payloads.
  const nameToDex = new Map();
  for (const row of stats || []) {
    const id = parseInt(row.pokemon_id, 10);
    if (Number.isNaN(id) || !row.pokemon_name) continue;
    const key = normalizeName(row.pokemon_name);
    if (!nameToDex.has(key)) nameToDex.set(key, id);
  }
  const generationSets = generationDexSets(generations, nameToDex);
  const starters = starterDexFromGenerations(generations, STARTERS_PER_GENERATION, nameToDex, specialTrade);
  // Diagnostic breadcrumb: if an assertion below trips, this line says whether
  // the feed shape parsed at all — and on a zero-parse, a payload sample goes
  // straight into the log so the next fix doesn't have to guess the shape.
  console.log(
    `  generations parsed: ${generationSets.size} · starters derived: ${[...starters].sort((a, b) => a - b).slice(0, 6).join(",")}…`,
  );
  if (generationSets.size === 0) {
    // Structural sample only — never serialize the full payload into the log.
    const sample = Array.isArray(generations)
      ? generations.slice(0, 2)
      : Object.fromEntries(Object.entries(generations || {}).slice(0, 1).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 3) : v]));
    console.warn(`⚠  unrecognized pokemon_generations shape — structural sample:`);
    console.warn(`   ${JSON.stringify(sample)?.slice(0, 600)}`);
  }

  // ── powerLineDex ──
  // released_pokemon.json is an object keyed by pokemon_id string.
  const releasedSet = new Set();
  for (const key of Object.keys(released || {})) {
    const id = parseInt(key, 10);
    if (!Number.isNaN(id)) releasedSet.add(id);
  }

  // Best stat product per dex across forms (stats is an array of form rows).
  const statProduct = new Map();
  for (const row of stats || []) {
    const id = parseInt(row.pokemon_id, 10);
    if (Number.isNaN(id)) continue;
    const product = (row.base_attack || 0) * (row.base_defense || 0) * (row.base_stamina || 0);
    if (product > (statProduct.get(id) || 0)) statProduct.set(id, product);
  }

  // Chain walk (same structure as fetch-evolution-costs.mjs), tracking depth,
  // cumulative candy, and the strongest final stage per base.
  const evosBySpecies = new Map();
  const idByName = new Map();
  const descendants = new Set();
  for (const entry of evolutions || []) {
    idByName.set(entry.pokemon_name, parseInt(entry.pokemon_id, 10));
    if (!evosBySpecies.has(entry.pokemon_name)) evosBySpecies.set(entry.pokemon_name, []);
    evosBySpecies.get(entry.pokemon_name).push(...(entry.evolutions || []));
    for (const ev of entry.evolutions || []) {
      descendants.add(ev.pokemon_name);
      if (ev.pokemon_id != null) idByName.set(ev.pokemon_name, parseInt(ev.pokemon_id, 10));
    }
  }
  const baseNames = [...evosBySpecies.keys()].filter((n) => !descendants.has(n));

  function walkChain(name, accumCandy = 0, depth = 1, visited = new Set()) {
    if (visited.has(name)) return { maxCum: accumCandy, maxDepth: depth, bestFinal: 0 };
    visited.add(name);
    const evos = evosBySpecies.get(name) || [];
    const selfId = idByName.get(name);
    if (evos.length === 0) {
      return { maxCum: accumCandy, maxDepth: depth, bestFinal: statProduct.get(selfId) || 0 };
    }
    let maxCum = accumCandy;
    let maxDepth = depth;
    let bestFinal = 0;
    for (const ev of evos) {
      const sub = walkChain(ev.pokemon_name, accumCandy + (ev.candy_required || 0), depth + 1, visited);
      if (sub.maxCum > maxCum) maxCum = sub.maxCum;
      if (sub.maxDepth > maxDepth) maxDepth = sub.maxDepth;
      if (sub.bestFinal > bestFinal) bestFinal = sub.bestFinal;
    }
    return { maxCum, maxDepth, bestFinal };
  }

  const qualifying = [];
  for (const base of baseNames) {
    const baseId = idByName.get(base);
    if (!baseId || !releasedSet.has(baseId)) continue;
    if (specialTrade.has(baseId)) continue;
    if (starters.has(baseId)) continue;
    if (TRADE_EVO_BASE_DEX.has(baseId)) continue;
    const chain = walkChain(base);
    if (chain.maxDepth < POWER_LINE_MIN_STAGES) continue;
    if (chain.maxCum < POWER_LINE_CUMULATIVE_CANDY) continue;
    if (!chain.bestFinal) continue;
    qualifying.push({ baseId, bestFinal: chain.bestFinal });
  }
  qualifying.sort((a, b) => b.bestFinal - a.bestFinal);
  const powerLines = new Set(qualifying.slice(0, POWER_LINE_TOP).map((q) => q.baseId));

  const newContent = {
    startersPerGeneration: STARTERS_PER_GENERATION,
    powerLineCumulativeCandy: POWER_LINE_CUMULATIVE_CANDY,
    powerLineTop: POWER_LINE_TOP,
    specialTradeDex: [...specialTrade].sort((a, b) => a - b),
    starterDex: [...starters].sort((a, b) => a - b),
    powerLineDex: [...powerLines].sort((a, b) => a - b),
  };

  // Sanity gates — exit 1 turns the sync workflow red, which is the only
  // intervention signal the user wants.
  // Overlap attribution first: if a starter ends up special-trade, name the
  // ids AND the source that leaked them before the assertion kills the run.
  const overlap = newContent.starterDex.filter((dex) => specialTrade.has(dex));
  if (overlap.length > 0) {
    console.warn(
      `⚠  special∩starter overlap: ${overlap
        .map((dex) => `${dex}(gm:${gmSet.has(dex) ? "y" : "n"} rarity:${raritySet.has(dex) ? "y" : "n"})`)
        .join(", ")}`,
    );
  }
  assertOrDie(newContent.specialTradeDex.includes(150), "Mewtwo (150) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(151), "Mew (151) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(793), "Nihilego (793, Ultra Beast) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(888), "Zacian (888) ∈ specialTradeDex");
  assertOrDie(
    newContent.specialTradeDex.includes(808),
    "Meltan (808) ∈ specialTradeDex — tradeable, but only as a Special Trade",
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
    newContent.starterDex.every((dex) => !specialTrade.has(dex)),
    "specialTradeDex ∩ starterDex = ∅",
  );

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
}

// Only run when executed directly — check-friend-collect.mjs imports the
// game-master parser above without triggering a fetch.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
