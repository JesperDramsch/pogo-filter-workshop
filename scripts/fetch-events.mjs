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
// Ended events: leak-duck drops an event from its feed the moment it ends, so
// the just-ended window in scripts/lib/event-window.mjs is filled from the
// PREVIOUS snapshot, not from the feed — see `carryOver` there for the why.
//
// Spawn resolution: the feed gives English names with forms parenthesised
// ("Squawkabilly (Blue)") or regional prefixes ("Alolan Vulpix"). We strip both
// down to the base species and resolve to its dex number — dex search in PoGo
// is form-agnostic, which is exactly what "show me all my <species>" wants.
//
// Spawn TYPES are the exception to "base species": each event also carries
// `spawnForms`, the form-aware list the Mega panel ranks against. A Mega boosts
// catches by type, and the form decides the type — Hisuian Growlithe is
// fire/rock, Galarian Ponyta psychic — so these are resolved against the game
// master through the raid fetcher's name index (resolveBossKey), which reads a
// regional adjective the way Leek Duck writes one. A name that names no form
// (costumes, "Orange Flower Flabébé") gets the species' default form, which is
// the form the game gives a bare name. The game master is a SOFT dependency
// here: if every mirror fails, each spawn's form is carried from the previous
// snapshot by name, so a mirror outage never blocks the event sync.
//
// Flags:
//   --offline-ok   tolerate fetch failures if src/data/events.json exists.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalStringify, writeJson, readPreviousJson } from "./lib/json.mjs";
import { outsideWindow, carryOver } from "./lib/event-window.mjs";
import { LEGACY_COMMUNITY_DAYS, communityDaysFromFeed, mergeRollingCommunityDays } from "./lib/community-days.mjs";
import { isTakeoverEvent } from "./lib/rocket-takeover.mjs";
import { fetchGameMaster, mechanicsBatchFloor, warnIfStale } from "./lib/game-master.mjs";
import { buildNameIndex as buildFormIndex, resolveBossKey } from "./fetch-raid-bosses.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "events.json");
const CD_PATH = resolve(DATA_DIR, "community-days.json");
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");

const EVENTS_URL =
  "https://raw.githubusercontent.com/zhenga8533/leak-duck/refs/heads/data/events.json";

