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
//   D13 — a forme in brackets ("Landorus (Incarnate)") resolves to its
//         species and that form's types, in event raids and event Max Battles
//         alike; a bare name takes the default form; an unknown forme is
//         skipped, never guessed
//   D14 — boss boxes that share an id within one list (Mega Charizard X and Y
//         are both CHARIZARD) still get distinct React and copy keys
//   D15 — an event Mega, lettered ("Mega Charizard X") or plain ("Mega
//         Gyarados"), resolves to its species' id and the Mega's own types,
//         joined from the game master's tempEvoOverrides to the dictionary's
//         name by words; a Mega the game master has no override for is
//         skipped, never given the base form's types
//   D16 — every boss carries its form, and an event dedupes against the
//         standing tiers by form where both sides name one: Origin Giratina
//         is not standing Altered Giratina. Where either side cannot be
//         placed (a Mega, a snapshot from before the field) it falls back to
//         the species, as it did before
//   D17 — a regional adjective ("Alolan Marowak", "Paldean Tauros (Blaze)")
//         resolves to that regional form's enum and types, in event raids and
//         Max Battles alike, and dedupes against a standing regional boss by
//         form; an adjective naming no form, or several, is skipped. Its box
//         is labelled with the region in every locale, so the Tauros breeds
//         read apart; a plain boss's label and a standing one's are unchanged

import RAID_BOSSES from "../src/data/raid-bosses.json";
import ROCKET_LINEUPS from "../src/data/rocket-lineups.json";
import LILY_TYPES from "./__fixtures__/lily-dex-types.json";
import { indexTypes, effVsPokemon } from "./lib/rocket-derive.mjs";
import { recurringTypesOf, KILLER_ONE_IN } from "./lib/rocket-cover.mjs";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";
import META_RANKINGS from "../src/data/meta-rankings.json";
import { buildDataFilters, buildResult, FIXTURE_CONFIG, makeTFn } from "./lib/fixture.mjs";
import { bossBoxKeys, bossCounterLabel } from "../src/App.jsx";
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
  GUARDED_FAMILIES, buildEventMaxBattles, buildEventRaids, buildNameIndex, deriveTiered, guardEmptiedFamilies,
  parseMaxEventBosses, resolveBossKey,
} from "./fetch-raid-bosses.mjs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// A boss's keys apart from the ones not every boss has: `gigantamax`, set only
// on a boss the title calls Gigantamax, and `form`, which a snapshot written
// before bosses carried one lacks. D12 and D13 compare event bosses to the
// committed snapshot's standing ones through this; D16 checks `form` itself.
const bossShape = (boss) => Object.keys(boss).filter((k) => k !== "gigantamax" && k !== "form").sort().join(",");

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
    maxTank: "meta-rankings.json, the 0.5-second charger moves",
  };
  // The event Max Battle list is empty between events by design, so it is
  // left to the panel line below, which flags only when the panel has no
  // attackers at all. Flagged here too, a day without a Max event would put
  // three warnings for one condition into the sync summary.
  const empty = FAMILIES.filter((f) => f !== "eventMaxBattleFilters")
    .filter((f) => leaves(byLocale.en[f], f).filter((l) => l.clause !== "").length === 0);
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
  // Sableye is left out of this synthetic index on purpose, so its event is
  // the unresolvable case. The real index resolves it.
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
  const standingKeys = bossShape(Object.values(RAID_BOSSES.raids)[0][0]);
  const bosses = out.entries.flatMap((e) => e.bosses);
  check(`each boss has the standing tiers' shape (${standingKeys}) and a form, plus a Gigantamax marker where the title says so`,
    bosses.every((b) => bossShape(b) === standingKeys && "form" in b) &&
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
  // The two checks above cannot catch an event family added to the guard:
  // bossCount reads an event array as zero bosses either way. So pin the list.
  check("guard: only the two standing rotations are guarded",
    JSON.stringify(GUARDED_FAMILIES) === JSON.stringify(["raids", "maxBattles"]), JSON.stringify(GUARDED_FAMILIES));
}

