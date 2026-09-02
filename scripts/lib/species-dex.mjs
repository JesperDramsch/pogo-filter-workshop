// One implementation of "does every dex in a PvP pool have a real name in every
// locale we emit filters for?", shared by the producer and the checker.
//
// The fetcher used to hand-roll a weaker version of this (bare key presence in
// pokemon-names.json) while check-data-filters D6 ran `pokemonNameFor` over the
// same data. The two were not equivalent, so the fetcher could publish a
// snapshot that CI then rejected — on a file the sync job had already pushed to
// main.
//
// Deliberately STRICT, where `pokemonNameFor` is deliberately lenient.
// `pokemonNameFor` falls back to the English entry so the app renders something
// rather than nothing; that fallback means a per-locale hole can never fail a
// check written on top of it, and a per-locale hole is exactly the defect worth
// catching — a German filter silently carrying an English species name is, per
// CLAUDE.md, "a bug in all seven locales". So this reads `entry[locale]` with no
// fallback.
//
// Takes the dictionary as an argument rather than importing it: the fetchers run
// under plain node (where a JSON import needs an import attribute) and the checks
// run under vite-node, and both need the same answer.

import { readFileSync } from "node:fs";

// Mirrors SUPPORTED_NAME_LOCALES in src/data/species.js, which the fetchers
// cannot import (plain node, and species.js imports a JSON module without an
// import attribute). check-data-filters D6 asserts the two lists agree, so this
// copy cannot drift unnoticed.
export const NAME_LOCALES = ["en", "de", "es", "fr", "zh-TW", "hi", "ja"];

// For plain-node callers that cannot `import ... from "*.json"`.
export function loadNameDict(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// The other half of "is this pool entry usable?", shared for the same reason:
// the fetcher writes the file, check-data-filters D6 rejects it, and a weaker
// copy on the producer side means the sync job publishes what CI then fails on.
//
// A stored `name` must be the BASE species name. App.jsx falls back to
// `s.name.toLowerCase()` when the dex dictionary misses, so a leftover form
// suffix emits `+giratina (altered)` — a filter token with a space in it that
// matches no Pokémon at all.
//
// pools: [[label, species[]], ...]. Returns human-readable diagnostics, empty
// when every name is a base name.
export function formSuffixedDexEntries(pools) {
  const bad = [];
  for (const [label, species] of pools) {
    for (const s of species || []) {
      if (typeof s?.name === "string" && /[()]/.test(s.name)) {
        bad.push(`${label}:${s.name} (form suffix, not a base name)`);
      }
    }
  }
  return bad;
}

// pools: [[label, species[]], ...]. Returns human-readable diagnostics, empty
// when everything resolves.
export function unresolvableDexEntries(pools, dict, locales) {
  const bad = [];
  for (const [label, species] of pools) {
    for (const s of species || []) {
      const entry = dict[String(s.dex)];
      if (!entry) {
        bad.push(`${label}:${s.dex} (${s.name}) — absent from pokemon-names.json`);
        continue;
      }
      const gaps = locales.filter((loc) => !entry[loc]);
      if (gaps.length > 0) bad.push(`${label}:${s.dex} (${s.name}) — no ${gaps.join("/")} name`);
    }
  }
  return bad;
}
