// Regression tests for the hundo + friend (buddy) carve-out logic.
// Run with: npx vite-node scripts/check-carveouts.mjs
//
// Covers:
//   B1  — regional protection OUTRANKS the hundo carve-out: owning a hundo of
//         a protected regional does NOT drop its typeCheck/collector clauses
//         (unchecking the species in the regionals step is the explicit
//         opt-out; the hundo adder warns via regionalProtectionsFor).
//   B2a — buddy tag prefixes are protected in the TRADE filter (granular-tag
//         mode), so friend-staged mons don't leak into the general trade pile.
//   B2b — buddy tag prefixes are surfaced in the PRESTAGED filter, so the
//         hand-off pile has an output filter at all.

import {
  buildFilters, evalFilter, mergeImportedConfig, DEFAULT_CONFIG,
  regionalProtectionsFor, ivToBar, starFromIVs,
} from "../src/App.jsx";
import { resolveSpecies } from "../src/data/species.js";
import META_RANKINGS from "../src/data/meta-rankings.json";

const tFn = (k) => k;
let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const clauses = (filterStr) => filterStr.split("&");
const hasClauseMatching = (filterStr, re) => clauses(filterStr).some(c => re.test(c));

const BUDDY = { id: "1", name: "Auri", tagPrefix: "#auri", active: true, targetSpecies: ["kindwurm"] };

console.log("B1 — regional protection outranks the hundo carve-out");
{
  // Galarian Corsola (Corasonn) is BOTH a galarian typeCheck (ghost form) AND a
  // regionals collector. Owning a hundo must keep BOTH — dupes of a regional
  // are trade bait, not junk. The opt-out is unchecking the species chips.
  const withHundo = buildFilters(["corasonn"], [], mergeImportedConfig({}), [], "de", tFn);
  const noHundo   = buildFilters([],            [], mergeImportedConfig({}), [], "de", tFn);

  check("no-hundo baseline: galarian ghost protection present",
    hasClauseMatching(noHundo.trash, /^!Corasonn,!geist/i),
    "regression guard");
  check("no-hundo baseline: regionals collector present",
    hasClauseMatching(noHundo.trash, /^!corasonn$/i),
    "regression guard");

  check("hundo corasonn: galarian ghost protection KEPT",
    hasClauseMatching(withHundo.trash, /^!Corasonn,!geist/i));
  check("hundo corasonn: regionals collector KEPT",
    hasClauseMatching(withHundo.trash, /^!corasonn$/i));
  check("hundo corasonn: general +species token still in trash clause 1 (moot but harmless)",
    withHundo.trash.split("&")[0].includes("+corasonn"));

  // The explicit opt-out: unchecking the collector + typeCheck chips drops the
  // clauses even though the group stays enabled.
  const optedOut = mergeImportedConfig({});
  optedOut.regionalGroups.galarian = { ...optedOut.regionalGroups.galarian,
    typeChecksEnabled: ["Smogmog", "Pantimos", "Makabaja", "Porenta"] }; // minus Corasonn
  optedOut.regionalGroups.regionals = { ...optedOut.regionalGroups.regionals, collectorsEnabled: [] };
  const out = buildFilters(["corasonn"], [], optedOut, [], "de", tFn);
  check("unchecking the chips drops the protection (manual opt-out works)",
    !hasClauseMatching(out.trash, /^!Corasonn,!geist/i) && !hasClauseMatching(out.trash, /^!corasonn$/i));
}

console.log("\nB1 — Paldean Tauros: typeChecks survive hundo ownership too");
{
  const withHundo = buildFilters(["tauros"], [], mergeImportedConfig({}), [], "de", tFn);
  const noHundo   = buildFilters([],         [], mergeImportedConfig({}), [], "de", tFn);
  const tauroClauses = (f) => clauses(f.trash).filter(c => /^!Tauros,/i.test(c));
  check("no-hundo baseline: Tauros typeChecks present (3 paldean + 1 base)",
    tauroClauses(noHundo).length >= 4, `found ${tauroClauses(noHundo).length}`);
  check("hundo tauros: ALL Tauros typeCheck clauses kept",
    tauroClauses(withHundo).length === tauroClauses(noHundo).length,
    `found ${tauroClauses(withHundo).length}`);
}

