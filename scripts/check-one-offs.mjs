// The one-off tool strings (src/one-off-filters.js, wired in buildFilters):
// Silver / Gold Bottle Caps, re-roll trades, third move, Elite TM targets and
// Max Move upgrades. Run with: npm run test:oneoffs
//
//   O1  atLeastOf is exactly "at least k of n" for every assignment, n ≤ 6
//   O2  bottle caps: the three silver gradients and gold, against mock
//       storage, in all seven locales
//   O3  re-roll trades: the trade rules and the silver-cap hand-off
//   O4  third move / Elite TM / Max Move upgrades: rosters from the
//       snapshots (CLAUDE.md: PvP species lists are data), the per-form
//       intersection, and every Elite TM move localising in every locale
//   O5  every one-off string evaluates to a definite verdict for a fully
//       described Pokémon (no token the evaluator, and so the verify
//       panel, can't read) and fits the game's 5,000-character limit

import { buildFilters, evalFilterDetailed, DEFAULT_CONFIG } from "../src/App.jsx";
import { atLeastOf, eliteTmFilter, specialGroups } from "../src/one-off-filters.js";
import { pokemonNameFor } from "../src/data/species.js";
import { pogoKeywords, moveKeywordFor } from "../src/i18n/pogo-keywords.js";
import { LOCALES } from "../src/i18n/index.js";
import META_RANKINGS from "../src/data/meta-rankings.json";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";
import { pileMon } from "./lib/pile-cases.mjs";

const tFn = (k) => k;
let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const LOCS = Object.keys(LOCALES);
const v = (str, mon, loc) => evalFilterDetailed(str, mon, loc).verdict;
const nameOf = (dex, loc) => pokemonNameFor(String(dex), loc)?.toLowerCase();
// A mon of species `dex` in locale `loc`, IVs as raw 0-15 values.
const mon = (loc, dex, ivs, o = {}) =>
  pileMon(loc, { ...o, ivAtk: ivs[0], ivDef: ivs[1], ivHp: ivs[2] }, nameOf(dex, loc), dex);

console.log("O1: atLeastOf is exactly 'at least k of n'");
{
  let ok = true;
  for (let n = 1; n <= 6; n++) {
    const groups = Array.from({ length: n }, (_, i) => [`g${i}`]);
    for (let k = 1; k <= n; k++) {
      const cnf = atLeastOf(groups, k);
      for (let mask = 0; mask < 1 << n; mask++) {
        const on = (term) => ((mask >> +term.slice(1)) & 1) === 1;
        const holds = cnf.every((c) => c.split(",").some(on));
        const want = [...Array(n).keys()].filter((i) => (mask >> i) & 1).length >= k;
        if (holds !== want) ok = false;
      }
    }
  }
  check("every n ≤ 6, k ≤ n, every assignment", ok);
  check("fewer groups than k is unsatisfiable (null)", atLeastOf([["a"]], 2) === null);
  check("empty groups are dropped", JSON.stringify(atLeastOf([["a"], [], ["b"]], 2)) === JSON.stringify(["a", "b"]));
  const kw = pogoKeywords("en");
  check("no collectibles → five property groups", specialGroups(kw, []).filter((g) => g.filter(Boolean).length).length === 5);
}

// Species for the storage cases. Pikachu (25) is the hundo-list family,
// Gible (443) a family the list does not cover, Mewtwo (150) a legendary.
const PIKACHU = 25, GIBLE = 443, MEWTWO = 150;