console.log("\nD13 — a forme in brackets resolves to its species and form, in event raids and Max Battles alike");
{
  // ScrapedDuck puts a forme in brackets: "Landorus (Incarnate)" in a
  // raid-battles boss list, "Giratina (Origin Forme)" in a raid-hour title. On
  // 2026-10-13 the first was skipped as unresolvable, because the name index
  // only knew bare species names. Both event builders resolve through one
  // function, so a synthetic feed goes through each. The templates are laid
  // out as the 2026-10-13 game master lays them out: a form-less template, one
  // per form, and a FORMS_ template listing the default form first. Zacian's
  // and Urshifu's form-less templates carry types neither default form has,
  // which is the case the default-form rule is for.
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.parse("2026-10-13T12:00:00Z");
  const feedTime = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 23);
  const en = (dex) => POKEMON_NAMES_DICT[String(dex)].en;
  const pad = (dex) => String(dex).padStart(4, "0");
  const T = (t) => (t ? `POKEMON_TYPE_${t}` : undefined);
  // A species template; form-less when `form` is null.
  const tpl = (dex, form, type, type2) => {
    const id = en(dex).toUpperCase();
    const templateId = `V${pad(dex)}_POKEMON_${id}${form ? `_${form}` : ""}`;
    const pokemonSettings = { pokemonId: id, ...(form && { form: `${id}_${form}` }), type: T(type), type2: T(type2) };
    return { templateId, data: { templateId, pokemonSettings } };
  };
  const formList = (dex, ...forms) => {
    const id = en(dex).toUpperCase();
    const templateId = `FORMS_V${pad(dex)}_POKEMON_${id}`;
    return { templateId, data: { templateId, formSettings: { pokemon: id, forms: forms.map((f) => ({ form: `${id}_${f}` })) } } };
  };
  const nameIdx = buildNameIndex([
    tpl(487, null, "GHOST", "DRAGON"), tpl(487, "ALTERED", "GHOST", "DRAGON"), tpl(487, "ORIGIN", "GHOST", "DRAGON"),
    formList(487, "ALTERED", "ORIGIN"),
    tpl(555, null, "FIRE"), tpl(555, "GALARIAN_STANDARD", "ICE"), tpl(555, "GALARIAN_ZEN", "ICE", "FIRE"),
    tpl(555, "STANDARD", "FIRE"), tpl(555, "ZEN", "FIRE", "PSYCHIC"),
    formList(555, "STANDARD", "ZEN", "GALARIAN_STANDARD", "GALARIAN_ZEN"),
    tpl(645, null, "GROUND", "FLYING"), tpl(645, "INCARNATE", "GROUND", "FLYING"), tpl(645, "THERIAN", "GROUND", "FLYING"),
    formList(645, "INCARNATE", "THERIAN"),
    tpl(741, null, "FIRE", "FLYING"), tpl(741, "BAILE", "FIRE", "FLYING"), tpl(741, "PAU", "PSYCHIC", "FLYING"),
    tpl(741, "POMPOM", "ELECTRIC", "FLYING"), tpl(741, "SENSU", "GHOST", "FLYING"),
    formList(741, "BAILE", "POMPOM", "PAU", "SENSU"),
    tpl(888, null, "FAIRY", "STEEL"), tpl(888, "CROWNED_SWORD", "FAIRY", "STEEL"), tpl(888, "HERO", "FAIRY"),
    formList(888, "HERO", "CROWNED_SWORD"),
    tpl(892, null, "FIGHTING"), tpl(892, "RAPID_STRIKE", "FIGHTING", "WATER"), tpl(892, "SINGLE_STRIKE", "FIGHTING", "DARK"),
    formList(892, "SINGLE_STRIKE", "RAPID_STRIKE"),
    tpl(898, null, "PSYCHIC", "GRASS"), tpl(898, "ICE_RIDER", "PSYCHIC", "ICE"), tpl(898, "NORMAL", "PSYCHIC", "GRASS"),
    tpl(898, "SHADOW_RIDER", "PSYCHIC", "GHOST"), formList(898, "NORMAL", "ICE_RIDER", "SHADOW_RIDER"),
  ], POKEMON_NAMES_DICT);
  const species = (dex) => nameIdx.get(en(dex).toLowerCase());
  const typesOf = (hit) => (hit ? hit.types.join("/") : "unresolved");

  const bare = [888, 892, 645, 555].map((dex) => typesOf(species(dex))).join(", ");
  check("a bare name takes the default form's types, not the form-less template's, where the two differ",
    bare === "Fairy, Fighting/Dark, Ground/Flying, Fire", bare);

  // Index keys, as nameKey() spells them: lowercase, straight apostrophes.
  const key = (dex, forme) => `${en(dex)} (${forme})`.toLowerCase();
  const cases = [
    [key(645, "Incarnate"), "Ground/Flying", "the forme alone, as raid-battles boss lists spell it"],
    [key(487, "Origin Forme"), "Ghost/Dragon", "with \"Forme\", as event titles spell it"],
    [key(888, "Crowned Sword"), "Fairy/Steel", "a two-word form"],
    [key(892, "Rapid Strike Style"), "Fighting/Water", "a form whose types the default form lacks"],
    [key(555, "Zen Mode"), "Fire/Psychic", "only the suffix the words cover"],
    [key(555, "Galarian Zen Mode"), "Ice/Fire", "the longest suffix the words cover"],
    [key(741, "Pa'u Style"), "Psychic/Flying", "an apostrophe inside a word"],
    [key(741, "Pom-Pom Style"), "Electric/Flying", "a hyphen inside a word"],
    [key(898, "Shadow Rider"), "Psychic/Ghost", "a form named with a tier word"],
    [key(645, "Origin Forme"), "unresolved", "another species' form"],
    [key(888, "Crowned"), "unresolved", "half a form's words"],
    [key(555, "Galarian Standard Zen"), "unresolved", "two forms matching equally well"],
    [key(302, "Incarnate"), "unresolved", "a species the index does not hold"],
  ];
  for (const [k, want, why] of cases) {
    const got = typesOf(resolveBossKey(nameIdx, k));
    check(`"${k}" → ${want}: ${why}`, got === want, got === want ? "" : got);
  }
  const hit = resolveBossKey(nameIdx, key(645, "Incarnate"));
  check("a forme resolves to the species' id and dictionary name, and to the form's own enum",
    hit?.id === species(645)?.id && hit?.displayName === en(645) && hit?.form === `${species(645)?.id}_INCARNATE` &&
      Object.keys(hit).sort().join() === "displayName,form,id,types", JSON.stringify(hit));
  check("a bare name is still a plain lookup", resolveBossKey(nameIdx, en(645).toLowerCase()) === species(645));

  // ScrapedDuck's shape: raid-battles events list their bosses in extraData,
  // raid-hour events only have the title.
  const ev = (eventID, eventType, name, bosses) => ({
    eventID, name, eventType, start: feedTime(NOW - HOUR), end: feedTime(NOW + DAY),
    extraData: bosses
      ? { raidbattles: { bosses: bosses.map((b) => ({ name: b, canBeShiny: true })) } }
      : { generic: { hasSpawns: false, hasFieldResearchTasks: false } },
  });
  const feed = [
    // The event the fetcher skipped on 2026-10-13, as the live feed published it.
    ev("zz-landorus", "raid-battles", `Shadow ${en(645)} (Incarnate Forme) in Shadow Raids`, [`${en(645)} (Incarnate)`]),
    ev("zz-giratina", "raid-hour", `${en(487)} (Origin Forme) Raid Hour`),
    ev("zz-urshifu", "raid-battles", `${en(892)} (Rapid Strike Style) in 5-star Raid Battles`, [`${en(892)} (Rapid Strike)`]),
    ev("zz-unknown", "raid-battles", `${en(645)} (Origin Forme) in 5-star Raid Battles`, [`${en(645)} (Origin)`]),
    ev("zz-calyrex", "raid-battles", `${en(898)} (Shadow Rider) in 5-star Raid Battles`, [`${en(898)} (Shadow Rider)`]),
    ev("zz-max", "max-battles", `Gigantamax ${en(892)} (Rapid Strike Style) Max Battle Day`),
  ];
  const quietly = (build) => {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      return { ...build(), warnings };
    } finally {
      console.warn = realWarn;
    }
  };
  const raids = quietly(() => buildEventRaids(feed, { nameIdx, allTypes: LILY_TYPES, raids: {}, now: NOW }));
  const raidEvent = (id) => raids.entries.find((e) => e.eventID === id);
  const landorus = raidEvent("zz-landorus")?.bosses?.[0];
  check("the Shadow Landorus event the live feed lost resolves, as a shadow raid of the species",
    raidEvent("zz-landorus")?.isShadow === true && landorus?.id === species(645)?.id &&
      landorus?.names?.en === en(645) && landorus?.types?.join("/") === "ground/flying",
    JSON.stringify(landorus));
  check("a forme in a raid-hour title resolves too",
    raidEvent("zz-giratina")?.bosses?.[0]?.names?.en === en(487));
  // Electric hits Rapid Strike Urshifu's water side super-effectively, and is
  // neutral on Single Strike's fighting/dark, so this tells the forms apart.
  const urshifu = raidEvent("zz-urshifu")?.bosses?.[0];
  check("the form's types reach the derived boss, and so its counters",
    urshifu?.types?.join("/") === "fighting/water" && urshifu?.seMoveTypes?.includes("electric"), JSON.stringify(urshifu?.types));
  const calyrex = raidEvent("zz-calyrex");
  check("a tier word inside the brackets is part of the name, not a Shadow raid",
    calyrex?.isShadow === false && calyrex?.bosses?.[0]?.types?.join("/") === "psychic/ghost",
    JSON.stringify({ isShadow: calyrex?.isShadow, types: calyrex?.bosses?.[0]?.types }));
  const warned = raids.unresolved === 1 && raids.warnings.some((w) => w.includes(`"${en(645)} (Origin)"`));
  check("an unknown forme is skipped with a warning, never resolved to the bare species",
    !raidEvent("zz-unknown") && warned, warned ? "" : raids.warnings.join(" | "));

  const standing = { shadow_lvl5: [{ id: species(645)?.id }] };
  const deduped = quietly(() => buildEventRaids(feed, { nameIdx, allTypes: LILY_TYPES, raids: standing, now: NOW }));
  check("with Landorus standing in shadow_lvl5, as on 2026-10-13, the event dedupes rather than failing to resolve",
    !deduped.entries.some((e) => e.eventID === "zz-landorus") && deduped.deduped === 1 && deduped.unresolved === 1,
    `${deduped.deduped} deduped, ${deduped.unresolved} unresolved`);

  const maxes = quietly(() => buildEventMaxBattles(feed, { nameIdx, allTypes: LILY_TYPES, maxBattles: {}, now: NOW }));
  const maxBoss = maxes.entries.find((e) => e.eventID === "zz-max")?.bosses?.[0];
  check("a Max Battle title's forme resolves through the same resolver",
    maxBoss?.types?.join("/") === "fighting/water" && maxBoss?.gigantamax === true && maxBoss?.names?.en === en(892),
    JSON.stringify(maxBoss));

  const events = [...raids.entries, ...maxes.entries];
  const standingKeys = bossShape(Object.values(RAID_BOSSES.raids)[0][0]);
  check(`forme bosses have the standing tiers' shape (${standingKeys}) and a form; no index internals leak`,
    events.flatMap((e) => e.bosses).every((b) => bossShape(b) === standingKeys && "form" in b));

  // Through the app: a forme boss builds a filter, and its name is the
  // species' in every locale, from the dictionary, as D12 checks for Max
  // Battles. The strict lookup, since pokemonNameFor falls back to English.
  const dataBoss = new Map(events.flatMap((e) => e.bosses.map((b) => [`${e.eventID}|${b.id}`, b])));
  const raidBosses = { ...RAID_BOSSES, eventRaids: raids.entries, eventMaxBattles: maxes.entries };
  for (const loc of localeNames) {
    const result = buildResult(loc, { raidBosses });
    const groups = [...(result.eventRaidFilters || []), ...(result.eventMaxBattleFilters || [])];
    const bad = groups.length === events.length ? [] : [`${groups.length} groups for ${events.length} events`];
    for (const g of groups) {
      for (const b of g.bosses || []) {
        const dexKey = resolveSpeciesInfo(dataBoss.get(`${g.eventID}|${b.id}`)?.names?.en, "en")?.dexKey;
        const expected = dexKey && POKEMON_NAMES_DICT[dexKey]?.[loc]?.toLowerCase();
        if (b.skipped || !b.clause) bad.push(`${g.eventID}/${b.id}: empty filter`);
        if (!expected || String(b.name).toLowerCase() !== expected) bad.push(`${g.eventID}/${b.id}: named "${b.name}", not "${expected}"`);
      }
    }
    check(`${loc}: ${groups.length} forme event(s) build a filter per boss, named from the dictionary`,
      groups.length > 0 && bad.length === 0, bad.slice(0, 4).join(" | "));
  }
}

