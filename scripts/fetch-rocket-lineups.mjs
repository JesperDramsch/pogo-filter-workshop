#!/usr/bin/env node
// Pulls Team GO Rocket lineups from ScrapedDuck (community scrape of
// LeekDuck.com), pairs them with lily-dex-api's type matrix, and writes a
// slim per-trainer counter artifact at src/data/rocket-lineups.json.
//
// Three trainer kinds:
//   * leader         — Giovanni / Cliff / Sierra / Arlo. Per-phase counters
//                      so the user can swap Pokémon between phases.
//   * typed_grunt    — 18 type-themed grunts. Aggregated counters across
//                      their full lineup; secondary types of individual
//                      Pokémon (e.g. Charizard's flying on a fire grunt)
//                      flow into resistor / SE selection.
//   * generic_grunt  — Male/Female/Decoy. Lineups too varied for a clean
//                      universal resistor. We rank candidate move types by
//                      "how many of the lineup's Pokémon take SE damage"
//                      and surface the top 3.
//
// Flags: --offline-ok   tolerate fetch failures if a previous artifact exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "rocket-lineups.json");

const ENDPOINTS = {
  rocket: "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/rocketLineups.min.json",
  types:  "https://mknepprath.github.io/lily-dex-api/types.json",
};

const GENERIC_TOP_N = 3;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop rocket-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// lily-dex's matchup table matches PoGo's (Gen VI+) — verified across all 18
// types against the canonical chart, so no PoGo-specific override layer is
// applied. If a future audit finds a divergence, patch typeIdx after this fn.
function indexTypes(typesArr) {
  const idx = {};
  for (const entry of typesArr) {
    // ScrapedDuck uses lowercase type names ("fire"); lily-dex-api uses
    // TitleCase ("Fire"). Normalize both sides to lowercase.
    const key = entry.type.toLowerCase();
    idx[key] = {
      doubleFrom: new Set((entry.doubleDamageFrom || []).map(s => s.toLowerCase())),
      halfFrom:   new Set((entry.halfDamageFrom   || []).map(s => s.toLowerCase())),
      noFrom:     new Set((entry.noDamageFrom     || []).map(s => s.toLowerCase())),
    };
  }
  return idx;
}

function eff(att, def, typeIdx) {
  const d = typeIdx[def];
  if (!d) return 1;
  if (d.noFrom.has(att))     return 0;
  if (d.halfFrom.has(att))   return 0.5;
  if (d.doubleFrom.has(att)) return 2;
  return 1;
}

// Combined effectiveness of attacker type Y against a Pokémon with possibly
// multiple types (PoGo: multiplicative).
function effVsPokemon(att, pokemonTypes, typeIdx) {
  return pokemonTypes.reduce((acc, t) => acc * eff(att, t, typeIdx), 1);
}

// Effectiveness of a typed STAB attack from attacker (single type) against
// defender (single type). Used to compute resistors when the boss-side is
// represented as a union of types from a multi-Pokémon set.
function defenderTakesFromBossTypes(defenderType, bossTypes, typeIdx) {
  // For each boss STAB type, what does the defender take?
  return bossTypes.map(bt => eff(bt, defenderType, typeIdx));
}

// Resistors for a boss represented as a union of types (drawn from one or
// more Pokémon's typings). Same rule as the raid-counter logic.
function resistorsFor(bossTypes, allTypeNames, typeIdx) {
  if (bossTypes.length === 0) return [];
  const out = [];
  for (const cand of allTypeNames) {
    const effs = defenderTakesFromBossTypes(cand, bossTypes, typeIdx);
    const maxEff = Math.max(...effs);
    if (maxEff > 1) continue;
    if (!effs.some(e => e < 1)) continue;
    out.push(cand);
  }
  return out;
}

// SE move types: per-Pokémon iteration. A type Y is "useful SE" iff it hits
// AT LEAST ONE Pokémon in the lineup super-effectively. Union-of-types
// would undercount because a dual-type Pokémon's resistance to one of its
// types can cancel out the SE on the other in the product.
function seVsAnyPokemon(pokemons, allTypeNames, typeIdx) {
  if (pokemons.length === 0) return [];
  const out = [];
  for (const cand of allTypeNames) {
    for (const p of pokemons) {
      if (effVsPokemon(cand, (p.types || []).map(t => t.toLowerCase()), typeIdx) > 1) {
        out.push(cand);
        break;
      }
    }
  }
  return out;
}

// Top-N attacker types by "hits SE" count across a heterogeneous lineup.
// Used for generic grunts whose phase composition is too varied for a
// clean union-resistor. Ties broken alphabetically.
function topOffensiveTypes(pokemons, allTypeNames, typeIdx, topN = GENERIC_TOP_N) {
  if (pokemons.length === 0) return { types: [], hitMap: {} };
  const counts = allTypeNames.map(cand => {
    let hits = 0;
    for (const p of pokemons) {
      if (effVsPokemon(cand, (p.types || []).map(t => t.toLowerCase()), typeIdx) > 1) {
        hits++;
      }
    }
    return { type: cand, hits };
  })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.type.localeCompare(b.type));
  const hitMap = {};
  for (const c of counts) hitMap[c.type] = c.hits;
  return { types: counts.slice(0, topN).map(c => c.type), hitMap };
}

