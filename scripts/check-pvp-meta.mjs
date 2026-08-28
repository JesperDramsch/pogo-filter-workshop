// Regression tests for the "intelligent" PvP cutout — the meta-aware split of
// the trash/trade PvP carve-out.
// Run with: npx vite-node scripts/check-pvp-meta.mjs
//
// The mode replaces one global IV trade-off with two tiers: everything keeps a
// perfect PvP spread (base tier, strict by default — insurance against a future
// buff), and a user-curated list of species keeps the wider near-perfect
// spreads too (meta tier, loose by default).
//
// The load-bearing detail is the CLAUSE SHAPE. Widening a tier for some species
// needs ONE clause per species. A single clause listing them all —
// `!+a,!+b,…,2-4attack,…` — reads as a comma-OR, so it is satisfied by any
// species you are NOT and goes vacuously true for everybody. That form silently
// does nothing, which is exactly the failure a snapshot would not catch, so P3
// and P5 below pin the behaviour through evalFilter rather than the string.
//
//   P1 — the legacy modes stay byte-identical (the fixture's guarantee, re-stated
//        here so a refactor of the tier plumbing fails loudly and locally)
//   P2 — an empty list is inert: intelligent == its base tier, byte for byte
//   P3 — with a list, exactly one carve-out clause per species, in trash AND trade
//   P4 — the carve-out is skipped when it would be redundant (meta tier not
//        wider than base tier)
//   P5 — behaviour: listed species keep the wider spread, unlisted ones do not
//   P6 — families: a pre-evolution of a listed species is covered (`+` semantics)
//   P7 — clauses render in the user's PoGo output locale
//   P8 — the league packs are well formed and usable as seeds
//   P9 — migration coerces junk and leaves legacy configs untouched
//  P10 — the packs seed the TOP of the ranked list, the label quotes that depth
//        in every locale, and the carve-out costs what the config panel prices

import {
  buildFilters, evalFilter, mergeImportedConfig, DEFAULT_CONFIG, SEARCH_CHAR_BUDGET,
} from "../src/App.jsx";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";
import { pokemonNameFor } from "../src/data/species.js";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "locales", "app");

const tFn = (k) => k;
let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const clauses = (filterStr) => filterStr.split("&");
const build = (cfg, locale = "en") => buildFilters([], [], mergeImportedConfig(cfg), [], locale, tFn);
// Carve-out clauses are the only ones that open with a negated family and then
// carry IV ranges. Matched structurally, NOT by the English keyword — the IV
// tokens are localized ("2-4attack" / "2-4angriffs-wert"), and an EN-only
// pattern would silently find nothing in the other six locales and pass every
// `every()` assertion vacuously.
const metaClauses = (filterStr) =>
  clauses(filterStr).filter((c) => /^!\+[^,]+(,\d+-\d+[^,]+){3}$/.test(c));

// Two Great League regulars, plus a species that is on no list.
const LIST = ["azumarill", "medicham"];
const INTEL = { pvpMode: "intelligent", pvpMetaSpecies: LIST };

console.log("P1 — the legacy modes are untouched");
{
  for (const mode of ["loose", "strict", "none"]) {
    const before = build({ pvpMode: mode });
    // A meta list set while a legacy mode is active must not leak into the output:
    // the list belongs to intelligent mode only.
    const withList = build({ pvpMode: mode, pvpMetaSpecies: LIST });
    check(`${mode}: a stray meta list changes nothing`,
      withList.trash === before.trash && withList.trade === before.trade);
    check(`${mode}: no carve-out clauses emitted`, metaClauses(before.trash).length === 0);
  }
  check("default config is strict (fixture's assumption)", DEFAULT_CONFIG.pvpMode === "strict");
  check("default meta list is empty", (DEFAULT_CONFIG.pvpMetaSpecies || []).length === 0);
}

console.log("\nP2 — an empty list makes intelligent inert");
{
  const strict = build({ pvpMode: "strict" });
  const empty = build({ pvpMode: "intelligent", pvpMetaSpecies: [] });
  check("intelligent + empty list == strict (trash, byte-identical)", empty.trash === strict.trash);
  check("intelligent + empty list == strict (trade, byte-identical)", empty.trade === strict.trade);

  // ...and it follows the BASE tier, not a hardcoded strict.
  const loose = build({ pvpMode: "loose" });
  const emptyLooseBase = build({ pvpMode: "intelligent", pvpMetaSpecies: [], pvpBaseTier: "loose" });
  check("base tier drives the empty-list output (loose)", emptyLooseBase.trash === loose.trash);
  const none = build({ pvpMode: "none" });
  const emptyNoneBase = build({ pvpMode: "intelligent", pvpMetaSpecies: [], pvpBaseTier: "none" });
  check("base tier drives the empty-list output (none)", emptyNoneBase.trash === none.trash);
}

