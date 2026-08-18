// Regression tests for the filter EVALUATOR that backs the verify panel.
// Run with: npx vite-node scripts/check-verify.mjs
//
// The panel is the only pre-transfer safety check the app offers, and transfers
// are permanent. It used to fail OPEN: evalTerm returned null for any token it
// could not parse, evalClause skipped nulls and fell through to `false`, and the
// AND across clauses turned that into "not in trash" for EVERY Pokémon. One
// `!#Trade` clause — reachable from the normal-mode protectAnyTag toggle — was
// enough to green-light a shiny, a lucky and a hundo alike.
//
// Covers:
//   V1 — three-valued evaluation: unknown terms yield null, not a confident false
//   V2 — named tag tokens (#Trade, buddy prefixes) actually evaluate
//   V3 — `+X` matches the whole candy family, not just trade-evo families
//   V4 — the end-to-end fail-open scenario stays closed
//   V5 — evalFilter's boolean façade still behaves for the other check scripts

import {
  buildFilters, evalFilter, evalFilterDetailed, mergeImportedConfig, candyFamilyNames,
  DEFAULT_CONFIG, DEFAULT_HUNDOS, DEFAULT_LUCKIES, ivToBar, starFromIVs,
} from "../src/App.jsx";

const tFn = (k) => k;
let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// Mirrors how VerifyPanel builds its mon: raw 0-15 IVs in, bars + star derived.
const mk = (o = {}) => ({
  dex: 129, species: "magikarp", families: ["magikarp"], types: ["water"],
  wp: 200, ageDays: 1, year: 2026, distance: 0, tags: [], flags: {},
  ...o,
  atk: ivToBar(o.ivAtk ?? 0), def: ivToBar(o.ivDef ?? 0), hp: ivToBar(o.ivHp ?? 0),
  star: starFromIVs(o.ivAtk ?? 0, o.ivDef ?? 0, o.ivHp ?? 0),
});
const REAL = mergeImportedConfig(DEFAULT_CONFIG);
const trashFor = (cfg, hundos = DEFAULT_HUNDOS) =>
  buildFilters(hundos, DEFAULT_LUCKIES, cfg, [], "en", tFn).trash;

console.log("V1 — unknown terms produce null, never a confident false");
{
  const mon = mk();
  const unknownOnly = evalFilterDetailed("!zzzznotarealterm", mon, "en");
  check("a clause of only unknown terms is indeterminate",
    unknownOnly.verdict === null, `verdict=${unknownOnly.verdict}`);
  check("the offending term is reported back",
    unknownOnly.unknown.includes("!zzzznotarealterm"), unknownOnly.unknown.join("|"));

  // A satisfied KNOWN term settles a comma-OR clause regardless of siblings.
  const knownWins = evalFilterDetailed("!shiny,zzzznotarealterm", mon, "en");
  check("a known term that matches still yields a definite true",
    knownWins.verdict === true && knownWins.unknown.length === 0, `verdict=${knownWins.verdict}`);

  // A definitely-false clause settles the whole AND-chain, unknowns or not.
  const shortCircuit = evalFilterDetailed("shiny&zzzznotarealterm", mon, "en");
  check("a definitely-false clause short-circuits to a definite false",
    shortCircuit.verdict === false && shortCircuit.unknown.length === 0, `verdict=${shortCircuit.verdict}`);

  check("empty and doubled separators carry no predicate",
    evalFilterDetailed("!shiny&&", mon, "en").verdict === false);
}

console.log("\nV2 — named tag tokens evaluate instead of poisoning the clause");
{
  const untagged = mk();
  const staged = mk({ tags: ["Trade"] });
  const buddy = mk({ tags: ["auri-kindwurm"] });

  check("!#Trade on an untagged mon is definitely true",
    evalFilterDetailed("!#Trade", untagged, "en").verdict === true);
  check("!#Trade on a #Trade-tagged mon is definitely false",
    evalFilterDetailed("!#Trade", staged, "en").verdict === false);
  check("tag matching is prefix-based, as the buddy guards assume",
    evalFilterDetailed("!#auri", buddy, "en").verdict === false);
  check("a non-matching prefix does not fire",
    evalFilterDetailed("!#auri", staged, "en").verdict === true);
  check("bare # sees a tag list even without the tagged flag",
    evalFilterDetailed("!#", staged, "en").verdict === false);
  check("bare # on a genuinely untagged mon still passes",
    evalFilterDetailed("!#", untagged, "en").verdict === true);
}

