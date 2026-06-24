// Verifies the per-buddy catch-filter generation in buildFilters: the expansion
// toggle (bare vs +family), the regional-form picker (each dropped form becomes
// one De Morgan &-clause), whole-species targets sharing one selector line, the
// spare-hundo carve-out, and the expert raw escape hatch. The default-fixture
// snapshot (check-fixtures.mjs) deliberately ignores buddyCatchFilters and
// DEFAULT_CONFIG has no buddies, so this is the only coverage for that path.
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
const GALAR_DROP = deMorgan(form(52, "galar")); // Mauzi: drop Galar (Steel) → "!stahl"
const BASE_DROP  = deMorgan(form(27, "base"));  // Sandan: drop Kanto base → "!boden"

// habitak (exact, whole species), pikachu (+family, no regional forms),
// raichu (catalog species but all forms kept → whole species), mauzi (drop
// Galar, owns a hundo → spare carve-out), sandan (drop Kanto base, no hundo).
const buddy = {
  id: "auri", name: "Auri", tagPrefix: "Auri", active: true, wantsTradeEvos: false,
  rawAppend: "mauzi&schillernd",
  targetSpecies: [
    { species: "habitak", expand: false, dropForms: [] },
    { species: "pikachu", expand: true,  dropForms: [] },
    { species: "raichu",  expand: false, dropForms: [] },
    { species: "mauzi",   expand: false, dropForms: ["galar"] },
    { species: "sandan",  expand: false, dropForms: ["base"] },
  ],
};

console.log("Buddy catch generation (expertMode ON, hundo of Mauzi owned)");
{
  const cfg = { ...DEFAULT_CONFIG, expertMode: true, buddies: [buddy] };
  const res = buildFilters(["mauzi"], [], cfg, [], LOCALE, tFn);
  const all = res.buddyCatchFilters;

  const shared = all.filter(b => !b.formKey);
  const formLines = all.filter(b => b.formKey && b.formKey !== "raw");
  const raw = all.filter(b => b.formKey === "raw");

  check("exactly one shared species-selector filter", shared.length === 1, `got ${shared.length}`);
  check("exactly two form-restricted lines", formLines.length === 2, `got ${formLines.length}`);
  check("exactly one raw escape-hatch line", raw.length === 1, `got ${raw.length}`);

  // Shared selector: exact habitak + +pikachu + exact raichu (all whole-species).
  const sharedFilter = shared[0]?.filter || "";
  check("shared selector starts 'habitak,+pikachu,raichu'", sharedFilter.startsWith("habitak,+pikachu,raichu&"),
    sharedFilter.slice(0, 50));
  check("exact target has no '+' (Habitak not Ibitak)", !sharedFilter.includes("+habitak"));
  check("whole-species raichu stays in the shared line (not its own)", !sharedFilter.includes("+raichu"));
  check("shared selector excludes the form-restricted species",
    !segs(sharedFilter).includes("mauzi") && !segs(sharedFilter).includes("sandan"));

  // Mauzi: drop Galar, owns a hundo → spare carve-out + De Morgan !stahl.
  const mauzi = formLines.find(b => b.formKey === "mauzi");
  check("mauzi form line exists (formKey is the species)", !!mauzi);
  const mSegs = segs(mauzi?.filter || "");
  check("species 'mauzi' is its OWN &-segment", mSegs.includes("mauzi"));
  check(`dropped Galar is a De Morgan &-segment '${GALAR_DROP}'`, mSegs.includes(GALAR_DROP));
  check("spare carve-out present (owns Mauzi hundo): '!4*'", mSegs.includes("!4*"));
  check("spare stars line ORs in the species", mSegs.some(s => s === "0*,1*,2*,mauzi"));

  // Sandan: drop Kanto base, no hundo → plain stars, De Morgan !boden, no !4*.
  const sandan = formLines.find(b => b.formKey === "sandan");
  check("sandan form line exists", !!sandan);
  const sSegs = segs(sandan?.filter || "");
  check("species 'sandan' is its OWN &-segment", sSegs.includes("sandan"));
  check(`dropped base is a De Morgan &-segment '${BASE_DROP}'`, sSegs.includes(BASE_DROP));
  check("no spare guard without a hundo (no '!4*')", !sSegs.includes("!4*"));
  check("plain trashable stars '0*,1*,2*' present", sSegs.includes("0*,1*,2*"));

  // Every guarded line carries the standard guards (not-tagged, favorites).
  check("all lines guarded by '!#' and favorites",
    [shared[0], mauzi, sandan].every(b => segs(b.filter).includes("!#")
      && b.filter.includes(`!${kw.flag.favorite}`)));

  // Raw line is verbatim and unguarded.
  check("raw line filter is verbatim", raw[0]?.filter === "mauzi&schillernd");
  check("raw line carries no guards", !segs(raw[0]?.filter || "").includes("!#"));
}

console.log("\nRaw escape hatch is expert-gated");
{
  const cfg = { ...DEFAULT_CONFIG, expertMode: false, buddies: [buddy] };
  const res = buildFilters(["mauzi"], [], cfg, [], LOCALE, tFn);
  check("no raw line when expertMode is off",
    !res.buddyCatchFilters.some(b => b.formKey === "raw"));
}

console.log("\nBuddy with only a form-restricted target emits no empty shared line");
{
  const onlyForm = { ...buddy, rawAppend: "", targetSpecies: [{ species: "mauzi", expand: false, dropForms: ["galar"] }] };
  const cfg = { ...DEFAULT_CONFIG, expertMode: true, buddies: [onlyForm] };
  const res = buildFilters([], [], cfg, [], LOCALE, tFn);
  check("no guards-only shared filter", !res.buddyCatchFilters.some(b => !b.formKey));
  check("the single form line is present", res.buddyCatchFilters.some(b => b.formKey === "mauzi"));
}

console.log("\nDropping every form catches nothing → line is skipped");
{
  const allDropped = { ...buddy, rawAppend: "",
    targetSpecies: [{ species: "mauzi", expand: false, dropForms: ["base", "alola", "galar"] }] };
  const cfg = { ...DEFAULT_CONFIG, expertMode: true, buddies: [allDropped] };
  const res = buildFilters([], [], cfg, [], LOCALE, tFn);
  check("no line emitted when all forms are dropped", res.buddyCatchFilters.length === 0,
    `got ${res.buddyCatchFilters.length}`);
}

console.log(`\n${failures === 0 ? "✓ All buddy-catch tests passed." : `✗ ${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
