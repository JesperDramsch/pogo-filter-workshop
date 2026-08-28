#!/usr/bin/env node
// Reads the Niantic game master's evolutionBranch data and partitions species
// into the two pools the EvoSwap aux cards in App.jsx consume:
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
//    `evolutionItemRequirement` (Sinnoh/Unova/Sun Stone, King's Rock, Metal
//    Coat, Dragon Scale, Up-Grade, Apples, Gimmighoul Coins) or a
//    `lureItemRequirement` (Magnetic/Mossy/Glacial/Rainy Lure Module).
//    Time-of-day, buddy-walk, gender, and upside-down conditions are
//    intentionally excluded — the user scoped EvoSwap to candy and items only.
//
// Output: only the *base* species of each qualifying chain. The app's
// PoGo `+species` operator is family-aware (matches every evolutionary
// relative of the named species), so listing Magikarp covers Gyarados too.
//
// Source note: this read pogoapi.net's pokemon_evolutions.json until August
// 2026. That feed had not moved since November 2025 and published no freshness
// signal of its own, so it was quietly missing Gimmighoul's Coin requirement
// among other things. The game master carries the same chains first-hand, at
// form granularity, and stamps every batch — see scripts/lib/game-master.mjs
// and docs/upstream-sources.md.
//
// Species names are emitted from src/locales/pokemon-names.json, keyed by dex
// — the same dictionary resolveSpecies reads, so every name resolves by
// construction.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evolutionChainsFromSteps,
  evolutionStepsFromGameMaster,
  fetchGameMaster,
} from "./lib/game-master.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "evolution-costs.json");
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");

// Tunables. The plan defaults — change here, not at consumer side.
const CANDY_HEAVY_SINGLE_JUMP = 400;
const CANDY_HEAVY_CUMULATIVE  = 150;

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

  let templates, mirrorName, ageDays;
  try {
    console.log("→ Fetching game master (evolutionBranch source)");
    ({ templates, mirrorName, ageDays } = await fetchGameMaster({
      userAgent: "pogo-filter-workshop evolution-costs-fetcher/1.0",
      label: "evolution chains",
    }));
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  const steps = evolutionStepsFromGameMaster(templates);
  const chains = evolutionChainsFromSteps(steps);
  const names = JSON.parse(readFileSync(NAMES_PATH, "utf8"));

  const candyHeavy = [];
  const itemGated = [];
  const unnamed = [];
  for (const [baseDex, chain] of chains) {
    const name = names[String(baseDex)]?.en;
    if (!name) { unnamed.push(baseDex); continue; }
    const id = normalizeName(name);
    if (chain.maxSingleCandy >= CANDY_HEAVY_SINGLE_JUMP ||
        chain.maxCumulativeCandy >= CANDY_HEAVY_CUMULATIVE) {
      candyHeavy.push(id);
    }
    if (chain.itemGated) itemGated.push(id);
  }
  candyHeavy.sort();
  itemGated.sort();
  if (unnamed.length > 0) {
    // A base species the name dictionary has never heard of means a new
    // generation landed in the game master before fetch-translations ran.
    // Report it — the pools are still valid, they are just short a line.
    console.warn(`⚠  ${unnamed.length} base species have no name entry yet: ${unnamed.join(", ")}`);
  }

  // Sanity gates. An emptied or halved pool means the branch shape changed
  // upstream; a red sync is the intended intervention signal.
  const fail = (label) => { console.error(`✗ sanity check failed: ${label}`); process.exit(1); };
  if (candyHeavy.length < 15) fail(`candyHeavy collapsed to ${candyHeavy.length} species (expected ≥ 15)`);
  if (itemGated.length < 25) fail(`itemGated collapsed to ${itemGated.length} species (expected ≥ 25)`);
  if (!candyHeavy.includes("magikarp")) fail("Magikarp ∈ candyHeavy (the 400-candy archetype)");
  if (!candyHeavy.includes("sinistea")) fail("Sinistea ∈ candyHeavy — the Antique form's 400-candy jump must survive form dedupe");
  if (!itemGated.includes("eevee")) fail("Eevee ∈ itemGated (Mossy/Glacial lure)");
  if (!itemGated.includes("slowpoke")) fail("Slowpoke ∈ itemGated (King's Rock)");
  if (candyHeavy.includes("bulbasaur")) fail("Bulbasaur ∉ candyHeavy — 125 cumulative is below the bar");

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
  console.log(`  source: ${mirrorName}${ageDays != null ? ` (${ageDays}d old)` : " (unstamped)"} · ${steps.length} evolution steps · ${chains.size} base species`);
  console.log(`  candy-heavy: ${candyHeavy.length} base species`);
  console.log(`  item-gated:  ${itemGated.length} base species`);
  console.log(`  sample candy-heavy: ${candyHeavy.slice(0, 5).join(", ")}`);
  console.log(`  sample item-gated:  ${itemGated.slice(0, 5).join(", ")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
