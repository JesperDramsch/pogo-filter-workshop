// Offline checks for the quest-evolution card: the game-master reader in
// scripts/lib/game-master.mjs, the committed src/data/evolution-quests.json,
// the matcher in src/buddy-quests.js and the filter the card copies.
// Run with: npm run test:buddyquests
//
//   Q1 — readEvolutionQuest: each quest type the dump carries reads into its
//        action, with the types, the Max Battle flag and the text key
//   Q2 — evolutionQuestsFromGameMaster: one row per species, region and quest
//        (bare + _NORMAL templates and Floette's colours collapse), a regional
//        form keeps its region, event variants count only when they ask for
//        the same thing
//   Q3 — the snapshot: the quests the card is for are there, every quest has a
//        known action and real type slugs, and its in-game text carries {0}
//        wherever the target is above 1
//   Q4 — the matcher: a Community Day of a type outranks a few spawns of
//        another; outside the horizon or a far venue counts for nothing; Max
//        Battles only for a quest that allows them; a hearts bonus ranks the
//        heart quests; an untyped raid quest is an any-time quest; a boss listed
//        once per forme is one row
//   Q5 — the filter: species in the output locale plus the evolve-with-quest
//        keyword, never a literal German name in another locale
//
// Data-derived, so no fixture: properties only (see scripts/lib/fixture.mjs).

import { createChecker } from "./lib/check.mjs";
import { evolutionQuestsFromGameMaster, readEvolutionQuest } from "./lib/game-master.mjs";
import { buddyQuestPlan, matchQuest, questSources } from "../src/buddy-quests.js";
import { classifyBonus } from "../src/bonus-nudges.js";
import QUESTS from "../src/data/evolution-quests.json";
import { buildFilters, DEFAULT_HUNDOS, DEFAULT_LUCKIES } from "../src/App.jsx";
import { FIXTURE_CONFIG } from "./lib/fixture.mjs";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { pokemonNameFor } from "../src/data/species.js";

const { check, done } = createChecker();
const DAY = 86400000;
const TYPES = new Set(Object.keys(pogoKeywords("en").type));

// ── Q1 ──
console.log("Q1 — quest templates read into actions");
const catchDark = readEvolutionQuest({
  questType: "QUEST_CATCH_POKEMON",
  goals: [{ condition: [{ type: "WITH_POKEMON_TYPE", withPokemonType: { pokemonType: ["POKEMON_TYPE_DARK"] } }], target: 32 }],
  display: { description: "quest_catch_type_dark_plural" },
});
check("catch Dark: action, types, target, text key", catchDark.action === "catch" && catchDark.types.join() === "dark" && catchDark.target === 32 && catchDark.textKey === "quest_catch_type_dark_plural");
const kubfu = readEvolutionQuest({
  questType: "QUEST_COMPLETE_BATTLE",
  goals: [{ condition: [
    { type: "WITH_WIN_BATTLE_STATUS" },
    { type: "WITH_COMBAT_TYPE", withCombatType: { combatType: ["COMBAT_TYPE_RAID", "COMBAT_TYPE_DMAX", "COMBAT_TYPE_GMAX"] } },
    { type: "WITH_POKEMON_TYPE", withPokemonType: { pokemonType: ["POKEMON_TYPE_WATER"] } },
  ], target: 30 }],
});
check("Kubfu's raid quest is a raid win that counts Max Battles", kubfu.action === "raid_win" && kubfu.max === true && kubfu.types.join() === "water");
const bisharp = readEvolutionQuest({
  questType: "QUEST_COMPLETE_BATTLE",
  goals: [{ condition: [{ type: "WITH_COMBAT_TYPE", withCombatType: { combatType: ["COMBAT_TYPE_RAID"] } }, { type: "WITH_POKEMON_TYPE", withPokemonType: { pokemonType: ["POKEMON_TYPE_STEEL", "POKEMON_TYPE_DARK"] } }], target: 15 }],
});
check("Bisharp's raid quest does not count Max Battles, types sorted", bisharp.max === false && bisharp.types.join() === "dark,steel");
const defeat = readEvolutionQuest({
  questType: "QUEST_FIGHT_POKEMON",
  goals: [{ condition: [{ type: "WITH_OPPONENT_POKEMON_BATTLE_STATUS", withOpponentPokemonBattleStatus: { requireDefeat: true, opponentPokemonType: ["POKEMON_TYPE_GHOST"] } }], target: 30 }],
});
check("defeat quest reads the opponent's type", defeat.action === "defeat" && defeat.types.join() === "ghost");
check("Excellent throws keep the throw type", readEvolutionQuest({ questType: "QUEST_LAND_THROW", goals: [{ condition: [{ withThrowType: { throwType: "ACTIVITY_CATCH_EXCELLENT_THROW" } }], target: 10 }] }).throwType === "excellent");
for (const [questType, action] of [["QUEST_BUDDY_EVOLUTION_WALK", "walk"], ["QUEST_BUDDY_EARN_AFFECTION_POINTS", "hearts"], ["QUEST_BUDDY_FEED", "treats"], ["QUEST_USE_INCENSE", "incense"], ["QUEST_COMPLETE_RAID_BATTLE", "raid_win"], ["QUEST_SOMETHING_NEW", "other"]]) {
  check(`${questType} → ${action}`, readEvolutionQuest({ questType, goals: [{ target: 5 }] }).action === action);
}

