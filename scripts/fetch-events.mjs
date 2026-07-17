#!/usr/bin/env node
// Pulls the live event feed from zhenga8533/leak-duck, keeps events that carry
// a wild-spawn list within a current/upcoming/just-ended window, resolves each
// spawn's English name to a base dex number, and writes a slim artifact at
// src/data/events.json that App.jsx imports at build time.
//
// The same pass also collects EGG POOLS (`details.eggs`) into a separate
// `eggPools` array: Season entries carry a months-long pool and some events
// ship their own — both feed the friend-collect suggestion sets (hatched
// Pokémon trade fine). Kept separate from `events` so the wild-spawn card
// logic stays untouched (a Season has eggs but no spawns).
//
// Why the derivation lives in this script (not the app):
//   - Keeps the runtime bundle small (one json file, no name index at runtime).
//   - Filter strings rebuild deterministically from a committed snapshot.
//   - leak-duck refreshes continuously; the user / a daily sync runs this on
//     demand so the Events card reflects whatever is live.
//
// Spawn resolution: the feed gives English names with forms parenthesised
// ("Squawkabilly (Blue)") or regional prefixes ("Alolan Vulpix"). We strip both
// down to the base species and resolve to its dex number — dex search in PoGo
// is form-agnostic, which is exactly what "show me all my <species>" wants.
//
// Flags:
//   --offline-ok   tolerate fetch failures if src/data/events.json exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "events.json");
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");

const EVENTS_URL =
  "https://raw.githubusercontent.com/zhenga8533/leak-duck/refs/heads/data/events.json";

// Single-species, weekly, 1-hour cards add noise without a real "sort my
// collection" payoff — the user opted to exclude them.
const SKIP_CATEGORIES = new Set(["Pokémon Spotlight Hour"]);

// Surfacing window. Past edge keeps a just-ended event around for tidying;
// future edge avoids cluttering the card with events weeks out (rotation
// shifts and would force daily snapshot churn).
const ENDED_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;   // keep ≤2 days after end
const UPCOMING_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;  // show ≤14 days ahead

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop events-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Build an English-name → base-dex-number map from pokemon-names.json. Only
// base keys (numeric, no "_form" suffix) are indexed: spawns are base-species
// names, and form keys ("6_2" = Mega Charizard X) would otherwise shadow them.
function buildNameIndex(namesDict) {
  const idx = new Map();
  for (const [dexKey, names] of Object.entries(namesDict)) {
    if (!/^\d+$/.test(dexKey)) continue;        // skip mega/giga form keys
    const en = names?.en;
    if (!en) continue;
    idx.set(en.toLowerCase(), parseInt(dexKey, 10));
  }
  return idx;
}

