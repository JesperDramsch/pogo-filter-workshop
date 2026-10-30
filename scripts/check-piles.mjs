// Property checks for the sorting piles (docs/sorting-workflow-spec.md, "Pile
// shape"). Every pile goes through buildPile, so every pile is held to the
// same contract here, in every locale:
//
//   P1 — shape: each ① lens is the pile AND the lens, ② is the pile minus
//        starred and tagged, ③b (release) is the pile AND the protection
//        tail, exactly, and ③a (safe) starts with ③b; a family marked
//        noRelease has neither
//   P2 — every step is well formed and fits the in-game search bar
//   P3 — ③b gives a definite "no" for every always-protected kind and still
//        shows what ① and ② leave to the user (scripts/lib/pile-cases.mjs),
//        under the default config and under one that protects nundos and
//        carves a mythical out (the two settings the tail reads); ③a adds the
//        same clauses under both
//   P4 — ② hides starred and tagged Pokémon and shows the rest
//   P5 — no step of a pile ever matches a Pokémon outside the pile
//   P6 — each lens finds what it names (the hundo lens finds hundos only)
//   P7 — the pile card: meta rows are meta, watchlist rows watchlist, the two
//        never overlap, every row says how many to keep, and no rendered
//        string is a raw key or keeps a {placeholder}, in any locale
//   P8 — budgets: every budget is reachable through a row of the spec's
//        table, every row's rule renders in every locale, simple mode uses
//        the defaults, expert mode the overrides, and the import merge keeps
//        only whole numbers ≥ 0
//   P9 — every ① step finds something no earlier step found
//   P10 — ③a (safe) is the leftovers: what any lens with a `not` would have
//        kept gives a definite "no", a plain dupe that cannot evolve is shown,
//        a shiny is hidden wherever a shiny lens exists
//
// PILE_FAMILIES is the registry: a new pile adds one entry naming where its
// piles come from and which species is in it, and inherits every check.
//
// Run with: npx vite-node scripts/check-piles.mjs

import {
  BUDGET_DEFAULTS, BUDGET_ROWS, evalFilterDetailed as evalDetailed, FLOAT_ENDED_DAYS, floatingPiles, SHOWCASE_XXL_BONUS, showcaseScoreRange, JOB_TAG_DEFAULTS, JOB_TAG_ORDER, jobTagsOf, tagClashes, buildFilters, COMMUNITY_DAY_BG_DEX, mergeImportedConfig, DEFAULT_TOP_ATTACKERS, DEFAULT_TOP_MAX_ATTACKERS, evalFilterDetailed, protectionTail, SEARCH_CHAR_BUDGET, PILE_GROUPS, PROTECTION_PILES, hiddenPileTransitions, withPileTransitions,
} from "../src/App.jsx";
import { readFileSync } from "node:fs";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";
import COMMUNITY_DAYS from "../src/data/community-days.json";
import SPECIES_META from "../src/data/species-meta.json";
import {
  LEGACY_COMMUNITY_DAYS, LEGACY_THROUGH, communityDayBackgroundDex, communityDaysFromFeed, mergeRollingCommunityDays,
} from "./lib/community-days.mjs";
import { resolveSpeciesInfo } from "../src/data/species.js";
import { LOCALES } from "../src/i18n/index.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { pokemonNameFor } from "../src/data/species.js";
import { FIXTURE_CONFIG, makeTFn } from "./lib/fixture.mjs";
import { pileCases, pileMon, tailOptions } from "./lib/pile-cases.mjs";
import { hasCostumedSpawns, signalsFromFeed } from "./fetch-events.mjs";
import { acceptPveDump, learnersOf, watchMovesFrom } from "./fetch-game-master-watch.mjs";
import GM_WATCH from "../src/data/game-master-watch.json";
import WATCH_MOVES from "../src/data/watch-moves.json";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const HUNDOS = ["Machop"];
// Machop is both: its family is "done twice" (hundo and lucky). Eevee is lucky only.
const LUCKIES = ["Machop", "Eevee"];
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
// A species on no meta, watchlist or Max list, for piles whose steps single
// out meta species (the shadow pile's meta step, the Max roster).
const offMetaDex = (r) => {
  const listed = new Set([...(r.sortingPiles.find((p) => p.id === "meta")?.card?.rows || []),
    ...(r.sortingPiles.find((p) => p.id === "watchlist")?.card?.rows || [])].map((row) => row.dex));
  return [399, 263, 161, 19, 10, 13].find((d) => !listed.has(d));
};

// name: label · pile(result) → the pile · dex: a member species · base: what
// makes a test Pokémon a member · skipProtected: PROTECTED rows that cannot
// apply to this pile · skipReleasable: RELEASABLE rows the base turns into
// protected ones · lensCases(kw): { lens: { match, miss[, dex] } }, an
// oracle per lens; every lens chain of three or more clauses has one.
// The shared ladder of docs/pile-purposes.md, as oracles. Each `match` is
// built so no earlier step of the ladder takes it: P9 holds every pile to
// "each step finds something no earlier step found" with exactly these.
const LADDER = {
  hundo: { match: iv(15, 15, 15), miss: iv(15, 15, 14) },
  shiny: { match: { flags: { shiny: true }, ...iv(5, 5, 5) }, miss: iv(5, 5, 5) },
  strong: { match: iv(13, 13, 13), miss: iv(15, 15, 7) },
  three: { match: iv(15, 15, 7), miss: iv(12, 12, 12) },
};
const PVP_LOOSE = {
  pvp_great_loose: { match: { ...iv(0, 15, 15), wp: 1400 }, miss: { ...iv(0, 15, 15), wp: 1600 } },
  pvp_ultra_loose: { match: { ...iv(0, 15, 15), wp: 2000 }, miss: { ...iv(0, 15, 15), wp: 2600 } },
};
const EVOLVE = { match: { flags: { canEvolve: true } }, miss: { flags: { canEvolve: false } } };
const HIGH_IV = { match: iv(15, 15, 7), miss: iv(12, 12, 12) };
const withFlag = (c, flag) => ({
  match: { ...c.match, flags: { ...(c.match.flags || {}), [flag]: true } },
  miss: { ...c.match, flags: { ...(c.match.flags || {}), [flag]: false } },
});