console.log("\nD14 — boss boxes that share an id within one list get distinct keys");
{
  // A boss's id is the species enum, so one list can hold it twice: ScrapedDuck
  // listed "Mega Charizard X and Mega Charizard Y in Mega Raids" for
  // 2026-10-21, and both resolve to CHARIZARD. The raid and Max Battle panels
  // key each box, for React and for its copy state, by bossBoxKeys; keyed by
  // the bare id, the two boxes collided and copying one marked both copied.
  const keys = bossBoxKeys([{ id: "CHARIZARD" }, { id: "CHARIZARD" }, { id: "BLASTOISE" }, { id: "CHARIZARD" }]);
  check("repeats of an id get distinct keys, the first keeping the bare id",
    keys.join() === "CHARIZARD,CHARIZARD#2,BLASTOISE,CHARIZARD#3", keys.join());

  // Every list the app builds from the committed snapshot: keys are distinct,
  // and where no id repeats they are the bare ids, so copy state for such a
  // list is keyed as it was before.
  const result = buildResult("en", {});
  const lists = [
    ...Object.entries(result.raidFilters || {}),
    ...Object.entries(result.maxBattleFilters || {}),
    ...[...(result.eventRaidFilters || []), ...(result.eventMaxBattleFilters || [])].map((g) => [g.eventID, g.bosses]),
  ];
  const bad = lists.flatMap(([label, list]) => {
    const k = bossBoxKeys(list);
    const ids = list.map((b) => String(b.id));
    if (new Set(k).size !== k.length) return [`${label}: repeated key`];
    if (new Set(ids).size === ids.length && k.join() !== ids.join()) return [`${label}: unique ids not kept`];
    return [];
  });
  check(`snapshot: all ${lists.length} boss list(s) get distinct keys, the bare id where no id repeats`,
    lists.length > 0 && bad.length === 0, bad.slice(0, 4).join(" | "));

  // Through the app's builder: an event with two bosses sharing an id keeps
  // both, and they key apart. The bosses are the snapshot's first standing
  // boss twice, the second with other types, as a lettered Mega pair arrives.
  const [first] = Object.values(RAID_BOSSES.raids)[0];
  const twin = { ...first, names: { en: `${first.names?.en ?? first.id} twin` }, types: ["fire", "dragon"] };
  const raidBosses = {
    ...RAID_BOSSES,
    eventRaids: [{ eventID: "zz-pair", name: "pair", eventType: "raid-battles", start: null, end: null,
      isShadow: false, isMega: true, bosses: [first, twin] }],
  };
  const group = (buildResult("en", { raidBosses }).eventRaidFilters || []).find((g) => g.eventID === "zz-pair");
  const pairKeys = bossBoxKeys(group?.bosses);
  check("an event with two bosses sharing an id builds both, keyed apart",
    group?.bosses?.length === 2 && group.bosses.every((b) => b.id === first.id) && new Set(pairKeys).size === 2,
    JSON.stringify(pairKeys));
}

