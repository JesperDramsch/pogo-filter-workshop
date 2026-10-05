#!/usr/bin/env node
// Pulls Team GO Rocket lineups from ScrapedDuck (community scrape of
// LeekDuck.com), pairs them with lily-dex-api's type matrix, and writes a
// slim per-trainer counter artifact at src/data/rocket-lineups.json.
//
// Three trainer kinds:
//   * leader         — Giovanni / Cliff / Sierra / Arlo. Per-phase counters
//                      so the user can swap Pokémon between phases.
//   * typed_grunt    — 18 type-themed grunts. Resistor selection still
//                      considers the full union of lineup types (so a
//                      ground secondary like Swinub knocks steel out of
//                      the defender list). SE move selection anchors to
//                      the type chart counters of the grunt's primary
//                      type and only adds bonus types that hit ≥half of
//                      the lineup AND aren't resisted by the primary —
//                      otherwise a single off-type secondary (e.g.
//                      Swinub's ground on an ice grunt) used to leak
//                      water/grass/etc into the SE list.
//   * generic_grunt  — Male/Female/Decoy. Lineups too varied for a clean
//                      universal resistor. We rank candidate move types by
//                      "how many of the lineup's Pokémon take SE damage"
//                      and surface the top 3. Exception: a *themed* lineup
//                      (every phase offers the same set of primary types,
//                      e.g. Grass/Fire/Water starter lines) gets
//                      `themeTypes` plus typed-grunt-style resistors and SE
//                      move types. See themeTypesOf.
//
// During a Team GO Rocket takeover the fetcher also reads LeekDuck's lineup
// page directly, at most once per UTC day, until it shows a lineup ScrapedDuck
// does not. See scripts/lib/rocket-takeover.mjs for why and how sparingly.
// A LeekDuck-sourced snapshot is pinned against the ScrapedDuck content it
// replaced (`scrapedDuckPin`), so a still-frozen ScrapedDuck cannot roll it
// back after the takeover ends; the pin lifts the moment ScrapedDuck changes.
//
// Flags: --offline-ok    tolerate fetch failures if a previous artifact exists.
//        --no-leekduck   never read LeekDuck directly (prebuild uses this, so
//                        a deploy build never adds a request; the pin still
//                        holds).

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, writeJson, readPreviousJson } from "./lib/json.mjs";
import {
  LEEKDUCK_ROCKET_URL,
  findActiveTakeover,
  shouldReadLeekDuck,
  sameTakeover,
  missingTrainers,
  parseLeekDuckLineups,
} from "./lib/rocket-takeover.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "rocket-lineups.json");

const ENDPOINTS = {
  rocket: "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/rocketLineups.min.json",
  types:  "https://mknepprath.github.io/lily-dex-api/types.json",
  // Only read for takeover detection: leak-duck's feed carries each event's
  // bonus list, which is the steadier takeover signal (see rocket-takeover.mjs).
  events: "https://raw.githubusercontent.com/zhenga8533/leak-duck/refs/heads/data/events.json",
  // Fallback for takeover detection (titles only).
  eventsFallback: "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json",
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

// SE move types for a typed grunt. Anchored to the type chart (always
// includes types SE vs the primary type) plus "bonus coverage" types
// that hit at least half the lineup SE AND aren't resisted by the
// primary type. The resistance gate stops a single off-type secondary
// (Swinub's ground on an ice grunt) from re-introducing types whose
// STAB is halved by the headline matchup.
function seMoveTypesForTypedGrunt(primaryType, pokemons, allTypeNames, typeIdx) {
  const canonical = new Set(
    allTypeNames.filter(cand => eff(cand, primaryType, typeIdx) > 1)
  );
  const threshold = Math.ceil(pokemons.length / 2);
  const out = new Set(canonical);
  for (const cand of allTypeNames) {
    if (out.has(cand)) continue;
    if (eff(cand, primaryType, typeIdx) < 1) continue;
    let hits = 0;
    for (const p of pokemons) {
      if (effVsPokemon(cand, (p.types || []).map(t => t.toLowerCase()), typeIdx) > 1) {
        hits++;
      }
    }
    if (hits >= threshold) out.add(cand);
  }
  return [...out].sort();
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
    seMoveTypes: seMoveTypesForTypedGrunt(entry.type.toLowerCase(), pokemons, allTypeNames, typeIdx),
    lineupSize: pokemons.length,
  };
}