console.log("\nO2: bottle caps against mock storage, every locale");
for (const loc of LOCS) {
  const cfg = { ...DEFAULT_CONFIG, customCollectibles: [nameOf(GIBLE, "de")] };
  const r = buildFilters([nameOf(PIKACHU, "de")], [], cfg, [], loc, tFn);
  const cap = Object.fromEntries(r.bottleCaps.map((x) => [x.key, x.filter]));
  const keys = ["silver_two_special", "silver_one_special", "silver_any_family", "gold"];
  const hits = (m) => keys.filter((k) => cap[k] && v(cap[k], m, loc) === true).join(",");
  const cases = [
    // [label, mon, expected boxes]
    ["shiny costumed Pikachu 15/15/12, family on the hundo list", mon(loc, PIKACHU, [15, 15, 12], { flags: { shiny: true, costume: true } }), "silver_any_family"],
    ["shiny collectible Gible 15/12/15, new family", mon(loc, GIBLE, [15, 12, 15], { flags: { shiny: true } }), "silver_two_special,silver_one_special,silver_any_family"],
    ["plain collectible Gible 12/15/15: one special", mon(loc, GIBLE, [12, 15, 15]), "silver_one_special"],
    ["shiny Mewtwo 15/15/0: legendary + shiny, two bars", mon(loc, MEWTWO, [15, 15, 0], { flags: { shiny: true, legendary: true } }), "silver_two_special,silver_one_special,silver_any_family"],
    ["shadow shiny Mewtwo 15/15/0: Shadow can't be trained", mon(loc, MEWTWO, [15, 15, 0], { flags: { shiny: true, legendary: true, shadow: true } }), ""],
    ["shiny Mewtwo already in Hyper Training", mon(loc, MEWTWO, [15, 15, 0], { flags: { shiny: true, legendary: true, hyperTraining: true } }), ""],
    ["shiny Mewtwo hundo: nothing to train", mon(loc, MEWTWO, [15, 15, 15], { flags: { shiny: true, legendary: true } }), ""],
    ["shiny Mewtwo 15/10/10: gold, one full bar", mon(loc, MEWTWO, [15, 10, 10], { flags: { shiny: true, legendary: true } }), "gold"],
    ["shiny Mewtwo 2/2/2: gold", mon(loc, MEWTWO, [2, 2, 2], { flags: { shiny: true, legendary: true } }), "gold"],
    ["plain Mewtwo 15/10/10: one special, gold needs two", mon(loc, MEWTWO, [15, 10, 10], { flags: { legendary: true } }), ""],
  ];
  const bad = cases.filter(([, m, want]) => hits(m) !== want).map(([label, m, want]) => `${label}: got [${hits(m)}] want [${want}]`);
  check(`${loc}: ${cases.length} storage cases`, bad.length === 0, bad.join("; "));
}
{
  const r = buildFilters([], [], DEFAULT_CONFIG, [], "en", tFn);
  check("an empty hundo list drops the any-family repeat", !r.bottleCaps.some((x) => x.key === "silver_any_family") && r.bottleCaps.length === 3);
  const kw = pogoKeywords("en");
  check("no collectibles: the specials are the five flags only",
    r.bottleCaps.every((x) => !x.filter.includes(",,")) && r.bottleCaps[0].filter.includes(`${kw.flag.shiny},${kw.flag.background}`));
}

console.log("\nO3: re-roll trades");
for (const loc of LOCS) {
  const r = buildFilters([], [], { ...DEFAULT_CONFIG, customCollectibles: [nameOf(GIBLE, "de")] }, [], loc, tFn);
  const f = r.rerollTrade;
  const cases = [
    ["shiny legendary 3/4/2, untraded", mon(loc, MEWTWO, [3, 4, 2], { flags: { shiny: true, legendary: true } }), true],
    ["plain collectible 5/5/5", mon(loc, GIBLE, [5, 5, 5]), true],
    ["plain Pikachu 5/5/5: nothing special", mon(loc, PIKACHU, [5, 5, 5]), false],
    ["already traded", mon(loc, MEWTWO, [3, 4, 2], { flags: { shiny: true, traded: true } }), false],
    ["lucky", mon(loc, MEWTWO, [3, 4, 2], { flags: { shiny: true, lucky: true } }), false],
    ["shadow", mon(loc, MEWTWO, [3, 4, 2], { flags: { shiny: true, shadow: true } }), false],
    ["in Hyper Training", mon(loc, MEWTWO, [3, 4, 2], { flags: { shiny: true, hyperTraining: true } }), false],
    ["three stars", mon(loc, MEWTWO, [13, 13, 13], { flags: { shiny: true } }), false],
    ["two full bars 15/15/0 goes to a silver cap instead", mon(loc, MEWTWO, [15, 15, 0], { flags: { shiny: true } }), false],
    ["a mythical other than Meltan/Melmetal", mon(loc, 151, [1, 1, 1], { flags: { shiny: true, mythical: true } }), false],
    ["shiny Meltan", mon(loc, 808, [1, 1, 1], { flags: { shiny: true, mythical: true } }), true],
  ];
  const bad = cases.filter(([, m, want]) => v(f, m, loc) !== want).map(([label]) => label);
  check(`${loc}: ${cases.length} trade cases`, bad.length === 0, bad.join("; "));
}

