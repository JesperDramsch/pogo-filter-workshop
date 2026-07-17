// Verifies the per-buddy catch-filter generation in buildFilters. Every buddy
// emits ONE combined catch filter: a species OR-list (the union of all wished
// species — whole-species, form-restricted, and trade-evo families, plus the
// expert raw append comma-spliced in verbatim) plus a per-species type guard
// `!<species>,<drop-types>` for each excluded regional form, plus the shared
// protection guards. The default-fixture snapshot (check-fixtures.mjs)
// ignores buddyCatchFilters and DEFAULT_CONFIG has no buddies, so this is the
// only coverage for that path.
//
// Beyond string-shape checks, a mini PoGo evaluator (evalFilter) confirms the
// combined filter's SEMANTICS on mock Pokémon — the form guards must isolate
// each species without colliding across species that share a dropped type.
//
// Run with: npm run test:buddy  (or npx vite-node scripts/check-buddy-catch.mjs)

import { buildFilters, DEFAULT_CONFIG } from "../src/App.jsx";
import { LOCALES } from "../src/i18n/index.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import REGIONAL_FORMS from "../src/data/regional-forms.json";

function makeTFn(locale) {
  const messages = LOCALES[locale]?.messages || LOCALES.en.messages;
  return (key, opts) => {
    let str = messages[key];
    if (str === undefined && locale !== "en") str = LOCALES.en.messages[key];
    if (str === undefined) return opts && "fallback" in opts ? opts.fallback : key;
    if (opts?.params) {
      for (const [k, v] of Object.entries(opts.params)) str = str.replaceAll(`{${k}}`, String(v));
    }
    return str;
  };
}

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const LOCALE = "de";
const tFn = makeTFn(LOCALE);
const kw = pogoKeywords(LOCALE);
const segs = (f) => f.split("&");

// Expected De Morgan clause for dropping a catalog form (must match App.jsx).
function form(dex, key) {
  return REGIONAL_FORMS.species[String(dex)].forms.find(f => f.key === key);
}
function deMorgan(f) {
  return [
    ...(f.include || []).map(t => `!${kw.type[t]}`),
    ...(f.exclude || []).map(t => kw.type[t]),
  ].join(",");
}

// ── Mini PoGo evaluator: filter = &-clauses (AND) of ,-literals (OR). ───────
function evalFilter(filter, mon) {
  return filter.split("&").every(clause =>
    clause.split(",").some(lit => litMatch(lit.trim(), mon)));
}
function litMatch(lit, mon) {
  if (lit.startsWith("!")) return !litMatch(lit.slice(1), mon);
  if (lit.startsWith("+")) return (mon.family || [mon.species]).includes(lit.slice(1));
  if (/^[0-4]\*$/.test(lit)) return mon.stars === Number(lit[0]);
  if (lit === "#") return !!mon.tagged;
  if (lit === kw.flag.favorite) return !!mon.favorite;
  if (lit === kw.flag.traded) return !!mon.traded;
  if (lit === kw.flag.shadow) return !!mon.shadow;
  if (lit === kw.flag.lucky) return !!mon.lucky;
  if (lit === kw.flag.shiny) return !!mon.shiny;
  if (lit === kw.flag.legendary) return !!mon.legendary;
  if (lit === kw.flag.ultra_beast) return !!mon.ultrabeast;
  if (lit === kw.flag.costume) return !!mon.costume;
  if (lit === kw.flag.purified) return !!mon.purified;
  if (lit === kw.flag.background) return !!mon.background;
  if (lit === kw.flag.mythical) return !!mon.mythical;
  if (/^\d+$/.test(lit)) return mon.dex === Number(lit);
  if (Object.values(kw.type).includes(lit)) return (mon.types || []).includes(lit);
  return mon.species === lit; // bare species name
}

const mk = (o) => ({ family: [o.species], stars: 0, types: [], dex: 0, ...o });

// Semantic scenarios use evalFilter on mock mons that only model species, form,
// stars and flags. Turn off the optional protection toggles so the only guards
// emitted are the always-on flag negations (!#, !favorit, !getauscht, !crypto,
// !glücks, !mysteriös,808,809, !schillernd, !legendär) — all of which the mock
// mons and evalFilter model. The full guard set is asserted structurally above.
const SEM_CFG = {
  ...DEFAULT_CONFIG,
  protectUltraBeasts: false, protectCostumes: false, protectPurified: false,
  protectBackgrounds: false, protectNundos: false, protectDoubleMoved: false,
  protectDynamax: false, protectXXL: false, protectXL: false, protectXXS: false,
  protectLegacyMoves: false,
};

