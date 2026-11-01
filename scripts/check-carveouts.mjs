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
//   S1–S6 — the shadow gradient: with protectShadows off, five independent
//         expert toggles (3★+, attack 11+, cheap purify, Charge-TM'd, keeper
//         families) each add their own scoped `!crypto,X` clause; every
//         combination, the import migration off the retired purify floor,
//         evalFilter semantics in all seven locales, and the blanket-cover trim
//         of the keeper clauses.

import {
  buildFilters, evalFilter, evalFilterDetailed, mergeImportedConfig, DEFAULT_CONFIG, SETTINGS_GROUPS, teDisplay,
  regionalProtectionsFor, ivToBar, starFromIVs, protectionTail, SMEARGLE_FAST_MOVE,
  SHADOW_GRADIENT_KEYS,
} from "../src/App.jsx";
import { pokemonNameFor, resolveSpecies } from "../src/data/species.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import META_RANKINGS from "../src/data/meta-rankings.json";
import { LOCALES } from "../src/i18n/index.js";
import { moveKeyFromKeyword, moveKeywordFor, pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { makeTFn } from "./lib/fixture.mjs";
import { pileMon, smeargleMovesetClauses, tailOptions } from "./lib/pile-cases.mjs";

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
  const basar = DEFAULT_CONFIG.basarTagName;
  check(`basar tag (#${basar}) also protected in trade (parity sanity)`, hasClauseMatching(r.trade, new RegExp(`^!#${basar}$`)));
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
    tagClause.split(",").includes(`#${DEFAULT_CONFIG.basarTagName}`) && tagClause.includes("#Fern-Tausch"));
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

