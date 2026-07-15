// Regression tests for the hundo + friend (buddy) carve-out logic.
// Run with: npx vite-node scripts/check-carveouts.mjs
//
// Covers three fixes:
//   B1  — regional typeChecks honor the hundo carve-out (Corasonn / Paldean
//         Tauros) the same way bare collectors already do.
//   B2a — buddy tag prefixes are protected in the TRADE filter (granular-tag
//         mode), so friend-staged mons don't leak into the general trade pile.
//   B2b — buddy tag prefixes are surfaced in the PRESTAGED filter, so the
//         hand-off pile has an output filter at all.

import { buildFilters, evalFilter, mergeImportedConfig, DEFAULT_CONFIG } from "../src/App.jsx";

const tFn = (k) => k;
let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const clauses = (filterStr) => filterStr.split("&");
const hasClauseMatching = (filterStr, re) => clauses(filterStr).some(c => re.test(c));

const BUDDY = { id: "1", name: "Auri", tagPrefix: "#auri", active: true, targetSpecies: ["kindwurm"] };

console.log("B1 — hundo carve-out drops regional typeCheck protection");
{
  // Galarian Corsola (Corasonn) is BOTH a galarian typeCheck (ghost form) AND a
  // regionals collector. Owning a hundo must drop BOTH so 3★ dupes surface.
  const withHundo = buildFilters(["corasonn"], [], mergeImportedConfig({}), [], "de", tFn);
  const noHundo   = buildFilters([],            [], mergeImportedConfig({}), [], "de", tFn);

  check("no-hundo baseline: galarian ghost protection present",
    hasClauseMatching(noHundo.trash, /^!Corasonn,!geist/i),
    "regression guard");
  check("no-hundo baseline: regionals collector present",
    hasClauseMatching(noHundo.trash, /^!corasonn$/i),
    "regression guard");

  check("hundo corasonn: galarian ghost protection DROPPED",
    !hasClauseMatching(withHundo.trash, /^!Corasonn,!geist/i));
  check("hundo corasonn: regionals collector DROPPED",
    !hasClauseMatching(withHundo.trash, /^!corasonn$/i));
  check("hundo corasonn: carve-out token still present in trash clause 1",
    withHundo.trash.split("&")[0].includes("+corasonn"));
  check("hundo corasonn: a DIFFERENT regional (Tropius) stays protected",
    hasClauseMatching(withHundo.trash, /^!tropius$/i),
    "drop must be species-specific, not global");
}

console.log("\nB1 — Paldean Tauros: every form's typeCheck drops on hundo");
{
  const withHundo = buildFilters(["tauros"], [], mergeImportedConfig({}), [], "de", tFn);
  const noHundo   = buildFilters([],         [], mergeImportedConfig({}), [], "de", tFn);
  const tauroClauses = (f) => clauses(f.trash).filter(c => /^!Tauros,/i.test(c));
  check("no-hundo baseline: Tauros typeChecks present (3 paldean + 1 base)",
    tauroClauses(noHundo).length >= 4, `found ${tauroClauses(noHundo).length}`);
  check("hundo tauros: ALL Tauros typeCheck clauses dropped",
    tauroClauses(withHundo).length === 0, `found ${tauroClauses(withHundo).length}`);
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

console.log(`\n${failures === 0 ? "✓ All carve-out checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
