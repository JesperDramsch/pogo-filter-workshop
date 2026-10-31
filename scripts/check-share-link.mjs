// Verifies wish-list share links (src/share-link.js) end to end: a sender's
// curated friend-collect list goes through buildFilters, into a #wish/ link,
// out of the receiver's parser, onto a trade buddy, and back through
// buildFilters as that buddy's "catch for" filter.
//
//   S1 — the link carries exactly what the sender's own string still asks for
//   S2 — round trip: species, gender and form refinements survive, by dex key
//   S3 — locale independence: a German sender, an English receiver
//   S4 — a second link from the same sender updates, never duplicates
//   S5 — a hand-made buddy with the same name is adopted, not doubled
//   S6 — junk links are refused with a code, never a throw
//   S7 — the receiver's buddy really emits a catch filter for the wish
//
// Run with: npm run test:sharelink  (or npx vite-node scripts/check-share-link.mjs)

import { buildFilters, DEFAULT_CONFIG, normalizeBuddyTarget } from "../src/App.jsx";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import {
  wishTargetsFromConfig,
  wishLinkFor,
  encodeWishToken,
  parseWishHash,
  applyWishToBuddies,
  cleanShareName,
  WISH_HASH_PREFIX,
  WISH_MAX_TOKEN,
} from "../src/share-link.js";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const hashOf = (link) => link.slice(link.indexOf("#"));
const segs = (f) => f.split("&");

// ── Sender: four curated targets, one of them already covered by a lucky ──
const sender = {
  ...DEFAULT_CONFIG,
  friendCollectSpecies: ["wadribie", "vulpix", "pikachu", "mauzi"],
  friendCollectGenders: { wadribie: "female" },
  friendCollectDropForms: { vulpix: ["base"] },
  friendCollectMode: "lucky",
};
const senderLuckies = ["mauzi"];
const senderRes = buildFilters([], senderLuckies, sender, [], "de");
const targets = wishTargetsFromConfig(sender, senderRes.friendCollectTargets);

console.log("S1 — the link carries what the sender still asks for");
const sentKeys = targets.map((t) => t.s);
check("three targets travel (the covered Mauzi stays home)", targets.length === 3, JSON.stringify(sentKeys));
check("Mauzi (52) is not sent", !sentKeys.includes("52"));
check("every sent species is in the sender's own string",
  ["wadribie", "vulpix", "pikachu"].every((sp) => segs(senderRes.friendCollectWishlist)[0].split(",").includes(sp)),
  senderRes.friendCollectWishlist.slice(0, 80));
const forcedCfg = { ...sender, friendCollectForced: ["mauzi"] };
const forcedTargets = wishTargetsFromConfig(forcedCfg, buildFilters([], senderLuckies, forcedCfg, [], "de").friendCollectTargets);
check("a forced target travels although it is covered", forcedTargets.some((t) => t.s === "52"));
check("no lucky/hundo goal in the payload", targets.every((t) => Object.keys(t).every((k) => ["s", "g", "f", "l"].includes(k))));

