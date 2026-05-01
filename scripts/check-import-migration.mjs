// Verifies the Settings → Backup & Restore import path: schema
// validation, mergeImportedConfig migrations, and the prepareImport
// pipeline that maps an envelope onto state-setter inputs.
//
// Run with: npm run test:migration  (or npx vite-node directly).
//
// Covers:
//   migration:
//     1. Stale rename keys (protectMegaConditional → protectNewEvolutions)
//     2. Stale rename keys (protectTagged → protectAnyTag)
//     3. Stale rename keys (mythCarveOuts → mythTooManyOf)
//     4. Dropped legacy keys (protectRegionals, yearMin, ...)
//     5. Forward-compat preservation of unknown keys
//     6. Default-fill / null input
//     7. User values win over defaults
//   schema validation:
//     8. Missing schema → wrong_schema
//     9. Foreign prefix → wrong_schema
//    10. Future version (v99) → unsupported_version with schema param
//    11. Non-object input → invalid_json
//    12. Current version → ok
//   envelope round-trip:
//    13. build → stringify → parse → validate → prepare yields original state
//   end-to-end old-export migration:
//    14. v1 envelope with stale config keys → prepareImport surfaces renamed
//        keys correctly + drops legacy keys

import {
  mergeImportedConfig, DEFAULT_CONFIG,
  validateImportEnvelope, prepareImport,
  SCHEMA_CURRENT,
} from "../src/App.jsx";
import { resolveSpecies } from "../src/data/species.js";

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

console.log("Migration test 1: protectMegaConditional → protectNewEvolutions");
{
  const out = mergeImportedConfig({ protectMegaConditional: false });
  check("protectNewEvolutions === false", out.protectNewEvolutions === false);
  check("protectMegaConditional dropped", !("protectMegaConditional" in out));
}

console.log("\nMigration test 2: protectTagged → protectAnyTag");
{
  const out = mergeImportedConfig({ protectTagged: false });
  check("protectAnyTag === false", out.protectAnyTag === false);
  check("protectTagged dropped", !("protectTagged" in out));
}

console.log("\nMigration test 3: mythCarveOuts → mythTooManyOf");
{
  const out = mergeImportedConfig({ mythCarveOuts: ["meltan", "genesect"] });
  check("mythTooManyOf has [meltan, genesect]",
    JSON.stringify(out.mythTooManyOf) === JSON.stringify(["meltan", "genesect"]),
    `got ${JSON.stringify(out.mythTooManyOf)}`);
}

console.log("\nMigration test 4: dropped legacy keys");
{
  const out = mergeImportedConfig({
    protectRegionals: true,
    protectSizes: true,
    protectLeagueTags: ["greatpvp"],
    yearMin: 2022,
  });
  check("protectRegionals dropped", !("protectRegionals" in out));
  check("protectSizes dropped", !("protectSizes" in out));
  check("protectLeagueTags dropped", !("protectLeagueTags" in out));
  check("yearMin dropped", !("yearMin" in out));
}

console.log("\nForward-compat test: unknown keys preserved");
{
  const out = mergeImportedConfig({ someFutureToggle: 42, anotherField: "x" });
  check("someFutureToggle preserved", out.someFutureToggle === 42);
  check("anotherField preserved", out.anotherField === "x");
}

console.log("\nDefault-fill test: missing fields back-filled");
{
  const out = mergeImportedConfig({});
  check("expertMode defaulted", out.expertMode === DEFAULT_CONFIG.expertMode);
  check("pvpMode defaulted", out.pvpMode === DEFAULT_CONFIG.pvpMode);
  check("regionalGroups populated", Object.keys(out.regionalGroups || {}).length > 0);
  check("enabledTradeEvos populated", (out.enabledTradeEvos || []).length > 0);
}

console.log("\nNull input test: doesn't crash");
{
  const out = mergeImportedConfig(null);
  check("returns merged DEFAULT_CONFIG", out.expertMode === DEFAULT_CONFIG.expertMode);
}

console.log("\nUser values win over defaults");
{
  const out = mergeImportedConfig({ protectFavorites: false, pvpMode: "loose" });
  check("protectFavorites: false from import",  out.protectFavorites === false);
  check("pvpMode: loose from import", out.pvpMode === "loose");
}

console.log("\nSchema validation: missing schema");
{
  const r = validateImportEnvelope({ data: {} });
  check("rejects with wrong_schema", !r.ok && r.error.code === "wrong_schema");
}

console.log("\nSchema validation: foreign prefix");
{
  const r = validateImportEnvelope({ schema: "some-other-app/v1", data: {} });
  check("rejects with wrong_schema", !r.ok && r.error.code === "wrong_schema");
}

console.log("\nSchema validation: unsupported future version");
{
  const r = validateImportEnvelope({ schema: "pogo-filter-workshop/v99", data: {} });
  check("rejects with unsupported_version", !r.ok && r.error.code === "unsupported_version");
  check("error params carry the bad schema", r.error.params?.schema === "pogo-filter-workshop/v99");
}