console.log("\nD15 — an event Mega resolves to its species and the Mega's own types");
{
  // ScrapedDuck listed "Mega Charizard X and Mega Charizard Y in Mega Raids"
  // for 2026-10-21 to 10-27. On 2026-10-14, inside the 7-day window, the
  // fetcher skipped both bosses: with the tier word stripped, "Charizard X" is
  // no species name. A plain Mega did resolve that way, to the base form's
  // types: water/flying for Mega Gyarados, which is water/dark. The index now
  // holds each temporary evolution under the dictionary's name for it, with
  // the types the game master's tempEvoOverrides give it, and an event Mega is
  // looked up by that name. The templates are laid out as in the 2026-10-13
  // game master: the overrides sit on the form-less template and on the
  // default form's alike, and some carry no tempEvoId at all.
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.parse("2026-10-14T12:00:00Z");
  const feedTime = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 23);
  // Names straight from the dictionary: a species by dex, a temporary
  // evolution by its Niantic text key ("6_2" is Mega Charizard X).
  const en = (dexKey) => POKEMON_NAMES_DICT[String(dexKey)].en;
  const pad = (dex) => String(dex).padStart(4, "0");
  const T = (t) => (t ? `POKEMON_TYPE_${t}` : undefined);
  const evo = (id, type, type2) => ({ tempEvoId: `TEMP_EVOLUTION_${id}`, typeOverride1: T(type), typeOverride2: T(type2) });
  const tpl = (dex, form, [type, type2], tempEvoOverrides) => {
    const id = en(dex).toUpperCase();
    const templateId = `V${pad(dex)}_POKEMON_${id}${form ? `_${form}` : ""}`;
    const pokemonSettings = {
      pokemonId: id, ...(form && { form: `${id}_${form}` }), type: T(type), type2: T(type2), tempEvoOverrides,
    };
    return { templateId, data: { templateId, pokemonSettings } };
  };
  const species = (dex, types, overrides) => {
    const id = en(dex).toUpperCase();
    const templateId = `FORMS_V${pad(dex)}_POKEMON_${id}`;
    return [
      tpl(dex, null, types, overrides), tpl(dex, "NORMAL", types, overrides),
      { templateId, data: { templateId, formSettings: { pokemon: id, forms: [{ form: `${id}_NORMAL` }] } } },
    ];
  };
  const nameIdx = buildNameIndex([
    ...species(6, ["FIRE", "FLYING"], [evo("MEGA_X", "FIRE", "DRAGON"), evo("MEGA_Y", "FIRE", "FLYING"), {}]),
    ...species(150, ["PSYCHIC"], [evo("MEGA_X", "PSYCHIC", "FIGHTING"), evo("MEGA_Y", "PSYCHIC")]),
    ...species(130, ["WATER", "FLYING"], [evo("MEGA", "WATER", "DARK")]),
    // The dictionary also names a Mega Absol Z (359_2), which no override
    // matches.
    ...species(359, ["DARK"], [evo("MEGA", "DARK")]),
    // The dictionary names a Mega Clefable (36_1); the 2026-10-13 game master
    // carries no override for it.
    ...species(36, ["FAIRY"], undefined),
    ...species(383, ["GROUND"], [evo("PRIMAL", "GROUND", "FIRE")]),
  ], POKEMON_NAMES_DICT);
  const key = (dexKey) => en(dexKey).toLowerCase();
  const typesOf = (hit) => (hit ? hit.types.join("/") : "unresolved");

  const cases = [
    [key("6_2"), "Fire/Dragon", "a lettered Mega, under the dictionary's name for it"],
    [key("6_3"), "Fire/Flying", "its sibling, with the other override's types"],
    [key("150_2"), "Psychic/Fighting", "another lettered Mega"],
    [key("130_1"), "Water/Dark", "a plain Mega, with the Mega's types, not the base form's"],
    [key("383_4"), "Ground/Fire", "a Primal, joined by the same words"],
    [key(6), "Fire/Flying", "the species itself keeps the default form's types"],
    [key(130), "Water/Flying", "and so does a plain Mega's species"],
    [`${key(6)} x`, "unresolved", "the name with its tier word stripped, which is no species"],
    [key("359_2"), "unresolved", "a lettered Mega the game master has no override for"],
    [key("36_1"), "unresolved", "a plain Mega the game master has no override for"],
  ];
  for (const [k, want, why] of cases) {
    const got = typesOf(resolveBossKey(nameIdx, k));
    check(`"${k}" → ${want}: ${why}`, got === want, got === want ? "" : got);
  }
  const x = resolveBossKey(nameIdx, key("6_2"));
  // No form: a temporary evolution is no game-master form, so a Mega dedupes
  // by species, as D16 has a standing Mega do.
  check("a lettered Mega carries its species' id, no form and the dictionary's name for it, nothing else",
    x?.id === nameIdx.get(key(6))?.id && x?.form === null && x?.displayName === en("6_2") &&
      Object.keys(x).sort().join() === "displayName,form,id,types", JSON.stringify(x));

  // ScrapedDuck's shape, as the live feed published the 10-21 event, plus a
  // raid-day title, which carries only the title.
  const ev = (eventID, eventType, name, bosses, start = NOW + 7 * DAY - 6 * HOUR) => ({
    eventID, name, eventType, start: feedTime(start), end: feedTime(start + 6 * DAY + 16 * HOUR),
    extraData: bosses
      ? { raidbattles: { bosses: bosses.map((b) => ({ name: b, canBeShiny: true })) } }
      : { generic: { hasSpawns: false, hasFieldResearchTasks: false } },
  });
  const feed = [
    ev("zz-xy", "raid-battles", `${en("6_2")} and ${en("6_3")} in Mega Raids`, [en("6_2"), en("6_3")]),
    ev("zz-raid-day", "raid-day", `${en("150_2")} Raid Day`, null, NOW + DAY),
    ev("zz-gyarados", "raid-battles", `${en("130_1")} in Mega Raids`, [en("130_1")], NOW - HOUR),
    ev("zz-z", "raid-battles", `${en("359_2")} in Mega Raids`, [en("359_2")], NOW + 2 * DAY),
    ev("zz-clefable", "raid-battles", `${en("36_1")} in Mega Raids`, [en("36_1")], NOW + 3 * DAY),
  ];
  const quietly = (build) => {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      return { ...build(), warnings };
    } finally {
      console.warn = realWarn;
    }
  };
  const raids = quietly(() => buildEventRaids(feed, { nameIdx, allTypes: LILY_TYPES, raids: {}, now: NOW }));
  const raidEvent = (id) => raids.entries.find((e) => e.eventID === id);
  const [megaX, megaY] = raidEvent("zz-xy")?.bosses || [];
  check("the 10-21 event the fetcher skipped surfaces as a Mega raid with both bosses, as their species",
    raidEvent("zz-xy")?.isMega === true && megaX?.id === x?.id && megaY?.id === x?.id &&
      megaX?.names?.en === en("6_2") && megaY?.names?.en === en("6_3"),
    JSON.stringify(raidEvent("zz-xy")?.bosses?.map((b) => [b.id, b.names?.en])));
  // Dragon hits Mega Charizard X's dragon side, and water is neutral on it;
  // on Mega Charizard Y it is the other way round. So the counters tell the
  // two apart, and tell X from the base form, whose types Y shares.
  check("each Mega's own types reach the derived boss, and so its counters",
    megaX?.types?.join("/") === "fire/dragon" && megaX.seMoveTypes.includes("dragon") && !megaX.seMoveTypes.includes("water") &&
      megaY?.types?.join("/") === "fire/flying" && megaY.seMoveTypes.includes("water") && !megaY.seMoveTypes.includes("dragon"),
    JSON.stringify({ x: megaX?.seMoveTypes, y: megaY?.seMoveTypes }));
  const raidDay = raidEvent("zz-raid-day")?.bosses?.[0];
  check("a lettered Mega in a raid-day title resolves too",
    raidDay?.types?.join("/") === "psychic/fighting" && raidDay?.names?.en === en("150_2"), JSON.stringify(raidDay));
  // Fighting hits Mega Gyarados' dark side and is resisted by the base form's
  // flying one; rock is the other way round, resisted by water and neutral on
  // dark. So the counters tell the Mega from the base form.
  const gyarados = raidEvent("zz-gyarados")?.bosses?.[0];
  check("a plain Mega is named and typed as the Mega, not its base form, under its species' id",
    gyarados?.id === nameIdx.get(key(130))?.id && gyarados?.names?.en === en("130_1") &&
      gyarados?.types?.join("/") === "water/dark" && gyarados.seMoveTypes.includes("fighting") &&
      !gyarados.seMoveTypes.includes("rock"),
    JSON.stringify(gyarados && { names: gyarados.names, types: gyarados.types, se: gyarados.seMoveTypes }));
  const skipped = ["359_2", "36_1"].filter((k) => raids.warnings.some((w) => w.includes(`"${en(k)}"`)));
  check("a lettered and a plain Mega the game master has no override for are skipped with a warning, never given the species' types",
    !raidEvent("zz-z") && !raidEvent("zz-clefable") && raids.unresolved === 2 && skipped.length === 2,
    `${raids.unresolved} unresolved; ${raids.warnings.join(" | ")}`);
  const standingKeys = bossShape(Object.values(RAID_BOSSES.raids)[0][0]);
  check(`Mega bosses have the standing tiers' shape (${standingKeys}) and a null form; no index internals leak`,
    raids.entries.flatMap((e) => e.bosses).every((b) => bossShape(b) === standingKeys && b.form === null));

  // Dedupe stays the species' id with the Mega flag: lily-dex-api's standing
  // mega tier lists Mega Raichu X as RAICHU and Mega Gyarados as GYARADOS,
  // with pokemon-go-api's Mega suffix as the form, which places no game-master
  // form (D16). A standing non-Mega of the species is a different battle.
  const dedupedBy = (standing) =>
    quietly(() => buildEventRaids(feed, { nameIdx, allTypes: LILY_TYPES, raids: standing, now: NOW }));
  const megaTier = dedupedBy({ mega: [{ id: x?.id, form: `${x?.id}_MEGA_X` }, { id: gyarados?.id, form: `${gyarados?.id}_MEGA` }] });
  const lvl5 = dedupedBy({ lvl5: [{ id: x?.id, form: x?.id }, { id: gyarados?.id, form: gyarados?.id }] });
  const surfaced = (run, id) => run.entries.some((e) => e.eventID === id);
  check("with Charizard and Gyarados standing in the mega tier their events dedupe; in lvl5 they do not",
    !surfaced(megaTier, "zz-xy") && !surfaced(megaTier, "zz-gyarados") && megaTier.deduped === 2 &&
      surfaced(lvl5, "zz-xy") && surfaced(lvl5, "zz-gyarados"),
    `${megaTier.deduped} deduped against mega, ${lvl5.entries.length} surfaced against lvl5`);

  // Through the app: each Mega is named from its own dictionary entry in every
  // locale, not the species', and builds its own filter; X and Y key apart.
  // The strict lookup, since pokemonNameFor falls back to English.
  const raidBosses = { ...RAID_BOSSES, eventRaids: raids.entries };
  const expectedKeys = { "zz-xy": ["6_2", "6_3"], "zz-gyarados": ["130_1"] };
  for (const loc of localeNames) {
    const groups = buildResult(loc, { raidBosses }).eventRaidFilters || [];
    const bad = [];
    for (const [eventID, dictKeys] of Object.entries(expectedKeys)) {
      const group = groups.find((g) => g.eventID === eventID);
      const data = raidEvent(eventID)?.bosses || [];
      if ((group?.bosses || []).length !== dictKeys.length) bad.push(`${eventID}: ${(group?.bosses || []).length} bosses`);
      (group?.bosses || []).forEach((b, i) => {
        const dexKey = resolveSpeciesInfo(data[i]?.names?.en, "en")?.dexKey;
        const expected = POKEMON_NAMES_DICT[dictKeys[i]]?.[loc]?.toLowerCase();
        if (dexKey !== dictKeys[i]) bad.push(`${b.id}: resolves to dictionary key ${dexKey}`);
        if (b.skipped || !b.clause) bad.push(`${b.id}: empty filter`);
        if (!expected || String(b.name).toLowerCase() !== expected) bad.push(`${b.id}: named "${b.name}", not "${expected}"`);
      });
    }
    const xy = groups.find((g) => g.eventID === "zz-xy");
    if (xy && xy.bosses[0]?.clause === xy.bosses[1]?.clause) bad.push("X and Y build the same filter");
    if (xy && new Set(bossBoxKeys(xy.bosses)).size !== 2) bad.push("X and Y share a key");
    check(`${loc}: Mega Charizard X, Y and Mega Gyarados build their own filters, named from the dictionary`,
      bad.length === 0, bad.slice(0, 4).join(" | "));
  }
}