// name: label · pile(result) → the pile · dex: a member species · base: what
// makes a test Pokémon a member · skipProtected: PROTECTED rows that cannot
// apply to this pile · skipReleasable: RELEASABLE rows the base turns into
// protected ones · lensCases(kw): { lens: { match, miss[, dex] } }, an
// oracle per lens (P6), each one new against the steps before it (P9).
const PILE_FAMILIES = [
  {
    name: "event spawns",
    piles: (r) => (r.eventFilters || []).map((ev) => ({ pile: ev.pile, dex: ev.spawnDex?.[0] })),
    lensCases: () => LADDER,
  },
  {
    name: "hundo sort",
    piles: (r) => [{ pile: r.hundoPile, dex: 66 }],
    lensCases: () => ({ hundos: LADDER.hundo, shiny: LADDER.shiny, strong: LADDER.strong, three: LADDER.three }),
  },
  {
    name: "meta",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "meta"), dex: RAID_DEX }],
    lensCases: () => ({
      ...LADDER,
      pvp_great: { dex: GREAT_DEX, match: { ...iv(0, 15, 15), wp: 1400 }, miss: { ...iv(0, 15, 15), wp: 1600 } },
    }),
  },
  {
    name: "watchlist",
    piles: (r) => {
      const pile = r.sortingPiles.find((p) => p.id === "watchlist");
      return [{ pile, dex: pile?.card?.rows?.[0]?.dex }];
    },
    lensCases: () => ({ ...LADDER, ...PVP_LOOSE }),
  },
  {
    // Its head is "not any meta or watchlist family", so its member is a
    // species outside all of them and its outsider is a meta species.
    name: "non-meta",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "non_meta"), dex: offMetaDex(r) }],
    outsider: () => ({ dex: RAID_DEX }),
    lensCases: () => ({ ...LADDER, ...PVP_LOOSE }),
  },
  {
    name: "shadows",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "shadows"), dex: offMetaDex(r) }],
    base: { flags: { shadow: true } },
    lensCases: () => ({
      hundo: LADDER.hundo,
      shiny: LADDER.shiny,
      meta: { dex: RAID_DEX, dexMatchOnly: true, match: {}, miss: {} },
      three: LADDER.three,
      atk34: { match: iv(12, 0, 0), miss: iv(5, 15, 15) },
      ...PVP_LOOSE,
      evolve_shadow: EVOLVE,
    }),
  },
  {
    name: "received trades",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "traded"), dex: 129 }],
    base: { flags: { traded: true } },
    skipProtected: YEAR_FLOOR_CASE,
    lensCases: () => ({
      hundo: LADDER.hundo,
      shiny: LADDER.shiny,
      luckies: { match: { flags: { lucky: true } }, miss: {} },
      strong: LADDER.strong,
      three: LADDER.three,
      ...PVP_LOOSE,
      evolve: EVOLVE,
    }),
  },
  {
    name: "luckies",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "luckies"), dex: 129 }],
    base: { flags: { lucky: true, traded: true } },
    skipProtected: YEAR_FLOOR_CASE,
    lensCases: () => ({ evolve: EVOLVE, high_iv: HIGH_IV, shiny: LADDER.shiny }),
  },
  {
    name: "ready to evolve",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "evolve"), dex: 129 }],
    base: { flags: { canEvolve: true } },
    outsider: () => ({ dex: 129, o: { flags: { canEvolve: false } } }),
    // What can still evolve is never a leftover: the pile opts out of ③.
    noRelease: true,
    lensCases: () => ({
      new_dex_hundo: withFlag(LADDER.hundo, "newDexEvo"),
      new_dex_shiny: withFlag(LADDER.shiny, "newDexEvo"),
      new_dex_strong: withFlag(LADDER.strong, "newDexEvo"),
      new_dex_three: withFlag(LADDER.three, "newDexEvo"),
      tagged_evolve: { match: { tags: ["Dex-Evolve"] }, miss: { tags: ["Show"] } },
    }),
  },
  {
    name: "Dynamax",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "dynamax"), dex: offMetaDex(r) }],
    base: DYNA,
    lensCases: () => ({
      gigantamax: { match: { flags: { gigantamaxCapable: true } }, miss: {} },
      builds: { dex: MAX_DEX, dexMatchOnly: true, match: {}, miss: {} },
      ...LADDER,
    }),
  },
  {
    name: "XXL",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "xxl"), dex: 129 }],
    base: { flags: { xxl: true } },
    lensCases: () => ({ evolve: EVOLVE, high_iv: HIGH_IV, shiny: LADDER.shiny }),
  },
  {
    name: "XXS",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "xxs"), dex: 129 }],
    base: { flags: { xxs: true } },
    lensCases: () => ({ evolve: EVOLVE, high_iv: HIGH_IV, shiny: LADDER.shiny }),
  },
  {
    name: "backgrounds",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "backgrounds"), dex: 129 }],
    base: { flags: { background: true } },
    // With a background, a legendary is protected (legendary with a background).
    skipReleasable: /^plain legendary$/,
    lensCases: () => LADDER,
  },
  {
    name: "costumes that evolve",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "costumes_evolve"), dex: 129 }],
    base: { flags: { costume: true, canEvolve: true } },
    outsider: () => ({ dex: 129, o: { flags: { costume: true, canEvolve: false } } }),
    lensCases: () => LADDER,
  },
  {
    name: "costumes that don't evolve",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "costumes_final"), dex: 129 }],
    base: { flags: { costume: true, canEvolve: false } },
    outsider: () => ({ dex: 129, o: { flags: { costume: true, canEvolve: true } } }),
    lensCases: () => LADDER,
  },
  {
    name: "legendaries",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "legendaries"), dex: 150 }],
    base: { flags: { legendary: true } },
    // Every member is legendary, so a shiny one is protected (shiny legendary).
    skipReleasable: /^shiny$/,
    lensCases: () => LADDER,
  },
  {
    // Every Community Day species, shiny or not; the outsider is a species no
    // Community Day featured (Bidoof).
    name: "Community Days",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "cday"), dex: 906 }],
    outsider: () => ({ dex: 399, o: { families: ["bidoof"] } }),
    lensCases: () => ({
      hundo: LADDER.hundo,
      shiny: LADDER.shiny,
      background: { match: { flags: { background: true } }, miss: {} },
      strong: LADDER.strong,
      three: LADDER.three,
      to_trade: { match: {}, miss: { flags: { traded: true } } },
    }),
  },
  {
    // Every shiny: the head is the shiny step, so the ladder has none and ③a
    // shows a plain shiny (P10 keys on the lens, not the pile). A shiny
    // legendary is protected by the tail; the outsider is a Magikarp with
    // the flag off, since the default outsider is shiny and in the pile.
    name: "shinies",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "shiny"), dex: 129 }],
    base: { flags: { shiny: true } },
    outsider: () => ({ dex: 129, o: { flags: { shiny: false } } }),
    skipReleasable: /^plain legendary$/,
    lensCases: () => ({ hundo: LADDER.hundo, strong: LADDER.strong, three: LADDER.three, ...PVP_LOOSE, evolve: EVOLVE }),
  },
];

