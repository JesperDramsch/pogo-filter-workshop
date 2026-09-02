#!/usr/bin/env node
// Pulls Great / Ultra / Master league rankings from PvPoke (MIT), dedupes by
// base dex number, takes the top N, and writes a slim per-league artifact at
// src/data/pvp-rankings.json that App.jsx imports at build time.
//
// PvPoke is the upstream every community PvP feed derives from, so we read it
// directly rather than through a mirror. lily-dex-api stays as the fallback: if
// PvPoke is unreachable or reshapes, we degrade to the old feed instead of
// publishing a hole. `source` records which one produced the file.
//
// The join: PvPoke's rankings carry `speciesId` but NO dex number. dex comes
// from gamemaster.min.json's `pokemon[]`, keyed by the same speciesId. That is
// the only reason we fetch the game master here.
//
// Why store dex + name pairs (not raw speciesIds): forms like
// `darmanitan_galarian_zen` need to fold into the base species so PoGo's
// family-search (`+darmanitan`) catches every form. dexNr is stable identity;
// speciesName is a locale fallback if our dex dict doesn't have a matching
// entry at render time. That fallback is why `name` must be the BASE name —
// App.jsx:3865 falls back to `s.name.toLowerCase()`, and a stored
// "Quagsire (Shadow)" would emit `+quagsire (shadow)`, a filter token with a
// space in it that matches nothing.
//
// Cups come from the game master's `formats[]` (15 entries carrying the
// {cup, cp, title} triple the ranking path needs) — NOT its `cups[]`, which has
// no CP field and includes the non-cups `all` and `custom`. Each format is
// paired with the ScrapedDuck GBL event windows that name it, so the app can
// render an "active cup" card that hides itself outside the cup's run.
//
// That pairing is per battle SLOT, not per event: a GBL week runs three
// concurrent slots and names all of them in one string. scripts/lib/gbl-slots.mjs
// does the splitting and the matching, for both source paths, and its header
// records what matching the flattened event instead cost.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, writeJson, readPreviousJson } from "./lib/json.mjs";
import { loadNameDict, unresolvableDexEntries, NAME_LOCALES } from "./lib/species-dex.mjs";
import { eventSlots, leaguesForSlots, matchEventFormats } from "./lib/gbl-slots.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "pvp-rankings.json");
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");

const PVPOKE_BASE = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data";
const GAMEMASTER = `${PVPOKE_BASE}/gamemaster.min.json`;
const rankingsUrl = (cup, cp) => `${PVPOKE_BASE}/rankings/${cup}/overall/rankings-${cp}.json`;

const LILY_DEX = "https://mknepprath.github.io/lily-dex-api/rankings.json";
const SCRAPED_DUCK_EVENTS = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json";

const TOP_N = 30;
// How deep into a ranking list we look. Far enough past TOP_N to fold every
// alternate form of a top-30 species into its base entry, shallow enough that a
// tail of unranked junk can't skew the join-miss ratio.
const SCAN_DEPTH = 300;
// A gamemaster reshape looks like a sudden inability to resolve speciesIds.
const MAX_JOIN_MISS_RATIO = 0.05;

const LEAGUES = {
  great:  { cpCap: 1500 },
  ultra:  { cpCap: 2500 },
  master: { cpCap: 10000 },
};
// What the app writes out as the CP clause. Master has no cap in game, so
// buildLeagueFilter skips its IV math entirely — represent that as null even
// though PvPoke addresses the file as `rankings-10000.json`.
const STORED_CP_CAP = { great: 1500, ultra: 2500, master: null };
// PvPoke addresses the uncapped league as cp 10000. Stored as null so
// buildLeagueFilter skips the CP clause AND the rank-1 IV math: with no cap to
// squeeze under, a low-attack spread is worse than a hundo, not better.
const storedCap = (cp) => (typeof cp === "number" && cp < 10000 ? cp : null);

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop pvp-fetcher/2.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Cup ranking files legitimately 404 — not every (cup, cap) pair is published.
async function fetchJsonOrNull(url) {
  try {
    return await fetchJson(url);
  } catch (e) {
    console.warn(`  ⚠  ${e.message}`);
    return null;
  }
}

