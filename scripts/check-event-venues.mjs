// Offline checks for in-person event venues: the pinned table in
// scripts/lib/event-venues.mjs, the `venue` every events.json record carries,
// and the home-pin gate on the nudge strip and the event card.
// Run with: npm run test:eventvenues
//
// The feed does not say where a city Wild Area, GO Tour, Night Out or City
// Safari is held; the title does, and the table reads it. Like the feed-time
// check, nothing here can see a live feed in CI, so the titles below are the
// feed's own on 2026-11-01 and the snapshot's City Safari title.
//
//   V1 — the table: every live in-person title maps to its city, a global
//        edition, a GBL rotation and the Season map to nothing, the
//        coordinates are on the map, each city has one row
//   V2 — venueOf: a mapped event gets its venue, an unmapped fixed-time one
//        gets null and a report, an unmapped local-time one null and silence
//   V3 — the fetcher's passes: events, eggPools and bonuses carry `venue`;
//        an unmapped fixed-time event keeps its spawns and eggs, gets no
//        bonus record and is reported once per pass; a GBL rotation reaches
//        no record and no report
//   V4 — distance and reach: Bonn to Sendai rounds to 9,100 km, a pin in the
//        city and a day trip away are near, London from Bonn is not, no pin is
//        never near
//   V5 — bonusNudges with a home pin near and far from the venue, with none,
//        a venueless fixed-time record, a City Safari spelt as local time,
//        and a global event that nudges regardless
//   V6 — the committed snapshot's records have a well-formed `venue` where
//        they carry one, and every fixed-time record carries one
//   V7 — the card's copy in all seven locales with its placeholders, and the
//        app reads the home pin where it builds the nudges
//   V8 — the Mega planner's wild rows carry the venue through

import { readFileSync } from "node:fs";
import { createChecker } from "./lib/check.mjs";
import { EVENT_VENUES, venueFor, venueOf, isFixedTimeEvent } from "./lib/event-venues.mjs";
import { bonusesFromFeed, buildNameIndex, eggPoolsFromFeed, eventsFromFeed } from "./fetch-events.mjs";
import { bonusAppliesAtHome, bonusNudges, distanceKm, roundDistanceKm, venueReach, VENUE_RADIUS_KM } from "../src/bonus-nudges.js";
import { megaPlans } from "../src/mega-boost.js";
import EVENTS from "../src/data/events.json";
import NAMES from "../src/locales/pokemon-names.json";

const { check, done } = createChecker();

// The live feed's fixed-time titles on 2026-11-01 (GBL rotations included)
// and the snapshot's City Safari, with the city each must map to.
const LIVE = [
  ["Pokémon GO Wild Area 2026: Sendai • Tohoku", "Sendai"],
  ["Pokémon GO Wild Area 2026: Mexico City", "Mexico City"],
  ["Pokémon Night Out 2026 - London", "London"],
  ["Pokémon GO Tour: Alola - Kaohsiung 2027", "Kaohsiung"],
  ["Pokémon GO Tour: Alola - Los Angeles 2027", "Los Angeles"],
  ["Pokémon GO City Safari: Boston (Rescheduled)", "Boston"],
];
const NOWHERE = [
  "Pokémon GO Wild Area 2026: Global",
  "Pokémon GO Fest 2026: Global",
  "Pokémon GO Fest 2026: Mega Finale",
  "Master League and Mega Halloween Cup: Great League Edition | Twilight Trails",
  "Great League, Ultra League: Mega Edition, and 2026 GO LAIC Cup | Twilight Trails",
  "Twilight Trails",
  "Pokémon GO Halloween 2026 Part II",
];

// Home pins, [lng, lat] as the map stores them.
const BONN = [7.1, 50.73];
const SENDAI_PIN = [140.87, 38.27];
const YAMAGATA = [140.34, 38.25]; // 46 km from Sendai: a day trip
const LONDON_PIN = [-0.13, 51.51];

