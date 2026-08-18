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
import {
  repairHindi,
  findPua,
  validateTable,
  assertNoPuaSurvives,
} from "./hi-pua-repair.mjs";

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

// Keyword corrections for values the SHEET gets wrong — a different problem from
// the Hindi mojibake below, which is an encoding fault. Here the glyphs decode
// perfectly; the resulting word just isn't what the game accepts, so no amount
// of repair-table work fixes it. Applied after the repair, and re-applied on
// every fetch because the sheet is re-pulled on every `npm run build`.
//
// Only add an entry you have TESTED in a real client of that locale. A wrong
// entry here is worse than the sheet's own error: it looks authoritative.
//
// KNOWN BROKEN, awaiting an in-game check:
//   hi / ingame.filter_key_has_duplicate
//     Sheet says डुप्लीकेट (long ी). Confirmed not to work in the Hindi client,
//     while the other 59 filter keywords do. The mojibake repair is NOT at
//     fault — U+F325 → ी is corroborated across लीफ़ / लीच / ग्लीम / डिप्लीशन.
//     Candidates, in order of likelihood:
//       'डुप्लिकेट'      — short ि, the standard transliteration
//       'duplicate'      — some locales leave search keywords in English
//       a native phrase  — every other locale translates rather than
//                          transliterates this one (Repetido / Double /
//                          ふくすう / 兩隻以上)
//     Uncomment the line below with whichever the client actually accepts.
const KEYWORD_OVERRIDES = {
  hi: {
    // 'ingame.filter_key_has_duplicate': 'डुप्लिकेट',
  },
};

// Apply the overrides, and be loud about entries that have gone stale: a key
// that no longer exists, or an override the sheet has caught up with, is dead
// weight that should be deleted rather than silently doing nothing.
function applyKeywordOverrides(ingameByLocale) {
  let applied = 0;
  const stale = [];
  for (const [loc, entries] of Object.entries(KEYWORD_OVERRIDES)) {
    for (const [key, value] of Object.entries(entries)) {
      const bucket = ingameByLocale[loc];
      if (!bucket || !(key in bucket)) {
        stale.push(`${loc}/${key} — key not present in the sheet`);
        continue;
      }
      if (bucket[key] === value) {
        stale.push(`${loc}/${key} — sheet already matches, override is redundant`);
        continue;
      }
      bucket[key] = value;
      applied++;
    }
  }
  for (const s of stale) console.warn(`⚠  stale keyword override: ${s}`);
  return applied;
}

// The sheet's Hindi column is legacy-font mojibake (see scripts/hi-pua-repair.json).
// Rewrite it in place after fetching and before anything is written, so the rest of
// the pipeline — and the app — only ever sees real Unicode Devanagari.
//
// Returns a summary for _meta.json. Throws if the repair leaves any private-use
// codepoint behind: silent half-repaired Devanagari is worse than a failed sync,
// because nothing downstream can tell the difference.
function repairHindiMojibake(ingameByLocale, appByLocale, pokemonNames) {
  const unmapped = new Map(); // codepoint → occurrence count
  const note = (cp) => unmapped.set(cp, (unmapped.get(cp) || 0) + 1);
  const repaired = [];
  let changed = 0;

  const fix = (label, value) => {
    const out = repairHindi(value, note);
    if (out !== value) changed++;
    repaired.push({ key: label, value: out });
    return out;
  };

  for (const bag of [ingameByLocale.hi, appByLocale.hi]) {
    for (const [k, v] of Object.entries(bag || {})) bag[k] = fix(k, v);
  }
  for (const [dex, names] of Object.entries(pokemonNames)) {
    if (names.hi) names.hi = fix(`pokemon-names.${dex}`, names.hi);
  }

  if (unmapped.size > 0) {
    const total = [...unmapped.values()].reduce((a, b) => a + b, 0);
    console.warn(
      `\n⚠  ${unmapped.size} private-use codepoint(s) in the Hindi column are NOT in ` +
        `scripts/hi-pua-repair.json (${total} occurrence(s)):`
    );
    for (const [cp, count] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) {
      const sample = repaired
        .filter((r) => findPua(r.value).has(cp))
        .slice(0, 3)
        .map((r) => r.key);
      console.warn(`   ${cp} ×${count}  e.g. ${sample.join(", ")}`);
    }
    console.warn("   Upstream has emitted mojibake this table does not cover yet.\n");
  }

  // Other locales should never contain private-use codepoints at all. Warn rather
  // than fail — a new corruption elsewhere is worth surfacing but is not ours to fix.
  for (const loc of TARGET_LOCALES) {
    if (loc === "hi") continue;

    const hits = [
      ...Object.entries(ingameByLocale[loc] || {}).filter(([, v]) => findPua(v).size).map(([k]) => k),
      ...Object.entries(appByLocale[loc] || {}).filter(([, v]) => findPua(v).size).map(([k]) => k),
      ...Object.entries(pokemonNames)
        .filter(([, names]) => names[loc] && findPua(names[loc]).size)
        .map(([dex]) => `pokemon-names.${dex}`),
    ];

    if (hits.length) {
      console.warn(
        `⚠  ${loc}: ${hits.length} value(s) contain private-use codepoints ` +
          `(e.g. ${hits.slice(0, 3).join(", ")}) — not repaired, the table is Hindi-only.`
      );
    }
  }

  assertNoPuaSurvives(repaired);
  return { valuesRepaired: changed, unmappedCodepoints: [...unmapped.keys()] };
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

  // Either fall back to the committed locale files or die, depending on whether the
  // caller can tolerate stale data. Returns true when the caller should stop quietly.
  const bailOrUseCache = (headline) => {
    console.error(headline);
    if (offlineOk) {
      const sentinel = resolve(LOCALES_DIR, "en.json");
      if (existsSync(sentinel)) {
        console.warn(`⚠  --offline-ok and cached locale files exist; build will use cache.`);
        return true;
      }
      console.error(`✗ No cached locale files at ${sentinel} — cannot proceed offline.`);
    }
    process.exit(1);
  };

  if (fetchError) {
    if (bailOrUseCache(`✗ Fetch failed: ${fetchError.message}`)) return;
  }

  // Self-check the repair table before trusting it with the whole Hindi column.
  const tableFailures = validateTable();
  if (tableFailures.length > 0) {
    console.error(`✗ scripts/hi-pua-repair.json failed its own worked examples:`);
    for (const f of tableFailures) console.error(`   ${f}`);
    process.exit(1);
  }

  // A codepoint the table does not cover means upstream changed under us. That must
  // be loud where someone can act on it — a manual run, and the daily sync workflow,
  // both exit non-zero. A plain `npm run build` keeps the committed (already repaired)
  // locale files instead of dying over a spreadsheet edit.
  let hindiRepair;
  try {
    hindiRepair = repairHindiMojibake(ingameByLocale, appByLocale, pokemonNames);
  } catch (e) {
    if (bailOrUseCache(`✗ ${e.message}`)) return;
  }
  console.log(
    `✓ Hindi mojibake repair: ${hindiRepair.valuesRepaired} value(s) rewritten, no private-use codepoints remain`
  );

  // Sheet-level keyword corrections, after the encoding repair.
  const overridden = applyKeywordOverrides(ingameByLocale);
  console.log(
    overridden > 0
      ? `✓ keyword overrides: ${overridden} value(s) corrected against the sheet`
      : `· keyword overrides: none active`
  );

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
    hindiRepair,
    warnings,
  };
  writeJson(resolve(LOCALES_DIR, "_meta.json"), meta);
  console.log(`✓ wrote _meta.json (${warnings.length} warnings)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
