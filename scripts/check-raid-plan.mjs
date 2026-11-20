// Offline checks for the raid Mega and buddy lines (src/raid-plan.js) under
// the Battle area's counter filters and in the Mega planner's raid days, and
// the Mega filter they copy.
// Run with: npm run test:raidplan
//
//   R1 — candy and damage: a candy Mega shares a type with the boss (a Primal
//        by its boostTypes), a damage Mega's own type is in the boss's
//        seMoveTypes; a Mega that is both leads in either mode
//   R2 — wild spawns: among equals, the Mega that also boosts the wild spawns
//        running now ranks first, and topMegas keeps every tie
//   R3 — lines: bosses with the same answer fold into one line, Deoxys's
//        formes are one boss, buddy quests ride along
//   R4 — the snapshot: the generator's boss entries carry what a line needs,
//        and every line built from them keeps R1
//   R5 — the filter: Mega species in the output locale plus the Mega keyword,
//        a Primal's species OR'd into that clause
//
// Data-derived, so no fixture: properties only (see scripts/lib/fixture.mjs).

import { createChecker } from "./lib/check.mjs";
import { raidLines, raidMegas, topMegas } from "../src/raid-plan.js";
import { megaPlans } from "../src/mega-boost.js";
import SPECIES_META from "../src/data/species-meta.json";
import QUESTS from "../src/data/evolution-quests.json";
import { buildFilters, DEFAULT_HUNDOS, DEFAULT_LUCKIES } from "../src/App.jsx";
import { FIXTURE_CONFIG } from "./lib/fixture.mjs";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { pokemonNameFor } from "../src/data/species.js";

const { check, done } = createChecker();

const mega = (key, dex, types, extra = {}) => ({ key, dex, kind: "mega", types, boostTypes: types, ...extra });
const gengar = mega("94_1", 94, ["ghost", "poison"]);
const houndoom = mega("229_1", 229, ["dark", "fire"]);
const lucario = mega("448_1", 448, ["fighting", "steel"]);
const gardevoir = mega("282_1", 282, ["psychic", "fairy"]);
const groudon = { key: "383_4", dex: 383, kind: "primal", types: ["ground", "fire"], boostTypes: ["ground", "fire", "grass"] };
const megas = [gengar, houndoom, lucario, gardevoir, groudon];
const boss = (en, types, seMoveTypes, extra = {}) => ({ id: en.toUpperCase(), names: { en }, types, seMoveTypes, ...extra });
const ghostBoss = boss("Misdreavus", ["ghost"], ["dark", "ghost"]);
const darkBoss = boss("Darkrai", ["dark"], ["bug", "fairy", "fighting"]);

// ── R1 ──
console.log("R1 — candy and damage");
const g = raidMegas(ghostBoss, megas);
check("Ghost boss: Mega Gengar is both", g.both.has("94_1"));
check("Ghost boss: Mega Houndoom hits it (Dark) but gives no candy", g.damage.includes(houndoom) && !g.candy.includes(houndoom));
check("a Mega that is both leads in either mode", topMegas(g, "candy")[0] === gengar && topMegas(g, "damage")[0] === gengar);
const d = raidMegas(darkBoss, megas);
check("Dark boss: candy is the Dark-type Mega", d.candy.length === 1 && d.candy[0] === houndoom);
check("Dark boss: damage is Fighting and Fairy", d.damage.includes(lucario) && d.damage.includes(gardevoir) && !d.damage.includes(houndoom));
check("Dark boss: nothing is both", d.both.size === 0);
const grassBoss = boss("Tangela", ["grass"], ["fire", "flying", "ice", "poison", "bug"]);
const pg = raidMegas(grassBoss, megas);
check("a Primal gives candy by its boost types", pg.candy.includes(groudon));
check("a Primal deals damage by its own types", pg.damage.includes(groudon) && pg.both.has("383_4"));

// ── R2 ──
console.log("\nR2 — wild spawns break ties");
const wild = [{ dex: 1, types: ["fighting"] }, { dex: 2, types: ["fighting"] }, { dex: 3, types: ["fairy"] }];
const dw = raidMegas(darkBoss, megas, wild);
check("the damage Mega that also boosts more wild spawns ranks first", dw.damage[0] === lucario, dw.damage.map((m) => m.key).join(","));
check("wild-spawn coverage is counted by boost type", dw.wildHits.get("448_1") === 2 && dw.wildHits.get("282_1") === 1);
check("topMegas keeps only the best when nothing is both", topMegas(dw, "damage").length === 1);
const tie = raidMegas(darkBoss, megas, []);
check("topMegas keeps every tie", topMegas(tie, "damage").length === 2);

