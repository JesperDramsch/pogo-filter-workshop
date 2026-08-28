#!/usr/bin/env node
// Pulls in-game Team GO Rocket grunt quotes from Niantic's own localized text
// export (sora10pls/holoholo-text) and writes a slim per-locale snapshot to
// src/data/rocket-grunt-quotes.json.
//
// WHY IT MOVED OFF PokeMiners/pogo_assets. Not because the quotes were wrong in
// six of the seven locales — they were byte-identical, because Rocket dialogue
// has not changed since August 2025. It moved because that source is FROZEN:
// `Texts/Latest APK/JSON` last changed 2025-08-24 and had zero commits in the
// two months before this was written, while the repo kept committing images
// daily, so nothing about it looks abandoned from the outside. It would have
// gone on serving 2025 dialogue after the next change, silently.
//
// The Hindi bundle was the exception, and it was a live defect: 60 of the 70
// grunt-quote keys differed, and every difference was PokeMiners dropping
// Devanagari vowel signs — "बत" for "बहुत", "कं" for "कहूं",
// "पोकटॉप" for "पोकेस्टॉप". Those broken strings were in the committed
// snapshot and on screen for Hindi users. holoholo's Hindi is clean Unicode
// with no private-use codepoints at all.
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
// JSON shape: { "data": ["key1","val1","key2","val2",...] } — parsed by
// scripts/lib/holoholo-text.mjs, which also owns the locale→path table.
//
// Flags: --offline-ok   tolerate fetch failures if a previous artifact exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOLOHOLO_LOCALES, fetchLocaleBundle } from "./lib/holoholo-text.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "rocket-grunt-quotes.json");

// The seven locales the app supports; the locale→directory table itself lives
// in scripts/lib/holoholo-text.mjs, shared with the translation fetcher.
const LOCALES = Object.keys(HOLOHOLO_LOCALES);

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

// What actually counts as "the same snapshot" for the fetchedAt-preserving
// comparison: everything except the timestamp and the bundle's total key count.
// `sources.enKeys` moves whenever Niantic adds any string anywhere in the
// 42k-key bundle, and rewriting fetchedAt for a key this snapshot does not read
// is exactly the churn this comparison exists to prevent.
function comparable(snapshot) {
  const { fetchedAt: _at, sources, ...rest } = snapshot || {};
  const { enKeys: _n, ...restSources } = sources || {};
  return { ...rest, sources: restSources };
}

function readPrevious() {
  if (!existsSync(OUT_PATH)) return null;
  try { return JSON.parse(readFileSync(OUT_PATH, "utf8")); } catch { return null; }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");
  const prev = readPrevious();

  let maps;
  try {
    console.log(`→ Fetching holoholo-text bundles for ${LOCALES.length} locales`);
    const entries = await Promise.all(
      LOCALES.map(async (locale) => [
        locale,
        await fetchLocaleBundle(locale, { userAgent: "pogo-filter-workshop grunt-quote-fetcher/2.0" }),
      ])
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
  const enKeys = Object.keys(enMap || {}).length;
  // Absolute floor first — a truncated or error-page body cannot reach this.
  if (enKeys < 1000) {
    throw new Error(`English bundle suspiciously small (${enKeys} keys) — refusing to overwrite cache`);
  }
  // Then the shrink guard every fetcher here carries, against the key count the
  // last good sync recorded. Niantic retires strings, so a small drop is normal;
  // losing a tenth of the bundle is a broken publish.
  const prevKeys = prev?.sources?.enKeys;
  if (Number.isFinite(prevKeys) && enKeys < prevKeys * 0.9) {
    throw new Error(
      `English bundle shrank ${prevKeys} → ${enKeys} keys — refusing to overwrite cache`,
    );
  }

  const types = discoverTypes(enMap);
  if (types.length !== 18) {
    console.warn(`⚠  Expected 18 typed-grunt quotes, discovered ${types.length}: ${types.join(",")}`);
  }
  const genericIdx = discoverNumbered(enMap, "combat_grunt_quote", true);
  const decoyIdx   = discoverNumbered(enMap, "combat_grunt_decoy_quote", false);
  const balloonIdx = discoverNumbered(enMap, "combat_grunt_balloon_quote", true);

  const newContent = {
    // Provenance, so the snapshot names its upstream without a reader having to
    // open this script. holoholo-text publishes no batch stamp of its own; the
    // key count is the closest thing to one, and it is what the shrink guard
    // above compares against on the next run.
    sources: { text: "sora10pls/holoholo-text (Release)", enKeys },
    typed:   buildTyped(maps, types),
    generic: buildNumbered(maps, "combat_grunt_quote",         genericIdx, true),
    decoy:   buildNumbered(maps, "combat_grunt_decoy_quote",   decoyIdx,   false),
    balloon: buildNumbered(maps, "combat_grunt_balloon_quote", balloonIdx, true),
  };

  let fetchedAt = new Date().toISOString();
  if (prev?.fetchedAt && canonicalStringify(comparable(prev)) === canonicalStringify(comparable(newContent))) {
    fetchedAt = prev.fetchedAt;
    console.log("  ↺ content unchanged — preserving previous fetchedAt");
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  typed: ${types.length} · generic: ${genericIdx.length} · decoy: ${decoyIdx.length} · balloon: ${balloonIdx.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