// ── Q2 ──
console.log("\nQ2 — one row per species, region and quest");
const tpl = (id, settings) => ({ templateId: id, data: { templateId: id, pokemonSettings: settings } });
const questTpl = (id, questType, target) => ({ templateId: id, data: { templateId: id, evolutionQuestTemplate: { questTemplateId: id, questType, goals: [{ target }] } } });
const branch = (evolution, quest, extra = {}) => ({ evolution, candyCost: 50, questDisplay: [{ questRequirementTemplateId: quest }], ...extra });
const synthetic = [
  tpl("V0674_POKEMON_PANCHAM", { pokemonId: "PANCHAM", evolutionBranch: [branch("PANGORO", "PANCHAM_EVOLUTION_QUEST")] }),
  tpl("V0674_POKEMON_PANCHAM_NORMAL", { pokemonId: "PANCHAM", form: "PANCHAM_NORMAL", evolutionBranch: [branch("PANGORO", "PANCHAM_EVOLUTION_QUEST")] }),
  tpl("V0675_POKEMON_PANGORO", { pokemonId: "PANGORO" }),
  tpl("V0079_POKEMON_SLOWPOKE_GALARIAN", { pokemonId: "SLOWPOKE", form: "SLOWPOKE_GALARIAN", evolutionBranch: [branch("SLOWBRO", "SLOWBRO_G_EVOLUTION_QUEST")] }),
  tpl("V0079_POKEMON_SLOWPOKE", { pokemonId: "SLOWPOKE", evolutionBranch: [{ evolution: "SLOWBRO", candyCost: 50 }] }),
  tpl("V0080_POKEMON_SLOWBRO", { pokemonId: "SLOWBRO" }),
  tpl("V0670_POKEMON_FLOETTE_RED", { pokemonId: "FLOETTE", form: "FLOETTE_RED", evolutionBranch: [branch("FLORGES", "FLORGES_EVOLUTION_QUEST")] }),
  tpl("V0670_POKEMON_FLOETTE_BLUE", { pokemonId: "FLOETTE", form: "FLOETTE_BLUE", evolutionBranch: [branch("FLORGES", "FLORGES_EVOLUTION_QUEST")] }),
  tpl("V0671_POKEMON_FLORGES", { pokemonId: "FLORGES" }),
  tpl("V0133_POKEMON_EEVEE", { pokemonId: "EEVEE", evolutionBranch: [branch("UMBREON", "UMBREON_EVOLUTION_QUEST", { onlyNighttime: true })] }),
  tpl("V0197_POKEMON_UMBREON", { pokemonId: "UMBREON" }),
  questTpl("PANCHAM_EVOLUTION_QUEST", "QUEST_CATCH_POKEMON", 32),
  questTpl("PANCHAM_BUDDY_EVENT_EVOLUTION_QUEST", "QUEST_CATCH_POKEMON", 10),
  questTpl("SLOWBRO_G_EVOLUTION_QUEST", "QUEST_CATCH_POKEMON", 30),
  questTpl("FLORGES_EVOLUTION_QUEST", "QUEST_BUDDY_EARN_AFFECTION_POINTS", 20),
  questTpl("FLORGES_CD_EVOLUTION_QUEST", "QUEST_BUDDY_EARN_AFFECTION_POINTS", 7),
  questTpl("UMBREON_EVOLUTION_QUEST", "QUEST_BUDDY_EVOLUTION_WALK", 10),
  questTpl("UMBREON_CD_EVOLUTION_QUEST", "QUEST_CATCH_POKEMON", 1),
];
const rows = evolutionQuestsFromGameMaster(synthetic);
const of = (dex) => rows.filter((r) => r.dex === dex);
check("Pancham's bare and _NORMAL templates are one row", of(674).length === 1, `${of(674).length}`);
check("Pancham's buddy-event variant is listed as a lower target", of(674)[0]?.eventTargets.join() === "10");
check("only Galarian Slowpoke has a quest, and it keeps its region", of(79).length === 1 && of(79)[0].region === "galar");
check("Floette's colours are one row", of(670).length === 1);
check("a variant asking for something else is not a lower target", of(133)[0]?.eventTargets.length === 0);
check("night-only rides along", of(133)[0]?.time === "night");
check("the evolution's dex is resolved", of(674)[0]?.evolutionDex === 675);

