// Offline checks for the buddy panel in the Mega planner: the game-master reader in
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
//   Q4 — the matcher, per Mega-planner outing: a Community Day of a type puts
//        its quest first; in a mixed pool the shorter quest with more matches
//        leads and the rest stay listed; a raid outing counts raid wins,
//        defeats and catches, a wild one only catches; walking never ranks
//   Q5 — the filter: species in the output locale plus the evolve-with-quest
//        keyword, never a literal German name in another locale
//
// Data-derived, so no fixture: properties only (see scripts/lib/fixture.mjs).

import { createChecker } from "./lib/check.mjs";
import { evolutionQuestsFromGameMaster, readEvolutionQuest } from "./lib/game-master.mjs";
import { outingBuddyQuests } from "../src/buddy-quests.js";
import { classifyBonus } from "../src/bonus-nudges.js";
import QUESTS from "../src/data/evolution-quests.json";
import { buildFilters, DEFAULT_HUNDOS, DEFAULT_LUCKIES } from "../src/App.jsx";
import { FIXTURE_CONFIG } from "./lib/fixture.mjs";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { pokemonNameFor } from "../src/data/species.js";

const { check, done } = createChecker();
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
console.log("\nQ4 — the matcher, one outing at a time");
const spawn = (dex, types) => ({ dex, region: null, types });
const q = (dex, action, types, target, extra = {}) => ({ dex, region: null, quest: `${dex}_${action}_${types.join("_")}`, action, types, target, ...extra });
const pancham = q(674, "catch", ["dark"], 32);
const dipplin = q(1011, "catch", ["dragon"], 7);
const kubfuQ = q(891, "raid_win", ["dark"], 30, { max: true });
const bisharpQ = q(625, "raid_win", ["dark", "steel"], 15, { max: false });
const annihilape = q(57, "defeat", ["ghost", "psychic"], 30);
const walker = q(349, "walk", [], 20);
const pool = [dipplin, pancham, kubfuQ, bisharpQ, annihilape, walker];
const filler = Array.from({ length: 50 }, (_, i) => spawn(1000 + i, ["normal"]));

const cd = outingBuddyQuests(pool, { kind: "wild", spawnForms: [spawn(624, ["dark", "steel"])] });
check("a Dark Community Day puts Pancham first", cd[0]?.quest.dex === 674, cd.map((r) => r.quest.dex).join(","));
check("a wild outing ranks no raid or defeat quest", cd.every((r) => r.quest.action === "catch"));
const mixed = outingBuddyQuests(pool, { kind: "wild", spawnForms: [spawn(633, ["dark", "dragon"]), spawn(371, ["dragon"]), ...filler] });
check("in a mixed pool the shorter quest with more matches leads: Dipplin before Pancham", mixed[0]?.quest.dex === 1011 && mixed[1]?.quest.dex === 674, mixed.map((r) => r.quest.dex).join(","));
check("the others that are good too stay listed", mixed.length === 2);
const darkRaid = outingBuddyQuests(pool, { kind: "raid", spawnForms: [spawn(491, ["dark"])] });
const order = darkRaid.map((r) => r.quest.dex);
check("a Dark raid hour lists Bisharp, Kubfu and Pancham (each win ends in a catch)", [625, 891, 674].every((d) => order.includes(d)), order.join(","));
check("fifteen raid wins rank before thirty", order.indexOf(625) < order.indexOf(891));
check("a Ghost raid counts for the defeat quest", outingBuddyQuests(pool, { kind: "raid", spawnForms: [spawn(354, ["ghost"])] }).some((r) => r.quest.dex === 57));
check("no outing ranks a walking quest", ![cd, mixed, darkRaid].flat().some((r) => r.quest.action === "walk"));
check("an empty outing ranks nothing", outingBuddyQuests(pool, { kind: "wild", spawnForms: [] }).length === 0);
check("each row says what counted", cd[0]?.matches.length === 1 && cd[0].share === 1);

const real = QUESTS.quests;
const realCd = outingBuddyQuests(real, { kind: "wild", spawnForms: [spawn(624, ["dark", "steel"])] });
check("against the snapshot, a Pawniard Community Day leads with Pancham", realCd[0]?.quest.dex === 674, realCd.slice(0, 4).map((r) => r.quest.dex).join(","));
check("the hearts bonus is a known non-nudge now the card is gone", classifyBonus("Earn additional hearts with your Buddy Pokémon")?.ignored === true);
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
