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
//   P7 — the pile card: meta rows are meta, watchlist rows watchlist, the two
//        never overlap, every row says how many to keep, and no rendered
//        string is a raw key or keeps a {placeholder}, in any locale
//   P8 — budgets: every budget is reachable through a row of the spec's
//        table, every row's rule renders in every locale, simple mode uses
//        the defaults, expert mode the overrides, and the import merge keeps
//        only whole numbers ≥ 0
//
// PILE_FAMILIES is the registry: a new pile adds one entry naming where its
// piles come from and which species is in it, and inherits every check.
//
// Run with: npx vite-node scripts/check-piles.mjs

import {
  BUDGET_DEFAULTS, BUDGET_ROWS, evalFilterDetailed as evalDetailed, FLOAT_ENDED_DAYS, floatingPiles, SHOWCASE_XXL_BONUS, showcaseScoreRange, JOB_TAG_DEFAULTS, JOB_TAG_ORDER, jobTagsOf, tagClashes, buildFilters, COMMUNITY_DAY_BG_DEX, mergeImportedConfig, DEFAULT_TOP_ATTACKERS, DEFAULT_TOP_MAX_ATTACKERS, evalFilterDetailed, protectionTail, SEARCH_CHAR_BUDGET,
} from "../src/App.jsx";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";
import COMMUNITY_DAYS from "../src/data/community-days.json";
import SPECIES_META from "../src/data/species-meta.json";
import {
  LEGACY_COMMUNITY_DAYS, LEGACY_THROUGH, communityDayBackgroundDex, mergeRollingCommunityDays,
} from "./lib/community-days.mjs";
import { resolveSpeciesInfo } from "../src/data/species.js";
import { LOCALES } from "../src/i18n/index.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { pokemonNameFor } from "../src/data/species.js";
import { FIXTURE_CONFIG, makeTFn } from "./lib/fixture.mjs";
import { pileCases, pileMon } from "./lib/pile-cases.mjs";
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
    lensCases: () => ({
      hundos: { match: iv(15, 15, 15), miss: iv(15, 15, 14) },
      // Machop's family is done twice; the lens is the family list itself.
      done_twice: { match: {}, miss: { families: ["notdonetwice"] } },
    }),
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
    name: "watchlist",
    piles: (r) => {
      const pile = r.sortingPiles.find((p) => p.id === "watchlist");
      return [{ pile, dex: pile?.card?.rows?.[0]?.dex }];
    },
    lensCases: () => ({
      shadow: { match: { flags: { shadow: true } }, miss: {} },
      high_iv: { match: iv(15, 15, 13), miss: iv(5, 5, 5) },
    }),
  },
  {
    // Its head is "not any meta or watchlist family", so its member is a
    // species outside all of them and its outsider is a meta species.
    name: "non-meta",
    piles: (r) => {
      const pile = r.sortingPiles.find((p) => p.id === "non_meta");
      const listed = new Set([...(r.sortingPiles.find((p) => p.id === "meta")?.card?.rows || []),
        ...(r.sortingPiles.find((p) => p.id === "watchlist")?.card?.rows || [])].map((row) => row.dex));
      const dex = [399, 263, 161, 19, 10, 13].find((d) => !listed.has(d));
      return [{ pile, dex }];
    },
    outsider: () => ({ dex: RAID_DEX }),
    lensCases: () => ({
      souvenirs: { match: { flags: { shiny: true } }, miss: {} },
      high_iv: { match: iv(15, 15, 13), miss: iv(5, 5, 5) },
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
    lensCases: () => ({
      souvenirs: { match: { flags: { costume: true } }, miss: {} },
      luckies: { match: { flags: { lucky: true } }, miss: {} },
      // The trash filter's own verdict: a traded 1/1/1 dupe is in, a traded hundo is not.
      trash_review: { match: iv(1, 1, 1), miss: iv(15, 15, 15) },
    }),
  },
  {
    name: "luckies",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "luckies"), dex: 129 }],
    base: { flags: { lucky: true, traded: true } },
    skipProtected: YEAR_FLOOR_CASE,
    lensCases: () => ({ high_iv: { match: iv(15, 15, 13), miss: iv(5, 5, 5) } }),
  },
  {
    name: "lucky families",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "lucky_families"), dex: 133 }],
    lensCases: () => ({ luckies: { match: { flags: { lucky: true } }, miss: {} } }),
  },
  {
    name: "ready to evolve",
    piles: (r) => [{ pile: r.sortingPiles.find((p) => p.id === "evolve"), dex: 129 }],
    base: { flags: { canEvolve: true } },
    outsider: () => ({ dex: 129, o: { flags: { canEvolve: false } } }),
    lensCases: () => ({
      new_dex: { match: { flags: { newDexEvo: true } }, miss: {} },
      tagged_evolve: { match: { tags: ["Dex-Evolve"] }, miss: { tags: ["Show"] } },
    }),
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
    // A special background on a species no Community Day featured (Bidoof).
    outsider: () => ({ dex: 399, o: { families: ["bidoof"], flags: { specialBackground: true } } }),
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
    const result = buildFilters(HUNDOS, LUCKIES, CFG, [], loc, makeTFn(loc));
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

console.log("\nThe tail ignores the trash toggles");
{
  const kw = pogoKeywords("en");
  const on = protectionTail(kw, { ...CFG, protectLuckyEligible: true, protectNundos: false, protectBuddies: false });
  const off = protectionTail(kw, { ...CFG, protectLuckyEligible: false, protectNundos: true, protectBuddies: true });
  check("switching trash protections on or off leaves the tail as it is (lucky-trade floor included)",
    JSON.stringify(on) === JSON.stringify(off) && on.some((c) => c.startsWith(`${kw.numeric.year}`)), off.join("&"));
  check("only a year floor of 0 drops the lucky-trade clause",
    !protectionTail(kw, { ...CFG, luckyEligibleYear: 0 }).some((c) => c.startsWith(`${kw.numeric.year}`)));
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
  for (const id of ["shadows", "traded", "luckies", "dynamax", "xxl", "xxs", "costumes", "cd_backgrounds", "non_meta"])
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
  check("a Community Day ended 3 days ago floats its backgrounds",
    ids({ signals: [{ kind: "community_day", title: "CD", ...span(-3.2, -3) }] }) === "cd_backgrounds");
  check(`one ended more than ${FLOAT_ENDED_DAYS} days ago floats nothing`,
    ids({ signals: [{ kind: "community_day", title: "CD", ...span(-10.2, -10) }] }) === "");
  check("an upcoming Max Monday floats nothing, a running one floats Dynamax",
    ids({ eventMaxBattles: [{ name: "Max Monday", ...span(1, 1.5) }] }) === "" &&
    ids({ eventMaxBattles: [{ name: "Max Monday", ...span(-0.1, 0.4) }] }) === "dynamax");
  check("a wild-spawn event floats its spawns, plus costumes when it had costumed spawns",
    ids({ events: [{ title: "E", category: "Event", hasCostumes: true, ...span(-2, -1) }] }) === "event_spawns,costumes" &&
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
}

console.log("\nPile extras");
for (const loc of localeNames) {
  const r = buildFilters(HUNDOS, LUCKIES, CFG, [], loc, makeTFn(loc));
  const extras = r.sortingPiles.find((p) => p.id === "evolve")?.extras || [];
  // Mega-evolving is spending candy, so it sits with the evolve pile, not
  // with the Mega planner under Catching.
  check(`${loc}: the evolve pile carries the mega-evolve filter`,
    extras.some((x) => x.key === "mega_evolve" && x.filter === r.megaEvolve && r.megaEvolve));
}

console.log(`\n${failures === 0 ? "✓ All pile checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
