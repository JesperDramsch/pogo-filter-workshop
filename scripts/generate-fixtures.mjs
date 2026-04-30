// Generates src/__fixtures__/default-filter-output.json — the buildFilters
// output for the default config across every supported locale. Used as a
// regression snapshot so silent changes to filter syntax break loudly in CI.
//
// Run with: npx vite-node scripts/generate-fixtures.mjs

import { writeFileSync } from "node:fs";
import { buildFilters, DEFAULT_CONFIG, DEFAULT_HUNDOS } from "../src/App.jsx";
import { LOCALES } from "../src/i18n/index.js";

// Mimic the in-app `t()` lookup so fixture output matches what users see.
function makeTFn(locale) {
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

const fixture = {};
for (const locale of Object.keys(LOCALES)) {
  const tFn = makeTFn(locale);
  const result = buildFilters(DEFAULT_HUNDOS, DEFAULT_CONFIG, [], locale, tFn);
  fixture[locale] = {
    trash: result.trash,
    trade: result.trade,
    sort: result.sort,
    prestaged: result.prestaged,
    gift: result.gift,
    // Aux pro-tools — task-oriented filter strings. Snapshot so accidental
    // changes to the new clause logic break loudly in CI.
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

const out = "src/__fixtures__/default-filter-output.json";
writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n", "utf8");
console.log(`Wrote ${out}`);
console.log(`Locales: ${Object.keys(fixture).join(", ")}`);
console.log(`DE trash: ${fixture.de.trash.slice(0, 80)}${fixture.de.trash.length > 80 ? "…" : ""}`);
console.log(`EN trash: ${fixture.en.trash.slice(0, 80)}${fixture.en.trash.length > 80 ? "…" : ""}`);
