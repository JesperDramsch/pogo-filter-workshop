#!/usr/bin/env node
// Fetches published Google Sheet CSVs of PoGo translations and emits per-locale
// JSON bundles for the build. See plan: full localization, phase 1.
//
// Outputs:
//   src/locales/{en,de,es,fr,zh-TW,hi,ja}.json   — flat key/value, namespaced
//                                                  ("ingame.*", "app.*")
//   src/locales/pokemon-names.json               — { dexKey: { en, de, ... } }
//   src/locales/_meta.json                       — generation metadata + warnings
//
// Flags:
//   --offline-ok   tolerate fetch failures if cached files exist (used by prebuild)
//
// Exit codes:
//   0 — success, files written or cache used
//   1 — fetch failed and no cache available, or sheet returned corrupt data

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOCALES_DIR = resolve(ROOT, "src/locales");

const SHEET_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSQubiAFnRgCUp9BSJaCq0-XSGU0-x3LvOwzWdAj-JlrXsdkBWrGrlfmvFmGcbjUnCa5XFSnv4C1Nzs/pub";

// Sources to fetch. The "app" tab is being created by the user — when available,
// add { gid: "<id>", kind: "ingame", namespace: "app", label: "App UI strings" }.
const SOURCES = [
  { gid: "1236962912", kind: "ingame", namespace: "ingame", label: "In-game UI terms" },
  { gid: "2001059420", kind: "pokemon", namespace: "pokemon", label: "Pokémon names" },
  { gid: "264930304",  kind: "move",    namespace: "move",    label: "Move names" },
];

// Spreadsheet column header → BCP47 locale code. Languages not listed here are
// dropped at parse time.
const COLUMN_TO_LOCALE = {
  English: "en",
  German: "de",
  Spanish: "es",
  French: "fr",
  "Traditional Chinese": "zh-TW",
  Hindi: "hi",
  Japanese: "ja",
};

const TARGET_LOCALES = ["en", "de", "es", "fr", "zh-TW", "hi", "ja"];

async function fetchCsv(gid) {
  const url = `${SHEET_BASE}?output=csv&gid=${gid}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "pogo-filter-workshop translation-fetcher/1.0",
      Accept: "text/csv,*/*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for gid=${gid}`);
  const text = await res.text();
  // Google sometimes returns 200 + an HTML cookie/login page when a sheet is
  // not published. Refuse to treat that as data.
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<") || trimmed.toLowerCase().startsWith("<!doctype")) {
    throw new Error(`gid=${gid} returned HTML instead of CSV (sheet may be unpublished)`);
  }
  return text;
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] || []).map((c) => (c || "").trim());
    if (cells.includes("English") && cells.includes("German")) return i;
  }
  throw new Error("Header row containing both 'English' and 'German' not found");
}

function buildLocaleColumnMap(headerRow) {
  const map = {};
  for (let i = 0; i < headerRow.length; i++) {
    const cell = (headerRow[i] || "").trim();
    if (COLUMN_TO_LOCALE[cell]) map[COLUMN_TO_LOCALE[cell]] = i;
  }
  return map;
}

// Strip `pokemon_name_` prefix and remove leading zeros from each `_`-separated
// segment. e.g. `pokemon_name_0006_0178_2` → `6_178_2`, `pokemon_name_0001` → `1`.
function canonicalDexKey(rawKey) {
  const stripped = rawKey.replace(/^pokemon_name_/, "");
  return stripped
    .split("_")
    .map((seg) => String(parseInt(seg, 10)))
    .filter((seg) => seg !== "NaN")
    .join("_");
}

function processIngameSheet(rows) {
  const headerIdx = findHeaderRow(rows);
  const localeColMap = buildLocaleColumnMap(rows[headerIdx]);
  const result = Object.fromEntries(TARGET_LOCALES.map((l) => [l, {}]));

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const key = (row[0] || "").trim();
    if (!key) continue;
    if (key.startsWith("=")) continue; // formula row
    if (/\s/.test(key)) continue; // metadata or header-leftover row

    for (const [loc, col] of Object.entries(localeColMap)) {
      const val = (row[col] || "").trim();
      if (val) result[loc][`ingame.${key}`] = val;
    }
  }
  return result;
}