// Small pool so a burst of cup fetches can't trip GitHub's 60-requests-per-hour
// unauthenticated cap as a 429 storm.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const stripForm = (name) => String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();

// speciesId → {dex, speciesName}, plus dex → base (suffix-free) species name.
// The base name matters: it is what App.jsx falls back to when the dex dict
// misses, and a parenthesised form name there produces a broken filter token.
function buildSpeciesIndex(gm) {
  const bySpeciesId = new Map();
  const baseNameByDex = new Map();
  for (const p of gm?.pokemon || []) {
    if (typeof p?.dex !== "number" || typeof p?.speciesId !== "string") continue;
    bySpeciesId.set(p.speciesId, { dex: p.dex, speciesName: p.speciesName || "" });
    // First parenthesis-free name wins; that is the base species.
    if (!baseNameByDex.has(p.dex) && p.speciesName && !p.speciesName.includes("(")) {
      baseNameByDex.set(p.dex, p.speciesName);
    }
  }
  return { bySpeciesId, baseNameByDex };
}

// Dedupe by dex (forms collapse to base species — `+raichu` already catches
// both regular and Alolan via family search). Preserve PvPoke's score order.
// The folded-away forms are kept as metadata: which form is the RANKED one is a
// real collection signal (a Shadow ranking above its base means build the
// Shadow), even though it cannot change the emitted filter token.
function topNFromPvpoke(rankings, index, n) {
  if (!Array.isArray(rankings)) return { list: [], scanned: 0, missed: 0 };
  const byDex = new Map();
  const out = [];
  let scanned = 0;
  let missed = 0;
  for (const entry of rankings.slice(0, SCAN_DEPTH)) {
    const speciesId = entry?.speciesId;
    if (typeof speciesId !== "string") continue;
    scanned++;
    const meta = index.bySpeciesId.get(speciesId);
    if (!meta) { missed++; continue; }
    const existing = byDex.get(meta.dex);
    if (existing) { existing.forms.push(speciesId); continue; }
    const record = {
      dex: meta.dex,
      name: index.baseNameByDex.get(meta.dex) || stripForm(meta.speciesName) || `dex_${meta.dex}`,
      speciesId,
      score: typeof entry.score === "number" ? entry.score : null,
      forms: [speciesId],
    };
    byDex.set(meta.dex, record);
    if (out.length < n) out.push(record);
  }
  return { list: out, scanned, missed };
}

// lily-dex fallback: its entries already carry dexNr, so no join is needed.
function topNByDex(rankings, n) {
  if (!Array.isArray(rankings)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of rankings) {
    const dex = entry?.dexNr;
    if (typeof dex !== "number" || seen.has(dex)) continue;
    seen.add(dex);
    out.push({ dex, name: stripForm(entry.speciesName) || `dex_${dex}` });
    if (out.length >= n) break;
  }
  return out;
}

// ---------------------------------------------------------------- PvPoke path

async function fromPvpoke() {
  console.log("→ PvPoke: game master");
  const gm = await fetchJson(GAMEMASTER);
  const index = buildSpeciesIndex(gm);
  if (index.bySpeciesId.size === 0) throw new Error("game master carried no pokemon[] — refusing");
  console.log(`  ${index.bySpeciesId.size} speciesIds indexed`);

  console.log("→ PvPoke: standing leagues");
  const leagues = {};
  for (const [key, meta] of Object.entries(LEAGUES)) {
    const raw = await fetchJson(rankingsUrl("all", meta.cpCap));
    const { list, scanned, missed } = topNFromPvpoke(raw, index, TOP_N);
    if (scanned > 0 && missed / scanned > MAX_JOIN_MISS_RATIO) {
      throw new Error(
        `${key}: ${missed}/${scanned} speciesIds failed the dex join — game master reshaped?`,
      );
    }
    if (list.length === 0) throw new Error(`${key}: no rankings survived the join`);
    leagues[key] = { cpCap: STORED_CP_CAP[key], species: list };
    console.log(`  ${key}: ${list.length} species (${missed} join misses of ${scanned} scanned)`);
  }

  return { leagues, index, formats: gm?.formats || [] };
}

