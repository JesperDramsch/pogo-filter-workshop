// Multi-locale Pokémon species data + resolvers.
//
// Data shape (from src/locales/pokemon-names.json, generated at build time):
//   { "1": { en: "Bulbasaur", de: "Bisasam", ... }, "3_1": { ... mega ... } }
//
// Keys are dex numbers as strings; mega/gigantamax forms use "<dex>_<form>"
// (e.g. "3_1" = Mega Venusaur, "6_178_2" = Gigantamax Charizard).
//
// Resolvers accept input in any supported locale (number, EN, DE, FR, ES,
// zh-TW, HI, JA) and return the canonical name in the chosen output locale,
// lowercased to match PoGo search syntax conventions.

import POKEMON_NAMES_DICT from "../locales/pokemon-names.json";

export { POKEMON_NAMES_DICT };

export const SUPPORTED_NAME_LOCALES = ["en", "de", "es", "fr", "zh-TW", "hi", "ja"];
export const DEFAULT_OUTPUT_LOCALE = "de";

// Memoized reverse lookups: locale → Map<lowercaseName, dexKey>.
// Built lazily because some locales may never be used in a session.
const _reverseLookups = {};

function buildReverseLookup(locale) {
  const map = new Map();
  for (const [dexKey, names] of Object.entries(POKEMON_NAMES_DICT)) {
    const v = names[locale];
    if (v) map.set(v.toLowerCase(), dexKey);
  }
  return map;
}

function getReverseLookup(locale) {
  if (!_reverseLookups[locale]) _reverseLookups[locale] = buildReverseLookup(locale);
  return _reverseLookups[locale];
}

// Tolerant spelling for typed input: Latin diacritics dropped (flabebe →
// Flabébé), the punctuation people skip dropped (mr mime, farfetchd), hyphens
// read as spaces (ho oh), full-width letters folded (ＸＹ in the Japanese Mega
// names). Only U+0300–U+036F is stripped: Devanagari vowel
// signs and Japanese dakuten are combining marks too, and removing them would
// change the name rather than its spelling.
export function looseName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’:]/g, "")
    .replace(/[\s-]+/g, " ")
    .trim();
}
const compactName = (loose) => loose.replace(/ /g, "");

// locale → Map<loose or compact spelling, dexKey>. A spelling two species
// share maps to null so the fallback never guesses between them.
const _looseLookups = {};
function getLooseLookup(locale) {
  if (_looseLookups[locale]) return _looseLookups[locale];
  const map = new Map();
  for (const [dexKey, names] of Object.entries(POKEMON_NAMES_DICT)) {
    const v = names[locale];
    if (!v) continue;
    const loose = looseName(v);
    for (const k of new Set([loose, compactName(loose)])) {
      if (!map.has(k)) map.set(k, dexKey);
      else if (map.get(k) !== dexKey) map.set(k, null);
    }
  }
  return (_looseLookups[locale] = map);
}

// Returns the canonical lowercase name in `outputLocale` for a dex key, falling
// back to EN if the locale entry is missing. Returns null for unknown keys.
export function pokemonNameFor(dexKey, outputLocale = DEFAULT_OUTPUT_LOCALE) {
  const entry = POKEMON_NAMES_DICT[dexKey];
  if (!entry) return null;
  const v = entry[outputLocale] ?? entry.en;
  return v ? v.toLowerCase() : null;
}

// Parses input — number, +prefix, or any-locale name — and returns the dex key
// + the locale we matched in. Returns null if no match.
function findDexKey(input, outputLocale) {
  const raw = String(input || "").trim().replace(/^\+/, "");
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const dex = String(parseInt(raw, 10));
    if (POKEMON_NAMES_DICT[dex]) return { dexKey: dex, inputLocale: "number" };
    return null;
  }

  const lower = raw.toLowerCase();

  // Try output locale first — lets users in DE typing DE names resolve fastest
  // and avoids ambiguity for collisions (rare but exist, e.g. "Pikachu").
  const order = [outputLocale, ...SUPPORTED_NAME_LOCALES.filter((l) => l !== outputLocale)];
  for (const loc of order) {
    const dexKey = getReverseLookup(loc).get(lower);
    if (dexKey) return { dexKey, inputLocale: loc };
  }
  // Exact spellings win in every locale before any tolerant match is tried.
  const loose = looseName(raw);
  for (const key of new Set([loose, compactName(loose)])) {
    for (const loc of order) {
      const dexKey = getLooseLookup(loc).get(key);
      if (dexKey) return { dexKey, inputLocale: loc };
    }
  }
  return null;
}

// Resolve any input → canonical lowercase name in `outputLocale`. Returns null
// if not found. Strips `+` prefix.
export function resolveSpecies(input, outputLocale = DEFAULT_OUTPUT_LOCALE) {
  const found = findDexKey(input, outputLocale);
  if (!found) return null;
  return pokemonNameFor(found.dexKey, outputLocale);
}

// Returns full info — useful for UI chip previews showing input → output mapping.
// Shape: { dex, dexKey, names: { en, de, ... }, inputLocale }
//   dex      — integer base dex number
//   dexKey   — canonical key used in POKEMON_NAMES_DICT (may include form suffix)
//   names    — full name map for all available locales
//   inputLocale — which locale matched the user's input ("number" if numeric)
export function resolveSpeciesInfo(input, outputLocale = DEFAULT_OUTPUT_LOCALE) {
  const found = findDexKey(input, outputLocale);
  if (!found) return null;
  const entry = POKEMON_NAMES_DICT[found.dexKey];
  const baseDex = parseInt(found.dexKey.split("_")[0], 10);
  return {
    dex: baseDex,
    dexKey: found.dexKey,
    names: { ...entry },
    inputLocale: found.inputLocale,
  };
}

