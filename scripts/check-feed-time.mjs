// Offline checks for scripts/lib/feed-time.mjs — the two spellings of a time in
// leak-duck's event feed — and for every place that reads one.
// Run with: npx vite-node scripts/check-feed-time.mjs
//
// The feed gives a local-time event a naive wall-clock string and a fixed-time
// event (is_local_time: false) epoch SECONDS as a number. Date.parse(number) is
// NaN, and the fetcher's passes `continue`d on NaN without a count or a line,
// so the GO Battle League rotations, the city Wild Area events, GO Tour and
// Pokémon Night Out were dropped silently for as long as the feed was read.
// The values below are the live feed's own (2026-11-01) and the instants are
// ScrapedDuck's zoned strings for the same events, the independent reading of
// the same Leek Duck pages. Like the event window, none of this runs anywhere
// CI can see a live feed, so every case is pinned here.
//
// Covers:
//   T1 — parseFeedTime: numbers are UTC epoch seconds, strings parse as before
//   T2 — normaliseFeedTime / feedWindow: the string an id and a record carry
//   T3 — the fetcher's passes keep a numeric event, keep ids stable, and report
//        rather than skip an event whose window still cannot be read
//   T4 — a Community Day with a numeric start gets its date
//   T5 — a fixed-time takeover is exact, never widened, same id as ScrapedDuck's

import { parseFeedTime, normaliseFeedTime, feedWindow, describeUnparseableWindow } from "./lib/feed-time.mjs";
import { signalsFromFeed, bonusesFromFeed } from "./fetch-events.mjs";
import { communityDaysFromFeed } from "./lib/community-days.mjs";
import { findActiveTakeover, normaliseEvents, takeoverId } from "./lib/rocket-takeover.mjs";
import { createChecker } from "./lib/check.mjs";

const { check, done } = createChecker();

const HOUR = 60 * 60 * 1000;
// Sync time: the 2026-11-01 13:34 UTC run, five days before the Sendai Wild Area.
const NOW = Date.parse("2026-11-01T13:34:38Z");

// From the live feed, with ScrapedDuck's spelling of the same instant.
const SENDAI = { start: 1793926800, end: 1794128400, sdStart: "2026-11-06T01:00:00.000Z", sdEnd: "2026-11-08T09:00:00.000Z" }; // 10:00–18:00 JST
const MEXICO = { start: 1793980800, end: 1794182400, sdStart: "2026-11-06T16:00:00.000Z", sdEnd: "2026-11-09T00:00:00.000Z" }; // 10:00–18:00 CST
const LONDON = { start: 1794333600, end: 1794349800, sdStart: "2026-11-10T18:00:00.000Z", sdEnd: "2026-11-10T22:30:00.000Z" };
const KAOHSIUNG = { start: 1802966400, end: 1803225599, sdStart: "2027-02-18T16:00:00.000Z", sdEnd: "2027-02-21T15:59:59.000Z" }; // local midnight, UTC+8
const GBL = { start: 1793134800, end: 1793739600 }; // Tue 2026-10-27 21:00Z → Tue 11-03 21:00Z

console.log("\nT1 — parseFeedTime");
{
  for (const [name, ev] of Object.entries({ SENDAI, MEXICO, LONDON, KAOHSIUNG })) {
    check(`${name}: the number is the UTC epoch second ScrapedDuck spells as ${ev.sdStart}`,
      parseFeedTime(ev.start) === Date.parse(ev.sdStart) && parseFeedTime(ev.end) === Date.parse(ev.sdEnd),
      new Date(parseFeedTime(ev.start)).toISOString());
  }
  check("a GO Battle League rotation is a week, Tuesday 21:00 UTC to Tuesday 21:00 UTC",
    parseFeedTime(GBL.end) - parseFeedTime(GBL.start) === 7 * 24 * HOUR && new Date(parseFeedTime(GBL.start)).toISOString() === "2026-10-27T21:00:00.000Z");
  const strings = ["2026-11-14T10:00:00", "2026-11-14T10:00:00Z", "2026-11-14T10:00:00.000", "2026-11-14T10:00:00+02:00", "2026-11-14", "yesterday", ""];
  check("every string parses exactly as Date.parse did (naive, zoned, fractional, date-only, junk)",
    strings.every((s) => Object.is(parseFeedTime(s), Date.parse(s))));
  check("a naive string is still read in the machine's zone, not as UTC",
    parseFeedTime("2026-11-14T10:00:00") === new Date(2026, 10, 14, 10, 0, 0).getTime());
  check("epoch milliseconds are read as milliseconds", parseFeedTime(1793926800000) === 1793926800000);
  check("an all-digit string is an epoch that was quoted, not NaN", parseFeedTime("1793926800") === 1793926800000);
  check("neither form gives NaN: null, undefined, object, array, NaN, zero, negative",
    [null, undefined, {}, [], NaN, 0, -1, Infinity].every((v) => Number.isNaN(parseFeedTime(v))));
}

