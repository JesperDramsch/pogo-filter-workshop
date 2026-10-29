// The Pokémon every sorting pile's step ③ is tested against, shared by
// check-data-filters D18 (event piles) and check-piles (every pile family).
//
// PROTECTED is the spec's protection tail, one kind per row: step ③ must give
// each of them a DEFINITE "no" (an unknown term would read as a soft no and
// hide a gap). RELEASABLE is what steps ① and ② leave to the user and ③ must
// still show; it is what made the old `pile & trash` view come up empty.
import { candyFamilyNames, ivToBar, starFromIVs } from "../../src/App.jsx";

export const PILE_SPECIES = "Magikarp";
export const PILE_DEX = 129;

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
  return {
    PROTECTED: [
      ["starred", { flags: { favorite: true } }],
      ["tagged", { tags: ["Evolve"] }],
      ["hundo", { ivAtk: 15, ivDef: 15, ivHp: 15 }],
      ["nundo", { ivAtk: 0, ivDef: 0, ivHp: 0 }],
      [`caught ${floorYear}, untraded`, { year: floorYear }],
      ["Max Attack 2", { dynaAtk: 2, flags: { dynamaxCapable: true } }],
      ["Max Guard 1", { dynaAtk: 1, dynaWall: 1, flags: { dynamaxCapable: true } }],
      ["Max Spirit 1", { dynaAtk: 1, dynaSpirit: 1, flags: { dynamaxCapable: true } }],
      ["Good buddy", { buddyLevel: 2, flags: { buddy: true } }],
      ["mythical", { flags: { mythical: true } }],
      ["shiny legendary", { flags: { shiny: true, legendary: true } }],
      ["legendary with a background", { flags: { background: true, legendary: true } }],
    ],
    RELEASABLE: [
      ["plain dupe", {}],
      ["0/0/1, not a nundo", { ivAtk: 0, ivDef: 0, ivHp: 1 }],
      [`caught ${floorYear}, traded`, { year: floorYear, flags: { traded: true } }],
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