function unionTypesOf(pokemons) {
  const set = new Set();
  for (const p of pokemons) {
    for (const t of (p.types || [])) set.add(t.toLowerCase());
  }
  return [...set];
}

// Types that appear on enough of the lineup's Pokémon to be worth a partial
// weakness guard for generic grunts. Counts per Pokémon entry (so a species
// appearing in multiple phases votes multiple times — that's the actual
// encounter exposure). Returned alphabetically for stable JSON diffs.
function commonStabsOf(pokemons, threshold) {
  const counts = {};
  for (const p of pokemons) {
    for (const t of (p.types || [])) {
      const k = t.toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return Object.keys(counts).filter(t => counts[t] >= threshold).sort();
}

function pokemonSummary(p) {
  return { name: p.name, types: (p.types || []).map(t => t.toLowerCase()) };
}

// Phases come from ScrapedDuck under camelCase keys.
function phasesOf(entry) {
  return [entry.firstPokemon || [], entry.secondPokemon || [], entry.thirdPokemon || []];
}

function deriveLeader(entry, allTypeNames, typeIdx) {
  const phases = phasesOf(entry).map((slot, i) => {
    const pokemons = slot.map(pokemonSummary);
    const unionTypes = unionTypesOf(slot);
    return {
      slot: i + 1,
      pokemons,
      resistorTypes: resistorsFor(unionTypes, allTypeNames, typeIdx),
      seMoveTypes: seVsAnyPokemon(pokemons, allTypeNames, typeIdx),
    };
  });
  return { name: entry.name, kind: "leader", phases };
}

function deriveTypedGrunt(entry, allTypeNames, typeIdx) {
  const slots = phasesOf(entry);
  const pokemons = slots.flat().map(pokemonSummary);
  const unionTypes = unionTypesOf(slots.flat());
  return {
    name: entry.name,
    kind: "typed_grunt",
    type: entry.type,
    phases: slots.map((slot, i) => ({ slot: i + 1, pokemons: slot.map(pokemonSummary) })),
    resistorTypes: resistorsFor(unionTypes, allTypeNames, typeIdx),
    seMoveTypes: seVsAnyPokemon(pokemons, allTypeNames, typeIdx),
    lineupSize: pokemons.length,
  };
}

function deriveGenericGrunt(entry, allTypeNames, typeIdx) {
  const slots = phasesOf(entry);
  const pokemons = slots.flat().map(pokemonSummary);
  const { types: top, hitMap } = topOffensiveTypes(pokemons, allTypeNames, typeIdx);
  const commonStabThreshold = Math.max(2, Math.ceil(pokemons.length / 3));
  const commonStabTypes = commonStabsOf(pokemons, commonStabThreshold);
  return {
    name: entry.name,
    kind: "generic_grunt",
    phases: slots.map((slot, i) => ({ slot: i + 1, pokemons: slot.map(pokemonSummary) })),
    topOffensiveTypes: top,
    topHits: top.map(t => ({ type: t, hits: hitMap[t], total: pokemons.length })),
    commonStabTypes,
    commonStabThreshold,
    lineupSize: pokemons.length,
  };
}

const LEADER_NAMES = new Set(["Giovanni", "Cliff", "Sierra", "Arlo"]);

function classify(entry) {
  if (LEADER_NAMES.has(entry.name)) return "leader";
  if (entry.type) return "typed_grunt";
  return "generic_grunt";
}

function deriveTrainer(entry, allTypeNames, typeIdx) {
  switch (classify(entry)) {
    case "leader":        return deriveLeader(entry, allTypeNames, typeIdx);
    case "typed_grunt":   return deriveTypedGrunt(entry, allTypeNames, typeIdx);
    case "generic_grunt": return deriveGenericGrunt(entry, allTypeNames, typeIdx);
  }
  return null;
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

  let typesArr, rocketRaw;
  try {
    console.log("→ Fetching ScrapedDuck rocket lineups + lily-dex-api types");
    [typesArr, rocketRaw] = await Promise.all([
      fetchJson(ENDPOINTS.types),
      fetchJson(ENDPOINTS.rocket),
    ]);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  if (!Array.isArray(typesArr) || typesArr.length < 18) {
    throw new Error(`types.json missing or too short (got ${typesArr?.length ?? 0} entries)`);
  }
  if (!Array.isArray(rocketRaw) || rocketRaw.length === 0) {
    throw new Error(`rocketLineups returned empty — refusing to overwrite cache`);
  }

  const typeIdx = indexTypes(typesArr);
  const allTypeNames = Object.keys(typeIdx);

  const trainers = rocketRaw.map(e => deriveTrainer(e, allTypeNames, typeIdx)).filter(Boolean);

  const newContent = { trainers };
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const prevContent = { trainers: prev.trainers };
      if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  const counts = trainers.reduce((acc, t) => { acc[t.kind] = (acc[t.kind] || 0) + 1; return acc; }, {});
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  trainers: ${trainers.length} total — ${counts.leader || 0} leaders, ${counts.typed_grunt || 0} typed grunts, ${counts.generic_grunt || 0} generic`);
}

main().catch(e => { console.error(e); process.exit(1); });
