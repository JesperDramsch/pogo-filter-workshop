// Offline checks for scripts/lib/rocket-derive.mjs — the counter data the
// Rocket cards are built from.
// Run with: npx vite-node scripts/check-rocket-counters.mjs
//
// check-data-filters.mjs only sees whatever lineup ScrapedDuck serves today.
// Generic grunts rotate between a few fixed lineups, so the ones a sync may
// bring back are pinned here: the Snorlax-heavy female lineup, the decoy, and
// the male starter trios (Kanto, Johto with Meganium, Hoenn with Swampert).
// Type chart: lily-dex-api's types.json, snapshotted in scripts/__fixtures__.
//
// Covers:
//   C1 — every counter group's move types are SE on one of its Pokémon and
//        resisted by none; every phase is covered by a group
//   C2 — a typing that recurs across phases gets its own group (Snorlax)
//   C3 — identical groups merge, subset phases included (the decoy: 2 groups)
//   C4 — themed trios drop move types a secondary type walls (Swampert's
//        ground halves rock) and keep the Kanto trio's moves as they were
//   C5 — themed trios get one filter per line (grass, fire, water), each
//        covering its line in every phase with moves unwalled within the line

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexTypes, deriveTrainer, effVsPokemon } from "./lib/rocket-derive.mjs";
import { createChecker } from "./lib/check.mjs";

const { check, done } = createChecker();
const __dirname = dirname(fileURLToPath(import.meta.url));
const typeIdx = indexTypes(JSON.parse(readFileSync(resolve(__dirname, "__fixtures__/lily-dex-types.json"), "utf8")));
const allTypeNames = Object.keys(typeIdx);

const mon = (name, ...types) => ({ name, types });
const lineup = (name, first, second, third) => ({ name, firstPokemon: first, secondPokemon: second, thirdPokemon: third });
const derive = (entry) => deriveTrainer(entry, allTypeNames, typeIdx);

const FEMALE = lineup("Female Grunt",
  [mon("Snorlax", "normal"), mon("Lapras", "water", "ice")],
  [mon("Poliwrath", "water", "fighting"), mon("Gardevoir", "psychic", "fairy"), mon("Snorlax", "normal")],
  [mon("Gyarados", "water", "flying"), mon("Dragonite", "dragon", "flying"), mon("Snorlax", "normal")]);
const DECOY = lineup("Decoy Female Grunt",
  [mon("Bellsprout", "grass", "poison")],
  [mon("Raticate", "normal"), mon("Weepinbell", "grass", "poison")],
  [mon("Raticate", "normal"), mon("Snorlax", "normal")]);
const KANTO = lineup("Male Grunt",
  [mon("Bulbasaur", "grass", "poison"), mon("Charmander", "fire"), mon("Squirtle", "water")],
  [mon("Ivysaur", "grass", "poison"), mon("Charmeleon", "fire"), mon("Wartortle", "water")],
  [mon("Venusaur", "grass", "poison"), mon("Charizard", "fire", "flying"), mon("Blastoise", "water")]);
const JOHTO = lineup("Male Grunt",
  [mon("Chikorita", "grass"), mon("Cyndaquil", "fire"), mon("Totodile", "water")],
  [mon("Bayleef", "grass"), mon("Quilava", "fire"), mon("Croconaw", "water")],
  [mon("Meganium", "grass"), mon("Typhlosion", "fire"), mon("Feraligatr", "water")]);
const HOENN = lineup("Male Grunt",
  [mon("Treecko", "grass"), mon("Torchic", "fire"), mon("Mudkip", "water")],
  [mon("Grovyle", "grass"), mon("Combusken", "fire", "fighting"), mon("Marshtomp", "water", "ground")],
  [mon("Sceptile", "grass"), mon("Blaziken", "fire", "fighting"), mon("Swampert", "water", "ground")]);

const unwalled = (moveType, pokemons) =>
  pokemons.some((p) => effVsPokemon(moveType, p.types, typeIdx) > 1) &&
  pokemons.every((p) => effVsPokemon(moveType, p.types, typeIdx) >= 1);
const names = (c) => c.pokemons.map((p) => p.name).sort().join("/");

console.log("C1 — unthemed lineups: unwalled moves, every phase covered");
for (const entry of [FEMALE, DECOY]) {
  const t = derive(entry);
  check(`${entry.name}: unthemed, carries counter groups`, !t.themeTypes && (t.counters || []).length > 0);
  for (const c of t.counters || []) {
    const walled = c.seMoveTypes.filter((m) => !unwalled(m, c.pokemons));
    check(`${entry.name} [${names(c)}]: ${c.seMoveTypes.join(", ")} hit SE and are never resisted`,
      c.seMoveTypes.length > 0 && walled.length === 0, walled.length ? `walled: ${walled.join(", ")}` : "");
    check(`${entry.name} [${names(c)}]: has resistor types`, c.resistorTypes.length > 0);
  }
  const covered = new Set(t.counters.filter((c) => !c.recurring).flatMap((c) => c.phases));
  check(`${entry.name}: phases 1–3 each covered by a phase group`, [1, 2, 3].every((s) => covered.has(s)));
}