console.log("\nP3 — one carve-out clause per listed species, in trash AND trade");
{
  const strict = build({ pvpMode: "strict" });
  const r = build(INTEL);
  const added = clauses(r.trash).filter((c) => !clauses(strict.trash).includes(c));
  check(`exactly ${LIST.length} clauses added to trash`, added.length === LIST.length, added.join(" | "));
  check("each added clause is one negated family + the loose IV pattern",
    added.every((c) => /^!\+[^,]+,2-4attack,0-2defense,0-2hp$/.test(c)), added.join(" | "));
  check("one clause per species, not one clause listing them all",
    added.every((c) => (c.match(/!\+/g) || []).length === 1), added.join(" | "));
  check("both listed species are covered",
    LIST.every((sp) => added.some((c) => c.startsWith(`!+${sp}`))), added.join(" | "));

  const addedTrade = clauses(r.trade).filter((c) => !clauses(strict.trade).includes(c));
  check("trade mirrors trash exactly (same carve-outs)",
    addedTrade.length === added.length && addedTrade.every((c, i) => c === added[i]),
    addedTrade.join(" | "));

  // Nothing else moved: the carve-outs are purely additive.
  check("no clause was removed from trash",
    clauses(strict.trash).every((c) => clauses(r.trash).includes(c)));
}

console.log("\nP4 — redundant carve-outs are skipped");
{
  // The base clause already implies every carve-out unless the meta tier is
  // strictly wider (`2-4attack` ⟹ `1-4attack`), so emitting them would be dead
  // weight in an already ~100-clause string.
  for (const [meta, base, why] of [
    ["strict", "strict", "same tier"],
    ["loose", "loose", "same tier"],
    ["strict", "loose", "base already wider"],
  ]) {
    const r = build({ ...INTEL, pvpMetaTier: meta, pvpBaseTier: base });
    check(`meta=${meta} base=${base}: no clauses (${why})`, metaClauses(r.trash).length === 0);
  }
  // ...and it DOES emit when the meta tier is genuinely wider than the base.
  for (const [meta, base] of [["loose", "strict"], ["loose", "none"], ["strict", "none"]]) {
    const r = build({ ...INTEL, pvpMetaTier: meta, pvpBaseTier: base });
    check(`meta=${meta} base=${base}: ${LIST.length} clauses emitted`,
      metaClauses(r.trash).length === LIST.length);
  }
}

console.log("\nP5 — behaviour: the list gets the wider spread, everyone else does not");
{
  const f = build(INTEL).trash;
  // Bars, not raw IVs — the same convention check-carveouts.mjs uses.
  const base = {
    families: ["azumarill"], dex: 184, types: ["water", "fairy"], year: 2024, ageDays: 5,
    distance: 0, wp: 1400, star: 2,
    flags: { traded: false, shadow: false, lucky: false, favorite: false, shiny: false,
             legendary: false, mythical: false, ultrabeast: false, costume: false, purified: false,
             background: false, dynamaxCapable: false, doubleMoved: false, xxl: false, xl: false,
             xxs: false, tagged: false, legacyMove: false, newDexEvo: false, eggOnly: false,
             buddy: false, megaEvolved: false },
  };
  const mon = (o = {}) => ({ ...base, atk: 0, def: 4, hp: 4, ...o, flags: { ...base.flags, ...(o.flags || {}) } });
  const OTHER = { dex: 19, families: ["rattata"], types: ["normal"] };
  const trashed = (o) => evalFilter(f, mon(o), "en");

  check("listed, 0/4/4 (perfect PvP) — kept", !trashed({}));
  check("listed, 1/3/4 (bar-1 attack) — kept by the wider tier", !trashed({ atk: 1, def: 3, hp: 4 }));
  check("listed, 1/4/3 (bar-1 attack, HP floor) — kept", !trashed({ atk: 1, def: 4, hp: 3 }));
  check("listed, 2/4/4 (bar-2 attack) — trashed, not a PvP spread", trashed({ atk: 2, def: 4, hp: 4 }));
  check("listed, 1/2/4 (defense floor missed) — trashed", trashed({ atk: 1, def: 2, hp: 4 }));
  check("listed, 1/4/2 (HP floor missed) — trashed", trashed({ atk: 1, def: 4, hp: 2 }));

  check("unlisted, 0/4/4 (perfect PvP) — kept by the base tier", !trashed({ ...OTHER }));
  check("unlisted, 1/3/4 (bar-1 attack) — trashed, base tier is strict",
    trashed({ ...OTHER, atk: 1, def: 3, hp: 4 }));

  // With the base tier off, only the list survives at all.
  const fNoBase = build({ ...INTEL, pvpBaseTier: "none" }).trash;
  const t2 = (o) => evalFilter(fNoBase, mon(o), "en");
  check("base=none: listed 1/3/4 still kept", !t2({ atk: 1, def: 3, hp: 4 }));
  check("base=none: unlisted 0/4/4 no longer PvP-protected", t2({ ...OTHER }));
}

