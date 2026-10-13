// Property checks for the filter families that are projections of daily-synced
// data: raid + max-battle counters, Team Rocket counters, PvP cup filters.
// Run with: npx vite-node scripts/check-data-filters.mjs
//
// These are deliberately NOT in the exact-pinned fixture. A snapshot of a value
// that changes every day cannot tell "the boss rotation moved" from "the
// counter logic broke" — the sync regenerates it in the same job, so it always
// heals and nobody reviews it. 17 of the last 20 commits touching the fixture
// were automated syncs, one rewriting 126 lines.
//
// So assert PROPERTIES that hold whatever the data says:
//   D1 — every clause is well formed (no undefined/NaN, no dangling separators)
//   D2 — every boss/leader/cup in the data produces a clause (no silent drops)
//   D3 — all 7 locales produce the same key set (no locale-specific gaps)
//   D4 — non-English locales actually localize (no silent English fallback)
//   D5 — empty filter families are reported, so upstream shape breaks surface,
//        and the Max Battle panel's standing and event sources each get a line
//   D6 — the PvP snapshot itself is well formed and every dex resolves
//   D7 — the shadow keeper filters carry every keeper, in every locale
//   D8 — every Rocket lineup Pokémon resolves to a real name in every locale
//   D9 — a themed generic grunt is named after its theme and filtered like one
//   D10 — every typed grunt's main counter and backup obey their type rules
//         (including the killer handover), render in every locale, and
//         generic grunts only mark their tanks
//   D11 — the raid fetcher refuses a raid or Max Battle family that empties,
//         one family at a time (D5 is the reporting half; this is the refusal)
//   D12 — event Max Battles: the fetcher parses and date-gates ScrapedDuck's
//         Max Mondays and Max Battle Days, every boss resolves to a dex, the
//         app builds each like a standing Max Battle boss and names it through
//         pokemonNameFor, and the empty-family guard leaves them alone

import RAID_BOSSES from "../src/data/raid-bosses.json";
import ROCKET_LINEUPS from "../src/data/rocket-lineups.json";
import LILY_TYPES from "./__fixtures__/lily-dex-types.json";
import { indexTypes, effVsPokemon } from "./lib/rocket-derive.mjs";
import { recurringTypesOf, KILLER_ONE_IN } from "./lib/rocket-cover.mjs";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";
import META_RANKINGS from "../src/data/meta-rankings.json";
import { buildDataFilters, buildResult, FIXTURE_CONFIG } from "./lib/fixture.mjs";
import { LOCALES } from "../src/i18n/index.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
// `resolveSpecies` is D7's; the dictionary and locale list are D6's. D6 no
// longer imports `pokemonNameFor` — it falls back to English, which is what made
// the old per-locale assertion unable to fail.
import {
  POKEMON_NAMES_DICT, SUPPORTED_NAME_LOCALES, pokemonNameFor, resolveSpecies, resolveRegionalSpecies, resolveSpeciesInfo,
} from "../src/data/species.js";
import { unresolvableDexEntries, formSuffixedDexEntries, NAME_LOCALES } from "./lib/species-dex.mjs";
import {
  buildEventMaxBattles, buildNameIndex, guardEmptiedFamilies, parseMaxEventBosses,
} from "./fetch-raid-bosses.mjs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const localeNames = Object.keys(LOCALES);
const byLocale = Object.fromEntries(localeNames.map((l) => [l, buildDataFilters(l)]));
const FAMILIES = Object.keys(byLocale.en);

// Walk a family to its leaf clauses, remembering the path for diagnostics.
function leaves(node, path = "", out = []) {
  if (typeof node === "string") out.push({ path, clause: node });
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out);
  return out;
}

