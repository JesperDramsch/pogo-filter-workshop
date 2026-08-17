import { buildFilters, DEFAULT_CONFIG, prepareImport, validateImportEnvelope, SCHEMA_CURRENT, babyStageDex } from "../src/App.jsx";

const t = (key, opts) => key;

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

console.log("Scenario 1: pikachu in hundos AND luckies");
{
  const r = buildFilters(["pikachu"], ["pikachu"], DEFAULT_CONFIG, [], "en", t);
  check("trash contains +pikachu", r.trash.includes("+pikachu"));
  check("trade does NOT contain +pikachu", !r.trade.includes("+pikachu"));
  check("luckySort rendered", typeof r.luckySort === "string" && r.luckySort.length > 0);
  check("luckySort contains +pikachu", r.luckySort.includes("+pikachu"));
  check("luckyHundoSet size === 1", r.luckyHundoSet.size === 1);
}

console.log("\nScenario 2: pikachu in hundos only");
{
  const r = buildFilters(["pikachu"], [], DEFAULT_CONFIG, [], "en", t);
  check("trash contains +pikachu", r.trash.includes("+pikachu"));
  check("trade contains +pikachu", r.trade.includes("+pikachu"));
  check("luckySort is empty", r.luckySort === "");
  check("luckyHundoSet size === 0", r.luckyHundoSet.size === 0);
}

console.log("\nScenario 3: hundos=[pikachu], luckies=[charizard]");
{
  const r = buildFilters(["pikachu"], ["charizard"], DEFAULT_CONFIG, [], "en", t);
  check("trash contains +pikachu", r.trash.includes("+pikachu"));
  check("trade contains +pikachu (only lucky-hundos excluded)", r.trade.includes("+pikachu"));
  check("luckySort is empty (no intersection)", r.luckySort === "");
  check("luckyHundoSet size === 0", r.luckyHundoSet.size === 0);
}

console.log("\nScenario 4: empty lists is no-op");
{
  const r = buildFilters([], [], DEFAULT_CONFIG, [], "en", t);
  check("luckySort empty", r.luckySort === "");
  check("luckyHundoSet empty", r.luckyHundoSet.size === 0);
}

console.log("\nScenario 5: export envelope with luckies round-trips through prepareImport");
{
  const envelope = {
    schema: SCHEMA_CURRENT,
    exportedAt: "2026-05-16T08:00:00.000Z",
    data: { hundos: ["pikachu"], luckies: ["pikachu", "charizard"] },
  };
  const v = validateImportEnvelope(envelope);
  check("validates", v.ok === true);
  const prepared = prepareImport(v.envelope);
  check("luckies key present", "luckies" in prepared);
  check("luckies length === 2", prepared.luckies.length === 2);
}

console.log("\nScenario 6: legacy export without luckies → prepared.luckies absent");
{
  const envelope = {
    schema: SCHEMA_CURRENT,
    exportedAt: "2025-01-01T00:00:00.000Z",
    data: { hundos: ["pikachu"] },
  };
  const v = validateImportEnvelope(envelope);
  check("validates", v.ok === true);
  const prepared = prepareImport(v.envelope);
  check("luckies key absent (caller's setter skipped)", !("luckies" in prepared));
}

console.log("\nScenario 7: friend wishlist — family-name blacklist, trade guards, no 4* on hundo");
{
  // pikachu (hundo), charizard & dratini (lucky). EN output locale → EN names.
  // Owned families are excluded via `!+name` (family syntax has no dex form,
  // and lucky status / IVs survive evolution so one member covers the line).
  const r = buildFilters(["pikachu"], ["charizard", "dratini"], DEFAULT_CONFIG, [], "en", t);
  check("lucky wishlist excludes the charizard family", r.friendLuckyWishlist.includes("!+charizard"));
  check("lucky wishlist excludes the dratini family", r.friendLuckyWishlist.includes("!+dratini"));
  check("lucky wishlist renders names in the output locale (no DE leak)",
    !/glurak|dratini.*glurak/.test(r.friendLuckyWishlist) && !r.friendLuckyWishlist.includes("glurak"));
  check("owned families sorted alphabetically",
    r.friendLuckyWishlist.indexOf("!+charizard") < r.friendLuckyWishlist.indexOf("!+dratini"));
  check("no broken selectors from unresolvable entries", !r.friendLuckyWishlist.includes("undefined"));
  check("lucky wishlist carries mythical carve-out 808,809", r.friendLuckyWishlist.includes("808,809"));
  // Hundo list excludes owned hundo family and crucially has NO 4* (IVs re-roll on trade).
  check("hundo wishlist excludes the pikachu family", r.friendHundoWishlist.includes("!+pikachu"));
  check("hundo wishlist has NO 4* clause", !r.friendHundoWishlist.includes("4*"));
  check("hundo wishlist carries trade guards (808,809)", r.friendHundoWishlist.includes("808,809"));
  // Guaranteed variant = base lucky wishlist + an "old enough" year floor.
  // DEFAULT_CONFIG.luckyEligibleYear === 21 → guaranteed window is 20 and earlier.
  check("guaranteed lucky extends base list", r.friendLuckyWishlistGuaranteed.startsWith(r.friendLuckyWishlist));
  check("guaranteed lucky adds year-20 floor", r.friendLuckyWishlistGuaranteed.includes("-20"));
  check("plain lucky list has no year floor", !r.friendLuckyWishlist.includes("-20"));
}

