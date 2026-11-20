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

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, writeJson } from "./lib/json.mjs";
import { HOLOHOLO_LOCALES, fetchLocaleBundle, isDisplayable } from "./lib/holoholo-text.mjs";
import {
  evolutionChainsFromSteps,
  evolutionQuestsFromGameMaster,
  evolutionStepsFromGameMaster,
  fetchGameMaster,
  gameMasterAgeDays,
  mechanicsBatchFloor,
  warnIfStale,
} from "./lib/game-master.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "evolution-costs.json");
// Second output from the same dump: every quest-gated evolution (Pancham's 32
// Dark catches, Kubfu's 30 raid wins), read by src/buddy-quests.js.
const QUESTS_PATH = resolve(DATA_DIR, "evolution-quests.json");
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

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let templates, mirrorName, ageDays;
  try {
    console.log("→ Fetching game master (evolutionBranch source)");
    // This snapshot records no batch of its own, so the floor is the one
    // meta-rankings.json was built from. See mechanicsBatchFloor().
    const gm = await fetchGameMaster({
      userAgent: "pogo-filter-workshop evolution-costs-fetcher/1.0",
      minBatchMs: mechanicsBatchFloor(),
    });
    templates = gm.templates;
    mirrorName = gm.mirror;
    ageDays = gameMasterAgeDays(gm.batchMs);
    if (gm.failures.length > 0) {
      console.warn(`⚠  fell back to ${gm.mirror} after ${gm.failures.join("; ")}`);
    }
    warnIfStale(gm, "A newly released evolution line may be missing from these pools.");
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH) && existsSync(QUESTS_PATH)) {
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
  const quests = evolutionQuestsFromGameMaster(templates);
  await attachQuestText(quests);
  writeQuests(quests, fail);
  console.log(`  source: ${mirrorName}${ageDays != null ? ` (${ageDays}d old)` : " (unstamped)"} · ${steps.length} evolution steps · ${chains.size} base species`);
  console.log(`  candy-heavy: ${candyHeavy.length} base species`);
  console.log(`  item-gated:  ${itemGated.length} base species`);
  console.log(`  sample candy-heavy: ${candyHeavy.slice(0, 5).join(", ")}`);
  console.log(`  sample item-gated:  ${itemGated.slice(0, 5).join(", ")}`);
}

// Each quest's requirement in the client's own words, per app locale, from
// holoholo-text ("Fange {0} Pokémon vom Typ Unlicht"). The game master names
// Sylveon's 70-heart quest with the singular key ("Earn a heart with your
// buddy"); a text with no {0} for a target above 1 falls back to the plural
// sibling. A locale that cannot be fetched keeps the previous snapshot's text,
// and a quest with no text at all is still written: the card falls back to
// its own generic wording. German ends its quests with a full stop, which a
// chip does not want.
async function attachQuestText(quests) {
  let prev = {};
  try {
    for (const q of JSON.parse(readFileSync(QUESTS_PATH, "utf8")).quests || []) if (q.text) prev[q.quest] = q.text;
  } catch { prev = {}; }
  const bundles = {};
  for (const loc of Object.keys(HOLOHOLO_LOCALES)) {
    try {
      bundles[loc] = await fetchLocaleBundle(loc, { userAgent: "pogo-filter-workshop evolution-quests-fetcher/1.0" });
    } catch (e) {
      console.warn(`⚠  holoholo-text ${loc} failed (${e.message}); keeping the previous quest text for it`);
    }
  }
  const pick = (bundle, key, target) => {
    if (!bundle || !key) return null;
    let v = bundle[key];
    if (isDisplayable(v) && !v.includes("{0}") && target !== 1) {
      const plural = bundle[key.replace(/_single(?:ular)?$/, "_plural")];
      if (isDisplayable(plural) && plural.includes("{0}")) v = plural;
    }
    return isDisplayable(v) ? v.replace(/[.。]$/, "") : null;
  };
  let missing = 0;
  for (const q of quests) {
    const text = {};
    for (const loc of Object.keys(HOLOHOLO_LOCALES)) {
      const v = bundles[loc] ? pick(bundles[loc], q.textKey, q.target) : prev[q.quest]?.[loc];
      if (v) text[loc] = v;
    }
    if (!text.en) missing++;
    if (Object.keys(text).length) q.text = text;
  }
  if (missing) console.warn(`⚠  ${missing} evolution quests have no English text; the card shows its generic wording for them`);
}

// The quest list, with the same three fetcher properties as the pools above:
// sanity floor before writing, content compare to keep fetchedAt, and a
// shrunken list refuses to overwrite the cache.
const MIN_QUESTS = 25;
function writeQuests(quests, fail) {
  const unknown = quests.filter((q) => q.action === "other");
  for (const q of unknown) console.warn(`⚠  unrecognised evolution quest type ${q.questType} (${q.quest}); the buddy-quest card will list it without a match`);
  if (quests.length < MIN_QUESTS) fail(`evolution quests collapsed to ${quests.length} (expected ≥ ${MIN_QUESTS})`);
  const has = (dex, action, type) => quests.some((q) => q.dex === dex && q.action === action && (!type || q.types.includes(type)));
  if (!has(674, "catch", "dark")) fail("Pancham: catch Dark-type quest");
  if (!has(891, "raid_win", "dark")) fail("Kubfu: Dark raid-win quest");
  if (!has(133, "hearts")) fail("Eevee → Sylveon: hearts quest");
  if (!quests.some((q) => q.dex === 79 && q.region === "galar")) fail("Galarian Slowpoke keeps its region");

  let prev = null;
  try { prev = existsSync(QUESTS_PATH) ? JSON.parse(readFileSync(QUESTS_PATH, "utf8")) : null; } catch { prev = null; }
  if (prev?.quests?.length && quests.length < prev.quests.length * 0.8) {
    fail(`evolution quests shrank from ${prev.quests.length} to ${quests.length}; keeping the cache`);
  }
  const content = { quests };
  let fetchedAt = new Date().toISOString();
  if (prev?.fetchedAt) {
    const { fetchedAt: _at, ...prevContent } = prev;
    if (canonicalStringify(prevContent) === canonicalStringify(content)) {
      fetchedAt = prev.fetchedAt;
      console.log("  ↺ quests unchanged — preserving previous fetchedAt");
    }
  }
  writeJson(QUESTS_PATH, { fetchedAt, ...content });
  const byAction = {};
  for (const q of quests) byAction[q.action] = (byAction[q.action] || 0) + 1;
  console.log(`✓ wrote ${QUESTS_PATH} · ${quests.length} quest evolutions · ${Object.entries(byAction).map(([a, n]) => `${a} ${n}`).join(", ")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