// Move sheet has rows like `move_name_0322 | Frustration | ... | Frustration | やつあたり | ...`.
// Key by lowercased EN name so callers can look up `move.frustration`. If the
// same EN name recurs (rare; e.g. "Vine Whip" twice), last wins — fine since
// translations are identical.
function processMovesSheet(rows) {
  const headerIdx = findHeaderRow(rows);
  const localeColMap = buildLocaleColumnMap(rows[headerIdx]);
  const enCol = localeColMap.en;
  const result = Object.fromEntries(TARGET_LOCALES.map((l) => [l, {}]));

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const id = (row[0] || "").trim();
    if (!id.startsWith("move_name_")) continue;
    const enName = (row[enCol] || "").trim();
    if (!enName) continue;
    const key = `move.${enName.toLowerCase()}`;

    for (const [loc, col] of Object.entries(localeColMap)) {
      const val = (row[col] || "").trim();
      if (val) result[loc][key] = val;
    }
  }
  return result;
}

function processPokemonSheet(rows) {
  const headerIdx = findHeaderRow(rows);
  const localeColMap = buildLocaleColumnMap(rows[headerIdx]);
  const pokemon = {};

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const key = (row[0] || "").trim();
    if (!key.startsWith("pokemon_name_")) continue;

    const dexKey = canonicalDexKey(key);
    if (!dexKey || dexKey === "0") continue; // skip placeholder pokemon_name_0000

    const entry = {};
    for (const [loc, col] of Object.entries(localeColMap)) {
      const val = (row[col] || "").trim();
      if (val && val !== "--" && val !== "---") entry[loc] = val;
    }
    if (Object.keys(entry).length > 0) pokemon[dexKey] = entry;
  }
  return pokemon;
}

function detectWarnings(pokemonNames, ingameByLocale) {
  const warnings = [];

  // Pokémon names: cells suspiciously short vs EN baseline (excluding CJK/JA
  // where short transliterations are normal).
  for (const [dex, names] of Object.entries(pokemonNames)) {
    const en = names.en;
    if (!en || en.length < 6) continue;
    for (const loc of TARGET_LOCALES) {
      if (loc === "en" || loc === "ja" || loc === "zh-TW") continue;
      const v = names[loc];
      if (!v) continue;
      if (v.length < 4 && en.length >= 8) {
        warnings.push({
          kind: "possible-truncation",
          dex,
          locale: loc,
          en,
          value: v,
        });
      }
    }
  }

  // Mojibake / replacement-char markers in any namespace.
  for (const loc of TARGET_LOCALES) {
    for (const [k, v] of Object.entries(ingameByLocale[loc] || {})) {
      if (/[\uFFFD]/.test(v) || /\?\?\?/.test(v)) {
        warnings.push({ kind: "mojibake", key: k, locale: loc, value: v });
      }
    }
  }
  for (const [dex, names] of Object.entries(pokemonNames)) {
    for (const [loc, v] of Object.entries(names)) {
      if (/[\uFFFD]/.test(v)) {
        warnings.push({ kind: "mojibake", dex, locale: loc, value: v });
      }
    }
  }
  return warnings;
}

