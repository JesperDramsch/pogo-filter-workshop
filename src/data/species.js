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