console.log("\nO4: third move / Elite TM / Max Move upgrades");
{
  const r = buildFilters([], [], DEFAULT_CONFIG, [], "en", tFn);
  const keys = (list) => list.map((x) => x.key).join(",");
  check("third move: one box per roster", keys(r.thirdMove) === "raids,great,ultra,master", keys(r.thirdMove));
  check("Elite TM: one box per roster", keys(r.eliteTm) === "raids,great,ultra,master", keys(r.eliteTm));
  const box = (list, key) => list.find((x) => x.key === key)?.filter || "";

  // Raid roster: the first raid entry that needs an Elite TM move.
  const raidEntries = [...Object.values(META_RANKINGS.perType).flat(), ...Object.values(META_RANKINGS.shadowPerType).flat()];
  const eliteRaid = raidEntries.find((e) => e.eliteMoves?.length);
  check("the raid snapshot names Elite TM moves", !!eliteRaid);
  if (eliteRaid) {
    for (const loc of LOCS) {
      const rl = buildFilters([], [], DEFAULT_CONFIG, [], loc, tFn);
      const raids = box(rl.eliteTm, "raids");
      const allMoves = new Set(raidEntries.filter((e) => e.dex === eliteRaid.dex).flatMap((e) => e.eliteMoves || []));
      const kwMoves = [...allMoves].map((m) => moveKeywordFor(m, loc));
      const missing = mon(loc, eliteRaid.dex, [14, 14, 14], { moves: [] });
      const has = mon(loc, eliteRaid.dex, [14, 14, 14], { moves: kwMoves });
      const weak = mon(loc, eliteRaid.dex, [1, 1, 1], { moves: [] });
      check(`${loc}: ${eliteRaid.species} without ${[...allMoves]} is a raid Elite TM target, with it is not, a 1★ is not`,
        v(raids, missing, loc) === true && v(raids, has, loc) === false && v(raids, weak, loc) === false);
      const third = box(rl.thirdMove, "raids");
      check(`${loc}: ${eliteRaid.species} 3★ on one charged move is a third-move target, double-moved is not`,
        v(third, mon(loc, eliteRaid.dex, [14, 14, 14]), loc) === true &&
          v(third, mon(loc, eliteRaid.dex, [14, 14, 14], { flags: { doubleMoved: true } }), loc) === false);
    }
  }

  // Great League: a ranked species inside the cap with a rank-1 style spread.
  const great = PVP_RANKINGS.leagues.great;
  const eliteGreat = great.species.find((s) => s.eliteMoves?.length);
  check("the PvP snapshot names Elite TM moves", !!eliteGreat);
  if (eliteGreat) {
    const loc = "de";
    const rl = buildFilters([], [], DEFAULT_CONFIG, [], loc, tFn);
    const f = box(rl.eliteTm, "great");
    const pvpMon = (o) => mon(loc, eliteGreat.dex, [0, 15, 15], { wp: 1490, moves: [], ...o });
    check(`great: ${eliteGreat.name} 0/15/15 at 1490 CP without ${eliteGreat.eliteMoves} is a target`, v(f, pvpMon({}), loc) === true);
    check(`great: the same with the move is not`,
      v(f, pvpMon({ moves: eliteGreat.eliteMoves.map((m) => moveKeywordFor(m, loc)) }), loc) === false);
    check(`great: the same above the CP cap is not`, v(f, pvpMon({ wp: 1600 }), loc) === false);
    const t3 = box(rl.thirdMove, "great");
    check(`great: third move takes the in-cap spread, not a high-attack one`,
      v(t3, pvpMon({}), loc) === true && v(t3, mon(loc, eliteGreat.dex, [15, 15, 15], { wp: 1490 }), loc) === false);
  }

  // Every Elite TM move in both snapshots must localise in every locale: a
  // move the client knows under another name is a dead `@term` there.
  const allElite = new Set([
    ...raidEntries.flatMap((e) => e.eliteMoves || []),
    ...Object.values(PVP_RANKINGS.leagues).flatMap((l) => l.species.flatMap((s) => s.eliteMoves || [])),
  ]);
  const unlocalised = [];
  for (const m of allElite) for (const loc of LOCS) if (!LOCALES[loc].messages[`move.${m}`]) unlocalised.push(`${m}@${loc}`);
  check(`all ${allElite.size} Elite TM moves have a name in all ${LOCS.length} locales`, unlocalised.length === 0, unlocalised.slice(0, 8).join(", "));

  // Forms folded into one name keep only the moves they share.
  check("two forms with different Elite TM moves ask for none",
    eliteTmFilter([{ name: "ninetales", moves: ["weatherball"] }, { name: "ninetales", moves: ["powdersnow"] }]).length === 0);
  check("two forms sharing a move keep it",
    eliteTmFilter([{ name: "x", moves: ["a", "b"] }, { name: "x", moves: ["b"] }]).join("&") === "x&!x,!@b");

  // Max Move upgrades over the Max attacker roster.
  const maxName = DEFAULT_CONFIG.topMaxAttackers?.[0] || META_RANKINGS.topMaxAttackers[0];
  const loc = "en";
  const rl = buildFilters([], [], { ...DEFAULT_CONFIG, topMaxAttackers: META_RANKINGS.topMaxAttackers }, [], loc, tFn);
  const maxDex = raidEntries.find((e) => e.species === maxName)?.dex;
  check("Max Move upgrades emitted", !!rl.maxMoveUpgrade);
  if (maxDex) {
    const m = (lvl, ivs = [14, 14, 14]) => mon(loc, maxDex, ivs, { dynaAtk: lvl });
    check(`${maxName}: Max Move level 1 and 2 are targets, 3 is not, a 1★ is not`,
      v(rl.maxMoveUpgrade, m(1), loc) === true && v(rl.maxMoveUpgrade, m(2), loc) === true &&
        v(rl.maxMoveUpgrade, m(3), loc) === false && v(rl.maxMoveUpgrade, m(1, [1, 1, 1]), loc) === false);
  }
}