console.log("V1 — the pinned table");
{
  for (const [title, city] of LIVE) {
    const v = venueFor(title);
    check(`"${title}" → ${city}`, v?.name === city, JSON.stringify(v));
  }
  for (const title of NOWHERE) check(`"${title}" names no venue`, venueFor(title) === null, JSON.stringify(venueFor(title)));
  check("every row has a name, a RegExp and coordinates on the map",
    EVENT_VENUES.every((r) => r.name && r.match instanceof RegExp && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180));
  const names = EVENT_VENUES.map((r) => r.name);
  check("one row per city", new Set(names).size === names.length, names.join());
  check("every row is reached by one of the live titles (no dead rows)",
    names.every((n) => LIVE.some(([, city]) => city === n)), names.filter((n) => !LIVE.some(([, c]) => c === n)).join());
  const v = venueFor(LIVE[0][0]);
  v.lat = 0;
  check("venueFor hands out a copy, never the table's own row", venueFor(LIVE[0][0]).lat !== 0);
  check("venueFor survives a missing title", venueFor(undefined) === null && venueFor(null) === null);
}

console.log("\nV2 — venueOf");
{
  const ev = (title, is_local_time) => ({ title, is_local_time, start_time: 1793926800, end_time: 1794128400 });
  const reported = [];
  const report = (e, category) => reported.push(`${category}|${e.title}`);
  const sendai = venueOf(ev("Pokémon GO Wild Area 2026: Sendai • Tohoku", false), "Wild Area", report);
  check("a mapped fixed-time event gets its venue and no report", sendai?.name === "Sendai" && reported.length === 0);
  const none = venueOf(ev("Pokémon GO Wild Area 2026: Atlantis", false), "Wild Area", report);
  check("an unmapped fixed-time event gets null and a report naming it",
    none === null && reported.join() === "Wild Area|Pokémon GO Wild Area 2026: Atlantis", reported.join());
  reported.length = 0;
  const global = venueOf(ev("Pokémon GO Wild Area 2026: Global", true), "Wild Area", report);
  check("an unmapped local-time event is global: null, no report", global === null && reported.length === 0);
  const safari = venueOf(ev("Pokémon GO City Safari: Boston (Rescheduled)", true), "City Safari", report);
  check("a local-time City Safari still gets its venue", safari?.name === "Boston" && reported.length === 0);
  check("isFixedTimeEvent reads the flag, and a missing flag as local time",
    isFixedTimeEvent({ is_local_time: false }) && !isFixedTimeEvent({ is_local_time: true }) && !isFixedTimeEvent({}) && !isFixedTimeEvent(undefined));
  check("the report callback is optional", venueOf(ev("Nowhere", false), "Event") === null);
}