console.log("\nScenario 8: friend wishlist localizes flag keywords to the friend's PoGo locale");
{
  const de = buildFilters([], ["pikachu"], DEFAULT_CONFIG, [], "de", t);
  check("DE renders !getauscht (traded)", de.friendLuckyWishlist.includes("getauscht"));
  check("DE renders !crypto (shadow)", de.friendLuckyWishlist.includes("crypto"));
  check("DE renders !mysteriös (mythical)", de.friendLuckyWishlist.includes("mysteriös"));
  check("DE renders !schillernd (shiny special-copy guard)", de.friendLuckyWishlist.includes("schillernd"));
}

console.log("\nScenario 9: empty HAVE-lists → guards only, lucky and hundo identical");
{
  const r = buildFilters([], [], DEFAULT_CONFIG, [], "en", t);
  check("empty lucky list is guards only (no negated dex)", !/![0-9]/.test(r.friendLuckyWishlist));
  check("empty lucky equals empty hundo (same guards)", r.friendLuckyWishlist === r.friendHundoWishlist);
  check("guards still present (808,809)", r.friendHundoWishlist.includes("808,809"));
  // Copy-level Special-Trade guards: shiny/costumed/background/purified copies
  // would each trigger a Special Trade, so no wishlist may surface them.
  for (const flag of ["!shiny", "!costume", "!background", "!purified"]) {
    check(`special-copy guard ${flag} on both wishlists`,
      r.friendLuckyWishlist.includes(flag) && r.friendHundoWishlist.includes(flag));
  }
}

console.log("\nScenario 10: hundo-sort regional form-scoping");
{
  // Vulpix hundo annotated Alolan → the hundo-sort narrows +vulpix to the Alolan
  // branch (drops the Kanto/fire form, which may still be chase-worthy). Vulpix
  // dex 37: base include:[fire], alola include:[ice] → dropping base = "!fire".
  const ann = buildFilters(["vulpix"], [], { ...DEFAULT_CONFIG, hundoForms: { vulpix: ["alola"] } }, [], "en", t);
  check("hundo-sort keeps the +vulpix union", ann.sort.includes("+vulpix"));
  check("hundo-sort scopes to the owned Alolan branch (!+vulpix,!fire)", ann.sort.includes("!+vulpix,!fire"), ann.sort);
  // Exclude-based catalog predicate: Kanto Raichu isolates as NOT-psychic, so a
  // Kanto-owned hundo drops the Alolan branch via the negated `!psychic` term.
  const raichu = buildFilters(["raichu"], [], { ...DEFAULT_CONFIG, hundoForms: { raichu: ["base"] } }, [], "en", t);
  check("exclude-based predicate handled (Kanto Raichu hundo → !+raichu,!psychic)", raichu.sort.includes("!+raichu,!psychic"), raichu.sort);
  // Unannotated hundo → whole family, byte-identical to the pre-feature output.
  const plain = buildFilters(["vulpix"], [], DEFAULT_CONFIG, [], "en", t);
  check("unannotated hundo-sort has no form-scope guard", !plain.sort.includes("!+vulpix,"), plain.sort);
  check("unannotated hundo-sort still surfaces the family", plain.sort.includes("+vulpix"));
}