console.log("\nSchema validation: non-object input");
{
  check("null → invalid_json",   validateImportEnvelope(null).error?.code === "invalid_json");
  check("string → invalid_json", validateImportEnvelope("nope").error?.code === "invalid_json");
  check("array → invalid_json",  validateImportEnvelope([1, 2]).error?.code === "invalid_json");
}

console.log("\nSchema validation: current version passes");
{
  const r = validateImportEnvelope({ schema: SCHEMA_CURRENT, data: { hundos: [] } });
  check("ok === true", r.ok === true);
  check("envelope returned", r.envelope?.schema === SCHEMA_CURRENT);
}

console.log("\nEnvelope round-trip: build → stringify → parse → validate → prepare");
{
  // Note: prepareImport canonicalizes species names to the storage locale
  // (deliberate — same as the load effect), so we compare topAttackers /
  // topMaxAttackers against the canonicalized form, not the raw input.
  const original = {
    schema: SCHEMA_CURRENT,
    exportedAt: "2026-05-01T17:30:00.000Z",
    data: {
      hundos: [{ dex: 25, atk: 15, def: 15, hp: 15 }],
      topAttackers: ["mewtwo"],     // canonicalizes to "mewtu" in DE storage
      topMaxAttackers: ["zacian"],
      config: { protectFavorites: false, pvpMode: "loose" },
      homeLocation: [13.4, 52.5],
      bazaarTags: ["#trade", "#fern"],
    },
  };
  const text = JSON.stringify(original, null, 2);
  const parsed = JSON.parse(text);
  const v = validateImportEnvelope(parsed);
  check("validates", v.ok === true);
  const prepared = prepareImport(v.envelope);
  const expectedTopAttackers = original.data.topAttackers.map(s => resolveSpecies(s) || s);
  const expectedTopMaxAttackers = original.data.topMaxAttackers.map(s => resolveSpecies(s) || s);
  check("hundos preserved",
    JSON.stringify(prepared.hundos) === JSON.stringify(original.data.hundos));
  check("topAttackers canonicalized",
    JSON.stringify(prepared.topAttackers) === JSON.stringify(expectedTopAttackers));
  check("topMaxAttackers canonicalized",
    JSON.stringify(prepared.topMaxAttackers) === JSON.stringify(expectedTopMaxAttackers));
  check("config user values survive merge",
    prepared.config.protectFavorites === false && prepared.config.pvpMode === "loose");
  check("homeLocation preserved",
    JSON.stringify(prepared.homeLocation) === JSON.stringify(original.data.homeLocation));
  check("bazaarTags preserved",
    JSON.stringify(prepared.bazaarTags) === JSON.stringify(original.data.bazaarTags));
  // Idempotence: running prepare a second time on the already-prepared
  // envelope must produce the same result (canonicalization stable).
  const reExported = { schema: SCHEMA_CURRENT, data: prepared };
  const prepared2 = prepareImport(reExported);
  check("canonicalize idempotent on second pass",
    JSON.stringify(prepared2.topAttackers) === JSON.stringify(prepared.topAttackers));
}

console.log("\nEnd-to-end: stale-config import migrates through the whole pipe");
{
  const oldExport = {
    schema: SCHEMA_CURRENT,
    exportedAt: "2025-12-01T00:00:00Z",
    data: {
      hundos: [],
      config: {
        // All three deprecated names. Should land on the new ones.
        protectMegaConditional: false,
        protectTagged: false,
        mythCarveOuts: ["meltan"],
        // And a legacy key that should be dropped entirely.
        protectRegionals: true,
      },
    },
  };
  const v = validateImportEnvelope(oldExport);
  check("stale envelope still validates (v1 schema)", v.ok === true);
  const prepared = prepareImport(v.envelope);
  check("renamed: protectMegaConditional → protectNewEvolutions === false",
    prepared.config.protectNewEvolutions === false);
  check("renamed: protectTagged → protectAnyTag === false",
    prepared.config.protectAnyTag === false);
  check("renamed: mythCarveOuts → mythTooManyOf",
    JSON.stringify(prepared.config.mythTooManyOf) === JSON.stringify(["meltan"]));
  check("legacy protectRegionals dropped", !("protectRegionals" in prepared.config));
  check("legacy protectMegaConditional dropped", !("protectMegaConditional" in prepared.config));
  check("legacy protectTagged dropped", !("protectTagged" in prepared.config));
}

console.log("\nPrepareImport shape filtering: bad values dropped silently");
{
  const out = prepareImport({
    data: {
      hundos: "not an array",         // dropped
      topAttackers: ["pikachu"],       // kept
      homeLocation: [1, 2, 3],         // wrong arity → dropped
      bazaarTags: null,                // dropped
      config: 42,                      // wrong type → dropped
    },
  });
  check("invalid hundos not present", !("hundos" in out));
  check("valid topAttackers present", out.topAttackers?.[0] === "pikachu");
  check("invalid homeLocation not present", !("homeLocation" in out));
  check("null bazaarTags not present", !("bazaarTags" in out));
  check("invalid config not present", !("config" in out));
}

console.log(`\n${failures === 0 ? "✓ All migration tests passed." : `✗ ${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