console.log("D1 — every generated clause is well formed");
{
  // A clause the game cannot parse is worse than no clause: it silently matches
  // nothing, and the user reads that as "I own none of these".
  const BAD = [
    [/undefined/, "contains 'undefined' (a missing keyword or name)"],
    [/NaN/, "contains 'NaN'"],
    [/\[object /, "contains '[object Object]'"],
    [/&&|,,/, "has an empty clause or term"],
    [/^[&,]|[&,]$/, "has a dangling leading/trailing separator"],
    [/!!/, "has a doubled negation"],
  ];
  let scanned = 0;
  const problems = [];
  for (const loc of localeNames)
    for (const fam of FAMILIES)
      for (const { path, clause } of leaves(byLocale[loc][fam], fam)) {
        scanned++;
        if (clause === "") continue; // emptiness is D2/D5's business
        for (const [re, why] of BAD)
          if (re.test(clause)) problems.push(`${loc}.${path}: ${why} — ${clause.slice(0, 80)}`);
      }
  check(`${scanned} clauses scanned across ${localeNames.length} locales, none malformed`,
    problems.length === 0, problems.slice(0, 5).join(" | "));
}

console.log("\nD2 — every boss / leader / cup in the data produces a clause");
{
  const raidBossIds = Object.values(RAID_BOSSES.raids || {}).flat().map((b) => b.id ?? b.name);
  const raidClauseIds = Object.values(byLocale.en.raidFilters).flatMap((t) => Object.keys(t));
  check(`raids: ${raidBossIds.length} bosses in data → ${raidClauseIds.length} clauses`,
    raidBossIds.length > 0 && raidClauseIds.length === raidBossIds.length,
    raidClauseIds.length !== raidBossIds.length ? "count mismatch — a boss was dropped" : "");
  check("no raid clause is empty",
    leaves(byLocale.en.raidFilters).every((l) => l.clause.length > 0));

  // rocket-lineups.json is a flat `trainers` array discriminated by `kind`.
  const trainers = ROCKET_LINEUPS.trainers || [];
  const leaders = trainers.filter((t) => t.kind === "leader");
  const grunts = trainers.filter((t) => t.kind !== "leader");
  check(`rocket: ${trainers.length} trainers in data (${leaders.length} leaders, ${grunts.length} grunts)`,
    trainers.length > 0, "empty lineup data would make every check below vacuous");
  check(`rocket leaders: ${leaders.length} in data → ${Object.keys(byLocale.en.rocketLeaders).length} with clauses`,
    Object.keys(byLocale.en.rocketLeaders).length === leaders.length);
  const gruntClauseCount =
    Object.keys(byLocale.en.rocketTypedGrunts).length + Object.keys(byLocale.en.rocketGenericGrunts).length;
  check(`rocket grunts: ${grunts.length} in data → ${gruntClauseCount} with clauses`,
    gruntClauseCount === grunts.length,
    gruntClauseCount !== grunts.length ? "a grunt lineup produced no counter filter" : "");
  check("every leader exposes at least one phase clause",
    Object.values(byLocale.en.rocketLeaders).every((ph) => Object.keys(ph).length > 0));

  const leagues = Object.keys(PVP_RANKINGS.leagues || {});
  check(`pvp: ${leagues.length} league(s) in data → ${Object.keys(byLocale.en.pvpFilters).length} filter(s)`,
    leagues.length > 0 && Object.keys(byLocale.en.pvpFilters).length === leagues.length);

  // Cups drive `cupFilters`, which buildDataFilters does not expose because it
  // is gated on Date.now() — a cup card only renders inside its event window, so
  // most weeks it is legitimately empty. Asserting on it would pass or fail
  // depending on the day. Assert referential integrity on the DATA instead,
  // which holds every day: a cup id that an event references but the snapshot
  // does not define is a matcher inventing ids.
  const cupIds = Object.keys(PVP_RANKINGS.cups || {});
  const referenced = new Set();
  for (const e of PVP_RANKINGS.gblEvents || []) for (const id of e.cups || []) referenced.add(id);
  const dangling = [...referenced].filter((id) => !PVP_RANKINGS.cups?.[id]);
  check(`pvp cups: ${cupIds.length} defined, ${referenced.size} referenced by events, 0 dangling`,
    dangling.length === 0, dangling.join(", "));
  for (const id of cupIds) {
    const cup = PVP_RANKINGS.cups[id];
    check(`pvp cup ${id}: has species and a cpCap of number-or-null`,
      (cup.species?.length || 0) > 0 && (cup.cpCap === null || typeof cup.cpCap === "number"));
  }
}

console.log("\nD3 — all 7 locales expose the same entries");
{
  // Typed grunts are keyed by their LOCALIZED trainer name ("Water-type Female
  // Grunt" / "Wasser-Rüpel ♀"), so their key sets differ by design — compare
  // counts there. Everywhere else the keys are stable ids or untranslated
  // proper nouns, so the sets themselves must match.
  const LOCALIZED_KEYS = new Set(["rocketTypedGrunts"]);
  for (const fam of FAMILIES) {
    const paths = (l) => leaves(byLocale[l][fam], fam).map((x) => x.path).sort();
    if (LOCALIZED_KEYS.has(fam)) {
      const n = paths("en").length;
      const bad = localeNames.filter((l) => paths(l).length !== n);
      check(`${fam}: entry count identical across locales (keys are localized)`,
        bad.length === 0, bad.map((l) => `${l}=${paths(l).length} vs en=${n}`).join(", "));
    } else {
      const ref = paths("en").join("|");
      const bad = localeNames.filter((l) => paths(l).join("|") !== ref);
      check(`${fam}: key set identical across locales`, bad.length === 0, bad.join(", "));
    }
  }
}

console.log("\nD4 — non-English locales actually localize their clauses");
{
  // Raid clauses carry type keywords, which every locale translates. If DE and
  // EN are byte-identical the locale silently fell back to English keywords.
  for (const fam of ["raidFilters", "rocketTypedGrunts"]) {
    const en = JSON.stringify(byLocale.en[fam]);
    if (en === "{}") { console.log(`  · ${fam}: empty, nothing to compare`); continue; }
    for (const loc of ["de", "es", "fr", "ja", "zh-TW", "hi"]) {
      check(`${fam}: ${loc} differs from en`, JSON.stringify(byLocale[loc][fam]) !== en);
    }
  }
}

console.log("\nD5 — filter families that are entirely empty");
{
  // Not a hard failure: a family can be legitimately empty when the game has
  // none of that content live. But it must be VISIBLE — an empty family is also
  // what a silent upstream shape change looks like, and pinning `{}` in a
  // snapshot hides it forever.
  const SOURCES = {
    maxBattleFilters: `raid-bosses.json maxBattles, lily-dex-api's standing list (${JSON.stringify(RAID_BOSSES.maxBattles || {}).slice(0, 40)})`,
    eventMaxBattleFilters: "raid-bosses.json eventMaxBattles, ScrapedDuck's Max Mondays and Max Battle Days (empty between events)",
    maxTank: "meta-rankings.json, the 0.5-second charger moves",
  };
  const empty = FAMILIES.filter((f) => leaves(byLocale.en[f], f).filter((l) => l.clause !== "").length === 0);
  if (empty.length === 0) console.log("  ✓ none");
  for (const f of empty) console.log(`  ! ${f} is empty — check ${SOURCES[f] ?? "its source data"}`);
  // The Max Battle panel has two sources, so each gets its own count whether
  // or not it is empty. lily-dex-api's standing list has been empty since
  // 2026-06-11; with ScrapedDuck events present that is the honest state of
  // the panel, not a broken one. Only both empty leaves it with no attackers.
  const standing = Object.values(RAID_BOSSES.maxBattles || {}).flat().length;
  const maxEvents = RAID_BOSSES.eventMaxBattles || [];
  const eventBosses = maxEvents.flatMap((e) => e.bosses || []).length;
  console.log(`  ${standing + eventBosses === 0 ? "!" : "·"} Max Battle panel: ${standing} standing boss(es) from lily-dex-api` +
    ` · ${eventBosses} event boss(es) in ${maxEvents.length} event(s) from ScrapedDuck`);
}

console.log("\nD6 — the PvP snapshot is well formed and every dex resolves");
{
  // D1 asserts no `undefined` reaches a clause. This is the same guarantee moved
  // back to the data layer, where the diagnostic can name the offending dex
  // instead of pointing at a 900-character filter string.
  check("snapshot records a source", ["pvpoke", "lily-dex"].includes(PVP_RANKINGS.source),
    String(PVP_RANKINGS.source));
  check("fetchedAt parses", Number.isFinite(Date.parse(PVP_RANKINGS.fetchedAt)), PVP_RANKINGS.fetchedAt);

  const pools = [
    ...Object.entries(PVP_RANKINGS.leagues || {}),
    ...Object.entries(PVP_RANKINGS.cups || {}),
  ];
  const malformed = [];
  const duplicated = [];
  for (const [label, pool] of pools) {
    const seen = new Set();
    for (const sp of pool.species || []) {
      if (!Number.isInteger(sp.dex) || typeof sp.name !== "string" || sp.name === "") {
        malformed.push(`${label}:${JSON.stringify(sp).slice(0, 40)}`);
        continue;
      }
      if (seen.has(sp.dex)) duplicated.push(`${label}:${sp.dex}`);
      seen.add(sp.dex);
    }
  }
  // A parenthesised form name would emit `+quagsire (shadow)` — a filter token
  // with a space in it — via App.jsx's dex-dict fallback. Via the shared helper,
  // so the fetcher's own guard runs the same test rather than a weaker copy.
  malformed.push(...formSuffixedDexEntries(pools.map(([label, pool]) => [label, pool.species])));
  // Via the shared strict helper, NOT pokemonNameFor. pokemonNameFor falls back
  // to the English entry, so it returns the same truthy value for all seven
  // locales and a per-locale hole could never fail this check — it did 7× the
  // work of a single call and asserted exactly as much. The strict lookup is
  // what actually catches a German filter silently carrying an English name.
  const unresolvable = unresolvableDexEntries(
    pools.map(([label, pool]) => [label, pool.species]),
    POKEMON_NAMES_DICT,
    NAME_LOCALES,
  );
  check(`every species entry is {dex:int, name:non-empty base name} (${pools.length} pools)`,
    malformed.length === 0, malformed.slice(0, 5).join(", "));
  check("no duplicate dex within a league or cup", duplicated.length === 0, duplicated.slice(0, 5).join(", "));
  check(`every dex has a real name in all ${NAME_LOCALES.length} locales (no en fallback)`,
    unresolvable.length === 0, unresolvable.slice(0, 5).join(", "));
  // The fetchers run under plain node and cannot import species.js, so
  // scripts/lib/species-dex.mjs keeps its own copy of the locale list. Assert
  // the two agree, so that copy cannot drift unnoticed.
  check("species-dex NAME_LOCALES matches SUPPORTED_NAME_LOCALES",
    [...NAME_LOCALES].sort().join(",") === [...SUPPORTED_NAME_LOCALES].sort().join(","),
    `${NAME_LOCALES.join("/")} vs ${SUPPORTED_NAME_LOCALES.join("/")}`);
}

console.log("\nD7 — shadow keeper filters project the whole keeper list");
{
  // shadowSafe and shadowFrustration are the two filters that name every
  // meta shadow attacker individually, so they are the ones that break when
  // the meta-rankings sync emits a species the app cannot resolve. That is not
  // hypothetical: the previous pogoapi-based sync shipped "tapu-bulu",
  // "tapu-lele" and "tapu-koko", which resolveSpecies returns null for, and
  // App.jsx's canonicalize() passes an unresolved entry straight through — so
  // all three reached users' filters as search terms matching nothing at all.
  // These checks are what makes that class of failure loud.
  const keepers = META_RANKINGS.shadowKeepers || [];
  check(`meta-rankings ships ${keepers.length} shadow keepers`, keepers.length > 0,
    "an empty keeper list would make every check below vacuous");

  const unresolvable = keepers.filter((s) => !resolveSpecies(s));
  check("every keeper resolves through resolveSpecies",
    unresolvable.length === 0,
    unresolvable.length ? `unresolvable: ${unresolvable.join(", ")}` : "");

  check("keeper list has no duplicates",
    new Set(keepers).size === keepers.length);

  for (const loc of localeNames) {
    const safe = byLocale[loc].shadowSafe || "";
    const frustration = byLocale[loc].shadowFrustration || "";
    // One `!+name` exclusion per keeper in shadowSafe, one `+name` include per
    // keeper in shadowFrustration. Counting the terms rather than matching the
    // names keeps the check locale-agnostic while still catching a keeper that
    // silently fell out of the projection.
    const safeTerms = (safe.match(/!\+/g) || []).length;
    const frustrationTerms = (frustration.match(/(?:^|[&,])\+/g) || []).length;
    check(`${loc}: shadowSafe excludes all ${keepers.length} keeper families`,
      safeTerms === keepers.length, `found ${safeTerms}`);
    check(`${loc}: shadowFrustration includes all ${keepers.length} keeper families`,
      frustrationTerms === keepers.length, `found ${frustrationTerms}`);
  }

  // The trash crypto floor is the other keeper consumer, but it only fires when
  // protectShadows is off — the fixture config leaves it on, so the pinned
  // `trash` string is deliberately unaffected and stays exact-pinned. Assert
  // that invariant here so a change to the default cannot quietly start
  // churning the fixture.
  check("default config keeps the trash crypto floor dormant",
    FIXTURE_CONFIG.protectShadows === true,
    FIXTURE_CONFIG.protectShadows === true ? ""
      : "protectShadows default flipped — the keeper floor now lands in `trash`, which IS exact-pinned");
}

console.log("\nD8 — every Rocket lineup Pokémon resolves in every locale");
{
  // The lineup hint names each Pokémon in the output locale. ScrapedDuck spells
  // regional forms "Alolan Vulpix", which no name dictionary carries, so those
  // rendered in English everywhere. Assert on the dictionary entry itself, not
  // on pokemonNameFor — that falls back to English and could never fail (D6).
  const sourceNames = [];
  for (const t of ROCKET_LINEUPS.trainers || [])
    for (const p of t.phases || []) for (const pk of p.pokemons || []) sourceNames.push(pk.name);
  const names = new Set(sourceNames);
  check(`rocket lineups name ${names.size} distinct Pokémon`, names.size > 0,
    "an empty name list would make every check below vacuous");
  const regionLabel = (loc, region) => LOCALES[loc]?.messages[`app.buddy_targets.form_region.${region}`];
  for (const loc of SUPPORTED_NAME_LOCALES) {
    const bad = [];
    for (const name of names) {
      const hit = resolveRegionalSpecies(name, loc);
      if (!hit) bad.push(`${name} (unresolvable)`);
      else if (!POKEMON_NAMES_DICT[hit.dexKey]?.[loc]) bad.push(`${name} (no ${loc} name)`);
      else if (hit.region && !regionLabel(loc, hit.region))
        bad.push(`${name} (no ${loc} label for region ${hit.region})`);
    }
    check(`${loc}: all ${names.size} lineup names localize`, bad.length === 0, bad.slice(0, 5).join(", "));
  }

  // The dictionary passing proves nothing about what buildFilters renders, so
  // also run the real builder and compare its phase Pokémon names, as a
  // multiset, against the names the dictionary says each locale should show.
  // Each output locale is built twice: under its own UI locale and under a
  // different one. The region label belongs to the name, so it must follow the
  // OUTPUT locale; an English UI with Japanese output must not say "(Alola)".
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const expectedFor = (loc) => sourceNames.map((n) => {
    const hit = resolveRegionalSpecies(n, loc);
    if (!hit) return n;
    const base = cap(POKEMON_NAMES_DICT[hit.dexKey][loc].toLowerCase());
    return hit.region ? `${base} (${regionLabel(loc, hit.region)})` : base;
  }).sort();
  const renderedFor = (result) =>
    ["rocketLeaders", "rocketTypedGrunts", "rocketGenericGrunts"]
      .flatMap((fam) => result[fam] || [])
      .flatMap((t) => t.phases || [])
      .flatMap((p) => (p.pokemons || []).map((pk) => pk.name))
      .sort();
  for (const loc of SUPPORTED_NAME_LOCALES) {
    const expected = expectedFor(loc);
    for (const ui of [loc, loc === "en" ? "ja" : "en"]) {
      const rendered = renderedFor(buildResult(loc, { uiLocale: ui }));
      const diff = rendered.filter((n, i) => n !== expected[i]);
      check(`${loc} output / ${ui} UI: buildFilters renders all ${expected.length} lineup names in ${loc}`,
        rendered.length === expected.length && diff.length === 0,
        rendered.length !== expected.length
          ? `rendered ${rendered.length}, expected ${expected.length}`
          : diff.slice(0, 5).join(", "));
    }
  }
}

console.log("\nD9 — generic grunts: themed lineups get the typed shape, the rest counter groups");
{
  // `themeTypes` (fetcher) marks a generic grunt whose every phase offers the
  // same primary types, e.g. the Grass/Fire/Water starter trio. Re-derive that
  // from the phases so a fetcher regression cannot mark an unthemed lineup,
  // then check every locale names the card after the theme and filters with
  // the typed shape (resistor allowlist + SE moves). Unthemed lineups get
  // counter groups (genericCountersOf): every phase covered by one, each
  // rendered as a clause. The group logic itself is pinned in
  // check-rocket-counters.mjs against fixed lineups.
  const generic = (ROCKET_LINEUPS.trainers || []).filter((t) => t.kind === "generic_grunt");
  // Expected theme from the phases alone, independent of `themeTypes`, so a
  // fetcher that drops the field fails here instead of skipping every check.
  const expectedTheme = (t) => {
    const phases = t.phases || [];
    if (phases.length === 0 || phases.some((ph) => (ph.pokemons || []).length < 2)) return null;
    const keys = phases.map((ph) => [...new Set(ph.pokemons.map((pk) => pk.types?.[0]))].sort().join(","));
    if (keys.some((k) => k !== keys[0]) || keys[0].split(",").length < 2) return null;
    return keys[0];
  };
  const expected = generic.map((t) => ({ t, theme: expectedTheme(t) }));
  const themed = expected.filter((e) => e.theme);
  console.log(`  (${themed.length} of ${generic.length} generic grunt(s) themed in the current snapshot)`);
  for (const { t, theme } of expected) {
    const actual = t.themeTypes?.length ? [...t.themeTypes].sort().join(",") : null;
    check(`${t.name}: themeTypes matches the phases (${theme ?? "unthemed"})`,
      actual === theme, `data says ${actual ?? "unthemed"}`);
  }
  const builtByLocale = Object.fromEntries(localeNames.map((loc) => [loc, buildResult(loc).rocketGenericGrunts || []]));
  for (const { t, theme } of expected) {
    if (theme) {
      check(`${t.name}: data carries resistor and SE move types`,
        (t.resistorTypes || []).length > 0 && (t.seMoveTypes || []).length > 0);
    } else {
      const covered = new Set((t.counters || []).filter((c) => !c.recurring).flatMap((c) => c.phases));
      check(`${t.name}: counter groups cover every phase (${[...covered].sort().join(", ")})`,
        (t.phases || []).every((p) => covered.has(p.slot)) &&
          (t.counters || []).every((c) => c.resistorTypes.length > 0 && c.seMoveTypes.length > 0));
    }
    for (const loc of localeNames) {
      const built = builtByLocale[loc].find((g) => g.name === t.name);
      if (!theme) {
        const counters = built?.counters || [];
        const live = counters.filter((c) => !c.skipped && c.clause.length > 0);
        check(`${loc}: ${t.name} renders a clause per counter group (${live.length}/${(t.counters || []).length})`,
          !!built && built.phased && !built.themeTypes && !built.displayName &&
            live.length === (t.counters || []).length && live.length > 0,
          built ? "" : "missing from buildFilters output");
        const keys = counters.map((c) => c.key);
        check(`${loc}: ${t.name} counter keys are unique (copy state, fixture map)`,
          new Set(keys).size === keys.length, keys.join(", "));
        continue;
      }
      const kw = pogoKeywords(loc);
      // One filter per line (theme type), each live, so a team gets one
      // counter per starter line instead of one compromise box.
      const lines = (built?.counters || []).filter((c) => c.line && !c.skipped && c.clause.length > 0);
      check(`${loc}: ${t.name} renders one filter per line (${lines.length}/${theme.split(",").length})`,
        !!built && !built.skipped && built.phased && Array.isArray(built.themeTypes) &&
          lines.length === theme.split(",").length,
        built ? "" : "missing from buildFilters output");
      const name = (built?.displayName || "").toLowerCase();
      const missing = theme.split(",").filter((ty) => !name.includes(kw.type[ty]));
      check(`${loc}: ${t.name} is named after its theme ("${built?.displayName}")`,
        !!built?.displayName && missing.length === 0,
        missing.length ? `missing ${missing.join(", ")}` : "");
    }
  }
}

console.log("\nD10 — typed grunt boxes and tanks");
{
  // The boxes are computed by the fetcher (scripts/lib/rocket-cover.mjs,
  // unit-tested in check-rocket-cover.mjs, whose header explains the battle
  // they are built for). This asserts the snapshot obeys the rules against the
  // snapshotted type chart, and that the app renders every box it describes.
  const typeIdx = indexTypes(LILY_TYPES);
  const eff = (t, p) => effVsPokemon(t, p.types, typeIdx);
  const grunts = (ROCKET_LINEUPS.trainers || []).filter((t) => t.kind !== "leader");
  const typed = grunts.filter((t) => t.kind === "typed_grunt");
  const bulk = ROCKET_LINEUPS.bulk || {};
  check("snapshot carries a bulk cutoff", typeof bulk.cutoff === "number" && bulk.cutoff > 0,
    "without it no grunt can have tanks");
  const distinct = (pks) => [...new Map(pks.map((p) => [p.name, p])).values()];
  const lineupOf = (t) => distinct((t.phases || []).flatMap((p) => p.pokemons || []));
  const unmeasured = [...new Set(grunts.flatMap((t) => lineupOf(t).map((p) => p.name)))].filter((n) => !(n in (bulk.species || {})));
  check("every grunt lineup species has a bulk entry", unmeasured.length === 0, unmeasured.slice(0, 5).join(", "));
  for (const t of grunts) {
    const lineup = lineupOf(t).map((p) => p.name);
    const badTanks = (t.tanks || []).filter((k) =>
      !lineup.includes(k.name) || !((bulk.species?.[k.name] ?? -1) >= bulk.cutoff) || (k.seMoveTypes || []).length === 0);
    check(`${t.name}: ${(t.tanks || []).length} tank(s), each in the lineup, at or over the cutoff, with move types`,
      badTanks.length === 0, badTanks.map((k) => k.name).join(", "));
    const missedTanks = lineup.filter((n) => (bulk.species?.[n] ?? -1) >= bulk.cutoff && !(t.tanks || []).some((k) => k.name === n));
    check(`${t.name}: no lineup species over the cutoff is missing from tanks`, missedTanks.length === 0, missedTanks.join(", "));
  }
  for (const t of typed) {
    const [s1 = [], s2 = [], s3 = []] = (t.phases || []).map((p) => p.pokemons || []);
    const late = [...s2, ...s3];
    const main = t.boxes?.main || {};
    const backup = t.boxes?.backup || {};
    const versions = main.versions || [];
    const leads = distinct(s1);
    const placed = [...versions.flatMap((v) => v.leads || []), ...(main.uncoveredLeads || [])];
    check(`${t.name}: main counter has 1–2 versions, each with fast-move types`,
      versions.length >= 1 && versions.length <= 2 && versions.every((v) => (v.fastTypes || []).length > 0));
    const missed = versions.flatMap((v) => (v.fastTypes || []).flatMap((ty) =>
      (v.leads || []).filter((n) => !(eff(ty, leads.find((p) => p.name === n) || { types: [] }) > 1)).map((n) => `${ty} vs ${n}`)));
    check(`${t.name}: every main fast type is super-effective against every lead it is for`, missed.length === 0, missed.join(", "));
    check(`${t.name}: versions + uncovered leads partition the ${leads.length} slot-1 options`,
      placed.length === leads.length && new Set(placed).size === placed.length && leads.every((p) => placed.includes(p.name)),
      `placed ${placed.join(", ")}`);
    const targets = distinct(late);
    const lateTypes = [...new Set(targets.flatMap((p) => p.types))].sort();
    const cand = main.candidates || {};
    // A game-master outage can leave a type uncounted (see candidateCounter in
    // the fetcher). That type is never a killer, so the main counter keeps the
    // full check: degraded, not wrong, and the next good sync heals it.
    const uncounted = lateTypes.filter((ty) => !(cand.total > 0) || cand.weakTo?.[ty] == null);
    if (uncounted.length) {
      console.warn(`  ⚠ ${t.name}: no Box 1 candidate counts for ${uncounted.join(", ")}; they stay in the main counter's check`);
    }
    const badCounts = Object.entries(cand.weakTo || {}).filter(([, n]) => !(n >= 0 && n <= cand.total));
    check(`${t.name}: Box 1 candidate counts are within the candidate total`,
      badCounts.length === 0, badCounts.map(([ty, n]) => `${ty} ${n}/${cand.total}`).join(", "));
    const killers = lateTypes.filter((ty) => cand.total > 0 && cand.weakTo?.[ty] != null &&
      cand.weakTo[ty] * KILLER_ONE_IN >= cand.total);
    check(`${t.name}: killer types are the slot 2/3 types that rule out a third of the candidates`,
      JSON.stringify(main.killerTypes) === JSON.stringify(killers), `${main.killerTypes} vs ${killers}`);
    check(`${t.name}: main counter guards against every slot 2/3 type except killers`,
      JSON.stringify(main.guardTypes) === JSON.stringify(lateTypes.filter((ty) => !killers.includes(ty))),
      `${main.guardTypes}`);
    const handed = targets.filter((p) => p.types.some((ty) => killers.includes(ty)));
    check(`${t.name}: the Pokémon carrying a killer type are handed over`,
      JSON.stringify(backup.handedOver) === JSON.stringify(handed.map((p) => p.name)), `${backup.handedOver}`);
    check(`${t.name}: backup targets are exactly the slot 2/3 options`,
      JSON.stringify(backup.targets) === JSON.stringify(targets.map((p) => p.name)));
    const resisted = (ty) => targets.some((p) => eff(ty, p) < 1);
    let expectedMoves;
    if (handed.length) {
      const hits = (ty) => handed.filter((p) => eff(ty, p) > 1).length;
      const usable = Object.keys(typeIdx).filter((ty) => !resisted(ty) && hits(ty) > 0);
      const most = Math.max(0, ...usable.map(hits));
      expectedMoves = usable.filter((ty) => hits(ty) === most).sort();
    } else {
      const tankTypes = new Set((t.tanks || []).filter((k) => targets.some((p) => p.name === k.name)).flatMap((k) => k.seMoveTypes));
      expectedMoves = Object.keys(typeIdx).filter((ty) => !resisted(ty) &&
        (tankTypes.has(ty) || (late.filter((p) => eff(ty, p) > 1).length * 2 >= late.length && late.some((p) => eff(ty, p) > 1)))).sort();
    }
    check(`${t.name}: backup move types ${handed.length ? "hit the handed-over Pokémon" : "hit half of slots 2/3 or a tank"}, none resisted`,
      (backup.moveTypes || []).length > 0 && JSON.stringify(backup.moveTypes) === JSON.stringify(expectedMoves),
      `${backup.moveTypes} vs ${expectedMoves}`);
    const backupGuard = [...new Set([...recurringTypesOf(late), ...handed.flatMap((p) => p.types)])].sort();
    check(`${t.name}: backup guards against recurring types and the handed-over Pokémon's types`,
      JSON.stringify(backup.guardTypes) === JSON.stringify(backupGuard), `${backup.guardTypes} vs ${backupGuard}`);
    const resisting = Object.keys(typeIdx).filter((d) => lateTypes.some((a) => effVsPokemon(a, [d], typeIdx) < 1));
    check(`${t.name}: backup resistor types are the types that resist at least one slot 2/3 type`,
      (backup.resistorTypes || []).length > 0 && JSON.stringify(backup.resistorTypes) === JSON.stringify(resisting),
      `${backup.resistorTypes} vs ${resisting}`);
    check(`${t.name}: no leftover counter windows`, !("counterPlan" in t));
  }
  // The builder keeps data order and never drops a typed grunt (D2), and
  // typed-grunt names are localized, so pair by position.
  for (const loc of localeNames) {
    const result = buildResult(loc);
    const bad = [];
    typed.forEach((t, i) => {
      const g = result.rocketTypedGrunts?.[i];
      if (!g) { bad.push(`${t.name} missing`); return; }
      if ((g.main || []).length !== (t.boxes?.main?.versions || []).length) bad.push(`${t.name} main versions`);
      if ((g.main || []).some((b) => !b.clause)) bad.push(`${t.name} empty main box`);
      if (!g.backup?.clause) bad.push(`${t.name} no backup box`);
      // The resistor allowlist is the backup's first clause; every resistor
      // type must be in it, in this locale's keywords.
      const kw = pogoKeywords(loc);
      const allow = (g.backup?.clauses?.[0]?.clause || "").split(",");
      const missingResistors = (t.boxes?.backup?.resistorTypes || []).filter((r) => !allow.includes(kw.type[r]));
      if (missingResistors.length) bad.push(`${t.name} backup lacks resistor ${missingResistors.join("/")}`);
      if ("windows" in g || "tanks" in g || "lenient" in g) bad.push(`${t.name} still has windows, tank or broad boxes`);
      // A killer type stays out of every main box's weakness check, and the
      // backup names each Pokémon it was handed in its move clause's reason.
      const killerGuards = (t.boxes?.main?.killerTypes || []).map((ty) => `!<${kw.type[ty]}`);
      if ((g.main || []).some((b) => b.clause.split("&").some((c) => killerGuards.includes(c)))) {
        bad.push(`${t.name} main box guards against a killer type`);
      }
      const handed = t.boxes?.backup?.handedOver || [];
      if ((g.handedOver || []).length !== handed.length) bad.push(`${t.name} handed-over names`);
      const movesWhy = (g.backup?.clauses || []).map((c) => c.why).join(" ");
      if ((g.handedOver || []).some((n) => !movesWhy.includes(n))) bad.push(`${t.name} backup reasons miss a handed-over name`);
    });
    // Generic grunts keep their per-phase counters and get no boxes of their
    // own for tanks; their tanks are only marked in the counter groups.
    for (const g of result.rocketGenericGrunts || []) {
      if (g.tanks || g.windows || g.main) bad.push(`${g.name} grew typed-grunt boxes`);
    }
    const generic = grunts.filter((t) => t.kind === "generic_grunt" && (t.tanks || []).length && t.counters?.length);
    for (const t of generic) {
      const g = (result.rocketGenericGrunts || []).find((x) => x.name === t.name);
      const marked = (g?.counters || []).some((c) => [...(c.pokemons || []), ...(c.alsoPokemons || [])].some((p) => p.tanky));
      if (!marked) bad.push(`${t.name} tanks not marked`);
    }
    check(`${loc}: typed grunts render a main counter and a backup; generic grunts only mark tanks`,
      bad.length === 0, bad.slice(0, 5).join(", "));
  }
}

console.log("\nD11 — the raid fetcher refuses a family that empties, one family at a time");
{
  // D5 only reports. The refusal lives in scripts/fetch-raid-bosses.mjs and
  // only ever runs against the live feed: in the daily sync, and in the
  // prebuild of every `npm run build` in test.yml and deploy.yml, where
  // --offline-ok makes a refusal keep the cache. Neither hands it a feed this
  // check could predict, so the decision is pinned here. The shape that
  // motivated it: lily-dex-api's maxbattles.json answering 200 with an empty
  // list while raids stay healthy.
  const tiers = (n) => ({ tier_1: Array.from({ length: n }, (_, i) => ({ id: `BOSS_${i}` })) });
  const prev = { raids: tiers(4), maxBattles: tiers(3) };
  const fresh = { raids: tiers(5), maxBattles: tiers(2) };
  const families = (g) => g.refused.map((r) => r.family).join(",");

  let g = guardEmptiedFamilies(prev, fresh);
  check("both families populated: nothing refused, fresh content written, exit 0",
    g.refused.length === 0 && g.write === fresh && g.exitCode === 0);

  g = guardEmptiedFamilies(prev, { ...fresh, maxBattles: {} });
  check("maxBattles empties in the sync: only maxBattles is refused", families(g) === "maxBattles", families(g));
  check("… the previous maxBattles is kept and the fresh raids are written",
    g.write?.maxBattles === prev.maxBattles && g.write?.raids === fresh.raids);
  check("… and the run fails", g.exitCode === 1);

  g = guardEmptiedFamilies(prev, { ...fresh, maxBattles: {} }, { offlineOk: true });
  check("maxBattles empties under --offline-ok: the whole cache stays and the build goes on",
    families(g) === "maxBattles" && g.write === null && g.exitCode === 0);

  g = guardEmptiedFamilies(prev, { ...fresh, raids: {} });
  check("raids empties: only raids is refused, the fresh maxBattles is written",
    families(g) === "raids" && g.write?.raids === prev.raids && g.write?.maxBattles === fresh.maxBattles && g.exitCode === 1);

  // A tier key with an empty list is still an empty family.
  g = guardEmptiedFamilies(prev, { ...fresh, maxBattles: { tier_1: [] } });
  check("a family of empty tiers counts as empty", families(g) === "maxBattles");

  g = guardEmptiedFamilies({ raids: tiers(4), maxBattles: {} }, { ...fresh, maxBattles: {} });
  check("a family that was already empty stays quiet (no red run every day for a known hole)",
    g.refused.length === 0 && g.exitCode === 0);

  g = guardEmptiedFamilies(prev, { raids: {}, maxBattles: {} });
  check("both families empty: both refused, both kept", families(g) === "raids,maxBattles" &&
    g.write?.raids === prev.raids && g.write?.maxBattles === prev.maxBattles && g.exitCode === 1);

  g = guardEmptiedFamilies({ raids: {}, maxBattles: {} }, { raids: {}, maxBattles: {} });
  check("an entirely empty result is refused even when the previous snapshot was empty too",
    families(g) === "raids,maxBattles" && g.exitCode === 1);

  for (const offlineOk of [false, true]) {
    g = guardEmptiedFamilies(null, { raids: {}, maxBattles: {} }, { offlineOk });
    check(`no previous snapshot and nothing fetched${offlineOk ? " (--offline-ok)" : ""}: nothing written, exit 1`,
      g.write === null && g.exitCode === 1);
  }
  g = guardEmptiedFamilies(null, { ...fresh, maxBattles: {} });
  check("no previous snapshot and one family empty: written as is (nothing to compare against)",
    g.refused.length === 0 && g.write?.maxBattles && g.exitCode === 0);

  // Against the committed snapshot, which D2 asserts has raids: losing them is
  // refused, and today's state of maxBattles is what it is.
  g = guardEmptiedFamilies(RAID_BOSSES, { raids: {}, maxBattles: RAID_BOSSES.maxBattles });
  check("with the committed snapshot as the previous one, an empty raids fetch is refused",
    families(g).split(",").includes("raids") && g.write?.raids === RAID_BOSSES.raids);
}

console.log("\nD12 — event Max Battles: parsed, date-gated, resolved and built like the standing tiers");
{
  // ScrapedDuck's Max Mondays and Max Battle Days are what the Max Battle panel
  // shows while lily-dex-api's standing list is empty. They exist only inside
  // the fetcher's 7-day window, so on most days the committed snapshot holds
  // one event or none, and a check over it alone would pass on nothing. So the
  // snapshot's events are checked when there are any, and a synthetic feed in
  // ScrapedDuck's shape always: through the fetcher's parser and date gate,
  // then through the app's own builder.
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.parse("2026-10-13T12:00:00Z");
  // ScrapedDuck's times are local wall-clock strings with no zone, which
  // Date.parse reads as local; write them the same way.
  const feedTime = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 23);
  const en = (dex) => POKEMON_NAMES_DICT[String(dex)].en;
  // Game-master templates in the shape the mirrors publish (as in
  // check-game-master.mjs), named through the real dictionary, for the
  // species the live feed named on 2026-10-13 and one with a Gigantamax form.
  // Sableye is left out on purpose: it is the name this index cannot resolve.
  const T = (t) => (t ? `POKEMON_TYPE_${t}` : undefined);
  const mon = (dex, type, type2) => {
    const id = en(dex).toUpperCase();
    const templateId = `V${String(dex).padStart(4, "0")}_POKEMON_${id}`;
    return { templateId, data: { templateId, pokemonSettings: { pokemonId: id, type: T(type), type2: T(type2) } } };
  };
  const nameIdx = buildNameIndex(
    [mon(215, "DARK", "ICE"), mon(480, "PSYCHIC"), mon(481, "PSYCHIC"), mon(482, "PSYCHIC"), mon(131, "WATER", "ICE")],
    POKEMON_NAMES_DICT,
  );
  const ev = (eventID, eventType, name, start, end) => ({
    eventID, name, eventType, start: start == null ? null : feedTime(start), end: end == null ? null : feedTime(end),
    extraData: { generic: { hasSpawns: false, hasFieldResearchTasks: false } },
  });
  const feed = [
    ev("zz-ended", "max-mondays", `Dynamax ${en(215)} during Max Monday`, NOW - 8 * DAY, NOW - 7 * DAY),
    // How ScrapedDuck publishes the Max Monday that ended yesterday.
    ev("zz-null-dates", "max-mondays", `Dynamax ${en(215)} during Max Monday`, null, null),
    ev("zz-trio", "max-battles", `Dynamax ${en(480)}, ${en(481)}, and ${en(482)} Max Battle Day`, NOW + 3 * DAY, NOW + 3 * DAY + 3 * HOUR),
    ev("zz-monday", "max-mondays", `Dynamax ${en(215)} during Max Monday`, NOW - HOUR, NOW + 8 * HOUR),
    ev("zz-gmax", "max-battles", `Gigantamax ${en(131)} Max Battle Day`, NOW + 2 * DAY, NOW + 2 * DAY + 3 * HOUR),
    ev("zz-unresolved", "max-mondays", `Dynamax ${en(302)} during Max Monday`, NOW + DAY, NOW + DAY + 8 * HOUR),
    ev("zz-far", "max-mondays", `Dynamax ${en(215)} during Max Monday`, NOW + 9 * DAY, NOW + 9 * DAY + 8 * HOUR),
    ev("zz-raid", "raid-hour", `${en(480)} Raid Hour`, NOW + DAY, NOW + DAY + HOUR),
  ];
  const run = (maxBattles) => {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      return { ...buildEventMaxBattles(feed, { nameIdx, allTypes: LILY_TYPES, maxBattles, now: NOW }), warnings };
    } finally {
      console.warn = realWarn;
    }
  };

  const parsed = (name) => JSON.stringify(parseMaxEventBosses({ name }));
  const monday = parsed(`Dynamax ${en(215)} during Max Monday`);
  const mondayOk = monday === JSON.stringify([{ name: en(215), gigantamax: false }]);
  check("a Max Monday title yields its one boss", mondayOk, mondayOk ? "" : monday);
  check("a Max Battle Day title splits \"A, B, and C\"",
    parsed(`Dynamax ${en(480)}, ${en(481)}, and ${en(482)} Max Battle Day`) ===
      JSON.stringify([480, 481, 482].map((d) => ({ name: en(d), gigantamax: false }))));
  check("a Gigantamax title marks every boss it names",
    parsed(`Gigantamax ${en(3)}, ${en(6)}, and ${en(9)} Max Battle Day`) ===
      JSON.stringify([3, 6, 9].map((d) => ({ name: en(d), gigantamax: true }))));

  const out = run({});
  const ids = out.entries.map((e) => e.eventID).join(",");
  check("the window keeps the live and upcoming events, oldest first", ids === "zz-monday,zz-gmax,zz-trio", ids);
  check("an ended, a null-dated and a past-the-lookahead event are dropped by the date gate, a raid by its type",
    !["zz-ended", "zz-null-dates", "zz-far", "zz-raid"].some((id) => ids.includes(id)));
  const warned = out.unresolved === 1 && out.warnings.some((w) => w.includes(`"${en(302)}"`));
  check("an unresolvable boss warns and is skipped, never guessed", warned, warned ? "" : out.warnings.join(" | "));
  const eventKeys = "bosses,end,eventID,eventType,name,start";
  check("each entry has eventRaids' shape without the raid tier flags",
    out.entries.every((e) => Object.keys(e).sort().join(",") === eventKeys));
  const standingKeys = Object.keys(Object.values(RAID_BOSSES.raids)[0][0]).sort().join(",");
  const bosses = out.entries.flatMap((e) => e.bosses);
  check(`each boss has the standing tiers' shape (${standingKeys}), plus a Gigantamax marker where the title says so`,
    bosses.every((b) => Object.keys(b).filter((k) => k !== "gigantamax").sort().join(",") === standingKeys) &&
      bosses.filter((b) => b.gigantamax === true).map((b) => b.names.en).join() === en(131) &&
      bosses.every((b) => b.gigantamax === true || !("gigantamax" in b)));
  const deduped = run({ tier_1: [{ id: en(215).toUpperCase() }, { id: en(131).toUpperCase() }] });
  check("a boss the standing list holds is deduped, but a Gigantamax one is not a Dynamax one",
    !deduped.entries.some((e) => e.eventID === "zz-monday") && deduped.deduped === 1 &&
      deduped.entries.some((e) => e.eventID === "zz-gmax"), deduped.entries.map((e) => e.eventID).join(","));

  // Every boss, in the snapshot and in the synthetic feed, resolves to a dex
  // with a name in every locale: the strict lookup, as D6 explains, because
  // pokemonNameFor's English fallback could never fail this.
  const snapshotEvents = RAID_BOSSES.eventMaxBattles || [];
  console.log(`  (${snapshotEvents.length} event Max Battle(s) in the committed snapshot)`);
  const sets = [["synthetic", out.entries], ...(snapshotEvents.length ? [["snapshot", snapshotEvents]] : [])];
  for (const [label, events] of sets) {
    const all = events.flatMap((e) => e.bosses || []);
    const dexKeyOf = (b) => resolveSpeciesInfo(b.names?.en, "en")?.dexKey;
    const holes = all.flatMap((b) => {
      const key = dexKeyOf(b);
      if (!key) return [`${b.names?.en ?? b.id} (no dex)`];
      return SUPPORTED_NAME_LOCALES.filter((l) => !POKEMON_NAMES_DICT[key]?.[l]).map((l) => `${b.names.en} (no ${l} name)`);
    });
    check(`${label}: all ${all.length} boss(es) resolve to a dex named in every locale`,
      all.length > 0 && holes.length === 0, holes.slice(0, 5).join(", "));

    // The app's builder, fed the same bosses as a standing tier and as events:
    // an event boss must come out exactly as the standing Max Battle path
    // builds it, Dynamax clause included, named through pokemonNameFor.
    const raidBosses = { ...RAID_BOSSES, maxBattles: { tier_1: all }, eventMaxBattles: events };
    for (const loc of localeNames) {
      const result = buildResult(loc, { raidBosses });
      const kw = pogoKeywords(loc);
      const standingClause = new Map((result.maxBattleFilters.tier_1 || []).map((b) => [b.id, b.clause]));
      const bad = [];
      const groups = result.eventMaxBattleFilters || [];
      if (groups.length !== events.length) bad.push(`${groups.length} groups for ${events.length} events`);
      groups.forEach((g, i) => {
        if ((g.bosses || []).length !== (events[i]?.bosses || []).length) bad.push(`${g.eventID}: a boss was dropped`);
        for (const b of g.bosses || []) {
          const data = (events[i]?.bosses || []).find((x) => x.id === b.id);
          const expected = pokemonNameFor(dexKeyOf(data || {}), loc);
          if (b.skipped || !b.clause) bad.push(`${g.eventID}/${b.id}: empty filter`);
          else if (b.clause !== standingClause.get(b.id)) bad.push(`${g.eventID}/${b.id}: not the standing builder's clause`);
          else if (!b.clause.split("&").includes(`${kw.flag.dynamax_move}1-`)) bad.push(`${g.eventID}/${b.id}: no Dynamax clause`);
          if (!expected || String(b.name).toLowerCase() !== expected) bad.push(`${g.eventID}/${b.id}: named "${b.name}", not "${expected}"`);
        }
      });
      check(`${label} ${loc}: ${groups.length} event(s) built by the Max Battle builder, named through pokemonNameFor`,
        groups.length > 0 && bad.length === 0, bad.slice(0, 4).join(" | "));
    }
  }

  // The event list empties between events by design, so the empty-family
  // guard must never refuse it or put an old one back, and its presence must
  // not hide an emptied standing list either.
  const tiers = (n) => ({ tier_1: Array.from({ length: n }, (_, i) => ({ id: `BOSS_${i}` })) });
  const next = { raids: tiers(4), maxBattles: {}, eventMaxBattles: [] };
  let g = guardEmptiedFamilies({ raids: tiers(4), maxBattles: {}, eventMaxBattles: out.entries }, next);
  check("guard: an emptied event Max Battle list is written as is, not refused",
    g.refused.length === 0 && g.write === next && g.exitCode === 0);
  g = guardEmptiedFamilies({ raids: tiers(4), maxBattles: tiers(3) }, { raids: tiers(4), maxBattles: {}, eventMaxBattles: out.entries });
  check("guard: event Max Battles do not stand in for an emptied standing list",
    g.refused.map((r) => r.family).join() === "maxBattles" && g.write?.eventMaxBattles === out.entries);
}

console.log(`\n${failures === 0 ? "✓ All data-filter property checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
