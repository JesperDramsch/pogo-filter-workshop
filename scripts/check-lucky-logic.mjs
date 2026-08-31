import { buildFilters, DEFAULT_CONFIG, prepareImport, validateImportEnvelope, SCHEMA_CURRENT, babyStageDex, genderSlotsFor, regionalFormsFor, invisibleSlotsFor, INVISIBLE_SLOT_DEX, formGuardHides, deerlingSeasonFor, currentSeasonWindow } from "../src/App.jsx";
import {
  AXIS_FORM,
  AXIS_GENDER,
  AXIS_SLOT,
  GENDER_LOCK_AXIS,
  refinementAxisFor,
  refinementComplete,
} from "../src/refinements.jsx";

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

// Config annotation maps are keyed by the CANONICAL (German) species name, the
// same convention mergeImportedConfig's canonMapKeys enforces.
const cfgWith = (o) => ({ ...DEFAULT_CONFIG, ...o });

console.log("\nScenario 17: gender slots — catalog shape");
{
  check("Wadribie (415) needs ♀ only — ♂ is a dead end",
    JSON.stringify(genderSlotsFor("combee")) === '["female"]');
  check("Molunk (757) needs ♀ only", JSON.stringify(genderSlotsFor("salandit")) === '["female"]');
  check("Schneppke (361) needs ♀ only", JSON.stringify(genderSlotsFor("snorunt")) === '["female"]');
  check("Kirlia (281) needs ♂ only", JSON.stringify(genderSlotsFor("kirlia")) === '["male"]');
  check("Psiaugon (678) counts BOTH — gendered forms are distinct dex entries",
    JSON.stringify(genderSlotsFor("meowstic")) === '["female","male"]');
  check("an ordinary species has no gender slots", genderSlotsFor("charizard") === null);
  check("Burmy is deliberately absent (cloak × gender belongs with the form work)",
    genderSlotsFor("burmy") === null);
  // The chip-load invariant: a have-list chip must never render two badge
  // groups, so the two catalogs have to stay disjoint.
  const overlap = ["combee", "salandit", "snorunt", "ralts", "kirlia", "meowstic",
    "indeedee", "oinkologne", "pyroar", "frillish", "jellicent"]
    .filter((s) => genderSlotsFor(s) && (regionalFormsFor(s) || []).length > 0);
  check("gender catalog is disjoint from the regional-form catalog", overlap.length === 0,
    JSON.stringify(overlap));
}

console.log("\nScenario 18: wishlist hides the gender you OWN");
{
  const own = (g) => cfgWith({ luckyGenders: { wadribie: g } });
  check("owning ♂ keeps the friend's ♀ visible",
    plan([], ["combee"], own(["male"])) === "!+combee,!male", plan([], ["combee"], own(["male"])));
  check("owning ♀ completes the slot → plain family exclusion",
    plan([], ["combee"], own(["female"])) === "!+combee");
  check("owning both → plain family exclusion",
    plan([], ["combee"], own(["male", "female"])) === "!+combee");
  check("unannotated is byte-identical to before", plan([], ["combee"]) === "!+combee");
  check("a ♂-only Psiaugon keeps ♀ visible (both genders are slots)",
    plan([], ["meowstic"], cfgWith({ luckyGenders: { psiaugon: ["male"] } })) === "!+meowstic,!male");
  check("the hundo wishlist behaves identically",
    hundoPlan(["combee"], cfgWith({ hundoGenders: { wadribie: ["male"] } })) === "!+combee,!male");
  check("de renders the localized keyword",
    plan([], ["combee"], own(["male"]), "de") === "!+wadribie,!männlich",
    plan([], ["combee"], own(["male"]), "de"));
  check("a species outside the catalog is never annotated",
    plan([], ["charizard"], cfgWith({ luckyGenders: { glurak: ["male"] } })) === "!+charizard");
}