// "Squawkabilly (Blue)" → "Squawkabilly"; "Alolan Vulpix" → "Vulpix". Drops the
// parenthetical form tail first, then a leading regional / temp-form prefix.
function normalizeSpawnName(raw) {
  let s = String(raw).split(/\s*\(/)[0].trim();
  s = s.replace(
    /^(Alolan|Galarian|Hisuian|Paldean|Mega|Primal|Shadow|Gigantamax|Dynamax)\s+/i,
    "",
  );
  return s.trim();
}

// Deterministic, stable id (the feed carries no eventID). Same category+title+
// start always slugs to the same key, so React keys and copy-state stay stable
// across syncs while the event is live.
function slugId(category, title, start) {
  return `${category}|${title}|${start}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Resolve one spawn string to its base dex number. Tries the normalized full
// name first (so multi-word species like "Mr. Mime" / "Type: Null" match before
// any clipping), then falls back to dropping leading words one at a time — this
// rescues costume names like "Cake Hat Pikachu" → Pikachu without a hardcoded
// costume list. Returns { dex, name } or null.
function resolveBaseDex(raw, nameIdx) {
  const base = normalizeSpawnName(raw);
  const direct = nameIdx.get(base.toLowerCase());
  if (direct) return { dex: direct, name: base };
  const words = base.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const tail = words.slice(i).join(" ");
    const dex = nameIdx.get(tail.toLowerCase());
    if (dex) return { dex, name: tail };
  }
  return null;
}

// Resolve an event's spawn list to deduped sorted dex numbers + the base names
// we matched (handy for readable git diffs) + any names we couldn't resolve.
// Entries may be plain strings (pre-2026-07 feed) or { name, ... } objects
// (the feed migrated mid-July 2026; eggs always used objects) — accept both.
function resolveSpawns(spawns, nameIdx) {
  const dexSet = new Set();
  const nameSet = new Set();
  const unresolved = [];
  for (const entry of spawns) {
    const raw = typeof entry === "string" ? entry : entry?.name;
    if (!raw) continue;
    const hit = resolveBaseDex(raw, nameIdx);
    if (hit) {
      dexSet.add(hit.dex);
      nameSet.add(hit.name);
    } else if (!unresolved.includes(raw)) {
      unresolved.push(raw);
    }
  }
  return {
    spawnDex: [...dexSet].sort((a, b) => a - b),
    spawns: [...nameSet].sort(),
    unresolved: unresolved.sort(),
  };
}

function writeJson(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Order-independent stringify for content comparison, so a future re-key on
// either side doesn't trigger a spurious diff (mirrors fetch-raid-bosses.mjs).
function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let feed;
  try {
    console.log("→ Fetching leak-duck events feed");
    feed = await fetchJson(EVENTS_URL);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    throw new Error("events feed is not the expected category-keyed object");
  }

  const namesDict = JSON.parse(readFileSync(NAMES_PATH, "utf8"));
  const nameIdx = buildNameIndex(namesDict);

  const now = Date.now();
  const pastEdge = now - ENDED_RETENTION_MS;
  const futureEdge = now + UPCOMING_HORIZON_MS;

  const eventsOut = [];
  const eggPoolsOut = [];
  let skippedNoSpawns = 0;
  let skippedWindow = 0;
  let skippedCategory = 0;
  let totalUnresolved = 0;

  // Egg pools first — collected from EVERY category (a Season has eggs but no
  // spawns and would otherwise never be visited; SKIP_CATEGORIES only mutes
  // wild-spawn noise, not eggs). Feed items are { name, ... } objects.
  for (const [category, list] of Object.entries(feed)) {
    if (!Array.isArray(list)) continue;
    for (const event of list) {
      const eggs = event?.details?.eggs;
      if (!Array.isArray(eggs) || eggs.length === 0) continue;

      const startMs = Date.parse(event.start_time);
      const endMs = Date.parse(event.end_time);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      if (endMs < pastEdge || startMs > futureEdge) continue;

      const { spawnDex: eggDex, spawns: eggNames, unresolved } = resolveSpawns(eggs, nameIdx);
      if (eggDex.length === 0) continue;
      if (unresolved.length > 0) {
        totalUnresolved += unresolved.length;
        console.warn(`  ⚠ "${event.title}" eggs: unresolved names — ${unresolved.join(", ")}`);
      }

      eggPoolsOut.push({
        id: `${slugId(category, event.title, event.start_time)}-eggs`,
        title: event.title,
        category,
        start: event.start_time,
        end: event.end_time,
        isLocalTime: !!event.is_local_time,
        eggDex,
        eggs: eggNames,
        unresolved,
      });
    }
  }
  eggPoolsOut.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  for (const [category, list] of Object.entries(feed)) {
    if (SKIP_CATEGORIES.has(category)) { skippedCategory += (Array.isArray(list) ? list.length : 0); continue; }
    if (!Array.isArray(list)) continue;
    for (const event of list) {
      const spawns = event?.details?.spawns;
      if (!Array.isArray(spawns) || spawns.length === 0) { skippedNoSpawns++; continue; }

      const startMs = Date.parse(event.start_time);
      const endMs = Date.parse(event.end_time);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      if (endMs < pastEdge) { skippedWindow++; continue; }      // ended >2 days ago
      if (startMs > futureEdge) { skippedWindow++; continue; }  // beyond 14-day horizon

      const { spawnDex, spawns: spawnNames, unresolved } = resolveSpawns(spawns, nameIdx);
      if (spawnDex.length === 0) {
        console.warn(`  ⚠ "${event.title}": no spawns resolved (${unresolved.join(", ")}) — skipped`);
        continue;
      }
      if (unresolved.length > 0) {
        totalUnresolved += unresolved.length;
        console.warn(`  ⚠ "${event.title}": unresolved spawns — ${unresolved.join(", ")}`);
      }

      eventsOut.push({
        id: slugId(category, event.title, event.start_time),
        title: event.title,
        category,
        start: event.start_time,
        end: event.end_time,
        isLocalTime: !!event.is_local_time,
        spawnDex,
        spawns: spawnNames,
        unresolved,
      });
    }
  }

  if (eventsOut.length === 0) {
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn("⚠  No wild-spawn events in window; --offline-ok keeps existing cache.");
      return;
    }
    throw new Error("No wild-spawn events resolved — refusing to overwrite cache");
  }

  // Chronological so the UI can render top-down without re-sorting.
  eventsOut.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  // Preserve the previous fetchedAt when the resolved event set is unchanged so
  // the daily sync doesn't open a PR just because the timestamp moved. The UI's
  // "last sync · Xh ago" still reflects the last time the content actually moved.
  const newContent = { events: eventsOut, eggPools: eggPoolsOut };
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      if (
        canonicalStringify({ events: prev.events, eggPools: prev.eggPools || [] }) ===
          canonicalStringify(newContent) &&
        prev.fetchedAt
      ) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  events: ${eventsOut.length} surfaced · ${skippedNoSpawns} without spawns · ${skippedWindow} outside window · ${skippedCategory} skipped categories · ${totalUnresolved} unresolved spawn names`);
  console.log(`  egg pools: ${eggPoolsOut.length} surfaced`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