console.log("\nD16 — every boss carries its form; events dedupe by form where both sides name one, by species otherwise");
{
  // lily-dex-api relays pokemon-go-api's `form`, which spells a boss three
  // ways: the bare id for a plain species ("YVELTAL"), the game master's enum
  // for a named forme ("LANDORUS_INCARNATE", as it published Shadow Landorus
  // on 2026-10-14), and a suffix of its own for a Mega ("BLASTOISE_MEGA").
  // The dedupe used to compare species ids alone, so a "Giratina (Origin
  // Forme)" event was dropped against a standing Altered Giratina and its own
  // types never shown. The species are picked for their form layout, not for
  // any place in the rotation: three with a named default form (Giratina,
  // Landorus, Urshifu), two with a NORMAL one (Yveltal, Blastoise). The
  // templates are laid out as D13 lays them out, Blastoise's with the Mega
  // override the game master gives it: an event Mega resolves by its own
  // name, through that override (D15).
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.parse("2026-10-14T12:00:00Z");
  const feedTime = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 23);
  const en = (dex) => POKEMON_NAMES_DICT[String(dex)].en;
  const ID = (dex) => en(dex).toUpperCase();
  const pad = (dex) => String(dex).padStart(4, "0");
  const T = (t) => (t ? `POKEMON_TYPE_${t}` : undefined);
  const tpl = (dex, form, type, type2, tempEvoOverrides) => {
    const templateId = `V${pad(dex)}_POKEMON_${ID(dex)}${form ? `_${form}` : ""}`;
    const pokemonSettings = {
      pokemonId: ID(dex), ...(form && { form: `${ID(dex)}_${form}` }), type: T(type), type2: T(type2), tempEvoOverrides,
    };
    return { templateId, data: { templateId, pokemonSettings } };
  };
  const formList = (dex, ...forms) => {
    const templateId = `FORMS_V${pad(dex)}_POKEMON_${ID(dex)}`;
    return { templateId, data: { templateId, formSettings: { pokemon: ID(dex), forms: forms.map((f) => ({ form: `${ID(dex)}_${f}` })) } } };
  };
  const megaBlastoise = [{ tempEvoId: "TEMP_EVOLUTION_MEGA", typeOverride1: T("WATER") }];
  const nameIdx = buildNameIndex([
    tpl(9, null, "WATER", undefined, megaBlastoise), tpl(9, "NORMAL", "WATER", undefined, megaBlastoise),
    formList(9, "NORMAL"),
    tpl(487, null, "GHOST", "DRAGON"), tpl(487, "ALTERED", "GHOST", "DRAGON"), tpl(487, "ORIGIN", "GHOST", "DRAGON"),
    formList(487, "ALTERED", "ORIGIN"),
    tpl(645, null, "GROUND", "FLYING"), tpl(645, "INCARNATE", "GROUND", "FLYING"), tpl(645, "THERIAN", "GROUND", "FLYING"),
    formList(645, "INCARNATE", "THERIAN"),
    tpl(717, null, "DARK", "FLYING"), tpl(717, "NORMAL", "DARK", "FLYING"), formList(717, "NORMAL"),
    tpl(892, null, "FIGHTING"), tpl(892, "RAPID_STRIKE", "FIGHTING", "WATER"), tpl(892, "SINGLE_STRIKE", "FIGHTING", "DARK"),
    formList(892, "SINGLE_STRIKE", "RAPID_STRIKE"),
  ], POKEMON_NAMES_DICT);

  // A standing boss as lily-dex-api's currentList carries it; no `form` key
  // at all when `form` is undefined.
  const lily = (dex, form, ...types) => ({ id: ID(dex), ...(form !== undefined && { form }), names: { English: en(dex) }, types });
  const ev = (eventID, eventType, name, bosses) => ({
    eventID, name, eventType, start: feedTime(NOW - HOUR), end: feedTime(NOW + DAY),
    extraData: bosses
      ? { raidbattles: { bosses: bosses.map((b) => ({ name: b, canBeShiny: true })) } }
      : { generic: { hasSpawns: false, hasFieldResearchTasks: false } },
  });
  const feed = [
    ev("zz-origin", "raid-hour", `${en(487)} (Origin Forme) Raid Hour`),
    ev("zz-giratina", "raid-hour", `${en(487)} Raid Hour`),
    ev("zz-yveltal", "raid-battles", `${en(717)} in 5-star Raid Battles`, [en(717)]),
    ev("zz-mega", "raid-battles", `Mega ${en(9)} in Mega Raids`, [`Mega ${en(9)}`]),
    ev("zz-landorus", "raid-battles", `Shadow ${en(645)} (Incarnate Forme) in Shadow Raids`, [`${en(645)} (Incarnate)`]),
  ];
  const quietly = (build) => {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      return { ...build(), warnings };
    } finally {
      console.warn = realWarn;
    }
  };
  const run = (raids) => quietly(() => buildEventRaids(feed, { nameIdx, allTypes: LILY_TYPES, raids, now: NOW }));
  const surfaced = (out) => out.entries.map((e) => e.eventID).sort().join(",");
  const bossOf = (out, eventID) => out.entries.find((e) => e.eventID === eventID)?.bosses?.[0];

  // As the 2026-10-14 rotation spelled its bosses, through the fetcher's own
  // derivation, plus a boss with no form at all.
  const tiers = deriveTiered({
    lvl5: [lily(487, `${ID(487)}_ALTERED`, "Ghost", "Dragon"), lily(717, ID(717), "Dark", "Flying")],
    lvl3: [lily(892, undefined, "Fighting", "Dark")],
    mega: [lily(9, `${ID(9)}_MEGA`, "Water")],
    shadow_lvl5: [lily(645, `${ID(645)}_INCARNATE`, "Ground", "Flying")],
  }, LILY_TYPES);
  const kept = JSON.stringify(Object.values(tiers).flat().map((b) => b.form));
  check("a standing boss keeps lily-dex-api's form as spelled, and null where it gave none", kept ===
    JSON.stringify([`${ID(487)}_ALTERED`, ID(717), null, `${ID(9)}_MEGA`, `${ID(645)}_INCARNATE`]), kept);

  const live = run(tiers);
  check("against that rotation, only the Origin forme event surfaces",
    surfaced(live) === "zz-origin" && live.deduped === 4 && live.unresolved === 0 && live.warnings.length === 0,
    `${surfaced(live)}; ${live.deduped} deduped, ${live.unresolved} unresolved`);
  const origin = bossOf(live, "zz-origin");
  check("the Origin event names its form and keeps its species id",
    origin?.form === `${ID(487)}_ORIGIN` && origin?.id === ID(487) && origin?.types?.join("/") === "ghost/dragon",
    JSON.stringify({ form: origin?.form, id: origin?.id }));

  // pokemon-go-api's own pokedex spells Giratina's base GIRATINA, with the
  // formes beside it. Either spelling of the default form is the one a bare
  // event name stands for.
  const base = run(deriveTiered({ lvl5: [lily(487, ID(487), "Ghost", "Dragon")] }, LILY_TYPES));
  check("a standing boss spelled by its bare id is the species' default form, as a bare event name is",
    !surfaced(base).includes("zz-giratina") && surfaced(base).includes("zz-origin"), surfaced(base));
  check("a bare event name carries the default form's enum: NORMAL for a plain species",
    bossOf(base, "zz-yveltal")?.form === `${ID(717)}_NORMAL`, bossOf(base, "zz-yveltal")?.form);

  const swapped = run(deriveTiered({ lvl5: [lily(487, `${ID(487)}_ORIGIN`, "Ghost", "Dragon")] }, LILY_TYPES));
  check("with Origin standing, the Origin event dedupes and the plain one surfaces as Altered",
    !surfaced(swapped).includes("zz-origin") && bossOf(swapped, "zz-giratina")?.form === `${ID(487)}_ALTERED`,
    `${surfaced(swapped)}; ${bossOf(swapped, "zz-giratina")?.form}`);

  const giratinas = (out) => ["zz-origin", "zz-giratina"].filter((id) => surfaced(out).includes(id)).join(",") || "none";
  const formless = run({ lvl5: [{ id: ID(487) }] });
  check("a standing boss with no form, as the committed snapshot and the guard's kept tiers have, dedupes by species",
    giratinas(formless) === "none", giratinas(formless));
  const unplaced = run(deriveTiered({ lvl5: [lily(487, `${ID(487)}_SKY`, "Ghost", "Dragon")] }, LILY_TYPES));
  check("so does one whose form the game master does not list, rather than letting a duplicate through",
    giratinas(unplaced) === "none", giratinas(unplaced));

  const notShadow = run(deriveTiered({ lvl5: [lily(645, `${ID(645)}_INCARNATE`, "Ground", "Flying")] }, LILY_TYPES));
  check("the same form in another tier is still another raid: plain Landorus leaves the Shadow event standing",
    surfaced(notShadow).includes("zz-landorus"), surfaced(notShadow));

  // Max Battles go through the same comparison.
  const maxFeed = [
    ev("zz-max-rapid", "max-battles", `Dynamax ${en(892)} (Rapid Strike Style) Max Battle Day`),
    ev("zz-max-bare", "max-battles", `Dynamax ${en(892)} Max Battle Day`),
  ];
  const maxes = quietly(() => buildEventMaxBattles(maxFeed, {
    nameIdx, allTypes: LILY_TYPES, now: NOW,
    maxBattles: deriveTiered({ tier_5: [lily(892, `${ID(892)}_SINGLE_STRIKE`, "Fighting", "Dark")] }, LILY_TYPES),
  }));
  check("a standing Single Strike Urshifu dedupes the bare Max Battle Day, not the Rapid Strike one",
    surfaced(maxes) === "zz-max-rapid" && bossOf(maxes, "zz-max-rapid")?.form === `${ID(892)}_RAPID_STRIKE`,
    `${surfaced(maxes)}; ${bossOf(maxes, "zz-max-rapid")?.form}`);

  // The app reads no `form`: a standing tier builds the same filters with it
  // as without it.
  const strip = (t) => Object.fromEntries(Object.entries(t).map(([k, list]) => [k, list.map(({ form, ...b }) => b)]));
  const withForm = JSON.stringify(buildResult("en", { raidBosses: { ...RAID_BOSSES, raids: tiers } }).raidFilters);
  const withoutForm = JSON.stringify(buildResult("en", { raidBosses: { ...RAID_BOSSES, raids: strip(tiers) } }).raidFilters);
  check("the app builds a standing boss the same with its form as without it", withForm === withoutForm);
}

