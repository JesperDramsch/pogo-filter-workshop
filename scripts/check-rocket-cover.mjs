// Offline checks for scripts/lib/rocket-cover.mjs: the move-type cover, the
// tank flags and the typed-grunt boxes (main counter and backup).
// Run with: npx vite-node scripts/check-rocket-cover.mjs
//
// A toy type chart keeps C1–C6 hand-checkable; C7 pins real lineups against
// the lily-dex-api chart snapshotted in scripts/__fixtures__. The live
// snapshot's invariants live in check-data-filters.mjs (D10).
//
// Covers:
//   C1 — one window when a single move type covers the lineup
//   C2 — two windows when no type does (the Seel shape: the headline type's
//        counters are resisted by an off-type slot-1 Pokémon)
//   C3 — more than two needed: the best two by slot exposure, the rest listed
//   C4 — windows and `uncovered` partition the distinct lineup
//   C5 — tanks: top-fraction cutoff, regional forms, best-multiplier move types
//   C6 — typed-grunt boxes on the toy chart: the candidate pool, recurring
//        types, the killer rule and its handover, the backup's two move-type
//        rules, a tank's best type joining only when unresisted
//   C7 — typed-grunt boxes for real lineups: Water ♀ (the Swampert handover),
//        Ice ♀ (the Seel case, no handover), Normal ♂ (split main counter),
//        Psycho (Malamar handed over)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexTypes } from "./lib/rocket-derive.mjs";
import {
  counterPlan,
  recurringTypesOf,
  attackerPool,
  candidateCounts,
  typedGruntBoxes,
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

// Phases in the shape the fetcher stores: [{ slot, pokemons }], slot 1 first.
const phases = (...slots) => slots.map((pokemons, i) => ({ slot: i + 1, pokemons }));

console.log("\nC6 — typed-grunt boxes on the toy chart");
{
  check("recurring types: carried by at least two entries",
    recurringTypesOf([mon("P", "a"), mon("Q", "a", "b"), mon("R", "c")]).join() === "a");
  check("recurring types: one species offered twice counts twice",
    recurringTypesOf([mon("P", "c"), mon("P", "c")]).join() === "c");

  // The pool: base and regional forms only, each once; a form without fast
  // moves cannot be a candidate.
  const pool = attackerPool([
    { dex: 1, suffix: null, types: ["e"], fastTypes: ["x"] },
    { dex: 1, suffix: "NORMAL", types: ["e"], fastTypes: ["x"] },
    { dex: 2, suffix: "NORMAL", types: ["e"], fastTypes: ["x", "x"] },
    { dex: 2, suffix: "ALOLA", types: ["b"], fastTypes: ["x"] },
    { dex: 3, suffix: "COSTUME_PARTY", types: ["a"], fastTypes: ["x"] },
    { dex: 4, suffix: null, types: ["d"], fastTypes: ["x"] },
    { dex: 5, suffix: null, types: ["a"], fastTypes: ["y"] },
    { dex: 6, suffix: null, types: ["c"], fastTypes: [] },
  ]);
  check("pool: base and regional forms once each, costumes and moveless forms out", pool.length === 5,
    JSON.stringify(pool));
  const counts = candidateCounts(pool, ["x"], ["x", "y"], CHART);
  check("candidates: forms with a fast move of Box 1's types", counts.total === 4);
  check("candidates: how many each slot 2/3 type hits super-effectively",
    counts.weakTo.x === 2 && counts.weakTo.y === 1, JSON.stringify(counts.weakTo));

  // Slot 1 is type a (x hits it). Slots 2/3: XA2 attacks with x, which hits
  // half the candidates (a killer); Y3's y hits a quarter (not one).
  const lineup = phases([mon("A1", "a")], [mon("XA2", "x", "a")], [mon("Y3", "y"), mon("C3", "c")]);
  const counter = (fastTypes, types) => candidateCounts(pool, fastTypes, types, CHART);
  const { main, backup } = typedGruntBoxes(lineup, [], TYPES, CHART, counter);
  check("main counter: one version with the fast type that hits every lead",
    main.versions.length === 1 && main.versions[0].fastTypes.join() === "x");
  check("a type that knocks out a third of the candidates or more is a killer", main.killerTypes.join() === "x");
  check("main counter guards against every slot 2/3 type except killers", main.guardTypes.join() === "a,c,y");
  check("a Pokémon carrying a killer type is handed over to the backup", backup.handedOver.join() === "XA2");
  check("the backup still faces every slot 2/3 option", backup.targets.join() === "XA2,Y3,C3");
  check("handover: backup moves hit the handed-over Pokémon super-effectively", backup.moveTypes.join() === "x");
  check("backup guards against recurring types and the handed-over Pokémon's types",
    backup.guardTypes.join() === "a,x");

  // A resisted type never makes the handover's move types: B3 halves x.
  const walledHandover = typedGruntBoxes(
    phases([mon("A1", "a")], [mon("XA2", "x", "a")], [mon("B3", "b")]), [], TYPES, CHART, counter);
  check("handover: a type resisted in slots 2/3 is out, even if it is the only hit",
    walledHandover.backup.handedOver.join() === "XA2" && walledHandover.backup.moveTypes.length === 0);

  // Without counts (game master down, no previous counts) nothing is a
  // killer: the main counter falls back to the full check.
  const offline = typedGruntBoxes(lineup, [], TYPES, CHART);
  check("no candidate counts: no killers, full check, no handover",
    offline.main.killerTypes.length === 0 && offline.main.guardTypes.join() === "a,c,x,y" &&
    offline.backup.handedOver.length === 0);
  const partial = typedGruntBoxes(lineup, [], TYPES, CHART, () => ({ total: 4, weakTo: { y: 1 } }));
  check("a type without a count is never a killer", partial.main.killerTypes.length === 0);

  // General backup (no handover). Slots 2/3 are a, c, b and a: y is SE on c
  // and b (half of them), x on a and c but halved by b, so the backup keeps y
  // and drops x. Only a recurs.
  const general = typedGruntBoxes(
    phases([mon("A1", "a")], [mon("A2", "a"), mon("C2", "c")], [mon("B3", "b"), mon("A3", "a")]),
    [], TYPES, CHART,
  );
  check("general backup drops a type resisted by any slot 2/3 option", !general.backup.moveTypes.includes("x"));
  check("general backup keeps a type SE on half of slots 2/3 and resisted by none",
    general.backup.moveTypes.join() === "y");
  check("general backup guards against recurring types only", general.backup.guardTypes.join() === "a");

  // A tank in slot 3 whose best type (w, on e) nobody else resists joins the
  // general backup; the same tank next to a d (immune to x) cannot pull x in.
  const tankE = { name: "E3", types: ["e"], seMoveTypes: bestTypesAgainst(["e"], TYPES, CHART) };
  const withTank = typedGruntBoxes(phases([mon("A1", "a")], [mon("A2", "a")], [mon("E3", "e")]), [tankE], TYPES, CHART);
  check("a tank's unresisted best type joins the backup", withTank.backup.moveTypes.includes("w"));
  const walled = typedGruntBoxes(phases([mon("A1", "a")], [mon("D2", "d")], [mon("E3", "e")]), [tankE], TYPES, CHART);
  check("a tank's best type stays out when slots 2/3 resist it", !walled.backup.moveTypes.includes("x"));
}

console.log("\nC7 — typed-grunt boxes for real lineups (lily-dex chart snapshot)");
{
  const here = dirname(fileURLToPath(import.meta.url));
  const LILY = indexTypes(JSON.parse(readFileSync(resolve(here, "__fixtures__/lily-dex-types.json"), "utf8")));
  const ALL = Object.keys(LILY);
  const tank = (name, ...types) => ({ name, types, seMoveTypes: bestTypesAgainst(types, ALL, LILY) });
  // Candidate counts in the shape candidateCounts() returns. The real ones
  // come from the game master (D10 checks the snapshot's); these pin the
  // rules: only the named type reaches a third.
  const counts = (killer) => (fastTypes, types) =>
    ({ total: 100, weakTo: Object.fromEntries(types.map((t) => [t, t === killer ? 60 : 10])) });
  const boxes = (p, tanks = [], killer = null) => typedGruntBoxes(p, tanks, ALL, LILY, counts(killer));

  // Every Electric attacker is weak to Swampert's Ground, so Ground is a
  // killer: the main counter keeps the rest of the check and Swampert goes to
  // the backup, whose Grass hits it 4×.
  const waterLineup = phases(
    [mon("Mudkip", "water"), mon("Tentacool", "water", "poison"), mon("Krabby", "water")],
    [mon("Dewpider", "water", "bug"), mon("Swampert", "water", "ground"), mon("Sharpedo", "water", "dark")],
    [mon("Walrein", "ice", "water"), mon("Greninja", "water", "dark"), mon("Tentacruel", "water", "poison")],
  );
  const waterF = boxes(waterLineup, [tank("Walrein", "ice", "water")], "ground");
  check("Water ♀: main counter is Electric, guarded against everything but Ground",
    waterF.main.versions.map((v) => v.fastTypes.join("/")).join("|") === "electric" &&
    waterF.main.guardTypes.join() === "bug,dark,ice,poison,water", waterF.main.guardTypes.join());
  check("Water ♀: Swampert is handed over and the backup is Grass",
    waterF.backup.handedOver.join() === "Swampert" && waterF.backup.moveTypes.join() === "grass");
  check("Water ♀: backup guards against Water, Dark (recurring) and Ground (Swampert)",
    waterF.backup.guardTypes.join() === "dark,ground,water", waterF.backup.guardTypes.join());

  // Seel is pure Water in slot 1: only Electric hits all three leads. Nothing
  // is a killer, so the main counter keeps the full check, which is the
  // filter that tested well in a real storage.
  const iceF = boxes(phases(
    [mon("Seel", "water"), mon("Delibird", "ice", "flying"), mon("Spheal", "ice", "water")],
    [mon("Sealeo", "ice", "water"), mon("Froslass", "ice", "ghost"), mon("Alolan Ninetales", "ice", "fairy")],
    [mon("Aurorus", "rock", "ice"), mon("Froslass", "ice", "ghost"), mon("Glalie", "ice")],
  ), [tank("Aurorus", "rock", "ice")]);
  check("Ice ♀: main counter is Electric (Seel, Delibird, Spheal)",
    iceF.main.versions.length === 1 && iceF.main.versions[0].fastTypes.join() === "electric");
  check("Ice ♀: no killer, so the main counter guards against every slot 2/3 type",
    iceF.main.killerTypes.length === 0 && iceF.main.guardTypes.join() === "fairy,ghost,ice,rock,water");
  check("Ice ♀: backup is Fire/Rock/Steel; Aurorus' Fighting stays out (Froslass is immune)",
    iceF.backup.handedOver.length === 0 && iceF.backup.moveTypes.join() === "fire,rock,steel");
  check("Ice ♀: backup guards against Ice and Ghost (Froslass in two slots)",
    iceF.backup.guardTypes.join() === "ghost,ice", iceF.backup.guardTypes.join());
  check("Ice ♀: backup resistors are the types that resist Ice or Ghost and fear neither",
    iceF.backup.resistorTypes.join() === "normal,steel,fire,water,ice,dark", iceF.backup.resistorTypes.join());

  // No single fast type hits Teddiursa, Hoothoot and Porygon: two versions.
  // Stufful's Fighting is the killer (the Ice and Rock attackers fear it).
  const normalM = boxes(phases(
    [mon("Teddiursa", "normal"), mon("Hoothoot", "normal", "flying"), mon("Porygon", "normal")],
    [mon("Loudred", "normal"), mon("Stufful", "normal", "fighting"), mon("Starly", "normal", "flying")],
    [mon("Ursaring", "normal"), mon("Swellow", "normal", "flying"), mon("Kangaskhan", "normal")],
  ), [], "fighting");
  const versions = normalM.main.versions.map((v) => `${v.fastTypes.join("/")}:${v.leads.join("+")}`);
  check("Normal ♂: main counter splits into Fighting and Electric/Ice/Rock versions",
    versions.join("|") === "fighting:Teddiursa+Porygon|electric/ice/rock:Hoothoot", versions.join("|"));
  check("Normal ♂: every lead is covered", normalM.main.uncoveredLeads.length === 0);
  check("Normal ♂: Stufful is handed over; the backup hits it with Fairy/Fighting/Flying/Psychic",
    normalM.backup.handedOver.join() === "Stufful" &&
    normalM.backup.moveTypes.join() === "fairy,fighting,flying,psychic", normalM.backup.moveTypes.join());

  // Wobbuffet is a tank in slots 1 and 2, and Ghost alone covers every lead.
  // Malamar's Dark is the killer; Bug hits it 4× and Fairy 2×.
  const psychicLineup = phases(
    [mon("Wobbuffet", "psychic"), mon("Ralts", "psychic", "fairy"), mon("Drowzee", "psychic")],
    [mon("Drowzee", "psychic"), mon("Duosion", "psychic"), mon("Wobbuffet", "psychic")],
    [mon("Gallade", "psychic", "fighting"), mon("Malamar", "dark", "psychic"), mon("Reuniclus", "psychic")],
  );
  const psychicM = boxes(psychicLineup, [tank("Wobbuffet", "psychic")], "dark");
  check("Psycho: main counter is Ghost", psychicM.main.versions.map((v) => v.fastTypes.join()).join("|") === "ghost");
  check("Psycho: Malamar is handed over and the backup is Bug/Fairy",
    psychicM.backup.handedOver.join() === "Malamar" && psychicM.backup.moveTypes.join() === "bug,fairy");
  // Without a handover the tank steers the general backup, as before.
  const psychicGeneral = typedGruntBoxes(psychicLineup, [tank("Wobbuffet", "psychic")], ALL, LILY);
  check("Psycho without a handover: the general backup is Bug/Dark/Ghost (Wobbuffet's best types)",
    psychicGeneral.backup.moveTypes.join() === "bug,dark,ghost", psychicGeneral.backup.moveTypes.join());
}

done("All rocket-cover checks passed.", (n) => `${n} rocket-cover check(s) failed.`);