console.log("\nV3 — the fetcher's passes");
{
  const NOW = Date.parse("2026-11-01T13:34:38Z");
  const nameIdx = buildNameIndex(NAMES);
  const ev = (title, start, end, is_local_time, details) => ({ title, start_time: start, end_time: end, is_local_time, details });
  const details = { bonuses: ["1/2 Stardust cost for trades", "2x Catch Candy"], spawns: [{ name: "Pikachu" }, { name: "Magnemite" }], eggs: [{ name: "Beldum" }] };
  const feed = {
    "Wild Area": [
      ev("Pokémon GO Wild Area 2026: Sendai • Tohoku", 1793926800, 1794128400, false, details),
      ev("Pokémon GO Wild Area 2026: Atlantis", 1793926800, 1794128400, false, details),
      ev("Pokémon GO Wild Area 2026: Global", "2026-11-14T10:00:00", "2026-11-15T18:00:00", true, details),
    ],
    "GO Battle League": [ev("Master League and Mega Halloween Cup | Twilight Trails", 1793134800, 1793739600, false, {})],
  };
  const seen = [];
  const reportVenue = (e, category) => seen.push(`${category}|${e.title}`);
  const { events } = eventsFromFeed(feed, NOW, nameIdx, { reportVenue });
  const { eggPools } = eggPoolsFromFeed(feed, NOW, nameIdx, { reportVenue });
  const bonuses = bonusesFromFeed(feed, NOW, () => {}, reportVenue);
  const by = (list) => Object.fromEntries(list.map((r) => [r.title, r]));
  const e = by(events), g = by(eggPools), b = by(bonuses);
  const SENDAI = "Pokémon GO Wild Area 2026: Sendai • Tohoku", ATLANTIS = "Pokémon GO Wild Area 2026: Atlantis", GLOBAL = "Pokémon GO Wild Area 2026: Global";
  const isSendai = (v) => v && v.name === "Sendai" && v.lat === 38.26667 && v.lng === 140.86667;
  check("a mapped fixed-time event: its event record carries the venue", isSendai(e[SENDAI]?.venue), JSON.stringify(e[SENDAI]?.venue));
  check("… and its egg pool", isSendai(g[SENDAI]?.venue), JSON.stringify(g[SENDAI]?.venue));
  check("… and its bonuses, with isLocalTime false", isSendai(b[SENDAI]?.venue) && b[SENDAI].isLocalTime === false && b[SENDAI].bonuses.length === 2, JSON.stringify(b[SENDAI]));
  check("an unmapped fixed-time event keeps its spawns and eggs with venue null",
    e[ATLANTIS] && e[ATLANTIS].venue === null && e[ATLANTIS].spawnDex.length === 2 && g[ATLANTIS] && g[ATLANTIS].venue === null, JSON.stringify([e[ATLANTIS]?.venue, g[ATLANTIS]?.venue]));
  check("… gets no bonus record", !b[ATLANTIS], Object.keys(b).join());
  check("… and is reported by each pass that met it (the fetcher dedupes)",
    seen.filter((x) => x === `Wild Area|${ATLANTIS}`).length === 3 && seen.every((x) => x === `Wild Area|${ATLANTIS}`), seen.join());
  check("the global edition keeps everything with venue null",
    e[GLOBAL]?.venue === null && g[GLOBAL]?.venue === null && b[GLOBAL]?.venue === null && b[GLOBAL].isLocalTime === true);
  check("a GBL rotation reaches no record and no report",
    !Object.keys(e).concat(Object.keys(g), Object.keys(b)).some((t) => /League/.test(t)) && !seen.some((x) => /League/.test(x)));
  check("every record has `venue` as an own key", [...events, ...eggPools, ...bonuses].every((r) => Object.hasOwn(r, "venue")));
  // An unmapped fixed-time event with bonuses beyond the horizon is not
  // reported: nothing would be written for it yet, and a warning that fires
  // for months before the event is one nobody reads.
  const far = [];
  bonusesFromFeed({ "Pokémon GO Tour": [ev("Pokémon GO Tour: Hoenn - Atlantis 2027", 1802966400, 1803225599, false, { bonuses: ["2x Catch Candy"] })] }, NOW, () => {}, (x, c) => far.push(c));
  check("an unmapped event outside the window is not reported yet", far.length === 0, far.join());
}

console.log("\nV4 — distance and reach");
{
  const sendai = venueFor("Pokémon GO Wild Area 2026: Sendai • Tohoku");
  const london = venueFor("Pokémon Night Out 2026 - London");
  const km = distanceKm(BONN, sendai);
  check("Bonn to Sendai is about 9,140 km", Math.abs(km - 9140) < 20, km.toFixed(1));
  check("… and rounds to 9,100 for the card", roundDistanceKm(km) === 9100, String(roundDistanceKm(km)));
  check("rounding: nearest 100 km from 1,000, nearest 10 from 100, whole below",
    roundDistanceKm(511.49) === 510 && roundDistanceKm(46.02) === 46 && roundDistanceKm(25.6) === 26 && roundDistanceKm(NaN) === null);
  check(`VENUE_RADIUS_KM is a day trip, not a flight (100–300 km)`, VENUE_RADIUS_KM >= 100 && VENUE_RADIUS_KM <= 300, String(VENUE_RADIUS_KM));
  check("a pin in the city is near", venueReach(sendai, SENDAI_PIN).near === true);
  check("a pin a day trip away (Yamagata, 46 km) is near", venueReach(sendai, YAMAGATA).near === true, venueReach(sendai, YAMAGATA).distanceKm.toFixed(0));
  check("London from Bonn (511 km) is not", venueReach(london, BONN).near === false);
  const none = venueReach(sendai, null);
  check("no pin: distance null, not near, name kept", none && none.distanceKm === null && none.near === false && none.name === "Sendai", JSON.stringify(none));
  check("a malformed pin counts as none", venueReach(sendai, [7.1]).near === false && venueReach(sendai, ["x", "y"]).near === false);
  check("no venue: null (a global event)", venueReach(null, BONN) === null && venueReach(undefined, BONN) === null);
  check("a venue off the map is no venue", venueReach({ name: "Nowhere", lat: 91, lng: 0 }, BONN) === null);
  check("the distance is symmetric in the pin", Math.abs(distanceKm(SENDAI_PIN, { lat: BONN[1], lng: BONN[0] }) - distanceKm(BONN, { lat: SENDAI_PIN[1], lng: SENDAI_PIN[0] })) < 1e-6);
}