console.log("\nSmeargle moveset protection (docs/smeargle-pvp-movesets.md)");
{
  // The seed and its storage form: canonical lowercase EN move names, the
  // fast move fixed and never in the charged list.
  check("the seed is Flying Press and Techno Blast, as canonical EN names",
    JSON.stringify(DEFAULT_CONFIG.smeargleChargedMoves) === JSON.stringify(["flying press", "techno blast"]) && SMEARGLE_FAST_MOVE === "lock-on");
  check("the toggle ships on", DEFAULT_CONFIG.protectSmeargleMovesets === true);
  for (const loc of Object.keys(LOCALES)) {
    for (const key of ["lock-on", "flying press", "techno blast"]) {
      const spelled = LOCALES[loc].messages[`move.${key}`];
      check(`${loc}: "${spelled}" resolves to ${key}`, !!spelled && moveKeyFromKeyword(spelled) === key && moveKeyFromKeyword(spelled.toUpperCase()) === key);
    }
  }
  check("a hyphen-less or capitalised EN spelling resolves too", moveKeyFromKeyword("Lock On") === "lock-on" && moveKeyFromKeyword("FLYING PRESS") === "flying press");
  check("a non-move resolves to null", moveKeyFromKeyword("nonsense") === null && moveKeyFromKeyword("") === null);
  const imported = mergeImportedConfig({ smeargleChargedMoves: ["Techblaster", "Flying Press", "Zielschuss", "flying press"] });
  check("an imported list is canonicalised, deduplicated and loses the fast move",
    JSON.stringify(imported.smeargleChargedMoves) === JSON.stringify(["techno blast", "flying press"]), imported.smeargleChargedMoves.join(", "));
  check("a config without the field gets the seed and the toggle",
    JSON.stringify(mergeImportedConfig({}).smeargleChargedMoves) === JSON.stringify(DEFAULT_CONFIG.smeargleChargedMoves) && mergeImportedConfig({}).protectSmeargleMovesets === true);

  // Clause shape per locale: one clause per charged move, right after the
  // legacy clause, Smeargle via pokemonNameFor('235'), moves in the output
  // locale lowercased with whitespace collapsed and hyphens kept, no slot
  // prefix; the same clauses in trash, trade and buddy-catch, in the tail and
  // the finder.
  for (const loc of Object.keys(LOCALES)) {
    const cfg = mergeImportedConfig({ buddies: [BUDDY] });
    const r = buildFilters([], [], cfg, [], loc, makeTFn(loc));
    const smeargle = pokemonNameFor("235", loc).toLowerCase();
    const lockOn = moveKeywordFor("lock-on", loc);
    const expected = cfg.smeargleChargedMoves.map((m) => `!${smeargle},!@${lockOn},!@${moveKeywordFor(m, loc)}`);
    const movesetOf = (f) => clauses(f).filter((c) => c.startsWith(`!${smeargle},!@`));
    const kw = pogoKeywords(loc);
    const trashMoveset = movesetOf(r.trash);
    check(`${loc}: trash carries ${expected.join(" ")}`, JSON.stringify(trashMoveset) === JSON.stringify(expected), trashMoveset.join(" "));
    check(`${loc}: no clause carries a space or a slot prefix`, expected.every((c) => !/\s/.test(c) && !/@\d/.test(c)));
    const trashAll = clauses(r.trash);
    const legacyAt = trashAll.findIndex((c) => c.startsWith(`!@${kw.flag.special_move}`));
    check(`${loc}: the clauses follow the legacy clause`, legacyAt >= 0 && JSON.stringify(trashAll.slice(legacyAt + 1, legacyAt + 3)) === JSON.stringify(expected));
    check(`${loc}: trade == trash == buddy-catch`,
      JSON.stringify(movesetOf(r.trade)) === JSON.stringify(expected) && JSON.stringify(movesetOf(r.buddyCatchFilters[0]?.filter || "")) === JSON.stringify(expected));
    check(`${loc}: the why names the set`, r.trashClauses.filter((c) => expected.includes(c.clause)).every((c) => c.why && !c.why.includes("app.clause_why")));
    // The tail: the same clauses, as a value, in every sorting pile's ③b.
    const tail = protectionTail(kw, cfg, tailOptions(cfg, loc));
    check(`${loc}: the protection tail carries the clauses, and pile-cases mirrors buildFilters`,
      JSON.stringify(smeargleMovesetClauses(cfg, loc)) === JSON.stringify(expected) && expected.every((c) => tail.includes(c))
      && r.sortingPiles.filter((p) => p.release).every((p) => expected.every((c) => p.release.includes(c))));
    // The finder: Smeargle & Lock-On & (c1 | c2).
    const chargers = cfg.smeargleChargedMoves.map((m) => moveKeywordFor(m, loc));
    check(`${loc}: finder is ${smeargle}&@${lockOn}&${chargers.map((c) => `@${c}`).join(",")}`,
      r.smeargleFinder.clause === `${smeargle}&@${lockOn}&${chargers.map((c) => `@${c}`).join(",")}` && r.smeargleFinder.moveCount === 2);
    // The evaluator agrees: a Smeargle with Lock-On and a listed charged move
    // is held by trash and found by the finder; one with Lock-On and another
    // charged move, or without Lock-On, is trashable and not found.
    const mon = (moves) => pileMon(loc, { dex: 235, species: smeargle, moves, flags: { legacyMove: true } }, "Smeargle", 235);
    const kept = mon([lockOn, chargers[1]]);
    const other = mon([lockOn, kw.flag.return]);
    const noLockOn = mon([kw.flag.frustration, chargers[0]]);
    const v = (str, m) => evalFilterDetailed(str, m, loc).verdict;
    check(`${loc}: trash holds the moveset Smeargle and offers the other two`,
      v(r.trash, kept) === false && v(r.trash, other) === true && v(r.trash, noLockOn) === true);
    check(`${loc}: the finder finds only the moveset Smeargle`,
      v(r.smeargleFinder.clause, kept) === true && v(r.smeargleFinder.clause, other) === false && v(r.smeargleFinder.clause, noLockOn) === false);
  }
  // The toggle gates the three filters, not the tail; an empty list emits
  // nothing anywhere, which keeps the default byte-identical for a user who
  // clears it.
  const off = buildFilters([], [], mergeImportedConfig({ protectSmeargleMovesets: false, buddies: [BUDDY] }), [], "en", makeTFn("en"));
  const on = buildFilters([], [], mergeImportedConfig({ buddies: [BUDDY] }), [], "en", makeTFn("en"));
  const movesetOfEn = (f) => clauses(f).filter((c) => c.startsWith("!smeargle,!@"));
  check("protectSmeargleMovesets off: trash, trade and buddy-catch drop the clauses and nothing else moves",
    movesetOfEn(off.trash).length === 0 && movesetOfEn(off.trade).length === 0 && movesetOfEn(off.buddyCatchFilters[0].filter).length === 0
    && clauses(off.trash).join("&") === clauses(on.trash).filter((c) => !c.startsWith("!smeargle,!@")).join("&")
    && clauses(off.trade).join("&") === clauses(on.trade).filter((c) => !c.startsWith("!smeargle,!@")).join("&"));
  check("protectSmeargleMovesets off: the sorting piles' ③ still holds the moveset Smeargle",
    off.sortingPiles.filter((p) => p.release).every((p) => movesetOfEn(p.release).length === 2));
  const empty = buildFilters([], [], mergeImportedConfig({ smeargleChargedMoves: [], buddies: [BUDDY] }), [], "en", makeTFn("en"));
  check("an empty list emits nothing: trash, trade, buddy-catch, piles and finder",
    movesetOfEn(empty.trash).length === 0 && movesetOfEn(empty.trade).length === 0 && movesetOfEn(empty.buddyCatchFilters[0].filter).length === 0
    && empty.sortingPiles.every((p) => !p.release || movesetOfEn(p.release).length === 0) && empty.smeargleFinder.clause === "" && empty.smeargleFinder.moveCount === 0);
  const one = buildFilters([], [], mergeImportedConfig({ smeargleChargedMoves: ["flying press"] }), [], "en", makeTFn("en"));
  check("one charged move: one clause, finder without a comma", movesetOfEn(one.trash).length === 1 && one.smeargleFinder.clause === "smeargle&@lock-on&@flyingpress");
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

  // No-spare case: a buddy wanting only a non-hundo species gets the plain,
  // UN-WIDENED 0*,1*,2* clause — that line is the carve-out's only signal. The
  // `!4*` guard rides along either way; it is redundant here (0-2★ cannot be a
  // 4★) but a give-away filter should not look unguarded because of a have-list
  // annotation somewhere else.
  const r2 = buildFilters([], [], mergeImportedConfig({ buddies: [{ id: "k", name: "Kai", tagPrefix: "#kai", active: true, targetSpecies: ["dratini"] }] }), [], "de", tFn);
  const fk = r2.buddyCatchFilters.find(b => b.buddyName === "Kai").filter;
  check("no-hundo buddy: plain 0*,1*,2* clause, not widened",
    clauses(fk).includes("0*,1*,2*") && !clauses(fk).some(c => c.startsWith("0*,1*,2*,")));
  check("no-hundo buddy: '!4*' guard still present", clauses(fk).includes("!4*"));
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

// ── The shadow gradient ──────────────────────────────────────────────────────
// With protectShadows off, five independent expert toggles decide what still
// stays out of the trash: keep 3★ and better, keep attack 11+, keep cheap
// purifies, keep Charge-TM'd, keep keeper families. Each is its own scoped
// `!crypto,X` clause (or clause set); any combination is valid; all five off
// leaves no shadow clause at all. The game ignores `!N` on IV and star tokens,
// so X is always the positive contrapositive (`0*,1*,2*`, `0-2angriff`).

// How many `!crypto,!+species` clauses the keeper rule emits under DEFAULT
// protection flags: one per keeper, minus the ones `!legendär` / `!mysteriös` /
// `!ultrabestie` already cover. Derived from the same sync-emitted class map the
// emitter reads, so the number moves with the roster instead of being pinned.
// S6 below is what actually exercises the trim.
const KEEPER_CLASSES = META_RANKINGS.shadowKeeperClasses || {};
const FLOOR_KEEPER_COUNT = mergeImportedConfig({}).shadowKeeperSpecies
  .filter(sp => !KEEPER_CLASSES[sp] && !KEEPER_CLASSES[resolveSpecies(sp, "en")]).length;

// Every output locale the app ships, from the i18n index rather than a typed list.
const OUTPUT_LOCALES = Object.keys(LOCALES);
const GRADIENT = [
  // [configKey, clause the toggle adds in a locale (null = the keeper set)]
  ["protectShadowThreeStar",   (kw) => `!${kw.flag.shadow},0*,1*,2*`],
  ["protectShadowAttack",      (kw) => `!${kw.flag.shadow},0-2${kw.iv.atk}`],
  ["protectShadowCheapPurify", (kw) => `!${kw.flag.shadow},${kw.numeric.candy_km}3-`],
  ["protectShadowChargeTm",    (kw) => `!${kw.flag.shadow},@${kw.flag.frustration}`],
  ["protectShadowKeepers",     null],
];
const GRADIENT_KEYS = GRADIENT.map(([k]) => k);
const isKeeperClause = (c, kw) => new RegExp(`^!${escapeRe(kw.flag.shadow)},!\\+[^,&]+$`, "i").test(c);
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// Every clause scoped to shadows: `!crypto,…` (never the bare `!crypto`).
const shadowClauses = (filterStr, kw) =>
  clauses(filterStr).filter(c => new RegExp(`^!${escapeRe(kw.flag.shadow)},`, "i").test(c));
const buildWith = (o, loc = "de") => {
  const cfg = mergeImportedConfig({});
  Object.assign(cfg, o);
  return buildFilters([], [], cfg, [], loc, tFn);
};
const offExcept = (on) => Object.fromEntries(GRADIENT_KEYS.map(k => [k, on.includes(k)]));

check("SHADOW_GRADIENT_KEYS names the five toggles in row order",
  JSON.stringify(SHADOW_GRADIENT_KEYS) === JSON.stringify(GRADIENT_KEYS), SHADOW_GRADIENT_KEYS.join(","));

console.log("\nS1 — default keeps the blanket !crypto; the gradient stays dormant");
{
  const def = buildFilters([], [], mergeImportedConfig({}), [], "de", tFn);
  check("default trash has blanket !crypto", hasClauseMatching(def.trash, /^!crypto$/i));
  check("default trash has NO scoped shadow clause", !hasClauseMatching(def.trash, /^!crypto,/i));
  check("all five gradient toggles default to on", GRADIENT_KEYS.every(k => DEFAULT_CONFIG[k] === true));
  check("trade always excludes shadows, independent of the gradient", hasClauseMatching(def.trade, /^!crypto$/i));
}

console.log("\nS2 — protectShadows off, all five on: four scoped clauses plus one per keeper");
{
  const g = buildWith({ protectShadows: false });
  check("no blanket !crypto anymore", !hasClauseMatching(g.trash, /^!crypto$/i));
  check("keeps 3★ and better (!crypto,0*,1*,2*)", clauses(g.trash).filter(c => /^!crypto,0\*,1\*,2\*$/i.test(c)).length === 1, g.trash);
  // Keyword tokens come from the dictionary, never typed: the German attack
  // token is not what one would guess.
  const kw = pogoKeywords("de");
  check(`keeps attack 11+ (!crypto,0-2${kw.iv.atk})`, clauses(g.trash).filter(c => c === `!crypto,0-2${kw.iv.atk}`).length === 1, g.trash);
  check("the old no-weak-stat clause is gone (attack 11+ subsumes it)",
    !shadowClauses(g.trash, kw).some(c => new RegExp(`0-2${escapeRe(kw.iv.def)}|0-2${escapeRe(kw.iv.hp)}`, "i").test(c)));
  check("keeps cheap-to-purify (!crypto,bonbonkm3-)", clauses(g.trash).filter(c => /^!crypto,bonbonkm3-$/i.test(c)).length === 1);
  check("keeps Charge-TM'd (!crypto,@frustration)", clauses(g.trash).filter(c => /^!crypto,@frustration$/i.test(c)).length === 1);
  // ONE CLAUSE PER KEEPER, `!crypto,!+name`. The compact `!crypto,+a,+b,…` it
  // replaced was inverted: comma is OR, so it was satisfied by a shadow that
  // IS a keeper and false for every shadow that is not — it protected the junk
  // and released the keepers. S5 pins the semantics; this only pins the shape.
  check("keeps keeper families (!crypto,!+name per uncovered keeper)",
    clauses(g.trash).filter(c => /^!crypto,!\+[^,&]+$/i.test(c)).length === FLOOR_KEEPER_COUNT);
  check("no positive-species keeper clause survives (the inverted shape)", !hasClauseMatching(g.trash, /^!crypto,\+/i));
  check("exactly four non-keeper scoped clauses",
    clauses(g.trash).filter(c => /^!crypto,/i.test(c) && !/^!crypto,!\+/i.test(c)).length === 4);
  check("trade still hard-excludes shadows", hasClauseMatching(g.trade, /^!crypto$/i));
}

console.log("\nS2b — the keeper rule names the actual keeper roster");
{
  const g = buildWith({ protectShadows: false });
  const terms = clauses(g.trash).filter(c => /^!crypto,!\+/i.test(c)).map(c => c.split(",")[1].slice(1));
  check(`one clause per keeper not already blanket-covered (${FLOOR_KEEPER_COUNT})`,
    terms.length === FLOOR_KEEPER_COUNT, `found ${terms.length}`);
  check("every term is a negated family search", terms.every(t => t.startsWith("+") && t.length > 1));
  // The species name is DERIVED, not typed — see the note in the S5 helper.
  const metagross = resolveSpecies("metagross", "de");
  check(`Shadow Metagross is protected by name (+${metagross})`, terms.includes(`+${metagross}`));
  // An empty roster must collapse the clause entirely rather than emit
  // `!crypto,` — a dangling separator the game cannot parse.
  const empty = buildWith({ protectShadows: false, shadowKeeperSpecies: [] });
  check("empty keeper roster emits no keeper clause",
    !hasClauseMatching(empty.trash, /^!crypto,!?\+/i) && !/[&,]$|,,/.test(empty.trash));
  check("keeper toggle off emits no keeper clause even with a roster",
    !hasClauseMatching(buildWith({ protectShadows: false, protectShadowKeepers: false }).trash, /^!crypto,!?\+/i));
}

console.log("\nS3 — migration: the retired purify floor maps onto the five toggles");
{
  const legacy = mergeImportedConfig({ protectShadows: false });
  check("legacy protectShadows:false (pre-floor) pins all five off",
    GRADIENT_KEYS.every(k => legacy[k] === false), GRADIENT_KEYS.map(k => `${k}=${legacy[k]}`).join(" "));
  check("retired key is dropped", !("protectShadowPurifyOnly" in legacy));
  check("no shadow clause at all (neither blanket nor gradient)", !hasClauseMatching(buildFilters([], [], legacy, [], "de", tFn).trash, /crypto/i));
  const floorOff = mergeImportedConfig({ protectShadows: false, protectShadowPurifyOnly: false });
  check("saved purify floor off pins all five off", GRADIENT_KEYS.every(k => floorOff[k] === false));
  check("retired key is dropped", !("protectShadowPurifyOnly" in floorOff));
  const floorOn = mergeImportedConfig({ protectShadows: false, protectShadowPurifyOnly: true });
  check("saved purify floor on back-fills all five on", GRADIENT_KEYS.every(k => floorOn[k] === true));
  check("retired key is dropped", !("protectShadowPurifyOnly" in floorOn));
  const partial = mergeImportedConfig({ protectShadows: false, protectShadowAttack: true });
  check("a config already carrying a gradient key is never pinned",
    partial.protectShadowAttack === true && partial.protectShadowThreeStar === true);
  const explicit = mergeImportedConfig({ protectShadows: false, protectShadowPurifyOnly: false, protectShadowKeepers: true });
  check("an explicit gradient value beats the retired key", explicit.protectShadowKeepers === true && explicit.protectShadowThreeStar === true);
  const inSession = mergeImportedConfig({});
  inSession.protectShadows = false; // what unchecking the toggle actually does
  check("unchecking protectShadows in-session leaves all five on (the pin is load-time only)",
    GRADIENT_KEYS.every(k => inSession[k] === true));
}

console.log("\nS4 — every combination adds exactly its toggles' clauses (byte-level diff, de)");
{
  const kw = pogoKeywords("de");
  const blanket = buildFilters([], [], mergeImportedConfig({}), [], "de", tFn);
  const expectedFor = (on) => {
    const out = [];
    for (const [k, clause] of GRADIENT) {
      if (!on.includes(k)) continue;
      if (clause) out.push(clause(kw));
      else out.push(...clauses(buildWith({ protectShadows: false, ...offExcept([k]) }).trash).filter(c => isKeeperClause(c, kw)));
    }
    return out.sort();
  };
  let bad = [];
  for (let mask = 0; mask < 32; mask++) {
    const on = GRADIENT_KEYS.filter((_, i) => mask & (1 << i));
    const g = buildWith({ protectShadows: false, ...offExcept(on) });
    const onlyInBlanket = clauses(blanket.trash).filter(c => !clauses(g.trash).includes(c));
    const onlyInGradient = clauses(g.trash).filter(c => !clauses(blanket.trash).includes(c)).sort();
    if (!(onlyInBlanket.length === 1 && /^!crypto$/i.test(onlyInBlanket[0]))) bad.push(`${mask}: blanket diff ${onlyInBlanket.join("|")}`);
    if (JSON.stringify(onlyInGradient) !== JSON.stringify(expectedFor(on))) bad.push(`${mask}: ${onlyInGradient.length} vs ${expectedFor(on).length}`);
    if (onlyInGradient.some(c => !isKeeperClause(c, kw)) && onlyInGradient.filter(c => !isKeeperClause(c, kw)).length !== on.filter(k => k !== "protectShadowKeepers").length)
      bad.push(`${mask}: non-keeper count`);
  }
  check("all 32 combinations: blanket drops exactly the bare !crypto, gradient adds exactly its clauses", bad.length === 0, bad.slice(0, 4).join("; "));
  const allOn = clauses(buildWith({ protectShadows: false }).trash).filter(c => /^!crypto,/i.test(c));
  check("all five on: four clauses plus one per uncovered keeper", allOn.length === 4 + FLOOR_KEEPER_COUNT, `${allOn.length}`);
  check("all five off: no crypto clause at all", !hasClauseMatching(buildWith({ protectShadows: false, ...offExcept([]) }).trash, /crypto/i));
  for (const [k, clause] of GRADIENT) {
    const alone = clauses(buildWith({ protectShadows: false, ...offExcept([k]) }).trash).filter(c => /^!crypto,/i.test(c));
    check(`${k} alone adds ${clause ? "exactly its clause" : "exactly the keeper clauses"}`,
      clause ? alone.length === 1 && alone[0] === clause(kw) : alone.length === FLOOR_KEEPER_COUNT && alone.every(c => isKeeperClause(c, kw)),
      alone.slice(0, 3).join("|"));
  }
}

// Semantics via evalFilter, in every output locale, over the scoped shadow
// clauses the default config emits once protectShadows is off. Only those
// clauses: the rest of the trash filter (tags, favourites, legendaries …) is
// not what the gradient decides. `true` = releasable, `false` = kept.
console.log("\nS5 — gradient semantics in all seven locales: what each rule keeps and releases");
{
  const base = {
    types: ["normal"], year: 2024, ageDays: 5, distance: 0, wp: 300,
    flags: { traded:false, shadow:true, lucky:false, favorite:false, shiny:false, legendary:false,
             mythical:false, ultrabeast:false, costume:false, purified:false, background:false,
             dynamaxCapable:false, doubleMoved:false, xxl:false, xl:false, xxs:false, tagged:false,
             legacyMove:false, newDexEvo:false, eggOnly:false, buddy:false, megaEvolved:false },
  };
  // A shadow by raw IVs: buckets and stars derive from the app's own helpers.
  const mk = (loc, [a, d, h], o = {}) => ({
    ...base, families: [resolveSpecies("rattata", loc)], dex: 19,
    atk: ivToBar(a), def: ivToBar(d), hp: ivToBar(h), star: starFromIVs(a, d, h),
    candyKm: 3, moves: [pogoKeywords(loc).flag.frustration], ...o,
    flags: { ...base.flags, ...(o.flags || {}) },
  });
  let bad = [];
  const expect = (loc, label, on, mon, releasable) => {
    const kw = pogoKeywords(loc);
    const scoped = shadowClauses(buildWith({ protectShadows: false, ...offExcept(on) }, loc).trash, kw).join("&");
    const v = on.length === 0 ? true : evalFilter(scoped, mon, loc);
    if (v !== releasable) bad.push(`${loc} ${label}: got ${v} [${scoped.slice(0, 60)}]`);
  };
  for (const loc of OUTPUT_LOCALES) {
    const junk = mk(loc, [3, 3, 3]);                 // 0★, attack 1, 3km candy, still Frustration, not a keeper
    const atk15 = mk(loc, [15, 6, 6]);               // 1★ but attack 15
    const atk10 = mk(loc, [10, 15, 15]);             // 3★ but attack 10
    const cheap = mk(loc, [3, 3, 3], { candyKm: 1 });
    const tmd = mk(loc, [3, 3, 3], { moves: [pogoKeywords(loc).flag.return] });
    const metagross = mk(loc, [3, 3, 3], { families: [resolveSpecies("beldum", loc), resolveSpecies("metagross", loc)], dex: 376 });
    const all = GRADIENT_KEYS;
    expect(loc, "junk shadow is releasable under all five", all, junk, true);
    expect(loc, "attack rule keeps a 15/6/6 shadow", ["protectShadowAttack"], atk15, false);
    expect(loc, "3★ rule alone releases a 15/6/6 shadow (1★)", ["protectShadowThreeStar"], atk15, true);
    expect(loc, "attack rule alone releases a 10/15/15 shadow", ["protectShadowAttack"], atk10, true);
    expect(loc, "3★ rule keeps a 10/15/15 shadow (3★)", ["protectShadowThreeStar"], atk10, false);
    expect(loc, "attack + 3★ keep a 10/15/15 shadow", ["protectShadowAttack", "protectShadowThreeStar"], atk10, false);
    expect(loc, "cheap-purify rule keeps a 1km-candy shadow", ["protectShadowCheapPurify"], cheap, false);
    expect(loc, "cheap-purify rule releases a 3km-candy shadow", ["protectShadowCheapPurify"], junk, true);
    expect(loc, "Charge-TM rule keeps a shadow without Frustration", ["protectShadowChargeTm"], tmd, false);
    expect(loc, "Charge-TM rule releases a shadow still on Frustration", ["protectShadowChargeTm"], junk, true);
    expect(loc, "keeper rule keeps a junk Metagross (via +family, pre-evo included)", ["protectShadowKeepers"], metagross, false);
    expect(loc, "keeper rule releases a junk non-keeper", ["protectShadowKeepers"], junk, true);
    expect(loc, "a non-shadow is untouched by every rule", all, mk(loc, [3, 3, 3], { flags: { shadow: false } }), true);
    expect(loc, "all five off: everything releasable", [], junk, true);
    // Each rule holds on its own under the full default gradient too.
    expect(loc, "all five on: keeps the 15/6/6 shadow", all, atk15, false);
    expect(loc, "all five on: keeps the Charge-TM'd shadow", all, tmd, false);
    expect(loc, "all five on: keeps the junk Metagross", all, metagross, false);
    // Every scoped clause parsed: evalFilter's false is a definite keep, so
    // check that the junk verdict was not an indeterminate collapse.
    const kw = pogoKeywords(loc);
    const scoped = shadowClauses(buildWith({ protectShadows: false }, loc).trash, kw);
    if (scoped.length !== 4 + FLOOR_KEEPER_COUNT) bad.push(`${loc}: ${scoped.length} scoped clauses`);
    const det = evalFilterDetailed(scoped.join("&"), junk, loc);
    if (det.verdict !== true || det.unknown.length) bad.push(`${loc}: unparsed ${det.unknown.join("|")}`);
  }
  check(`${OUTPUT_LOCALES.length} locales × 17 expectations, every scoped clause parsed`, bad.length === 0, bad.slice(0, 5).join("; "));
}

// The keeper rule's clauses cost ~20 characters each, and the trash filter
// already carries `!legendär` / `!mysteriös` / `!ultrabestie`. A keeper those
// clauses cover needs no clause of its own — but only while the matching toggle
// is on, and only for keepers whose whole evolution family shares the class
// (`!+latios` protects the family; the blanket clause has to cover all of it).
// The class map is derived by the meta-rankings sync from the game master's own
// pokemonClass; these checks read it rather than naming species.
console.log("\nS6 — blanket-covered keepers are dropped from the keeper rule, conditionally");
{
  const CLASSES = META_RANKINGS.shadowKeeperClasses || {};
  const byClass = (bucket) => Object.entries(CLASSES)
    .filter(([, b]) => b === bucket).map(([sp]) => resolveSpecies(sp, "de"));
  const floorKeepers = (r) => clauses(r.trash)
    .filter(c => /^!crypto,!\+/i.test(c)).map(c => c.split(",")[1].slice(2));
  const withCfg = (o) => buildWith(o);

  const all = mergeImportedConfig({}).shadowKeeperSpecies;
  const covered = all.filter(sp => CLASSES[sp] || CLASSES[resolveSpecies(sp, "en")]);
  check(`the sync classes some keepers (${Object.keys(CLASSES).length} of ${all.length})`,
    Object.keys(CLASSES).length > 0 && Object.keys(CLASSES).length < all.length);

  const dflt = withCfg({ protectShadows: false });
  check("default flags: every classed keeper is dropped from the keeper rule",
    floorKeepers(dflt).length === all.length - covered.length,
    `${floorKeepers(dflt).length} clauses, ${covered.length} covered`);
  check("the keeper rule is shorter than it would be untrimmed",
    dflt.trash.length < withCfg({ protectShadows: false, protectLegendaries: false,
      protectMythicals: false, protectUltraBeasts: false }).trash.length);

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

  const myths = byClass("mythical");
  if (myths.length > 0) {
    const carved = floorKeepers(withCfg({ protectShadows: false, mythTooManyOf: [myths[0]] }));
    check(`mythTooManyOf restores the carved-out keeper's clause (${myths[0]})`, carved.includes(myths[0]));
    check("the other mythicals stay dropped", myths.slice(1).every(sp => !carved.includes(sp)));
  }

  const classed = new Set(Object.keys(CLASSES).map(sp => resolveSpecies(sp, "de")));
  const classless = all.map(sp => resolveSpecies(sp, "de")).filter(sp => !classed.has(sp));
  check(`classless keepers keep their clause (${classless.length})`,
    classless.length > 0 && classless.every(sp => floorKeepers(dflt).includes(sp)));

  // The trim is trash-only. shadowSafe carries no blanket clause to inherit
  // from, so it must still name every keeper — the dropped ones included.
  const safeTerms = clauses(dflt.shadowSafe).filter(c => /^!\+/.test(c)).map(c => c.slice(2));
  check("shadowSafe still names the full roster",
    all.every(sp => safeTerms.includes(resolveSpecies(sp, "de"))), `${safeTerms.length} of ${all.length}`);
}

console.log("\nI1 — Irrbis sizes toggle: trash, trade and buddy size guards carve Irrbis out, the trade-evo guard only in trash");
{
  // Irrbis (710) is always XXL (Super) or always XXS (Small), so `!xxl` and
  // `!xxs` protect nothing for it; with the toggle on they read `!xxl,irrbis`
  // (comma is OR: keep unless Irrbis), and the family's `!+Irrbis,traded`
  // guard gets the same carve or every untraded Irrbis would stay protected.
  // The name comes from pokemonNameFor in the output locale, never typed.
  const IRRBIS = "710", PIKACHU = "25";
  // One buddy who wants trade evos, Irrbis among them, so the buddy catch
  // filter exists and selects the family. The toggle is the only difference.
  const julia = { id: "j", name: "Julia", tagPrefix: "Julia", active: true, rawAppend: "", wantsTradeEvos: true, targetSpecies: [] };
  const off = mergeImportedConfig({ enabledTradeEvos: ["irrbis"], buddies: [julia] });
  const on = mergeImportedConfig({ enabledTradeEvos: ["irrbis"], buddies: [julia], irrbisSizes: true });
  check("the toggle is expert-only, default off, in the size group",
    DEFAULT_CONFIG.irrbisSizes === false && SETTINGS_GROUPS.find((g) => g.id === "size").rows.some(([k, , x]) => k === "irrbisSizes" && x?.expertOnly));
  for (const loc of ["en", "de", "es", "fr", "zh-TW", "hi", "ja"]) {
    const irrbis = pokemonNameFor(IRRBIS, loc).toLowerCase();
    const kw = pogoKeywords(loc);
    const rOff = buildFilters([], [], off, [], loc, tFn);
    const rOn = buildFilters([], [], on, [], loc, tFn);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    check(`${loc}: off keeps the bare size guards and trade-evo guard`,
      hasClauseMatching(rOff.trash, new RegExp(`^!${esc(kw.flag.xxl)}$`)) && hasClauseMatching(rOff.trash, new RegExp(`^!${esc(kw.flag.xxs)}$`))
      && hasClauseMatching(rOff.trash, new RegExp(`^!\\+${esc(teDisplay("irrbis", loc))},${esc(kw.flag.traded)}$`)));
    // The family guard carves by SIZE, not by species: `!+Irrbis,traded,xxl,
    // xxs` frees an untraded XXL or XXS Irrbis and keeps an Average or Large
    // one, which is still untraded stock for the free evolution.
    check(`${loc}: on carves ${irrbis} out of !xxl and !xxs, and xxl/xxs out of the family guard`,
      hasClauseMatching(rOn.trash, new RegExp(`^!${esc(kw.flag.xxl)},${esc(irrbis)}$`)) && hasClauseMatching(rOn.trash, new RegExp(`^!${esc(kw.flag.xxs)},${esc(irrbis)}$`))
      && hasClauseMatching(rOn.trash, new RegExp(`^!\\+${esc(teDisplay("irrbis", loc))},${esc(kw.flag.traded)},${esc(kw.flag.xxl)},${esc(kw.flag.xxs)}$`)), rOn.trash);
    const onlyThose = clauses(rOn.trash).filter((c) => !clauses(rOff.trash).includes(c));
    check(`${loc}: exactly three clauses change, !xl stays bare`, onlyThose.length === 3 && hasClauseMatching(rOn.trash, new RegExp(`^!${esc(kw.flag.xl)}$`)), onlyThose.join(" | "));
    check(`${loc}: gift and pre-staged filters are untouched`, rOn.gift === rOff.gift && rOn.prestaged === rOff.prestaged);
    // Trade and buddy catch take the same `,irrbis` carve on both size
    // guards and nothing else: an Irrbis the trash would release is better
    // handed to someone who gets the free evolution. The family's trade-evo
    // guard is a trash clause only, so it has no counterpart here.
    const buddyOff = rOff.buddyCatchFilters[0]?.filter || "", buddyOn = rOn.buddyCatchFilters[0]?.filter || "";
    for (const [name, a, b] of [["trade", rOff.trade, rOn.trade], ["buddy catch", buddyOff, buddyOn]]) {
      const gone = clauses(a).filter((c) => !clauses(b).includes(c)).sort();
      const added = clauses(b).filter((c) => !clauses(a).includes(c)).sort();
      check(`${loc}: ${name} swaps exactly !xxl and !xxs for their ${irrbis} carves`,
        JSON.stringify(gone) === JSON.stringify([`!${kw.flag.xxl}`, `!${kw.flag.xxs}`].sort())
        && JSON.stringify(added) === JSON.stringify([`!${kw.flag.xxl},${irrbis}`, `!${kw.flag.xxs},${irrbis}`].sort()),
        `gone ${gone.join(" | ")}; added ${added.join(" | ")}`);
    }
    // Fixtures: a definite verdict needs every term answered, so the mon
    // carries a move list, a candy tier and the evolvable flag.
    const mon = (dex, family, flags = {}) => ({
      dex, species: pokemonNameFor(String(dex), loc).toLowerCase(), families: [family], types: ["ghost"], year: 2026, ageDays: 2, distance: 0, wp: 300,
      atk: 1, def: 1, hp: 1, star: 1, tags: [], moves: [], candyKm: 3,
      flags: { traded: false, shadow: false, lucky: false, favorite: false, shiny: false, legendary: false, mythical: false, ultrabeast: false,
        costume: false, purified: false, background: false, dynamaxCapable: false, doubleMoved: false, xxl: false, xl: false, xxs: false,
        tagged: false, legacyMove: false, newDexEvo: false, eggOnly: false, buddy: false, megaEvolved: false, canEvolve: false, ...flags },
    });
    const fam = pokemonNameFor(IRRBIS, loc).toLowerCase();
    const verdict = (str, m) => evalFilterDetailed(str, m, loc);
    const say = (v) => `${v.verdict}${v.unknown.length ? ` (unknown ${v.unknown.join(" ")})` : ""}`;
    const xxlIrrbis = mon(710, fam, { xxl: true });
    const xxsIrrbis = mon(710, fam, { xxs: true });
    const xxlPikachu = mon(25, pokemonNameFor(PIKACHU, loc).toLowerCase(), { xxl: true });
    const xxlPumpdjinn = mon(711, fam, { xxl: true });
    const plainIrrbis = mon(710, fam);
    check(`${loc}: an XXL Irrbis is released only with the toggle on`,
      verdict(rOff.trash, xxlIrrbis).verdict === false && verdict(rOn.trash, xxlIrrbis).verdict === true,
      `off ${say(verdict(rOff.trash, xxlIrrbis))}, on ${say(verdict(rOn.trash, xxlIrrbis))}`);
    check(`${loc}: an XXS Irrbis is released only with the toggle on`,
      verdict(rOff.trash, xxsIrrbis).verdict === false && verdict(rOn.trash, xxsIrrbis).verdict === true,
      `off ${say(verdict(rOff.trash, xxsIrrbis))}, on ${say(verdict(rOn.trash, xxsIrrbis))}`);
    check(`${loc}: an XXL non-Irrbis (Pikachu) is never released`,
      verdict(rOff.trash, xxlPikachu).verdict === false && verdict(rOn.trash, xxlPikachu).verdict === false,
      `off ${say(verdict(rOff.trash, xxlPikachu))}, on ${say(verdict(rOn.trash, xxlPikachu))}`);
    check(`${loc}: an XXL Pumpdjinn keeps its size and trade-evo protection with the toggle on`,
      verdict(rOn.trash, xxlPumpdjinn).verdict === false, say(verdict(rOn.trash, xxlPumpdjinn)));
    check(`${loc}: an untraded Irrbis that is neither XXL nor XXS (Average or Large) keeps the trade-evo guard either way`,
      verdict(rOff.trash, plainIrrbis).verdict === false && verdict(rOn.trash, plainIrrbis).verdict === false,
      `off ${say(verdict(rOff.trash, plainIrrbis))}, on ${say(verdict(rOn.trash, plainIrrbis))}`);
    const tradedPlainIrrbis = mon(710, fam, { traded: true });
    check(`${loc}: a traded plain Irrbis is released either way (the guard never covered it)`,
      verdict(rOff.trash, tradedPlainIrrbis).verdict === true && verdict(rOn.trash, tradedPlainIrrbis).verdict === true,
      `off ${say(verdict(rOff.trash, tradedPlainIrrbis))}, on ${say(verdict(rOn.trash, tradedPlainIrrbis))}`);
    check(`${loc}: an XXL Irrbis reaches the trade filter only with the toggle on`,
      verdict(rOn.trade, xxlIrrbis).verdict === true && verdict(rOff.trade, xxlIrrbis).verdict === false,
      `off ${say(verdict(rOff.trade, xxlIrrbis))}, on ${say(verdict(rOn.trade, xxlIrrbis))}`);
    check(`${loc}: an XXL Irrbis reaches the buddy catch filter only with the toggle on`,
      verdict(buddyOn, xxlIrrbis).verdict === true && verdict(buddyOff, xxlIrrbis).verdict === false,
      `off ${say(verdict(buddyOff, xxlIrrbis))}, on ${say(verdict(buddyOn, xxlIrrbis))}`);
    check(`${loc}: an XXL Pikachu stays out of trade and buddy catch with the toggle on`,
      verdict(rOn.trade, xxlPikachu).verdict === false && verdict(buddyOn, xxlPikachu).verdict === false,
      `trade ${say(verdict(rOn.trade, xxlPikachu))}, buddy ${say(verdict(buddyOn, xxlPikachu))}`);
  }
}

console.log(`\n${failures === 0 ? "✓ All carve-out checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
