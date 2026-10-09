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
//   D5 — empty filter families are reported, so upstream shape breaks surface
//   D6 — the PvP snapshot itself is well formed and every dex resolves
//   D7 — the shadow keeper filters carry every keeper, in every locale
//   D8 — every Rocket lineup Pokémon resolves to a real name in every locale
//   D9 — a themed generic grunt is named after its theme and filtered like one
//   D10 — every typed grunt's counter plan partitions its lineup, every window
//         and tank renders as a filter in every locale, and generic grunts
//         only mark their tanks

import RAID_BOSSES from "../src/data/raid-bosses.json";
import ROCKET_LINEUPS from "../src/data/rocket-lineups.json";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";
import META_RANKINGS from "../src/data/meta-rankings.json";
import { buildDataFilters, buildResult, FIXTURE_CONFIG } from "./lib/fixture.mjs";
import { LOCALES } from "../src/i18n/index.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
// `resolveSpecies` is D7's; the dictionary and locale list are D6's. D6 no
// longer imports `pokemonNameFor` — it falls back to English, which is what made
// the old per-locale assertion unable to fail.
import { POKEMON_NAMES_DICT, SUPPORTED_NAME_LOCALES, resolveSpecies, resolveRegionalSpecies } from "../src/data/species.js";
import { unresolvableDexEntries, formSuffixedDexEntries, NAME_LOCALES } from "./lib/species-dex.mjs";

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
  const empty = FAMILIES.filter((f) => leaves(byLocale.en[f], f).filter((l) => l.clause !== "").length === 0);
  if (empty.length === 0) console.log("  ✓ none");
  for (const f of empty) {
    const src = f.startsWith("max") ? `raid-bosses.json maxBattles (${JSON.stringify(RAID_BOSSES.maxBattles || {}).slice(0, 40)})` : "its source data";
    console.log(`  ! ${f} is empty — check ${src}`);
  }
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

console.log("\nD10 — typed grunt counter plans and tanks");
{
  // The plan is computed by the fetcher (scripts/lib/rocket-cover.mjs, unit-
  // tested in check-rocket-cover.mjs); this asserts the snapshot it wrote is
  // internally sound and that the app renders every part of it. Re-deriving
  // the set cover would need the type chart, which only the fetcher has.
  const grunts = (ROCKET_LINEUPS.trainers || []).filter((t) => t.kind !== "leader");
  const typed = grunts.filter((t) => t.kind === "typed_grunt");
  const bulk = ROCKET_LINEUPS.bulk || {};
  check("snapshot carries a bulk cutoff", typeof bulk.cutoff === "number" && bulk.cutoff > 0,
    "without it no grunt can have tanks");
  const distinct = (t) => [...new Set((t.phases || []).flatMap((p) => (p.pokemons || []).map((pk) => pk.name)))];
  const unmeasured = [...new Set(grunts.flatMap(distinct))].filter((n) => !(n in (bulk.species || {})));
  check("every grunt lineup species has a bulk entry", unmeasured.length === 0, unmeasured.slice(0, 5).join(", "));
  for (const t of grunts) {
    const lineup = distinct(t);
    const badTanks = (t.tanks || []).filter((k) =>
      !lineup.includes(k.name) || !((bulk.species?.[k.name] ?? -1) >= bulk.cutoff) || (k.seMoveTypes || []).length === 0);
    check(`${t.name}: ${(t.tanks || []).length} tank(s), each in the lineup, at or over the cutoff, with move types`,
      badTanks.length === 0, badTanks.map((k) => k.name).join(", "));
    const missedTanks = lineup.filter((n) => (bulk.species?.[n] ?? -1) >= bulk.cutoff && !(t.tanks || []).some((k) => k.name === n));
    check(`${t.name}: no lineup species over the cutoff is missing from tanks`, missedTanks.length === 0, missedTanks.join(", "));
  }
  for (const t of typed) {
    const plan = t.counterPlan || {};
    const windows = plan.windows || [];
    const placed = [...windows.flatMap((w) => w.covers || []), ...(plan.uncovered || [])];
    const lineup = distinct(t);
    check(`${t.name}: 1–2 windows, each with move types and someone to cover`,
      windows.length >= 1 && windows.length <= 2 && windows.every((w) => (w.types || []).length > 0 && (w.covers || []).length > 0),
      JSON.stringify(windows.map((w) => w.types)));
    check(`${t.name}: windows + uncovered partition the ${lineup.length} distinct lineup species`,
      placed.length === lineup.length && new Set(placed).size === placed.length && lineup.every((n) => placed.includes(n)),
      `placed ${placed.join(", ")}`);
  }
  // The builder keeps data order and never drops a typed grunt (D2), and
  // typed-grunt names are localized, so pair by position.
  for (const loc of localeNames) {
    const result = buildResult(loc);
    const bad = [];
    typed.forEach((t, i) => {
      const g = result.rocketTypedGrunts?.[i];
      if (!g) { bad.push(`${t.name} missing`); return; }
      if ((g.windows || []).length !== (t.counterPlan?.windows || []).length) bad.push(`${t.name} windows`);
      if ((g.windows || []).some((w) => !w.clause)) bad.push(`${t.name} empty window`);
      if ((g.tanks || []).length !== (t.tanks || []).length) bad.push(`${t.name} tanks`);
      if ((g.tanks || []).some((k) => !k.clause)) bad.push(`${t.name} empty tank filter`);
      if ((g.uncovered || []).length !== (t.counterPlan?.uncovered || []).length) bad.push(`${t.name} uncovered`);
    });
    // Generic grunts keep their per-phase counters and get no tank boxes;
    // their tanks are only marked in the counter groups.
    for (const g of result.rocketGenericGrunts || []) {
      if (g.tanks || g.windows) bad.push(`${g.name} grew windows or tank boxes`);
    }
    const generic = grunts.filter((t) => t.kind === "generic_grunt" && (t.tanks || []).length && t.counters?.length);
    for (const t of generic) {
      const g = (result.rocketGenericGrunts || []).find((x) => x.name === t.name);
      const marked = (g?.counters || []).some((c) => [...(c.pokemons || []), ...(c.alsoPokemons || [])].some((p) => p.tanky));
      if (!marked) bad.push(`${t.name} tanks not marked`);
    }
    check(`${loc}: typed windows and tanks render; generic grunts only mark tanks`, bad.length === 0, bad.slice(0, 5).join(", "));
  }
}

console.log(`\n${failures === 0 ? "✓ All data-filter property checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
