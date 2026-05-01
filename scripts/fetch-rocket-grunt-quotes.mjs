#!/usr/bin/env node
// Pulls in-game Team GO Rocket grunt quotes from PokeMiners' pogo_assets
// repo (which mirrors Niantic's localized text exports) and writes a slim
// per-locale snapshot to src/data/rocket-grunt-quotes.json.
//
// Four quote categories — only the first uniquely identifies a lineup:
//   * typed   — combat_grunt_quote_<type>__{female,male}_speaker. 18 types
//               after collapsing the legacy "metal" alias into "steel".
//   * generic — combat_grunt_quote#<n>__{female,male}_speaker. 3 numbered
//               variants, no type information.
//   * decoy   — combat_grunt_decoy_quote#<n>. Boss-attrappe; ungendered.
//   * balloon — combat_grunt_balloon_quote#<n>__{female,male}_speaker.
//               Jessie/James event grunts.
//
// PokeMiners JSON shape: { "data": ["key1","val1","key2","val2",...] }
//
// Flags: --offline-ok   tolerate fetch failures if a previous artifact exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "rocket-grunt-quotes.json");

// App locale → PokeMiners filename suffix (lowercase English language name).
const LOCALES = {
  en: "english",
  de: "german",
  es: "spanish",
  fr: "french",
  "zh-TW": "chinesetraditional",
  hi: "hindi",
  ja: "japanese",
};

const POKEMINERS_BASE =
  "https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Texts/Latest%20APK/JSON";

async function fetchI18n(lang) {
  const url = `${POKEMINERS_BASE}/i18n_${lang}.json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop grunt-quote-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.data)) {
    throw new Error(`Unexpected shape for ${url} — expected { data: [...] }`);
  }
  if (json.data.length % 2 !== 0) {
    throw new Error(`Odd-length data array in ${url} — expected key/value pairs`);
  }
  const map = {};
  for (let i = 0; i < json.data.length; i += 2) {
    map[json.data[i]] = json.data[i + 1];
  }
  return map;
}

// Read both gendered variants. JA / zh-TW (and occasionally ES, HI) use
// gendered speech patterns where female and male strings genuinely differ;
// DE / EN / FR keep them identical. ScrapedDuck encodes grunt gender in the
// trainer name (e.g. "Ice-type Female Grunt") so the UI picks the right
// variant per encounter. Returns the compact form: a string if both
// variants are identical (or only one exists / ungendered fallback), or
// `{ female, male }` when they diverge.
function pickGendered(map, baseKey) {
  const male = map[`${baseKey}__male_speaker`];
  const female = map[`${baseKey}__female_speaker`];
  const ungendered = map[baseKey];
  if (male && female) {
    return male === female ? male : { female, male };
  }
  return male ?? female ?? ungendered ?? null;
}

// Discover all `combat_grunt_quote_<type>` keys present in EN; the rest of
// the locales should mirror this set. Drop "metal" since "steel" is the
// modern alias and the workshop downstream uses "steel".
function discoverTypes(enMap) {
  const re = /^combat_grunt_quote_([a-z]+)__male_speaker$/;
  const types = new Set();
  for (const k of Object.keys(enMap)) {
    const m = k.match(re);
    if (m && m[1] !== "metal") types.add(m[1]);
  }
  return [...types].sort();
}

function discoverNumbered(enMap, prefix, gendered) {
  const re = new RegExp(`^${prefix}#(\\d+)${gendered ? "__male_speaker" : ""}$`);
  const indices = new Set();
  for (const k of Object.keys(enMap)) {
    const m = k.match(re);
    if (m) indices.add(Number(m[1]));
  }
  return [...indices].sort((a, b) => a - b);
}

function buildTyped(maps, types) {
  const out = {};
  for (const type of types) {
    out[type] = {};
    for (const [locale, map] of Object.entries(maps)) {
      const txt = pickGendered(map, `combat_grunt_quote_${type}`);
      if (!txt) {
        console.warn(`⚠  ${locale}: missing combat_grunt_quote_${type}`);
        continue;
      }
      out[type][locale] = txt;
    }
  }
  return out;
}

function buildNumbered(maps, prefix, indices, gendered) {
  return indices.map(idx => {
    const entry = {};
    for (const [locale, map] of Object.entries(maps)) {
      const baseKey = `${prefix}#${idx}`;
      const txt = gendered ? pickGendered(map, baseKey) : map[baseKey];
      if (!txt) {
        console.warn(`⚠  ${locale}: missing ${baseKey}`);
        continue;
      }
      entry[locale] = txt;
    }
    return entry;
  });
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

  let maps;
  try {
    console.log(`→ Fetching PokeMiners i18n bundles for ${Object.keys(LOCALES).length} locales`);
    const entries = await Promise.all(
      Object.entries(LOCALES).map(async ([locale, lang]) => [locale, await fetchI18n(lang)])
    );
    maps = Object.fromEntries(entries);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  const enMap = maps.en;
  if (!enMap || Object.keys(enMap).length < 1000) {
    throw new Error(`English bundle suspiciously small (${Object.keys(enMap || {}).length} keys) — refusing to overwrite cache`);
  }

  const types = discoverTypes(enMap);
  if (types.length !== 18) {
    console.warn(`⚠  Expected 18 typed-grunt quotes, discovered ${types.length}: ${types.join(",")}`);
  }
  const genericIdx = discoverNumbered(enMap, "combat_grunt_quote", true);
  const decoyIdx   = discoverNumbered(enMap, "combat_grunt_decoy_quote", false);
  const balloonIdx = discoverNumbered(enMap, "combat_grunt_balloon_quote", true);

  const newContent = {
    typed:   buildTyped(maps, types),
    generic: buildNumbered(maps, "combat_grunt_quote",         genericIdx, true),
    decoy:   buildNumbered(maps, "combat_grunt_decoy_quote",   decoyIdx,   false),
    balloon: buildNumbered(maps, "combat_grunt_balloon_quote", balloonIdx, true),
  };

  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const prevContent = { typed: prev.typed, generic: prev.generic, decoy: prev.decoy, balloon: prev.balloon };
      if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  typed: ${types.length} · generic: ${genericIdx.length} · decoy: ${decoyIdx.length} · balloon: ${balloonIdx.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
