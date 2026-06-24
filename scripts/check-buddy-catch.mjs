// Verifies the per-buddy catch-filter generation in buildFilters: the
// expansion toggle (bare vs +family), the per-form filter lines (species and
// type as SEPARATE &-clauses), the spare-hundo carve-out, and the expert raw
// escape hatch. The default-fixture snapshot (check-fixtures.mjs) deliberately
// ignores buddyCatchFilters and DEFAULT_CONFIG has no buddies, so this is the
// only coverage for that code path.
//
// Run with: npm run test:buddy  (or npx vite-node scripts/check-buddy-catch.mjs)

import { buildFilters, DEFAULT_CONFIG } from "../src/App.jsx";
import { LOCALES } from "../src/i18n/index.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";

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
const DARK = kw.type.dark;  // "unlicht"
const ICE = kw.type.ice;    // "eis"
const segs = (f) => f.split("&");

// Buddy with: an exact target (habitak), a family-expand target (pikachu),
// a type-qualified target the user owns a hundo of (mauzi/Alola=dark), a
// type-qualified target with no hundo (sandan/Alola=ice), plus a raw blob.
const buddy = {
  id: "auri", name: "Auri", tagPrefix: "Auri", active: true, wantsTradeEvos: false,
  rawAppend: "mauzi&schillernd",
  targetSpecies: [
    { species: "habitak", expand: false, type: null },
    { species: "pikachu", expand: true,  type: null },
    { species: "mauzi",   expand: false, type: "dark" },
    { species: "sandan",  expand: false, type: "ice"  },
  ],
};

console.log("Buddy catch generation (expertMode ON, hundo of Mauzi owned)");
{
  const cfg = { ...DEFAULT_CONFIG, expertMode: true, buddies: [buddy] };
  const res = buildFilters(["mauzi"], [], cfg, [], LOCALE, tFn);
  const all = res.buddyCatchFilters;

  const shared = all.filter(b => !b.formKey);
  const typed = all.filter(b => b.formKey && b.formKey !== "raw");
  const raw = all.filter(b => b.formKey === "raw");

  check("exactly one shared species-selector filter", shared.length === 1, `got ${shared.length}`);
  check("exactly two per-form filter lines", typed.length === 2, `got ${typed.length}`);
  check("exactly one raw escape-hatch line", raw.length === 1, `got ${raw.length}`);

  // Shared selector: bare habitak (exact) + +pikachu (family), no Ibitak, no +habitak.
  const sharedFilter = shared[0]?.filter || "";
  check("shared selector is 'habitak,+pikachu'", sharedFilter.startsWith("habitak,+pikachu&"),
    sharedFilter.slice(0, 40));
  check("exact target has no '+' (Habitak not Ibitak)", !sharedFilter.includes("+habitak"));
  check("shared selector excludes the typed species", !segs(sharedFilter).includes("mauzi"));

  // Mauzi (dark / Alola) — owns a hundo → spare carve-out present.
  const mauzi = typed.find(b => b.formKey === "mauzi-dark");
  check("mauzi-dark form line exists", !!mauzi);
  const mSegs = segs(mauzi?.filter || "");
  check("species 'mauzi' is its OWN &-segment", mSegs.includes("mauzi"));
  check(`type '${DARK}' is its OWN &-segment`, mSegs.includes(DARK));
  check("species and type NOT fused in one comma-run",
    !mSegs.some(s => s.includes(",") && s.includes("mauzi") && s.includes(DARK)));
  check("spare carve-out present (owns Mauzi hundo): '!4*'", mSegs.includes("!4*"));
  check("spare stars line ORs in the species", mSegs.some(s => s === "0*,1*,2*,mauzi"));

  // Sandan (ice / Alola) — no hundo → plain stars, no spare guard.
  const sandan = typed.find(b => b.formKey === "sandan-ice");
  check("sandan-ice form line exists", !!sandan);
  const sSegs = segs(sandan?.filter || "");
  check("species 'sandan' is its OWN &-segment", sSegs.includes("sandan"));
  check(`type '${ICE}' is its OWN &-segment`, sSegs.includes(ICE));
  check("no spare guard without a hundo (no '!4*')", !sSegs.includes("!4*"));
  check("plain trashable stars '0*,1*,2*' present", sSegs.includes("0*,1*,2*"));

  // Every line carries the standard guards (not-tagged, favorites).
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

console.log("\nBuddy with only a typed target emits no empty shared line");
{
  const onlyTyped = { ...buddy, rawAppend: "", targetSpecies: [{ species: "mauzi", expand: false, type: "dark" }] };
  const cfg = { ...DEFAULT_CONFIG, expertMode: true, buddies: [onlyTyped] };
  const res = buildFilters([], [], cfg, [], LOCALE, tFn);
  check("no guards-only shared filter", !res.buddyCatchFilters.some(b => !b.formKey));
  check("the single form line is present", res.buddyCatchFilters.some(b => b.formKey === "mauzi-dark"));
}

console.log(`\n${failures === 0 ? "✓ All buddy-catch tests passed." : `✗ ${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
