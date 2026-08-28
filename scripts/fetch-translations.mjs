#!/usr/bin/env node
// Builds the per-locale message bundles the app ships, from Niantic's own
// localized text export (sora10pls/holoholo-text — see scripts/lib/holoholo-text.mjs).
//
// Outputs:
//   src/locales/{en,de,es,fr,zh-TW,hi,ja}.json   — flat key/value, namespaced
//                                                  ("ingame.*", "move.*")
//   src/locales/pokemon-names.json               — { dexKey: { en, de, ... } }
//   src/locales/_meta.json                       — generation metadata + warnings
//
// WHAT THIS REPLACED, and why. Until now these three files came from a
// community-maintained published Google Sheet: a person transcribing Niantic's
// strings by hand, for seven languages, on no schedule. Verified against the
// live German export before the swap, the sheet was in fact accurate — every
// one of its 112 Niantic `ingame.*` values and all 371 move names matched
// holoholo byte for byte, and 1153 of its 1155 species names did. It was a good
// sheet. It was also a single volunteer between this app and the game, with no
// way to tell a stale cell from a current one, and it had two failure modes
// this source does not:
//
//   1. Its Hindi column was legacy-font mojibake, repaired here by a lookup
//      table (scripts/hi-pua-repair.json). The repair was good but not perfect:
//      it reordered "एनर्जी" into "एनिर्ज" in two move names, and dropped a
//      matra in three species names ("सीसील" for सील, "डार्टि्रक्स" for
//      डार्ट्रिक्स). Niantic's own export is clean Unicode Devanagari with no
//      private-use codepoints at all, so the whole class of fault is gone.
//   2. It invented two species that do not exist in Pokémon GO — "Mega Raichu X"
//      (26_1) and "Mega Lucario Z" (448_2). Both were resolvable species names
//      in this app, so a user could put either on a wishlist and get a filter
//      clause the game can never match. They are gone with the sheet; see the
//      note on canonicalisation below for what happens to a saved chip.
//
// THE KEY SET. holoholo ships 42,243 keys per locale and the app needs 115 of
// them, so something has to select. The sheet's own selection was a human's
// judgement, invisible and un-versioned; this script's is two rules, stated:
//
//   KEYWORD_FAMILIES — whole namespaces taken wholesale, because they ARE the
//   in-game search-keyword vocabulary. A new PoGo search keyword lands in
//   `filter_key_*` and reaches the app on the next sync with no code change,
//   which the sheet could not do — someone had to notice and add a row.
//
//   BORROWED_KEYS — individual labels the filter builder reuses that are NOT
//   search keywords and do not live in a keyword namespace ("HP", "Buddy",
//   the Pokédex generation titles). Their namespaces are enormous and almost
//   entirely irrelevant — `buddy_*` alone is 277 keys, `pokemon_info_*` 153 —
//   so these are named one by one. A key here that upstream drops is reported
//   loudly rather than silently omitted.
//
//   SYNTHETIC_KEYWORDS — three keywords that are not Niantic strings at all.
//
// Flags:
//   --offline-ok   tolerate fetch failures if cached files exist (used by prebuild)
//
// Exit codes:
//   0 — success, files written or cache used
//   1 — fetch failed and no cache available, or upstream returned corrupt data

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOLOHOLO_LOCALES, fetchLocaleBundle, isDisplayable } from "./lib/holoholo-text.mjs";
// Verification only. The repair itself is retired with the Google Sheet whose
// legacy font produced the mojibake — Niantic's export carries no private-use
// codepoints — but the DETECTION stays, as the guard that would catch a new
// encoding fault in any locale rather than shipping half-rendered Devanagari.
import { findPua, assertNoPuaSurvives } from "./hi-pua-repair.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOCALES_DIR = resolve(ROOT, "src/locales");

const TARGET_LOCALES = Object.keys(HOLOHOLO_LOCALES);

// ── Which keys leave the 42k-key bundle ─────────────────────────────────────

// Whole namespaces. These ARE the in-game search-keyword vocabulary, so taking
// the family rather than a list is what lets a keyword Niantic adds tomorrow
// reach the app on the next sync. Verified 2026-08-28: these three families
// hold exactly the 82 Niantic keyword entries the app already carried, with no
// extras to prune, so widening from a curated list to the namespace costs
// nothing today and buys the automatic pickup.
const KEYWORD_FAMILIES = [
  "filter_key_",         // the Pokémon-storage search keywords (60)
  "filter_friend_key_",  // the friend-list search keywords (4)
  "pokemon_type_",       // the 18 type names, which are search keywords too
];

