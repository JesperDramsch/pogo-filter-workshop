import { buildFilters, DEFAULT_CONFIG, prepareImport, validateImportEnvelope, SCHEMA_CURRENT } from "../src/App.jsx";

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

console.log(`\n${failures === 0 ? "✓ All lucky-logic checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
