// Offline checks for scripts/lib/rocket-cover.mjs — the Rocket counter plan
// (set cover of a grunt lineup by move type) and the tank flags.
// Run with: npx vite-node scripts/check-rocket-cover.mjs
//
// A toy type chart keeps every case hand-checkable and independent of the
// lily-dex-api fetch. The real snapshot's invariants live in
// check-data-filters.mjs (D10).
//
// Covers:
//   C1 — one window when a single move type covers the lineup
//   C2 — two windows when no type does (the Seel shape: the headline type's
//        counters are resisted by an off-type slot-1 Pokémon)
//   C3 — more than two needed: the best two by slot exposure, the rest listed
//   C4 — windows and `uncovered` partition the distinct lineup
//   C5 — tanks: top-fraction cutoff, regional forms, best-multiplier move types

import { indexTypes } from "./lib/rocket-derive.mjs";
import {
  counterPlan,
  distinctSpecies,
  bestTypesAgainst,
  bulkTable,
  bulkOf,
  enNameIndex,
  tanksOf,
} from "./lib/rocket-cover.mjs";
import { createChecker } from "./lib/check.mjs";

const { check, done } = createChecker();

// Defender types and what they take double / half damage from. Attack types
// are x, y, z and w; defender types are the lowercase letters a-e.
const CHART = indexTypes([
  { type: "A", doubleDamageFrom: ["X"], halfDamageFrom: [], noDamageFrom: [] },
  { type: "B", doubleDamageFrom: ["Y"], halfDamageFrom: ["X"], noDamageFrom: [] },
  { type: "C", doubleDamageFrom: ["X", "Y"], halfDamageFrom: [], noDamageFrom: [] },
  { type: "D", doubleDamageFrom: ["Z"], halfDamageFrom: [], noDamageFrom: ["X"] },
  { type: "E", doubleDamageFrom: ["X", "W"], halfDamageFrom: [], noDamageFrom: [] },
  { type: "X", doubleDamageFrom: [], halfDamageFrom: [], noDamageFrom: [] },
  { type: "Y", doubleDamageFrom: [], halfDamageFrom: [], noDamageFrom: [] },
  { type: "Z", doubleDamageFrom: [], halfDamageFrom: [], noDamageFrom: [] },
  { type: "W", doubleDamageFrom: [], halfDamageFrom: [], noDamageFrom: [] },
]);
const TYPES = Object.keys(CHART);
const mon = (name, ...types) => ({ name, types });
const plan = (lineup) => counterPlan(lineup, TYPES, CHART);

console.log("C1 — one window when one move type covers everyone");
{
  const p = plan([mon("Cee", "c"), mon("Ay", "a"), mon("Ee", "e")]);
  check("a single window", p.windows.length === 1, JSON.stringify(p.windows));
  check("window holds exactly the covering type x", p.windows[0]?.types.join() === "x");
  check("nothing uncovered", p.uncovered.length === 0);
}

console.log("\nC2 — two windows when no single type covers the lineup");
{
  // x is the headline counter (hits Ay and Cee) but Bee resists it, the way
  // Water halves Fire and Steel on the Ice grunt's Seel.
  const p = plan([mon("Ay", "a"), mon("Cee", "c"), mon("Bee", "b")]);
  check("two windows", p.windows.length === 2, JSON.stringify(p.windows));
  const forBee = p.windows.find((w) => w.covers.includes("Bee"));
  check("Bee gets a window whose types all hit it SE", forBee?.types.join() === "y");
  check("the larger window comes first", p.windows[0].covers.length >= p.windows[1].covers.length);
  check("nothing uncovered", p.uncovered.length === 0);
}

console.log("\nC3 — more than two windows needed: best two by slot exposure");
{
  // Ay needs x, Dee needs z, Bee needs y. Dee is offered in all three slots,
  // so it must be covered; one of the single-slot species is left over.
  const lineup = [mon("Ay", "a"), mon("Dee", "d"), mon("Bee", "b"), mon("Dee", "d"), mon("Dee", "d")];
  const p = plan(lineup);
  check("still at most two windows", p.windows.length === 2);
  check("the three-slot species is covered", p.windows.some((w) => w.covers.includes("Dee")));
  check("exactly one species uncovered", p.uncovered.length === 1, p.uncovered.join());
  check("a species offered in three slots is counted once", distinctSpecies(lineup).length === 3);
  check("distinctSpecies records the exposure", distinctSpecies(lineup).find((s) => s.name === "Dee").slots === 3);
}

console.log("\nC4 — windows and uncovered partition the distinct lineup");
{
  const lineups = [
    [mon("Ay", "a"), mon("Bee", "b"), mon("Cee", "c"), mon("Dee", "d"), mon("Ee", "e")],
    [mon("Ay", "a"), mon("Ay", "a")],
    [mon("Dee", "d"), mon("Bee", "b")],
  ];
  for (const lineup of lineups) {
    const p = plan(lineup);
    const names = distinctSpecies(lineup).map((s) => s.name).sort().join();
    const all = [...p.windows.flatMap((w) => w.covers), ...p.uncovered];
    check(`${names}: every species placed exactly once`, all.slice().sort().join() === names && new Set(all).size === all.length, all.join());
    const sound = p.windows.every((w) => w.types.length > 0 && w.covers.length > 0);
    check(`${names}: every window has types and covers someone`, sound);
  }
  check("an empty lineup has no windows", plan([]).windows.length === 0);
}

console.log("\nC5 — tanks");
{
  check("equal multipliers are all kept: x and w are both 2× on e",
    bestTypesAgainst(["e"], TYPES, CHART).join() === "w,x");
  check("dual type: x is 4× on a/c, y only 2×", bestTypesAgainst(["a", "c"], TYPES, CHART).join() === "x");
  check("nothing SE → no best types", bestTypesAgainst(["x"], TYPES, CHART).length === 0);

  // Eight species, bulk 10..80. Top eighth = the single bulkiest one.
  const forms = [];
  for (let dex = 1; dex <= 8; dex++) forms.push({ dex, suffix: null, stats: { baseDefense: dex, baseStamina: 10 } });
  forms.push({ dex: 3, suffix: "ALOLA", stats: { baseDefense: 100, baseStamina: 10 } });
  forms.push({ dex: 9, suffix: "NO_STATS", stats: {} });
  const table = bulkTable(forms, 1 / 8);
  check("population is one entry per dex with stats", table.populationSize === 8);
  check("cutoff is the bulkiest eighth", table.cutoff === 80);
  const names = enNameIndex({ 3: { en: "Three" }, 8: { en: "Eight" }, meta: { en: "Ignored" } });
  check("base name resolves to the base form", bulkOf("Three", table, names) === 30);
  check("regional prefix resolves to the form", bulkOf("Alolan Three", table, names) === 1000);
  check("unknown name is null", bulkOf("Nobody", table, names) === null);

  const bulk = { Eight: 80, Three: 30, "Alolan Three": 1000, Ghosty: null };
  const tanks = tanksOf(
    [mon("Eight", "e"), mon("Three", "a"), mon("Alolan Three", "a", "c"), mon("Ghosty", "a")],
    bulk, 80, TYPES, CHART,
  );
  check("tanks are the species at or above the cutoff", tanks.map((t) => t.name).join() === "Eight,Alolan Three");
  check("each tank carries its best move types", tanks.find((t) => t.name === "Alolan Three")?.seMoveTypes.join() === "x");
  check("no cutoff → no tanks", tanksOf([mon("Eight", "e")], bulk, null, TYPES, CHART).length === 0);
}

done("All rocket-cover checks passed.", (n) => `${n} rocket-cover check(s) failed.`);