console.log("\nT2 — normaliseFeedTime and feedWindow");
{
  const strings = ["2026-11-14T10:00:00", "2026-11-14T10:00:00Z", "2026-11-14T10:00:00.000", "yesterday"];
  check("a string comes back as the very same string (ids and records unchanged)",
    strings.every((s) => normaliseFeedTime(s) === s));
  check("a number becomes its UTC ISO stamp without milliseconds",
    normaliseFeedTime(SENDAI.start) === "2026-11-06T01:00:00Z" && normaliseFeedTime(KAOHSIUNG.end) === "2027-02-21T15:59:59Z");
  check("the stamp agrees with ScrapedDuck's to the second",
    Date.parse(normaliseFeedTime(MEXICO.start)) === Date.parse(MEXICO.sdStart) &&
    normaliseFeedTime(MEXICO.start).slice(0, 19) === MEXICO.sdStart.slice(0, 19));
  check("normalising is idempotent and round-trips through parseFeedTime",
    normaliseFeedTime(normaliseFeedTime(LONDON.end)) === normaliseFeedTime(LONDON.end) &&
    parseFeedTime(normaliseFeedTime(LONDON.end)) === parseFeedTime(LONDON.end));
  check("a quoted epoch and epoch milliseconds normalise to the same stamp",
    normaliseFeedTime("1793926800") === "2026-11-06T01:00:00Z" && normaliseFeedTime(1793926800000) === "2026-11-06T01:00:00Z");
  check("unparseable input comes back as it came", normaliseFeedTime(null) === null && normaliseFeedTime(undefined) === undefined && normaliseFeedTime("soon") === "soon");
  const w = feedWindow({ start_time: SENDAI.start, end_time: SENDAI.end });
  check("feedWindow: a numeric window gives both instants and both stamps",
    w && w.startMs === parseFeedTime(SENDAI.start) && w.endMs === parseFeedTime(SENDAI.end) && w.start === "2026-11-06T01:00:00Z" && w.end === "2026-11-08T09:00:00Z");
  const s = feedWindow({ start_time: "2026-11-01T10:00:00", end_time: "2026-11-05T20:00:00" });
  check("feedWindow: a string window carries the feed's own strings",
    s && s.start === "2026-11-01T10:00:00" && s.end === "2026-11-05T20:00:00" && s.startMs === Date.parse("2026-11-01T10:00:00"));
  check("feedWindow: a mixed window is fine, a half-parseable one is null",
    feedWindow({ start_time: SENDAI.start, end_time: "2026-11-08T18:00:00" }) !== null &&
    feedWindow({ start_time: SENDAI.start, end_time: "soon" }) === null &&
    feedWindow({ start_time: null, end_time: SENDAI.end }) === null &&
    feedWindow(undefined) === null);
  check("describeUnparseableWindow tells a number from a string and shows a missing edge",
    describeUnparseableWindow({ start_time: 1793926800, end_time: "soon" }) === 'start_time=1793926800 end_time="soon"' &&
    describeUnparseableWindow({}) === "start_time=null end_time=null");
}

console.log("\nT3 — the fetcher's passes");
{
  const ev = (title, start, end, is_local_time, details = {}) => ({ title, start_time: start, end_time: end, is_local_time, details });
  const sendai = ev("Pokémon GO Wild Area 2026: Sendai • Tohoku", SENDAI.start, SENDAI.end, false, { bonuses: ["2× Catch Candy"], spawns: [{ name: "Pikachu" }] });
  const halloween = ev("Pokémon GO Halloween 2026 Part II", "2026-11-01T10:00:00", "2026-11-05T20:00:00", true, { bonuses: ["2× Candy for catching Pokémon"] });
  const takeover = ev("Twilight Trails: Taken Over", SENDAI.start, SENDAI.end, false, { bonuses: ["More Team GO Rocket appearances"] });
  const broken = ev("Something new", "soon", "later", true, { bonuses: ["1/2 Stardust cost for trades"] });
  const noEnd = ev("Half a window", SENDAI.start, undefined, false, { bonuses: ["1/2 Stardust cost for trades"] });
  const feed = { "Wild Area": [sendai], Event: [halloween, takeover, broken, noEnd] };

  const reported = [];
  const report = (e, category) => reported.push(`${category}|${e.title}`);
  const bonuses = bonusesFromFeed(feed, NOW, report);
  const byTitle = Object.fromEntries(bonuses.map((b) => [b.title, b]));

  const s = byTitle[sendai.title];
  check("a fixed-time event with bonuses is kept, five days out", !!s);
  check("its record carries the UTC stamps and isLocalTime false",
    s && s.start === "2026-11-06T01:00:00Z" && s.end === "2026-11-08T09:00:00Z" && s.isLocalTime === false);
  check("the app's Date.parse reads those stamps back to the feed's instants",
    s && Date.parse(s.start) === parseFeedTime(SENDAI.start) && Date.parse(s.end) === parseFeedTime(SENDAI.end));
  check("its id slugs the stamp, not the epoch digits",
    s && s.id === "wild-area-pok-mon-go-wild-area-2026-sendai-tohoku-2026-11-06t01-00-00z", s?.id);
  const h = byTitle[halloween.title];
  check("a local-time event's id and record are byte-for-byte what they were",
    h && h.id === "event-pok-mon-go-halloween-2026-part-ii-2026-11-01t10-00-00" && h.start === "2026-11-01T10:00:00" && h.end === "2026-11-05T20:00:00" && h.isLocalTime === true, h?.id);
  check("the two unparseable events are left out", !byTitle[broken.title] && !byTitle[noEnd.title]);
  check("and reported, once each, with their category", reported.sort().join() === "Event|Half a window,Event|Something new", reported.join());
  check("the report callback is optional (the default swallows)", bonusesFromFeed(feed, NOW).length === bonuses.length);

  // The id-stability decision: the same fixed instant as a number and as the
  // zoned stamp slugs to the same id, so a flip upstream to that spelling keeps
  // the record's identity and its carry-over.
  const asStamp = { ...sendai, start_time: "2026-11-06T01:00:00Z", end_time: "2026-11-08T09:00:00Z" };
  const [stamped] = bonusesFromFeed({ "Wild Area": [asStamp] }, NOW);
  check("the same instant as a zoned string gives the identical id and record",
    stamped && stamped.id === s?.id && stamped.start === s?.start && stamped.end === s?.end);

  const sigReported = [];
  const signals = signalsFromFeed(feed, (e, category) => sigReported.push(`${category}|${e.title}`));
  const t = signals.find((x) => x.kind === "takeover");
  check("a fixed-time takeover becomes a signal with the stamps",
    t && t.start === "2026-11-06T01:00:00Z" && t.end === "2026-11-08T09:00:00Z" && t.id === "takeover|event-twilight-trails-taken-over-2026-11-06t01-00-00z", t?.id);
  check("signalsFromFeed reports the same two unparseable events",
    sigReported.sort().join() === "Event|Half a window,Event|Something new", sigReported.join());
  check("signalsFromFeed without a callback still works", signalsFromFeed(feed).length === signals.length);
}