// ─────────────────────────────────────────────────────────────────────────
console.log("Combined catch filter — structure (5 mixed targets, Mauzi hundo owned, expertMode ON)");
{
  const buddy = {
    id: "auri", name: "Auri", tagPrefix: "Auri", active: true, wantsTradeEvos: false,
    rawAppend: "kokowei,151",
    targetSpecies: [
      { species: "habitak", expand: false, dropForms: [] },      // whole species
      { species: "pikachu", expand: true,  dropForms: [] },      // +family, no regionals
      { species: "raichu",  expand: false, dropForms: [] },      // catalog species, all forms kept
      { species: "mauzi",   expand: false, dropForms: ["galar"] }, // drop Galar, owns hundo
      { species: "sandan",  expand: false, dropForms: ["base"] },  // drop Kanto base
    ],
  };
  const cfg = { ...DEFAULT_CONFIG, expertMode: true, buddies: [buddy] };
  const res = buildFilters(["mauzi"], [], cfg, [], LOCALE, tFn);
  const all = res.buddyCatchFilters;

  check("exactly ONE catch line per buddy (raw merged, no extra box)", all.length === 1,
    `got ${all.length} entries`);

  const f = all[0]?.filter || "";
  const S = segs(f);
  // Union: all five species in the first comma-run, raichu folded in (not its
  // own line), raw append comma-spliced verbatim at the end of the union.
  check("union starts with all five species selectors + raw append",
    f.startsWith("habitak,+pikachu,raichu,mauzi,sandan,kokowei,151&"), f.slice(0, 60));
  check("exact target has no '+' (Habitak not Ibitak)", !f.includes("+habitak"));
  // Per-species scoped form guards.
  check(`Galar-Mauzi guard '!mauzi,${deMorgan(form(52,"galar"))}' present`,
    S.includes(`!mauzi,${deMorgan(form(52, "galar"))}`));
  check(`Kanto-Sandan guard '!sandan,${deMorgan(form(27,"base"))}' present`,
    S.includes(`!sandan,${deMorgan(form(27, "base"))}`));
  // Spare-hundo carve-out (owns a Mauzi hundo) at buddy level.
  check("spare stars line ORs in the owned-hundo species", S.includes("0*,1*,2*,mauzi"));
  check("never-gift guard '!4*' present", S.includes("!4*"));
  // Standard protection guards — they now cover the raw append too.
  check("standard guards present ('!#', '!favorit')",
    S.includes("!#") && f.includes(`!${kw.flag.favorite}`));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nRaw append rides the guarded filter (semantic)");
{
  const buddy = { id: "r", name: "R", tagPrefix: "R", active: true, rawAppend: "kokowei",
    targetSpecies: [{ species: "habitak", expand: false, dropForms: [] }] };
  const cfg = { ...SEM_CFG, expertMode: true, buddies: [buddy] };
  const res = buildFilters([], [], cfg, [], LOCALE, tFn);
  check("one line only", res.buddyCatchFilters.length === 1, `got ${res.buddyCatchFilters.length}`);
  const f = res.buddyCatchFilters[0]?.filter || "";
  check("raw species caught", evalFilter(f, mk({ species: "kokowei", dex: 103 })) === true);
  check("wish species still caught", evalFilter(f, mk({ species: "habitak", dex: 21 })) === true);
  check("tagged raw species protected by the shared guards",
    evalFilter(f, mk({ species: "kokowei", dex: 103, tagged: true })) === false);
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nRaw-only buddy still gets ONE combined, guarded line");
{
  const buddy = { id: "q", name: "Q", tagPrefix: "Q", active: true, rawAppend: "kokowei",
    targetSpecies: [] };
  const res = buildFilters([], [], { ...DEFAULT_CONFIG, expertMode: true, buddies: [buddy] }, [], LOCALE, tFn);
  check("exactly one line", res.buddyCatchFilters.length === 1, `got ${res.buddyCatchFilters.length}`);
  const f = res.buddyCatchFilters[0]?.filter || "";
  check("union is the raw text, stars + guards apply",
    f.startsWith("kokowei&0*,1*,2*&") && segs(f).includes("!#"), f.slice(0, 40));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nThe headline case — Kanto Mauzi + Galar Ponita is ONE filter (semantic)");
{
  const buddy = {
    id: "julia", name: "Julia", tagPrefix: "Julia", active: true,
    targetSpecies: [
      { species: "mauzi",  expand: false, dropForms: ["alola", "galar"] }, // keep Kanto
      { species: "ponita", expand: false, dropForms: ["base"] },           // keep Galar
    ],
  };
  const cfg = { ...SEM_CFG, buddies: [buddy] };
  const res = buildFilters([], [], cfg, [], LOCALE, tFn);
  const lines = res.buddyCatchFilters;
  check("Julia gets exactly ONE filter (not three)", lines.length === 1, `got ${lines.length}`);
  const f = lines[0]?.filter || "";

  const cases = [
    ["Kanto Meowth",  mk({ species: "mauzi",  dex: 52, types: [kw.type.normal] }), true],
    ["Alola Meowth",  mk({ species: "mauzi",  dex: 52, types: [kw.type.dark] }),   false],
    ["Galar Meowth",  mk({ species: "mauzi",  dex: 52, types: [kw.type.steel] }),  false],
    ["Kanto Ponita",  mk({ species: "ponita", dex: 77, types: [kw.type.fire] }),   false],
    ["Galar Ponita",  mk({ species: "ponita", dex: 77, types: [kw.type.psychic] }), true],
    ["Pidgey",        mk({ species: "taubsi", dex: 16, types: [kw.type.normal] }), false],
  ];
  for (const [label, mon, want] of cases) {
    check(`${label} ${want ? "kept" : "dropped"}`, evalFilter(f, mon) === want);
  }
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nCross-species type collision is contained (Mauzi drop steel + want steel Alolan Sandshrew)");
{
  const buddy = {
    id: "x", name: "X", tagPrefix: "X", active: true,
    targetSpecies: [
      { species: "mauzi",  expand: false, dropForms: ["galar"] }, // drop Galar (steel)
      { species: "sandan", expand: false, dropForms: ["base"] },  // keep Alolan (ice/steel)
    ],
  };
  const cfg = { ...SEM_CFG, buddies: [buddy] };
  const f = buildFilters([], [], cfg, [], LOCALE, tFn).buddyCatchFilters[0].filter;
  // Alolan Sandshrew is steel — the Mauzi `!stahl` guard must NOT exclude it
  // because that guard is scoped by `!mauzi`.
  check("Alola Sandshrew (steel) kept despite Mauzi's steel drop",
    evalFilter(f, mk({ species: "sandan", dex: 27, types: [kw.type.ice, kw.type.steel] })) === true);
  check("Galar Meowth (steel) still dropped",
    evalFilter(f, mk({ species: "mauzi", dex: 52, types: [kw.type.steel] })) === false);
  check("Kanto Sandshrew (ground) dropped (base excluded)",
    evalFilter(f, mk({ species: "sandan", dex: 27, types: [kw.type.ground] })) === false);
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nFamily expansion + form drop uses '!+name' guard (semantic)");
{
  const buddy = {
    id: "y", name: "Y", tagPrefix: "Y", active: true,
    targetSpecies: [{ species: "mauzi", expand: true, dropForms: ["alola"] }], // +family, no Alolan
  };
  const cfg = { ...SEM_CFG, buddies: [buddy] };
  const f = buildFilters([], [], cfg, [], LOCALE, tFn).buddyCatchFilters[0].filter;
  check("guard uses '!+mauzi' (family-scoped)", segs(f).some(s => s.startsWith("!+mauzi,")));
  const persian = (types) => mk({ species: "snobilikat", dex: 53, types, family: ["mauzi", "snobilikat"] });
  check("Kanto Persian (in family, normal) kept", evalFilter(f, persian([kw.type.normal])) === true);
  check("Alola Persian (in family, dark) dropped", evalFilter(f, persian([kw.type.dark])) === false);
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nRaw append is expert-gated");
{
  const buddy = { id: "a", name: "A", tagPrefix: "A", active: true, rawAppend: "kokowei",
    targetSpecies: [{ species: "mauzi", expand: false, dropForms: ["galar"] }] };
  const off = buildFilters([], [], { ...DEFAULT_CONFIG, expertMode: false, buddies: [buddy] }, [], LOCALE, tFn);
  check("raw text absent from the filter when expertMode is off",
    !off.buddyCatchFilters.some(b => b.filter.includes("kokowei")));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nOnly a form-restricted target → one combined line, still guarded");
{
  const buddy = { id: "o", name: "O", tagPrefix: "O", active: true, rawAppend: "",
    targetSpecies: [{ species: "mauzi", expand: false, dropForms: ["galar"] }] };
  const res = buildFilters([], [], { ...DEFAULT_CONFIG, expertMode: true, buddies: [buddy] }, [], LOCALE, tFn);
  check("exactly one line", res.buddyCatchFilters.length === 1, `got ${res.buddyCatchFilters.length}`);
  const f = res.buddyCatchFilters[0]?.filter || "";
  check("has the species and a scoped guard and standard guards",
    segs(f).includes("mauzi") && segs(f).some(s => s.startsWith("!mauzi,")) && segs(f).includes("!#"));
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nDropping every form catches nothing → species omitted");
{
  const buddy = { id: "z", name: "Z", tagPrefix: "Z", active: true, rawAppend: "",
    targetSpecies: [{ species: "mauzi", expand: false, dropForms: ["base", "alola", "galar"] }] };
  const res = buildFilters([], [], { ...DEFAULT_CONFIG, expertMode: true, buddies: [buddy] }, [], LOCALE, tFn);
  check("no line emitted when all forms are dropped", res.buddyCatchFilters.length === 0,
    `got ${res.buddyCatchFilters.length}`);
}

console.log(`\n${failures === 0 ? "✓ All buddy-catch tests passed." : `✗ ${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