console.log("\nScenario 11: lucky-hundo-sort jointly-done form intersection");
{
  // Both a hundo AND a lucky of Alolan Vulpix → surface the Alolan dupes only.
  const both = buildFilters(["vulpix"], ["vulpix"], { ...DEFAULT_CONFIG, hundoForms: { vulpix: ["alola"] }, luckyForms: { vulpix: ["alola"] } }, [], "en", t);
  check("jointly-done Alolan surfaces +vulpix", both.luckySort.includes("+vulpix"));
  check("jointly-done Alolan scopes to !+vulpix,!fire", both.luckySort.includes("!+vulpix,!fire"), both.luckySort);
  // Alolan hundo + Kanto lucky → no jointly-done form → the species drops out.
  const mismatch = buildFilters(["vulpix"], ["vulpix"], { ...DEFAULT_CONFIG, hundoForms: { vulpix: ["alola"] }, luckyForms: { vulpix: ["base"] } }, [], "en", t);
  check("mismatched forms drop vulpix from lucky-sort", !mismatch.luckySort.includes("+vulpix"));
  check("lucky-sort empty when the only member is mismatched", mismatch.luckySort === "", JSON.stringify(mismatch.luckySort));
  check("mismatch leaves luckyHundoSet intact (size 1)", mismatch.luckyHundoSet.size === 1);
  check("mismatch does not pull vulpix into trade", !mismatch.trade.includes("+vulpix"));
  // A second, unannotated member keeps its whole family while the mismatch drops.
  const partial = buildFilters(["vulpix", "pikachu"], ["vulpix", "pikachu"], { ...DEFAULT_CONFIG, hundoForms: { vulpix: ["alola"] }, luckyForms: { vulpix: ["base"] } }, [], "en", t);
  check("unannotated pikachu survives the mismatch drop", partial.luckySort.includes("+pikachu"));
  check("mismatched vulpix still dropped in the mixed set", !partial.luckySort.includes("+vulpix"));
}

console.log("\nScenario 12: standalone lucky-sort (lucky family browser)");
{
  const r = buildFilters([], ["pikachu"], DEFAULT_CONFIG, [], "en", t);
  check("lucky-sort surfaces the lucky family", r.luckyFamilySort.includes("+pikachu"));
  check("lucky-sort keeps lucky copies visible (no !lucky guard)", !r.luckyFamilySort.includes("!lucky"), r.luckyFamilySort);
  check("lucky-sort carries tag/favorite/shiny guards",
    r.luckyFamilySort.includes("!#") && r.luckyFamilySort.includes("!favorite") && r.luckyFamilySort.includes("!shiny"));
  // Regional-form scoped via luckyForms, same idiom as the hundo-sort.
  const annL = buildFilters([], ["vulpix"], { ...DEFAULT_CONFIG, luckyForms: { vulpix: ["alola"] } }, [], "en", t);
  check("lucky-sort scopes an annotated lucky to its owned form", annL.luckyFamilySort.includes("!+vulpix,!fire"), annL.luckyFamilySort);
  const empty = buildFilters([], [], DEFAULT_CONFIG, [], "en", t);
  check("lucky-sort empty with no luckies", empty.luckyFamilySort === "");
}

// Wishlist exclusions minus the seven fixed trade guards, so the assertions
// below read as just the owned-line plan. Derived by subtracting the empty-list
// baseline rather than splitting on a keyword — the guards are localized, and
// an empty plan yields the baseline verbatim with no separator to split on.
const stripGuards = (field) => (hundos, luckies, cfg = DEFAULT_CONFIG, loc = "en") => {
  const guards = buildFilters([], [], cfg, [], loc, t)[field];
  const full = buildFilters(hundos, luckies, cfg, [], loc, t)[field];
  return full === guards ? "" : full.slice(0, full.length - guards.length - 1);
};
const plan = stripGuards("friendLuckyWishlist");
const hundoPlanFull = stripGuards("friendHundoWishlist");
const hundoPlan = (hundos, cfg = DEFAULT_CONFIG, loc = "en") => hundoPlanFull(hundos, [], cfg, loc);

console.log("\nScenario 13: babyStageDex — the directional baby relation");
{
  check("Magmar (126) → baby Magby (240)", babyStageDex(126) === 240);
  check("Magmortar (467) → baby Magby (240) from two stages up", babyStageDex(467) === 240);
  check("Magby (240) itself → null (a baby is not its own gap)", babyStageDex(240) === null);
  check("Raichu (26) → baby Pichu (172)", babyStageDex(26) === 172);
  check("Bulbasaur (1) → null (no baby in the line)", babyStageDex(1) === null);
  check("Toxtricity (849) → baby Toxel (848)", babyStageDex(849) === 848);
}

