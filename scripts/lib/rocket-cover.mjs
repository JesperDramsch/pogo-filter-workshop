// Counter planning for Team GO Rocket typed grunts: which counters to bring,
// and which lineup Pokémon are tanks.
//
// Pure functions only. scripts/fetch-rocket-lineups.mjs feeds them the
// lily-dex-api type chart and the game master; scripts/check-rocket-cover.mjs
// pins their behaviour on a toy chart, offline.
//
// THE BATTLE THIS PLANS FOR. A grunt fight is PvP-style: switching has a
// cooldown, and both a switch and a charged attack stun the grunt. The team is
// a buddy lead (for hearts, usually no useful moves), then two counters:
//
//   Box 1, the main counter, comes in right after the lead and fast-moves the
//   grunt's slot 1 down while it builds energy. If its fast move is not
//   super-effective against whatever slot 1 turned out to be, the fight is
//   too slow to be worth finishing. The switch cooldown then keeps it in for
//   slot 2, and its charged move lands wherever the bar is full, often slot 3.
//
//   Box 2, the backup, takes over when the main counter goes down, so it only
//   ever faces slots 2 and 3.
//
// Every rule below follows from that, and each was checked against the whole
// game master (every released species with its learnable moves) before it
// went in:
//
//   Box 1: a fast move super-effective against EVERY Pokémon that can lead.
//          When no single type manages that (the Normal grunt: Fighting for
//          Teddiursa and Porygon, nothing for Hoothoot), Box 1 splits into one
//          version per group of leads. Defence is "weak to nothing slots 2 and
//          3 can throw", except a KILLER type: one that on its own rules out at
//          least a third of the species carrying the right fast move (the
//          candidates). Swampert's Ground is one for the Water grunt: every
//          Electric attacker is weak to it. Ghost on the Ice grunt is not, so
//          Froslass stays in the check, as a search in a real storage showed it
//          should. A Pokémon carrying a killer type is handed over to Box 2.
//   Box 2: built for the handed-over Pokémon when there are any. A move in
//          either slot whose type hits as many of them as possible (all of them,
//          so far) super-effectively and that nothing in slots 2 and 3 resists.
//          Without a handover it is the general backup: a type super-effective
//          against at least half of slots 2 and 3 and resisted by none, plus the
//          types that hit a slot-2/3 tank hardest when nobody resists those.
//          Defence is "weak to none of the types that recur in slots 2 and 3
//          (two entries or more) or that the handed-over Pokémon carry", and
//          resists one of them or is a top attacker. Guarding against every
//          one-off type as well left the Water grunt's Box 2 with 14 regular
//          species.

// ── Type chart ─────────────────────────────────────────────────────────────

// The type chart helpers live in scripts/lib/rocket-derive.mjs, shared with
// the lineup derivation.
import { effVsPokemon, resistorsFor } from "./rocket-derive.mjs";

// Only the move types at the highest multiplier against these types: Ice
// alone on Dragonite (4×), Fighting/Steel on Aurorus (4×; Ground is only
// 2×), all three 2× types on Wobbuffet. Empty when nothing is super-effective.
export function bestTypesAgainst(pokemonTypes, allTypeNames, typeIdx) {
  const types = (pokemonTypes || []).map(t => t.toLowerCase());
  const scored = allTypeNames.map(t => [t, effVsPokemon(t, types, typeIdx)]);
  const top = Math.max(...scored.map(([, e]) => e));
  if (!(top > 1)) return [];
  return scored.filter(([, e]) => e === top).map(([t]) => t).sort();
}

// ── Covering a set of Pokémon with move types ──────────────────────────────

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

// The move-type cover of a group of Pokémon (Box 1 uses it on slot 1):
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
// all: its problem was move coverage, which Box 1's slot-1 rule solves.
// On typed grunts a tank only steers the general backup's move types (Box 2
// without a handover); generic grunts mark their tanks in the counter hints.
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

// ── Box 1 candidates ───────────────────────────────────────────────────────

// A slot-2/3 type is a killer when one in KILLER_ONE_IN candidates or more is
// weak to it. A third separates Swampert's Ground on the Water grunt (a killer)
// from Froslass' Ghost on the Ice grunt (not one), and leaves every Box 1 with
// at least seven strong regular species.
export const KILLER_ONE_IN = 3;

// Every base and regional form, as { types, fastTypes }: the population Box 1
// draws its candidates from. `forms` is the output of pokemonTemplates() +
// formSuffix() + typesOf() from scripts/lib/game-master.mjs, passed in as
// { dex, suffix, types, fastTypes } so this file stays free of the dump's
// shape. The game master ships some forms twice; the first one wins.
export function attackerPool(forms) {
  const regional = new Set(Object.values(REGION_FORM));
  const seen = new Set();
  const pool = [];
  for (const { dex, suffix, types, fastTypes } of forms) {
    const form = suffix ?? "NORMAL";
    if (form !== "NORMAL" && !regional.has(form)) continue;
    const key = `${dex}|${form}`;
    if (seen.has(key) || !types?.length || !fastTypes?.length) continue;
    seen.add(key);
    pool.push({ types: types.map(t => t.toLowerCase()), fastTypes: [...new Set(fastTypes.map(t => t.toLowerCase()))] });
  }
  return pool;
}