// ── R3 ──
console.log("\nR3 — lines and rows");
const sandygast = boss("Sandygast", ["ghost", "ground"], ["dark", "ghost", "grass", "ice", "water"]);
const yamask = boss("Galarian Yamask", ["ground", "ghost"], ["dark", "ghost", "grass", "ice", "water"]);
const deoxys = ["NORMAL", "ATTACK"].map((f) => boss("Deoxys", ["psychic"], ["bug", "dark", "ghost"], { form: `DEOXYS_${f}` }));
const quests = [{ dex: 674, region: null, quest: "P", action: "catch", types: ["dark"], target: 32 }, { dex: 57, region: null, quest: "A", action: "defeat", types: ["ghost", "psychic"], target: 30 }];
const lines = raidLines([sandygast, yamask, darkBoss, ...deoxys], { megaForms: megas, quests });
check("bosses with the same answer fold into one line", lines.some((l) => l.bosses.length === 2 && l.bosses.every((b) => b.types.includes("ghost"))));
check("Deoxys's formes are one boss", lines.filter((l) => l.bosses.some((b) => b.names.en === "Deoxys")).flatMap((l) => l.bosses).length === 1);
check("a Dark boss carries Pancham's catch quest (the boss is caught after the win)", lines.find((l) => l.bosses[0].names.en === "Darkrai")?.buddies[0]?.quest.dex === 674);
check("a Ghost boss carries the defeat quest", lines.find((l) => l.bosses[0].names.en === "Sandygast")?.buddies.some((b) => b.quest.dex === 57));
const plans = megaPlans({ eventRaids: [{ eventType: "raid-hour", name: "Darkrai Raid Hour", start: "2026-11-25T18:00:00", end: "2026-11-25T19:00:00", bosses: [{ ...darkBoss, names: { en: "Darkrai" } }] }] }, Date.parse("2026-11-24T12:00:00"), () => 491);
check("a dated raid row carries its bosses for the raid lines", plans[0]?.bosses?.length === 1);

// ── R4 ──
console.log("\nR4 — the committed rotation");
// The Battle panels build each line from the generator's boss entry, so read
// the rotation the same way.
const { raidFilters } = buildFilters(DEFAULT_HUNDOS, DEFAULT_LUCKIES, FIXTURE_CONFIG, [], "de");
const entries = Object.values(raidFilters).flat();
check("every raid boss entry carries names, types and seMoveTypes", entries.length > 0 && entries.every((e) => e.names?.en && e.types?.length > 0 && Array.isArray(e.seMoveTypes)));
const realLines = entries.map((e) => raidLines([e], { megaForms: SPECIES_META.megaForms, quests: QUESTS.quests })[0]).filter(Boolean);
check("one line per boss in the rotation", realLines.length === entries.length, `${realLines.length}/${entries.length}`);
check("the rotation gives raid lines", realLines.length > 0, `${realLines.length}`);
const share = (a, b) => (a || []).some((t) => (b || []).includes(t));
const badCandy = realLines.filter((l) => l.megas.candy.some((m) => !share(m.boostTypes || m.types, l.bosses[0].types)));
const badDamage = realLines.filter((l) => l.megas.damage.some((m) => !share(m.types, l.bosses[0].seMoveTypes)));
check("every candy Mega shares a type with its boss", badCandy.length === 0);
check("every damage Mega's type hits its boss super-effectively", badDamage.length === 0);
check("every both-Mega is in both lists", realLines.every((l) => [...l.megas.both].every((k) => l.megas.candy.some((m) => m.key === k) && l.megas.damage.some((m) => m.key === k))));

// ── R5 ──
console.log("\nR5 — the Mega filter");
for (const loc of ["de", "en"]) {
  const { megaFilterFor } = buildFilters(DEFAULT_HUNDOS, DEFAULT_LUCKIES, FIXTURE_CONFIG, [], loc);
  const kw = pogoKeywords(loc);
  check(`${loc}: species and the Mega keyword`, megaFilterFor([gengar, houndoom]) === `${pokemonNameFor("94", loc)},${pokemonNameFor("229", loc)}&${kw.flag.mega_evolve}`, megaFilterFor([gengar, houndoom]));
  check(`${loc}: a Primal's species joins the Mega clause`, megaFilterFor([groudon]) === `${pokemonNameFor("383", loc)}&${kw.flag.mega_evolve},${pokemonNameFor("383", loc)}`);
  check(`${loc}: no Mega is no filter`, megaFilterFor([]) === "");
}

done("All raid-plan checks passed.", (n) => `${n} raid-plan check(s) failed.`);
