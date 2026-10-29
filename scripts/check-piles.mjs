// Property checks for the sorting piles (docs/sorting-workflow-spec.md, "Pile
// shape"). Every pile goes through buildPile, so every pile is held to the
// same contract here, in every locale:
//
//   P1 — shape: each ① lens is the pile AND the lens, ② is the pile minus
//        starred and tagged, ③ is the pile AND the protection tail, exactly
//   P2 — every step is well formed and fits the in-game search bar
//   P3 — ③ gives a definite "no" for every always-protected kind and still
//        shows what ① and ② leave to the user (scripts/lib/pile-cases.mjs)
//   P4 — ② hides starred and tagged Pokémon and shows the rest
//   P5 — no step of a pile ever matches a Pokémon outside the pile
//   P6 — each lens finds what it names (the hundo lens finds hundos only)
//
// PILE_FAMILIES is the registry: a new pile adds one entry naming where its
// piles come from and which species is in it, and inherits every check.
//
// Run with: npx vite-node scripts/check-piles.mjs

import {
  buildFilters, COMMUNITY_DAY_BG_DEX, DEFAULT_TOP_ATTACKERS, DEFAULT_TOP_MAX_ATTACKERS, evalFilterDetailed, protectionTail, SEARCH_CHAR_BUDGET,
} from "../src/App.jsx";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";
import COMMUNITY_DAYS from "../src/data/community-days.json";
import {
  LEGACY_COMMUNITY_DAYS, LEGACY_THROUGH, communityDayBackgroundDex, mergeRollingCommunityDays,
} from "./lib/community-days.mjs";
import { resolveSpeciesInfo } from "../src/data/species.js";
import { LOCALES } from "../src/i18n/index.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { pokemonNameFor } from "../src/data/species.js";
import { FIXTURE_CONFIG, makeTFn } from "./lib/fixture.mjs";
import { pileCases, pileMon } from "./lib/pile-cases.mjs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const HUNDOS = ["Machop"];
// The fixture config carries no rosters (the app passes its own in), so the
// piles are built with the shipped ones, as a first-run user would see them.
const CFG = { ...FIXTURE_CONFIG, topAttackers: DEFAULT_TOP_ATTACKERS, topMaxAttackers: DEFAULT_TOP_MAX_ATTACKERS };
const dexOf = (name) => resolveSpeciesInfo(name)?.dex;
const RAID_DEX = dexOf(DEFAULT_TOP_ATTACKERS[0]);
const MAX_DEX = dexOf(DEFAULT_TOP_MAX_ATTACKERS[0]);
const KEEPER_DEX = dexOf((CFG.shadowKeeperSpecies || [])[0]);
const GREAT_DEX = PVP_RANKINGS.leagues?.great?.species?.[0]?.dex;
const iv = (a, d, h) => ({ ivAtk: a, ivDef: d, ivHp: h });
const DYNA = { dynaAtk: 1, flags: { dynamaxCapable: true } };
const YEAR_FLOOR_CASE = /untraded$/; // meaningless where every member is traded

