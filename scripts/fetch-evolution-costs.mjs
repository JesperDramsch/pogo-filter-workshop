#!/usr/bin/env node
// Pulls evolution chains from pogoapi.net and partitions species into the
// two pools the EvoSwap aux cards in App.jsx consume:
//
//  - candyHeavy: species whose chain has any single ≥400-candy jump OR
//    cumulative ≥150 candy from base to deepest descendant. Catches the
//    400-single-jumps (Magikarp→Gyarados, Wailmer→Wailord, Swablu→Altaria,
//    Meltan→Melmetal, Larvesta→Volcarona, Noibat→Noivern, Stufful→Bewear,
//    Wimpod→Golisopod, Toxel→Toxtricity, Sinistea→Polteageist, Snom→
//    Frosmoth, Poltchageist→Sinistcha) plus high-cumulative chains
//    (Roggenrola/Timburr 250, Karrablast/Shelmet/Phantump/Pumpkaboo/
//    Type:Null/Poipole/Kubfu 200, Applin 600 via item gating, Mankey/
//    Teddiursa/Pawniard 150). Pseudo-legendaries (Bagon/Beldum/Larvitar/
//    Dratini/etc.) sit at exactly 125 cumulative — same cost as Bulbasaur
//    — so they intentionally don't qualify here on candy alone; their
//    "expensive" comes from spawn rarity, not candy. The user can route
//    those through the manual #EvoSwap tag on the third card.
//
//  - itemGated: species whose chain has any stage requiring an
//    `item_required` (Sinnoh/Unova/Sun Stone, King's Rock, Metal Coat,
//    Dragon Scale, Up-Grade, Apples) or `lure_required` (Magnetic/Mossy/
//    Glacial/Rainy Lure Module). Time-of-day, buddy-walk, gender, and
//    upside-down conditions are intentionally excluded — the user scoped
//    EvoSwap to candy and items only.
//
// Output: only the *base* species of each qualifying chain. The app's
// PoGo `+species` operator is family-aware (matches every evolutionary
// relative of the named species), so listing Magikarp covers Gyarados too.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "evolution-costs.json");

const ENDPOINT = "https://pogoapi.net/api/v1/pokemon_evolutions.json";

// Tunables. The plan defaults — change here, not at consumer side.
const CANDY_HEAVY_SINGLE_JUMP = 400;
const CANDY_HEAVY_CUMULATIVE  = 150;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop evolution-costs-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Mirrors fetch-meta-rankings.mjs:normalizeName so the species-id format
// matches what App.jsx's resolveSpecies / topAttackersList already expect.
// Also strips colons ("Type: Null" → "type-null") since PoGo's species
// search can't handle them — the EvoSwap consumer needs lookup-clean names.
function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[.':]/g, "")
    .replace(/[♂]/g, "-m")
    .replace(/[♀]/g, "-f")
    .replace(/\s+/g, "-");
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

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let raw;
  try {
    console.log("→ Fetching pogoapi.net pokemon_evolutions");
    raw = await fetchJson(ENDPOINT);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  // Pool *all* form variants under the same species name. Galarian Slowpoke's
  // item-gated evolution to Slowking should mark "Slowpoke" as item-gated even
  // though regular Slowpoke also has a non-item path — the +species clause
  // catches the family regardless of which form the user has.
  const evosBySpecies = new Map();
  const allNames = new Set();
  for (const entry of raw) {
    allNames.add(entry.pokemon_name);
    if (!evosBySpecies.has(entry.pokemon_name)) evosBySpecies.set(entry.pokemon_name, []);
    evosBySpecies.get(entry.pokemon_name).push(...(entry.evolutions || []));
  }

  // Descendants — anything appearing as a target — can't be a base species.
  const descendants = new Set();
  for (const entry of raw) {
    for (const ev of entry.evolutions || []) descendants.add(ev.pokemon_name);
  }

  const baseSpecies = [...allNames].filter(n => !descendants.has(n));

  // Walk forward from `name`, tracking the deepest cumulative candy across
  // every descendant path, the largest single jump, and whether any stage
  // required an item or a lure. Visited-set guards against malformed cycles.
  function walkChain(name, accumCandy = 0, visited = new Set()) {
    if (visited.has(name)) return { maxCum: accumCandy, maxSingle: 0, item: false };
    visited.add(name);
    const evos = evosBySpecies.get(name) || [];
    let maxCum = accumCandy;
    let maxSingle = 0;
    let item = false;
    for (const ev of evos) {
      const cost = ev.candy_required || 0;
      if (cost > maxSingle) maxSingle = cost;
      if (ev.item_required || ev.lure_required) item = true;
      const sub = walkChain(ev.pokemon_name, accumCandy + cost, visited);
      if (sub.maxCum > maxCum) maxCum = sub.maxCum;
      if (sub.maxSingle > maxSingle) maxSingle = sub.maxSingle;
      if (sub.item) item = true;
    }
    return { maxCum, maxSingle, item };
  }

  const candyHeavy = [];
  const itemGated = [];
  for (const base of baseSpecies) {
    const chain = walkChain(base);
    if (chain.maxSingle >= CANDY_HEAVY_SINGLE_JUMP || chain.maxCum >= CANDY_HEAVY_CUMULATIVE) {
      candyHeavy.push(normalizeName(base));
    }
    if (chain.item) {
      itemGated.push(normalizeName(base));
    }
  }
  candyHeavy.sort();
  itemGated.sort();

  const newContent = {
    candyHeavySingleJumpThreshold: CANDY_HEAVY_SINGLE_JUMP,
    candyHeavyCumulativeThreshold: CANDY_HEAVY_CUMULATIVE,
    candyHeavy,
    itemGated,
  };

  // Preserve fetchedAt when content is unchanged so a no-op sync doesn't
  // create a noisy commit. Same trick as fetch-meta-rankings.mjs.
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const { fetchedAt: _prevAt, ...prevContent } = prev;
      if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  candy-heavy: ${candyHeavy.length} base species`);
  console.log(`  item-gated:  ${itemGated.length} base species`);
  console.log(`  sample candy-heavy: ${candyHeavy.slice(0, 5).join(", ")}`);
  console.log(`  sample item-gated:  ${itemGated.slice(0, 5).join(", ")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