// A generic grunt's lineup is "themed" when every phase offers the same set
// of primary types and that set has at least two members — the shape of a
// starter-trio lineup (Bulbasaur/Charmander/Squirtle → … → Venusaur/
// Charizard/Blastoise is Grass/Fire/Water in all three phases). Derived from
// the lineup, never from species names, so a rotation to another trio (or
// away from trios) is picked up by the next sync. Returns the theme types
// in lineup order, or null.
function themeTypesOf(slots) {
  if (slots.length === 0 || slots.some(s => s.length < 2)) return null;
  const primaries = slots.map(slot => slot.map(p => (p.types?.[0] || "").toLowerCase()));
  if (primaries.some(list => list.some(t => !t))) return null;
  const key = list => [...new Set(list)].sort().join(",");
  const first = key(primaries[0]);
  if (!primaries.every(list => key(list) === first)) return null;
  const theme = [...new Set(primaries[0])];
  return theme.length >= 2 ? theme : null;
}

// SE move types for a themed lineup: hits at least one lineup Pokémon SE and
// is not resisted by any theme type. Without the resistance gate the starter
// trio would rank electric first (SE on the Squirtle line, halved by the
// Bulbasaur line) and fire (halved by two of the three lines).
function seMoveTypesForTheme(themeTypes, pokemons, allTypeNames, typeIdx) {
  return seVsAnyPokemon(pokemons, allTypeNames, typeIdx)
    .filter(cand => themeTypes.every(t => eff(cand, t, typeIdx) >= 1))
    .sort();
}