function sortPokemonKeys(keys) {
  return keys.slice().sort((a, b) => {
    const aSegs = a.split("_").map(Number);
    const bSegs = b.split("_").map(Number);
    for (let i = 0; i < Math.max(aSegs.length, bSegs.length); i++) {
      const av = aSegs[i] ?? 0;
      const bv = bSegs[i] ?? 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  });
}

function sortObjectByKey(obj, sorter = (a, b) => a.localeCompare(b)) {
  const keys = Object.keys(obj).sort(sorter);
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  if (!existsSync(LOCALES_DIR)) mkdirSync(LOCALES_DIR, { recursive: true });

  const ingameByLocale = Object.fromEntries(TARGET_LOCALES.map((l) => [l, {}]));
  const appByLocale = Object.fromEntries(TARGET_LOCALES.map((l) => [l, {}]));
  let pokemonNames = {};

  let fetchError = null;
  try {
    for (const src of SOURCES) {
      console.log(`→ Fetching ${src.label} (gid=${src.gid})`);
      const csv = await fetchCsv(src.gid);
      const rows = parse(csv, { skip_empty_lines: false, relax_column_count: true });

      if (src.kind === "pokemon") {
        const result = processPokemonSheet(rows);
        if (Object.keys(result).length === 0) {
          throw new Error(`Pokémon sheet returned 0 entries — refusing to overwrite cache`);
        }
        pokemonNames = result;
        console.log(`  ✓ ${Object.keys(result).length} Pokémon entries`);
      } else if (src.kind === "move") {
        const result = processMovesSheet(rows);
        let totalKeys = 0;
        for (const loc of TARGET_LOCALES) {
          for (const [k, v] of Object.entries(result[loc])) {
            ingameByLocale[loc][k] = v;
            totalKeys++;
          }
        }
        if (totalKeys === 0) {
          throw new Error(`Move sheet returned 0 keys — refusing to overwrite cache`);
        }
        console.log(`  ✓ ${totalKeys / TARGET_LOCALES.length | 0} avg moves per locale`);
      } else if (src.kind === "ingame") {
        const result = processIngameSheet(rows);
        let totalKeys = 0;
        for (const loc of TARGET_LOCALES) {
          const target = src.namespace === "app" ? appByLocale[loc] : ingameByLocale[loc];
          // Re-key from `ingame.<key>` to `<namespace>.<key>` if non-default namespace.
          for (const [k, v] of Object.entries(result[loc])) {
            if (src.namespace === "ingame") {
              target[k] = v;
            } else {
              target[k.replace(/^ingame\./, `${src.namespace}.`)] = v;
            }
            totalKeys++;
          }
        }
        if (totalKeys === 0) {
          throw new Error(`${src.label} sheet returned 0 keys — refusing to overwrite cache`);
        }
        console.log(`  ✓ ${totalKeys / TARGET_LOCALES.length | 0} avg keys per locale`);
      }
    }
  } catch (e) {
    fetchError = e;
  }

  if (fetchError) {
    console.error(`✗ Fetch failed: ${fetchError.message}`);
    if (offlineOk) {
      const sentinel = resolve(LOCALES_DIR, "en.json");
      if (existsSync(sentinel)) {
        console.warn(`⚠  --offline-ok and cached locale files exist; build will use cache.`);
        return;
      }
      console.error(`✗ No cached locale files at ${sentinel} — cannot proceed offline.`);
    }
    process.exit(1);
  }

  // Per-locale flat files (ingame + app namespaces).
  for (const loc of TARGET_LOCALES) {
    const merged = { ...ingameByLocale[loc], ...appByLocale[loc] };
    const sorted = sortObjectByKey(merged);
    const out = resolve(LOCALES_DIR, `${loc}.json`);
    writeJson(out, sorted);
    console.log(`✓ wrote ${loc}.json (${Object.keys(sorted).length} keys)`);
  }

  // Pokémon names: single multi-locale file (smaller bundle than 7× duplication).
  const pokemonSorted = Object.fromEntries(
    sortPokemonKeys(Object.keys(pokemonNames)).map((k) => {
      // Sort inner locale keys for stable diffs as well.
      const sortedLocs = Object.fromEntries(
        Object.keys(pokemonNames[k])
          .sort()
          .map((l) => [l, pokemonNames[k][l]])
      );
      return [k, sortedLocs];
    })
  );
  writeJson(resolve(LOCALES_DIR, "pokemon-names.json"), pokemonSorted);
  console.log(`✓ wrote pokemon-names.json (${Object.keys(pokemonSorted).length} entries)`);

  // Completeness report.
  const allIngameKeys = new Set();
  for (const loc of TARGET_LOCALES) {
    for (const k of Object.keys(ingameByLocale[loc])) allIngameKeys.add(k);
  }
  const missingByLocale = Object.fromEntries(
    TARGET_LOCALES.map((loc) => [
      loc,
      [...allIngameKeys].filter((k) => !ingameByLocale[loc][k]).length,
    ])
  );

  const warnings = detectWarnings(pokemonNames, ingameByLocale);

  // Deliberately no `generatedAt` — a fresh timestamp on every run made the
  // scheduled sync workflow open a spurious PR every morning even when the
  // sheet hadn't changed. The remaining fields are all content-derived, so
  // a no-op sync produces a zero-diff write.
  const meta = {
    sources: SOURCES.map((s) => ({ gid: s.gid, label: s.label, namespace: s.namespace })),
    counts: {
      ingameKeysUnion: allIngameKeys.size,
      pokemonNames: Object.keys(pokemonNames).length,
    },
    missingTranslationsCount: missingByLocale,
    warnings,
  };
  writeJson(resolve(LOCALES_DIR, "_meta.json"), meta);
  console.log(`✓ wrote _meta.json (${warnings.length} warnings)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
