// Offline checks for the event-bonus nudges: the classifier and window logic
// in src/bonus-nudges.js, the fetcher's `bonuses` array and the strip's copy.
// Run with: npm run test:bonusnudges
//
//   B1 — every phrasing below, copied from the Leek Duck feed on 2026-10-31,
//        classifies as pinned: kind and factor/count, or known-ignored. A
//        regex edit that breaks one fails here before a sync goes quiet.
//   B2 — nudge-shaped lines that must NOT nudge: a paid tier, one species'
//        catch bonus, a Max Battle line that reads like a raid or catch line
//   B3 — an unknown phrasing is reported (what the fetcher logs), and only it;
//        the snapshot's own unknowns are printed, not failed (see B3)
//   B4 — window: live and starting-soon bonuses show, ended and far-off ones
//        do not, a Season-length window never does
//   B5 — back-to-back windows of one bonus merge (Halloween Part I → Part II),
//        one nudge per kind, live before upcoming
//   B6 — bonusesFromFeed: every category, spawns or not, inside the window,
//        deduped; the committed snapshot carries the array
//   B7 — every kind has a target the app renders and copy in all seven
//        locales with its placeholders; no raw English bonus reaches the copy

import { readFileSync } from "node:fs";
import { createChecker } from "./lib/check.mjs";
import { BONUS_KINDS, bonusNudges, classifyBonus, NUDGE_LOOKAHEAD_DAYS, NUDGE_MAX_SPAN_DAYS, unrecognisedBonuses } from "../src/bonus-nudges.js";
import { bonusesFromFeed } from "./fetch-events.mjs";
import EVENTS from "../src/data/events.json";

const { check, done } = createChecker();
const DAY = 86400000;

// ── B1 ──
console.log("B1 — real feed phrasings (2026-10-31)");
const PINNED = [
  ["1/2 Stardust cost for trades", "trade_stardust", { factor: "½" }],
  ["Trades made will require 50% less Stardust*", "trade_stardust", { factor: "½" }],
  ["Up to 6 Special Trades per day", "special_trades", { count: 6 }],
  ["One additional Special Trade can be made for a maximum of two for the day*", "special_trades", { count: 2 }],
  ["One additional Candy for trading Pokémon", "trade_candy"],
  ["Trainers level 31 and above will receive one guaranteed Candy XL when trading Pokémon", "trade_candy"],
  ["One guaranteed Candy XL when trading Pokémon for Trainers level 31 and above", "trade_candy"],
  ["2× Candy for catching Pokémon", "catch_candy", { factor: "2×" }],
  ["2x Catch Candy", "catch_candy", { factor: "2×" }],
  ["2x Chance for Trainers level 31 and up to receive Candy XL from catching Pokémon", "catch_xl"],
  ["2× Stardust for catching Pokémon", "catch_stardust", { factor: "2×" }],
  ["2× Catch Stardust", "catch_stardust", { factor: "2×" }],
  ["1/2 Hatch Distance for Eggs placed in Incubators during the event", "hatch_distance", { factor: "½" }],
  ["1/4 Egg Hatch Distance", "hatch_distance", { factor: "¼" }],
  ["3× Hatch Candy", "hatch_rewards"],
  ["3× Hatch Stardust", "hatch_rewards"],
  ["Increased XP and Stardust from hatching Eggs", "hatch_rewards"],
  ["3/4 Max Particle cost for unlocking and powering up Max Moves", "max_particles"],
  ["Increased Max Particles from Power Spots and exploration", "max_particles"],
  ["Daily Max Particle collection limit increased to 8,000", "max_particles"],
  ["Max Particle collection limit increased to 2,400", "max_particles"],
  ["8× Max Particles from Power Spots", "max_particles"],
  ["Power Spots will refresh more frequently", "max_particles"],
  ["1 additional Candy for catching Pokémon in Max Battles", "max_bonus"],
  ["1 additional Candy XL for catching Pokémon in Max Battles (level 31+)", "max_bonus"],
  ["+1 Candy XL from Max Battles (Trainers level 31+)", "max_bonus"],
  ["Additional Candy and Candy XL from Max Battles", "max_bonus"],
  ["2× XP from completed Max Battles", "max_bonus"],
  ["5,000 additional XP from completed raids", "raid_bonus"],
  ["6 additional Candy for catching Pokémon in raids", "raid_bonus"],
  ["+1 Candy from raids", "raid_bonus"],
  ["Up to 10 free Raid Passes per day from Gyms", "raid_bonus"],
  ["Receive up to six free Raid Passes from spinning Gym Photo Discs", "raid_bonus"],
  ["Remote Raid limit increased to 30 from Monday, November 9, to Friday, November 13, 2026", "raid_bonus"],
  ["An additional 5,000 Stardust from Super Mega Raid Battles", "raid_bonus"],
  ["Increased chance to get Rare Candy XL from Raid Battles", "raid_bonus"],
];
for (const [text, kind, params = {}] of PINNED) {
  const c = classifyBonus(text);
  const ok = c && c.kind === kind && Object.entries(params).every(([k, v]) => c[k] === v);
  check(`"${text}" → ${kind}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ""}`, ok, JSON.stringify(c));
}
const IGNORED = [
  "Increased chance to encounter Shiny Pokémon",
  "2× Daily Adventure Incense duration",
  "Lure Modules last for 2 hours",
  "Open up to 50 Gifts per day",
  "3 GO Snapshot surprise encounters per day",
  "Party Play lasts for 8 hours",
  "Increased chance of 10 km Eggs from PokéStops and Gyms",
  "Chance to encounter mighty Pokémon on Routes",
  "Trainers can receive special event stickers from PokéStops and Gifts",
];
for (const text of IGNORED) check(`"${text}" is known and not a nudge`, classifyBonus(text)?.ignored === true, JSON.stringify(classifyBonus(text)));