// Individual labels the filter builder reuses that are NOT search keywords and
// whose namespaces are far too broad to take wholesale (`buddy_*` is 277 keys,
// `pokemon_info_*` 153, `general_*` 86). Each is here because something in
// src/i18n/pogo-keywords.js or src/App.jsx reads it; a key that vanishes
// upstream is reported by the completeness check in main() rather than quietly
// dropping a label.
const BORROWED_KEYS = [
  // Pokédex generation titles — the "Generation N" chip labels.
  "badge_pokedex_entries_title",
  "badge_pokedex_entries_gen2_title", "badge_pokedex_entries_gen3_title",
  "badge_pokedex_entries_gen4_title", "badge_pokedex_entries_gen5_title",
  "badge_pokedex_entries_gen6_title", "badge_pokedex_entries_gen7_title",
  "badge_pokedex_entries_gen8_title", "badge_pokedex_entries_gen8a_title",
  "badge_pokedex_entries_gen9_title",
  // Buddy and stat labels the numeric clauses are built from.
  "buddy_evolution_progress_title", "buddy_level_0", "buddy_set",
  "general_buddy", "general_cp", "general_hp", "general_stamina",
  "general_xxs", "general_xs", "general_xl", "general_xxl",
  // Sort / mode / misc labels reused as keywords.
  "favorite_filter_group_key", "mega_catch_candy_bonus",
  "pokedex_mode_name_mega", "pokedex_sort_favorite", "pokedex_sort_hp",
  "pokemon_info_evolve_button", "postcard_favorite", "tips_tagging_idea_evolve",
  "weather_weather",
];

// Not Niantic strings at all: three search keywords the game accepts verbatim
// in every client, which therefore have no localized entry anywhere upstream
// and never will. The Google Sheet carried them as rows; here they are supplied
// locally, which is the honest place for a value this project invented.
const SYNTHETIC_KEYWORDS = {
  hardcoded_countcandy: "countcandy",
  hardcoded_countcandyxl: "countcandyxl",
  hardcoded_remotetrade: "remotetrade",
};

// ── Selection ───────────────────────────────────────────────────────────────

// Every `ingame.*` key, from the families plus the borrowed list. Derived from
// the EN bundle so the key set is identical across locales — a locale missing
// one of them is a gap to report, not a smaller key set to ship.
export function selectIngameKeys(enMap) {
  const keys = new Set();
  for (const k of Object.keys(enMap || {})) {
    if (KEYWORD_FAMILIES.some((f) => k.startsWith(f)) && isDisplayable(enMap[k])) keys.add(k);
  }
  for (const k of BORROWED_KEYS) if (isDisplayable(enMap?.[k])) keys.add(k);
  return [...keys].sort();
}

// Move names are keyed in the bundle by numeric id (`move_name_0322`), but the
// app looks them up by lowercased EN display name (`move.frustration`) — that
// is the shape App.jsx and the meta-rankings charger list both consume. So the
// join is: id → EN name → the same id in every other locale.
//
// The same EN name recurs across ids (46 of them: "Bite" is both a fast move
// and a charged move, "Hydro Pump" exists twice). Verified 2026-08-28 that
// every such group agrees on its translation in all seven locales, so
// collapsing them is lossless; the first non-empty value wins.
export function moveNamesByLocale(maps) {
  const en = maps.en || {};
  const idsByName = new Map();
  const skipped = [];
  for (const key of Object.keys(en)) {
    if (!/^move_name_\d+$/.test(key)) continue;
    // Unresolved client-side references — see isDisplayable.
    if (!isDisplayable(en[key])) { skipped.push(key); continue; }
    const name = String(en[key]).trim().toLowerCase();
    if (!name) continue;
    if (!idsByName.has(name)) idsByName.set(name, []);
    idsByName.get(name).push(key);
  }
  if (skipped.length > 0) {
    console.log(`  · ${skipped.length} move name(s) skipped as unresolved references`);
  }
  const result = Object.fromEntries(TARGET_LOCALES.map((l) => [l, {}]));
  for (const [name, ids] of idsByName) {
    for (const loc of TARGET_LOCALES) {
      const value = ids.map((id) => maps[loc]?.[id]).find((v) => isDisplayable(v) && v.trim());
      if (value) result[loc][`move.${name}`] = value.trim();
    }
  }
  return result;
}

// Strip `pokemon_name_` prefix and remove leading zeros from each `_`-separated
// segment. e.g. `pokemon_name_0006_0178_2` → `6_178_2`, `pokemon_name_0001` → `1`.
// The bundle pads the dex and form segments to four digits but leaves the
// trailing Dynamax/Gigantamax marker unpadded, so canonicalising both sides
// beats reconstructing a padded key — it cannot be wrong about the padding.
export function canonicalDexKey(rawKey) {
  const stripped = rawKey.replace(/^pokemon_name_/, "");
  return stripped
    .split("_")
    .map((seg) => String(parseInt(seg, 10)))
    .filter((seg) => seg !== "NaN")
    .join("_");
}