// name: label · pile(result) → the pile · dex: a member species · base: what
// makes a test Pokémon a member · skipProtected: PROTECTED rows that cannot
// apply to this pile · lensCases(kw): { lens: { match, miss[, dex] } }, an
// oracle per lens; every lens chain of three or more clauses has one.
const PILE_FAMILIES = [
  {
    name: "event spawns",
    piles: (r) => (r.eventFilters || []).map((ev) => ({ pile: ev.pile, dex: ev.spawnDex?.[0] })),
    // keep_iv is "hundo, or two 15s and every bar 11+": 15/15/12 in, 15/14/14 out.
    lensCases: () => ({
      souvenirs: { match: { flags: { background: true } }, miss: {} },
      keep_iv: { match: iv(15, 15, 12), miss: iv(15, 14, 14) },
    }),
  },
  {
    name: "hundo sort",
    piles: (r) => [{ pile: r.hundoPile, dex: 66 }],
    lensCases: () => ({ hundos: { match: iv(15, 15, 15), miss: iv(15, 15, 14) } }),
  },
  {
    name: "meta",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "meta"), dex: RAID_DEX }],
    lensCases: () => ({
      raid: { match: iv(15, 15, 13), miss: iv(5, 5, 5) },
      shadow_keep: { dex: KEEPER_DEX, match: { flags: { shadow: true } }, miss: {} },
      max: { dex: MAX_DEX, match: { ...DYNA, ...iv(15, 15, 13) }, miss: iv(15, 15, 13) },
      pvp_great: { dex: GREAT_DEX, match: { ...iv(0, 15, 15), wp: 1400 }, miss: { ...iv(0, 15, 15), wp: 1600 } },
    }),
  },
  {
    name: "shadows",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "shadows"), dex: 129 }],
    base: { flags: { shadow: true } },
    lensCases: (kw) => ({
      purify_hundo: { match: { moves: [kw.flag.frustration], ...iv(13, 13, 13) }, miss: { moves: [kw.flag.frustration], ...iv(15, 15, 15) } },
      tm_done: { match: { moves: ["return"] }, miss: { moves: [kw.flag.frustration] } },
      cheap_purify: { match: { moves: [kw.flag.frustration], candyKm: 1 }, miss: { moves: [kw.flag.frustration], candyKm: 5 } },
    }),
  },
  {
    name: "received trades",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "traded"), dex: 129 }],
    base: { flags: { traded: true } },
    skipProtected: YEAR_FLOOR_CASE,
    lensCases: () => ({ souvenirs: { match: { flags: { costume: true } }, miss: {} }, luckies: { match: { flags: { lucky: true } }, miss: {} } }),
  },
  {
    name: "luckies",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "luckies"), dex: 129 }],
    base: { flags: { lucky: true, traded: true } },
    skipProtected: YEAR_FLOOR_CASE,
    lensCases: () => ({ high_iv: { match: iv(15, 15, 13), miss: iv(5, 5, 5) } }),
  },
  {
    name: "Dynamax",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "dynamax"), dex: MAX_DEX }],
    base: DYNA,
    lensCases: () => ({
      builds: { match: iv(15, 15, 13), miss: iv(5, 5, 5) },
      gigantamax: { match: { flags: { gigantamaxCapable: true } }, miss: {} },
      parkers: { match: {}, miss: { dynaWall: 1 } },
    }),
  },
  {
    name: "XXL",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "xxl"), dex: 129 }],
    base: { flags: { xxl: true } },
    lensCases: () => ({ high_iv: { match: iv(15, 15, 13), miss: iv(5, 5, 5) } }),
  },
  {
    name: "XXS",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "xxs"), dex: 129 }],
    base: { flags: { xxs: true } },
    lensCases: () => ({ evolve: { match: { flags: { canEvolve: true } }, miss: { flags: { canEvolve: false } } } }),
  },
  {
    name: "Community Day backgrounds",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "cd_backgrounds"), dex: 906 }],
    base: { flags: { specialBackground: true } },
    lensCases: () => ({ shiny: { match: { flags: { shiny: true } }, miss: {} } }),
  },
  {
    name: "costumes",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "costumes"), dex: 129 }],
    base: { flags: { costume: true } },
    lensCases: () => ({
      shiny: { match: { flags: { shiny: true } }, miss: {} },
      evolve: { match: { flags: { canEvolve: true } }, miss: { flags: { canEvolve: false } } },
    }),
  },
];