// ── B2 ──
console.log("\nB2 — nudge-shaped lines that must not nudge");
check("GO Pass Deluxe 3× catch Candy is a paid tier, ignored", classifyBonus("GO Pass Deluxe: 3× Candy for catching Pokémon")?.ignored === true);
check("GO Pass Deluxe 3× catch Stardust is a paid tier, ignored", classifyBonus("GO Pass Deluxe: 3× Stardust for catching Pokémon")?.ignored === true);
check("one species' Stardust bonus is not a catch-Stardust nudge", classifyBonus("Increased Stardust for catching Minior")?.ignored === true);
check("the Dynamax Cannon's half cost is not a trade-Stardust nudge", classifyBonus("1/2 Candy and Stardust cost to activate the Dynamax Cannon Adventure Effect")?.ignored === true);
check("a shiny raid boss is not a raid nudge", classifyBonus("Increased chance of encountering Shiny Chandelure from Super Mega Raids")?.ignored === true);
check("Max Battle catch Candy reads as Max Battles, not catch Candy", classifyBonus("1 additional Candy for catching Pokémon in Max Battles")?.kind === "max_bonus");
check("empty input is unrecognised, not a crash", classifyBonus("") === null && classifyBonus(undefined) === null);

// ── B3 ──
console.log("\nB3 — unrecognised phrasings are reported");
{
  const unknown = unrecognisedBonuses([
    { bonuses: ["1/2 Stardust cost for trades", "Lure Modules last for 2 hours", "Triple the Moon Stones from Research"] },
    { bonuses: ["Triple the Moon Stones from Research"] },
  ]);
  check("only the new phrasing is reported, once", JSON.stringify(unknown) === JSON.stringify(["Triple the Moon Stones from Research"]), JSON.stringify(unknown));
  // Deliberately not a failure for the snapshot: a new Leek Duck phrasing is
  // logged by the fetcher and must not block the daily data sync. Shown here
  // so a local run still surfaces it.
  const fresh = unrecognisedBonuses(EVENTS.bonuses);
  if (fresh.length) console.log(`  ℹ snapshot phrasings with no nudge yet: ${fresh.join(" · ")}`);
}