// Species names, keyed the way src/data/species.js expects. Every numeric
// `pokemon_name_*` key in the bundle, including the Mega (`3_1`) and
// Gigantamax (`3_169_2`) forms — those have real entries upstream, so nothing
// here is composed from a label and a base name.
export function pokemonNamesFrom(maps) {
  const en = maps.en || {};
  const out = {};
  for (const rawKey of Object.keys(en)) {
    if (!/^pokemon_name_\d+(_\d+)*$/.test(rawKey)) continue;
    const dexKey = canonicalDexKey(rawKey);
    if (!dexKey || dexKey === "0") continue; // skip the pokemon_name_0000 placeholder ("--")
    const entry = {};
    for (const loc of TARGET_LOCALES) {
      const raw = maps[loc]?.[rawKey];
      if (!isDisplayable(raw)) continue;
      const v = raw.trim();
      if (v && v !== "--" && v !== "---") entry[loc] = v;
    }
    if (Object.keys(entry).length > 0) out[dexKey] = entry;
  }
  return out;
}

// Keyword corrections for values the UPSTREAM gets wrong — or rather, for values
// that are faithfully what Niantic published and still are not what the game's
// search box accepts. No amount of source-swapping fixes that class of bug, so
// the override hook stays. Re-applied on every fetch because the bundles are
// re-pulled on every `npm run build`.
//
// Only add an entry you have TESTED in a real client of that locale. A wrong
// entry here is worse than the upstream's own error: it looks authoritative.
//
// KNOWN BROKEN, awaiting an in-game check:
//   hi / ingame.filter_key_has_duplicate
//     डुप्लीकेट (long ी). Confirmed not to work in the Hindi client, while the
//     other 59 filter keywords do. This was previously suspected to be a
//     mojibake-repair artefact and it is not: Niantic's own Hindi export, which
//     never went through that table, publishes the identical string. So the
//     value here is exactly what the game ships and the search box still
//     rejects it — an upstream fault, not ours.
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
        stale.push(`${loc}/${key} — key not present upstream`);
        continue;
      }
      if (bucket[key] === value) {
        stale.push(`${loc}/${key} — upstream already matches, override is redundant`);
        continue;
      }
      bucket[key] = value;
      applied++;
    }
  }
  for (const s of stale) console.warn(`⚠  stale keyword override: ${s}`);
  return applied;
}