console.log("\nScenario 19: sorts hide the gender you LACK (opposite direction)");
{
  const s = (h, cfg) => buildFilters(h, [], cfg, [], "en", t).sort;
  check("owning ♀ surfaces only your ♀ duplicates",
    s(["meowstic"], cfgWith({ hundoGenders: { psiaugon: ["female"] } })).includes("!+meowstic,!male"),
    s(["meowstic"], cfgWith({ hundoGenders: { psiaugon: ["female"] } })));
  check("unannotated adds no gender guard", !s(["meowstic"], DEFAULT_CONFIG).includes("!+meowstic,"));
  check("owning both adds no gender guard",
    !s(["meowstic"], cfgWith({ hundoGenders: { psiaugon: ["female", "male"] } })).includes("!+meowstic,"));
  const ls = buildFilters([], ["combee"], cfgWith({ luckyGenders: { wadribie: ["male"] } }), [], "en", t)
    .luckyFamilySort;
  check("the lucky-sort scopes the same way", ls.includes("!+combee,!female"), ls);
  // Single-slot species, slot already CLOSED: the guard must not fire. Hiding ♂
  // Wadribie protects nothing (it can never become Honweisel) and would bury
  // the spare ♂ duplicates this sort exists to surface for binning.
  const done = s(["combee"], cfgWith({ hundoGenders: { wadribie: ["female"] } }));
  check("owning the slot-closing ♀ emits NO guard (♂ is a dead end, not a chase)",
    !done.includes("!+combee,"), done);
  check("…and the family is still surfaced", done.includes("+combee"), done);
  // The still-open case keeps its guard: ♀ is genuinely wanted, so protect it.
  const open = s(["combee"], cfgWith({ hundoGenders: { wadribie: ["male"] } }));
  check("owning only ♂ still hides the wanted ♀", open.includes("!+combee,!female"), open);
  // Two-slot species: each gender is a distinct dex entry, so both directions guard.
  const mBoth = s(["meowstic"], cfgWith({ hundoGenders: { psiaugon: ["male"] } }));
  check("Psiaugon ♂-owned hides the still-wanted ♀", mBoth.includes("!+meowstic,!female"), mBoth);
}

console.log("\nScenario 20: friend-collect coverage respects gender");
{
  const target = { friendCollectSpecies: ["wadribie"], friendCollectGenders: { wadribie: "female" } };
  const fc = (cfg) => buildFilters([], ["combee"], cfg, [], "en", t).friendCollectWishlist;
  check("a ♀-locked target is NOT covered by a ♂-only lucky",
    fc(cfgWith({ ...target, luckyGenders: { wadribie: ["male"] } })).startsWith("combee&"),
    fc(cfgWith({ ...target, luckyGenders: { wadribie: ["male"] } })));
  check("a ♀ lucky covers it (target drops out)",
    fc(cfgWith({ ...target, luckyGenders: { wadribie: ["female"] } })) === "");
  check("an UNannotated lucky still covers it — annotations opt IN",
    fc(cfgWith(target)) === "");
}

// The disjointness and type-declaration checks below walk the catalog itself
// (every resolver takes a dex as readily as a name), so a species added to
// INVISIBLE_FORM_SLOTS is covered by them the moment it lands there — a
// hand-copied list would leave the newest entry, the one most likely to be
// wrong, as the only one nothing asserts.
const SLOT_SPECIES = INVISIBLE_SLOT_DEX;

