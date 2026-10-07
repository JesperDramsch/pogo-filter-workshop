// Counter planning for Team GO Rocket grunts: which move types to bring, and
// which lineup Pokémon are tanks that deserve their own hard-hitter filter.
//
// Pure functions only. scripts/fetch-rocket-lineups.mjs feeds them the
// lily-dex-api type chart and the game master; scripts/check-rocket-cover.mjs
// pins their behaviour on a toy chart, offline.
//
// WHY A SET COVER. A grunt battle is fought one slot at a time, and a two-slot
// grunt team (buddy lead for hearts, then two counters) brings exactly two
// counters. The old typed-grunt rule merged every "good" move type into one
// list, which looks like full coverage while no single pick from it covers the
// lineup: a Dark attacker out of the Psychic grunt's Bug/Dark/Ghost list is
// neutral on Gallade and Ralts. Worse, it anchored on the grunt's headline type,
// so a pure-Water Seel in the Ice grunt's first slot took neutral or resisted
// hits from the whole list (Fire and Steel are halved by Water) and nothing
// flagged it. Here every lineup species is a set element, every move type the
// set of species it hits super-effectively, and the question is answered
// exhaustively: one window if one move type covers everyone, else the best
// split into two windows, else the best two plus the species nothing reaches.

// ── Type chart ─────────────────────────────────────────────────────────────

// lily-dex-api's types.json → { type: { doubleFrom, halfFrom, noFrom } }.
// lily-dex's matchup table matches PoGo's (Gen VI+), verified across all 18
// types against the canonical chart, so no PoGo-specific override layer is
// applied. If a future audit finds a divergence, patch the index here.
// ScrapedDuck uses lowercase type names ("fire"); lily-dex-api uses TitleCase
// ("Fire"). Normalize both sides to lowercase.
export function indexTypes(typesArr) {
  const idx = {};
  for (const entry of typesArr) {
    const key = entry.type.toLowerCase();
    idx[key] = {
      doubleFrom: new Set((entry.doubleDamageFrom || []).map(s => s.toLowerCase())),
      halfFrom:   new Set((entry.halfDamageFrom   || []).map(s => s.toLowerCase())),
      noFrom:     new Set((entry.noDamageFrom     || []).map(s => s.toLowerCase())),
    };
  }
  return idx;
}

export function eff(att, def, typeIdx) {
  const d = typeIdx[def];
  if (!d) return 1;
  if (d.noFrom.has(att))     return 0;
  if (d.halfFrom.has(att))   return 0.5;
  if (d.doubleFrom.has(att)) return 2;
  return 1;
}

// Combined effectiveness of attacker type Y against a Pokémon with possibly
// multiple types (PoGo: multiplicative).
export function effVsPokemon(att, pokemonTypes, typeIdx) {
  return pokemonTypes.reduce((acc, t) => acc * eff(att, t, typeIdx), 1);
}

// Move types that hit a Pokémon of these types super-effectively, sorted.
export function seTypesAgainst(pokemonTypes, allTypeNames, typeIdx) {
  const types = (pokemonTypes || []).map(t => t.toLowerCase());
  return allTypeNames.filter(t => effVsPokemon(t, types, typeIdx) > 1).sort();
}

// Only the move types at the highest multiplier against these types: Ice
// alone on Dragonite (4×), Fighting/Steel on Aurorus (4×; Ground is only 2×), all three
// 2× types on Wobbuffet. Empty when nothing is super-effective.
export function bestTypesAgainst(pokemonTypes, allTypeNames, typeIdx) {
  const types = (pokemonTypes || []).map(t => t.toLowerCase());
  const scored = allTypeNames.map(t => [t, effVsPokemon(t, types, typeIdx)]);
  const top = Math.max(...scored.map(([, e]) => e));
  if (!(top > 1)) return [];
  return scored.filter(([, e]) => e === top).map(([t]) => t).sort();
}

// ── Counter windows ────────────────────────────────────────────────────────