console.log("\nV3 — +X spans the candy family, not just the 10 trade-evo families");
{
  // Raichu is Pikachu's candy family but NOT a trade-evo family, so the old
  // TE-only widening reported it as unmatched by the hundo union clause.
  // Exercise the panel's OWN derivation, not a hand-written family list.
  const famOf = (s) => [...new Set([s, ...candyFamilyNames(s, "en")])];
  check("candyFamilyNames('raichu') reaches the whole line",
    ["pichu", "pikachu", "raichu"].every((n) => famOf("raichu").includes(n)), famOf("raichu").join("|"));
  check("...and does not bleed into other lines", !famOf("raichu").includes("magikarp"));
  check("it works from any member of the line",
    famOf("pichu").includes("raichu") && famOf("pikachu").includes("raichu"));
  check("it resolves cross-locale input (de 'pikachu' → same line)",
    candyFamilyNames("pikachu", "de").includes("raichu"), candyFamilyNames("pikachu", "de").join("|"));
  check("unresolvable input yields no family", candyFamilyNames("zzznotamon", "en").length === 0);

  const raichu = mk({ dex: 26, species: "raichu", families: famOf("raichu") });
  check("+pikachu matches a Raichu", evalFilterDetailed("+pikachu", raichu, "en").verdict === true);
  check("+pikachu does not match an unrelated line",
    evalFilterDetailed("+pikachu", mk(), "en").verdict === false);

  // End-to-end: a hundo Pikachu puts `+pikachu` in the trash union clause.
  const withHundo = trashFor(REAL, ["pikachu"]);
  check("hundo union clause carries +pikachu",
    withHundo.split("&")[0].includes("+pikachu"), withHundo.split("&")[0]);
  check("a 3★ Raichu dupe is NOT reported as safe",
    evalFilterDetailed(withHundo.split("&")[0], mk({ dex: 26, species: "raichu",
      families: famOf("raichu"), ivAtk: 13, ivDef: 13, ivHp: 13 }), "en").verdict === true);
}

console.log("\nV4 — the fail-open scenario stays closed end to end");
{
  const junk = mk();
  check("baseline: junk Magikarp is definitely in the default trash",
    evalFilterDetailed(trashFor(REAL), junk, "en").verdict === true);

  // protectAnyTag is a NORMAL-mode toggle; turning it off swaps the blanket
  // `!#` for named `!#Trade` / `!#Fern-Tausch` clauses.
  const named = trashFor({ ...REAL, protectAnyTag: false });
  check("named-tag clauses are present", /!#Trade/.test(named), named.split("&").filter(c => c.includes("#")).join(" "));
  check("junk is STILL definitely in trash (was: false for every mon)",
    evalFilterDetailed(named, junk, "en").verdict === true);
  check("a #Trade-staged mon is correctly excluded",
    evalFilterDetailed(named, mk({ tags: ["Trade"] }), "en").verdict === false);

  // Custom league tags emit bare literals this evaluator cannot model. The
  // honest answer is "can't tell" — never a green "not in trash".
  const leagues = evalFilterDetailed(trashFor({ ...REAL, leagueTags: "GL,UL,ML" }), junk, "en");
  check("unmodellable league tags yield null, not false",
    leagues.verdict === null, `verdict=${leagues.verdict}`);
  check("...and name what could not be read", leagues.unknown.length > 0, leagues.unknown.join("|"));

  // Every keeper flag must stay a DEFINITE exclusion — no silent indeterminacy.
  for (const f of ["favorite", "shiny", "lucky", "legendary", "mythical", "costume", "background", "xxl"]) {
    check(`  ${f} is a definite exclusion`,
      evalFilterDetailed(trashFor(REAL), mk({ flags: { [f]: true } }), "en").verdict === false);
  }
}

console.log("\nV5 — the boolean façade is unchanged for the other check scripts");
{
  const junk = mk();
  check("evalFilter still returns a plain boolean",
    evalFilter(trashFor(REAL), junk, "en") === true);
  check("indeterminate collapses to false in the boolean façade",
    evalFilter("!zzzznotarealterm", junk, "en") === false);
  check("shiny is still excluded", evalFilter(trashFor(REAL), mk({ flags: { shiny: true } }), "en") === false);
}

console.log(`\n${failures === 0 ? "✓ All verify-evaluator checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