console.log("\nScenario 21: un-searchable slots — catalog and disjointness");
{
  check("Sesokitz carries the four seasons",
    JSON.stringify(invisibleSlotsFor("deerling")?.slots) === '["spring","summer","autumn","winter"]');
  check("Kinoso carries Overcast/Sunny",
    JSON.stringify(invisibleSlotsFor("cherrim")?.slots) === '["overcast","sunny"]');
  check("Burmy is ONE four-slot group (gender × cloak interact)",
    JSON.stringify(invisibleSlotsFor("burmy")?.slots) === '["male","plant","sandy","trash"]');
  check("Barschuft carries the three stripes",
    JSON.stringify(invisibleSlotsFor("basculin")?.slots) === '["red","blue","white"]');
  check("an ordinary species has no slots", invisibleSlotsFor("charizard") === null);
  // The stripes are separate form templates with separate stats, but every one
  // of them is pure Water in the game master — so they can never become a
  // search guard, exactly like Burmy's cloaks. fetch-regional-forms.mjs asserts
  // the other half of this against the live dump.
  check("Barschuft's stripes are NOT in the searchable form catalog",
    regionalFormsFor("basculin") === null);
  // Burmadame's cloaks DO differ by type, so they belong in the searchable
  // form catalog and must NOT be tracked as invisible slots.
  check("Burmadame is type-searchable, not an invisible-slot species",
    invisibleSlotsFor("wormadam") === null);
  check("Burmadame's three cloaks are in the form catalog",
    (regionalFormsFor("wormadam") || []).map((f) => f.key).join(",") ===
      "cloak:plant,cloak:sandy,cloak:trash");
  check("Choreogel's four styles are in the form catalog too",
    (regionalFormsFor("oricorio") || []).length === 4);
  check("Burmy itself has NO searchable forms (all three cloaks are pure Bug)",
    regionalFormsFor("burmy") === null);
  // The chip rule again: one refinement group per chip.
  const both = SLOT_SPECIES
    .filter((s) => invisibleSlotsFor(s) && (regionalFormsFor(s) || []).length > 0);
  check("invisible-slot catalog is disjoint from the form catalog", both.length === 0, JSON.stringify(both));
  const g = SLOT_SPECIES
    .filter((s) => invisibleSlotsFor(s) && genderSlotsFor(s));
  check("…and from the gender catalog", g.length === 0, JSON.stringify(g));

  // refinementAxisFor is the single lookup every chip surface now uses. It has
  // to agree with the three catalogs it replaced, and — because the catalogs
  // are disjoint — it can only ever name one axis per species.
  const cases = [
    ["wormadam", AXIS_FORM],
    ["meowth", AXIS_FORM],
    ["combee", AXIS_GENDER],
    ["meowstic", AXIS_GENDER],
    ["burmy", AXIS_SLOT],
    ["deerling", AXIS_SLOT],
    ["cherrim", AXIS_SLOT],
    ["basculin", AXIS_SLOT],
    ["charizard", null],
  ];
  const wrong = cases.filter(([sp, axis]) => (refinementAxisFor(sp)?.axis ?? null) !== axis);
  check("refinementAxisFor names the right axis per species", wrong.length === 0,
    JSON.stringify(wrong.map(([sp]) => [sp, refinementAxisFor(sp)?.axis ?? null])));
  check("the form axis carries the catalog keys",
    JSON.stringify(refinementAxisFor("wormadam").keys) === JSON.stringify(["cloak:plant", "cloak:sandy", "cloak:trash"]));
  check("the slot axis carries the slot keys and its label group",
    JSON.stringify(refinementAxisFor("burmy").keys) === '["male","plant","sandy","trash"]' &&
      refinementAxisFor("burmy").group === "burmy");
  // Only the slot axis is un-expressible in PoGo search — the flag the chips
  // read instead of re-deriving it from whichever catalog they happened to hit.
  check("only the slot axis is marked un-searchable",
    refinementAxisFor("wormadam").searchable === true &&
      refinementAxisFor("combee").searchable === true &&
      refinementAxisFor("burmy").searchable === false);
  // Completeness: gender needs the SLOT-closing genders, not merely both.
  check("a gender axis is complete only once every slot-closing gender is owned",
    !refinementComplete(refinementAxisFor("combee"), ["male"]) &&
      refinementComplete(refinementAxisFor("combee"), ["female"]) &&
      !refinementComplete(refinementAxisFor("meowstic"), ["female"]) &&
      refinementComplete(refinementAxisFor("meowstic"), ["female", "male"]));
  check("a slot axis is complete only once every slot is owned",
    !refinementComplete(refinementAxisFor("burmy"), ["plant", "sandy"]) &&
      refinementComplete(refinementAxisFor("burmy"), ["male", "plant", "sandy", "trash"]));
  // The wishlist gender lock is deliberately NOT gated on GENDER_SLOT_DEX: any
  // species can be asked for as ♀ or ♂, since PoGo's gender keyword is universal.
  check("the wishlist gender lock offers both genders for any species",
    GENDER_LOCK_AXIS.axis === AXIS_GENDER &&
      JSON.stringify(GENDER_LOCK_AXIS.keys) === '["female","male"]' &&
      refinementComplete(GENDER_LOCK_AXIS, ["female", "male"]));
}