// ── Q3 ──
console.log("\nQ3 — the snapshot");
const quests = QUESTS.quests || [];
check("at least 25 quest evolutions", quests.length >= 25, `${quests.length}`);
const find = (dex, action, type) => quests.find((q) => q.dex === dex && q.action === action && (!type || q.types.includes(type)));
check("Pancham: catch Dark", !!find(674, "catch", "dark"));
check("Kubfu: Dark and Water raid wins, Max Battles count", !!find(891, "raid_win", "dark")?.max && !!find(891, "raid_win", "water")?.max);
check("Bisharp: Dark or Steel raid wins, Max Battles do not", find(625, "raid_win", "steel")?.max === false);
check("Galarian Slowpoke: Poison and Psychic catches", !!quests.find((q) => q.dex === 79 && q.region === "galar" && q.types.includes("poison")) && !!quests.find((q) => q.dex === 79 && q.region === "galar" && q.types.includes("psychic")));
const known = new Set(["catch", "defeat", "raid_win", "walk", "hearts", "treats", "throw", "incense"]);
check("every quest has a known action", quests.every((q) => known.has(q.action)), quests.filter((q) => !known.has(q.action)).map((q) => q.quest).join(", "));
check("every type is a real type slug", quests.every((q) => q.types.every((t) => TYPES.has(t))));
check("catch and defeat quests are typed", quests.filter((q) => q.action === "catch" || q.action === "defeat").every((q) => q.types.length > 0));
const badText = quests.filter((q) => !q.text?.en || (q.target !== 1 && !q.text.en.includes("{0}")));
check("every quest has English in-game text, with {0} where the target is above 1", badText.length === 0, badText.map((q) => q.quest).join(", "));
const deMissing = quests.filter((q) => !q.text?.de);
check("every quest has German in-game text", deMissing.length === 0, deMissing.map((q) => q.quest).join(", "));
check("no text ends in a full stop", quests.every((q) => Object.values(q.text || {}).every((v) => !/[.。]$/.test(v))));