console.log("\nC2 — a recurring typing folds into a phase sharing a move type");
{
  const t = derive(FEMALE);
  check("Female: three filters, one per team slot", t.counters.length === 3,
    t.counters.map((c) => c.phases.join("+")).join(" | "));
  check("Female: no recurring-only filter left", t.counters.every((c) => !c.recurring));
  const first = t.counters.find((c) => c.phases.join(",") === "1");
  check("Female phase 1: narrowed to fighting (SE on Snorlax and Lapras)", first?.seMoveTypes.join(",") === "fighting",
    first?.seMoveTypes.join(", "));
  check("Female phase 1: also covers Snorlax in phases 2 + 3",
    first?.alsoPhases?.join(",") === "2,3" && first?.alsoPokemons?.map((p) => p.name).join(",") === "Snorlax");
  const withFlyers = t.counters.find((c) => c.phases.includes(3));
  check("Female phase 3: fighting dropped (Gyarados and Dragonite resist it)",
    !!withFlyers && !withFlyers.seMoveTypes.includes("fighting"), withFlyers?.seMoveTypes.join(", "));
  const withGardevoir = t.counters.find((c) => c.phases.includes(2));
  check("Female phase 2: fighting dropped (Gardevoir resists it)",
    !!withGardevoir && !withGardevoir.seMoveTypes.includes("fighting"), withGardevoir?.seMoveTypes.join(", "));
}

console.log("\nC3 — identical groups merge");
{
  const t = derive(DECOY);
  const summary = t.counters.map((c) => `${c.phases.join("+")}${c.alsoPhases ? ` also ${c.alsoPhases.join("+")}` : ""}`);
  check("Decoy: two groups, phase 1+2 and phase 3 (also 2)",
    summary.join(" | ") === "1+2 | 3 also 2", summary.join(" | "));
  check("Decoy: no group is left recurring-only", t.counters.every((c) => !c.recurring));
  check("Decoy phase 3: also covers Raticate in phase 2",
    t.counters[1]?.alsoPokemons?.map((p) => p.name).join(",") === "Raticate");
  check("Decoy phase 3 carries fighting", !!t.counters[1]?.seMoveTypes.includes("fighting"));
}

console.log("\nC4 — themed trios");
{
  const kanto = derive(KANTO);
  check("Kanto: themed grass/fire/water", kanto.themeTypes?.slice().sort().join(",") === "fire,grass,water");
  check("Kanto: moves unchanged (flying, psychic, rock)", kanto.seMoveTypes?.join(",") === "flying,psychic,rock",
    kanto.seMoveTypes?.join(", "));
  const johto = derive(JOHTO);
  check("Johto (Meganium): themed grass/fire/water", johto.themeTypes?.slice().sort().join(",") === "fire,grass,water");
  check("Johto: electric stays out (the grass line resists it)",
    johto.seMoveTypes.length > 0 && !johto.seMoveTypes.includes("electric"), johto.seMoveTypes.join(", "));
  const hoenn = derive(HOENN);
  const lineupMons = [1, 2, 3].flatMap((s) => hoenn.phases[s - 1].pokemons);
  check("Hoenn (Swampert): themed grass/fire/water", hoenn.themeTypes?.slice().sort().join(",") === "fire,grass,water");
  check("Hoenn: rock dropped (Swampert's ground halves it)", !hoenn.seMoveTypes.includes("rock"),
    hoenn.seMoveTypes.join(", "));
  const walled = hoenn.seMoveTypes.filter((m) => !lineupMons.every((p) => effVsPokemon(m, p.types, typeIdx) >= 1));
  check(`Hoenn: ${hoenn.seMoveTypes.join(", ")} resisted by nobody in the lineup`,
    hoenn.seMoveTypes.length > 0 && walled.length === 0, walled.join(", "));
}

console.log("\nC5 — one filter per starter line");
for (const [label, entry] of [["Kanto", KANTO], ["Johto", JOHTO], ["Hoenn", HOENN]]) {
  const t = derive(entry);
  const lines = (t.counters || []).map((c) => c.line).join(",");
  check(`${label}: one filter per line (${lines})`, lines === t.themeTypes.join(","));
  for (const c of t.counters || []) {
    const walled = c.seMoveTypes.filter((m) => !unwalled(m, c.pokemons));
    check(`${label} ${c.line} line [${c.pokemons.map((p) => p.name).join(" > ")}]: phases 1-3, ${c.seMoveTypes.join(", ")} never resisted`,
      c.phases.join(",") === "1,2,3" && c.pokemons.length === 3 && c.seMoveTypes.length > 0 &&
        c.resistorTypes.length > 0 && walled.length === 0, walled.join(", "));
  }
}
{
  const water = derive(HOENN).counters.find((c) => c.line === "water");
  check("Hoenn water line (Swampert): grass kept, electric dropped (ground is immune)",
    water.seMoveTypes.includes("grass") && !water.seMoveTypes.includes("electric"), water.seMoveTypes.join(", "));
  const fire = derive(KANTO).counters.find((c) => c.line === "fire");
  check("Kanto fire line: rock, water and electric (Charizard's flying half)",
    fire.seMoveTypes.join(",") === "rock,water,electric", fire.seMoveTypes.join(", "));
}

done("All Rocket counter checks passed.", (n) => `${n} Rocket counter check(s) failed.`);