console.log("\nScenario 22: incomplete slots withhold the exclusion entirely");
{
  const withSlots = (o) => cfgWith({ luckySlots: o });
  check("unannotated behaves exactly as before", plan([], ["deerling"]) === "!+deerling");
  check("2 of 4 seasons → NO exclusion, friend keeps seeing Sesokitz",
    plan([], ["deerling"], withSlots({ sesokitz: ["spring", "autumn"] })) === "",
    JSON.stringify(plan([], ["deerling"], withSlots({ sesokitz: ["spring", "autumn"] }))));
  check("all 4 seasons → the family is finally excluded",
    plan([], ["deerling"], withSlots({ sesokitz: ["spring", "summer", "autumn", "winter"] })) ===
      "!+deerling");
  check("Kinoso 1 of 2 withholds", plan([], ["cherrim"], withSlots({ kinoso: ["sunny"] })) === "");
  check("Kinoso both excludes",
    plan([], ["cherrim"], withSlots({ kinoso: ["sunny", "overcast"] })) === "!+cherrim");
  check("the hundo wishlist gates the same way",
    hundoPlan(["deerling"], cfgWith({ hundoSlots: { sesokitz: ["spring"] } })) === "");
  check("an unrelated species is untouched",
    plan([], ["charizard"], withSlots({ sesokitz: ["spring"] })) === "!+charizard");
  // Review catch: the withholding has to gate on the FAMILY, not the species
  // name. `!+X` expands to the whole candy family, so a second owned member
  // would otherwise re-hide the line whose slots are still incomplete.
  const s1 = withSlots({ sesokitz: ["spring"] });
  check("a same-family member does NOT re-emit the exclusion (Sesokitz + Kronjuwild)",
    plan([], ["deerling", "sawsbuck"], s1) === "",
    JSON.stringify(plan([], ["deerling", "sawsbuck"], s1)));
  check("…nor the other way round (annotate the evolution, own the base)",
    plan([], ["deerling", "sawsbuck"], withSlots({ kronjuwild: ["spring"] })) === "");
  check("Cherubi line: annotating Kinoso suppresses Kikugi too",
    plan([], ["cherrim", "cherubi"], withSlots({ kinoso: ["sunny"] })) === "");
  check("Burmy line: an incomplete Burmy suppresses Burmadame's exclusion",
    plan([], ["burmy", "wormadam"], withSlots({ burmy: ["male"] })) === "");
  // …and once every slot is filled the whole family excludes again, collapsed.
  const full = withSlots({ sesokitz: ["spring", "summer", "autumn", "winter"] });
  check("all slots filled → both family members exclude normally",
    plan([], ["deerling", "sawsbuck"], full) === "!+deerling&!+sawsbuck",
    plan([], ["deerling", "sawsbuck"], full));
  // A different family with incomplete slots must not bleed across.
  check("an incomplete Sesokitz does not suppress an unrelated Kinoso",
    plan([], ["cherrim"], withSlots({ sesokitz: ["spring"], kinoso: ["sunny", "overcast"] })) ===
      "!+cherrim");
}