console.log("\nP6 — carve-outs are family-wide (the `+` operator)");
{
  const f = build(INTEL).trash;
  const marill = {
    dex: 183, families: ["azumarill"], types: ["water", "fairy"], year: 2024, ageDays: 5,
    distance: 0, wp: 700, star: 2, atk: 1, def: 3, hp: 4,
    flags: { traded: false, shadow: false, lucky: false, favorite: false, shiny: false,
             legendary: false, mythical: false, ultrabeast: false, costume: false, purified: false,
             background: false, dynamaxCapable: false, doubleMoved: false, xxl: false, xl: false,
             xxs: false, tagged: false, legacyMove: false, newDexEvo: false, eggOnly: false,
             buddy: false, megaEvolved: false },
  };
  check("a pre-evolution in a listed family is covered", !evalFilter(f, marill, "en"));
}

console.log("\nP7 — clauses render in the PoGo output locale");
{
  const en = build(INTEL, "en");
  const de = build(INTEL, "de");
  check("EN emits English species names", metaClauses(en.trash).some((c) => /^!\+medicham,/.test(c)),
    metaClauses(en.trash).join(" | "));
  check("DE emits German species names", metaClauses(de.trash).some((c) => /^!\+meditalis,/i.test(c)),
    metaClauses(de.trash).join(" | "));
  check("DE emits localized IV keywords, not English ones",
    metaClauses(de.trash).every((c) => !c.includes("attack")), metaClauses(de.trash).join(" | "));
  check("same clause COUNT in every locale",
    metaClauses(en.trash).length === metaClauses(de.trash).length);
}

console.log("\nP8 — league packs exist and are usable as seeds");
{
  const { pvpMetaPacks } = build({});
  check("two packs offered (Great + Ultra)", pvpMetaPacks.length === 2,
    pvpMetaPacks.map((p) => p.id).join(", "));
  check("Master League is NOT offered (uncapped — low attack is bad there)",
    !pvpMetaPacks.some((p) => p.id === "master"));
  for (const pack of pvpMetaPacks) {
    check(`${pack.id}: non-empty, deduped species list`,
      pack.species.length > 0 && new Set(pack.species).size === pack.species.length,
      `${pack.species.length} species`);
    check(`${pack.id}: display list is parallel to species`,
      pack.display.length === pack.species.length);
    check(`${pack.id}: every name resolves (no undefined/empty)`,
      pack.species.every((s) => typeof s === "string" && s.length > 0));
  }
  // A pack seeded into the list must actually produce carve-outs.
  const seeded = build({ pvpMode: "intelligent", pvpMetaSpecies: pvpMetaPacks[0].species });
  check("seeding a whole pack emits one clause per species",
    metaClauses(seeded.trash).length === pvpMetaPacks[0].species.length,
    `${metaClauses(seeded.trash).length} clauses for ${pvpMetaPacks[0].species.length} species`);
}

console.log("\nP9 — migration coerces junk and preserves legacy configs");
{
  const junk = mergeImportedConfig({ pvpMode: "wat", pvpMetaTier: "nope", pvpBaseTier: 7 });
  check("unknown pvpMode falls back to strict", junk.pvpMode === "strict");
  check("unknown pvpMetaTier falls back to loose", junk.pvpMetaTier === "loose");
  check("unknown pvpBaseTier falls back to strict", junk.pvpBaseTier === "strict");

  const legacy = mergeImportedConfig({ pvpMode: "loose" });
  check("a legacy config keeps its mode", legacy.pvpMode === "loose");
  check("a legacy config gains an empty meta list", (legacy.pvpMetaSpecies || []).length === 0);

  // Species are canonicalized to the storage locale, so an English import lands
  // on the same entry a German one would.
  const mixed = mergeImportedConfig({ pvpMode: "intelligent", pvpMetaSpecies: ["Medicham", "meditalis"] });
  check("mixed-locale imports canonicalize to one entry", mixed.pvpMetaSpecies.length === 1,
    JSON.stringify(mixed.pvpMetaSpecies));
}

