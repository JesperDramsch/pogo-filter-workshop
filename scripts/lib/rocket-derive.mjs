// Derives per-trainer counter data from Rocket lineups (ScrapedDuck's shape,
// or LeekDuck's parsed into it) and a type chart (lily-dex-api's types.json).
// Pure: no I/O, so scripts/check-rocket-counters.mjs can pin lineups the live
// feed does not currently serve. Consumer: scripts/fetch-rocket-lineups.mjs.

const GENERIC_TOP_N = 3;

// lily-dex's matchup table matches PoGo's (Gen VI+) — verified across all 18
// types against the canonical chart, so no PoGo-specific override layer is
// applied. If a future audit finds a divergence, patch typeIdx after this fn.
export function indexTypes(typesArr) {
  const idx = {};
  for (const entry of typesArr) {
    // ScrapedDuck uses lowercase type names ("fire"); lily-dex-api uses
    // TitleCase ("Fire"). Normalize both sides to lowercase.
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

// Effectiveness of a typed STAB attack from attacker (single type) against
// defender (single type). Used to compute resistors when the boss-side is
// represented as a union of types from a multi-Pokémon set.
function defenderTakesFromBossTypes(defenderType, bossTypes, typeIdx) {
  // For each boss STAB type, what does the defender take?
  return bossTypes.map(bt => eff(bt, defenderType, typeIdx));
}

// Resistors for a boss represented as a union of types (drawn from one or
// more Pokémon's typings). Same rule as the raid-counter logic.
export function resistorsFor(bossTypes, allTypeNames, typeIdx) {
  if (bossTypes.length === 0) return [];
  const out = [];
  for (const cand of allTypeNames) {
    const effs = defenderTakesFromBossTypes(cand, bossTypes, typeIdx);
    const maxEff = Math.max(...effs);
    if (maxEff > 1) continue;
    if (!effs.some(e => e < 1)) continue;
    out.push(cand);
  }
  return out;
}

// SE move types: per-Pokémon iteration. A type Y is "useful SE" iff it hits
// AT LEAST ONE Pokémon in the lineup super-effectively. Union-of-types
// would undercount because a dual-type Pokémon's resistance to one of its
// types can cancel out the SE on the other in the product.
export function seVsAnyPokemon(pokemons, allTypeNames, typeIdx) {
  if (pokemons.length === 0) return [];
  const out = [];
  for (const cand of allTypeNames) {
    for (const p of pokemons) {
      if (effVsPokemon(cand, (p.types || []).map(t => t.toLowerCase()), typeIdx) > 1) {
        out.push(cand);
        break;
      }
    }
  }
  return out;
}

// SE move types for a typed grunt. Anchored to the type chart (always
// includes types SE vs the primary type) plus "bonus coverage" types
// that hit at least half the lineup SE AND aren't resisted by the
// primary type. The resistance gate stops a single off-type secondary
// (Swinub's ground on an ice grunt) from re-introducing types whose
// STAB is halved by the headline matchup.
function seMoveTypesForTypedGrunt(primaryType, pokemons, allTypeNames, typeIdx) {
  const canonical = new Set(
    allTypeNames.filter(cand => eff(cand, primaryType, typeIdx) > 1)
  );
  const threshold = Math.ceil(pokemons.length / 2);
  const out = new Set(canonical);
  for (const cand of allTypeNames) {
    if (out.has(cand)) continue;
    if (eff(cand, primaryType, typeIdx) < 1) continue;
    let hits = 0;
    for (const p of pokemons) {
      if (effVsPokemon(cand, (p.types || []).map(t => t.toLowerCase()), typeIdx) > 1) {
        hits++;
      }
    }
    if (hits >= threshold) out.add(cand);
  }
  return [...out].sort();
}

// Top-N attacker types by "hits SE" count across a heterogeneous lineup.
// Used for generic grunts whose phase composition is too varied for a
// clean union-resistor. Ties broken alphabetically.
function topOffensiveTypes(pokemons, allTypeNames, typeIdx, topN = GENERIC_TOP_N) {
  if (pokemons.length === 0) return { types: [], hitMap: {} };
  const counts = allTypeNames.map(cand => {
    let hits = 0;
    for (const p of pokemons) {
      if (effVsPokemon(cand, (p.types || []).map(t => t.toLowerCase()), typeIdx) > 1) {
        hits++;
      }
    }
    return { type: cand, hits };
  })
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.type.localeCompare(b.type));
  const hitMap = {};
  for (const c of counts) hitMap[c.type] = c.hits;
  return { types: counts.slice(0, topN).map(c => c.type), hitMap };
}

function unionTypesOf(pokemons) {
  const set = new Set();
  for (const p of pokemons) {
    for (const t of (p.types || [])) set.add(t.toLowerCase());
  }
  return [...set];
}

// Types that appear on enough of the lineup's Pokémon to be worth a partial
// weakness guard for generic grunts. Counts per Pokémon entry (so a species
// appearing in multiple phases votes multiple times — that's the actual
// encounter exposure). Returned alphabetically for stable JSON diffs.
function commonStabsOf(pokemons, threshold) {
  const counts = {};
  for (const p of pokemons) {
    for (const t of (p.types || [])) {
      const k = t.toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return Object.keys(counts).filter(t => counts[t] >= threshold).sort();
}

function pokemonSummary(p) {
  return { name: p.name, types: (p.types || []).map(t => t.toLowerCase()) };
}

// Phases come from ScrapedDuck under camelCase keys.
function phasesOf(entry) {
  return [entry.firstPokemon || [], entry.secondPokemon || [], entry.thirdPokemon || []];
}

// Per-phase counters for a leader: resistors against the union of the phase's
// types and move types SE against at least one of its Pokémon.
function phaseCountersOf(slots, allTypeNames, typeIdx) {
  return slots.map((slot, i) => {
    const pokemons = slot.map(pokemonSummary);
    return {
      slot: i + 1,
      pokemons,
      resistorTypes: resistorsFor(unionTypesOf(slot), allTypeNames, typeIdx),
      seMoveTypes: seVsAnyPokemon(pokemons, allTypeNames, typeIdx),
    };
  });
}

function deriveLeader(entry, allTypeNames, typeIdx) {
  return { name: entry.name, kind: "leader", phases: phaseCountersOf(phasesOf(entry), allTypeNames, typeIdx) };
}

function deriveTypedGrunt(entry, allTypeNames, typeIdx) {
  const slots = phasesOf(entry);
  const pokemons = slots.flat().map(pokemonSummary);
  const unionTypes = unionTypesOf(slots.flat());
  return {
    name: entry.name,
    kind: "typed_grunt",
    type: entry.type,
    phases: slots.map((slot, i) => ({ slot: i + 1, pokemons: slot.map(pokemonSummary) })),
    resistorTypes: resistorsFor(unionTypes, allTypeNames, typeIdx),
    seMoveTypes: seMoveTypesForTypedGrunt(entry.type.toLowerCase(), pokemons, allTypeNames, typeIdx),
    lineupSize: pokemons.length,
  };
}

// A generic grunt's lineup is "themed" when every phase offers the same set
// of primary types and that set has at least two members — the shape of a
// starter-trio lineup (Bulbasaur/Charmander/Squirtle → … → Venusaur/
// Charizard/Blastoise is Grass/Fire/Water in all three phases). Derived from
// the lineup, never from species names, so a rotation to another trio (or
// away from trios) is picked up by the next sync. Returns the theme types
// in lineup order, or null.
export function themeTypesOf(slots) {
  if (slots.length === 0 || slots.some(s => s.length < 2)) return null;
  const primaries = slots.map(slot => slot.map(p => (p.types?.[0] || "").toLowerCase()));
  if (primaries.some(list => list.some(t => !t))) return null;
  const key = list => [...new Set(list)].sort().join(",");
  const first = key(primaries[0]);
  if (!primaries.every(list => key(list) === first)) return null;
  const theme = [...new Set(primaries[0])];
  return theme.length >= 2 ? theme : null;
}

// Move types worth carrying against a group of Pokémon: super effective on at
// least one of them and resisted by none. Fighting is SE on Snorlax, but it is
// dead weight in a phase that can just as well roll Gyarados or Gardevoir, and
// Rock is SE on a fire starter but halved by Swampert's ground half. When every
// SE type is walled by someone, `fallback` decides (default: plain SE
// coverage), so a filter never goes empty.
function seMoveTypesUnwalled(pokemons, allTypeNames, typeIdx, fallback = (se) => se) {
  const se = seVsAnyPokemon(pokemons, allTypeNames, typeIdx);
  const unwalled = se.filter(cand => pokemons.every(p => effVsPokemon(cand, p.types, typeIdx) >= 1));
  return unwalled.length > 0 ? unwalled : fallback(se);
}

// SE move types for a themed lineup: unwalled across the whole lineup, so a
// secondary type (Swampert's ground, Blaziken's fighting) counts as well as
// the theme. Fallback: not resisted by any theme type, which is what keeps
// electric (SE on the water line, halved by the grass line) out.
function seMoveTypesForTheme(themeTypes, pokemons, allTypeNames, typeIdx) {
  return seMoveTypesUnwalled(pokemons, allTypeNames, typeIdx,
    se => se.filter(cand => themeTypes.every(t => eff(cand, t, typeIdx) >= 1))).sort();
}

const typingKey = p => [...p.types].sort().join("/");
const countersKey = c => `${[...c.resistorTypes].sort().join(",")}|${[...c.seMoveTypes].sort().join(",")}`;

// Counter filters for an unthemed generic grunt, aiming at one filter per
// team slot. Four rules, all from types:
//   1. Per phase: resistors against the phase's types and unwalled SE moves.
//   2. A typing that can show up in two or more phases (Snorlax in all three
//      of one lineup) is worth countering wherever it appears.
//   3. Filters that come out identical merge. A phase whose Pokémon are a
//      subset of another phase's often lands here (Bellsprout alone, then
//      Raticate or Weepinbell), as does a recurring typing that fills a phase
//      on its own. Sound: the move lists are equal and the App's weakness
//      guard takes the union of every covered Pokémon's types.
//   4. A recurring typing still on its own folds into a phase it appears in
//      that shares a move type with it (most shared types, then earliest
//      phase), and that phase keeps only the shared types. Snorlax/Lapras
//      share fighting, so phase 1 becomes "fighting, and it also handles
//      Snorlax in phases 2 and 3": three filters for a team of three. With
//      no shared type the recurring typing keeps its own filter.
// A filter is labelled by its phases; a recurring typing merged into it is
// listed in `alsoPhases` / `alsoPokemons` (its Pokémon in those phases).
function genericCountersOf(slots, allTypeNames, typeIdx) {
  const summaries = slots.map(slot => slot.map(pokemonSummary));
  const entries = summaries.map((pokemons, i) => ({ phases: [i + 1], pokemons, recurring: false }));
  const byTyping = new Map();
  summaries.forEach((pokemons, i) => {
    for (const p of pokemons) {
      const key = typingKey(p);
      if (!byTyping.has(key)) byTyping.set(key, { phases: new Set(), pokemons: new Map() });
      byTyping.get(key).phases.add(i + 1);
      byTyping.get(key).pokemons.set(p.name, p);
    }
  });
  const recurring = [...byTyping.values()]
    .filter(g => g.phases.size >= 2)
    .map(g => ({ phases: [...g.phases].sort(), pokemons: [...g.pokemons.values()], recurring: true }));
  const groups = new Map();
  for (const e of [...recurring, ...entries]) {
    const counter = {
      ...e,
      resistorTypes: resistorsFor(unionTypesOf(e.pokemons), allTypeNames, typeIdx),
      seMoveTypes: seMoveTypesUnwalled(e.pokemons, allTypeNames, typeIdx),
    };
    const key = countersKey(counter);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(counter);
  }
  // The recurring Pokémon that actually appear in `phases`.
  const appearingIn = (pokemons, phases) => {
    const names = new Set(phases.flatMap(s => summaries[s - 1].map(p => p.name)));
    return pokemons.filter(p => names.has(p.name));
  };
  const counters = [...groups.values()].map(group => {
    const phaseSlots = new Set(group.filter(c => !c.recurring).flatMap(c => c.phases));
    const recurringSlots = new Set(group.filter(c => c.recurring).flatMap(c => c.phases));
    const pokemons = new Map();
    for (const c of group) for (const p of c.pokemons) pokemons.set(p.name, p);
    const isRecurring = phaseSlots.size === 0;
    const alsoPhases = isRecurring ? [] : [...recurringSlots].filter(s => !phaseSlots.has(s)).sort();
    return {
      phases: [...(isRecurring ? recurringSlots : phaseSlots)].sort(),
      alsoPhases,
      alsoPokemons: appearingIn(group.filter(c => c.recurring).flatMap(c => c.pokemons), alsoPhases),
      recurring: isRecurring,
      pokemons: [...pokemons.values()],
      resistorTypes: group[0].resistorTypes,
      seMoveTypes: group[0].seMoveTypes,
    };
  });
  const phaseCounters = counters.filter(c => !c.recurring);
  const out = [...phaseCounters];
  for (const r of counters.filter(c => c.recurring)) {
    const target = phaseCounters
      .filter(c => c.phases.some(s => r.phases.includes(s)))
      .map(c => ({ c, shared: c.seMoveTypes.filter(m => r.seMoveTypes.includes(m)) }))
      .filter(x => x.shared.length > 0)
      .sort((x, y) => (y.shared.length - x.shared.length) || (x.c.phases[0] - y.c.phases[0]))[0];
    if (!target) { out.push(r); continue; }
    const { c, shared } = target;
    c.seMoveTypes = shared;
    const extra = r.phases.filter(s => !c.phases.includes(s) && !c.alsoPhases.includes(s));
    c.alsoPhases = [...c.alsoPhases, ...extra].sort();
    const also = new Map(c.alsoPokemons.map(p => [p.name, p]));
    for (const p of appearingIn(r.pokemons, extra)) also.set(p.name, p);
    c.alsoPokemons = [...also.values()];
    const all = new Map(c.pokemons.map(p => [p.name, p]));
    for (const p of r.pokemons) all.set(p.name, p);
    c.pokemons = [...all.values()];
  }
  return out
    .map(({ alsoPhases, alsoPokemons, ...c }) => (alsoPhases.length > 0 ? { ...c, alsoPhases, alsoPokemons } : c))
    .sort((a, b) => (b.recurring - a.recurring) || (a.phases[0] - b.phases[0]));
}

// Counter filters for a themed lineup: one per line, a line being every
// Pokémon whose primary type is one theme type (the Bulbasaur line for grass).
// Every phase offers one of each line, so a single "phase" filter has to
// compromise across all of them and ends up nearly the same for every phase;
// a filter per line hard-counters that line wherever it appears, one per team
// slot. Move types are unwalled within the line (Swampert's ground half still
// drops rock from the water line).
function lineCountersOf(themeTypes, slots, allTypeNames, typeIdx) {
  return themeTypes.map(line => {
    const phases = [];
    const pokemons = new Map();
    slots.forEach((slot, i) => {
      for (const p of slot.map(pokemonSummary)) {
        if (p.types[0] !== line) continue;
        if (!phases.includes(i + 1)) phases.push(i + 1);
        pokemons.set(p.name, p);
      }
    });
    const list = [...pokemons.values()];
    return {
      line,
      phases,
      recurring: false,
      pokemons: list,
      resistorTypes: resistorsFor(unionTypesOf(list), allTypeNames, typeIdx),
      seMoveTypes: seMoveTypesUnwalled(list, allTypeNames, typeIdx),
    };
  });
}

function deriveGenericGrunt(entry, allTypeNames, typeIdx) {
  const slots = phasesOf(entry);
  const pokemons = slots.flat().map(pokemonSummary);
  const { types: top, hitMap } = topOffensiveTypes(pokemons, allTypeNames, typeIdx);
  const commonStabThreshold = Math.max(2, Math.ceil(pokemons.length / 3));
  const commonStabTypes = commonStabsOf(pokemons, commonStabThreshold);
  const themeTypes = themeTypesOf(slots);
  const theme = themeTypes
    ? {
        themeTypes,
        resistorTypes: resistorsFor(unionTypesOf(slots.flat()), allTypeNames, typeIdx),
        seMoveTypes: seMoveTypesForTheme(themeTypes, pokemons, allTypeNames, typeIdx),
      }
    : {};
  return {
    name: entry.name,
    kind: "generic_grunt",
    phases: slots.map((slot, i) => ({ slot: i + 1, pokemons: slot.map(pokemonSummary) })),
    counters: themeTypes
      ? lineCountersOf(themeTypes, slots, allTypeNames, typeIdx)
      : genericCountersOf(slots, allTypeNames, typeIdx),
    topOffensiveTypes: top,
    topHits: top.map(t => ({ type: t, hits: hitMap[t], total: pokemons.length })),
    commonStabTypes,
    commonStabThreshold,
    ...theme,
    lineupSize: pokemons.length,
  };
}

const LEADER_NAMES = new Set(["Giovanni", "Cliff", "Sierra", "Arlo"]);

function classify(entry) {
  if (LEADER_NAMES.has(entry.name)) return "leader";
  if (entry.type) return "typed_grunt";
  return "generic_grunt";
}

export function deriveTrainer(entry, allTypeNames, typeIdx) {
  switch (classify(entry)) {
    case "leader":        return deriveLeader(entry, allTypeNames, typeIdx);
    case "typed_grunt":   return deriveTypedGrunt(entry, allTypeNames, typeIdx);
    case "generic_grunt": return deriveGenericGrunt(entry, allTypeNames, typeIdx);
  }
  return null;
}