console.log("\nScenario 23: season inference (pure, hemisphere-flipped)");
{
  // No feed window → falls back to meteorological month bands.
  const d = (m) => new Date(Date.UTC(2026, m, 15));
  check("northern July is summer", deerlingSeasonFor(d(6), "north", []) === "summer");
  check("southern July is winter", deerlingSeasonFor(d(6), "south", []) === "winter");
  check("northern January is winter", deerlingSeasonFor(d(0), "north", []) === "winter");
  check("southern January is summer", deerlingSeasonFor(d(0), "south", []) === "summer");
  check("northern April is spring", deerlingSeasonFor(d(3), "north", []) === "spring");
  check("southern October is spring", deerlingSeasonFor(d(9), "south", []) === "spring");
  check("no hemisphere → no guess", deerlingSeasonFor(d(6), null, []) === null);
  // Every month resolves, and the two hemispheres are always opposites.
  const opp = { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" };
  const allOk = Array.from({ length: 12 }, (_, m) => {
    const n = deerlingSeasonFor(d(m), "north", []);
    const s = deerlingSeasonFor(d(m), "south", []);
    return n && s && opp[n] === s;
  }).every(Boolean);
  check("all 12 months resolve and the hemispheres stay opposite", allOk);
  // A live Season window overrides the month band via its MIDPOINT, which is
  // the point of reading the feed at all.
  const pools = [{ category: "Season", title: "Forever Forward", start: "2026-06-02T10:00:00", end: "2026-09-08T10:00:00" }];
  check("a Season window drives the label from its midpoint (early Jun → summer)",
    deerlingSeasonFor(new Date(Date.UTC(2026, 5, 3)), "north", pools) === "summer",
    deerlingSeasonFor(new Date(Date.UTC(2026, 5, 3)), "north", pools));
  check("outside the window it falls back to the month band",
    deerlingSeasonFor(new Date(Date.UTC(2026, 0, 15)), "north", pools) === "winter");
  check("currentSeasonWindow finds the covering window",
    currentSeasonWindow(new Date(Date.UTC(2026, 6, 1)), pools)?.title === "Forever Forward");
  check("currentSeasonWindow returns null outside any window",
    currentSeasonWindow(new Date(Date.UTC(2026, 0, 1)), pools) === null);
}

console.log("\nScenario 24: an unfinished sibling only blocks the guards that could hide it");
{
  const withSlots = (o) => cfgWith({ luckySlots: o });
  // The reported bug: a lucky Burmadame annotated to the plant cloak stopped
  // being excluded the moment Burmy carried a half-ticked slot group, so the
  // friend kept being asked for the very cloak the user already had. The plain
  // `!+burmadame` deserves the withholding (it swallows the whole candy family,
  // Burmy included); `!+burmadame,!grass` does not — every Burmy slot is pure
  // Bug and walks straight through a grass guard.
  const plant = { burmadame: ["cloak:plant"] };
  check("a plant-cloak lucky still excludes while Burmy is unfinished",
    plan([], ["wormadam"], cfgWith({ luckyForms: plant, luckySlots: { burmy: ["male"] } })) ===
      "!+wormadam,!grass",
    plan([], ["wormadam"], cfgWith({ luckyForms: plant, luckySlots: { burmy: ["male"] } })));
  check("…and a stale slot annotation on an unlisted Burmy no longer kills it either",
    plan([], ["wormadam"], cfgWith({ luckyForms: plant, luckySlots: { burmy: ["plant"] } })) ===
      "!+wormadam,!grass");
  check("Burmy's OWN exclusion stays withheld — the friend keeps being asked for it",
    plan([], ["wormadam", "burmy"], cfgWith({ luckyForms: plant, luckySlots: { burmy: ["male"] } })) ===
      "!+wormadam,!grass",
    plan([], ["wormadam", "burmy"], cfgWith({ luckyForms: plant, luckySlots: { burmy: ["male"] } })));
  check("the sandy and trash cloaks are equally safe (ground / steel, not bug)",
    plan([], ["wormadam"], cfgWith({
      luckyForms: { burmadame: ["cloak:sandy", "cloak:trash"] },
      luckySlots: { burmy: ["male"] },
    })) === "!+wormadam,!ground&!+wormadam,!steel");
  // The guard-rail: no form scoping means the blunt family clause, which still
  // has to be withheld. Owning every cloak collapses to exactly that clause.
  check("an UNannotated Burmadame is still withheld (Scenario 22 unchanged)",
    plan([], ["wormadam"], withSlots({ burmy: ["male"] })) === "");
  check("owning all three cloaks collapses to `!+family` — withheld again",
    plan([], ["wormadam"], cfgWith({
      luckyForms: { burmadame: ["cloak:plant", "cloak:sandy", "cloak:trash"] },
      luckySlots: { burmy: ["male"] },
    })) === "");
  check("a COMPLETE Burmy blocks nothing at all",
    plan([], ["wormadam"], cfgWith({
      luckyForms: plant,
      luckySlots: { burmy: ["male", "plant", "sandy", "trash"] },
    })) === "!+wormadam,!grass");
  check("the hundo wishlist behaves identically",
    hundoPlan(["wormadam"], cfgWith({ hundoForms: plant, hundoSlots: { burmy: ["male"] } })) ===
      "!+wormadam,!grass");
  check("an unrelated unfinished line never reaches Burmadame",
    plan([], ["wormadam"], cfgWith({ luckyForms: plant, luckySlots: { sesokitz: ["spring"] } })) ===
      "!+wormadam,!grass");
  check("…nor does an unfinished Burmy reach an unrelated form-scoped lucky",
    plan([], ["vulpix"], cfgWith({ luckyForms: { vulpix: ["alola"] }, luckySlots: { burmy: ["male"] } })) ===
      "!+vulpix,!ice");
}

console.log("\nScenario 25: formGuardHides — the type proof behind Scenario 24");
{
  check("a grass guard cannot reach a pure-Bug Burmy",
    formGuardHides({ include: ["grass"], exclude: [] }, ["bug"]) === false);
  check("a grass guard DOES reach a Normal/Grass Sesokitz",
    formGuardHides({ include: ["grass"], exclude: [] }, ["normal", "grass"]) === true);
  check("every include type must be present",
    formGuardHides({ include: ["grass", "flying"], exclude: [] }, ["normal", "grass"]) === false);
  check("an exclude type present lets the species through",
    formGuardHides({ include: ["grass"], exclude: ["normal"] }, ["normal", "grass"]) === false);
  check("unknown types answer 'hidden' — over-exclusion is the failure to avoid",
    formGuardHides({ include: ["grass"], exclude: [] }, []) === true &&
      formGuardHides({ include: ["grass"], exclude: [] }, undefined) === true);
  // Every catalog entry has to carry the types the proof runs on, or the check
  // above silently degrades to "hidden" and the withholding goes back to blunt.
  const missing = SLOT_SPECIES.filter((s) => !(invisibleSlotsFor(s)?.types?.length > 0));
  check("every invisible-slot species declares its type combination", missing.length === 0,
    JSON.stringify(missing));
}

console.log(`\n${failures === 0 ? "✓ All lucky-logic checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
