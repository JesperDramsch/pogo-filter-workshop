#!/usr/bin/env node
// Pulls species metadata from pogoapi.net and derives the pools the
// friend-collect suggestion packs in App.jsx consume. Replaces the
// hand-curated RARE_COLLECT_DEX constant — same rationale as
// fetch-meta-rankings.mjs: derived lists stay current without code changes.
//
//  - specialTradeDex: species that can only move in a Special Trade and
//    therefore never belong in a regular-trade "collect for me" pack.
//    Union of pogoapi rarity classes "Legendary" + "Mythic" and the
//    raid-exclusive roster. The raid-exclusive union is the structural
//    guarantee for Ultra Beasts (raid-only, special trade) no matter how
//    the rarity feed happens to classify them. Meltan/Melmetal stay IN
//    this set: they're the one mythical line that is tradeable at all,
//    but the trade is still a Special Trade (mythic class) — App.jsx's
//    `!mythical,808,809` wishlist guard re-includes them because it
//    answers a different question ("can the friend trade it at all"),
//    not "is it a regular trade".
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
  raidExcl:    "https://pogoapi.net/api/v1/raid_exclusive_pokemon.json",
  generations: "https://pogoapi.net/api/v1/pokemon_generations.json",
  evolutions:  "https://pogoapi.net/api/v1/pokemon_evolutions.json",
  stats:       "https://pogoapi.net/api/v1/pokemon_stats.json",
  released:    "https://pogoapi.net/api/v1/released_pokemon.json",
};

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
  let raidExcl = null;
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
  // Raid-exclusive is a belt-and-braces feed; if the endpoint goes away the
  // rarity union still stands and the Nihilego assertion below is the gate.
  try {
    raidExcl = await fetchJson(ENDPOINTS.raidExcl);
  } catch (e) {
    console.warn(`⚠  raid_exclusive fetch failed (${e.message}) — relying on rarity classes only.`);
  }

  // ── specialTradeDex ──
  const specialTrade = new Set();
  for (const [category, entries] of Object.entries(rarity || {})) {
    if (!/legendary|mythic/i.test(category)) continue;
    for (const id of collectDexIds(entries)) specialTrade.add(id);
  }
  if (raidExcl) for (const id of collectDexIds(raidExcl)) specialTrade.add(id);

  // ── starterDex ──
  // Group every dex id by generation, then take the 9 lowest per generation.
  const byGeneration = new Map();
  const genEntries = Array.isArray(generations)
    ? generations.map((e) => [e.generation_number ?? e.generation, [e]])
    : Object.entries(generations || {});
  for (const [genKey, entries] of genEntries) {
    const genNum = parseInt(String(genKey).replace(/\D+/g, ""), 10);
    if (Number.isNaN(genNum)) continue;
    if (!byGeneration.has(genNum)) byGeneration.set(genNum, new Set());
    for (const id of collectDexIds(entries)) byGeneration.get(genNum).add(id);
  }
  const starters = new Set();
  for (const ids of byGeneration.values()) {
    [...ids]
      .sort((a, b) => a - b)
      .slice(0, STARTERS_PER_GENERATION)
      .filter((_, idx) => idx % 3 === 0) // line bases sit at offsets 0/3/6
      .forEach((id) => starters.add(id));
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
  assertOrDie(newContent.specialTradeDex.includes(150), "Mewtwo (150) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(151), "Mew (151) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(793), "Nihilego (793, Ultra Beast) ∈ specialTradeDex");
  assertOrDie(newContent.specialTradeDex.includes(888), "Zacian (888) ∈ specialTradeDex");
  assertOrDie(
    newContent.specialTradeDex.includes(808),
    "Meltan (808) ∈ specialTradeDex — tradeable, but only as a Special Trade",
  );
  for (const dex of [1, 4, 7, 906]) {
    assertOrDie(newContent.starterDex.includes(dex), `starter ${dex} ∈ starterDex`);
  }
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

main().catch(e => { console.error(e); process.exit(1); });