console.log("\nB1 — regionalProtectionsFor drives the hundo-adder popup");
{
  const cfg = mergeImportedConfig({});
  check("corasonn reports its protecting groups",
    regionalProtectionsFor("corasonn", cfg).length >= 2,
    `got ${JSON.stringify(regionalProtectionsFor("corasonn", cfg))}`);
  check("input locale doesn't matter (EN 'Corsola' resolves)",
    JSON.stringify(regionalProtectionsFor("Corsola", cfg))
      === JSON.stringify(regionalProtectionsFor("corasonn", cfg)));
  check("a non-regional (Dratini) reports nothing",
    regionalProtectionsFor("dratini", cfg).length === 0);
  const off = mergeImportedConfig({});
  off.regionalGroups.galarian = { ...off.regionalGroups.galarian, enabled: false };
  off.regionalGroups.regionals = { ...off.regionalGroups.regionals, collectorsEnabled: [] };
  check("disabled group + unchecked collector → no popup for corasonn",
    regionalProtectionsFor("corasonn", off).length === 0,
    `got ${JSON.stringify(regionalProtectionsFor("corasonn", off))}`);
}

console.log("\nVerify tester: star rating + bars derive from raw IVs (no impossible mons)");
{
  check("15/15/15 → 4★ hundo, max bars", starFromIVs(15, 15, 15) === 4 && ivToBar(15) === 4);
  check("44 total (14/15/15) → 3★, NOT 4★", starFromIVs(14, 15, 15) === 3);
  check("37 total → 3★ floor", starFromIVs(15, 15, 7) === 3);
  check("36 total → 2★ ceiling", starFromIVs(15, 15, 6) === 2);
  check("30 total → 2★ floor", starFromIVs(10, 10, 10) === 2);
  check("29 total → 1★ ceiling", starFromIVs(10, 10, 9) === 1);
  check("23 total → 1★ floor", starFromIVs(8, 8, 7) === 1);
  check("22 total → 0★ ceiling", starFromIVs(8, 8, 6) === 0);
  check("0/0/0 → 0★ nundo, empty bars", starFromIVs(0, 0, 0) === 0 && ivToBar(0) === 0);
  check("bar buckets: 1-5 → 1, 6-10 → 2, 11-14 → 3",
    ivToBar(1) === 1 && ivToBar(5) === 1 && ivToBar(6) === 2
    && ivToBar(10) === 2 && ivToBar(11) === 3 && ivToBar(14) === 3);
}

