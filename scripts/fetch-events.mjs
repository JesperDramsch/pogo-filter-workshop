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
// BONUSES: the same pass keeps every event's `details.bonuses` strings in a
// separate array, `bonuses`, from every category, spawns or not (a Season or a GO
// Pass has bonuses and no spawn list). Same window and carry-over as the rest.
// src/bonus-nudges.js reads them into the "use this filter now" strip; any
// phrasing it does not recognise is logged here, so a wording change on Leek
// Duck's side shows up in the sync log rather than as a nudge that went quiet.
//
// TIME FORMS: the feed spells a time two ways, and `is_local_time` says which.
// A local-time event carries a naive wall-clock string ("2026-11-14T10:00:00");
// a fixed-time one (GO Battle League rotations, the city Wild Area / GO Tour /
// Night Out events) carries epoch SECONDS as a number. Date.parse on a number
// is NaN, and until scripts/lib/feed-time.mjs every pass here `continue`d on
// that without a count or a line, so every fixed-time event was dropped in
// silence; the feed's visible history (May 2026 on) has always spelt them so.
// Every window now goes through feedWindow there, which reads both forms and
// hands back the string the id and the snapshot record carry: the feed's own
// string, or the number's UTC ISO stamp ("2026-11-06T01:00:00Z"). An event
// whose window still cannot be read is logged once and counted in the summary
// line, never skipped quietly again.
//
// Fixed-time events are, on every feed seen so far, the in-person ones: a city
// Wild Area, a GO Tour host city, a Night Out, and the GBL rotations (which
// carry no bonus, spawn or egg list and never reach a record).
//
// VENUES: the feed does not say where an in-person event is held, only the
// title does ("… Wild Area 2026: Sendai • Tohoku"). scripts/lib/event-venues.mjs
// is a short pinned table of those cities, keyed by a title pattern, and every
// record written here (events, eggPools, bonuses) carries `venue`: the city as
// { name, lat, lng }, or null. The app (src/bonus-nudges.js) shows a venue's
// bonuses only to a home pin within 150 km of it and folds a far venue's row
// on the card with its distance, so "½ Stardust for trades" that holds for
// ticket holders in Sendai never reaches a player in Bonn, while a traveller
// still has the spawn list for the tidy-up. A fixed-time event that no row
// matches is logged (⚠ in-person event with no venue …) and its bonuses stay
// out of `bonuses` until a row is added: the safe failure mode. A local-time
// event is global and keeps its bonuses with `venue: null`, unless a row
// matches it: City Safari is spelt as local time and is in-person all the same.
//
// SHRINK GUARD: the fetcher used to refuse only a feed that yielded no event at
// all. A scrape that comes back half-written passes that test with one event
// in hand, and the carry-over cannot fill the gap: it keeps events that have
// started, never upcoming ones the feed stopped listing. So after the merge,
// guardShrunkEvents compares what is about to be written with the cached list
// still inside the window (scripts/lib/event-window.mjs, shrunkEvents) and
// refuses to overwrite the cache when most of it went missing, with a ✗ line
// the sync summary shows against the Events row. Events that aged past
// retention do not count as missing: the daily sync is meant to drop those.
//
// Flags:
//   --offline-ok     tolerate fetch failures, and a refused result, if
//                    src/data/events.json exists (the build uses the cache).
//   --accept-shrink  write a result the shrink guard would refuse. For the day
//                    upstream really did withdraw most upcoming events; the
//                    refusal names the flag.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalStringify, writeJson, readPreviousJson } from "./lib/json.mjs";
import { outsideWindow, carryOver, isRetitleOf, shrunkEvents } from "./lib/event-window.mjs";
import { parseFeedTime, feedWindow, describeUnparseableWindow } from "./lib/feed-time.mjs";
import { venueOf, isFixedTimeEvent } from "./lib/event-venues.mjs";
import { LEGACY_COMMUNITY_DAYS, LEGACY_THROUGH, communityDaysFromFeed, mergeRollingCommunityDays } from "./lib/community-days.mjs";
import { isTakeoverEvent } from "./lib/rocket-takeover.mjs";
import { fetchGameMaster, mechanicsBatchFloor, warnIfStale } from "./lib/game-master.mjs";
import { buildNameIndex as buildFormIndex, resolveBossKey } from "./fetch-raid-bosses.mjs";
import { unrecognisedBonuses } from "../src/bonus-nudges.js";

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
//
// `start` is the NORMALISED start (feedWindow's `start`): the feed's own string
// for a local-time event, so every id that exists today is unchanged, and the
// UTC ISO stamp for a fixed-time one, "…-2026-11-06t01-00-00z" rather than the
// bare epoch digits. The stamp is the instant ScrapedDuck's scrape of the same
// page carries (it writes ".000Z"; the minute prefix takeoverId keys on agrees),
// and should upstream ever flip such an event to that zoned spelling without
// the milliseconds, the id survives it. A flip to a NAIVE string cannot be
// caught here: that spelling would be a different claim about the event (local
// time), and a new id is the honest outcome of it.
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
// `report(ev, category)` is told about every event whose window did not parse.
export function signalsFromFeed(feed, report = () => {}) {
  const out = [];
  for (const [category, list] of Object.entries(feed || {})) {
    if (!Array.isArray(list)) continue;
    for (const ev of list) {
      const window = feedWindow(ev);
      if (!window) { report(ev, category); continue; }
      const { start, end } = window;
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

// Every event's bonus strings as { id, title, category, start, end,
// isLocalTime, venue, bonuses }, from every category, spawns or not.
// Window-filtered like the rest; an event with no bonuses or no parseable
// window is left out, and `report(ev, category)` is told about the latter. A
// fixed-time event (`is_local_time: false`) with no venue is left out too and
// `reportVenue(ev, category)` told: see VENUES in the header, its bonuses hold
// in one city nobody has placed yet. The signals pass still reads every event,
// so an unparseable window is reported regardless.
export function bonusesFromFeed(feed, now, report = () => {}, reportVenue = () => {}) {
  const out = [];
  for (const [category, list] of Object.entries(feed || {})) {
    if (!Array.isArray(list)) continue;
    for (const ev of list) {
      const bonuses = (ev?.details?.bonuses || [])
        .map((b) => (typeof b === "string" ? b : b?.text || b?.name || ""))
        .map((b) => b.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (bonuses.length === 0) continue;
      const window = feedWindow(ev);
      if (!window) { report(ev, category); continue; }
      if (outsideWindow(window.startMs, window.endMs, now)) continue;
      const venue = venueOf(ev, category, reportVenue);
      if (!venue && isFixedTimeEvent(ev)) continue;
      out.push({
        id: slugId(category, ev.title, window.start),
        title: ev.title,
        category,
        start: window.start,
        end: window.end,
        isLocalTime: !!ev.is_local_time,
        venue,
        bonuses: [...new Set(bonuses)],
      });
    }
  }
  return out;
}

// EGG POOLS, collected from EVERY category (a Season has eggs but no spawns
// and would otherwise never be visited; SKIP_CATEGORIES only mutes wild-spawn
// noise, not eggs). Feed items are { name, ... } objects. Returns the records
// as { eggPools, unresolvedCount }; `report` and `reportVenue` are told about
// an unparseable window and an in-person event with no venue (see VENUES).
export function eggPoolsFromFeed(feed, now, nameIdx, { report = () => {}, reportVenue = () => {} } = {}) {
  const eggPools = [];
  let unresolvedCount = 0;
  for (const [category, list] of Object.entries(feed || {})) {
    if (!Array.isArray(list)) continue;
    for (const event of list) {
      const eggs = event?.details?.eggs;
      if (!Array.isArray(eggs) || eggs.length === 0) continue;

      const window = feedWindow(event);
      if (!window) { report(event, category); continue; }
      if (outsideWindow(window.startMs, window.endMs, now)) continue;

      const { spawnDex: eggDex, spawns: eggNames, unresolved } = resolveSpawns(eggs, nameIdx);
      if (eggDex.length === 0) continue;
      if (unresolved.length > 0) {
        unresolvedCount += unresolved.length;
        console.warn(`  ⚠ "${event.title}" eggs: unresolved names — ${unresolved.join(", ")}`);
      }

      eggPools.push({
        id: `${slugId(category, event.title, window.start)}-eggs`,
        title: event.title,
        category,
        start: window.start,
        end: window.end,
        isLocalTime: !!event.is_local_time,
        venue: venueOf(event, category, reportVenue),
        eggDex,
        eggs: eggNames,
        unresolved,
      });
    }
  }
  return { eggPools, unresolvedCount };
}

// WILD-SPAWN EVENTS: one record per event with a spawn list or Field Research
// encounters inside the window, minus SKIP_CATEGORIES.
//
// `details.spawns` is Leek Duck's whole "Spawns" section, sub-sections
// included: habitat hours, mighty Pokémon and Incense encounters all land in
// it (Wild Area 2026: Global, 2026-11-13). Field Research rewards are a
// separate list, `details.research`, and before 2026-11-13 were dropped here,
// so a research-only species never reached the event's pile. They are kept as
// `researchDex` / `research`, apart from `spawnDex`: the Mega planner ranks
// the wild pool only (spawnForms), while the event pile and the friend-collect
// set want everything the event puts in the bag. `formIdx`, `previousForms` and `missingForms` are the
// spawn-form inputs (see the header): the game-master name index when a mirror
// answered, else the previous snapshot's forms by name, and the set every name
// with no form is added to. Returns { events, skippedNoSpawns, skippedWindow,
// skippedCategory, unresolvedCount } for the summary line.
export function eventsFromFeed(feed, now, nameIdx, {
  formIdx = null,
  previousForms = new Map(),
  missingForms = new Set(),
  report = () => {},
  reportVenue = () => {},
} = {}) {
  const events = [];
  let skippedNoSpawns = 0;
  let skippedWindow = 0;
  let skippedCategory = 0;
  let unresolvedCount = 0;
  for (const [category, list] of Object.entries(feed || {})) {
    if (SKIP_CATEGORIES.has(category)) { skippedCategory += (Array.isArray(list) ? list.length : 0); continue; }
    if (!Array.isArray(list)) continue;
    for (const event of list) {
      const spawns = Array.isArray(event?.details?.spawns) ? event.details.spawns : [];
      const research = Array.isArray(event?.details?.research) ? event.details.research : [];
      if (spawns.length === 0 && research.length === 0) { skippedNoSpawns++; continue; }

      const window = feedWindow(event);
      if (!window) { report(event, category); continue; }
      if (outsideWindow(window.startMs, window.endMs, now)) { skippedWindow++; continue; }

      const wild = resolveSpawns(spawns, nameIdx);
      const res = resolveSpawns(research, nameIdx);
      const { spawnDex, spawns: spawnNames } = wild;
      const unresolved = [...new Set([...wild.unresolved, ...res.unresolved])].sort();
      if (spawnDex.length === 0 && res.spawnDex.length === 0) {
        console.warn(`  ⚠ "${event.title}": no spawns resolved (${unresolved.join(", ")}) — skipped`);
        continue;
      }
      if (unresolved.length > 0) {
        unresolvedCount += unresolved.length;
        console.warn(`  ⚠ "${event.title}": unresolved spawns — ${unresolved.join(", ")}`);
      }

      events.push({
        id: slugId(category, event.title, window.start),
        title: event.title,
        category,
        start: window.start,
        end: window.end,
        isLocalTime: !!event.is_local_time,
        venue: venueOf(event, category, reportVenue),
        spawnDex,
        spawns: spawnNames,
        spawnForms: spawnFormsFor(spawns, nameIdx, formIdx, previousForms, missingForms),
        researchDex: res.spawnDex,
        research: res.spawns,
        unresolved,
        // Costumed spawns or research encounters ("Piplup wearing a …"): the
        // sorting tab floats the costume pile up after such an event. The
        // names above are stripped.
        hasCostumes: hasCostumedSpawns(spawns) || hasCostumedSpawns(research),
      });
    }
  }
  return { events, skippedNoSpawns, skippedWindow, skippedCategory, unresolvedCount };
}

// The Community Day background pile's species (scripts/lib/community-days.mjs):
// the pinned legacy list plus every Community Day this feed has ever listed.
// Runs before the wild-spawn guard below, so a day with no spawn events still
// records a new Community Day. Append-only, and it refuses to write a rolling
// list shorter than the one on disk.
function writeCommunityDays(feed, nameIdx, reportUnparseable) {
  const previous = readPreviousJson(CD_PATH);
  const { days: fresh, unresolved } = communityDaysFromFeed(feed, (spawns) => resolveSpawns(spawns, nameIdx), reportUnparseable);
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
  // Only days not already pinned or listed count: the feed keeps showing a
  // day until it ends, and one already in the list needs nothing more.
  const known = new Set([...LEGACY_COMMUNITY_DAYS, ...rolling].map((cd) => `${cd.date}|${cd.event.toLowerCase()}`));
  return unresolved.filter((cd) => cd.date > LEGACY_THROUGH && !known.has(`${cd.date}|${cd.event.toLowerCase()}`));
}

// The shrink guard's decision, in the shape of the raid fetcher's
// guardEmptiedFamilies: the measurement from shrunkEvents, plus whether to
// write and how to exit. A refused result is never written; under --offline-ok
// the cache stands and the build goes on (exit 0), in the sync the step fails
// (exit 1) and the summary shows the ✗ line. --accept-shrink writes it anyway.
export function guardShrunkEvents(previous, merged, now, { offlineOk = false, acceptShrink = false } = {}) {
  const shrink = shrunkEvents(previous, merged, now);
  if (!shrink.refused || acceptShrink) return { ...shrink, write: true, exitCode: 0 };
  return { ...shrink, write: false, exitCode: offlineOk ? 0 : 1 };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");
  const acceptShrink = args.has("--accept-shrink");

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

  // An event whose window cannot be read (see TIME FORMS in the header) is
  // noted once, by whichever pass meets it first, logged after the passes and
  // counted in the summary line. Each pass skips it, as before; the silence is
  // what goes.
  const unparseable = new Map();
  const reportUnparseable = (ev, category) => {
    const key = `${category}|${ev?.title}`;
    if (!unparseable.has(key)) unparseable.set(key, `"${ev?.title}" (${category}): ${describeUnparseableWindow(ev)}`);
  };
  // An in-person event with no row in scripts/lib/event-venues.mjs (see VENUES
  // in the header): noted once across the passes, logged after them, counted
  // in the summary line. Its bonuses are left out until a row is added.
  const unmappedVenues = new Map();
  const reportUnmappedVenue = (ev, category) => {
    const key = `${category}|${ev?.title}`;
    if (!unmappedVenues.has(key)) unmappedVenues.set(key, `"${ev?.title}" (${category})`);
  };

  // A Community Day whose featured names don't all resolve is held back (see
  // communityDaysFromFeed). The rest of the sync still writes; the run fails
  // at the end so the gap is seen the same day.
  const heldBack = writeCommunityDays(feed, nameIdx, reportUnparseable);

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

  // The egg and wild-spawn passes (eggPoolsFromFeed, eventsFromFeed below).
  const eggsPass = eggPoolsFromFeed(feed, now, nameIdx, { report: reportUnparseable, reportVenue: reportUnmappedVenue });
  const eggPoolsOut = eggsPass.eggPools;
  const eggPools = carryOver(eggPoolsOut, previous?.eggPools, now);

  const eventsPass = eventsFromFeed(feed, now, nameIdx, { formIdx, previousForms, missingForms, report: reportUnparseable, reportVenue: reportUnmappedVenue });
  const eventsOut = eventsPass.events;
  const { skippedNoSpawns, skippedWindow, skippedCategory } = eventsPass;
  const totalUnresolved = eggsPass.unresolvedCount + eventsPass.unresolvedCount;

  // Event kinds the sorting tab floats piles up for (docs/sorting-workflow-
  // spec.md, "Which piles show first"), from every category, spawns or not: a
  // takeover rarely has a spawn list. Same window and carry-over as events.
  const signalsOut = signalsFromFeed(feed, reportUnparseable).filter((sg) => !outsideWindow(parseFeedTime(sg.start), parseFeedTime(sg.end), now));
  const signals = carryOver(signalsOut, previous?.signals, now);
  for (const id of signals.carriedIds) console.log(`  ↩ carried over ended signal ${id}`);

  // Event bonuses (see the header), from every category. A feed that lists
  // events but no bonus at all most likely moved the field; say so loudly.
  const bonusesOut = bonusesFromFeed(feed, now, reportUnparseable, reportUnmappedVenue);
  const bonuses = carryOver(bonusesOut, previous?.bonuses, now);
  for (const id of bonuses.carriedIds) console.log(`  ↩ carried over ended bonuses ${id}`);
  if (bonusesOut.length === 0 && (previous?.bonuses || []).length > 0) {
    console.warn("  ⚠ the feed carried no event bonuses at all; did details.bonuses move?");
  }
  const unknownBonuses = unrecognisedBonuses(bonusesOut);
  if (unknownBonuses.length > 0) {
    console.warn(`  ⚠ unrecognised bonus phrasings (no nudge, see src/bonus-nudges.js) — ${unknownBonuses.join(" · ")}`);
  }

  // Every pass is done; say which events none of them could place in time. A
  // third spelling of a time upstream would otherwise vanish exactly the way the
  // numeric one did (see TIME FORMS in the header).
  for (const line of unparseable.values()) {
    console.warn(`  ⚠ unparseable event window, skipped by every pass — ${line}`);
  }
  for (const line of unmappedVenues.values()) {
    console.warn(`  ⚠ in-person event with no venue in scripts/lib/event-venues.mjs — ${line}: its bonuses stay out of the nudge strip until a row is added`);
  }

  // A refused result takes the raid fetcher's route (keepCacheOrExit there):
  // the committed cache is the better answer, so under --offline-ok the build
  // goes on with it, and in the sync the step fails with the ✗ line the job
  // summary shows against the Events row.
  const keepCacheOrExit = (message) => {
    console.error(`✗ ${message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      failOnHeldBack(heldBack, offlineOk);
      return;
    }
    process.exit(1);
  };

  // The guard is on what the FEED produced, before the carry-over: a feed that
  // yields nothing is a broken upstream, and a snapshot made only of carried
  // records would hide that behind a card that still looks populated.
  if (eventsOut.length === 0) {
    return keepCacheOrExit("No wild-spawn events resolved — refusing to overwrite cache");
  }

  // Just-ended events come from the previous snapshot (leak-duck has already
  // dropped them); the result is chronological so the UI renders top-down.
  const events = carryOver(eventsOut, previous?.events, now);

  // The shrink guard (see the header). Upcoming events the feed stopped listing
  // are logged either way: one is a cancellation worth seeing in the sync log.
  const shrink = guardShrunkEvents(previous?.events, events.merged, now, { offlineOk, acceptShrink });
  for (const id of shrink.lost) {
    const old = (previous?.events || []).find((r) => r?.id === id);
    const renamed = old && events.merged.find((r) => isRetitleOf(old, r));
    console.log(renamed
      ? `  ✎ upstream renamed "${old.title}" to "${renamed.title}" (${id} → ${renamed.id})`
      : `  ✂ upstream no longer lists upcoming event ${id}`);
  }
  if (shrink.refused) {
    const what = `the feed dropped ${shrink.lost.length} of the ${shrink.expected} events the cache still expects (${shrink.retained} kept, ${eventsOut.length} surfaced)`;
    if (!shrink.write) {
      // Kept short: the sync summary shows the ✗ line cut to 160 characters.
      return keepCacheOrExit(`events: ${what} — refusing to overwrite the cache (--accept-shrink overrides)`);
    }
    console.warn(`⚠  events: ${what} — written anyway (--accept-shrink)`);
  }
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
  const newContent = { events: events.merged, eggPools: eggPools.merged, signals: signals.merged, bonuses: bonuses.merged };
  let fetchedAt = new Date().toISOString();
  if (
    previous?.fetchedAt &&
    canonicalStringify({
      events: previous.events,
      eggPools: previous.eggPools || [],
      signals: previous.signals || [],
      bonuses: previous.bonuses || [],
    }) ===
      canonicalStringify(newContent)
  ) {
    fetchedAt = previous.fetchedAt;
    console.log("  ↺ content unchanged — preserving previous fetchedAt");
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  events: ${eventsOut.length} surfaced · ${events.carriedIds.length} carried over · ${skippedNoSpawns} without spawns · ${skippedWindow} outside window · ${skippedCategory} skipped categories · ${unparseable.size} unparseable windows · ${unmappedVenues.size} without venue · ${totalUnresolved} unresolved spawn names`);
  console.log(`  egg pools: ${eggPoolsOut.length} surfaced · ${eggPools.carriedIds.length} carried over`);
  console.log(`  bonuses: ${bonusesOut.length} events surfaced · ${bonuses.carriedIds.length} carried over · ${unknownBonuses.length} unrecognised phrasings`);
  failOnHeldBack(heldBack, offlineOk);
}

// A held-back Community Day fails the sync, which is where someone acts on
// it. Under --offline-ok (prebuild: every build, deploy and test job) it is
// reported and the build goes on, like a refused events result: the day is
// simply not in the list yet, and the committed data is still whole. Before
// this, the feed announcing December to February Community Days without their
// featured Pokémon (2026-11-10) failed every build and froze the deploy.
function failOnHeldBack(heldBack, offlineOk = false) {
  if (heldBack.length === 0) return;
  for (const cd of heldBack) {
    const why = cd.names.length ? `unresolved featured names: ${cd.names.join(", ")}` : "no featured Pokémon listed";
    console.error(`✗ Community Day ${cd.date} ${cd.event} not added to ${CD_PATH} (${why})`);
  }
  if (offlineOk) {
    console.warn(`⚠  --offline-ok: ${heldBack.length} Community Day(s) held back, build goes on without them.`);
    return;
  }
  process.exit(1);
}

// Only run when executed directly — scripts/check-mega-boost.mjs imports
// resolveSpawnForm without triggering a fetch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