// ── B4 ──
console.log("\nB4 — window and expiry");
const now = Date.parse("2026-10-31T12:00:00");
const at = (d) => new Date(now + d * DAY).toISOString().slice(0, 19);
const rec = (id, startD, endD, bonuses) => ({ id, title: id, start: at(startD), end: at(endD), bonuses });
{
  const kinds = (recs, t = now) => bonusNudges(recs, t).map((n) => n.kind).sort().join();
  check("a live bonus shows", kinds([rec("live", -1, 2, ["1/2 Stardust cost for trades"])]) === "trade_stardust");
  check("an ended bonus does not", kinds([rec("over", -3, -1, ["1/2 Stardust cost for trades"])]) === "");
  check(`one starting within ${NUDGE_LOOKAHEAD_DAYS} days shows as upcoming`, (() => {
    const [n] = bonusNudges([rec("soon", 1, 2, ["2× Candy for catching Pokémon"])], now);
    return n && n.live === false && n.start === Date.parse(at(1));
  })());
  check("one starting later does not", kinds([rec("far", NUDGE_LOOKAHEAD_DAYS + 1, NUDGE_LOOKAHEAD_DAYS + 2, ["2× Candy for catching Pokémon"])]) === "");
  check(`a window longer than ${NUDGE_MAX_SPAN_DAYS} days (a Season) never nudges`, kinds([rec("season", -30, 30, ["One additional Candy for trading Pokémon"])]) === "");
  check("the same record expires at its end", kinds([rec("x", -1, 0.5, ["1/4 Egg Hatch Distance"])], now + 0.6 * DAY) === "");
  check("ignored and unknown lines make no nudge", kinds([rec("x", -1, 1, ["Lure Modules last for 2 hours", "Something new"])]) === "");
  check("a record with no parseable window is skipped", kinds([{ id: "bad", start: "1794333600", end: "1794349800", bonuses: ["1/2 Stardust cost for trades"] }]) === "");
}

// ── B5 ──
console.log("\nB5 — merging and ordering");
{
  const nudges = bonusNudges([
    rec("part1", -4, 1, ["2× Candy for catching Pokémon", "2× Stardust for catching Pokémon"]),
    rec("part2", 1, 5, ["2× Candy for catching Pokémon", "2× Stardust for catching Pokémon"]),
    rec("cday", 1.5, 1.6, ["1/2 Stardust cost for trades", "2x Catch Candy"]),
  ], now);
  const candy = nudges.find((n) => n.kind === "catch_candy");
  check("Part I then Part II merge: catch Candy runs until Part II's end", candy && candy.end === Date.parse(at(5)), candy && new Date(candy.end).toISOString());
  check("the merged nudge names every event it spans", candy && ["part1", "part2", "cday"].every((id) => candy.sources.includes(id)), candy?.sources.join());
  check("the Community Day's 2× catch Candy inside it adds no second row", nudges.filter((n) => n.kind === "catch_candy").length === 1);
  check("live nudges come before upcoming ones", nudges.map((n) => n.live).join() === "true,true,false", nudges.map((n) => `${n.kind}:${n.live}`).join());
  check("each nudge carries its target", nudges.every((n) => n.area === BONUS_KINDS[n.kind].area && n.group === BONUS_KINDS[n.kind].group));
  const both = bonusNudges([rec("a", -1, 1, ["Up to 6 Special Trades per day"]), rec("b", -1, 3, ["One additional Special Trade can be made for a maximum of two for the day*"])], now);
  check("two values of one kind at once: one row, the one ending last", both.length === 1 && both[0].count === 2, JSON.stringify(both.map((n) => n.count)));
}

