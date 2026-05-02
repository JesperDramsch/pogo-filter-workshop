#!/usr/bin/env node
// Pulls current raid + max-battle bosses from lily-dex-api, derives per-boss
// resistorTypes (defender types that resist the boss's STAB) and seMoveTypes
// (move types that hit the boss super-effectively), and writes a slim
// artifact at src/data/raid-bosses.json that App.jsx imports at build time.
//
// Why the derivation lives in this script (not the app):
//   - Keeps runtime bundle small (one json file, no type matrix at runtime).
//   - Filter strings rebuild deterministically from a committed snapshot.
//   - lily-dex-api refreshes every 6h; user runs this on demand before raid hour.
//
// Flags:
//   --offline-ok   tolerate fetch failures if src/data/raid-bosses.json exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "raid-bosses.json");

const API_BASE = "https://mknepprath.github.io/lily-dex-api";
const ENDPOINTS = {
  raidboss:   `${API_BASE}/raidboss.json`,
  maxbattles: `${API_BASE}/maxbattles.json`,
  types:      `${API_BASE}/types.json`,
  // ScrapedDuck event feed — covers raid-day / raid-hour / raid-battles /
  // raid-weekend events that lily-dex-api's `currentList` doesn't carry.
  events:     "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json",
  // pogoapi name → types map for resolving bosses parsed out of event titles
  // (raid-day / raid-hour entries don't carry structured boss metadata).
  pokemonTypes: "https://pogoapi.net/api/v1/pokemon_types.json",
};

// Window for surfacing upcoming events: active now + the next 7 days. Anything
// further out is noise (rotation slots routinely shift) and would force a
// daily diff in the snapshot file.
const EVENT_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_RAID_TYPES = new Set([
  "raid-day", "raid-hour", "raid-battles", "raid-weekend",
]);