// Shared by both source paths. The event record's shape and its ordering must
// not depend on which upstream produced the cups: the fallback path never runs
// in CI, so a divergence here would only ever surface on the day the primary
// source breaks.
//
// `formatsFor(slots)` returns the formats this event's slots are running.
function buildGblEvents(sdEvents, formatsFor) {
  const out = [];
  for (const e of (Array.isArray(sdEvents) ? sdEvents : [])) {
    if (e?.eventType !== "go-battle-league") continue;
    // An unparseable `start` makes the comparator below return NaN, which sort
    // treats as "equal" — leaving the array in an arbitrary order that every
    // consumer (the cup window in the generated reference, the app's active-cup
    // card) then reads as chronological. Drop the entry rather than corrupt the
    // order of the rest.
    if (!Number.isFinite(Date.parse(e.start))) {
      console.warn(`  ⚠  GBL event with unparseable start dropped: ${e.eventID || e.name}`);
      continue;
    }
    const slots = eventSlots(e.eventID, e.name);
    // Deduped: the same cup can be named by the slug segment AND by the display
    // name slot it corresponds to, which are matched independently.
    const cups = [...new Set(formatsFor(slots).map(f => `${f.cup}-${f.cp}`))];
    out.push({
      eventID: e.eventID,
      name: e.name,
      start: e.start,
      end: e.end,
      cups,
      leagues: leaguesForSlots(slots),
    });
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

async function buildCups(formats, index, sdEvents) {
  const wanted = new Map(); // `${cup}-${cp}` → format
  const gblEvents = buildGblEvents(sdEvents, (slots) => {
    const matched = matchEventFormats(formats, slots);
    for (const f of matched) wanted.set(`${f.cup}-${f.cp}`, f);
    return matched;
  });

  const entries = [...wanted.entries()];
  if (entries.length > 0) console.log(`→ PvPoke: ${entries.length} cup ranking file(s)`);
  const fetched = await mapLimit(entries, 3, async ([id, f]) => {
    const raw = await fetchJsonOrNull(rankingsUrl(f.cup, f.cp));
    if (!raw) return null;
    const { list } = topNFromPvpoke(raw, index, TOP_N);
    if (list.length === 0) return null;
    return [id, {
      id,
      cup: f.cup,
      meta: f.meta || f.cup,
      name: f.title || id,
      cpCap: storedCap(f.cp),
      species: list,
    }];
  });

  const cups = {};
  for (const row of fetched) if (row) cups[row[0]] = row[1];
  // Drop ids we could not fetch, so gblEvents never references a missing cup.
  for (const e of gblEvents) e.cups = e.cups.filter(id => cups[id]);
  // `matchedCount` is how many (cup, cap) pairs the live event feed asked for,
  // counted BEFORE any ranking file was fetched. It is what lets the collapse
  // guard tell "no cup is running this week" from "we lost the cups we wanted".
  return { cups, gblEvents, matchedCount: wanted.size };
}

// -------------------------------------------------------------- lily-dex path

function fromLilyDex(raw) {
  const leagues = {};
  for (const key of Object.keys(LEAGUES)) {
    const list = topNByDex(raw?.[key], TOP_N);
    if (list.length === 0) continue;
    leagues[key] = { cpCap: STORED_CP_CAP[key], species: list };
  }
  const cups = {};
  // The same {cup, cp} shape the game master's formats[] has, so the event
  // matcher is literally the same code on both paths. lily has no formats[] of
  // its own; the cups it ships ARE the published set.
  const formats = [];
  for (const cup of raw?.cups || []) {
    if (!cup || typeof cup.id !== "string") continue;
    const list = topNByDex(cup.rankings, TOP_N);
    if (list.length === 0) continue;
    // Keyed `${cup}-${cp}`, exactly as the PvPoke path does. lily carries `cp`,
    // so the same cup gets the same id from either upstream. A bare `cup.id`
    // here collapsed the three Mega caps onto one entry — the app would render
    // one cup card instead of three — and silently changed the snapshot's cup
    // identity space for the duration of a fallback, then changed it back.
    //
    // A cup with no numeric `cp` is skipped rather than defaulted. Guessing a
    // cap is not available to us: `storedCap` maps a non-number to null, and
    // buildLeagueFilter reads a null cap as "uncapped" — so the cup would ship
    // as a species-pool-only filter with no CP clause and no rank-1 IV clauses,
    // which is a WRONG filter that looks right. (A genuinely uncapped cup is
    // unaffected: lily gives it cp 10000, a number, which storedCap maps to null
    // on purpose.) There is also no honest id for it, since the cap is the half
    // of the key that disambiguates a cup published at several caps.
    if (typeof cup.cp !== "number") {
      console.warn(`  ⚠  lily cup "${cup.id}" has no numeric cp — skipping (cannot key or cap it)`);
      continue;
    }
    const id = `${cup.id}-${cup.cp}`;
    cups[id] = {
      id,
      cup: cup.id,
      meta: cup.id,
      name: cup.name || cup.id,
      cpCap: storedCap(cup.cp),
      species: list,
    };
    formats.push({ cup: cup.id, cp: cup.cp });
  }
  return { leagues, cups, formats };
}

// ---------------------------------------------------------------------- guards

// Every emitted dex must resolve in the name dictionary App.jsx renders from,
// in every locale. This is check-data-filters D6 pushed back to the data layer,
// where the diagnostic can name the offending dex — so it must be the SAME test
// D6 runs, not a weaker local copy, or the fetcher publishes what CI rejects.
// Shared with D6 via scripts/lib/species-dex.mjs.
//
// An unreadable dictionary is fatal rather than skipped: skipping turned the one
// guard standing between a bad join and a published snapshot into a no-op
// exactly when something was already wrong. main() routes the throw through
// --offline-ok, so the cached snapshot still covers a build.
function assertDexResolvable(leagues, cups) {
  const dict = loadNameDict(NAMES_PATH);
  const pools = [
    ...Object.entries(leagues).map(([key, l]) => [key, l.species]),
    ...Object.entries(cups).map(([id, c]) => [id, c.species]),
  ];
  const bad = unresolvableDexEntries(pools, dict, NAME_LOCALES);
  if (bad.length > 0) {
    throw new Error(`dex numbers unresolvable in pokemon-names.json: ${bad.join(", ")}`);
  }
}

// Mirrors refresh-meta.py's MIN_SPECIES_PER_LEAGUE. The invariant belongs at the
// producer too: this is where the hole gets written, and neither D6 (shape) nor
// M2 (agreement with the reference) counts species, so a three-species Great
// League would pass CI and ship a filter naming three Pokémon.
const MIN_SPECIES_PER_LEAGUE = 20;

function assertLeaguesHealthy(prev, leagues) {
  if (!leagues || Object.keys(leagues).length === 0) {
    throw new Error("All leagues came back empty — refusing to overwrite cache");
  }
  const thin = [];
  const shrunk = [];
  for (const [key, l] of Object.entries(leagues)) {
    const now = l.species?.length || 0;
    if (now < MIN_SPECIES_PER_LEAGUE) thin.push(`${key}=${now}`);
    const was = prev?.leagues?.[key]?.species?.length || 0;
    if (was > 0 && now < was) shrunk.push(`${key} ${was} → ${now}`);
  }
  if (thin.length > 0) {
    throw new Error(
      `league(s) under ${MIN_SPECIES_PER_LEAGUE} species (${thin.join(", ")}) — refusing to overwrite cache`,
    );
  }
  // A one- or two-species dip is ordinary dedupe noise (two forms folding into
  // one base), so it is reported rather than fatal; the floor above is the guard.
  if (shrunk.length > 0) console.warn(`  ⚠  league(s) shrank: ${shrunk.join(", ")}`);
}

// Cups rotating out is normal — most GBL weeks are plain Great/Ultra/Master, and
// the generated META.md says so in as many words. Treating that as fatal meant
// the daily sync would start failing the week the current cup ended, freezing
// the snapshot with nothing but a red cron job to say so.
//
// The real failure is different: the live event feed named cups and NONE of them
// survived the fetch. `matchedCount` is that count, taken before any ranking file
// was requested, so zero means "no cup is running" and an empty result is the
// correct answer. Pass null when the count is unknown (the lily-dex path), which
// downgrades this to the reporting below.
function assertNoCupCollapse(prev, cups, matchedCount) {
  const before = Object.keys(prev?.cups || {}).length;
  const after = Object.keys(cups).length;
  if (matchedCount > 0 && after === 0) {
    throw new Error(
      `${matchedCount} cup(s) named by live events, 0 published — refusing to overwrite cache`,
    );
  }
  if (after === 0 && before > 0) {
    console.log("  ↺ cups rotated out — no live GBL event names a cup (normal)");
  } else if (after < before) {
    console.warn(`  ⚠  cups ${before} → ${after} (rotation, or a matcher regression)`);
  }
}

// ------------------------------------------------------------------------ main

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");
  const prev = readPreviousJson(OUT_PATH);

  let sdEvents = [];
  try {
    sdEvents = await fetchJson(SCRAPED_DUCK_EVENTS);
  } catch (e) {
    console.warn(`⚠  ScrapedDuck events unavailable (${e.message}) — cups will be inactive`);
  }

  let leagues = null;
  let cups = {};
  let gblEvents = [];
  let source = "pvpoke";
  let matchedCount = null;

  try {
    const pv = await fromPvpoke();
    leagues = pv.leagues;
    const built = await buildCups(pv.formats, pv.index, sdEvents);
    cups = built.cups;
    gblEvents = built.gblEvents;
    matchedCount = built.matchedCount;
  } catch (e) {
    console.error(`✗ PvPoke failed: ${e.message}`);
    console.warn("→ falling back to lily-dex-api");
    try {
      const raw = await fetchJson(LILY_DEX);
      const lily = fromLilyDex(raw);
      if (Object.keys(lily.leagues).length === 0) throw new Error("lily-dex returned no leagues");
      leagues = lily.leagues;
      cups = lily.cups;
      source = "lily-dex";
      // Same event builder AND the same slot matcher the PvPoke path uses —
      // only the format list differs. The fallback never runs in CI, so a
      // second matcher here would only ever be found wrong on the day the
      // primary source breaks, which is the one day it runs.
      gblEvents = buildGblEvents(sdEvents, (slots) => matchEventFormats(lily.formats, slots));
    } catch (e2) {
      console.error(`✗ Fallback failed: ${e2.message}`);
      if (offlineOk && existsSync(OUT_PATH)) {
        console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
        return;
      }
      process.exit(1);
    }
  }

  // The post-fetch guards belong INSIDE --offline-ok's protection. They reject
  // the data we just fetched, and rejecting it means the committed cache is the
  // better answer — not that the build should die. `prebuild` runs this with
  // --offline-ok, so a throw out here took down `npm run build` and the Pages
  // deploy over a data-shape problem the cached snapshot already solved.
  try {
    assertLeaguesHealthy(prev, leagues);
    assertDexResolvable(leagues, cups);
    assertNoCupCollapse(prev, cups, matchedCount);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  const newContent = { topN: TOP_N, source, leagues, cups, gblEvents };
  let fetchedAt = new Date().toISOString();
  if (prev) {
    const { fetchedAt: _prev, ...prevContent } = prev;
    if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
      fetchedAt = prev.fetchedAt;
      console.log("  ↺ content unchanged — preserving previous fetchedAt");
    }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  const total = Object.values(leagues).reduce((n, l) => n + l.species.length, 0);
  const cupTotal = Object.values(cups).reduce((n, c) => n + c.species.length, 0);
  console.log(`✓ wrote ${OUT_PATH} (source: ${source})`);
  console.log(`  ${Object.keys(leagues).length} leagues, ${total} species total (top ${TOP_N} each, deduped by dex)`);
  console.log(`  ${Object.keys(cups).length} cups, ${cupTotal} species; ${gblEvents.length} GBL event windows`);
}

main().catch(e => { console.error(e); process.exit(1); });