console.log("\nV5 — bonusNudges and the home pin");
{
  const now = Date.parse("2026-11-06T08:00:00Z");
  const sendai = venueFor("Pokémon GO Wild Area 2026: Sendai • Tohoku");
  const boston = venueFor("Pokémon GO City Safari: Boston (Rescheduled)");
  const rec = (title, venue, isLocalTime, bonuses = ["1/2 Stardust cost for trades"]) => ({
    id: title, title, start: "2026-11-06T01:00:00Z", end: "2026-11-08T09:00:00Z", isLocalTime, venue, bonuses,
  });
  const kinds = (recs, homeLocation) => bonusNudges(recs, now, { homeLocation }).map((n) => n.kind).join();
  const inPerson = rec("Wild Area Sendai", sendai, false);
  check("a pin in Sendai sees the Sendai bonus", kinds([inPerson], SENDAI_PIN) === "trade_stardust");
  check("a pin in Yamagata (day trip) sees it too", kinds([inPerson], YAMAGATA) === "trade_stardust");
  check("a pin in Bonn does not", kinds([inPerson], BONN) === "");
  check("no pin does not", kinds([inPerson], null) === "" && kinds([inPerson], undefined) === "");
  check("a fixed-time record with venue null is hidden everywhere", kinds([rec("Wild Area Atlantis", null, false)], SENDAI_PIN) === "");
  check("a City Safari spelt as local time is gated by its venue all the same",
    kinds([rec("City Safari Boston", boston, true)], [-71.06, 42.36]) === "trade_stardust" && kinds([rec("City Safari Boston", boston, true)], BONN) === "");
  const global = rec("Wild Area Global", null, true);
  check("a global event nudges with any pin and with none",
    kinds([global], BONN) === "trade_stardust" && kinds([global], null) === "trade_stardust" && kinds([global], SENDAI_PIN) === "trade_stardust");
  check("a record from before venues existed (no key) is global", kinds([{ ...global, venue: undefined }], null) === "trade_stardust");
  check("the default call (no options) hides an in-person record, as the strip did", bonusNudges([inPerson], now).length === 0);
  const both = bonusNudges([inPerson, rec("Wild Area Global", null, true, ["2x Catch Candy"])], now, { homeLocation: BONN });
  check("in-person and global records in one list: only the global one from Bonn", both.map((n) => n.kind).join() === "catch_candy", both.map((n) => n.kind).join());
  check("venueRadiusKm is an option: Bonn sees London inside 600 km",
    bonusNudges([rec("Night Out London", venueFor("Pokémon Night Out 2026 - London"), false)], now, { homeLocation: BONN, venueRadiusKm: 600 }).length === 1);
  check("bonusAppliesAtHome is the gate: venue → reach, fixed-time → never, else always",
    bonusAppliesAtHome(inPerson, SENDAI_PIN) && !bonusAppliesAtHome(inPerson, BONN) && !bonusAppliesAtHome({ isLocalTime: false, venue: null }, SENDAI_PIN) && bonusAppliesAtHome(global, null) && bonusAppliesAtHome({}, null));
}