function deriveGenericGrunt(entry, allTypeNames, typeIdx) {
  const slots = phasesOf(entry);
  const pokemons = slots.flat().map(pokemonSummary);
  const { types: top, hitMap } = topOffensiveTypes(pokemons, allTypeNames, typeIdx);
  const commonStabThreshold = Math.max(2, Math.ceil(pokemons.length / 3));
  const commonStabTypes = commonStabsOf(pokemons, commonStabThreshold);
  const themeTypes = themeTypesOf(slots);
  const theme = themeTypes
    ? {
        themeTypes,
        resistorTypes: resistorsFor(unionTypesOf(slots.flat()), allTypeNames, typeIdx),
        seMoveTypes: seMoveTypesForTheme(themeTypes, pokemons, allTypeNames, typeIdx),
      }
    : {};
  return {
    name: entry.name,
    kind: "generic_grunt",
    phases: slots.map((slot, i) => ({ slot: i + 1, pokemons: slot.map(pokemonSummary) })),
    topOffensiveTypes: top,
    topHits: top.map(t => ({ type: t, hits: hitMap[t], total: pokemons.length })),
    commonStabTypes,
    commonStabThreshold,
    ...theme,
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

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop rocket-fetcher/1.0 (takeover check, once per day)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

function digest(trainers) {
  return createHash("sha256").update(canonicalStringify(trainers)).digest("hex").slice(0, 16);
}

// The live takeover, if any. leak-duck's feed first (it has the bonus lines);
// ScrapedDuck's event feed (titles only) when leak-duck is unreachable. Not
// src/data/events.json: it keeps only events with a wild-spawn pool.
async function detectTakeover(now) {
  try {
    return findActiveTakeover(await fetchJson(ENDPOINTS.events), now);
  } catch (e) {
    console.warn(`  ⚠ leak-duck events feed unavailable (${e.message}); falling back to ScrapedDuck's`);
    try {
      return findActiveTakeover(await fetchJson(ENDPOINTS.eventsFallback), now);
    } catch (e2) {
      console.error(`✗ no event feed reachable (${e2.message}); takeover check skipped`);
      return null;
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");
  const allowLeekDuck = !args.has("--no-leekduck");

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
  const derive = (raw) => raw.map(e => deriveTrainer(e, allTypeNames, typeIdx)).filter(Boolean);

  const scrapedDuckTrainers = derive(rocketRaw);
  const scrapedDuckDigest = digest(scrapedDuckTrainers);
  const prev = readPreviousJson(OUT_PATH);

  // Default: ScrapedDuck. A previous LeekDuck snapshot survives as long as
  // ScrapedDuck still serves exactly what it served when LeekDuck replaced it.
  let trainers = scrapedDuckTrainers;
  let source = "scrapedduck";
  let scrapedDuckPin;
  if (prev?.source === "leekduck" && prev.scrapedDuckPin === scrapedDuckDigest && Array.isArray(prev.trainers)) {
    trainers = prev.trainers;
    source = "leekduck";
    scrapedDuckPin = prev.scrapedDuckPin;
    console.log("  📌 ScrapedDuck unchanged since the LeekDuck takeover read — keeping the LeekDuck lineup");
  }

  // Takeover state is only carried while that takeover is live.
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  let takeoverState;
  let leekDuckFailed = false;
  if (allowLeekDuck) {
    const takeover = await detectTakeover(now);
    if (takeover) {
      const prevState = sameTakeover(takeover, prev?.takeover) ? prev.takeover : null;
      takeoverState = { ...takeover, attempts: prevState?.attempts || [], settled: !!prevState?.settled };
      console.log(`→ Takeover live: "${takeover.title}" (${takeover.start} → ${takeover.end})`);
      if (shouldReadLeekDuck(takeover, prevState, today)) {
        takeoverState.attempts = [...takeoverState.attempts, today];
        try {
          console.log(`→ Reading ${LEEKDUCK_ROCKET_URL} (takeover check ${takeoverState.attempts.length})`);
          const leekDuckTrainers = derive(parseLeekDuckLineups(await fetchText(LEEKDUCK_ROCKET_URL)));
          const missing = missingTrainers(leekDuckTrainers, scrapedDuckTrainers);
          if (missing.length > 0) {
            throw new Error(`LeekDuck parse is missing ${missing.length} of ScrapedDuck's trainers (${missing.join(", ")}) — refusing`);
          }
          if (digest(leekDuckTrainers) !== scrapedDuckDigest) {
            trainers = leekDuckTrainers;
            source = "leekduck";
            scrapedDuckPin = scrapedDuckDigest;
            takeoverState.settled = true;
            console.log("  ✓ LeekDuck differs from ScrapedDuck — using LeekDuck; no further reads this takeover");
          } else {
            console.log("  ↺ LeekDuck matches ScrapedDuck — will check again tomorrow");
          }
        } catch (e) {
          leekDuckFailed = true;
          console.error(`✗ LeekDuck takeover read failed: ${e.message}`);
        }
      } else {
        console.log(takeoverState.settled
          ? "  ✓ already settled for this takeover — not reading LeekDuck"
          : "  ↺ already checked LeekDuck today");
      }
    }
  } else if (prev?.takeover) {
    takeoverState = prev.takeover; // prebuild must not drop the sync's state
  }

  const newContent = { trainers };
  let fetchedAt = new Date(now).toISOString();
  if (prev && prev.fetchedAt && canonicalStringify({ trainers: prev.trainers }) === canonicalStringify(newContent)) {
    fetchedAt = prev.fetchedAt;
    console.log("  ↺ content unchanged — preserving previous fetchedAt");
  }

  writeJson(OUT_PATH, { fetchedAt, source, scrapedDuckPin, takeover: takeoverState, ...newContent });
  const counts = trainers.reduce((acc, t) => { acc[t.kind] = (acc[t.kind] || 0) + 1; return acc; }, {});
  console.log(`✓ wrote ${OUT_PATH} (source: ${source})`);
  console.log(`  trainers: ${trainers.length} total — ${counts.leader || 0} leaders, ${counts.typed_grunt || 0} typed grunts, ${counts.generic_grunt || 0} generic`);

  // A failed takeover read is exactly the silent staleness this exists to
  // catch, so the sync job goes red. A build (--offline-ok) carries on.
  if (leekDuckFailed && !offlineOk) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
