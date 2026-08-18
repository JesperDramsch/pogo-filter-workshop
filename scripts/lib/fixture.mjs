// Single source of truth for the filter-output snapshot.
//
// generate-fixtures.mjs and check-fixtures.mjs both import buildFixture() from
// here, so the set of fields written can never drift from the set compared.
// They used to hand-maintain separate lists: the generator wrote 22 fields per
// locale and the checker rebuilt only 7 of them and iterated its own keys, so
// 15 fields — every raid counter, Rocket counter, PvP cup, Max-battle and
// shadow filter — sat in a 90 KB fixture that nothing ever read. Overwriting
// them with garbage did not fail CI.

import {
  buildFilters, mergeImportedConfig,
  DEFAULT_CONFIG, DEFAULT_HUNDOS, DEFAULT_LUCKIES,
} from "../../src/App.jsx";
import { LOCALES } from "../../src/i18n/index.js";

// Mimic the in-app `t()` lookup so fixture output matches what users see.
export function makeTFn(locale) {
  const messages = LOCALES[locale]?.messages || LOCALES.en.messages;
  return (key, opts) => {
    let str = messages[key];
    if (str === undefined && locale !== "en") str = LOCALES.en.messages[key];
    if (str === undefined) return opts && "fallback" in opts ? opts.fallback : key;
    if (opts?.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };
}

// Flattens a tier→boss[] map to tier→{bossId: clause} for compact snapshots.
function flattenBossMap(byTier) {
  const out = {};
  for (const [tier, list] of Object.entries(byTier || {})) {
    out[tier] = Object.fromEntries((list || []).map(b => [b.id, b.clause]));
  }
  return out;
}

// The config every real user actually runs. App.jsx loads persisted config
// through mergeImportedConfig (and, since the resetAll fix, so does reset), so
// raw DEFAULT_CONFIG — regionalGroups {} and enabledTradeEvos [] — is a
// pre-migration blob no runtime path can produce. Snapshotting it pinned a
// 31-clause trash string while first-run users got 120 clauses, leaving the
// regional and trade-evo guards untested.
export const FIXTURE_CONFIG = mergeImportedConfig(DEFAULT_CONFIG);

export function buildFixture() {
  const fixture = {};
  for (const locale of Object.keys(LOCALES)) {
    const tFn = makeTFn(locale);
    const result = buildFilters(DEFAULT_HUNDOS, DEFAULT_LUCKIES, FIXTURE_CONFIG, [], locale, tFn);
    fixture[locale] = {
      trash: result.trash,
      trade: result.trade,
      sort: result.sort,
      prestaged: result.prestaged,
      gift: result.gift,
      // Aux pro-tools — task-oriented filter strings.
      shadowCheap: result.shadowCheap,
      shadowSafe: result.shadowSafe,
      shadowHundoCandidates: result.shadowHundoCandidates,
      shadowFrustration: result.shadowFrustration,
      cheapEvolve: result.cheapEvolve,
      dexPlus: result.dexPlus,
      megaEvolve: result.megaEvolve,
      pilotLong: result.pilotLong,
      // Raid + max-battle per-boss counters. Flattened to id→clause so the
      // snapshot stays compact; the full clauses array is reconstructible
      // from the raid-bosses.json artifact in src/data/.
      raidFilters: flattenBossMap(result.raidFilters),
      maxBattleFilters: flattenBossMap(result.maxBattleFilters),
      // Universal Max-Battle charger filter (single clause across all 0.5s
      // fast moves + dynamax-eligibility). Locale-sensitive: emits localized
      // move names per the move-name dictionary.
      maxTank: result.maxTank?.clause || "",
      // Team Rocket counters: leaders flatten to {leaderName: {phase: clause}};
      // grunts flatten to {trainerName: clause}.
      rocketLeaders: Object.fromEntries(
        (result.rocketLeaders || []).map(l => [l.name,
          Object.fromEntries(l.phases.map(p => [String(p.slot), p.clause || ""]))])
      ),
      rocketTypedGrunts: Object.fromEntries(
        (result.rocketTypedGrunts || []).map(g => [g.name, g.clause])
      ),
      rocketGenericGrunts: Object.fromEntries(
        (result.rocketGenericGrunts || []).map(g => [g.name, g.clause])
      ),
      pvpFilters: Object.fromEntries(
        Object.entries(result.pvpFilters || {}).map(([k, v]) => [k, v.clause || ""])
      ),
      trashClauseCount: result.trashClauses.length,
      tradeClauseCount: result.tradeClauses.length,
    };
  }
  return fixture;
}

// Recursive structural diff. Reports dotted paths so a failure names the exact
// boss/leader/cup that moved, and — critically — reports keys that exist on one
// side only, which is the shape a silently-dropped field takes.
export function diffFixture(expected, actual, path = "", out = []) {
  const isObj = (v) => v !== null && typeof v === "object";
  if (!isObj(expected) || !isObj(actual)) {
    if (expected !== actual) out.push({ path, expected, actual });
    return out;
  }
  for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in expected)) out.push({ path: p, expected: "(absent from fixture)", actual: actual[k] });
    else if (!(k in actual)) out.push({ path: p, expected: expected[k], actual: "(absent from build)" });
    else diffFixture(expected[k], actual[k], p, out);
  }
  return out;
}

// Number of leaf values a fixture pins — reported by the checker so a sudden
// drop in coverage is visible rather than silent.
export function countLeaves(node) {
  if (node === null || typeof node !== "object") return 1;
  return Object.values(node).reduce((n, v) => n + countLeaves(v), 0);
}