console.log("\nO5: definite verdicts and the 5,000-character limit");
for (const loc of LOCS) {
  const cfg = { ...DEFAULT_CONFIG, customCollectibles: [nameOf(GIBLE, "de")], topMaxAttackers: META_RANKINGS.topMaxAttackers };
  const r = buildFilters([nameOf(PIKACHU, "de")], [], cfg, [], loc, tFn);
  const all = [
    ...r.bottleCaps.map((x) => [`cap ${x.key}`, x.filter]),
    ["reroll", r.rerollTrade],
    ...r.thirdMove.map((x) => [`third ${x.key}`, x.filter]),
    ...r.eliteTm.map((x) => [`elite ${x.key}`, x.filter]),
    ["max", r.maxMoveUpgrade],
  ];
  const full = mon(loc, MEWTWO, [15, 15, 3], { moves: [], dynaAtk: 1, buddyLevel: 0, flags: { shiny: true, legendary: true, doubleMoved: false } });
  const unread = all.filter(([, f]) => evalFilterDetailed(f, full, loc).verdict === null).map(([k, f]) => `${k}: ${evalFilterDetailed(f, full, loc).unknown.join(" ")}`);
  check(`${loc}: every string reads definitely`, unread.length === 0, unread.join("; "));
  const long = all.filter(([, f]) => f.length > 5000).map(([k, f]) => `${k} ${f.length}`);
  check(`${loc}: every string fits 5,000 characters`, long.length === 0, long.join(", "));
}

if (failures > 0) {
  console.error(`\n${failures} one-off check(s) failed.`);
  process.exit(1);
}
console.log("\nAll one-off checks passed.");