// Encoding guard, across every locale rather than Hindi alone.
//
// This used to be a REPAIR: the Google Sheet's Hindi column was legacy-font
// mojibake and scripts/hi-pua-repair.json rewrote each private-use codepoint
// into real Devanagari. Niantic's own export needs none of that — a live run
// over all 42,243 keys in every one of the seven locales finds zero private-use
// codepoints — so the repair is retired and only the check it was validated by
// remains. It stays because the failure it catches is the invisible kind: a
// half-rendered Devanagari string looks like a font problem on the user's
// phone, not like a bad sync, and nothing downstream can tell the difference.
//
// Returns a summary for _meta.json. Throws if any private-use codepoint reaches
// the write.
function checkEncoding(ingameByLocale, appByLocale, pokemonNames) {
  const checked = [];
  const hitsByLocale = {};

  for (const loc of TARGET_LOCALES) {
    const hits = [];
    const note = (label, value) => {
      if (typeof value !== "string") return;
      checked.push({ key: `${loc}.${label}`, value });
      if (findPua(value).size) hits.push(label);
    };
    for (const [k, v] of Object.entries(ingameByLocale[loc] || {})) note(k, v);
    for (const [k, v] of Object.entries(appByLocale[loc] || {})) note(k, v);
    for (const [dex, names] of Object.entries(pokemonNames)) {
      if (names[loc]) note(`pokemon-names.${dex}`, names[loc]);
    }
    if (hits.length) {
      hitsByLocale[loc] = hits.length;
      console.warn(
        `⚠  ${loc}: ${hits.length} value(s) contain private-use codepoints ` +
          `(e.g. ${hits.slice(0, 3).join(", ")}) — upstream has emitted mojibake.`
      );
    }
  }

  // Fails the sync rather than shipping it: see the note above on why silent is
  // the worst outcome here.
  assertNoPuaSurvives(checked);
  return { valuesChecked: checked.length, puaHitsByLocale: hitsByLocale };
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
  let maps = null;

  let fetchError = null;
  try {
    console.log(`→ Fetching holoholo-text bundles for ${TARGET_LOCALES.length} locales`);
    const entries = await Promise.all(
      TARGET_LOCALES.map(async (loc) => [
        loc,
        await fetchLocaleBundle(loc, { userAgent: "pogo-filter-workshop translation-fetcher/2.0" }),
      ]),
    );
    maps = Object.fromEntries(entries);
    for (const [loc, map] of Object.entries(maps)) {
      // Every bundle is ~42k keys; a truncated body cannot reach that. An
      // upstream that suddenly serves a tenth of the strings is a broken
      // publish, and shipping it would empty half the app's UI.
      if (Object.keys(map).length < 10000) {
        throw new Error(`${loc} bundle has ${Object.keys(map).length} keys — refusing to overwrite cache`);
      }
    }

    const ingameKeys = selectIngameKeys(maps.en);
    if (ingameKeys.length === 0) {
      throw new Error("no ingame keys matched — refusing to overwrite cache");
    }
    for (const loc of TARGET_LOCALES) {
      for (const key of ingameKeys) {
        const v = maps[loc][key];
        if (isDisplayable(v)) ingameByLocale[loc][`ingame.${key}`] = v;
      }
      // The three keywords Niantic never publishes. Same value in every client.
      for (const [key, value] of Object.entries(SYNTHETIC_KEYWORDS)) {
        ingameByLocale[loc][`ingame.${key}`] = value;
      }
    }
    console.log(`  ✓ ${ingameKeys.length} in-game keys + ${Object.keys(SYNTHETIC_KEYWORDS).length} synthetic`);

    const moves = moveNamesByLocale(maps);
    const moveCount = Object.keys(moves.en).length;
    if (moveCount === 0) {
      throw new Error("move-name join produced 0 keys — refusing to overwrite cache");
    }
    for (const loc of TARGET_LOCALES) Object.assign(ingameByLocale[loc], moves[loc]);
    console.log(`  ✓ ${moveCount} move names`);

    pokemonNames = pokemonNamesFrom(maps);
    if (Object.keys(pokemonNames).length === 0) {
      throw new Error("no Pokémon names matched — refusing to overwrite cache");
    }
    console.log(`  ✓ ${Object.keys(pokemonNames).length} Pokémon entries`);
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

  // A private-use codepoint anywhere means upstream changed encoding under us.
  // Loud where someone can act on it — a manual run and the daily sync workflow
  // both exit non-zero — while a plain `npm run build` keeps the committed
  // locale files rather than dying over an upstream edit.
  let encoding;
  try {
    encoding = checkEncoding(ingameByLocale, appByLocale, pokemonNames);
  } catch (e) {
    if (bailOrUseCache(`✗ ${e.message}`)) return;
  }
  console.log(
    `✓ encoding check: ${encoding.valuesChecked} value(s) scanned, no private-use codepoints`
  );

  // Upstream-level keyword corrections.
  const overridden = applyKeywordOverrides(ingameByLocale);
  console.log(
    overridden > 0
      ? `✓ keyword overrides: ${overridden} value(s) corrected against upstream`
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

  // Completeness report. A BORROWED_KEYS entry that upstream has dropped shows
  // up here as a missing key rather than as a label that silently turns into
  // its own message id in the UI.
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
  const missingBorrowed = BORROWED_KEYS.filter((k) => !(maps?.en && k in maps.en));
  if (missingBorrowed.length > 0) {
    console.warn(
      `⚠  ${missingBorrowed.length} borrowed key(s) no longer published upstream: ` +
        missingBorrowed.join(", ")
    );
  }

  const warnings = detectWarnings(pokemonNames, ingameByLocale);

  // Deliberately no `generatedAt` — a fresh timestamp on every run made the
  // scheduled sync workflow open a spurious PR every morning even when nothing
  // upstream had changed. The remaining fields are all content-derived, so
  // a no-op sync produces a zero-diff write.
  const meta = {
    sources: [
      {
        name: "sora10pls/holoholo-text",
        path: "Release",
        namespaces: ["ingame", "move", "pokemon"],
        locales: TARGET_LOCALES.map((l) => HOLOHOLO_LOCALES[l].code),
      },
    ],
    keySelection: {
      keywordFamilies: KEYWORD_FAMILIES,
      borrowedKeys: BORROWED_KEYS.length,
      syntheticKeywords: Object.keys(SYNTHETIC_KEYWORDS),
      missingBorrowed,
    },
    counts: {
      ingameKeysUnion: allIngameKeys.size,
      pokemonNames: Object.keys(pokemonNames).length,
    },
    missingTranslationsCount: missingByLocale,
    encoding,
    warnings,
  };
  writeJson(resolve(LOCALES_DIR, "_meta.json"), meta);
  console.log(`✓ wrote _meta.json (${warnings.length} warnings)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
