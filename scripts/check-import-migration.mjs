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
//   seeded-roster reconciliation:
//    15. a saved roster tracks the feed without losing user edits
//   end-to-end old-export migration:
//    14. v1 envelope with stale config keys → prepareImport surfaces renamed
//        keys correctly + drops legacy keys

import {
  mergeImportedConfig, DEFAULT_CONFIG,
  validateImportEnvelope, prepareImport,
  SCHEMA_CURRENT, regionalCatalogTokens,
  reconcileSeededList,
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

console.log("\nBuddy targets: legacy string[] → structured Target[]");
{
  const out = mergeImportedConfig({
    buddies: [
      {
        id: "a", name: "Auri", tagPrefix: "Auri",
        targetSpecies: [
          "habitak",                                   // legacy string → exact
          { species: "mauzi", type: "unlicht" },       // localized type word
          { species: "sandan", type: "ice", expand: true }, // key + expand
          { species: "pikachu" },                      // object, no type
          { species: "ponita", gender: "female" },     // valid gender pick
          { species: "raichu", gender: "banana" },     // junk gender → 'any'
          null, 42, {},                                // junk → dropped
        ],
      },
    ],
  });
  const ts = out.buddies[0].targetSpecies;
  check("legacy string → whole-species target (empty dropForms/dropSlots, gender any)",
    JSON.stringify(ts[0]) === JSON.stringify({ species: "habitak", expand: false, dropForms: [], dropSlots: [], gender: "any" }),
    `got ${JSON.stringify(ts[0])}`);
  check("legacy type 'unlicht' migrates to keep only Alolan Mauzi",
    ts[1]?.species === "mauzi" && ts[1]?.expand === false
    && !ts[1].dropForms.includes("alola")
    && ts[1].dropForms.includes("base") && ts[1].dropForms.includes("galar"),
    `got ${JSON.stringify(ts[1])}`);
  check("legacy type 'ice' + expand → keep only Alolan Sandan, +family",
    ts[2]?.species === "sandan" && ts[2]?.expand === true
    && ts[2].dropForms.includes("base") && !ts[2].dropForms.includes("alola"),
    `got ${JSON.stringify(ts[2])}`);
  check("object without type → whole-species, expand false",
    ts[3]?.species === "pikachu" && ts[3]?.expand === false
    && Array.isArray(ts[3]?.dropForms) && ts[3].dropForms.length === 0);
  check("valid gender pick preserved", ts[4]?.gender === "female", `got ${JSON.stringify(ts[4])}`);
  check("junk gender coerced to 'any'", ts[5]?.gender === "any", `got ${JSON.stringify(ts[5])}`);
  check("junk entries (null, number, {}) dropped", ts.length === 6, `got length ${ts.length}`);
  check("rawAppend backfilled to ''", out.buddies[0].rawAppend === "");
}

console.log("\nBuddy targets: migration is idempotent");
{
  const once = mergeImportedConfig({
    buddies: [{ id: "a", name: "Auri", tagPrefix: "Auri",
      targetSpecies: ["habitak", { species: "mauzi", type: "dark", expand: true }] }],
  });
  const twice = mergeImportedConfig({ buddies: once.buddies });
  check("second merge leaves targets unchanged",
    JSON.stringify(twice.buddies[0].targetSpecies) === JSON.stringify(once.buddies[0].targetSpecies),
    `got ${JSON.stringify(twice.buddies[0].targetSpecies)}`);
  check("rawAppend preserved on re-merge", twice.buddies[0].rawAppend === "");
}

console.log("\nBuddy targets: dropSlots (un-searchable slots, mirror of the friend-collect map)");
{
  const out = mergeImportedConfig({
    buddies: [{ id: "a", name: "Auri", tagPrefix: "Auri",
      targetSpecies: [
        { species: "burmy", dropSlots: ["male", "sandy"] },          // valid subset
        { species: "sesokitz", dropSlots: ["spring", "banana"] },    // unknown key dropped
        { species: "kinoso", dropSlots: ["overcast", "sunny"] },     // full drop → asks for nothing
        { species: "mauzi", dropSlots: ["plant"] },                  // species has no slot axis
        { species: "pikachu" },                                      // absent field
      ] }],
  });
  const ts = out.buddies[0].targetSpecies;
  const by = (sp) => ts.find(t => t.species === sp);
  check("valid slot keys survive",
    JSON.stringify(by("burmy")?.dropSlots) === JSON.stringify(["male", "sandy"]),
    `got ${JSON.stringify(by("burmy")?.dropSlots)}`);
  check("unknown slot key dropped, valid one kept",
    JSON.stringify(by("sesokitz")?.dropSlots) === JSON.stringify(["spring"]),
    `got ${JSON.stringify(by("sesokitz")?.dropSlots)}`);
  // The picker refuses to drop the last kept slot, so a full drop can only come
  // from a hand-edited import. Asking for nothing is junk, not a choice.
  check("dropping every slot clears the restriction rather than emptying the ask",
    by("kinoso")?.dropSlots.length === 0, `got ${JSON.stringify(by("kinoso")?.dropSlots)}`);
  check("slot keys on a species with no slot axis drop entirely",
    by("mauzi")?.dropSlots.length === 0, `got ${JSON.stringify(by("mauzi")?.dropSlots)}`);
  check("absent dropSlots backfills to []",
    Array.isArray(by("pikachu")?.dropSlots) && by("pikachu").dropSlots.length === 0);
  const twice = mergeImportedConfig({ buddies: out.buddies });
  check("dropSlots migration is idempotent",
    JSON.stringify(twice.buddies[0].targetSpecies) === JSON.stringify(ts));
}

console.log("\nBuddy targets: duplicate species collapse to one (form selection is per-species)");
{
  const out = mergeImportedConfig({
    buddies: [{ id: "a", name: "Auri", tagPrefix: "Auri",
      targetSpecies: [
        "habitak", "habitak",                  // dup plain
        { species: "mauzi", type: "dark" },
        { species: "mauzi", type: "unlicht" }, // same species → collapses
        { species: "mauzi", type: "normal" },  // same species → collapses
      ] }],
  });
  const ts = out.buddies[0].targetSpecies;
  check("collapses to one target per species (habitak + mauzi)", ts.length === 2, `got ${ts.length}`);
  check("keeps one habitak", ts.filter(t => t.species === "habitak").length === 1);
  check("keeps one mauzi (first form selection wins)",
    ts.filter(t => t.species === "mauzi").length === 1,
    JSON.stringify(ts.filter(t => t.species === "mauzi")));
}

console.log("\nBuddy list: junk entries (null/scalar) don't crash the merge");
{
  let out, threw = false;
  try {
    out = mergeImportedConfig({
      buddies: [null, 42, "x", undefined,
        { id: "a", name: "Auri", tagPrefix: "Auri", targetSpecies: ["habitak"] }],
    });
  } catch { threw = true; }
  check("merge does not throw on junk buddy entries", !threw);
  check("junk buddies dropped, real one kept", threw ? false : out.buddies.length === 1,
    threw ? "threw" : `got ${out?.buddies?.length}`);
}

console.log("\nBuddy targets: survive prepareImport (config round-trip)");
{
  const env = { schema: SCHEMA_CURRENT, data: { config: {
    buddies: [{ id: "a", name: "Auri", tagPrefix: "Auri",
      targetSpecies: ["habitak", { species: "mauzi", type: "unlicht" }] }],
  } } };
  const prepared = prepareImport(env);
  const ts = prepared.config.buddies[0].targetSpecies;
  check("habitak → whole-species via prepareImport",
    ts[0]?.species === "habitak" && ts[0]?.expand === false
    && Array.isArray(ts[0]?.dropForms) && ts[0].dropForms.length === 0);
  check("mauzi unlicht → keeps only Alola via prepareImport",
    ts[1]?.species === "mauzi" && ts[1].dropForms.includes("base")
    && ts[1].dropForms.includes("galar") && !ts[1].dropForms.includes("alola"));
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

console.log("\nRegional catalog sync: legacy config (no regionalCatalogSeen) is grandfathered");
{
  const notices = [];
  const out = mergeImportedConfig({
    regionalGroups: {
      // hisuian intentionally missing — pre-Hisui config
      alolan: { enabled: true, typeChecksEnabled: ["Raichu"], collectorsEnabled: null },
    },
  }, notices);
  check("no popup notices for grandfathered configs", notices.length === 0,
    `got ${JSON.stringify(notices)}`);
  check("missing group still backfilled with defaults (enabled)",
    out.regionalGroups.hisuian?.enabled === true);
  check("existing array untouched (no retroactive additions)",
    JSON.stringify(out.regionalGroups.alolan.typeChecksEnabled) === JSON.stringify(["Raichu"]));
  check("regionalCatalogSeen fingerprint written",
    JSON.stringify(out.regionalCatalogSeen) === JSON.stringify(regionalCatalogTokens()));
}

console.log("\nRegional catalog sync: additions since the last visit are applied + reported");
{
  // Simulate a catalog that grew: the stored fingerprint is missing the
  // hisuian group, an A-tier and a C-tier Alolan typeCheck, one collectible
  // collector, and one Galarian typeCheck (whose group the user disabled).
  const seen = regionalCatalogTokens().filter(tok =>
    tok !== "hisuian" && !tok.startsWith("hisuian>")
    && tok !== "alolan>tc>Kokowei" && tok !== "alolan>tc>Sandan"
    && tok !== "collectibles>col>Krawalloro"
    && tok !== "galarian>tc>Pantimos");
  const notices = [];
  const out = mergeImportedConfig({
    regionalCatalogSeen: seen,
    regionalGroups: {
      alolan: { enabled: true, typeChecksEnabled: ["Raichu", "NichtEcht"], collectorsEnabled: null },
      galarian: { enabled: false, typeChecksEnabled: ["Smogmog"], collectorsEnabled: null },
      paldean: { enabled: true, typeChecksEnabled: null, collectorsEnabled: null },
      collectibles: { enabled: true, typeChecksEnabled: null, collectorsEnabled: ["Coiffwaff"] },
    },
  }, notices);
  const g = out.regionalGroups;
  check("new group backfilled enabled + noticed",
    g.hisuian?.enabled === true && notices.some(n => n.kind === "group" && n.group === "hisuian"));
  check("A-tier typeCheck appended to array + noticed",
    g.alolan.typeChecksEnabled.includes("Kokowei")
    && notices.some(n => n.kind === "typeCheck" && n.species === "Kokowei"));
  check("C-tier typeCheck NOT appended, no notice (fresh-install default is off)",
    !g.alolan.typeChecksEnabled.includes("Sandan")
    && !notices.some(n => n.species === "Sandan"));
  check("stale species pruned from array", !g.alolan.typeChecksEnabled.includes("NichtEcht"));
  check("collector appended to array + noticed",
    g.collectibles.collectorsEnabled.includes("Krawalloro")
    && notices.some(n => n.kind === "collector" && n.species === "Krawalloro"));
  check("disabled group: array updated but NO notice (nothing is protected)",
    g.galarian.typeChecksEnabled.includes("Pantimos")
    && !notices.some(n => n.species === "Pantimos"));
  check("null (= all on) state stays null", g.paldean.typeChecksEnabled === null);
  check("fingerprint advanced to the current catalog",
    JSON.stringify(out.regionalCatalogSeen) === JSON.stringify(regionalCatalogTokens()));
  const twice = [];
  const again = mergeImportedConfig(out, twice);
  check("idempotent: re-merge yields no new notices", twice.length === 0,
    `got ${JSON.stringify(twice)}`);
  check("idempotent: groups unchanged on re-merge",
    JSON.stringify(again.regionalGroups) === JSON.stringify(out.regionalGroups));
}

console.log("\nGender annotation maps: defaults, canonicalization and junk rejection");
{
  const fresh = mergeImportedConfig({});
  check("hundoGenders back-fills to {}", JSON.stringify(fresh.hundoGenders) === "{}");
  check("luckyGenders back-fills to {}", JSON.stringify(fresh.luckyGenders) === "{}");

  // Keys canonicalize to the German name, exactly like the form maps.
  const canon = mergeImportedConfig({ luckyGenders: { combee: ["male"] } });
  check("an English key canonicalizes to the German one",
    JSON.stringify(canon.luckyGenders) === '{"wadribie":["male"]}',
    JSON.stringify(canon.luckyGenders));

  // Both genders are recordable for a slot species — the map stores what you
  // OWN, and GENDER_SLOT_DEX decides what counts. A ♂ Wadribie is exactly the
  // state worth recording.
  const male = mergeImportedConfig({ hundoGenders: { wadribie: ["male"] } });
  check("a non-slot gender is still recordable as owned",
    JSON.stringify(male.hundoGenders) === '{"wadribie":["male"]}');

  // Junk drops rather than inventing slots.
  const junk = mergeImportedConfig({
    luckyGenders: { wadribie: ["nonbinary", "male"], glurak: ["male"], pikachu: [], bogus: ["female"] },
  });
  check("unknown gender values are filtered out",
    JSON.stringify(junk.luckyGenders) === '{"wadribie":["male"]}', JSON.stringify(junk.luckyGenders));
  check("species outside the gender catalog drop entirely",
    !("glurak" in junk.luckyGenders) && !("pikachu" in junk.luckyGenders));
  check("unresolvable species drop entirely", !("bogus" in junk.luckyGenders));

  const notArray = mergeImportedConfig({ luckyGenders: { wadribie: "male" } });
  check("a scalar value drops", JSON.stringify(notArray.luckyGenders) === "{}");

  const twice = mergeImportedConfig(canon);
  check("idempotent on re-merge",
    JSON.stringify(twice.luckyGenders) === JSON.stringify(canon.luckyGenders));
}

console.log("\n15 — seeded rosters reconcile instead of freezing");
{
  // The bug this exists to prevent: a first-run visitor's state is written to
  // localStorage immediately, and from then on the saved array shadows the
  // shipped default. Without reconciliation every returning user is frozen on
  // the roster from their first visit and the daily sync reaches nobody.
  const feed = ["a", "b", "c"];

  const fresh = reconcileSeededList(undefined, feed, undefined);
  check("never saved → take the feed whole", JSON.stringify(fresh.list) === JSON.stringify(feed));

  // seen === saved === the old feed: a user who never touched the list.
  const untouched = reconcileSeededList(["a", "b"], feed, ["a", "b"]);
  check("untouched roster picks up new feed entries",
    JSON.stringify(untouched.list) === JSON.stringify(["a", "b", "c"]));

  // The four cases the `seen` fingerprint exists to separate.
  const edited = reconcileSeededList(["a", "mine"], ["a", "b"], ["a", "gone"]);
  check("a user's own addition survives", edited.list.includes("mine"));
  check("a new feed entry is added", edited.list.includes("b"));
  check("a species the user deleted stays deleted", !edited.list.includes("gone"));
  const pruned = reconcileSeededList(["a", "gone"], ["a"], ["a", "gone"]);
  check("a species that left the feed is pruned", !pruned.list.includes("gone"));
  check("but only if it was seeded, never a user's own",
    reconcileSeededList(["a", "mine"], ["a"], ["a"]).list.includes("mine"));

  check("user order is preserved, new entries append",
    JSON.stringify(reconcileSeededList(["c", "a"], ["a", "b", "c"], ["a", "c"]).list)
      === JSON.stringify(["c", "a", "b"]));

  // Grandfathering: a config predating the fingerprint must not dump the whole
  // current feed on the user at the upgrade that introduces it.
  const grandfathered = reconcileSeededList(["a"], feed, undefined);
  check("no fingerprint → grandfathered, nothing added",
    JSON.stringify(grandfathered.list) === JSON.stringify(["a"]));
  check("and the fingerprint is recorded for next time",
    JSON.stringify(grandfathered.seen) === JSON.stringify(feed));

  check("idempotent — reconciling twice changes nothing",
    JSON.stringify(reconcileSeededList(untouched.list, feed, untouched.seen).list)
      === JSON.stringify(untouched.list));

  // Through mergeImportedConfig: the keeper roster is the one that lives in the
  // config blob, so it must reconcile there rather than be overwritten wholesale.
  const feedKeepers = DEFAULT_CONFIG.shadowKeeperSpecies;
  const stale = mergeImportedConfig({
    shadowKeeperSpecies: [feedKeepers[0], "kindwurm"],
    shadowKeeperSeen: [feedKeepers[0]],
  });
  check("merge keeps a hand-added keeper", stale.shadowKeeperSpecies.includes("kindwurm"));
  check("merge adds keepers new since the fingerprint",
    stale.shadowKeeperSpecies.length > 2);
  // The fingerprint is stored canonicalized, like the roster beside it — every
  // reader canonicalizes both sides before comparing, so the two never drift.
  const canonFeed = feedKeepers.map((sp) => resolveSpecies(sp) || sp);
  check("merge bumps the fingerprint to the current feed",
    JSON.stringify(stale.shadowKeeperSeen) === JSON.stringify(canonFeed),
    stale.shadowKeeperSeen.slice(0, 3).join(", "));
  const deleted = mergeImportedConfig({
    shadowKeeperSpecies: feedKeepers.slice(1),
    shadowKeeperSeen: feedKeepers,
  });
  check("merge does not resurrect a keeper the user deleted",
    !deleted.shadowKeeperSpecies.includes(feedKeepers[0]));
  check("a config with no roster at all still gets the full seed",
    mergeImportedConfig({}).shadowKeeperSpecies.length === feedKeepers.length);

  // The upgrade path, and the one the unit tests above cannot see: every
  // existing user has a curated roster and NO fingerprint, because the field
  // ships with this change. mergeImportedConfig's canonicalize() maps a missing
  // array to [], which as a fingerprint reads "has seen nothing" and dumps the
  // whole feed over their list. Absent must grandfather instead.
  const seeded = resolveSpecies("metagross");
  const ownAddition = resolveSpecies("bagon");
  const upgrading = mergeImportedConfig({ shadowKeeperSpecies: [seeded, ownAddition] });
  check("an upgrading config is grandfathered, not flooded",
    upgrading.shadowKeeperSpecies.length === 2,
    `${upgrading.shadowKeeperSpecies.length} entries`);
  check("and keeps exactly what the user had",
    upgrading.shadowKeeperSpecies.includes(seeded)
      && upgrading.shadowKeeperSpecies.includes(ownAddition),
    upgrading.shadowKeeperSpecies.join(", "));
  check("an explicitly emptied roster stays empty",
    mergeImportedConfig({ shadowKeeperSpecies: [] }).shadowKeeperSpecies.length === 0);
  // Grandfathering sets the fingerprint to the feed as it stands now, so the
  // very next merge is a no-op and only species added AFTER the upgrade flow
  // in. That is the point — the user is treated as having seen today's meta,
  // not as owing it. (The "picks up new feed entries" case is covered against
  // a synthetic feed above; mergeImportedConfig can only see the live one.)
  const nextVisit = mergeImportedConfig(upgrading);
  check("the merge after grandfathering is a no-op",
    JSON.stringify(nextVisit.shadowKeeperSpecies) === JSON.stringify(upgrading.shadowKeeperSpecies));
  check("and the fingerprint is now the live feed, so later additions flow",
    nextVisit.shadowKeeperSeen.length === feedKeepers.length);

  // And through the import path, where the fingerprints ride in the envelope's
  // config: a months-old export must not drag its owner back to that meta.
  const imported = prepareImport({
    schema: "pogo-filter-workshop/v1",
    data: {
      topAttackers: ["mewtwo"],
      config: { topAttackerSeen: ["mewtwo"] },
    },
  });
  check("an imported roster reconciles against the current feed",
    imported.topAttackers.length > 1 && imported.topAttackers[0] === "mewtu",
    imported.topAttackers.slice(0, 3).join(", "));
  check("import bumps the fingerprint too",
    Array.isArray(imported.config.topAttackerSeen)
      && imported.config.topAttackerSeen.length === DEFAULT_CONFIG.topAttackerSeen.length);
}

console.log(`\n${failures === 0 ? "✓ All migration tests passed." : `✗ ${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