// ── B6 ──
console.log("\nB6 — the fetcher's bonuses array");
{
  const ev = (title, startD, endD, bonuses, extra = {}) => ({ title, start_time: at(startD), end_time: at(endD), is_local_time: true, details: { bonuses, ...extra } });
  const feed = {
    Season: [ev("Twilight Trails", -50, 30, ["One additional Candy for trading Pokémon"])],
    "GO Pass": [ev("GO Pass: November", 3, 30, ["Open up to 50 Gifts per day"])],
    Event: [
      ev("Halloween", -4, 1, ["2× Candy for catching Pokémon", "2×  Candy for catching Pokémon"], { spawns: ["Zubat"] }),
      ev("Far away", 40, 45, ["1/2 Stardust cost for trades"]),
      ev("Long gone", -30, -20, ["1/2 Stardust cost for trades"]),
      ev("No bonuses", -1, 1, []),
    ],
    "Pokémon Spotlight Hour": [ev("Spotlight", -0.1, 0.1, ["2× Transfer Candy"])],
  };
  const out = bonusesFromFeed(feed, now);
  const titles = out.map((r) => r.title).sort().join();
  check("every category is read, spawn list or not (Season, GO Pass, Spotlight)", titles === "GO Pass: November,Halloween,Spotlight,Twilight Trails", titles);
  check("events outside the window are left out", !out.some((r) => r.title === "Far away" || r.title === "Long gone"));
  const hw = out.find((r) => r.title === "Halloween");
  check("bonus strings are kept, whitespace-normalised and deduped", hw && JSON.stringify(hw.bonuses) === JSON.stringify(["2× Candy for catching Pokémon"]), JSON.stringify(hw?.bonuses));
  check("records carry id, category, start, end and isLocalTime", hw && hw.id && hw.category === "Event" && hw.start && hw.end && hw.isLocalTime === true);
  check("the committed snapshot has a bonuses array", Array.isArray(EVENTS.bonuses) && EVENTS.bonuses.length > 0, String(EVENTS.bonuses?.length));
  check("every snapshot record has the documented shape", (EVENTS.bonuses || []).every((r) => r.id && r.title && r.category && r.start && r.end && typeof r.isLocalTime === "boolean" && Array.isArray(r.bonuses) && r.bonuses.length > 0));
}

// ── B7 ──
console.log("\nB7 — targets and copy in every locale");
{
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  for (const [kind, { area, group }] of Object.entries(BONUS_KINDS)) {
    const rendered = new RegExp(`AreaGroup id='${group}'`).test(app);
    check(`${kind} → ${area}/${group}: the group exists in App.jsx`, rendered);
    check(`${kind}: its area is one of the filter areas`, ["catch", "sort", "battle", "trade"].includes(area));
  }
  const LOCALES = ["en", "de", "es", "fr", "zh-TW", "hi", "ja"];
  const PLACEHOLDER = { trade_stardust: "{factor}", catch_candy: "{factor}", catch_stardust: "{factor}", hatch_distance: "{factor}", special_trades: "{count}" };
  const english = JSON.parse(readFileSync(new URL("../src/locales/app/en.json", import.meta.url), "utf8"));
  for (const loc of LOCALES) {
    const b = JSON.parse(readFileSync(new URL(`../src/locales/app/${loc}.json`, import.meta.url), "utf8"));
    const missing = [];
    for (const kind of Object.keys(BONUS_KINDS)) {
      const v = b[`app.events.bonus.kind.${kind}`];
      if (!v || (PLACEHOLDER[kind] && !v.includes(PLACEHOLDER[kind]))) missing.push(kind);
    }
    for (const group of new Set(Object.values(BONUS_KINDS).map((k) => k.group))) {
      if (!b[`app.events.bonus.target.${group.replace("-", "_")}`]) missing.push(`target.${group}`);
    }
    for (const [k, ph] of [["until", "{date}"], ["from", "{date}"], ["go_aria", "{bonus}"], ["go_aria", "{when}"], ["go_aria", "{target}"]]) {
      if (!b[`app.events.bonus.${k}`]?.includes(ph)) missing.push(`${k} ${ph}`);
    }
    check(`${loc}: every kind, target and frame string present with placeholders`, missing.length === 0, missing.join(", "));
    if (loc !== "en") {
      const copied = Object.keys(BONUS_KINDS).filter((k) => b[`app.events.bonus.kind.${k}`] === english[`app.events.bonus.kind.${k}`]);
      check(`${loc}: no kind copy is left in English`, copied.length === 0, copied.join(", "));
    }
  }
  const strip = app.slice(app.indexOf("function BonusNudges"), app.indexOf("// A key per boss in one list"));
  check("the strip renders translated kind copy, never the feed's bonus text", /app\.events\.bonus\.kind\./.test(strip) && !/\.bonuses\b/.test(strip) && !/sources/.test(strip));
}

done("All bonus-nudge checks passed.", (n) => `${n} bonus-nudge check(s) failed.`);