console.log("\nT4 — Community Days");
{
  const resolve = (names) => ({ spawnDex: names.map(() => 25), spawns: ["Pikachu"], unresolved: [] });
  const day = (title, start) => ({ title, start_time: start, details: { features: ["Pikachu"] } });
  const reported = [];
  const { days, unresolved } = communityDaysFromFeed({
    "Community Day": [day("Pawniard Community Day", "2026-11-21T14:00:00"), day("Fixed Community Day", SENDAI.start), day("Lost Community Day", "soon")],
  }, resolve, (e, category) => reported.push(`${category}|${e.title}`));
  const dates = Object.fromEntries(days.map((d) => [d.event, d.date]));
  check("a string start keeps its calendar day", dates["Pawniard Community Day"] === "2026-11-21");
  check("a numeric start gets the UTC calendar day", dates["Fixed Community Day"] === "2026-11-06", dates["Fixed Community Day"]);
  check("an unparseable start is reported and the day skipped, not held back as unresolved",
    reported.join() === "Community Day|Lost Community Day" && !dates["Lost Community Day"] && unresolved.length === 0);
}

console.log("\nT5 — a fixed-time takeover in the Rocket fetcher");
{
  const ld = { Event: [{ title: "Twilight Trails: Taken Over", start_time: SENDAI.start, end_time: SENDAI.end, is_local_time: false, details: { bonuses: ["More Team GO Rocket appearances"] } }] };
  const sd = [{ name: "Twilight Trails: Taken Over", start: SENDAI.sdStart, end: SENDAI.sdEnd }];
  const startMs = parseFeedTime(SENDAI.start);
  const [norm] = normaliseEvents(ld);
  check("normaliseEvents hands the Rocket fetcher strings, never a bare epoch",
    norm.start === "2026-11-06T01:00:00Z" && norm.end === "2026-11-08T09:00:00Z" && normaliseEvents(sd)[0].start === SENDAI.sdStart);
  const live = findActiveTakeover(ld, startMs + HOUR);
  check("live an hour in, with the stamp as its start", live && live.start === "2026-11-06T01:00:00Z" && live.id === "twilight-trails-taken-over@2026-11-06T01:00", live?.id);
  check("a fixed instant is exact: not yet live an hour before, over an hour after",
    findActiveTakeover(ld, startMs - HOUR) === null && findActiveTakeover(ld, parseFeedTime(SENDAI.end) + HOUR) === null);
  const naive = { Event: [{ ...ld.Event[0], start_time: "2026-11-06T01:00:00", end_time: "2026-11-08T09:00:00", is_local_time: true }] };
  check("whereas a naive local string is still widened to the earliest zone",
    findActiveTakeover(naive, startMs - HOUR) !== null);
  check("leak-duck's number and ScrapedDuck's zoned string give one takeover id",
    findActiveTakeover(sd, startMs + HOUR)?.id === live?.id && takeoverId(norm.title, norm.start) === takeoverId(sd[0].name, sd[0].start));
}

done("All feed-time checks passed.", (n) => `${n} feed-time check(s) failed.`);
