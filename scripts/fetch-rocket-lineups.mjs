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
//                      universal resistor, so an unthemed lineup gets
//                      `counters`: one group per phase, one per typing that
//                      recurs across phases (Snorlax), identical groups
//                      merged, move types limited to ones nobody in the
//                      group resists. A *themed* lineup (every phase offers
//                      the same set of primary types, e.g. Grass/Fire/Water
//                      starter lines) instead gets `themeTypes` plus
//                      typed-grunt-style resistors and SE move types. Both
//                      also carry the top-3 "hits SE" ranking.
//
// The derivation lives in scripts/lib/rocket-derive.mjs (pure, pinned by
// scripts/check-rocket-counters.mjs); this file does the I/O.
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
import { indexTypes, deriveTrainer } from "./lib/rocket-derive.mjs";

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