// Splits a typed species list into tokens. Commas, semicolons and newlines
// always separate; whitespace separates too, except inside a multi-word name
// ("Tapu Koko", "Mr. Mime", "Mega Charizard X"), which is matched greedily,
// longest first. A plain whitespace split made those species unreachable by
// name.
let _maxNameWords = 0;
function maxNameWords() {
  if (_maxNameWords) return _maxNameWords;
  let max = 1;
  for (const names of Object.values(POKEMON_NAMES_DICT))
    for (const v of Object.values(names)) max = Math.max(max, v.trim().split(/\s+/).length);
  return (_maxNameWords = max);
}

export function splitSpeciesInput(raw) {
  const out = [];
  for (const chunk of String(raw || "").split(/[,;\n]+/)) {
    const words = chunk.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length) {
      let j = Math.min(words.length, i + maxNameWords());
      while (j > i + 1 && !findDexKey(words.slice(i, j).join(" "), DEFAULT_OUTPUT_LOCALE)) j--;
      out.push(words.slice(i, j).join(" "));
      i = j;
    }
  }
  return out;
}

// Autocomplete candidates for a partial name or dex number. One row per
// dexKey, ranked: whole-name prefix, then word prefix ("koko" → Tapu Koko,
// "glurak" → Mega-Glurak), then substring (3+ characters only, it is noise
// below that). Within a rank, base species before Mega/Gigantamax forms,
// matches in the output locale before English before the rest, then dex order.
//
// Row shape: { dexKey, dex, name, matched, matchedLocale }
//   name    — display name in outputLocale (EN fallback), original casing
//   matched — the name the query matched, which may be in another locale;
//             null for a dex-number query
let _suggestIndex = null;
function suggestIndex() {
  if (_suggestIndex) return _suggestIndex;
  _suggestIndex = [];
  for (const [dexKey, names] of Object.entries(POKEMON_NAMES_DICT)) {
    for (const loc of SUPPORTED_NAME_LOCALES) {
      const v = names[loc];
      if (!v) continue;
      const loose = looseName(v);
      _suggestIndex.push({ dexKey, loc, name: v, loose, compact: compactName(loose), words: loose.split(" ") });
    }
  }
  return _suggestIndex;
}

function suggestionRow(dexKey, matched, matchedLocale, outputLocale) {
  const names = POKEMON_NAMES_DICT[dexKey];
  return {
    dexKey,
    dex: parseInt(dexKey.split("_")[0], 10),
    name: names[outputLocale] ?? names.en,
    matched,
    matchedLocale,
  };
}

export function suggestSpecies(query, outputLocale = DEFAULT_OUTPUT_LOCALE, limit = 8) {
  const raw = String(query || "").trim().replace(/^\+/, "");
  if (!raw) return [];

  if (/^\d+$/.test(raw)) {
    const n = String(parseInt(raw, 10));
    return Object.keys(POKEMON_NAMES_DICT)
      .filter((k) => !k.includes("_") && k.startsWith(n))
      .sort((a, b) => a.length - b.length || Number(a) - Number(b))
      .slice(0, limit)
      .map((k) => suggestionRow(k, null, "number", outputLocale));
  }

  const q = looseName(raw);
  if (!q) return [];
  const qc = compactName(q);
  const localeRank = (loc) => (loc === outputLocale ? 0 : loc === "en" ? 1 : 2);
  const best = new Map();
  for (const e of suggestIndex()) {
    let rank;
    if (e.loose.startsWith(q) || e.compact.startsWith(qc)) rank = 0;
    else if (e.words.some((w, i) => i > 0 && w.startsWith(q))) rank = 1;
    else if (q.length >= 3 && e.loose.includes(q)) rank = 2;
    else continue;
    const key = [rank, e.dexKey.includes("_") ? 1 : 0, localeRank(e.loc)];
    const prev = best.get(e.dexKey);
    if (!prev || compareKeys(key, prev.key) < 0) best.set(e.dexKey, { key, e });
  }
  const dexOf = (k) => parseInt(k.split("_")[0], 10);
  return [...best.values()]
    .sort((a, b) => compareKeys(a.key, b.key) || dexOf(a.e.dexKey) - dexOf(b.e.dexKey) || a.e.dexKey.localeCompare(b.e.dexKey))
    .slice(0, limit)
    .map(({ e }) => suggestionRow(e.dexKey, e.name, e.loc, outputLocale));
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// The part of a species-list input the caret is completing, as
// { start, end, query } (end = caret), or null when there is nothing to
// complete. The query is the longest run of trailing words in the current
// comma chunk that still has suggestions, so "pikachu tapu k" completes
// "tapu k" and "pikachu r" completes "r".
export function speciesQueryAt(value, caret, outputLocale = DEFAULT_OUTPUT_LOCALE) {
  const text = String(value || "");
  const end = Math.max(0, Math.min(caret ?? text.length, text.length));
  const before = text.slice(0, end);
  if (!before || /[\s,;]$/.test(before)) return null;
  const chunkStart = Math.max(before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1;
  const starts = [];
  const re = /\S+/g;
  let m;
  const chunk = before.slice(chunkStart);
  while ((m = re.exec(chunk))) starts.push(chunkStart + m.index);
  for (const start of starts.slice(-maxNameWords())) {
    const query = text.slice(start, end);
    if (suggestSpecies(query, outputLocale, 1).length > 0) return { start, end, query };
  }
  return null;
}