console.log("\nScenario 14: baby stages survive the family exclusion");
{
  // `+Magmar` is the CANDY family and includes Magby, so a flat !+magmar hid
  // the one thing the user still needs. `,eggsonly` punches it back through.
  check("owned adult widens with eggsonly", plan([], ["magmar"]) === "!+magmar,eggsonly", plan([], ["magmar"]));
  check("owning the baby too drops the widening",
    plan([], ["magmar", "magby"]) === "!+magby&!+magmar", plan([], ["magmar", "magby"]));
  check("owning ONLY the baby needs no widening (evolving up is free)",
    plan([], ["magby"]) === "!+magby", plan([], ["magby"]));
  check("a line with no baby is byte-identical to before",
    plan([], ["bulbasaur"]) === "!+bulbasaur", plan([], ["bulbasaur"]));
  check("the hundo wishlist gets the same treatment",
    hundoPlan(["magmar"]) === "!+magmar,eggsonly", hundoPlan(["magmar"]));
  // Every member of a baby line widens, so a second entry in the SAME family
  // cannot AND the carve-out away.
  check("two members of one baby family both widen",
    plan([], ["pikachu", "raichu"]) === "!+pikachu,eggsonly&!+raichu,eggsonly",
    plan([], ["pikachu", "raichu"]));
  // Composes with regional-form scoping (Raichu is the one overlapping case).
  check("form scope and baby widening compose",
    plan([], ["raichu"], { ...DEFAULT_CONFIG, luckyForms: { raichu: ["alola"] } }) ===
      "!+raichu,!psychic,eggsonly",
    plan([], ["raichu"], { ...DEFAULT_CONFIG, luckyForms: { raichu: ["alola"] } }));
  check("de renders the localized keyword", plan([], ["magmar"], DEFAULT_CONFIG, "de") === "!+magmar,nurauseiern",
    plan([], ["magmar"], DEFAULT_CONFIG, "de"));
  // Toxel's eggsonly membership is unconfirmed against the Game Master, so it
  // must NOT be widened — enumeration keeps the friend's Toxel visible instead.
  check("unverified baby (Toxel) falls back to exact names",
    plan([], ["toxtricity"]) === "!toxtricity", plan([], ["toxtricity"]));
  // hi ships the keyword with a space; a spaced term inside an OR group is
  // unproven, so that locale enumerates too.
  check("a spaced keyword locale never emits the widening",
    !plan([], ["magmar"], DEFAULT_CONFIG, "hi").includes(","),
    plan([], ["magmar"], DEFAULT_CONFIG, "hi"));
  // The H∩L set is name-keyed, so a baby and its adult must NOT pair up.
  const r = buildFilters(["magby"], ["magmar"], DEFAULT_CONFIG, [], "en", t);
  check("a hundo baby does not pair with a lucky adult", r.luckyHundoSet.size === 0);
  check("the hundo baby stays tradeable", r.trade.includes("+magby"));
}

console.log("\nScenario 15: coin-flip branches are excluded member-by-member");
{
  check("one owned branch enumerates only that branch",
    plan([], ["silcoon"]) === "!silcoon&!beautifly", plan([], ["silcoon"]));
  check("owning the branch TIP excludes the whole branch",
    plan([], ["beautifly"]) === "!silcoon&!beautifly", plan([], ["beautifly"]));
  check("both branches covered collapses back to !+base",
    plan([], ["silcoon", "dustox"]) === "!+wurmple", plan([], ["silcoon", "dustox"]));
  check("both branch tips also collapse (no under-exclusion)",
    plan([], ["beautifly", "dustox"]) === "!+wurmple", plan([], ["beautifly", "dustox"]));
  check("owning ONLY the coin-flip base excludes nothing",
    plan([], ["wurmple"]) === "", JSON.stringify(plan([], ["wurmple"])));
  check("base + one branch still leaves the other branch visible",
    plan([], ["wurmple", "silcoon"]) === "!silcoon&!beautifly", plan([], ["wurmple", "silcoon"]));
  check("Clamperl's two tips are single-member branches",
    plan([], ["huntail"]) === "!huntail", plan([], ["huntail"]));
  check("both Clamperl tips collapse to !+clamperl",
    plan([], ["huntail", "gorebyss"]) === "!+clamperl", plan([], ["huntail", "gorebyss"]));
  check("duplicate members emit each clause once",
    plan([], ["silcoon", "beautifly"]) === "!silcoon&!beautifly", plan([], ["silcoon", "beautifly"]));
}

console.log("\nScenario 16: default output is untouched (fixture safety)");
{
  const empty = buildFilters([], [], DEFAULT_CONFIG, [], "de", t);
  check("empty have-lists emit guards only",
    empty.friendLuckyWishlist ===
      "!getauscht&!crypto&!mysteriös,808,809&!schillernd&!kostümiert&!hintergrund&!erlöst",
    empty.friendLuckyWishlist);
  check("an ordinary species is unchanged", plan([], ["charizard"]) === "!+charizard");
  check("form scoping alone is unchanged",
    plan([], ["vulpix"], { ...DEFAULT_CONFIG, luckyForms: { vulpix: ["alola"] } }) === "!+vulpix,!ice");
}

console.log(`\n${failures === 0 ? "✓ All lucky-logic checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