// The carve-out costs ~56 characters PER SPECIES against a ~5000-character
// search bar and cannot be compressed (see pushPvPMetaClauses), so pack DEPTH is
// the only lever. A pack used to seed its whole league — 30 each, 47 deduped,
// 2.6 kB of clauses — which more than doubled the trash filter on two taps.
console.log("\nP10 — pack depth and the cost the panel quotes");
{
  const { pvpMetaPacks } = build({ pvpMode: "intelligent" });
  for (const pack of pvpMetaPacks) {
    const league = PVP_RANKINGS.leagues[pack.id];
    // Rank order is the snapshot's own: the fetcher writes species by PvPoke
    // score, descending. A pack must be the HEAD of that, not a sample of it —
    // an arbitrary slice would drop the picks the depth exists to keep.
    const ranked = [...new Set(league.species.map(sp => pokemonNameFor(String(sp.dex))).filter(Boolean))];
    check(`${pack.id}: seeds the top of the ranked list, in order`,
      pack.species.length > 0 &&
      pack.species.every((sp, i) => sp === ranked[i]),
      `${pack.species.length} of ${ranked.length}`);
    check(`${pack.id}: the league snapshot is deeper than the pack seeds`,
      ranked.length > pack.species.length,
      "otherwise the depth cut is silently inert");
    check(`${pack.id}: every seeded species resolves`,
      pack.species.every(sp => typeof sp === "string" && sp.length > 0));
  }
  check("all packs seed the same depth",
    new Set(pvpMetaPacks.map(p => p.species.length)).size === 1);

  // The pack buttons name their depth ("Great League top 10"), so the label is a
  // second, hand-written copy of PVP_META_PACK_DEPTH — and it has already drifted
  // once: the cut from 30 to 10 left all seven locales advertising a top-30 seed.
  // A label must quote the depth the pack actually seeds and no other number.
  const depth = pvpMetaPacks[0]?.species.length ?? 0;
  for (const file of readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json"))) {
    const strings = JSON.parse(readFileSync(join(LOCALE_DIR, file), "utf8"));
    for (const pack of pvpMetaPacks) {
      const label = strings[pack.labelKey];
      const numbers = String(label ?? "").match(/\d+/g) || [];
      check(`${file} ${pack.id}: the label quotes the seeded depth`,
        typeof label === "string" && numbers.length === 1 && numbers[0] === String(depth),
        `"${label}" vs depth ${depth}`);
    }
  }

  // Both packs, the shadow-keeper floor on, and the whole thing still has to
  // fit in the search bar. This is the combination that motivated the cut.
  const all = [...new Set(pvpMetaPacks.flatMap(p => p.species))];
  // protectShadows is unset AFTER the merge on purpose: passing it to
  // mergeImportedConfig trips the legacy migration, which pins the purify floor
  // OFF and so measures a filter with no keeper clauses at all. Unchecking the
  // toggle in-session is what leaves the floor on, and that is the worst case.
  const worstCfg = mergeImportedConfig({ pvpMode: "intelligent", pvpMetaSpecies: all });
  worstCfg.protectShadows = false;
  const worst = buildFilters([], [], worstCfg, [], "de", tFn);
  check("the worst case really carries the keeper floor",
    clauses(worst.trash).some(c => /^!crypto,!\+/i.test(c)), "otherwise the budget check is vacuous");
  check("both packs + the crypto floor fit the search budget",
    worst.trash.length <= SEARCH_CHAR_BUDGET,
    `${worst.trash.length} / ${SEARCH_CHAR_BUDGET}`);

  // PvpMetaPanel prices the list as `4 + species.length + ivTierLen` per entry
  // (the `&`, the `!+`, the `,`, the name, the IV tier). If the emitter's shape
  // ever changes, the number the user reads stops matching what they pay.
  const seeded = build({ pvpMode: "intelligent", pvpMetaSpecies: all }, "de");
  const carve = metaClauses(seeded.trash);
  const emitted = carve.reduce((sum, c) => sum + c.length + 1, 0); // +1 for the `&`
  const ivTierLen = carve[0].slice(carve[0].indexOf(",") + 1).length;
  const priced = all.reduce((sum, sp) => sum + 4 + sp.length + ivTierLen, 0);
  check("the panel's per-species price matches what buildFilters emits",
    emitted === priced, `emitted ${emitted}, priced ${priced}`);
}

console.log(`\n${failures === 0 ? "✓ All intelligent-PvP checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
