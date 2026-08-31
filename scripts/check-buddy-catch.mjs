// Verifies the per-buddy catch-filter generation in buildFilters. Every buddy
// emits ONE combined catch filter: a species OR-list (the union of all wished
// species — whole-species, form-restricted, and trade-evo families) plus a
// per-species type guard `!<species>,<drop-types>` for each excluded regional
// form, plus the shared protection guards, plus the expert raw append
// `&`-joined verbatim at the end as extra AND-clauses. The default-fixture
// snapshot (check-fixtures.mjs) ignores buddyCatchFilters and DEFAULT_CONFIG
// has no buddies, so this is the only coverage for that path.
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
  if (lit === "weiblich" || lit === "female") return mon.gender === "female";
  if (lit === "männlich" || lit === "male") return mon.gender === "male";
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
    rawAppend: "!361,weiblich,female&!412,männlich,male",
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
  // Union: all five species in the first comma-run, raichu folded in (not its own line).
  check("union starts with all five species selectors",
    f.startsWith("habitak,+pikachu,raichu,mauzi,sandan&"), f.slice(0, 60));
  // Raw append `&`-joined verbatim at the end, each comma-group its own clause.
  check("raw append clauses at the end, verbatim",
    f.endsWith("&!361,weiblich,female&!412,männlich,male"), f.slice(-50));
  check("each raw comma-group is a self-contained clause",
    S.includes("!361,weiblich,female") && S.includes("!412,männlich,male"));
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
console.log("\nRaw append restricts the guarded filter (semantic — no purified/costume, female-only Meowth)");
{
  // SEM_CFG turns the purified/costume toggles OFF, so those exclusions can
  // only come from the raw append — proving the raw clauses take effect.
  const buddy = {
    id: "r", name: "R", tagPrefix: "R", active: true,
    rawAppend: `!${kw.flag.purified}&!${kw.flag.costume}&!52,weiblich,female`,
    targetSpecies: [
      { species: "mauzi",   expand: false, dropForms: [] },
      { species: "habitak", expand: false, dropForms: [] },
    ],
  };
  const cfg = { ...SEM_CFG, expertMode: true, buddies: [buddy] };
  const res = buildFilters([], [], cfg, [], LOCALE, tFn);
  check("one line only", res.buddyCatchFilters.length === 1, `got ${res.buddyCatchFilters.length}`);
  const f = res.buddyCatchFilters[0]?.filter || "";
  check("female Meowth kept", evalFilter(f, mk({ species: "mauzi", dex: 52, gender: "female" })) === true);
  check("male Meowth dropped by the gender guard",
    evalFilter(f, mk({ species: "mauzi", dex: 52, gender: "male" })) === false);
  check("purified female Meowth dropped by the raw !purified clause",
    evalFilter(f, mk({ species: "mauzi", dex: 52, gender: "female", purified: true })) === false);
  check("costumed female Meowth dropped by the raw !costume clause",
    evalFilter(f, mk({ species: "mauzi", dex: 52, gender: "female", costume: true })) === false);
  check("male Spearow untouched (gender guard is scoped to dex 52)",
    evalFilter(f, mk({ species: "habitak", dex: 21, gender: "male" })) === true);
  check("shared guards still apply on top (tagged female Meowth protected)",
    evalFilter(f, mk({ species: "mauzi", dex: 52, gender: "female", tagged: true })) === false);
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nGender picker emits per-species scoped guards (structure + semantic)");
{
  const buddy = {
    id: "g", name: "G", tagPrefix: "G", active: true,
    targetSpecies: [
      { species: "mauzi",   expand: false, dropForms: [], gender: "female" },
      { species: "pikachu", expand: true,  dropForms: [], gender: "male" },
      { species: "habitak", expand: false, dropForms: [], gender: "any" },
    ],
  };
  const cfg = { ...SEM_CFG, buddies: [buddy] };
  const res = buildFilters([], [], cfg, [], LOCALE, tFn);
  check("still exactly ONE line", res.buddyCatchFilters.length === 1,
    `got ${res.buddyCatchFilters.length}`);
  const f = res.buddyCatchFilters[0]?.filter || "";
  const S = segs(f);
  check(`exact target guard '!mauzi,${kw.flag.female}' present`,
    S.includes(`!mauzi,${kw.flag.female}`));
  check(`family target guard '!+pikachu,${kw.flag.male}' present`,
    S.includes(`!+pikachu,${kw.flag.male}`));
  check("'any' target emits no gender guard", !S.some(s => s.startsWith("!habitak")));

  const pichu = (gender) => mk({ species: "pichu", dex: 172, gender, family: ["pikachu", "pichu"] });
  const cases = [
    ["female Meowth", mk({ species: "mauzi", dex: 52, gender: "female" }), true],
    ["male Meowth",   mk({ species: "mauzi", dex: 52, gender: "male" }),   false],
    ["male Pichu (family target)",   pichu("male"),   true],
    ["female Pichu (family target)", pichu("female"), false],
    ["male Spearow (no gender pick)",   mk({ species: "habitak", dex: 21, gender: "male" }),   true],
    ["female Spearow (no gender pick)", mk({ species: "habitak", dex: 21, gender: "female" }), true],
  ];
  for (const [label, mon, want] of cases) {
    check(`${label} ${want ? "kept" : "dropped"}`, evalFilter(f, mon) === want);
  }
}

// ─────────────────────────────────────────────────────────────────────────
console.log("\nRaw-only buddy still gets ONE combined, guarded line");
{
  const buddy = { id: "q", name: "Q", tagPrefix: "Q", active: true, rawAppend: "kokowei",
    targetSpecies: [] };
  const res = buildFilters([], [], { ...DEFAULT_CONFIG, expertMode: true, buddies: [buddy] }, [], LOCALE, tFn);
  check("exactly one line", res.buddyCatchFilters.length === 1, `got ${res.buddyCatchFilters.length}`);
  const f = res.buddyCatchFilters[0]?.filter || "";
  check("stars + guards, raw appended at the end",
    f.startsWith("0*,1*,2*&") && segs(f).includes("!#") && f.endsWith("&kokowei"), f.slice(0, 40));
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

// ─────────────────────────────────────────────────────────────────────────
// The spare carve-out reads the have-list annotations
//
// When a buddy wants a species you already own a hundo of, the stars line
// widens to `0*,1*,2*,<selector>` + `!4*`: your 3★ copies are surplus, so hand
// them over. Species-level ownership is the wrong question for a species split
// by form, gender or an un-searchable slot — this is the same
// whole-species-counts-as-done bug the friend wishlist carried, on the surface
// that GIVES POKÉMON AWAY. The gate is opt-in: an unannotated hundo behaves
// exactly as it always did, so every scenario below has its control.
//
// Annotation maps are canonical-species-keyed (mergeConfig canonicalizes them),
// which in this repo means the German name — sandan, not sandshrew.
console.log("\nSpare carve-out: annotated hundos only cover what they actually are");
{
  const target = (over) => ({ species: "sandan", expand: false, dropForms: [], dropSlots: [], gender: "any", ...over });
  const run = (targets, cfgExtra, hundos = ["sandan"]) => {
    const buddy = { id: "s", name: "S", tagPrefix: "S", active: true, rawAppend: "", targetSpecies: targets };
    const res = buildFilters(hundos, [], { ...DEFAULT_CONFIG, buddies: [buddy], ...cfgExtra }, [], LOCALE, tFn);
    return res.buddyCatchFilters[0]?.filter || "";
  };
  // The carve-out is visible as the `!4*` guard, which only ever accompanies it.
  const spared = (f) => segs(f).includes("!4*");

  check("control: unannotated hundo still opens the carve-out",
    spared(run([target({})], {})));
  check("control: no hundo at all → plain stars line, no carve-out",
    !spared(run([target({})], {}, [])));

  // Forms. Owning the Kanto hundo must not offer up the Alolan spares.
  check("hundo annotated Kanto + buddy wants Alola → no carve-out",
    !spared(run([target({ dropForms: ["base"] })], { hundoForms: { sandan: ["base"] } })));
  check("hundo annotated Kanto + buddy wants Kanto → carve-out fires",
    spared(run([target({ dropForms: ["alola"] })], { hundoForms: { sandan: ["base"] } })));
  check("hundo annotated Kanto + buddy wants either form → carve-out fires (overlap is enough)",
    spared(run([target({})], { hundoForms: { sandan: ["base"] } })));

  // Un-searchable slots. Burmy's four cloaks share one dex entry and one type,
  // so nothing about them can be written as a search term — the carve-out is
  // the only place a slot pick has any effect at all.
  const burmy = (over) => ({ species: "burmy", expand: false, dropForms: [], dropSlots: [], gender: "any", ...over });
  const runB = (over, cfgExtra) => run([burmy(over)], cfgExtra, ["burmy"]);
  check("hundo Burmy with one cloak ticked + buddy wants the species → no carve-out",
    !spared(runB({}, { hundoSlots: { burmy: ["plant"] } })));
  check("…but if the buddy only wants that cloak → carve-out fires",
    spared(runB({ dropSlots: ["male", "sandy", "trash"] }, { hundoSlots: { burmy: ["plant"] } })));
  check("…and if they want a different one → no carve-out",
    !spared(runB({ dropSlots: ["male", "plant", "trash"] }, { hundoSlots: { burmy: ["plant"] } })));
  check("every cloak ticked → carve-out fires for the whole species",
    spared(runB({}, { hundoSlots: { burmy: ["male", "plant", "sandy", "trash"] } })));

  // Gender. A ♂ Wadribie is never the ♀ one a buddy asked for.
  const combee = (over) => ({ species: "wadribie", expand: false, dropForms: [], dropSlots: [], gender: "any", ...over });
  check("hundo annotated ♂ + buddy locked ♀ → no carve-out",
    !spared(run([combee({ gender: "female" })], { hundoGenders: { wadribie: ["male"] } }, ["wadribie"])));
  check("hundo annotated ♀ + buddy locked ♀ → carve-out fires",
    spared(run([combee({ gender: "female" })], { hundoGenders: { wadribie: ["female"] } }, ["wadribie"])));
}

// ─────────────────────────────────────────────────────────────────────────
// dropSlots is invisible to the string, by construction. If a slot key, a slot
// label or a narrowed selector ever showed up here it would be a search term
// PoGo cannot parse — the failure the whole AXIS_SLOT distinction exists to
// prevent.
console.log("\nDropped slots never reach the filter string");
{
  const buddy = { id: "n", name: "N", tagPrefix: "N", active: true, rawAppend: "",
    targetSpecies: [{ species: "burmy", expand: false, dropForms: [], dropSlots: ["male", "sandy"], gender: "any" }] };
  const withDrops = buildFilters([], [], { ...DEFAULT_CONFIG, buddies: [buddy] }, [], LOCALE, tFn);
  const plain = { ...buddy, targetSpecies: [{ ...buddy.targetSpecies[0], dropSlots: [] }] };
  const without = buildFilters([], [], { ...DEFAULT_CONFIG, buddies: [plain] }, [], LOCALE, tFn);
  const f = withDrops.buddyCatchFilters[0]?.filter || "";
  check("the filter is byte-identical with and without the slot drops",
    f === (without.buddyCatchFilters[0]?.filter || ""), f);
  check("the species is still asked for in full", segs(f).includes("burmy"));
  for (const term of ["male", "sandy", "plant", "trash"])
    check(`no '${term}' term in the string`, !f.includes(term), f);
  check("no slot guard clause", !segs(f).some(s => s.startsWith("!burmy,")), f);
}

console.log(`\n${failures === 0 ? "✓ All buddy-catch tests passed." : `✗ ${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