// Single-species, weekly, 1-hour cards add noise without a real "sort my
// collection" payoff — the user opted to exclude them.
const SKIP_CATEGORIES = new Set(["Pokémon Spotlight Hour"]);

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
export function buildNameIndex(namesDict) {
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
// Costume spawns come as "Piplup wearing a Halloween Mischief costume" since
// the Halloween 2026 listings; the costume tail goes too (costumeTail).
function normalizeSpawnName(raw) {
  let s = stripCostumeTail(String(raw).split(/\s*\(/)[0]).trim();
  s = s.replace(
    /^(Alolan|Galarian|Hisuian|Paldean|Mega|Primal|Shadow|Gigantamax|Dynamax)\s+/i,
    "",
  );
  return s.trim();
}

// "Zubat wearing a top hat" → "Zubat". Leek Duck's other costume spelling,
// "Cake Hat Pikachu", is handled by the leading-word fallback in resolveBaseDex.
function stripCostumeTail(name) {
  return String(name).replace(/\s+wearing\b.*$/i, "");
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
export function resolveBaseDex(raw, nameIdx) {
  const base = normalizeSpawnName(raw);
  const direct = nameIdx.get(base.toLowerCase());
  if (direct) return { dex: direct, name: base };
  const words = base.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const tail = words.slice(i).join(" ");
    const dex = nameIdx.get(tail.toLowerCase());
    if (dex) return { dex, name: tail };
  }
  // A trailing form word: "Unown B" is Unown. Tried after the leading-word
  // pass so "Cake Hat Pikachu" still resolves by its tail.
  for (let i = words.length - 1; i >= 1; i--) {
    const head = words.slice(0, i).join(" ");
    const dex = nameIdx.get(head.toLowerCase());
    if (dex) return { dex, name: head };
  }
  return null;
}

// The region word the app's form badges use, from a form enum's suffix head:
// GROWLITHE_HISUIAN → "hisui", PONYTA_GALARIAN → "galar". null for a form that
// is not regional (a default form, MINIOR_METEOR_BLUE, …).
const REGION_BY_FORM_HEAD = { ALOLA: "alola", GALARIAN: "galar", HISUIAN: "hisui", PALDEA: "paldea" };
function regionOfForm(form, pokemonId) {
  if (!form || !pokemonId || !form.startsWith(`${pokemonId}_`)) return null;
  return REGION_BY_FORM_HEAD[form.slice(pokemonId.length + 1).split("_")[0]] || null;
}

// One spawn's form and types, as { name, dex, region, types }, or null.
// `formIdx` is the raid fetcher's game-master name index. The full name goes
// first so a regional adjective or a bracketed forme picks its form; a name
// that resolves no form falls back to the species, i.e. its default form.
// `name` is the feed's spelling minus any costume tail, which is what the
// soft path keys the previous snapshot by.
export function resolveSpawnForm(raw, hit, formIdx) {
  const name = stripCostumeTail(raw).trim();
  const key = name.toLowerCase().replace(/[‘’ʼ]/g, "'");
  const species = formIdx.get(hit.name.toLowerCase().replace(/[‘’ʼ]/g, "'"));
  const form = resolveBossKey(formIdx, key);
  // resolveBossKey also answers temporary-evolution names; a wild spawn is
  // never one, and a hit on another species is a misread, not a form.
  const entry = form && species && form.id === species.id ? form : species;
  if (!entry) return null;
  return {
    name,
    dex: hit.dex,
    region: entry === species ? null : regionOfForm(entry.form, entry.id),
    types: entry.types.map((t) => t.toLowerCase()),
  };
}

// The event's spawnForms: one entry per distinct dex + region + types, sorted
// by dex. With no form index (game master unavailable), each name's form is
// carried from the previous snapshot; a name the previous snapshot never saw
// is left out and reported.
function spawnFormsFor(spawns, nameIdx, formIdx, previousForms, missing) {
  const out = new Map();
  for (const entry of spawns) {
    const raw = typeof entry === "string" ? entry : entry?.name;
    if (!raw) continue;
    const hit = resolveBaseDex(raw, nameIdx);
    if (!hit) continue;
    const form = formIdx
      ? resolveSpawnForm(raw, hit, formIdx)
      : previousForms.get(stripCostumeTail(raw).trim()) || null;
    if (!form) {
      missing.add(raw);
      continue;
    }
    const k = `${form.dex}|${form.region}|${form.types.join("/")}`;
    if (!out.has(k)) out.set(k, form);
  }
  return [...out.values()].sort((a, b) => a.dex - b.dex || String(a.region).localeCompare(String(b.region)));
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

// Did the feed list any costumed spawn ("Zubat wearing a top hat")?
export function hasCostumedSpawns(spawns) {
  return (spawns || []).some((e) => /\s+wearing\b/i.test(typeof e === "string" ? e : e?.name || ""));
}

// The event kinds that float sorting piles up, as { id, kind, title, start,
// end }: a Team GO Rocket takeover (the Rocket fetcher's own test), a
// Community Day (named as one), and a Max Monday or Max Battle Day (the feed's
// own categories). Wild-spawn events are the events list itself.
export function signalsFromFeed(feed) {
  const out = [];
  for (const [category, list] of Object.entries(feed || {})) {
    if (!Array.isArray(list)) continue;
    for (const ev of list) {
      const start = ev?.start_time, end = ev?.end_time;
      if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) continue;
      const kinds = [];
      if (isTakeoverEvent(ev)) kinds.push("takeover");
      if (/\bcommunity day\b/i.test(ev.title || "")) kinds.push("community_day");
      // Max Mondays and Max Battle Days: raid-bosses.json drops them the moment
      // they end, so the Dynamax pile needs them here to stay floated afterwards.
      if (/^max (mondays|battles)$/i.test(category)) kinds.push("max");
      for (const kind of kinds) out.push({ id: `${kind}|${slugId(category, ev.title, start)}`, kind, title: ev.title, start, end });
    }
  }
  return out;
}

// The Community Day background pile's species (scripts/lib/community-days.mjs):
// the pinned legacy list plus every Community Day this feed has ever listed.
// Runs before the wild-spawn guard below, so a day with no spawn events still
// records a new Community Day. Append-only, and it refuses to write a rolling
// list shorter than the one on disk.
function writeCommunityDays(feed, nameIdx) {
  const previous = readPreviousJson(CD_PATH);
  const fresh = communityDaysFromFeed(feed, (spawns) => resolveSpawns(spawns, nameIdx));
  const { rolling, added } = mergeRollingCommunityDays(previous?.rolling || [], fresh);
  if (rolling.length < (previous?.rolling?.length || 0)) {
    throw new Error("community days: rolling list would shrink — refusing to overwrite cache");
  }
  const content = { legacy: LEGACY_COMMUNITY_DAYS, rolling };
  const unchanged =
    previous?.fetchedAt &&
    canonicalStringify({ legacy: previous.legacy, rolling: previous.rolling || [] }) === canonicalStringify(content);
  writeJson(CD_PATH, { fetchedAt: unchanged ? previous.fetchedAt : new Date().toISOString(), ...content });
  for (const cd of added) console.log(`  + Community Day ${cd.date} ${cd.event} (${cd.dex.join(", ")})`);
  console.log(`✓ wrote ${CD_PATH} (${LEGACY_COMMUNITY_DAYS.length} legacy · ${rolling.length} rolling${unchanged ? ", unchanged" : ""})`);
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

  writeCommunityDays(feed, nameIdx);

  const now = Date.now();
  const previous = readPreviousJson(OUT_PATH);

  // Spawn types (see the header): soft, so a mirror outage carries the
  // previous snapshot's forms instead of failing the sync.
  let formIdx = null;
  try {
    console.log("→ Fetching game master (spawn form types)");
    const gm = await fetchGameMaster({
      userAgent: "pogo-filter-workshop events-fetcher/1.0",
      minBatchMs: mechanicsBatchFloor(),
    });
    warnIfStale(gm, "New regional forms may resolve to their species' default types.");
    formIdx = buildFormIndex(gm.templates, namesDict);
  } catch (e) {
    console.warn(`⚠  game master unavailable (${e.message}); spawn forms carried from the previous snapshot`);
  }
  const previousForms = new Map();
  for (const ev of previous?.events || []) {
    for (const f of ev.spawnForms || []) previousForms.set(f.name, f);
  }
  const missingForms = new Set();

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
      if (outsideWindow(startMs, endMs, now)) continue;

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
  const eggPools = carryOver(eggPoolsOut, previous?.eggPools, now);

  for (const [category, list] of Object.entries(feed)) {
    if (SKIP_CATEGORIES.has(category)) { skippedCategory += (Array.isArray(list) ? list.length : 0); continue; }
    if (!Array.isArray(list)) continue;
    for (const event of list) {
      const spawns = event?.details?.spawns;
      if (!Array.isArray(spawns) || spawns.length === 0) { skippedNoSpawns++; continue; }

      const startMs = Date.parse(event.start_time);
      const endMs = Date.parse(event.end_time);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      if (outsideWindow(startMs, endMs, now)) { skippedWindow++; continue; }

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
        spawnForms: spawnFormsFor(spawns, nameIdx, formIdx, previousForms, missingForms),
        unresolved,
        // Costumed spawns ("Piplup wearing a …"): the sorting tab floats the
        // costume pile up after such an event. The names above are stripped.
        hasCostumes: hasCostumedSpawns(spawns),
      });
    }
  }

  // Event kinds the sorting tab floats piles up for (docs/sorting-workflow-
  // spec.md, "Which piles show first"), from every category, spawns or not: a
  // takeover rarely has a spawn list. Same window and carry-over as events.
  const signalsOut = signalsFromFeed(feed).filter((sg) => !outsideWindow(Date.parse(sg.start), Date.parse(sg.end), now));
  const signals = carryOver(signalsOut, previous?.signals, now);
  for (const id of signals.carriedIds) console.log(`  ↩ carried over ended signal ${id}`);

  // The guard is on what the FEED produced, before the carry-over: a feed that
  // yields nothing is a broken upstream, and a snapshot made only of carried
  // records would hide that behind a card that still looks populated.
  if (eventsOut.length === 0) {
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn("⚠  No wild-spawn events in window; --offline-ok keeps existing cache.");
      return;
    }
    throw new Error("No wild-spawn events resolved — refusing to overwrite cache");
  }

  // Just-ended events come from the previous snapshot (leak-duck has already
  // dropped them); the result is chronological so the UI renders top-down.
  const events = carryOver(eventsOut, previous?.events, now);
  // A record carried from a snapshot written before spawnForms existed has only
  // its base names; resolve those. Regional spellings are already gone from
  // them, so such a record ranks on default forms until it ages out.
  // A copy, not an in-place write: the record may be the previous snapshot's
  // own object, which the fetchedAt comparison below still reads.
  events.merged = events.merged.map((rec) =>
    Array.isArray(rec.spawnForms)
      ? rec
      : { ...rec, spawnForms: spawnFormsFor([...(rec.spawns || []), ...(rec.unresolved || [])], nameIdx, formIdx, previousForms, missingForms) },
  );
  if (missingForms.size > 0) {
    console.warn(`  ⚠ no form/types for: ${[...missingForms].sort().join(", ")} — left out of the Mega ranking`);
  }

  for (const id of events.carriedIds) console.log(`  ↩ carried over ended event ${id}`);
  for (const id of eggPools.carriedIds) console.log(`  ↩ carried over ended egg pool ${id}`);

  // Preserve the previous fetchedAt when the resolved event set is unchanged so
  // the daily sync doesn't open a PR just because the timestamp moved. The UI's
  // "last sync · Xh ago" still reflects the last time the content actually moved.
  const newContent = { events: events.merged, eggPools: eggPools.merged, signals: signals.merged };
  let fetchedAt = new Date().toISOString();
  if (
    previous?.fetchedAt &&
    canonicalStringify({ events: previous.events, eggPools: previous.eggPools || [], signals: previous.signals || [] }) ===
      canonicalStringify(newContent)
  ) {
    fetchedAt = previous.fetchedAt;
    console.log("  ↺ content unchanged — preserving previous fetchedAt");
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  events: ${eventsOut.length} surfaced · ${events.carriedIds.length} carried over · ${skippedNoSpawns} without spawns · ${skippedWindow} outside window · ${skippedCategory} skipped categories · ${totalUnresolved} unresolved spawn names`);
  console.log(`  egg pools: ${eggPoolsOut.length} surfaced · ${eggPools.carriedIds.length} carried over`);
}

// Only run when executed directly — scripts/check-mega-boost.mjs imports
// resolveSpawnForm without triggering a fetch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