// lily-dex-api uses spreadsheet-column language labels; we use BCP47.
const LOCALE_MAP = {
  English: "en", German: "de", French: "fr", Italian: "it",
  Japanese: "ja", Korean: "ko", Spanish: "es",
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop raid-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Builds defender→{double, half, none} lookups for O(1) effectiveness checks.
function indexTypes(typesArr) {
  const idx = {};
  for (const entry of typesArr) {
    idx[entry.type] = {
      doubleFrom: new Set(entry.doubleDamageFrom || []),
      halfFrom:   new Set(entry.halfDamageFrom   || []),
      noFrom:     new Set(entry.noDamageFrom     || []),
    };
  }
  return idx;
}

// effectiveness(attackerType → defenderType). Single-type interaction.
function eff(att, def, typeIdx) {
  const d = typeIdx[def];
  if (!d) return 1;
  if (d.noFrom.has(att))     return 0;
  if (d.halfFrom.has(att))   return 0.5;
  if (d.doubleFrom.has(att)) return 2;
  return 1;
}

// A resistor is a defender type that takes ≤1× from every boss STAB type AND
// resists at least one of them. Captures "safely tank the boss's STAB".
function resistorsFor(bossTypes, allTypes, typeIdx) {
  const out = [];
  for (const cand of allTypes) {
    const effs = bossTypes.map((bt) => eff(bt, cand.type, typeIdx));
    const maxEff = Math.max(...effs);
    if (maxEff > 1) continue;          // weak to a STAB type
    if (!effs.some((e) => e < 1)) continue; // neither STAB resisted
    out.push(cand.type);
  }
  return out;
}

// SE move types = types whose product over the boss's defending types is >1×.
// Used when the boss entry doesn't already carry a `counter` field.
function seFromTypes(bossTypes, allTypes, typeIdx) {
  const out = [];
  for (const cand of allTypes) {
    const product = bossTypes.reduce(
      (acc, bt) => acc * eff(cand.type, bt, typeIdx),
      1,
    );
    if (product > 1) out.push(cand.type);
  }
  return out;
}

function seFromCounter(counter) {
  return Object.entries(counter || {})
    .filter(([, mult]) => Number(mult) > 1)
    .map(([type]) => type);
}

function normalizeNames(names) {
  if (!names || typeof names !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(names)) {
    if (LOCALE_MAP[k] && v) out[LOCALE_MAP[k]] = v;
  }
  return out;
}

// types come back as TitleCase ("Fire"); keys in App.jsx's kw.type are lowercase.
function lowerTypes(arr) {
  return arr.map((t) => String(t).toLowerCase());
}

function deriveBoss(boss, allTypes, typeIdx) {
  const bossTypes = boss.types || [];
  if (bossTypes.length === 0) return null;

  const resistors = resistorsFor(bossTypes, allTypes, typeIdx);
  const seTypes = boss.counter
    ? seFromCounter(boss.counter)
    : seFromTypes(bossTypes, allTypes, typeIdx);

  return {
    id: boss.id,
    names: normalizeNames(boss.names),
    types: lowerTypes(bossTypes),
    resistorTypes: lowerTypes(resistors),
    seMoveTypes: lowerTypes(seTypes),
  };
}

// Build a lowercase-name → {id, types} index from pogoapi.net's pokemon_types
// dataset. The "Normal" form wins when the same dex number has multiple form
// rows (e.g. Entei has Normal + an "S" Shadow tag row); we want canonical
// non-form types for our derivation.
function buildNameIndex(pokemonTypes) {
  const idx = new Map();
  for (const row of pokemonTypes) {
    const name = row.pokemon_name;
    if (!name || !Array.isArray(row.type)) continue;
    const key = name.toLowerCase();
    const isNormal = !row.form || row.form === "Normal";
    if (idx.has(key) && !isNormal) continue;
    idx.set(key, {
      // lily-dex-api ID convention: TAPU_LELE, MR_MIME, etc.
      id: name.toUpperCase().replace(/[\s-]+/g, "_"),
      // Keep types in TitleCase ("Fire"/"Ground") to match the type index
      // keys built from the upstream typesArr — `eff()` lookups fail silently
      // on case-mismatched strings and would emit empty resistor/SE arrays.
      // `lowerTypes()` inside `deriveBoss` handles the lowercase emit shape.
      types: row.type,
      displayName: name,
    });
  }
  return idx;
}

// Pulls boss name(s) and shadow/mega flags out of a ScrapedDuck event entry.
// raid-battles events ship with extraData.raidbattles.bosses[] — preferred
// since the names are already canonical. raid-day / raid-hour / raid-weekend
// entries only have a marketing title, so we strip the event-type tail
// ("Raid Day"/"Raid Hour"/"Raid Weekend"), the "Super Mega" community-day
// qualifier (which is not a Mega-tier marker), the leading Shadow/Mega
// prefix (which IS a tier flag), and split multi-boss titles like
// "Buzzwole, Pheromosa, and Xurkitree Raid Hour".
function parseEventBosses(event) {
  const title = event.name || "";
  // "Super Mega" is a community-day qualifier ("Falinks Super Mega Raid Day"),
  // not a Mega-tier marker. Strip it before testing so it doesn't trip isMega.
  const cleanTitle = title.replace(/\bSuper\s+Mega\b/gi, " ");
  const isShadow = /\bShadow\b/i.test(cleanTitle);
  const isMega   = /\bMega\b/i.test(cleanTitle);

  const fromExtra = event?.extraData?.raidbattles?.bosses;
  if (Array.isArray(fromExtra) && fromExtra.length > 0) {
    return {
      isShadow, isMega,
      names: fromExtra.map(b => b.name).filter(Boolean),
    };
  }

  // Fallback: parse the event title for raid-day / raid-hour / raid-weekend.
  let s = title
    .replace(/\s+Raid\s+(Day|Hour|Weekend)$/i, "")
    .replace(/\s+Super\s+Mega$/i, "")
    .replace(/^Super\s+Mega\s+/i, "")
    .replace(/^Shadow\s+/i, "")
    .replace(/^Mega\s+/i, "");
  // Multi-boss split — try ", and ", " and ", then ", " in that order so
  // "A, B, and C" splits cleanly into [A, B, C].
  const names = s
    .split(/,\s*and\s+|\s+and\s+|,\s*/i)
    .map(n => n.trim())
    .filter(Boolean);
  return { isShadow, isMega, names };
}

// Builds the per-event entry that the workshop UI consumes. Returns
// `{entry, status}` where status is "ok" | "deduped" | "unresolved". Caller
// uses the status to log a meaningful summary; an entry of null means we
// drop the event entirely so the UI doesn't render an empty accordion.
function buildEventEntry(event, nameIdx, allTypes, typeIdx, dedupeSet) {
  const { isShadow, isMega, names } = parseEventBosses(event);
  if (names.length === 0) return { entry: null, status: "unresolved" };

  const bosses = [];
  let anyUnresolved = false;
  let anyDeduped = false;
  for (const rawName of names) {
    const key = rawName
      .toLowerCase()
      .replace(/^shadow\s+/i, "")
      .replace(/^mega\s+/i, "")
      .trim();
    const hit = nameIdx.get(key);
    if (!hit) {
      anyUnresolved = true;
      console.warn(`  ⚠ event "${event.name}": cannot resolve boss "${rawName}" — skipped`);
      continue;
    }
    // Dedupe against the standing tier rotation so e.g. Shadow Latios doesn't
    // appear twice (once in shadow_lvl5, once as a raid-battles event).
    const dedupeKey = `${hit.id}|${isShadow ? "S" : ""}|${isMega ? "M" : ""}`;
    if (dedupeSet.has(dedupeKey)) { anyDeduped = true; continue; }

    // `normalizeNames()` keys off lily-dex-api's TitleCase language labels
    // ("English", "German"), not BCP47 — pass the same shape so the resulting
    // boss carries an `en` name that buildBossEntry() can fall back on.
    const derived = deriveBoss(
      { id: hit.id, names: { English: hit.displayName }, types: hit.types },
      allTypes, typeIdx,
    );
    if (derived) bosses.push(derived);
  }
  if (bosses.length === 0) {
    return { entry: null, status: anyUnresolved && !anyDeduped ? "unresolved" : "deduped" };
  }
  return {
    entry: {
      eventID: event.eventID,
      name: event.name,
      eventType: event.eventType,
      start: event.start,
      end: event.end,
      isShadow,
      isMega,
      bosses,
    },
    status: "ok",
  };
}

// Standing-tier dedupe set: every (id, shadow?, mega?) already covered by
// raids.{mega, lvl5, shadow_lvl5, …}. Built from the derived tier output so
// the ID format matches downstream consumers exactly.
function buildStandingDedupeSet(tieredRaids) {
  const set = new Set();
  for (const [tier, list] of Object.entries(tieredRaids || {})) {
    const isShadow = tier.startsWith("shadow_");
    const isMega = tier === "mega";
    for (const boss of list) {
      set.add(`${boss.id}|${isShadow ? "S" : ""}|${isMega ? "M" : ""}`);
    }
  }
  return set;
}

function deriveTiered(rawBossesByTier, allTypes, typeIdx) {
  const out = {};
  for (const [tier, list] of Object.entries(rawBossesByTier || {})) {
    if (!Array.isArray(list)) continue;
    const derived = list
      .map((b) => deriveBoss(b, allTypes, typeIdx))
      .filter(Boolean);
    if (derived.length > 0) out[tier] = derived;
  }
  return out;
}

function writeJson(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Order-independent stringify for content comparison. The upstream API
// returns objects in stable key order across runs, but normalize anyway so
// a future re-key on either side doesn't trigger a spurious diff.
function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let typesArr, raidBossRaw, maxBattlesRaw, eventsRaw, pokemonTypesRaw;
  try {
    console.log("→ Fetching lily-dex-api + ScrapedDuck + pogoapi endpoints");
    [typesArr, raidBossRaw, maxBattlesRaw, eventsRaw, pokemonTypesRaw] = await Promise.all([
      fetchJson(ENDPOINTS.types),
      fetchJson(ENDPOINTS.raidboss),
      fetchJson(ENDPOINTS.maxbattles),
      fetchJson(ENDPOINTS.events),
      fetchJson(ENDPOINTS.pokemonTypes),
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
  const typeIdx = indexTypes(typesArr);

  // lily-dex-api wraps boss listings in `currentList`; the rest of the response
  // is graphics/headers we don't need.
  const raids = deriveTiered(raidBossRaw?.currentList, typesArr, typeIdx);
  const maxBattles = deriveTiered(maxBattlesRaw?.currentList, typesArr, typeIdx);

  if (Object.keys(raids).length === 0 && Object.keys(maxBattles).length === 0) {
    throw new Error("Both raids and maxBattles came back empty — refusing to overwrite cache");
  }

  // Event raids — currently active + upcoming within the lookahead window.
  // Built after the standing-tier derivation so dedupe can prune events
  // whose bosses are already in the rotation.
  const nameIdx = buildNameIndex(Array.isArray(pokemonTypesRaw) ? pokemonTypesRaw : []);
  const dedupeSet = buildStandingDedupeSet(raids);
  const now = Date.now();
  const horizon = now + EVENT_LOOKAHEAD_MS;
  const eventRaids = [];
  let skippedDeduped = 0;
  let skippedUnresolved = 0;
  for (const event of (Array.isArray(eventsRaw) ? eventsRaw : [])) {
    if (!EVENT_RAID_TYPES.has(event?.eventType)) continue;
    const startMs = Date.parse(event.start);
    const endMs = Date.parse(event.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs < now) continue;          // already over
    if (startMs > horizon) continue;    // beyond the 7-day lookahead
    const { entry, status } = buildEventEntry(event, nameIdx, typesArr, typeIdx, dedupeSet);
    if (entry) eventRaids.push(entry);
    else if (status === "deduped") skippedDeduped++;
    else skippedUnresolved++;
  }
  // Chronological order so the UI can render top-down without re-sorting.
  eventRaids.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const totalRaids = Object.values(raids).reduce((a, l) => a + l.length, 0);
  const totalMax = Object.values(maxBattles).reduce((a, l) => a + l.length, 0);

  // Preserve the previous fetchedAt when boss content is unchanged, so the
  // scheduled sync workflow doesn't open a PR every day just because the
  // timestamp moved. The UI's "last sync · Xh ago" still reflects the
  // moment we last observed real upstream changes.
  //
  // `eventRaids` is intentionally excluded from the canonical hash: each event
  // entry's relative window shifts every time the script runs (by definition,
  // since we filter by `now`), so including it would force a daily diff even
  // when nothing material changed in the rotation.
  const newContent = { raids, maxBattles };
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const prevContent = { raids: prev.raids, maxBattles: prev.maxBattles };
      if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent, eventRaids });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  raids: ${totalRaids} bosses across ${Object.keys(raids).length} tiers`);
  console.log(`  maxBattles: ${totalMax} bosses across ${Object.keys(maxBattles).length} tiers`);
  console.log(`  eventRaids: ${eventRaids.length} surfaced · ${skippedDeduped} deduped against standing tiers · ${skippedUnresolved} unresolved`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