// ── Q4 ──
console.log("\nQ4 — the matcher");
const now = Date.parse("2026-11-19T12:00:00");
const at = (d) => new Date(now + d * DAY).toISOString().slice(0, 19);
const spawn = (dex, types) => ({ name: String(dex), dex, region: null, types });
const filler = Array.from({ length: 36 }, (_, i) => spawn(1000 + i, ["normal"]));
const events = [
  { id: "cd", title: "Dark CD", start: at(2), end: at(2.2), spawnForms: [spawn(624, ["dark", "steel"])] },
  { id: "mixed", title: "Mixed", start: at(-1), end: at(3), spawnForms: [spawn(633, ["dark", "dragon"]), ...filler] },
  { id: "late", title: "Too late", start: at(10), end: at(12), spawnForms: [spawn(371, ["dragon"])] },
  { id: "far", title: "Far venue", start: at(0), end: at(1), venue: { name: "Sydney", lat: -33.87, lng: 151.21 }, spawnForms: [spawn(147, ["dragon"])] },
];
const raidBosses = {
  raids: { lvl1: [{ id: "MEOWTH", names: { en: "Alolan Meowth" }, types: ["dark"] }], lvl5: [{ id: "DARKRAI", names: { en: "Darkrai" }, types: ["dark"] }] },
  maxBattles: { lvl1: [{ id: "NICKIT", names: { en: "Nickit" }, types: ["dark"] }] },
  eventRaids: [{ name: "Deoxys raids", start: at(1), end: at(3), bosses: ["NORMAL", "ATTACK", "DEFENSE", "SPEED"].map((f) => ({ id: "DEOXYS", form: `DEOXYS_${f}`, names: { en: "Deoxys" }, types: ["psychic"] })) }],
  eventMaxBattles: [],
};
const bonuses = [{ id: "pals", title: "Pals", start: at(0), end: at(2), bonuses: ["Earn additional hearts with your Buddy Pokémon"] }];
const home = [7.1, 50.73];
const src = questSources({ events, bonuses, raidBosses, rocketTrainers: [{ kind: "typed_grunt", type: "ghost" }] }, now, { homeLocation: home });
const q = (dex, action, types, target, extra = {}) => ({ dex, region: null, quest: `${dex}_${action}_${types.join("_")}`, action, types, target, ...extra });
const pancham = q(674, "catch", ["dark"], 32);
const dipplin = q(1011, "catch", ["dragon"], 7);
const plan = buddyQuestPlan([dipplin, pancham, q(891, "raid_win", ["dark"], 30, { max: true }), q(625, "raid_win", ["dark", "steel"], 15, { max: false }), q(211, "raid_win", [], 10, { max: false }), q(133, "hearts", [], 70), q(57, "defeat", ["ghost", "psychic"], 30), q(803, "catch", ["fairy"], 20)], src);
check("a Community Day of the type puts Pancham first", plan.ranked[0]?.quest.dex === 674, plan.ranked.map((r) => r.quest.dex).join(","));
check("one Dragon among 37 spawns still ranks Dipplin", plan.ranked.some((r) => r.quest.dex === 1011));
check("an event past the horizon counts for nothing", !matchQuest(dipplin, src).wild.some((w) => w.id === "late"));
check("an in-person event far from the pin counts for nothing", !src.wild.some((w) => w.id === "far"));
const kubfuRow = plan.ranked.find((r) => r.quest.dex === 891);
const bisharpRow = plan.ranked.find((r) => r.quest.dex === 625);
check("Max Battles count for Kubfu", kubfuRow?.raids.some((r) => r.name === "Nickit"));
check("Max Battles do not count for Bisharp", bisharpRow && !bisharpRow.raids.some((r) => r.name === "Nickit"));
check("Deoxys's four formes are one boss row", src.raids.filter((r) => r.name === "Deoxys").length === 1);
check("a hearts bonus ranks the heart quest", plan.ranked.some((r) => r.quest.dex === 133 && r.hearts.length === 1));
check("an untyped raid quest is an any-time quest", plan.anytime.some((r) => r.quest.dex === 211));
check("a defeat quest lists the matching Rocket grunts", plan.ranked.find((r) => r.quest.dex === 57)?.grunts.join() === "ghost");
check("a typed quest nothing helps is quiet", plan.quiet.some((r) => r.quest.dex === 803));
const noBonus = buddyQuestPlan([q(133, "hearts", [], 70)], questSources({ events: [], bonuses: [], raidBosses: {} }, now));
check("without a hearts bonus the heart quest is an any-time quest", noBonus.anytime.length === 1 && noBonus.ranked.length === 0);
check("the hearts bonus classifies as buddy_hearts", classifyBonus("Earn additional hearts with your Buddy Pokémon")?.kind === "buddy_hearts");
check("walking Candy XL is a known non-nudge", classifyBonus("Additional Candy XL when walking with your Buddy Pokémon")?.ignored === true);

// ── Q5 ──
console.log("\nQ5 — the filter");
for (const loc of ["de", "en", "ja"]) {
  const { buddyQuestFilterFor } = buildFilters(DEFAULT_HUNDOS, DEFAULT_LUCKIES, FIXTURE_CONFIG, [], loc);
  const kw = pogoKeywords(loc);
  const f = buddyQuestFilterFor([674, 891, 674]);
  const want = `${pokemonNameFor("674", loc)},${pokemonNameFor("891", loc)}&${kw.flag.evolve_quest}`;
  check(`${loc}: species in the locale, deduped, with the quest keyword`, f === want, f);
  check(`${loc}: nothing to find is no filter`, buddyQuestFilterFor([]) === "");
}

done("All buddy-quest checks passed.", (n) => `${n} buddy-quest check(s) failed.`);
