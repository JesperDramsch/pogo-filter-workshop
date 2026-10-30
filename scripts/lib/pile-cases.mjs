// The Pokémon every sorting pile's step ③ is tested against, shared by
// check-data-filters D18 (event piles) and check-piles (every pile family).
//
// PROTECTED is the spec's protection tail, one kind per row: step ③ must give
// each of them a DEFINITE "no" (an unknown term would read as a soft no and
// hide a gap). RELEASABLE is what steps ① and ② leave to the user and ③ must
// still show; it is what made the old `pile & trash` view come up empty.
//
// The tail reads two settings, so two rows move with `cfg`: a nundo is
// PROTECTED only when cfg.protectNundos, and a mythical named in
// cfg.mythTooManyOf is a spare and RELEASABLE (the plain "mythical" row is a
// species the carve does not name, so it stays PROTECTED).
import { candyFamilyNames, ivToBar, speciesForOutput, starFromIVs } from "../../src/App.jsx";
import { pokemonNameFor, resolveSpeciesInfo } from "../../src/data/species.js";

export const PILE_SPECIES = "Magikarp";
export const PILE_DEX = 129;

// What buildFilters hands protectionTail for `cfg` in output locale `loc`: the
// mythical carve in the output locale and the localised Smeargle name
// (species 235, as the trash's legacy-move clause spells it).
export function tailOptions(cfg, loc) {
  return {
    mythCarve: (cfg.mythTooManyOf || []).map((name) => speciesForOutput(name, loc)).filter(Boolean),
    smeargle: pokemonNameFor("235", loc)?.toLowerCase() || "smeargle",
  };
}

// A Pokémon of `species` (default the synthetic pile's) in the shape the
// evaluator reads: raw 0-15 IVs in, bars and star derived, like VerifyPanel.
export function pileMon(loc, o = {}, species = PILE_SPECIES, dex = PILE_DEX) {
  return {
    dex, species: species.toLowerCase(), families: candyFamilyNames(species, loc), types: [],
    wp: 200, ageDays: 1, year: 2026, distance: 0, tags: [],
    ...o,
    flags: { ...(o.flags || {}) },
    atk: ivToBar(o.ivAtk ?? 3), def: ivToBar(o.ivDef ?? 7), hp: ivToBar(o.ivHp ?? 9),
    star: starFromIVs(o.ivAtk ?? 3, o.ivDef ?? 7, o.ivHp ?? 9),
  };
}

export function pileCases(cfg) {
  const floorYear = 2000 + cfg.luckyEligibleYear - 1;
  const nundo = ["nundo", { ivAtk: 0, ivDef: 0, ivHp: 0 }];
  // A carved-out mythical in the pile: the evaluator answers a species term
  // by dex and the pile's head by candy family, so the row wears the carved
  // species' dex over the pile member's family. The tail's `!mythical,<name>`
  // is what it tests; the head is the member's. `moves: []` on the legacy row
  // makes `@return` and `@frustration` definite (a mon without a move list
  // leaves a named move unknown, as the verify panel wants).
  const spares = (cfg.mythTooManyOf || [])
    .map((name) => [name, resolveSpeciesInfo(name)])
    .filter(([, info]) => info)
    .map(([name, info]) => [`mythical spare (${name})`, { flags: { mythical: true }, dex: info.dex, species: String(name).toLowerCase() }]);
  return {
    PROTECTED: [
      ["starred", { flags: { favorite: true } }],
      ["tagged", { tags: ["Evolve"] }],
      ["hundo", { ivAtk: 15, ivDef: 15, ivHp: 15 }],
      ...(cfg.protectNundos ? [nundo] : []),
      [`caught ${floorYear}, untraded`, { year: floorYear }],
      ["Max Attack 2", { dynaAtk: 2, flags: { dynamaxCapable: true } }],
      ["Max Guard 1", { dynaAtk: 1, dynaWall: 1, flags: { dynamaxCapable: true } }],
      ["Max Spirit 1", { dynaAtk: 1, dynaSpirit: 1, flags: { dynamaxCapable: true } }],
      ["Good buddy", { buddyLevel: 2, flags: { buddy: true } }],
      ["mythical", { flags: { mythical: true } }],
      ["shiny legendary", { flags: { shiny: true, legendary: true } }],
      ["legendary with a background", { flags: { background: true, legendary: true } }],
      ["legacy move", { moves: [], flags: { legacyMove: true } }],
    ],
    RELEASABLE: [
      ["plain dupe", {}],
      ...(cfg.protectNundos ? [] : [nundo]),
      ["0/0/1, not a nundo", { ivAtk: 0, ivDef: 0, ivHp: 1 }],
      ...spares,
      [`caught ${floorYear}, traded`, { year: floorYear, flags: { traded: true } }],
      [`caught ${floorYear + 1}, untraded (just past the floor)`, { year: floorYear + 1 }],
      ["fresh Dynamax", { dynaAtk: 1, flags: { dynamaxCapable: true } }],
      ["level-1 buddy", { buddyLevel: 1, flags: { buddy: true } }],
      ["shiny", { flags: { shiny: true } }],
      ["lucky", { flags: { lucky: true } }],
      ["shadow", { flags: { shadow: true } }],
      ["XXL", { flags: { xxl: true } }],
      ["costume", { flags: { costume: true } }],
      ["plain legendary", { flags: { legendary: true } }],
    ],
  };
}