console.log("\nB2a — buddy tags protected in TRADE (granular-tag mode)");
{
  const cfg = mergeImportedConfig({ protectAnyTag: false, buddies: [BUDDY] });
  const r = buildFilters([], [], cfg, [], "de", tFn);
  check("buddy tag protected in trash (baseline)", hasClauseMatching(r.trash, /^!#auri$/));
  check("buddy tag protected in TRADE", hasClauseMatching(r.trade, /^!#auri$/));
  // It should behave like the basar/fern trade tags (also protected in trade).
  check("basar tag also protected in trade (parity sanity)", hasClauseMatching(r.trade, /^!#Trade$/));
}

console.log("\nB2a — protectAnyTag=true still covers buddy tags via !#");
{
  const cfg = mergeImportedConfig({ protectAnyTag: true, buddies: [BUDDY] });
  const r = buildFilters([], [], cfg, [], "de", tFn);
  check("trade uses catch-all !# (no per-tag clause needed)", hasClauseMatching(r.trade, /^!#$/));
}

console.log("\nB2b — buddy hand-off pile surfaced in PRESTAGED");
{
  const cfg = mergeImportedConfig({ protectAnyTag: false, buddies: [BUDDY] });
  const r = buildFilters([], [], cfg, [], "de", tFn);
  const tagClause = r.prestaged.split("&")[0] || "";
  check("prestaged surfaces #auri positively (in tag allow-list clause)",
    tagClause.split(",").includes("#auri"), `clause 1 = ${tagClause}`);
  check("prestaged still includes the basar/fern tags",
    tagClause.includes("#Trade") && tagClause.includes("#Fern-Tausch"));
}

console.log("\nTrade keeper-protection parity (XXS + new-dex evolutions)");
{
  const r = buildFilters([], [], mergeImportedConfig({}), [], "de", tFn);
  check("trade protects XXS (size-medal triplet complete)", hasClauseMatching(r.trade, /^!xxs$/i));
  check("trade still protects XXL and XL", hasClauseMatching(r.trade, /^!xxl$/i) && hasClauseMatching(r.trade, /^!xl$/i));
  check("trade protects new-dex evolutions", hasClauseMatching(r.trade, /^!neueentwicklung,mega0$/i));
  check("trash still protects all three sizes + new-evos (unchanged)",
    hasClauseMatching(r.trash, /^!xxs$/i) && hasClauseMatching(r.trash, /^!neueentwicklung,mega0$/i));
  // Babies + regional collectibles were intentionally NOT added to trade.
  check("trade does NOT protect babies (intentional)", !hasClauseMatching(r.trade, /^!nurauseiern$/i));
  check("trade does NOT whole-species-protect regionals (intentional)", !hasClauseMatching(r.trade, /^!tropius$/i));
}

console.log("\nSmeargle carve-out parity (trash = trade = buddy-catch)");
{
  // English locale → stable tokens: special_move="special", Smeargle="smeargle".
  const r = buildFilters([], [], mergeImportedConfig({ buddies: [BUDDY] }), [], "en", tFn);
  const legacyOf = (f) => clauses(f).find(c => c.includes("@special"));
  const trashLegacy = legacyOf(r.trash);
  const tradeLegacy = legacyOf(r.trade);
  const buddyLegacy = legacyOf(r.buddyCatchFilters[0]?.filter || "");
  check("default carves Smeargle in trash (baseline)", !!trashLegacy && trashLegacy.includes("smeargle"));
  check("trade legacy clause == trash (carves Smeargle)", tradeLegacy === trashLegacy, `trade=${tradeLegacy}`);
  check("buddy-catch legacy clause == trash (carves Smeargle)", buddyLegacy === trashLegacy, `buddy=${buddyLegacy}`);

  const r2 = buildFilters([], [], mergeImportedConfig({ protectSmeargleLegacy: true }), [], "en", tFn);
  check("protectSmeargleLegacy=true: carve drops from trade too",
    !legacyOf(r2.trade).includes("smeargle") && legacyOf(r2.trade) === legacyOf(r2.trash));
}

console.log("\nprotectBuddies (was-ever-a-buddy) mirrored into trade");
{
  const on  = buildFilters([], [], mergeImportedConfig({ protectBuddies: true }),  [], "en", tFn);
  const off = buildFilters([], [], mergeImportedConfig({ protectBuddies: false }), [], "en", tFn);
  const added = clauses(on.trade).filter(c => !clauses(off.trade).includes(c));
  check("protectBuddies adds exactly one trade clause", added.length === 1, added.join("|"));
  check("the added trade clause matches the trash was-buddy clause",
    added.length === 1 && clauses(on.trash).includes(added[0]));
  check("default (off): no was-buddy clause in trade", clauses(off.trade).filter(c => /\bbuddy1-$/i.test(c)).length === 0);
}

console.log("\nLucky-hundo set canonicalizes across locales");
{
  // hundo stored raw EN ("Charizard"), lucky stored canonical DE ("glurak") —
  // same species. Pre-fix these didn't match and the lucky-hundo leaked to trade.
  const r = buildFilters(["Charizard"], ["glurak"], mergeImportedConfig({}), [], "en", tFn);
  check("mixed-locale intersection detected (size 1)", r.luckyHundoSet.size === 1, `size=${r.luckyHundoSet.size}`);
  check("lucky-hundo excluded from trade", !r.trade.includes("+charizard"));
  check("lucky-hundo still in trash (full H clause)", r.trash.includes("+charizard"));
  check("lucky-hundo surfaced in luckySort", r.luckySort.includes("+charizard"));
}

console.log("\nBuddy spare-dupe surfacing (you own a hundo of a species the buddy wants)");
{
  // Julia wants corasonn (you have a 4★ + lucky of it) and dratini (no hundo).
  const julia = { id: "j", name: "Julia", tagPrefix: "#julia", active: true, targetSpecies: ["corasonn", "dratini"] };
  const cfg = mergeImportedConfig({ buddies: [julia] });
  const r = buildFilters(["corasonn"], ["corasonn"], cfg, [], "de", tFn);
  const f = r.buddyCatchFilters.find(b => b.buddyName === "Julia").filter;
  const base = {
    families: ["corasonn"], types: ["ghost"], year: 2024, ageDays: 5, distance: 0, wp: 1500,
    flags: { traded:false, shadow:false, lucky:false, favorite:false, shiny:false, legendary:false,
             mythical:false, ultrabeast:false, costume:false, purified:false, background:false,
             dynamaxCapable:false, doubleMoved:false, xxl:false, xl:false, xxs:false, tagged:false,
             legacyMove:false, newDexEvo:false, eggOnly:false, buddy:false, megaEvolved:false },
  };
  const mon = (o = {}) => ({ ...base, dex: 222, atk: 3, def: 3, hp: 3, star: 3, ...o,
    flags: { ...base.flags, ...(o.flags || {}) } });
  const shows = (m) => evalFilter(f, m, "de");

  check("spare 3★ corasonn (have hundo) SHOWS for Julia", shows(mon({ star: 3 })));
  check("4★ corasonn (your hundo) hidden", !shows(mon({ star: 4, atk: 4, def: 4, hp: 4 })));
  check("lucky corasonn hidden (keep your lucky)", !shows(mon({ star: 3, flags: { lucky: true } })));
  check("0★/2★ corasonn still show (normal catch)", shows(mon({ star: 0 })) && shows(mon({ star: 2 })));
  check("shiny 3★ corasonn hidden (don't gift collectibles)", !shows(mon({ star: 3, flags: { shiny: true } })));
  check("already-tagged 3★ corasonn hidden", !shows(mon({ star: 3, flags: { tagged: true } })));
  check("3★ dratini hidden (no hundo of it — keep it)",
    !shows(mon({ dex: 147, families: ["dratini"], types: ["dragon"], star: 3 })));
  check("2★ dratini still shows (normal catch)",
    shows(mon({ dex: 147, families: ["dratini"], types: ["dragon"], star: 2 })));

  // No-spare case stays byte-identical: a buddy wanting only a non-hundo species
  // gets the plain 0*,1*,2* clause and no !4* guard.
  const r2 = buildFilters([], [], mergeImportedConfig({ buddies: [{ id: "k", name: "Kai", tagPrefix: "#kai", active: true, targetSpecies: ["dratini"] }] }), [], "de", tFn);
  const fk = r2.buddyCatchFilters.find(b => b.buddyName === "Kai").filter;
  check("no-hundo buddy: plain 0*,1*,2* clause, no !4*", clauses(fk).includes("0*,1*,2*") && !clauses(fk).includes("!4*"));
}

console.log("\nMap-marked bazaar species protected in TRASH (Choreogel regression)");
{
  // Simulate the auto-drop that burned travelers: home sits in an Oricorio
  // region, so effectiveConfig removed Choreogel from the collectibles group —
  // and the map-marked list used to have NO effect on the filters at all.
  const cfg = mergeImportedConfig({});
  cfg.regionalGroups = {
    ...cfg.regionalGroups,
    collectibles: { ...cfg.regionalGroups.collectibles, collectorsEnabled: [] },
  };
  const noMark = buildFilters([], [], cfg, [], "de", tFn, []);
  const marked = buildFilters([], [], cfg, [], "de", tFn, [], ["Choreogel (Buyo)", "Choreogel (Hula)"]);

  check("baseline: collector dropped → Choreogel unprotected",
    !hasClauseMatching(noMark.trash, /^!choreogel$/i), "regression guard");
  check("map-marked: species protected in trash", hasClauseMatching(marked.trash, /^!Choreogel$/));
  check("form suffixes collapse to ONE species clause",
    clauses(marked.trash).filter(c => /choreogel/i.test(c)).length === 1,
    clauses(marked.trash).filter(c => /choreogel/i.test(c)).join("|"));

  // Dedupe: default config still has the Choreogel collector enabled — the
  // bazaar entry must not add a second clause.
  const dflt = buildFilters([], [], mergeImportedConfig({}), [], "de", tFn, [], ["Choreogel (Buyo)"]);
  check("collector already enabled → no duplicate clause",
    clauses(dflt.trash).filter(c => /^!choreogel$/i.test(c)).length === 1);

  // German map names re-render in the user's PoGo output locale.
  const en = buildFilters([], [], cfg, [], "en", tFn, [], ["Choreogel (Buyo)"]);
  check("marked species renders in output locale (EN)", hasClauseMatching(en.trash, /^!Oricorio$/));

  // Trade stays intentionally asymmetric: marked mons are FOR trading away.
  check("trade does NOT whole-species-protect marked mons (intentional)",
    !hasClauseMatching(marked.trade, /^!choreogel$/i));

  // No marks → byte-identical output (fixtures stay stable).
  const before = buildFilters([], [], mergeImportedConfig({}), [], "de", tFn, []);
  const after  = buildFilters([], [], mergeImportedConfig({}), [], "de", tFn, [], []);
  check("empty bazaar list leaves trash byte-identical", before.trash === after.trash);
}

// How many `!crypto,!+species` clauses the floor emits under DEFAULT protection
// flags: one per keeper, minus the ones `!legendär` / `!mysteriös` /
// `!ultrabestie` already cover. Derived from the same sync-emitted class map the
// emitter reads, so the number moves with the roster instead of being pinned.
// S6 below is what actually exercises the trim.
const KEEPER_CLASSES = META_RANKINGS.shadowKeeperClasses || {};
const FLOOR_KEEPER_COUNT = mergeImportedConfig({}).shadowKeeperSpecies
  .filter(sp => !KEEPER_CLASSES[sp] && !KEEPER_CLASSES[resolveSpecies(sp, "en")]).length;

console.log("\nS1 — shadow purify-floor: default keeps the blanket !crypto");
{
  const def = buildFilters([], [], mergeImportedConfig({}), [], "de", tFn);
  check("default trash has blanket !crypto", hasClauseMatching(def.trash, /^!crypto$/i));
  check("default trash has NO purify-floor clause", !hasClauseMatching(def.trash, /^!crypto,/i));
  check("trade always excludes shadows, independent of the split", hasClauseMatching(def.trade, /^!crypto$/i));
}

console.log("\nS2 — purify-floor ON (protectShadows off): four scoped clauses replace the blanket");
{
  const floor = buildFilters([], [], mergeImportedConfig({ protectShadows: false, protectShadowPurifyOnly: true }), [], "de", tFn);
  check("no blanket !crypto anymore", !hasClauseMatching(floor.trash, /^!crypto$/i));
  check("keeps purify-hundo IVs (!crypto,0-2…)", hasClauseMatching(floor.trash, /^!crypto,0-2/i), floor.trash);
  check("keeps cheap-to-purify (!crypto,bonbonkm3-)", hasClauseMatching(floor.trash, /^!crypto,bonbonkm3-$/i));
  check("keeps TM'd investment (!crypto,@frustration)", hasClauseMatching(floor.trash, /^!crypto,@frustration$/i));
  // The keeper floor is the fourth: the first three all reason about whether a
  // shadow is worth PURIFYING, which says nothing about one whose value is
  // staying a shadow. A Charge-TM'd Shadow Metagross clears all three and used
  // to be releasable.
  //
  // It emits ONE CLAUSE PER KEEPER, `!crypto,!+name`. The compact
  // `!crypto,+a,+b,…` it replaced was inverted: comma is OR, so it was
  // satisfied by a shadow that IS a keeper and false for every shadow that is
  // not — it protected the junk and released the keepers. S5 below pins the
  // semantics; this only pins the shape.
  check("keeps meta shadow attackers (!crypto,!+name per uncovered keeper)",
    clauses(floor.trash).filter(c => /^!crypto,!\+[^,&]+$/i.test(c)).length === FLOOR_KEEPER_COUNT);
  check("no positive-species keeper clause survives (the inverted shape)",
    !hasClauseMatching(floor.trash, /^!crypto,\+/i));
  check("three purify-decision floor clauses besides the keepers",
    clauses(floor.trash).filter(c => /^!crypto,/i.test(c) && !/^!crypto,!\+/i.test(c)).length === 3);
  check("trade still hard-excludes shadows", hasClauseMatching(floor.trade, /^!crypto$/i));
}

console.log("\nS2b — the keeper floor names the actual keeper roster");
{
  const cfg = mergeImportedConfig({ protectShadows: false, protectShadowPurifyOnly: true });
  const floor = buildFilters([], [], cfg, [], "de", tFn);
  const keeperClauses = clauses(floor.trash).filter(c => /^!crypto,!\+/i.test(c));
  const terms = keeperClauses.map(c => c.split(",")[1].slice(1)); // drop the leading "!"
  check(`one clause per keeper not already blanket-covered (${FLOOR_KEEPER_COUNT})`,
    terms.length === FLOOR_KEEPER_COUNT, `found ${terms.length}`);
  check("every term is a negated family search", terms.every(t => t.startsWith("+") && t.length > 1));
  // The roster is a daily sync, so this asserts the projection, not the names —
  // except for Metagross, which is the case that motivated the clause and is
  // the top Steel shadow by a wide margin in any plausible meta.
  //
  // The species name is DERIVED, not typed. The first draft of this check
  // hardcoded "+meistagrif" as the German for Metagross; Meistagrif is
  // Conkeldurr (534). It passed anyway — Conkeldurr is also a keeper — so the
  // check would have gone on passing with Metagross missing entirely. Same
  // rule as the filter emitters: species names come from the dictionary.
  const metagross = resolveSpecies("metagross", "de");
  check(`Shadow Metagross is protected by name (+${metagross})`,
    terms.includes(`+${metagross}`), `${terms.length} keeper clauses`);
  // An empty roster must collapse the clause entirely rather than emit
  // `!crypto,` — a dangling separator the game cannot parse.
  const empty = buildFilters([], [], mergeImportedConfig({
    protectShadows: false, protectShadowPurifyOnly: true, shadowKeeperSpecies: [],
  }), [], "de", tFn);
  check("empty keeper roster emits no keeper clause",
    !hasClauseMatching(empty.trash, /^!crypto,!?\+/i) && !/[&,]$|,,/.test(empty.trash));
}

console.log("\nS3 — migration: a legacy protectShadows:false config keeps releasing ALL shadows");
{
  const migrated = mergeImportedConfig({ protectShadows: false });
  check("floor pinned off for legacy protectShadows:false", migrated.protectShadowPurifyOnly === false);
  const r = buildFilters([], [], migrated, [], "de", tFn);
  check("no shadow clause at all (neither blanket nor floor)", !hasClauseMatching(r.trash, /crypto/i));
}

console.log("\nS4 — floor differs from blanket by exactly the shadow clauses (byte-level diff)");
{
  const blanket = buildFilters([], [], mergeImportedConfig({}), [], "de", tFn);
  const floor = buildFilters([], [], mergeImportedConfig({ protectShadows: false, protectShadowPurifyOnly: true }), [], "de", tFn);
  const onlyInBlanket = clauses(blanket.trash).filter(c => !clauses(floor.trash).includes(c));
  const onlyInFloor = clauses(floor.trash).filter(c => !clauses(blanket.trash).includes(c));
  check("blanket drops exactly the bare !crypto", onlyInBlanket.length === 1 && /^!crypto$/i.test(onlyInBlanket[0]), onlyInBlanket.join("|"));
  check("floor adds the three purify clauses plus one per uncovered keeper",
    onlyInFloor.length === 3 + FLOOR_KEEPER_COUNT, `${onlyInFloor.length} added`);
}

// The bug this pins: with blanket crypto protection off, the keeper floor used
// the positive `!crypto,+a,+b,…` shape. Comma is OR, so it read "releasable if
// NOT crypto, OR you ARE one of these keepers" — the exact inverse of the
// intent. Every non-keeper shadow failed it and was protected (the user saw NO
// crypto in the trash after switching blanket protection off), and every keeper
// satisfied it and was released. De Morgan: a negated union is an AND of
// negations, which in this grammar means separate clauses.
console.log("\nS5 — keeper floor semantics: junk shadows releasable, keepers protected");
{
  const cfg = mergeImportedConfig({});
  cfg.protectShadows = false; // what unchecking the expert toggle actually does
  check("unchecking the toggle in-session leaves the floor ON",
    cfg.protectShadowPurifyOnly === true, "the migration pin is load-time only");
  const floor = buildFilters([], [], cfg, [], "de", tFn);
  const keeperFloor = clauses(floor.trash).filter(c => /^!crypto,!\+/i.test(c)).join("&");

  const base = {
    types: ["normal"], year: 2024, ageDays: 5, distance: 0, wp: 300,
    flags: { traded:false, shadow:true, lucky:false, favorite:false, shiny:false, legendary:false,
             mythical:false, ultrabeast:false, costume:false, purified:false, background:false,
             dynamaxCapable:false, doubleMoved:false, xxl:false, xl:false, xxs:false, tagged:false,
             legacyMove:false, newDexEvo:false, eggOnly:false, buddy:false, megaEvolved:false },
  };
  const mk = (families, o = {}) => ({ ...base, families, dex: 1, atk: 1, def: 1, hp: 1, star: 1, ...o,
    flags: { ...base.flags, ...(o.flags || {}) } });
  // Species names are DERIVED, never typed — same rule as the emitters.
  const metagross = resolveSpecies("metagross", "de");
  const beldum = resolveSpecies("beldum", "de");
  const rattata = resolveSpecies("rattata", "de");

  check("a junk shadow clears the keeper floor (releasable)",
    evalFilter(keeperFloor, mk([rattata]), "de") === true);
  check("a keeper shadow is held back by it",
    evalFilter(keeperFloor, mk([metagross]), "de") === false);
  check("the keeper's pre-evo is held back too (+family search)",
    evalFilter(keeperFloor, mk([beldum, metagross]), "de") === false);
  check("a NON-shadow keeper is untouched by the floor",
    evalFilter(keeperFloor, mk([metagross], { flags: { shadow: false } }), "de") === true);
}

// The floor's per-keeper clauses cost ~20 characters each, and the trash filter
// already carries `!legendär` / `!mysteriös` / `!ultrabestie`. A keeper those
// clauses cover needs no clause of its own — but only while the matching toggle
// is on, and only for keepers whose whole evolution family shares the class
// (`!+latios` protects the family; the blanket clause has to cover all of it).
// The class map is derived by the meta-rankings sync from the game master's own
// pokemonClass; these checks read it rather than naming species.
console.log("\nS6 — blanket-covered keepers are dropped from the floor, conditionally");
{
  const CLASSES = META_RANKINGS.shadowKeeperClasses || {};
  const byClass = (bucket) => Object.entries(CLASSES)
    .filter(([, b]) => b === bucket).map(([sp]) => resolveSpecies(sp, "de"));
  const floorKeepers = (r) => clauses(r.trash)
    .filter(c => /^!crypto,!\+/i.test(c)).map(c => c.split(",")[1].slice(2));
  const withCfg = (o) => {
    const cfg = mergeImportedConfig({});
    Object.assign(cfg, o);
    return buildFilters([], [], cfg, [], "de", tFn);
  };

  const all = mergeImportedConfig({}).shadowKeeperSpecies;
  const covered = all.filter(sp => CLASSES[sp] || CLASSES[resolveSpecies(sp, "en")]);
  check(`the sync classes some keepers (${Object.keys(CLASSES).length} of ${all.length})`,
    Object.keys(CLASSES).length > 0 && Object.keys(CLASSES).length < all.length);

  const dflt = withCfg({ protectShadows: false });
  check("default flags: every classed keeper is dropped from the floor",
    floorKeepers(dflt).length === all.length - covered.length,
    `${floorKeepers(dflt).length} clauses, ${covered.length} covered`);
  check("the floor is shorter than it would be untrimmed",
    dflt.trash.length < withCfg({ protectShadows: false, protectLegendaries: false,
      protectMythicals: false, protectUltraBeasts: false }).trash.length);

  // Each class comes back the moment its own blanket clause goes away — and
  // only its own: turning legendaries off must not restore the mythicals.
  for (const [bucket, flag] of [["legendary", "protectLegendaries"],
                                ["mythical", "protectMythicals"],
                                ["ultraBeast", "protectUltraBeasts"]]) {
    const members = byClass(bucket);
    if (members.length === 0) { console.log(`  · no ${bucket} keeper in this snapshot — skipped`); continue; }
    const on = floorKeepers(dflt);
    const off = floorKeepers(withCfg({ protectShadows: false, [flag]: false }));
    check(`${bucket}: absent while ${flag} is on`, members.every(sp => !on.includes(sp)));
    check(`${bucket}: restored when ${flag} is off`, members.every(sp => off.includes(sp)));
    const others = Object.entries(CLASSES).filter(([, b]) => b !== bucket)
      .map(([sp]) => resolveSpecies(sp, "de"));
    check(`${bucket}: the other classes stay dropped`, others.every(sp => !off.includes(sp)));
  }

  // A mythical carved out of `!mysteriös` has spent that protection, so its
  // floor clause is load-bearing again.
  const myths = byClass("mythical");
  if (myths.length > 0) {
    const carved = floorKeepers(withCfg({ protectShadows: false, mythTooManyOf: [myths[0]] }));
    check(`mythTooManyOf restores the carved-out keeper's clause (${myths[0]})`,
      carved.includes(myths[0]));
    check("the other mythicals stay dropped",
      myths.slice(1).every(sp => !carved.includes(sp)));
  }

  // A classless keeper keeps its clause no matter what — nothing covers it.
  const classed = new Set(Object.keys(CLASSES).map(sp => resolveSpecies(sp, "de")));
  const classless = all.map(sp => resolveSpecies(sp, "de")).filter(sp => !classed.has(sp));
  check(`classless keepers keep their clause (${classless.length})`,
    classless.length > 0 && classless.every(sp => floorKeepers(dflt).includes(sp)));

  // The trim is trash-only. shadowSafe carries no blanket clause to inherit
  // from, so it must still name every keeper — the dropped ones included.
  const safeTerms = clauses(dflt.shadowSafe).filter(c => /^!\+/.test(c)).map(c => c.slice(2));
  check("shadowSafe still names the full roster",
    all.every(sp => safeTerms.includes(resolveSpecies(sp, "de"))),
    `${safeTerms.length} of ${all.length}`);
}

console.log(`\n${failures === 0 ? "✓ All carve-out checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