const BAD = [/undefined/, /NaN/, /\[object /, /&&|,,/, /^[&,]|[&,]$/, /!!/];
const { PROTECTED, RELEASABLE } = pileCases(CFG);
const localeNames = Object.keys(LOCALES);

for (const fam of PILE_FAMILIES) {
  console.log(`\n${fam.name}`);
  for (const loc of localeNames) {
    const kw = pogoKeywords(loc);
    const tail = protectionTail(kw, CFG).join("&");
    const result = buildFilters(HUNDOS, [], CFG, [], loc, makeTFn(loc));
    const cases = fam.lensCases?.(kw) || {};
    const entries = fam.piles(result).filter((e) => e.pile);
    const bad = [];
    if (entries.length === 0) bad.push("no pile built");
    for (const { pile, dex } of entries) {
      const where = pile.id;
      const head = pile.overview;
      // P1
      for (const lens of pile.keep) if (!lens.filter.startsWith(`${head}&`)) bad.push(`${where}.${lens.key}: not head & lens`);
      if (pile.sort !== `${head}&!${kw.flag.favorite}&!#`) bad.push(`${where}: ② is not head & !favourite & !#`);
      if (pile.release !== `${head}&${tail}`) bad.push(`${where}: ③ is not head & tail`);
      // P2
      const steps = [["overview", head], ...pile.keep.map((l) => [l.key, l.filter]), ["sort", pile.sort], ["release", pile.release]];
      for (const [k, str] of steps) {
        for (const re of BAD) if (re.test(str)) bad.push(`${where}.${k}: malformed (${re})`);
        if (str.length > SEARCH_CHAR_BUDGET) bad.push(`${where}.${k}: ${str.length} chars`);
      }
      const species = pokemonNameFor(String(dex), "en");
      if (!species) { bad.push(`${where}: member dex ${dex} has no name`); continue; }
      const withBase = (o) => ({ ...fam.base, ...o, flags: { ...(fam.base?.flags || {}), ...(o.flags || {}) } });
      const monOf = (o, d = dex) => pileMon(loc, withBase(o), pokemonNameFor(String(d), "en"), d);
      const verdict = (str, o, d) => evalFilterDetailed(str, monOf(o, d), loc);
      const note = (v) => (v.unknown.length ? ` (unknown ${v.unknown.join(" ")})` : "");
      // P3
      for (const [label, o] of PROTECTED) {
        if (fam.skipProtected?.test(label)) continue;
        const v = verdict(pile.release, o);
        if (v.verdict !== false) bad.push(`${where} ③ ${label}: ${v.verdict}${note(v)}`);
      }
      for (const [label, o] of RELEASABLE) {
        const v = verdict(pile.release, o);
        if (v.verdict !== true) bad.push(`${where} ③ ${label} hidden: ${v.verdict}${note(v)}`);
      }
      // P4
      for (const [label, o, want] of [["starred", { flags: { favorite: true } }, false], ["tagged", { tags: ["Trade"] }, false], ["plain", {}, true]]) {
        const v = verdict(pile.sort, o);
        if (v.verdict !== want) bad.push(`${where} ② ${label}: ${v.verdict}${note(v)}`);
      }
      // P5 — a hundo shiny legendary nobody starred, outside the pile
      const outsider = { families: ["notinthepile"], dex: 0, ivAtk: 15, ivDef: 15, ivHp: 15, flags: { shiny: true } };
      for (const [k, str] of steps) {
        const v = evalFilterDetailed(str, pileMon(loc, outsider, "Magikarp", 0), loc);
        if (v.verdict !== false) bad.push(`${where}.${k} matched a Pokémon outside the pile: ${v.verdict}${note(v)}`);
      }
      // P6
      for (const lens of pile.keep) {
        const c = cases[lens.key];
        const chain = lens.filter.slice(head.length + 1).split("&").length;
        if (!c) {
          if (chain >= 3 && !lens.key.startsWith("pvp_cup_")) bad.push(`${where}.${lens.key}: a ${chain}-clause lens with no oracle`);
          continue;
        }
        const m = verdict(lens.filter, c.match, c.dex ?? dex);
        const x = verdict(lens.filter, c.miss, c.dex ?? dex);
        if (m.verdict !== true) bad.push(`${where}.${lens.key} misses its own kind: ${m.verdict}${note(m)}`);
        if (x.verdict !== false) bad.push(`${where}.${lens.key} matches a near miss: ${x.verdict}${note(x)}`);
      }
    }
    check(`${loc}: ${entries.length} pile(s)`, bad.length === 0, bad.slice(0, 4).join(" | "));
  }
}

console.log("\nCommunity Day data (scripts/lib/community-days.mjs → src/data/community-days.json)");
{
  const bad = [];
  for (const cd of LEGACY_COMMUNITY_DAYS) {
    if (cd.sources.length < 2) bad.push(`${cd.date}: ${cd.sources.length} source(s)`);
    cd.dex.forEach((d, i) => {
      const en = pokemonNameFor(String(d), "en");
      if (en?.toLowerCase() !== cd.names[i].toLowerCase()) bad.push(`${cd.date}: dex ${d} is ${en}, not ${cd.names[i]}`);
    });
  }
  check(`${LEGACY_COMMUNITY_DAYS.length} legacy Community Days: two sources each, every dex names its species`, bad.length === 0, bad.slice(0, 4).join(" | "));
  check("the committed snapshot carries the pinned legacy list unchanged",
    JSON.stringify(COMMUNITY_DAYS.legacy) === JSON.stringify(LEGACY_COMMUNITY_DAYS));
  check("the app's species set is the library's rule over the snapshot",
    JSON.stringify(COMMUNITY_DAY_BG_DEX) === JSON.stringify(communityDayBackgroundDex(COMMUNITY_DAYS)));
  check("a recap without a background stays out of the pile, its species in through their own days",
    !LEGACY_COMMUNITY_DAYS.find((cd) => cd.date === "2025-12-06").background && COMMUNITY_DAY_BG_DEX.includes(906));
  // The merge is append-only and never duplicates.
  const prev = [{ date: "2026-11-21", event: "Pawniard Community Day", dex: [624], background: null }];
  const fresh = [
    { date: "2026-11-21", event: "Pawniard Community Day", dex: [624], background: null },
    { date: "2026-12-12", event: "December Community Day 2026", dex: [1, 4], background: null },
    { date: LEGACY_THROUGH, event: "Zorua Community Day", dex: [570], background: null },
  ];
  const { rolling, added } = mergeRollingCommunityDays(prev, fresh);
  check("merge keeps every previous entry, adds a new one once, skips what legacy already pins",
    rolling.length === 2 && added.length === 1 && added[0].date === "2026-12-12" && rolling[0].event === "Pawniard Community Day");
  check("an empty feed drops nothing", mergeRollingCommunityDays(prev, []).rolling.length === 1);
}

console.log(`\n${failures === 0 ? "✓ All pile checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