// Two windows is the most a two-counter team can use. A lineup that needs more
// gets the best two plus an explicit `uncovered` list, never a third window.
export const MAX_WINDOWS = 2;

// Distinct species of a lineup, first appearance wins. A species offered in two
// slots (Froslass, Wobbuffet) is still one element to cover.
// `slots` counts how many lineup entries offer the species: Snorlax in all
// three of a grunt's slots is three times the exposure of a slot-1-only Seel.
export function distinctSpecies(pokemons) {
  const seen = new Map();
  for (const p of pokemons || []) {
    const hit = seen.get(p.name);
    if (hit) hit.slots++;
    else seen.set(p.name, { name: p.name, types: (p.types || []).map(t => t.toLowerCase()), slots: 1 });
  }
  return [...seen.values()];
}

// The counter plan for one lineup:
//   { windows: [{ types, covers }], uncovered }
// Every move type in a window is super-effective against every species that
// window `covers`, so any counter carrying those moves handles that whole
// part of the lineup. The windows' `covers` and `uncovered` partition the
// distinct lineup.
//
// Exhaustive over assignments of each species to window 1, window 2 or
// neither (3^n; n ≤ 9 distinct species in any lineup seen, ~20k cases).
// Ranked, best first, by:
//   1. most lineup exposure covered (species weighted by the slots offering
//      them, so a plan never trades Snorlax-in-every-slot for a one-off)
//   2. fewest windows: one window is the answer to "is one counter type enough"
//   3. widest narrowest window (more move types = more of your box qualifies)
//   4. widest windows in total
//   5. a deterministic tie-break, so the snapshot does not churn
export function counterPlan(pokemons, allTypeNames, typeIdx) {
  const species = distinctSpecies(pokemons);
  const n = species.length;
  if (n === 0) return { windows: [], uncovered: [] };
  // hits[t] = bitmask of species t hits super-effectively.
  const hits = allTypeNames.map(t =>
    species.reduce((mask, s, i) => (effVsPokemon(t, s.types, typeIdx) > 1 ? mask | (1 << i) : mask), 0),
  );
  const windowTypes = (mask) => allTypeNames.filter((_, ti) => (hits[ti] & mask) === mask).sort();
  const memo = new Map();
  const typesFor = (mask) => {
    if (!memo.has(mask)) memo.set(mask, windowTypes(mask));
    return memo.get(mask);
  };
  const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; };
  const weight = (m) => species.reduce((w, s, i) => (m & (1 << i) ? w + s.slots : w), 0);

  let best = null;
  const total = 3 ** n;
  for (let code = 0; code < total; code++) {
    let a = 0, b = 0, c = code;
    for (let i = 0; i < n; i++) {
      const slot = c % 3;
      c = (c - slot) / 3;
      if (slot === 1) a |= 1 << i;
      else if (slot === 2) b |= 1 << i;
    }
    if (a === 0 && b !== 0) continue; // window 1 is never the empty one
    if (b !== 0 && popcount(b) > popcount(a)) continue; // larger window first
    const wa = a ? typesFor(a) : [];
    if (a && wa.length === 0) continue;
    const wb = b ? typesFor(b) : [];
    if (b && wb.length === 0) continue;
    const windows = [];
    if (a) windows.push({ mask: a, types: wa });
    if (b) windows.push({ mask: b, types: wb });
    const score = [
      weight(a | b),
      -windows.length,
      windows.length ? Math.min(...windows.map(w => w.types.length)) : 0,
      windows.reduce((s, w) => s + w.types.length, 0),
      popcount(a),
    ];
    const key = windows.map(w => `${w.mask}:${w.types.join(",")}`).join("|");
    if (!best || better(score, key, best)) best = { score, key, windows };
  }

  const covered = best.windows.reduce((m, w) => m | w.mask, 0);
  const names = (mask) => species.filter((_, i) => mask & (1 << i)).map(s => s.name);
  return {
    windows: best.windows.map(w => ({ types: w.types, covers: names(w.mask) })),
    uncovered: species.filter((_, i) => !(covered & (1 << i))).map(s => s.name),
  };
}