console.log("\nD17 — a regional adjective resolves to that regional form, and dedupes against it by form");
{
  // Leek Duck names a regional boss with an adjective ahead of the species:
  // "Alolan Marowak Raid Day" (2020-10-31), and "Paldean Tauros (Blaze)",
  // "(Aqua)", "(Combat)" in Journey to Paldea's raids (2025-12-02). The name
  // index is keyed by species name, so before this every such boss was
  // skipped as unresolvable. The species are picked for their form layout:
  // one regional form under each head the 2026-10-13 game master carries
  // (ALOLA, GALARIAN, HISUIAN, PALDEA), two regions on one species (Meowth),
  // a region heading several forms (Tauros's breeds, Darmanitan's modes), and a
  // two-word species name (Mr. Mime). The templates are laid out as D13 lays
  // them out.
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.parse("2026-10-14T12:00:00Z");
  const feedTime = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 23);
  const en = (dex) => POKEMON_NAMES_DICT[String(dex)].en;
  // The game's enum spelling: "Mr. Mime" is MR_MIME.
  const ID = (dex) => en(dex).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/_$/, "");
  const pad = (dex) => String(dex).padStart(4, "0");
  const T = (t) => (t ? `POKEMON_TYPE_${t}` : undefined);
  const tpl = (dex, form, type, type2) => {
    const templateId = `V${pad(dex)}_POKEMON_${ID(dex)}${form ? `_${form}` : ""}`;
    const pokemonSettings = { pokemonId: ID(dex), ...(form && { form: `${ID(dex)}_${form}` }), type: T(type), type2: T(type2) };
    return { templateId, data: { templateId, pokemonSettings } };
  };
  const formList = (dex, ...forms) => {
    const templateId = `FORMS_V${pad(dex)}_POKEMON_${ID(dex)}`;
    return { templateId, data: { templateId, formSettings: { pokemon: ID(dex), forms: forms.map((f) => ({ form: `${ID(dex)}_${f}` })) } } };
  };
  const nameIdx = buildNameIndex([
    tpl(52, null, "NORMAL"), tpl(52, "NORMAL", "NORMAL"), tpl(52, "ALOLA", "DARK"), tpl(52, "GALARIAN", "STEEL"),
    formList(52, "NORMAL", "ALOLA", "GALARIAN"),
    tpl(58, null, "FIRE"), tpl(58, "NORMAL", "FIRE"), tpl(58, "HISUIAN", "FIRE", "ROCK"), formList(58, "NORMAL", "HISUIAN"),
    tpl(105, null, "GROUND"), tpl(105, "NORMAL", "GROUND"), tpl(105, "ALOLA", "FIRE", "GHOST"), formList(105, "NORMAL", "ALOLA"),
    tpl(122, null, "PSYCHIC", "FAIRY"), tpl(122, "NORMAL", "PSYCHIC", "FAIRY"), tpl(122, "GALARIAN", "ICE", "PSYCHIC"),
    formList(122, "NORMAL", "GALARIAN"),
    tpl(128, null, "NORMAL"), tpl(128, "NORMAL", "NORMAL"), tpl(128, "PALDEA_AQUA", "FIGHTING", "WATER"),
    tpl(128, "PALDEA_BLAZE", "FIGHTING", "FIRE"), tpl(128, "PALDEA_COMBAT", "FIGHTING"),
    formList(128, "NORMAL", "PALDEA_COMBAT", "PALDEA_BLAZE", "PALDEA_AQUA"),
    tpl(145, null, "ELECTRIC", "FLYING"), tpl(145, "NORMAL", "ELECTRIC", "FLYING"), tpl(145, "GALARIAN", "FIGHTING", "FLYING"),
    formList(145, "NORMAL", "GALARIAN"),
    tpl(194, null, "WATER", "GROUND"), tpl(194, "NORMAL", "WATER", "GROUND"), tpl(194, "PALDEA", "POISON", "GROUND"),
    formList(194, "NORMAL", "PALDEA"),
    tpl(487, null, "GHOST", "DRAGON"), tpl(487, "ALTERED", "GHOST", "DRAGON"), tpl(487, "ORIGIN", "GHOST", "DRAGON"),
    formList(487, "ALTERED", "ORIGIN"),
    tpl(555, null, "FIRE"), tpl(555, "GALARIAN_STANDARD", "ICE"), tpl(555, "GALARIAN_ZEN", "ICE", "FIRE"),
    tpl(555, "STANDARD", "FIRE"), tpl(555, "ZEN", "FIRE", "PSYCHIC"),
    formList(555, "STANDARD", "ZEN", "GALARIAN_STANDARD", "GALARIAN_ZEN"),
  ], POKEMON_NAMES_DICT);
  const typesOf = (hit) => (hit ? hit.types.join("/") : "unresolved");

  // Index keys, as nameKey() spells them: lowercase, straight apostrophes.
  const key = (adjective, dex, forme) => `${adjective} ${en(dex)}${forme ? ` (${forme})` : ""}`.toLowerCase();
  const cases = [
    [key("Alolan", 105), "Fire/Ghost", "the region with the demonym's -n (ALOLA)"],
    [key("Galarian", 145), "Fighting/Flying", "the region as the game master spells it (GALARIAN)"],
    [key("Hisuian", 58), "Fire/Rock", "HISUIAN"],
    [key("Paldean", 194), "Poison/Ground", "PALDEA, where it heads a single form"],
    [key("Alolan", 52), "Dark", "one of two regions on one species"],
    [key("Galarian", 52), "Steel", "the other"],
    [key("Galarian", 122), "Ice/Psychic", "a two-word species name after the adjective"],
    [key("Paldean", 128, "Blaze"), "Fighting/Fire", "a region and a breed in brackets, as Leek Duck spells Tauros"],
    [key("Paldean", 128, "Aqua Breed"), "Fighting/Water", "the breed with its noun"],
    [key("Galarian", 555, "Zen Mode"), "Ice/Fire", "the regional Zen Mode, never the Unova one"],
    [key("Paldean", 128), "unresolved", "a region heading three breeds and naming none of them"],
    [key("Galarian", 555), "unresolved", "a region heading two modes"],
    [key("Alolan", 145), "unresolved", "a region the species has no form of"],
    [key("Alolan", 128, "Blaze"), "unresolved", "a breed under another region"],
    [key("Alol", 105), "unresolved", "a clipped region word"],
    [key("Kantonian", 105), "unresolved", "a region the game master has no form for"],
    [key("Mega", 52), "unresolved", "a tier word, which heads no form: a Mega the index does not hold"],
  ];
  for (const [k, want, why] of cases) {
    const got = typesOf(resolveBossKey(nameIdx, k));
    check(`"${k}" → ${want}: ${why}`, got === want, got === want ? "" : got);
  }
  const hit = resolveBossKey(nameIdx, key("Alolan", 105));
  check("a regional boss resolves to the species' id and dictionary name, and to the regional form's own enum",
    hit?.id === ID(105) && hit?.displayName === en(105) && hit?.form === `${ID(105)}_ALOLA` &&
      Object.keys(hit).sort().join() === "displayName,form,id,types", JSON.stringify(hit));
  const origin = resolveBossKey(nameIdx, key("Origin", 487));
  check("a leading word that heads a form which is not regional reads the same way",
    origin?.form === `${ID(487)}_ORIGIN`, JSON.stringify(origin));

  const ev = (eventID, eventType, name, bosses) => ({
    eventID, name, eventType, start: feedTime(NOW - HOUR), end: feedTime(NOW + DAY),
    extraData: bosses
      ? { raidbattles: { bosses: bosses.map((b) => ({ name: b, canBeShiny: true })) } }
      : { generic: { hasSpawns: false, hasFieldResearchTasks: false } },
  });
  const breeds = ["Blaze", "Aqua", "Combat"];
  const feed = [
    ev("zz-marowak", "raid-day", `Alolan ${en(105)} Raid Day`),
    ev("zz-tauros", "raid-battles", `Paldean ${en(128)} in 3-star Raid Battles`, breeds.map((b) => `Paldean ${en(128)} (${b})`)),
    ev("zz-zapdos", "raid-hour", `Shadow Galarian ${en(145)} Raid Hour`),
    ev("zz-mime", "raid-battles", `Galarian ${en(122)} in 3-star Raid Battles`, [`Galarian ${en(122)}`]),
    ev("zz-bare-tauros", "raid-hour", `Paldean ${en(128)} Raid Hour`),
    ev("zz-max", "max-mondays", `Dynamax Hisuian ${en(58)} during Max Monday`),
  ];
  const quietly = (build) => {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      return { ...build(), warnings };
    } finally {
      console.warn = realWarn;
    }
  };
  const run = (raids) => quietly(() => buildEventRaids(feed, { nameIdx, allTypes: LILY_TYPES, raids, now: NOW }));
  const surfaced = (out) => out.entries.map((e) => e.eventID).sort().join(",");
  const eventOf = (out, eventID) => out.entries.find((e) => e.eventID === eventID);

  const fresh = run({});
  const marowak = eventOf(fresh, "zz-marowak");
  const boss = marowak?.bosses?.[0];
  check("the Alolan Marowak Raid Day surfaces as Marowak's Alolan form, a plain raid",
    marowak?.isShadow === false && marowak?.isMega === false && boss?.id === ID(105) && boss?.form === `${ID(105)}_ALOLA` &&
      boss?.names?.en === en(105) && boss?.types?.join("/") === "fire/ghost",
    JSON.stringify({ isShadow: marowak?.isShadow, isMega: marowak?.isMega, boss }));
  // Ghost hits Alolan Marowak's ghost side super-effectively, and grass is
  // super-effective only on Kanto Marowak's ground, so this tells them apart.
  check("the regional form's types reach the counters",
    boss?.seMoveTypes?.includes("ghost") && !boss?.seMoveTypes?.includes("grass"), JSON.stringify(boss?.seMoveTypes));
  const tauros = eventOf(fresh, "zz-tauros")?.bosses || [];
  const taurosForms = tauros.map((b) => `${b.form}=${b.types.join("/")}`).join(", ");
  check("each Tauros breed in a raid-battles list resolves to its own form and types", taurosForms === [
    `${ID(128)}_PALDEA_BLAZE=fighting/fire`, `${ID(128)}_PALDEA_AQUA=fighting/water`, `${ID(128)}_PALDEA_COMBAT=fighting`,
  ].join(", "), taurosForms);
  const zapdos = eventOf(fresh, "zz-zapdos");
  check("a Shadow tier word ahead of the adjective is still the tier flag, and the rest still resolves",
    zapdos?.isShadow === true && zapdos?.isMega === false && zapdos?.bosses?.[0]?.form === `${ID(145)}_GALARIAN` &&
      zapdos?.bosses?.[0]?.types?.join("/") === "fighting/flying",
    JSON.stringify({ isShadow: zapdos?.isShadow, isMega: zapdos?.isMega, boss: zapdos?.bosses?.[0] }));
  check("a two-word species name after the adjective resolves in an event",
    eventOf(fresh, "zz-mime")?.bosses?.[0]?.types?.join("/") === "ice/psychic");
  const warned = fresh.unresolved === 1 && fresh.warnings.some((w) => w.includes(`"Paldean ${en(128)}"`));
  check("a bare Paldean Tauros is skipped with a warning, never resolved to one breed or to Kanto Tauros",
    !eventOf(fresh, "zz-bare-tauros") && warned, warned ? "" : fresh.warnings.join(" | "));

  const maxes = quietly(() => buildEventMaxBattles(feed, { nameIdx, allTypes: LILY_TYPES, maxBattles: {}, now: NOW }));
  const maxBoss = maxes.entries.find((e) => e.eventID === "zz-max")?.bosses?.[0];
  check("a Max Battle title's regional adjective resolves through the same resolver",
    maxBoss?.form === `${ID(58)}_HISUIAN` && maxBoss?.types?.join("/") === "fire/rock" && !maxBoss?.gigantamax,
    JSON.stringify(maxBoss));

  // A standing boss as lily-dex-api's currentList carries it. pokemon-go-api
  // spells a regional form with the game master's enum, MAROWAK_ALOLA.
  const lily = (dex, form, ...types) => ({ id: ID(dex), form, names: { English: en(dex) }, types });
  const alolaStanding = run(deriveTiered({ lvl3: [lily(105, `${ID(105)}_ALOLA`, "Fire", "Ghost")] }, LILY_TYPES));
  check("with Alolan Marowak standing in lvl3, the Raid Day dedupes by form",
    !surfaced(alolaStanding).includes("zz-marowak") && alolaStanding.deduped === 1 && alolaStanding.unresolved === 1,
    `${surfaced(alolaStanding)}; ${alolaStanding.deduped} deduped, ${alolaStanding.unresolved} unresolved`);
  const kantoStanding = run(deriveTiered({ lvl3: [lily(105, ID(105), "Ground")] }, LILY_TYPES));
  check("with Kanto Marowak standing (its bare id), the Alolan Raid Day is another battle and surfaces",
    eventOf(kantoStanding, "zz-marowak")?.bosses?.[0]?.form === `${ID(105)}_ALOLA`, surfaced(kantoStanding));
  const blazeStanding = run(deriveTiered({ lvl3: [lily(128, `${ID(128)}_PALDEA_BLAZE`, "Fighting", "Fire")] }, LILY_TYPES));
  const leftBreeds = (eventOf(blazeStanding, "zz-tauros")?.bosses || []).map((b) => b.form).join(", ");
  check("with Blaze Breed standing, the event keeps Aqua and Combat and drops Blaze",
    leftBreeds === `${ID(128)}_PALDEA_AQUA, ${ID(128)}_PALDEA_COMBAT`, leftBreeds);
  const shadowStanding = run(deriveTiered({ shadow_lvl5: [lily(145, `${ID(145)}_GALARIAN`, "Fighting", "Flying")] }, LILY_TYPES));
  check("with Shadow Galarian Zapdos standing, the Shadow Raid Hour dedupes",
    !surfaced(shadowStanding).includes("zz-zapdos") && shadowStanding.deduped === 1 && shadowStanding.unresolved === 1,
    `${surfaced(shadowStanding)}; ${shadowStanding.deduped} deduped, ${shadowStanding.unresolved} unresolved`);

  // Through the app: a regional boss builds a filter, and its box is labelled
  // with the species' name from the dictionary and its form's region (and
  // breed) from the output locale's labels, the ones the buddy form picker
  // shows, so the three Tauros breeds are three boxes a trainer can tell
  // apart: "Tauros (Paldea, Blaze)". A bare name, a
  // forme that is no region and a regional mode go through the same event, and
  // a regional standing boss stands in lvl3. Each boss's region is written out
  // here rather than read back from regionForForm.
  const REGION_OF = {
    [`${ID(105)}_ALOLA`]: ["alola"],
    [`${ID(128)}_PALDEA_BLAZE`]: ["paldea", "blaze"],
    [`${ID(128)}_PALDEA_AQUA`]: ["paldea", "aqua"],
    [`${ID(128)}_PALDEA_COMBAT`]: ["paldea", "combat"],
    [`${ID(145)}_GALARIAN`]: ["galar"],
    [`${ID(122)}_GALARIAN`]: ["galar"],
    [`${ID(58)}_HISUIAN`]: ["hisui"],
    // A regional suffix regionForForm does not list is read by its head.
    [`${ID(555)}_GALARIAN_ZEN`]: ["galar"],
  };
  const PLAIN = [`${ID(105)}_NORMAL`, `${ID(487)}_ORIGIN`, `${ID(555)}_ZEN`];
  const formes = quietly(() => buildEventRaids([
    ev("zz-formes", "raid-battles", `${en(105)} in 3-star Raid Battles`,
      [en(105), `${en(487)} (Origin)`, `${en(555)} (Zen Mode)`, `Galarian ${en(555)} (Zen Mode)`]),
  ], { nameIdx, allTypes: LILY_TYPES, raids: {}, now: NOW }));
  const formeForms = (eventOf(formes, "zz-formes")?.bosses || []).map((b) => b.form).join(", ");
  check("a bare name, two formes that are no region and a regional mode resolve side by side in one event",
    formeForms === [...PLAIN, `${ID(555)}_GALARIAN_ZEN`].join(", "), formeForms);

  // The event groups in the order buildFilters emits them: raids, then Max Battles.
  const events = [...fresh.entries, ...formes.entries, ...maxes.entries];
  // lily-dex-api names a regional standing boss with its region ("Alolan
  // Marowak", "Alola-Knogga"), so its label must not gain a second one.
  const standing = deriveTiered({
    lvl3: [{ id: ID(105), form: `${ID(105)}_ALOLA`, names: { English: `Alolan ${en(105)}` }, types: ["Fire", "Ghost"] }],
  }, LILY_TYPES);
  const formless = (bosses) => bosses.map((b) => ({ ...b, form: null }));
  // The same bosses with no form: what the label was before forms reached it.
  const snapshot = (strip) => ({
    ...RAID_BOSSES,
    raids: strip ? { lvl3: formless(standing.lvl3) } : standing,
    eventRaids: [...fresh.entries, ...formes.entries].map((e) => (strip ? { ...e, bosses: formless(e.bosses) } : e)),
    eventMaxBattles: maxes.entries.map((e) => (strip ? { ...e, bosses: formless(e.bosses) } : e)),
  });
  const groupsOf = (result) => [...(result.eventRaidFilters || []), ...(result.eventMaxBattleFilters || [])];
  for (const loc of localeNames) {
    const t = makeTFn(loc);
    const message = (key) => LOCALES[loc].messages[key];
    const withForms = buildResult(loc, { raidBosses: snapshot(false) });
    const withoutForms = buildResult(loc, { raidBosses: snapshot(true) });
    const bare = groupsOf(withoutForms);
    const groups = groupsOf(withForms);
    const bad = groups.length === events.length ? [] : [`${groups.length} groups for ${events.length} events`];
    let regional = 0;
    let plain = 0;
    groups.forEach((g, gi) => (g.bosses || []).forEach((b, bi) => {
      const data = events[gi]?.bosses?.[bi];
      const bareBoss = bare[gi]?.bosses?.[bi];
      const where = `${g.eventID}/${data?.form}`;
      const dexKey = resolveSpeciesInfo(data?.names?.en, "en")?.dexKey;
      const expected = dexKey && POKEMON_NAMES_DICT[dexKey]?.[loc]?.toLowerCase();
      if (b.skipped || !b.clause) bad.push(`${where}: empty filter`);
      // Without its form a boss is named from the dictionary, as D13 checks for formes.
      if (!expected || String(bareBoss?.name).toLowerCase() !== expected) bad.push(`${where}: named "${bareBoss?.name}", not "${expected}"`);
      const label = bossCounterLabel(b, t);
      const bareLabel = bareBoss && bossCounterLabel(bareBoss, t);
      const want = REGION_OF[data?.form];
      if (!want) {
        plain++;
        if (label !== bareLabel) bad.push(`${where}: "${label}", was "${bareLabel}"`);
        return;
      }
      regional++;
      // One pair of brackets after the bare name: the region, or the region
      // and the breed joined in this locale's own punctuation, never
      // "Paldea (Blaze)" nested inside the name's brackets.
      const [region, variant] = want;
      const regionLabel = message(`app.buddy_targets.form_region.${region}`);
      const variantLabel = variant && message(`app.buddy_targets.form_variant.${variant}`);
      const joined = variant && message("app.filter.boss_form_variant")?.replace("{region}", regionLabel).replace("{variant}", variantLabel);
      const formLabel = variant ? joined : regionLabel;
      if (!regionLabel || (variant && !(variantLabel && joined?.includes(regionLabel) && joined.includes(variantLabel)))) {
        bad.push(`${where}: no ${loc} label names ${want.join(" and ")}`);
      } else if (b.name !== `${bareBoss?.name} (${formLabel})` || !label.includes(`(${formLabel})`)) {
        bad.push(`${where}: "${label}", not "… ${bareBoss?.name} (${formLabel})"`);
      }
    }));
    const taurosLabels = (groups.find((g) => g.eventID === "zz-tauros")?.bosses || []).map((b) => bossCounterLabel(b, t));
    if (new Set(taurosLabels).size !== 3) bad.push(`Tauros breeds: ${JSON.stringify(taurosLabels)}`);
    const standingLabel = withForms.raidFilters?.lvl3?.[0] && bossCounterLabel(withForms.raidFilters.lvl3[0], t);
    const standingBare = withoutForms.raidFilters?.lvl3?.[0];
    const alola = message("app.buddy_targets.form_region.alola");
    if (!standingLabel || standingLabel !== bossCounterLabel(standingBare, t)) bad.push(`standing: "${standingLabel}"`);
    else if (standingLabel.split(alola).length !== 2) bad.push(`standing names "${alola}" more than once: "${standingLabel}"`);
    // A boss with no clean counter is skipped, and its note reads the same name.
    const blazeEvent = fresh.entries.find((e) => e.eventID === "zz-tauros");
    const noCounter = { ...blazeEvent, eventID: "zz-no-counter", bosses: [{ ...blazeEvent.bosses[0], resistorTypes: [] }] };
    const skippedOut = buildResult(loc, { raidBosses: { ...snapshot(false), eventRaids: [noCounter], eventMaxBattles: [] } });
    const skipped = groupsOf(skippedOut).find((g) => g.eventID === "zz-no-counter")?.bosses?.[0];
    const blazeLabel = message("app.filter.boss_form_variant")
      ?.replace("{region}", message("app.buddy_targets.form_region.paldea"))
      .replace("{variant}", message("app.buddy_targets.form_variant.blaze"));
    const blazeBare = bare.find((g) => g.eventID === "zz-tauros")?.bosses?.[0]?.name;
    if (!skipped?.skipped || skipped.name !== `${blazeBare} (${blazeLabel})`) {
      bad.push(`skipped boss named "${skipped?.name}", not "${blazeBare} (${blazeLabel})"`);
    }
    check(`${loc}: ${regional} regional event boss labels carry their region, ${plain} plain ones and a regional standing boss are unchanged`,
      regional === Object.keys(REGION_OF).length && plain === PLAIN.length && bad.length === 0, bad.slice(0, 4).join(" | "));
  }
}

console.log(`\n${failures === 0 ? "✓ All data-filter property checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