console.log("S2 — round trip");
const link = wishLinkFor({ id: "sender-1", name: "Jürgen ユウキ", targets }, "https://example.test/app/");
check("link uses the #wish/ hash", link.startsWith(`https://example.test/app/${WISH_HASH_PREFIX}`));
const parsed = parseWishHash(hashOf(link));
check("parses", parsed.ok, parsed.code);
const wish = parsed.wish;
check("non-Latin name survives", wish?.name === "Jürgen ユウキ", wish?.name);
check("sender id survives", wish?.id === "sender-1");
const bySpecies = Object.fromEntries((wish?.targets || []).map((t) => [t.species, t]));
check("species come back canonical", ["wadribie", "vulpix", "pikachu"].every((s) => s in bySpecies), Object.keys(bySpecies).join(","));
check("gender lock survives", bySpecies.wadribie?.gender === "female");
check("dropped form survives", JSON.stringify(bySpecies.vulpix?.dropForms) === '["base"]');
check("unrefined target stays plain", bySpecies.pikachu?.gender === "any" && bySpecies.pikachu?.dropForms.length === 0);
const rawToken = hashOf(link).slice(WISH_HASH_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
const rawJson = new TextDecoder().decode(Uint8Array.from(atob(rawToken.padEnd(Math.ceil(rawToken.length / 4) * 4, "=")), (c) => c.charCodeAt(0)));
check("payload names no species in any locale", !/wadribie|combee|vulpix|pikachu/i.test(rawJson), rawJson);

console.log("S3 + S7 — an English receiver gets a working catch filter");
const applied = applyWishToBuddies([], wish, normalizeBuddyTarget, 1700000000000);
check("one buddy created", applied.created && applied.buddies.length === 1);
const buddy = applied.buddies[0];
check("buddy carries the sender id", buddy.shareId === "sender-1");
check("buddy tag prefix from the name", buddy.tagPrefix === "Trade-Jürgenユウキ", buddy.tagPrefix);
const receiver = { ...DEFAULT_CONFIG, buddies: applied.buddies };
const recRes = buildFilters([], [], receiver, [], "en");
const catchLine = recRes.buddyCatchFilters[0]?.filter || "";
check("one catch filter for the buddy", recRes.buddyCatchFilters.length === 1);
check("species named in the receiver's locale", ["combee", "vulpix", "pikachu"].every((s) => segs(catchLine)[0].split(",").includes(s)), catchLine.slice(0, 80));
const en = pogoKeywords("en");
check("female-only guard rides along", segs(catchLine).includes(`!combee,${en.flag.female}`), catchLine);
check("Alolan-only Vulpix guard rides along", segs(catchLine).some((s) => s.startsWith("!vulpix,")), catchLine);

console.log("S4 — a second link updates the same buddy");
const later = wishTargetsFromConfig(sender, buildFilters([], ["mauzi", "pikachu"], sender, [], "de").friendCollectTargets);
const second = parseWishHash(hashOf(wishLinkFor({ id: "sender-1", name: "Jürgen", targets: later }, "/")));
const customised = applied.buddies.map((b) => ({ ...b, tagPrefix: "Trade-J", rawAppend: "cp-1500", wantsTradeEvos: true, active: false }));
const updated = applyWishToBuddies(customised, second.wish, normalizeBuddyTarget);
check("no new buddy", !updated.created && updated.buddies.length === 1);
check("Pikachu dropped off after the lucky landed", !updated.buddies[0].targetSpecies.some((t) => t.species === "pikachu"),
  updated.buddies[0].targetSpecies.map((t) => t.species).join(","));
check("receiver's tag prefix, raw append and trade-evo toggle kept",
  updated.buddies[0].tagPrefix === "Trade-J" && updated.buddies[0].rawAppend === "cp-1500" && updated.buddies[0].wantsTradeEvos === true);
check("the receiver's name for the buddy is kept", updated.buddies[0].name === "Jürgen ユウキ");
check("an inactive buddy is switched back on", updated.buddies[0].active === true);
const other = parseWishHash(hashOf(wishLinkFor({ id: "sender-2", name: "Jürgen ユウキ", targets }, "/")));
const sameName = applyWishToBuddies(applied.buddies, other.wish, normalizeBuddyTarget);
check("a different sender with the same name gets their own buddy", sameName.created === true && sameName.buddies.length === 2);
check("and their own tag prefix", sameName.buddies[1].tagPrefix === "Trade-Jürgenユウキ2", sameName.buddies[1].tagPrefix);

console.log("S5 — a hand-made buddy is adopted");
const handMade = [{ id: "auri-1", name: "Auri", tagPrefix: "Trade-Auri", targetSpecies: [], wantsTradeEvos: false, rawAppend: "", active: true }];
const auri = parseWishHash(hashOf(wishLinkFor({ id: "auri-id", name: "auri", targets }, "/")));
const adopted = applyWishToBuddies(handMade, auri.wish, normalizeBuddyTarget);
check("same-name buddy updated in place", !adopted.created && adopted.buddies.length === 1 && adopted.buddyId === "auri-1");
check("and remembers the sender from now on", adopted.buddies[0].shareId === "auri-id");

console.log("S6 — junk links are refused");
const tok = (obj) => `${WISH_HASH_PREFIX}${btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
const cases = [
  ["not a wish hash", "#workshop/trade", "not_wish"],
  ["not base64", `${WISH_HASH_PREFIX}%%%`, "garbled"],
  ["base64 but not JSON", `${WISH_HASH_PREFIX}bm90IGpzb24`, "garbled"],
  ["future version", tok({ v: 2, n: "A", t: [{ s: "25" }] }), "unsupported_version"],
  ["no name", tok({ v: 1, n: "   ", t: [{ s: "25" }] }), "no_name"],
  ["targets not a list", tok({ v: 1, n: "A", t: "25" }), "garbled"],
  ["only unknown species", tok({ v: 1, n: "A", t: [{ s: "99999" }, { s: "pikachu" }, null, 7] }), "empty"],
  ["too long", `${WISH_HASH_PREFIX}${"A".repeat(WISH_MAX_TOKEN + 1)}`, "too_long"],
];
for (const [label, hash, code] of cases) {
  let r;
  try { r = parseWishHash(hash); } catch (e) { r = { ok: false, code: `threw ${e.message}` }; }
  check(label, !r.ok && r.code === code, r.code);
}
const mixed = parseWishHash(tok({ v: 1, n: "A", t: [{ s: "25" }, { s: "nope" }, { s: "25" }] }));
check("unknown entries counted, duplicates folded", mixed.ok && mixed.wish.targets.length === 1 && mixed.wish.unresolved === 1);
const bogusForm = parseWishHash(tok({ v: 1, n: "A", t: [{ s: "37", f: ["atlantis"] }] }));
check("form keys the catalog lacks are dropped by normalizeBuddyTarget",
  normalizeBuddyTarget(bogusForm.wish.targets[0]).dropForms.length === 0);
check("control and bidi characters stripped from names", cleanShareName("A‮b\u0007c\n d") === "Abc d");
check("oversized id ignored, link still works", parseWishHash(tok({ v: 1, id: "x".repeat(200), n: "A", t: [{ s: "25" }] })).wish.id === null);
check("encoder is deterministic", encodeWishToken({ id: "a", name: "B", targets }) === encodeWishToken({ id: "a", name: "B", targets }));

console.log(`\n${failures === 0 ? "✓ All share-link tests passed." : `✗ ${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
