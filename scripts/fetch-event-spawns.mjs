#!/usr/bin/env node
// Pulls the three "what's catchable right now" feeds from ScrapedDuck (the
// community scrape of LeekDuck.com) and writes a slim, shiny-aware artifact at
// src/data/event-spawns.json that App.jsx turns into paste-able PoGo filters.
//
// Three sources, all keyed to "available now / soon":
//   * events     — wild spawns featured in current + upcoming events. Only the
//                  event types that ship a structured species list are usable:
//                  community-day (extraData.communityday.spawns) and
//                  spotlight-hour (extraData.spotlight.list). Generic "event"
//                  weeks only carry a `hasSpawns` boolean in the feed — the
//                  actual species aren't enumerated upstream, so they're noted
//                  and skipped. Raid events are intentionally excluded; the app
//                  already has a dedicated Raids section for those.
//   * eggs       — the live Egg pool (eggs.min.json), grouped by hatch distance.
//   * research   — Pokémon obtainable from current Field Research task rewards.
//
// Each Pokémon carries a `canBeShiny` flag so the app can build a "shiny grind"
// filter (the species you'd paste into PoGo to see which featured shinies you're
// still missing). Identity is the base dex number parsed out of the LeekDuck
// icon URL (`.../pmNNN.icon.png`) — stable across locales and form suffixes, and
// a base-dex family search (`+vulpix`) catches every form anyway.
//
// Flags: --offline-ok   tolerate fetch failures if a previous artifact exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "event-spawns.json");

const BASE = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data";
const ENDPOINTS = {
  events:   `${BASE}/events.min.json`,
  eggs:     `${BASE}/eggs.min.json`,
  research: `${BASE}/research.min.json`,
};

// Active now + the next 30 days. Wider than the raid feed's 7-day window
// because Community Days / Spotlight Hours (the event types that actually ship
// a spawn list) are announced ~3 weeks out — a shiny grind is worth prepping
// for. Each event carries its own window teaser so "upcoming" is obvious.
const EVENT_LOOKAHEAD_MS = 30 * 24 * 60 * 60 * 1000;

// Raid events are surfaced by the Raids section already — skip them here so the
// Events filter stays about wild spawns / eggs / quests.
const SKIP_EVENT_TYPES = new Set([
  "raid-battles", "raid-hour", "raid-day", "raid-weekend",
  "go-battle-league", "go-pass", "season",
]);

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop event-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// LeekDuck icon URLs encode the base dex number: ".../pm996.icon.png",
// ".../pokemon_icons_crop/pm7.icon.png", ".../pm52_f2.icon.png" (Galarian).
// We want the leading dex digits only — a base-dex family search catches forms.
function dexFromImage(url) {
  const m = /\/pm0*(\d+)/i.exec(String(url || ""));
  if (!m) return null;
  const dex = parseInt(m[1], 10);
  return Number.isFinite(dex) && dex > 0 ? dex : null;
}

function makeMon(entry, canBeShiny) {
  const dex = dexFromImage(entry?.image);
  if (dex === null) return null;
  return {
    dex,
    name: entry?.name || `dex_${dex}`,
    canBeShiny: !!canBeShiny,
  };
}

// Dedupe a Pokémon list by dex; `canBeShiny` stays true if ANY source says so.
function dedupeByDex(mons) {
  const byDex = new Map();
  for (const m of mons) {
    if (!m) continue;
    const prev = byDex.get(m.dex);
    if (prev) prev.canBeShiny = prev.canBeShiny || m.canBeShiny;
    else byDex.set(m.dex, { ...m });
  }
  return [...byDex.values()].sort((a, b) => a.dex - b.dex);
}

// Pull featured wild spawns out of an event's extraData. Returns [] for event
// types that don't enumerate a species list (generic weeks, etc.).
function eventSpawns(event) {
  const ed = event?.extraData || {};
  const out = [];

  // Community Day — spawns[] plus a shinies[] list naming which can be shiny.
  const cd = ed.communityday;
  if (cd && Array.isArray(cd.spawns)) {
    const shinyNames = new Set(
      (cd.shinies || []).map(s => String(s?.name || "").toLowerCase()),
    );
    for (const s of cd.spawns) {
      out.push(makeMon(s, shinyNames.has(String(s?.name || "").toLowerCase())));
    }
  }

  // Spotlight Hour — list[] of rotating features, each with its own canBeShiny.
  const sp = ed.spotlight;
  if (sp) {
    const list = Array.isArray(sp.list) && sp.list.length > 0
      ? sp.list
      : (sp.name ? [{ name: sp.name, image: sp.image, canBeShiny: sp.canBeShiny }] : []);
    for (const s of list) out.push(makeMon(s, s?.canBeShiny));
  }

  // Generic structured spawns, when an event happens to carry them.
  if (Array.isArray(ed.spawns)) {
    for (const s of ed.spawns) out.push(makeMon(s, s?.canBeShiny));
  }

  return dedupeByDex(out);
}