function better(score, key, best) {
  for (let i = 0; i < score.length; i++) {
    if (score[i] !== best.score[i]) return score[i] > best.score[i];
  }
  return key < best.key;
}

// ── Tanks ──────────────────────────────────────────────────────────────────

// A lineup Pokémon is a tank when its base Defence × Stamina is in the top
// eighth of all species. Time to faint a defender scales with that product
// (damage ∝ attack / defence, and it has to chew through stamina), so it is
// the level-independent bulk ranking. Measured 2026-10-07 over 1,024 species:
// Snorlax sits at 1.2 %, Wobbuffet at 11.8 %, while Seel (63 %) is not bulky at
// all — its problem was move coverage, which the windows above solve.
export const TANK_TOP_FRACTION = 1 / 8;

// Regional prefixes ScrapedDuck puts on lineup names → the game master's form
// suffix. Anything else resolves to the base form.
const REGION_FORM = { alolan: "ALOLA", galarian: "GALARIAN", hisuian: "HISUIAN", paldean: "PALDEA" };

// One bulk figure per dex for the population (base form where one exists),
// plus every form's own figure for lookups. `templates` is the output of
// pokemonTemplates() + formSuffix() from scripts/lib/game-master.mjs, passed
// in as { dex, suffix, stats } so this file stays free of the dump's shape.
export function bulkTable(forms, topFraction = TANK_TOP_FRACTION) {
  const byDex = new Map();
  const byForm = new Map();
  for (const { dex, suffix, stats } of forms) {
    if (!stats?.baseDefense || !stats?.baseStamina) continue;
    const bulk = stats.baseDefense * stats.baseStamina;
    const isBase = suffix == null || suffix === "NORMAL";
    if (suffix) byForm.set(`${dex}|${suffix}`, bulk);
    const prev = byDex.get(dex);
    if (!prev || (isBase && !prev.isBase)) byDex.set(dex, { bulk, isBase });
  }
  const population = [...byDex.values()].map(e => e.bulk).sort((x, y) => y - x);
  const cutoff = population.length ? population[Math.max(0, Math.ceil(population.length * topFraction) - 1)] : null;
  return { byDex, byForm, cutoff, populationSize: population.length };
}

// "Alolan Ninetales" → its bulk, via the English dex dictionary
// (src/locales/pokemon-names.json). null when the name does not resolve.
export function bulkOf(name, table, enNameToDex) {
  const m = /^(alolan|galarian|hisuian|paldean)\s+(.+)$/i.exec(name.trim());
  const base = (m ? m[2] : name).trim().toLowerCase();
  const dex = enNameToDex.get(base);
  if (dex == null) return null;
  if (m) {
    const form = table.byForm.get(`${dex}|${REGION_FORM[m[1].toLowerCase()]}`);
    if (form != null) return form;
  }
  return table.byDex.get(dex)?.bulk ?? null;
}

export function enNameIndex(nameDict) {
  const map = new Map();
  for (const [dex, entry] of Object.entries(nameDict)) {
    if (entry?.en && /^\d+$/.test(dex)) map.set(entry.en.toLowerCase(), Number(dex));
  }
  return map;
}

// Tanks of one lineup, with the move types that hit each hardest.
// `bulkBySpecies` maps lineup name → bulk (null for unresolved names, which are
// never tanks).
export function tanksOf(pokemons, bulkBySpecies, cutoff, allTypeNames, typeIdx) {
  if (cutoff == null) return [];
  return distinctSpecies(pokemons)
    .filter(s => (bulkBySpecies[s.name] ?? -1) >= cutoff)
    .map(s => ({ name: s.name, types: s.types, seMoveTypes: bestTypesAgainst(s.types, allTypeNames, typeIdx) }))
    .filter(t => t.seMoveTypes.length > 0);
}