// How many of the pool carry one of `fastTypes` on a fast move (`total`), and
// how many of those each of `types` hits super-effectively (`weakTo`).
export function candidateCounts(pool, fastTypes, types, typeIdx) {
  const wanted = new Set(fastTypes);
  const candidates = pool.filter(a => a.fastTypes.some(t => wanted.has(t)));
  const weakTo = {};
  for (const t of types) weakTo[t] = candidates.filter(a => effVsPokemon(t, a.types, typeIdx) > 1).length;
  return { total: candidates.length, weakTo };
}

// ── Typed grunt boxes ──────────────────────────────────────────────────────

const lower = (pokemons) => (pokemons || []).map(p => ({ name: p.name, types: (p.types || []).map(t => t.toLowerCase()) }));

// Types carried by at least `min` lineup entries (counted per entry, so
// Froslass offered in slots 2 and 3 makes Ghost recur on the Ice grunt).
export function recurringTypesOf(pokemons, min = 2) {
  const counts = new Map();
  for (const p of lower(pokemons)) for (const t of new Set(p.types)) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].filter(([, n]) => n >= min).map(([t]) => t).sort();
}

// Both boxes of a typed grunt from its phases ([{ slot, pokemons }], slot 1
// first) and its tanks (tanksOf). See the header for why each rule is what
// it is.
//   main:   { versions: [{ fastTypes, leads }], uncoveredLeads,
//             candidates: { total, weakTo }, killerTypes, guardTypes }
//   backup: { targets, handedOver, moveTypes, resistorTypes, guardTypes }
// `countCandidates(fastTypes, types)` returns candidateCounts() for Box 1's
// fast types (every version's) against the slot 2/3 types, or null when the
// game master is unavailable; a type it has no count for is never a killer,
// so Box 1 then falls back to the full check.
// A backup with no move types (nothing is unresisted by slots 2 and 3) has an
// empty `moveTypes`; the app then shows no backup box.
export function typedGruntBoxes(phases, tanks, allTypeNames, typeIdx, countCandidates = () => null) {
  const [slot1 = [], slot2 = [], slot3 = []] = (phases || []).map(p => lower(p.pokemons));
  const late = [...slot2, ...slot3];
  const lateSpecies = distinctSpecies(late);
  const lateTypes = [...new Set(lateSpecies.flatMap(s => s.types))].sort();

  const leads = counterPlan(slot1, allTypeNames, typeIdx);
  const fastTypes = [...new Set(leads.windows.flatMap(w => w.types))].sort();
  const candidates = countCandidates(fastTypes, lateTypes) || { total: 0, weakTo: {} };
  const killerTypes = lateTypes.filter(t =>
    candidates.total > 0 && candidates.weakTo[t] != null && candidates.weakTo[t] * KILLER_ONE_IN >= candidates.total);
  const main = {
    versions: leads.windows.map(w => ({ fastTypes: w.types, leads: w.covers })),
    uncoveredLeads: leads.uncovered,
    candidates,
    killerTypes,
    guardTypes: lateTypes.filter(t => !killerTypes.includes(t)),
  };

  const handedOver = lateSpecies.filter(s => s.types.some(t => killerTypes.includes(t)));
  const resisted = (t) => lateSpecies.some(s => effVsPokemon(t, s.types, typeIdx) < 1);
  let moveTypes;
  if (handedOver.length > 0) {
    const hits = (t) => handedOver.filter(s => effVsPokemon(t, s.types, typeIdx) > 1).length;
    const usable = allTypeNames.filter(t => !resisted(t) && hits(t) > 0);
    const most = Math.max(0, ...usable.map(hits));
    moveTypes = usable.filter(t => hits(t) === most).sort();
  } else {
    const seCount = (t) => late.filter(p => effVsPokemon(t, p.types, typeIdx) > 1).length;
    const lateNames = new Set(lateSpecies.map(s => s.name));
    const tankTypes = (tanks || []).filter(k => lateNames.has(k.name)).flatMap(k => k.seMoveTypes || []);
    moveTypes = [...new Set([
      ...allTypeNames.filter(t => seCount(t) > 0 && seCount(t) * 2 >= late.length),
      ...tankTypes,
    ])].filter(t => !resisted(t)).sort();
  }
  const guardTypes = [...new Set([...recurringTypesOf(late), ...handedOver.flatMap(s => s.types)])].sort();
  const backup = {
    targets: lateSpecies.map(s => s.name),
    handedOver: handedOver.map(s => s.name),
    moveTypes,
    resistorTypes: guardTypes.length ? resistorsFor(guardTypes, allTypeNames, typeIdx) : [],
    guardTypes,
  };
  return { main, backup };
}