function deriveEvents(eventsRaw) {
  const now = Date.now();
  const horizon = now + EVENT_LOOKAHEAD_MS;
  const out = [];
  let skippedNoList = 0;
  for (const event of (Array.isArray(eventsRaw) ? eventsRaw : [])) {
    if (SKIP_EVENT_TYPES.has(event?.eventType)) continue;
    const startMs = Date.parse(event.start);
    const endMs = Date.parse(event.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs < now) continue;       // already over
    if (startMs > horizon) continue; // beyond the 7-day lookahead
    const spawns = eventSpawns(event);
    if (spawns.length === 0) {
      // Event is in-window but upstream doesn't list its species (e.g. a
      // generic "event"-type week that only flags hasSpawns).
      if (event?.extraData?.generic?.hasSpawns) skippedNoList++;
      continue;
    }
    out.push({
      eventID: event.eventID,
      name: event.name,
      eventType: event.eventType,
      start: event.start,
      end: event.end,
      spawns,
    });
  }
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { events: out, skippedNoList };
}

function deriveEggs(eggsRaw) {
  const out = [];
  for (const e of (Array.isArray(eggsRaw) ? eggsRaw : [])) {
    const mon = makeMon(e, e?.canBeShiny);
    if (!mon) continue;
    out.push({ ...mon, eggType: e?.eggType || "" });
  }
  // Dedupe by (dex, eggType) — a species can sit in one distance tier.
  const seen = new Map();
  for (const m of out) {
    const key = `${m.dex}|${m.eggType}`;
    const prev = seen.get(key);
    if (prev) prev.canBeShiny = prev.canBeShiny || m.canBeShiny;
    else seen.set(key, m);
  }
  return [...seen.values()].sort(
    (a, b) => a.eggType.localeCompare(b.eggType) || a.dex - b.dex,
  );
}

function deriveResearch(researchRaw) {
  const mons = [];
  for (const task of (Array.isArray(researchRaw) ? researchRaw : [])) {
    for (const r of (task?.rewards || [])) {
      mons.push(makeMon(r, r?.canBeShiny));
    }
  }
  return dedupeByDex(mons);
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

  let eventsRaw, eggsRaw, researchRaw;
  try {
    console.log("→ Fetching ScrapedDuck events + eggs + research feeds");
    [eventsRaw, eggsRaw, researchRaw] = await Promise.all([
      fetchJson(ENDPOINTS.events),
      fetchJson(ENDPOINTS.eggs),
      fetchJson(ENDPOINTS.research),
    ]);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  const { events, skippedNoList } = deriveEvents(eventsRaw);
  const eggs = deriveEggs(eggsRaw);
  const research = deriveResearch(researchRaw);

  if (eggs.length === 0 && research.length === 0 && events.length === 0) {
    throw new Error("All three feeds derived empty — refusing to overwrite cache");
  }

  // Preserve fetchedAt when the stable pools (eggs + research) are unchanged so
  // the scheduled sync doesn't open a PR daily. `events` is excluded from the
  // hash: its window shifts every run by definition (filtered by `now`), so
  // including it would force a churn diff even when nothing material changed.
  const stableContent = { eggs, research };
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const prevStable = { eggs: prev.eggs, research: prev.research };
      if (canonicalStringify(prevStable) === canonicalStringify(stableContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ egg + research pools unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, events, eggs, research });
  const shiny = (arr) => arr.filter(m => m.canBeShiny).length;
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  events:   ${events.length} with species lists · ${skippedNoList} in-window but unlisted upstream`);
  console.log(`  eggs:     ${eggs.length} entries (${shiny(eggs)} shiny-eligible)`);
  console.log(`  research: ${research.length} reward species (${shiny(research)} shiny-eligible)`);
}

main().catch(e => { console.error(e); process.exit(1); });