console.log("\nV6 — the committed snapshot");
{
  const wellFormed = (v) => v === null || (v && typeof v.name === "string" && v.name && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180);
  const all = [...(EVENTS.events || []), ...(EVENTS.eggPools || []), ...(EVENTS.bonuses || [])];
  const bad = all.filter((r) => Object.hasOwn(r, "venue") && !wellFormed(r.venue)).map((r) => r.id);
  check("every record that carries `venue` carries null or a city with coordinates", bad.length === 0, bad.join());
  // Records written before venues existed carry no key and read as global;
  // a fixed-time record always comes from a fetcher that knows venues.
  const fixedWithout = all.filter((r) => r.isLocalTime === false && !Object.hasOwn(r, "venue")).map((r) => r.id);
  check("every fixed-time record carries `venue`", fixedWithout.length === 0, fixedWithout.join());
  const unnamed = (EVENTS.bonuses || []).filter((r) => r.isLocalTime === false && !r.venue).map((r) => r.id);
  check("no bonus record is fixed-time without a venue (the fetcher writes none)", unnamed.length === 0, unnamed.join());
  const venued = all.filter((r) => r.venue).map((r) => `${r.id} → ${r.venue.name}`);
  if (venued.length) console.log(`  ℹ records with a venue: ${venued.join(" · ")}`);
}

console.log("\nV7 — copy and wiring");
{
  const LOCALES = ["en", "de", "es", "fr", "zh-TW", "hi", "ja"];
  const KEYS = {
    "app.events.venue_distance": ["{name}", "{distance}"],
    "app.events.venue_no_home": ["{name}"],
    "app.events.venue_far_hook": ["{name}"],
    "app.events.venue_no_home_hook": ["{name}"],
  };
  const english = JSON.parse(readFileSync(new URL("../src/locales/app/en.json", import.meta.url), "utf8"));
  for (const loc of LOCALES) {
    const b = JSON.parse(readFileSync(new URL(`../src/locales/app/${loc}.json`, import.meta.url), "utf8"));
    const missing = Object.entries(KEYS).filter(([k, phs]) => !b[k] || phs.some((ph) => !b[k].includes(ph))).map(([k]) => k);
    check(`${loc}: the four venue strings with their placeholders`, missing.length === 0, missing.join(", "));
    if (loc !== "en") {
      const copied = Object.keys(KEYS).filter((k) => k.endsWith("hook") && b[k] === english[k]);
      check(`${loc}: the hooks are not left in English`, copied.length === 0, copied.join(", "));
    }
  }
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  check("the app hands the home pin to bonusNudges", /bonusNudges\(EVENTS\.bonuses, Date\.now\(\), \{ homeLocation \}\)/.test(app));
  check("the event filters carry the venue", /venue: ev\.venue \|\| null/.test(app));
  check("the sorting tile and the Mega planner both read the venue note", (app.match(/venueNoteFor\(/g) || []).length >= 3);
  check("a far venue keeps the Mega planner row folded", /open=\{live && !where\?\.far\}/.test(app));
  const fetcher = readFileSync(new URL("./fetch-events.mjs", import.meta.url), "utf8");
  check("the fetcher logs an unmapped in-person event with the table's path", /in-person event with no venue in scripts\/lib\/event-venues\.mjs/.test(fetcher));
}

console.log("\nV8 — the Mega planner");
{
  const now = Date.parse("2026-11-06T08:00:00Z");
  const sendai = venueFor("Pokémon GO Wild Area 2026: Sendai • Tohoku");
  const forms = [{ name: "Magnemite", dex: 81, region: null, types: ["electric", "steel"] }];
  const plans = megaPlans({
    events: [
      { id: "a", title: "Sendai", start: "2026-11-06T01:00:00Z", end: "2026-11-08T09:00:00Z", spawnForms: forms, venue: sendai },
      { id: "b", title: "Global", start: "2026-11-06T01:00:00Z", end: "2026-11-08T09:00:00Z", spawnForms: forms },
    ],
    eventRaids: [{ eventID: "r", name: "Raid Day", eventType: "raid-day", start: "2026-11-07T10:00:00Z", end: "2026-11-07T13:00:00Z", bosses: [{ names: { en: "Chandelure" }, types: ["ghost", "fire"] }] }],
  }, now, () => 609);
  const byTitle = Object.fromEntries(plans.map((p) => [p.title, p]));
  check("a wild plan carries its event's venue", byTitle.Sendai?.venue?.name === "Sendai");
  check("a global event's and a raid's plan carry venue null", byTitle.Global?.venue === null && byTitle["Raid Day"]?.venue === null);
}

done("All event-venue checks passed.", (n) => `${n} event-venue check(s) failed.`);
