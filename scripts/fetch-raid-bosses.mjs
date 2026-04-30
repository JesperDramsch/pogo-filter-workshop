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
};

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

  let typesArr, raidBossRaw, maxBattlesRaw;
  try {
    console.log("→ Fetching lily-dex-api endpoints");
    [typesArr, raidBossRaw, maxBattlesRaw] = await Promise.all([
      fetchJson(ENDPOINTS.types),
      fetchJson(ENDPOINTS.raidboss),
      fetchJson(ENDPOINTS.maxbattles),
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

  const totalRaids = Object.values(raids).reduce((a, l) => a + l.length, 0);
  const totalMax = Object.values(maxBattles).reduce((a, l) => a + l.length, 0);

  // Preserve the previous fetchedAt when boss content is unchanged, so the
  // scheduled sync workflow doesn't open a PR every day just because the
  // timestamp moved. The UI's "last sync · Xh ago" still reflects the
  // moment we last observed real upstream changes.
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

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  raids: ${totalRaids} bosses across ${Object.keys(raids).length} tiers`);
  console.log(`  maxBattles: ${totalMax} bosses across ${Object.keys(maxBattles).length} tiers`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