const BAD = [/undefined/, /NaN/, /\[object /, /&&|,,/, /^[&,]|[&,]$/, /!!/];
// The lenses ③a must negate (P10): every IV or flag step. A hundo step needs
// no `not` (the tail's `!4*` holds it); a species list, PvP pattern, roster,
// tag or "untraded" step narrows nothing. A new IV or flag lens goes here.
const NEEDS_NOT = /^(shiny|strong|three|high_iv|evolve|evolve_shadow|luckies|background|atk34)$/;
// The tail reads protectNundos and mythTooManyOf; P3 runs under the default
// config and under the one that flips both, so a nundo is held on one side
// and shown on the other, and the carved mythical is shown.
const ALT_CFG = { ...CFG, protectNundos: true, mythTooManyOf: ["Darkrai"] };
const P3_CONFIGS = [["default", CFG, pileCases(CFG)], ["nundos protected, Darkrai carved", ALT_CFG, pileCases(ALT_CFG)]];
const localeNames = Object.keys(LOCALES);

for (const fam of PILE_FAMILIES) {
  console.log(`\n${fam.name}`);
  for (const loc of localeNames) {
    const kw = pogoKeywords(loc);
    const tail = protectionTail(kw, CFG, tailOptions(CFG, loc)).join("&");
    const result = buildFilters(HUNDOS, LUCKIES, CFG, [], loc, makeTFn(loc));
    const cases = fam.lensCases?.(kw) || {};
    const entries = fam.piles(result).filter((e) => e.pile);
    const bad = [];
    if (entries.length === 0) bad.push("no pile built");
    // The same piles under the alternate config, by id, for P3.
    const altPiles = new Map(fam.piles(buildFilters(HUNDOS, LUCKIES, ALT_CFG, [], loc, makeTFn(loc))).filter((e) => e.pile).map((e) => [e.pile.id, e.pile]));
    for (const { pile, dex } of entries) {
      const where = pile.id;
      const head = pile.overview;
      // P1
      for (const lens of pile.keep) if (!lens.filter.startsWith(`${head}&`)) bad.push(`${where}.${lens.key}: not head & lens`);
      if (pile.sort !== `${head}&!${kw.flag.favorite}&!#`) bad.push(`${where}: ② is not head & !favourite & !#`);
      if (fam.noRelease) {
        if ("release" in pile || "safe" in pile) bad.push(`${where}: opted out of ③ but carries release or safe`);
      } else {
        if (pile.release !== `${head}&${tail}`) bad.push(`${where}: ③b is not head & tail`);
        if (!pile.safe?.startsWith(`${pile.release}&`)) bad.push(`${where}: ③a does not start with ③b &`);
      }
      // P2
      const steps = [["overview", head], ...pile.keep.map((l) => [l.key, l.filter]), ["sort", pile.sort],
        ...(fam.noRelease ? [] : [["release", pile.release], ["safe", pile.safe]])];
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
      // P3 (a family with no ③ has nothing to hold here)
      for (const [cfgName, cfg, { PROTECTED, RELEASABLE }] of fam.noRelease ? [] : P3_CONFIGS) {
        const under = cfg === CFG ? pile : altPiles.get(pile.id);
        const release = under?.release;
        if (!release) { bad.push(`${where}: no pile under ${cfgName}`); continue; }
        if (release !== `${head}&${protectionTail(kw, cfg, tailOptions(cfg, loc)).join("&")}`) bad.push(`${where} (${cfgName}): ③b is not head & tail`);
        // ③a adds the lenses' `not` clauses, which no setting moves.
        if (under.safe?.slice(release.length) !== pile.safe.slice(pile.release.length)) bad.push(`${where} (${cfgName}): ③a adds different clauses than under the default config`);
        for (const [label, o] of PROTECTED) {
          if (fam.skipProtected?.test(label)) continue;
          const v = verdict(release, o);
          if (v.verdict !== false) bad.push(`${where} ③ (${cfgName}) ${label}: ${v.verdict}${note(v)}`);
        }
        for (const [label, o] of RELEASABLE) {
          if (fam.skipReleasable?.test(label)) continue;
          const v = verdict(release, o);
          if (v.verdict !== true) bad.push(`${where} ③ (${cfgName}) ${label} hidden: ${v.verdict}${note(v)}`);
        }
      }
      // P4
      for (const [label, o, want] of [["starred", { flags: { favorite: true } }, false], ["tagged", { tags: ["Trade"] }, false], ["plain", {}, true]]) {
        const v = verdict(pile.sort, o);
        if (v.verdict !== want) bad.push(`${where} ② ${label}: ${v.verdict}${note(v)}`);
      }
      // P5 — a hundo shiny legendary nobody starred, outside the pile
      const outsider = { families: ["notinthepile"], dex: 0, ivAtk: 15, ivDef: 15, ivHp: 15, flags: { shiny: true } };
      // A family's own outsider when "outside" isn't just another species: a
      // species-restricted head is tested with a member-like Pokémon of a
      // species it doesn't list, a flag head with the flag off.
      const own = fam.outsider?.();
      const outsiderMon = own
        ? pileMon(loc, { ivAtk: 15, ivDef: 15, ivHp: 15, ...(own.o || {}), flags: { shiny: true, ...(own.o?.flags || {}) } },
          own.dex ? pokemonNameFor(String(own.dex), "en") : "Magikarp", own.dex ?? 0)
        : pileMon(loc, outsider, "Magikarp", 0);
      for (const [k, str] of steps) {
        const v = evalFilterDetailed(str, outsiderMon, loc);
        if (v.verdict !== false) bad.push(`${where}.${k} matched a Pokémon outside the pile: ${v.verdict}${note(v)}`);
      }
      // P6
      for (const key of Object.keys(cases)) {
        if (!pile.keep.some((l) => l.key === key)) bad.push(`${where}: the ${key} lens is gone but its oracle is not`);
      }
      for (const lens of pile.keep) {
        const c = cases[lens.key];
        const chain = lens.filter.slice(head.length + 1).split("&").length;
        if (!c) {
          if (!lens.key.startsWith("pvp_cup_")) bad.push(`${where}.${lens.key}: a lens with no oracle`);
          continue;
        }
        const m = verdict(lens.filter, c.match, c.dex ?? dex);
        // `dexMatchOnly`: the oracle's species is the match itself (a roster), so
        // the near miss is the same Pokémon as the pile's own member.
        const x = verdict(lens.filter, c.miss, c.dexMatchOnly ? dex : c.dex ?? dex);
        if (m.verdict !== true) bad.push(`${where}.${lens.key} misses its own kind: ${m.verdict}${note(m)}`);
        if (x.verdict !== false) bad.push(`${where}.${lens.key} matches a near miss: ${x.verdict}${note(x)}`);
      }
      // P9 — every step finds something no earlier step found: its own oracle
      // match is not taken by any step above it.
      pile.keep.forEach((lens, i) => {
        const c = cases[lens.key];
        if (!c) return;
        for (const earlier of pile.keep.slice(0, i)) {
          const v = verdict(earlier.filter, c.match, c.dex ?? dex);
          if (v.verdict === true) bad.push(`${where}.${lens.key} adds nothing: ${earlier.key} already takes its case`);
        }
      });
      // P10 — ③a is the leftovers. Whatever a lens with a `not` keeps gives a
      // definite "no" (its own oracle match, so the `not` is tested with the
      // Pokémon the lens is known to take); a plain dupe is shown, and a shiny
      // is hidden exactly where a shiny lens exists (keyed on the lens, not the
      // pile: a pile without one leaves its shinies to ③a). `canEvolve: false`
      // settles the evolve lens's `not` for the plain rows: a Pokémon that
      // carries no evolve fact leaves it unknown, as the verify panel wants.
      if (!fam.noRelease) {
        for (const lens of pile.keep) {
          if (NEEDS_NOT.test(lens.key) && !lens.not) bad.push(`${where}.${lens.key}: an IV or flag lens with no \`not\`, so ③a would show what it keeps`);
          if (!lens.not) continue;
          const c = cases[lens.key];
          if (!c) { bad.push(`${where}.${lens.key}: a lens with a \`not\` but no oracle`); continue; }
          const v = verdict(pile.safe, c.match, c.dex ?? dex);
          if (v.verdict !== false) bad.push(`${where} ③a shows what ${lens.key} keeps: ${v.verdict}${note(v)}`);
          // On its own, so a wrong `not` cannot hide behind a neighbour's (a
          // 3-4 match is a 3* too): head & not rejects the lens's match and
          // admits its near miss, exactly the lens's complement.
          const alone = `${head}&${lens.not}`;
          const m = verdict(alone, c.match, c.dex ?? dex);
          const x = verdict(alone, c.miss, c.dexMatchOnly ? dex : c.dex ?? dex);
          if (m.verdict !== false) bad.push(`${where}.${lens.key}: its \`not\` still admits what the lens keeps: ${m.verdict}${note(m)}`);
          if (x.verdict !== true) bad.push(`${where}.${lens.key}: its \`not\` hides the lens's near miss: ${x.verdict}${note(x)}`);
        }
        const settle = (o) => ({ ...o, flags: { canEvolve: fam.base?.flags?.canEvolve ?? false, ...(o.flags || {}) } });
        const row = (label) => P3_CONFIGS[0][2].RELEASABLE.find(([l]) => l === label)[1];
        const plain = verdict(pile.safe, settle(row("plain dupe")));
        if (plain.verdict !== true) bad.push(`${where} ③a hides a plain dupe: ${plain.verdict}${note(plain)}`);
        if (!fam.skipReleasable?.test("shiny")) {
          const hasShinyLens = pile.keep.some((l) => l.filter === `${head}&${kw.flag.shiny}`);
          const shiny = verdict(pile.safe, settle(row("shiny")));
          if (shiny.verdict !== !hasShinyLens) bad.push(`${where} ③a ${hasShinyLens ? "shows a shiny despite its shiny lens" : "hides a shiny with no shiny lens"}: ${shiny.verdict}${note(shiny)}`);
        }
      }
    }
    check(`${loc}: ${entries.length} pile(s)`, bad.length === 0, bad.slice(0, 4).join(" | "));
  }
}

console.log("\nThe tail reads exactly protectNundos and mythTooManyOf");
{
  const kw = pogoKeywords("en");
  const tailOf = (cfg, loc = "en") => protectionTail(pogoKeywords(loc), cfg, tailOptions(cfg, loc));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const nundoClause = `1-4${kw.iv.atk},1-4${kw.iv.def},1-4${kw.iv.hp}`;
  const on = tailOf({ ...CFG, protectNundos: true });
  const off = tailOf({ ...CFG, protectNundos: false });
  check("protectNundos on adds the nundo clause, off drops it, and nothing else moves",
    on.includes(nundoClause) && !off.includes(nundoClause) && same(on.filter((c) => c !== nundoClause), off), off.join("&"));
  check("the shipped default protects no nundo (protectNundos is off)", !CFG.protectNundos && !tailOf(CFG).includes(nundoClause));
  // The trash toggles still leave the tail as it is (lucky-trade floor included).
  const toggles = { protectLuckyEligible: true, protectBuddies: false, protectLegacyMoves: false, protectSmeargleLegacy: true, protectMythicals: false, protectShinies: false };
  const flipped = Object.fromEntries(Object.entries(toggles).map(([k, v]) => [k, !v]));
  check("switching the other trash protections on or off leaves the tail as it is (lucky-trade floor included)",
    same(tailOf({ ...CFG, ...toggles }), tailOf({ ...CFG, ...flipped })) && tailOf({ ...CFG, ...toggles }).some((c) => c.startsWith(`${kw.numeric.year}`)));
  // Custom collectibles stay out of the tail (Jesper's call): sorting offers
  // them in ③ like any other species; favourite or tag the ones to keep.
  check("custom collectibles add nothing to the tail", same(tailOf({ ...CFG, customCollectibles: ["Spinda"] }), tailOf(CFG)));
  check("only a year floor of 0 drops the lucky-trade clause",
    !tailOf({ ...CFG, luckyEligibleYear: 0 }).some((c) => c.startsWith(`${kw.numeric.year}`)));
  // The mythical carve: `!mythical,<name>` in the output locale, as the trash
  // spells it; an empty carve is the bare `!mythical`.
  for (const loc of localeNames) {
    const lkw = pogoKeywords(loc);
    const name = pokemonNameFor("809", loc)?.toLowerCase();
    const carved = tailOf({ ...CFG, mythTooManyOf: ["Melmetal"] }, loc);
    const bare = tailOf({ ...CFG, mythTooManyOf: [] }, loc);
    check(`${loc}: mythTooManyOf Melmetal carves \`!${lkw.flag.mythical},${name}\` out of the tail, an empty list leaves \`!${lkw.flag.mythical}\``,
      !!name && carved.includes(`!${lkw.flag.mythical},${name}`) && bare.includes(`!${lkw.flag.mythical}`) && !bare.some((c) => c.startsWith(`!${lkw.flag.mythical},`))
      && same(carved.filter((c) => !c.startsWith(`!${lkw.flag.mythical}`)), bare.filter((c) => !c.startsWith(`!${lkw.flag.mythical}`))),
      carved.find((c) => c.startsWith(`!${lkw.flag.mythical}`)));
    // The legacy-move clause: a Pokémon with a legacy move is held, a Smeargle
    // (every Sketched move carries the flag) is shown, whatever the trash's
    // own Smeargle toggle says.
    const tail = tailOf({ ...CFG, protectSmeargleLegacy: true }, loc).join("&");
    const held = evalFilterDetailed(tail, pileMon(loc, { moves: [], flags: { legacyMove: true } }), loc);
    const smeargle = evalFilterDetailed(tail, pileMon(loc, { moves: [], flags: { legacyMove: true } }, "Smeargle", 235), loc);
    check(`${loc}: the tail holds a legacy move and shows a Smeargle with one`, held.verdict === false && smeargle.verdict === true, `held ${held.verdict}, smeargle ${smeargle.verdict}`);
  }
  // The legendaries pile takes Ultra Beasts too; a plain species stays out.
  for (const loc of localeNames) {
    const pile = buildFilters(HUNDOS, LUCKIES, CFG, [], loc, makeTFn(loc)).sortingPiles.find((p) => p.id === "legendaries");
    const ub = evalFilterDetailed(pile.overview, pileMon(loc, { flags: { ultrabeast: true } }, "Nihilego", 793), loc).verdict;
    const plain = evalFilterDetailed(pile.overview, pileMon(loc, {}, "Magikarp", 129), loc).verdict;
    check(`${loc}: an Ultra Beast is in the legendaries pile, a plain species is not`, ub === true && plain === false, `ub ${ub}, plain ${plain}`);
  }
}

console.log("\nP7 — the pile card");
for (const loc of localeNames) {
  const r = buildFilters(HUNDOS, LUCKIES, CFG, [], loc, makeTFn(loc));
  const bad = [];
  const card = (id) => r.sortingPiles.find((p) => p.id === id)?.card;
  const meta = card("meta")?.rows || [];
  const watch = card("watchlist")?.rows || [];
  if (meta.length === 0 || watch.length === 0) bad.push(`meta ${meta.length} / watchlist ${watch.length} rows`);
  if (meta.some((row) => row.cls !== "meta")) bad.push("a meta-pile row is not meta");
  if (watch.some((row) => row.cls !== "watchlist")) bad.push("a watchlist row is not watchlist");
  const metaSet = new Set(meta.map((row) => row.dex));
  const both = watch.filter((row) => metaSet.has(row.dex)).map((row) => row.name);
  if (both.length) bad.push(`on both lists: ${both.slice(0, 3).join(", ")}`);
  const cards = [...r.sortingPiles.map((p) => [p.id, p.card]), ["hundo", r.hundoPile?.card], ...r.eventFilters.map((ev) => [ev.id, ev.pile?.card])];
  for (const [id, c] of cards) {
    if (!c) { bad.push(`${id}: no card`); continue; }
    const texts = [c.rule, ...(c.rows || []).flatMap((row) => [row.name, row.why, ...row.reasons, ...row.keep])].filter((x) => x != null);
    for (const x of texts) if (/\{\w+\}|^app\.|move\./.test(x)) { bad.push(`${id}: "${x}"`); break; }
    if ((c.rows || []).some((row) => row.keep.length === 0)) bad.push(`${id}: a row with no keep line`);
  }
  for (const id of ["shadows", "traded", "luckies", "dynamax", "xxl", "xxs", "costumes_evolve", "costumes_final", "backgrounds", "legendaries", "cday", "shiny", "non_meta"])
    if (!card(id)?.rule) bad.push(`${id}: no keep rule`);
  check(`${loc}: ${meta.length} meta and ${watch.length} watchlist rows, ${cards.length} cards`, bad.length === 0, bad.slice(0, 4).join(" | "));
}

console.log("\nP8 — budgets");
{
  const rowKeys = BUDGET_ROWS.flatMap((row) => row.keys);
  const unreachable = Object.keys(BUDGET_DEFAULTS).filter((k) => !rowKeys.includes(k));
  const unknown = rowKeys.filter((k) => !(k in BUDGET_DEFAULTS));
  check(`${BUDGET_ROWS.length} budget rows cover all ${Object.keys(BUDGET_DEFAULTS).length} budgets`,
    unreachable.length === 0 && unknown.length === 0, [...unreachable, ...unknown].join(", "));
  for (const loc of localeNames) {
    const t = makeTFn(loc);
    const bad = [];
    for (const row of BUDGET_ROWS) {
      const label = t(`app.budget.${row.job}.label`);
      const rule = t(`app.budget.${row.job}.rule`, { params: BUDGET_DEFAULTS });
      if (label.startsWith("app.") || rule.startsWith("app.") || /\{\w+\}/.test(rule)) bad.push(`${row.job}: "${rule.slice(0, 50)}"`);
      // English fallback would hide a missing translation
      if (loc !== "en" && LOCALES[loc].messages[`app.budget.${row.job}.rule`] === undefined) bad.push(`${row.job}: not translated`);
    }
    check(`${loc}: every budget row renders`, bad.length === 0, bad.slice(0, 3).join(" | "));
  }
  const keepOf = (cfg) => {
    const r = buildFilters(HUNDOS, LUCKIES, cfg, [], "en", makeTFn("en"));
    return r.sortingPiles.find((p) => p.id === "meta").card.rows.find((row) => row.cls === "meta" && row.keep.length)?.keep[0] || "";
  };
  const overridden = { ...CFG, budgets: { raidMeta: 4 } };
  check("simple mode uses the default budgets", keepOf({ ...overridden, expertMode: false }).includes("6"));
  check("expert mode uses the overrides", keepOf({ ...overridden, expertMode: true }).includes("4"));
  const merged = mergeImportedConfig({ budgets: { raidMeta: -1, xxlScore: "a", pvpNormal: 2, futureJob: 5, standIn: 1.5 } }).budgets;
  check("import keeps whole numbers ≥ 0, unknown keys included, and drops the rest",
    JSON.stringify(merged) === JSON.stringify({ pvpNormal: 2, futureJob: 5 }), JSON.stringify(merged));
  check("a config without budgets merges to no overrides", JSON.stringify(mergeImportedConfig({}).budgets) === "{}");
}

console.log("\nTagging scheme");
{
  const defaults = Object.values(jobTagsOf(mergeImportedConfig({})));
  for (const loc of localeNames) {
    const bad = defaults.flatMap((tag) => {
      const c = tagClashes(tag, defaults, loc);
      return [c.keyword && `#${tag} is a keyword`, c.prefixOf.length && `#${tag} prefixes #${c.prefixOf.join(", #")}`].filter(Boolean);
    });
    check(`${loc}: no suggested tag is a search keyword or prefixes another`, bad.length === 0, bad.join(" | "));
  }
  check("the clash check sees a keyword (#shiny, #Raid in en and de)",
    tagClashes("shiny", [], "en").keyword && tagClashes("Raid", [], "en").keyword && tagClashes("Raid", [], "de").keyword);
  check("the clash check sees a prefix (#Trade finds #Trade-Julia)",
    tagClashes("Trade", ["Trade-Julia", "PvP"], "en").prefixOf.join() === "Trade-Julia");
  check("tradebait is basarTagName, promised is not a stored tag",
    jobTagsOf({ basarTagName: "Tausch-Basar" }).trade === "Tausch-Basar" && !("promised" in JOB_TAG_DEFAULTS));
  const merged = mergeImportedConfig({ jobTags: { pvp: " #Kolosseum ", raid: "", show: 5 } }).jobTags;
  check("import keeps renamed tags without #, drops empty or non-text ones", JSON.stringify(merged) === JSON.stringify({ pvp: "Kolosseum" }), JSON.stringify(merged));
  for (const loc of localeNames) {
    const missing = JOB_TAG_ORDER.filter((j) => loc !== "en" && LOCALES[loc].messages[`app.tags.${j}.label`] === undefined);
    check(`${loc}: every job's tag row is translated`, missing.length === 0, missing.join(", "));
  }
}

console.log("\nShowcase score (XXL calculator)");
{
  const c = SPECIES_META.showcase?.coefficients;
  check("coefficients come from the game master's CONTEST_SETTINGS (800 / 150 / 50)",
    c?.height === 800 && c?.weight === 150 && c?.iv === 50, JSON.stringify(c));
  // Squirtle, mean 0.5 m / 9 kg: the biggest 1.55-class XXL with a perfect appraisal.
  const top = showcaseScoreRange({ dex: 7, heightM: 0.775, weightKg: 18.45, ivs: [15, 15, 15] });
  check("a maximal XXL's range tops out at exactly the single-species maximum of 1,178", top?.fits && top.min <= 1178 && top.max === 1178, JSON.stringify(top));
  const plain = showcaseScoreRange({ dex: 7, heightM: 0.775, weightKg: 18.45, ivs: [15, 15, 15], xxl: false });
  check(`the XXL bonus is ${SHOWCASE_XXL_BONUS}, both ends`, top.min - plain.min === SHOWCASE_XXL_BONUS && top.max - plain.max === SHOWCASE_XXL_BONUS);
  // Within the same classes, taller scores higher. (Across a class boundary the
  // range's top can drop: a size that outgrows a class loses its higher score.)
  const tall = showcaseScoreRange({ dex: 7, heightM: 0.9, weightKg: 15, ivs: [10, 10, 10] });
  const taller = showcaseScoreRange({ dex: 7, heightM: 0.95, weightKg: 15, ivs: [10, 10, 10] });
  check("taller scores higher within the same size classes",
    JSON.stringify(tall.classes) === JSON.stringify(taller.classes) && taller.min > tall.min && taller.max > tall.max,
    `${JSON.stringify(tall)} → ${JSON.stringify(taller)}`);
  check("a size bigger than every class does not fit", showcaseScoreRange({ dex: 7, heightM: 1.2, weightKg: 9 })?.fits === false);
  check("a class the size has outgrown is dropped (0.80 m Squirtle: not 1.55)",
    JSON.stringify(showcaseScoreRange({ dex: 7, heightM: 0.8, weightKg: 16.54 }).classes) === JSON.stringify([1.75, 2]));
  check("an unknown species or missing size gives no score", showcaseScoreRange({ dex: 99999, heightM: 1, weightKg: 1 }) === null && showcaseScoreRange({ dex: 7, heightM: 0, weightKg: 9 }) === null);
  for (const loc of localeNames) {
    const missing = ["title", "result", "verdict_keep", "verdict_below", "verdict_maybe", "hint"].filter((k) => loc !== "en" && LOCALES[loc].messages[`app.xxl.${k}`] === undefined);
    check(`${loc}: the calculator is translated`, missing.length === 0, missing.join(", "));
  }
}

console.log("\nWhich piles show first (event-driven ordering)");
{
  const now = Date.parse("2026-11-10T12:00:00Z");
  const day = 86400000;
  const iso = (ms) => new Date(ms).toISOString();
  const span = (startDays, endDays) => ({ start: iso(now + startDays * day), end: iso(now + endDays * day) });
  const ids = (data) => floatingPiles(data, now).map((f) => f.pile).join(",");
  check("a running takeover floats shadows", ids({ signals: [{ kind: "takeover", title: "T", ...span(-1, 2) }] }) === "shadows");
  check("a Community Day ended 3 days ago floats its backgrounds and the shinies",
    ids({ signals: [{ kind: "community_day", title: "CD", ...span(-3.2, -3) }] }) === "cday,shiny");
  check(`one ended more than ${FLOAT_ENDED_DAYS} days ago floats nothing`,
    ids({ signals: [{ kind: "community_day", title: "CD", ...span(-10.2, -10) }] }) === "");
  check("an upcoming Max Monday floats nothing, a running one floats Dynamax",
    ids({ eventMaxBattles: [{ name: "Max Monday", ...span(1, 1.5) }] }) === "" &&
    ids({ eventMaxBattles: [{ name: "Max Monday", ...span(-0.1, 0.4) }] }) === "dynamax");
  check("a wild-spawn event floats its spawns, plus costumes when it had costumed spawns",
    ids({ events: [{ title: "E", category: "Event", hasCostumes: true, ...span(-2, -1) }] }) === "event_spawns,costumes_evolve,costumes_final" &&
    ids({ events: [{ title: "E", category: "Event", hasCostumes: false, ...span(-2, -1) }] }) === "event_spawns");
  check("a pile floats once however many events name it",
    ids({ signals: [{ kind: "takeover", title: "A", ...span(-1, 1) }, { kind: "takeover", title: "B", ...span(-2, 1) }] }) === "shadows");
  // The fetcher side: which feed entries become signals, and the costume flag.
  const feed = {
    Event: [{ title: "Harvest Festival: Taken Over", start_time: "2026-10-02T00:00:00", end_time: "2026-10-05T00:00:00", details: {} }],
    "Community Day": [{ title: "Pawniard Community Day", start_time: "2026-11-21T14:00:00", end_time: "2026-11-21T17:00:00", details: {} }],
    "Raid Hour": [{ title: "Raid Hour", start_time: "2026-11-04T18:00:00", end_time: "2026-11-04T19:00:00", details: {} }],
  };
  check("the feed's takeover and Community Day become signals, a raid hour doesn't",
    signalsFromFeed(feed).map((x) => x.kind).sort().join(",") === "community_day,takeover");
  check("a costumed spawn is spotted, plain ones aren't",
    hasCostumedSpawns([{ name: "Piplup wearing a Halloween Mischief costume" }]) && !hasCostumedSpawns(["Zubat", { name: "Gengar" }]));
}

console.log("\nProtection toggles hide and show piles (edge-triggered, stateful)");
{
  // A protect* boolean's on/off edge edits config.hiddenPiles once; between
  // edges the user's own hide/unhide is the truth (withPileTransitions).
  const ON = Object.fromEntries(["protectXXL", "protectXXS", "protectCostumes", "protectBackgrounds", "protectLuckies", "protectShinies", "protectShadows", "protectDynamax", "protectLegendaries", "protectUltraBeasts"].map((k) => [k, true]));
  const flip = (patch) => hiddenPileTransitions(ON, { ...ON, ...patch });
  const same = (t, hide, show) => t.hide.join(",") === hide && t.show.join(",") === show;
  check("no change touches nothing", same(hiddenPileTransitions(ON, ON), "", "") && same(hiddenPileTransitions(ON, { ...ON }), "", ""));
  check("XXL on→off hides xxl", same(flip({ protectXXL: false }), "xxl", ""));
  check("XXL off→on shows xxl", same(hiddenPileTransitions({ ...ON, protectXXL: false }, ON), "", "xxl"));
  check("legendaries off with Ultra Beasts still on changes nothing", same(flip({ protectLegendaries: false }), "", ""));
  check("both off hides legendaries", same(flip({ protectLegendaries: false, protectUltraBeasts: false }), "legendaries", ""));
  const bothOff = { ...ON, protectLegendaries: false, protectUltraBeasts: false };
  check("either back on shows legendaries",
    same(hiddenPileTransitions(bothOff, { ...bothOff, protectLegendaries: true }), "", "legendaries") &&
    same(hiddenPileTransitions(bothOff, { ...bothOff, protectUltraBeasts: true }), "", "legendaries"));
  check("shadows on→off hides shadows, Dynamax on→off hides dynamax", same(flip({ protectShadows: false }), "shadows", "") && same(flip({ protectDynamax: false }), "dynamax", ""));
  check("costumes on→off hides both costume piles", same(flip({ protectCostumes: false }), "costumes_evolve,costumes_final", ""));
  check("a non-protect key change is not an edge", same(hiddenPileTransitions(ON, { ...ON, pvpMode: "loose", hiddenPiles: ["xxl"] }), "", ""));
  const allOff = Object.fromEntries(Object.keys(ON).map((k) => [k, false]));
  const everything = hiddenPileTransitions(ON, allOff);
  const groupIds = PILE_GROUPS.flatMap((g) => g.piles);
  check("every id returned is in PILE_GROUPS, so it can be un-hidden", everything.hide.length === 10 && everything.hide.every((id) => groupIds.includes(id)) && everything.show.length === 0, everything.hide.join(","));
  check("no category names a pile without one", !everything.hide.some((id) => /^(meta|watchlist|non_meta|hundo|cday|traded|evolve|event)/.test(id)));
  check("the mapping covers every protect* key that has a pile, and the pair", Object.keys(PROTECTION_PILES).length === 8 && !("protectLegendaries" in PROTECTION_PILES) && !("protectUltraBeasts" in PROTECTION_PILES));
  // The config edit: an edge adds to or removes from the persisted list and
  // keeps what the user hid themselves; no edge hands the same object back.
  const kept = { ...ON, hiddenPiles: ["meta"] };
  const hidden = withPileTransitions(kept, { ...kept, protectXXL: false });
  check("an off edge adds to the user's own list", hidden.hiddenPiles.join(",") === "meta,xxl");
  const unhidden = withPileTransitions(hidden, { ...hidden, protectXXL: true });
  check("an on edge removes only its own piles", unhidden.hiddenPiles.join(",") === "meta");
  const stillOff = { ...hidden, hiddenPiles: ["meta"] };
  const plain = { ...stillOff, pvpMode: "loose" };
  check("with no edge the list is the user's, untouched (same object back)", withPileTransitions(stillOff, plain) === plain && plain.hiddenPiles.join(",") === "meta");
  check("an off edge never doubles an id already hidden", withPileTransitions({ ...ON, hiddenPiles: ["xxl"] }, { ...ON, hiddenPiles: ["xxl"], protectXXL: false }).hiddenPiles.join(",") === "xxl");
  check("mergeImportedConfig still keeps hiddenPiles as strings", mergeImportedConfig({ ...CFG, hiddenPiles: ["xxl", 3, null] }).hiddenPiles.join(",") === "xxl");
  // The app routes every protect* write through one setter.
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const app = src.slice(src.indexOf("export default function App("), src.indexOf("function ConfigPanel("));
  check("ConfigPanel and the swipe deck write through setConfigWithPiles",
    (app.match(/setConfig: setConfigWithPiles|setConfig=\{setConfigWithPiles\}/g) || []).length >= 2 && /setConfigWithPiles\(\(prev\) => \(\{ \.\.\.prev, \.\.\.patch/.test(app));
  check("no ConfigPanel is handed the raw setter", !/<ConfigPanel[^>]*setConfig=\{setConfig\}/.test(app) && !/setConfig,\n\t\thomeLocals/.test(app));
}

console.log("\nwatch-moves.json is never rebuilt from a refused game master");
{
  // A dump in the shape extractPveMoves reads, one move template per entry.
  const dumpOf = (ids) => ids.map((id) => ({ templateId: id, data: { moveSettings: GM_WATCH.pveMoves[id] } }));
  const allIds = Object.keys(GM_WATCH.pveMoves);
  let refused = null;
  try { acceptPveDump(dumpOf(allIds.slice(0, 10)), "truncated mirror", GM_WATCH.pveMoves); } catch (e) { refused = e; }
  check("a truncated dump is refused, so no templates reach the watchlist", refused && /refusing to overwrite/.test(refused.message), refused?.message);
  let empty = null;
  try { acceptPveDump([], "empty mirror", {}); } catch (e) { empty = e; }
  check("an empty dump is refused even with no previous snapshot", !!empty);
  const ok = acceptPveDump(dumpOf(allIds), "full mirror", GM_WATCH.pveMoves);
  check("a full dump is accepted with its templates", Object.keys(ok.pveMoves).length === allIds.length && ok.templates.length === allIds.length);
  // Why it matters: learners read from an empty movepool drop every signature move.
  const hollow = watchMovesFrom(GM_WATCH.history, learnersOf([], GM_WATCH.history.flatMap((h) => h.changes.map((c) => c.move))));
  const lost = WATCH_MOVES.moves.filter((m) => m.change === "changed" && !hollow.some((x) => x.move === m.move && x.at === m.at));
  check(`a refused dump would have cost ${lost.length} signature move(s)`, lost.length > 0, lost.map((m) => m.move).join(", "));
}

console.log("\nDeep-review regressions");
{
  // 1. A capless league (a Master League cup) gets no PvP keeper lens; every
  //    capped one carries its CP cap and the loose IV pattern.
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-11-05T12:00:00Z");
  let lenses;
  try {
    lenses = buildFilters(HUNDOS, LUCKIES, CFG, [], "en", makeTFn("en")).sortingPiles.find((p) => p.id === "meta").keep;
  } finally { Date.now = realNow; }
  const kwEn = pogoKeywords("en");
  const pvpLenses = lenses.filter((l) => l.key.startsWith("pvp_"));
  check("no keeper lens for a capless cup (mega-10000 is active on 2026-11-05)", !pvpLenses.some((l) => l.key === "pvp_cup_mega-10000"), pvpLenses.map((l) => l.key).join(", "));
  check("every PvP lens carries a CP cap and the IV pattern",
    pvpLenses.length > 1 && pvpLenses.every((l) => l.filter.includes(`${kwEn.numeric.cp}-`) && l.filter.includes(`0-1${kwEn.iv.atk}`)), pvpLenses.map((l) => l.key).join(", "));

  // 2. A PvE-stream move id resolves to its learners.
  const tpl = (dex, id, moves) => ({ templateId: `V${String(dex).padStart(4, "0")}_POKEMON_${id}`, data: { templateId: `V${String(dex).padStart(4, "0")}_POKEMON_${id}`, pokemonSettings: { pokemonId: id, cinematicMoves: moves } } });
  const learned = learnersOf([tpl(386, "DEOXYS", ["PSYCHO_BOOST"])], ["V0288_MOVE_PSYCHO_BOOST"]);
  check("a PvE move id (V0288_MOVE_PSYCHO_BOOST) finds its learners", JSON.stringify(learned.V0288_MOVE_PSYCHO_BOOST) === "[386]", JSON.stringify(learned));

  // 4. A Max Monday floats Dynamax for days after it ends.
  const maxFeed = { "Max Mondays": [{ title: "Dynamax Machop during Max Monday", start_time: "2026-11-02T06:00:00", end_time: "2026-11-02T21:00:00", details: {} }] };
  const maxSignal = signalsFromFeed(maxFeed);
  check("the feed's Max Monday becomes a max signal", maxSignal.length === 1 && maxSignal[0].kind === "max");
  check("Dynamax still floats two days after the Max Monday",
    floatingPiles({ signals: maxSignal }, Date.parse("2026-11-04T20:00:00")).some((f) => f.pile === "dynamax"));

  // 3. Form sizes: an average-size Pumpkaboo XXL fits once its form is picked.
  const avgPumpkaboo = { dex: 710, heightM: 0.75, weightKg: 10, ivs: [10, 10, 10] };
  check("an average Pumpkaboo XXL (0.75 m) fits as AVERAGE, not against the SMALL default",
    showcaseScoreRange({ ...avgPumpkaboo, form: "AVERAGE" })?.fits === true && showcaseScoreRange(avgPumpkaboo)?.fits === false);
  check("Alolan Marowak is scored against its own mean weight",
    showcaseScoreRange({ dex: 105, form: "ALOLA", heightM: 1.8, weightKg: 60, ivs: [15, 15, 15] }).max >
    showcaseScoreRange({ dex: 105, heightM: 1.8, weightKg: 60, ivs: [15, 15, 15] }).max);

  // Card class follows the pile: a trimmed raid roster stops reading as meta.
  const trimmed = { ...CFG, topAttackers: DEFAULT_TOP_ATTACKERS.slice(0, 10) };
  const dropped = resolveSpeciesInfo(DEFAULT_TOP_ATTACKERS[60])?.dex;
  const tr = buildFilters(HUNDOS, LUCKIES, trimmed, [], "en", makeTFn("en"));
  const rows = tr.sortingPiles.flatMap((p) => p.card?.rows || []).concat(tr.eventFilters.flatMap((ev) => ev.pile?.card?.rows || []));
  const metaRows = new Set(tr.sortingPiles.find((p) => p.id === "meta").card.rows.map((r) => r.dex));
  check("after trimming the roster, no card calls a species meta unless the meta pile holds it",
    rows.every((r) => r.cls !== "meta" || metaRows.has(r.dex)) && !rows.some((r) => r.dex === dropped && r.cls === "meta" && !metaRows.has(dropped)));

  // The generic @move branch leaves slot forms and move types unknown.
  const withMoves = pileMon("en", { moves: ["frustration"] });
  check("@1mudshot and @ground stay unknown on a Pokémon with moves; a named move answers",
    evalDetailed("@1mudshot", withMoves, "en").verdict === null && evalDetailed("@ground", withMoves, "en").verdict === null &&
    evalDetailed("@frustration", withMoves, "en").verdict === true);
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
  // A day goes in only when every featured name resolves; otherwise it is held
  // back for the fetcher to fail the sync on, and added in full later.
  const known = { pawniard: 624, deino: 633, gible: 443 };
  const resolve = (featured) => {
    const names = featured.map((f) => (typeof f === "string" ? f : f.name));
    return {
      spawnDex: names.map((n) => known[n.toLowerCase()]).filter(Boolean),
      unresolved: names.filter((n) => !known[n.toLowerCase()]),
    };
  };
  const day = (title, features) => ({ title, start_time: "2026-12-12T14:00:00", details: { features } });
  const { days, unresolved } = communityDaysFromFeed({
    "Community Day": [
      day("Pawniard Community Day", [{ name: "Pawniard" }]),
      day("December Community Day 2026", [{ name: "Deino" }, { name: "Newmon" }]),
      day("Mystery Community Day", []),
    ],
    Event: [day("Spotlight Hour", [{ name: "Gible" }])],
  }, resolve);
  check("a fully resolved Community Day is added", days.length === 1 && days[0].dex[0] === 624);
  check("a half-resolved day is held back with its unresolved names, not added half",
    unresolved.some((cd) => cd.event === "December Community Day 2026" && cd.names.join() === "Newmon") &&
    !days.some((cd) => cd.event === "December Community Day 2026"));
  check("a day listing no featured Pokémon is held back too",
    unresolved.some((cd) => cd.event === "Mystery Community Day" && cd.names.length === 0));
  check("events not named as a Community Day are ignored", !days.concat(unresolved).some((cd) => cd.event === "Spotlight Hour"));
}

console.log("\nEvery pile's wording exists in every locale");
{
  // PileSteps falls back to app.pile.lens.<key>_label/_hint unless a lens
  // brings its own `text`; i18n returns the raw key for one that is missing
  // in both the locale and en, so a missing key shows up on screen as-is.
  // The hundo and event piles' own tables override their overview words.
  for (const loc of localeNames) {
    const r = buildFilters(HUNDOS, LUCKIES, CFG, [], loc, makeTFn(loc));
    const msgs = LOCALES[loc].messages;
    const missing = new Set();
    const need = (k) => { if (msgs[k] === undefined) missing.add(k); };
    const piles = [...r.sortingPiles, r.hundoPile, ...r.eventFilters.map((ev) => ev.pile)].filter(Boolean);
    for (const pile of piles) {
      for (const lens of pile.keep) {
        const [label, hint] = lens.text || [`app.pile.lens.${lens.key}_label`, `app.pile.lens.${lens.key}_hint`];
        need(label);
        need(hint);
      }
      for (const x of pile.extras || []) { need(x.label); need(x.hint); }
    }
    for (const pile of r.sortingPiles) {
      need(`app.pile.${pile.id}.title`);
      need(`app.pile.${pile.id}.hint`);
      need(`app.sort.hook.${pile.id}`);
    }
    // Step ③'s two boxes and the reveal between them read fixed keys
    // (PILE_TEXT_DEFAULTS / EVENT_PILE_TEXT), so they are named here rather
    // than derived from a pile.
    for (const k of [
      "app.pile.safe_label", "app.pile.safe_hint", "app.events.safe_hint",
      "app.pile.release_label", "app.pile.release_hint", "app.events.release_hint",
      "app.pile.release_reveal", "app.pile.release_warning",
    ]) need(k);
    check(`${loc}: every step, title, hint and hook has its words`, missing.size === 0, [...missing].slice(0, 5).join(", "));
  }
}

console.log("\nStep ③ renders the leftovers before the reveal");
{
  // ③a (pile.safe) is the visible transfer box; ③b (pile.release) is wider,
  // so it sits behind a disclosure that states its open/closed state and
  // carries a warning. Source-level, like the Mega planner check below: the
  // order and the nesting are what a reader of the screen relies on.
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const steps = src.slice(src.indexOf("function PileSteps("), src.indexOf("function MegaPlanner("));
  const safeAt = steps.indexOf("box('safe', words.safe, pile.safe)");
  const releaseAt = steps.indexOf("box('release', words.release, pile.release");
  const toggleAt = steps.search(/aria-expanded=\{reveal\}\s*\n\s*aria-controls=\{revealId\}/);
  const panelAt = steps.indexOf("id={revealId}");
  check("PileSteps renders pile.safe", safeAt !== -1);
  check("PileSteps renders pile.release", releaseAt !== -1);
  check("pile.safe comes before pile.release", safeAt !== -1 && safeAt < releaseAt);
  check("the reveal control states aria-expanded and aria-controls", toggleAt !== -1 && toggleAt < releaseAt);
  check("pile.release sits inside the reveal's panel", panelAt !== -1 && toggleAt < panelAt && panelAt < releaseAt);
  check("the reveal is named by its own key", steps.indexOf("t('app.pile.release_reveal')") > toggleAt);
  check("the warning precedes the ③b box", steps.indexOf("t('app.pile.release_warning')") > panelAt
    && steps.indexOf("t('app.pile.release_warning')") < releaseAt);
  check("the warning is not a live region", !/role='status'/.test(steps));
  check("the reveal starts closed on every mount", /useState\(false\)/.test(steps));
  check("the ③b hint renders in the warn tone", /box\('release', words\.release, pile\.release, 'warn'\)/.test(steps));
  const fb = src.slice(src.indexOf("function FilterBox("), src.indexOf("function AreaTabs("));
  check("FilterBox takes a tone and colours the hint amber", /tone === 'warn'/.test(fb) && /#F5B82E/.test(fb));
}

console.log("\nMega-evolve placement");
{
  // Mega-evolving spends candy, so its filter has its own tile under Sorting's
  // "Evolve & grind", and the Mega planner under Catching does not carry it.
  const evolve = PILE_GROUPS.find((g) => g.id === "evolve");
  check("the evolve group carries the mega-evolve tool", (evolve?.tools || []).includes("mega_evolve"));
  check("no other group carries it", PILE_GROUPS.filter((g) => (g.tools || []).includes("mega_evolve")).length === 1);
  for (const loc of localeNames) {
    const r = buildFilters(HUNDOS, LUCKIES, CFG, [], loc, makeTFn(loc));
    check(`${loc}: the mega-evolve filter is built`, !!r.megaEvolve && r.megaEvolve.startsWith(pogoKeywords(loc).flag.mega_evolve));
  }
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const planner = src.slice(src.indexOf("function MegaPlanner("), src.indexOf("function MegaBoostPanel("));
  check("the Mega planner renders no mega-evolve filter", !/megaEvolve|mega_evolve/.test(planner));
}

console.log(`\n${failures === 0 ? "✓ All pile checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
