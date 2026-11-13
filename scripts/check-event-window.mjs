// Offline checks for scripts/lib/event-window.mjs — the surfacing window for
// the wild-spawn events snapshot and the carry-over of just-ended events.
// Run with: npx vite-node scripts/check-event-window.mjs
//
// The carry-over exists because leak-duck drops an event from its feed the
// moment it ends, which made the fetcher's retention window dead code: every
// ended event vanished from the snapshot on the next daily sync, and the
// tidy-up card it was meant to feed was empty exactly when it was needed.
// Like the GBL slot matcher, this only runs inside the daily sync against a
// live feed nothing in CI sees, so every case is pinned here.
//
// Covers:
//   W1 — the feed-side window (past edge, future edge, inside)
//   W2 — a just-ended event upstream no longer lists is carried from the snapshot
//   W3 — carry-over never overrides a fresh feed record, and expires with retention
//   W4 — an upcoming event upstream withdrew is NOT resurrected
//   W5 — merged output is chronological and tolerates a missing / malformed snapshot
//   W6 — the shrink guard's measurement: a feed that loses most of the upcoming
//        events the snapshot still expects is refused, one that drops ended
//        events (naturally, or past retention) is not
//   W7 — the fetcher's decision on it: nothing written and exit 1 in the sync,
//        the cache kept and exit 0 under --offline-ok, written under
//        --accept-shrink

import {
  ENDED_RETENTION_MS,
  UPCOMING_HORIZON_MS,
  outsideWindow,
  carryOver,
  isRetitleOf,
  shrunkEvents,
} from "./lib/event-window.mjs";
import { guardShrunkEvents } from "./fetch-events.mjs";
import { createChecker } from "./lib/check.mjs";

const { check, done } = createChecker();

const DAY = 24 * 60 * 60 * 1000;
// Sync time: 2026-09-01 08:17 UTC, the daily cron the morning after
// "PokémonXP & 2026 Worlds" ended (08-30 20:00) and dropped out of the feed.
const NOW = Date.parse("2026-09-01T08:17:00Z");

const rec = (id, start, end, extra = {}) => ({ id, title: id, start, end, spawnDex: [1], ...extra });

const XP = rec("event-pokemonxp-2026-worlds", "2026-08-25T10:00:00", "2026-08-30T20:00:00", { spawnDex: [25, 147] });
const WATER = rec("event-ultra-unlock-water", "2026-08-18T10:00:00", "2026-08-24T20:00:00");
const MEGA = rec("event-mega-ascension", "2026-08-31T10:00:00", "2026-09-04T23:59:00");
const FEST = rec("event-go-fest-finale", "2026-09-05T10:00:00", "2026-09-06T18:00:00");
const FAR = rec("event-far-future", "2026-09-20T10:00:00", "2026-09-27T20:00:00");

console.log("\nW1 — feed-side window");
check("retention is a week, horizon a fortnight", ENDED_RETENTION_MS === 7 * DAY && UPCOMING_HORIZON_MS === 14 * DAY);
check("an event that ended yesterday is inside", outsideWindow(Date.parse(XP.start), Date.parse(XP.end), NOW) === null);
check("an event that ended eight days ago is 'ended'", outsideWindow(Date.parse(WATER.start), Date.parse(WATER.end), NOW) === "ended");
check("a live event is inside", outsideWindow(Date.parse(MEGA.start), Date.parse(MEGA.end), NOW) === null);
check("an event starting in 19 days is 'upcoming'", outsideWindow(Date.parse(FAR.start), Date.parse(FAR.end), NOW) === "upcoming");
check("an event ending exactly at the past edge is inside",
  outsideWindow(NOW - 20 * DAY, NOW - ENDED_RETENTION_MS, NOW) === null);

console.log("\nW2 — just-ended event carried from the previous snapshot");
{
  const fresh = [MEGA, FEST];                // what leak-duck lists the morning after
  const previous = [XP, MEGA, FEST];         // yesterday's snapshot
  const { merged, carriedIds } = carryOver(fresh, previous, NOW);
  check("XP event is carried over", merged.some((r) => r.id === XP.id));
  check("carriedIds names exactly the XP event", carriedIds.length === 1 && carriedIds[0] === XP.id);
  check("carried record is the snapshot's own (spawn list intact)",
    merged.find((r) => r.id === XP.id)?.spawnDex.join() === "25,147");
  check("nothing else is duplicated", merged.length === 3);
  // The day after, with the merged snapshot as `previous`, it is carried again:
  // the chain must be self-sustaining or the event survives exactly one sync.
  const next = carryOver([MEGA, FEST], merged, NOW + DAY);
  check("carried again on the following sync", next.carriedIds.length === 1 && next.carriedIds[0] === XP.id);
}

console.log("\nW3 — fresh wins, retention expires");
{
  const corrected = { ...XP, spawnDex: [25] };
  const { merged, carriedIds } = carryOver([corrected, MEGA], [XP, MEGA], NOW);
  check("a record still in the feed is taken from the feed, not the snapshot",
    merged.find((r) => r.id === XP.id)?.spawnDex.join() === "25" && carriedIds.length === 0);
  const expired = carryOver([MEGA], [WATER, XP], NOW);
  check("an event past retention is dropped even though the snapshot had it",
    !expired.merged.some((r) => r.id === WATER.id) && expired.merged.some((r) => r.id === XP.id));
  const weekLater = carryOver([FEST], [XP], Date.parse(XP.end) + ENDED_RETENTION_MS + 60_000);
  check("retention counts from the event's end", weekLater.carriedIds.length === 0);
}

console.log("\nW4 — a withdrawn upcoming event stays gone");
{
  const { merged, carriedIds } = carryOver([MEGA], [MEGA, FEST], NOW);
  check("an event that had not started is not resurrected",
    !merged.some((r) => r.id === FEST.id) && carriedIds.length === 0);
  const started = carryOver([FEST], [MEGA, FEST], NOW);
  check("an event that had started but was pulled mid-window is kept until retention",
    started.merged.some((r) => r.id === MEGA.id));
}

console.log("\nW5 — ordering and malformed input");
{
  const { merged } = carryOver([FEST, MEGA], [XP], NOW);
  check("merged output is chronological by start", merged.map((r) => r.id).join() === [XP.id, MEGA.id, FEST.id].join());
  check("no previous snapshot is a no-op", carryOver([MEGA], undefined, NOW).merged.length === 1);
  check("null previous is a no-op", carryOver([MEGA], null, NOW).carriedIds.length === 0);
  const junk = [null, {}, { id: "no-dates" }, { id: "bad", start: "yesterday", end: "later" }];
  check("records without parseable dates are skipped", carryOver([MEGA], junk, NOW).merged.length === 1);
  check("empty fresh list still carries", carryOver([], [XP], NOW).carriedIds.length === 1);
}

console.log("\nW-retitle — an event the feed renamed while it ran is not carried twice");
{
  // 2026-11-10: upstream renamed "Into the Wild" to "Into the Wild 2026" two
  // days in. The old id hashed the old title, so it was carried beside the new.
  const OLD = rec("event-into-the-wild-2026-11-09", "2026-08-31T10:00:00", "2026-09-04T20:00:00", { title: "Into the Wild", category: "Event", spawnDex: [1, 4, 7] });
  const NEW = rec("event-into-the-wild-2026-2026-11-09", "2026-08-31T10:00:00", "2026-09-04T20:00:00", { title: "Into the Wild 2026", category: "Event" });
  const { merged, carriedIds } = carryOver([NEW], [OLD], NOW);
  check("the renamed record replaces the old one", carriedIds.length === 0 && merged.length === 1 && merged[0].id === NEW.id);
  check("isRetitleOf works in both directions", isRetitleOf(OLD, NEW) && isRetitleOf(NEW, OLD));
  check("a different window is a different event", !isRetitleOf(OLD, { ...NEW, end: "2026-09-05T20:00:00" }));
  check("a different category is a different event", !isRetitleOf(OLD, { ...NEW, category: "Wild Area" }));
  check("a title that merely shares letters is a different event", !isRetitleOf(OLD, { ...NEW, title: "Into the Wilderness" }));
  check("two unrelated events in the same window are both kept",
    carryOver([{ ...NEW, title: "Mega Raid Day", id: "x" }], [OLD], NOW).carriedIds.length === 1);
}

console.log("\nW6 — the shrink guard: lost upcoming events, not ended ones");
{
  // The shape of the 2026-11-01 18:35 sync, which the guard must ACCEPT: the
  // feed still listed every live and upcoming event, and the only record to go
  // was City Safari Boston, ended seven days and 35 minutes before the sync,
  // i.e. 35 minutes past retention. The run was correct; the fetcher only had
  // no guard for the case it cannot tell from this one by size alone — a
  // half-written scrape that lists one event where it listed five.
  const UP2 = rec("event-upcoming-two", "2026-09-08T10:00:00", "2026-09-10T20:00:00");
  const UP3 = rec("event-upcoming-three", "2026-09-12T10:00:00", "2026-09-13T20:00:00");
  const aged = rec("city-safari-boston", "2026-08-23T10:00:00", new Date(NOW - ENDED_RETENTION_MS - 35 * 60_000).toISOString());
  const snapshot = [aged, XP, MEGA, FEST, UP2, UP3];
  const liveFeed = [MEGA, FEST, UP2, UP3];           // what leak-duck lists (XP already dropped)
  const ids = (list) => list.map((r) => r.id).join();

  let merged = carryOver(liveFeed, snapshot, NOW).merged;
  let g = shrunkEvents(snapshot, merged, NOW);
  check("an event aged past retention is dropped without a refusal (the 18:35 shape)",
    !g.refused && g.lost.length === 0 && !merged.some((r) => r.id === aged.id), JSON.stringify(g));
  check("… and does not count as expected either", g.expected === 5 && g.retained === 5);
  check("an event that ended inside the window is carried, so nothing is lost",
    merged.some((r) => r.id === XP.id) && g.lost.length === 0);

  // A feed that lists one event where the snapshot still expects five.
  merged = carryOver([MEGA], snapshot, NOW).merged;
  g = shrunkEvents(snapshot, merged, NOW);
  check("a one-event feed is refused", g.refused);
  check("… the started events are still carried, so what is lost is the upcoming ones",
    ids(merged) === ids([XP, MEGA]) && g.lost.join() === ids([FEST, UP2, UP3]), g.lost.join());
  check("… counts: 5 expected, 2 retained, 3 lost", g.expected === 5 && g.retained === 2 && g.lost.length === 3);

  // A feed that lists nothing at all: the fetcher refuses that earlier, on its
  // own; the measurement agrees.
  g = shrunkEvents(snapshot, carryOver([], snapshot, NOW).merged, NOW);
  check("an empty feed is refused here too", g.refused && g.lost.length === 3);

  // One upcoming event withdrawn: a correction, written as is.
  merged = carryOver([MEGA, UP2, UP3], snapshot, NOW).merged;
  g = shrunkEvents(snapshot, merged, NOW);
  check("a single withdrawn upcoming event is accepted", !g.refused && g.lost.join() === FEST.id);

  // Exactly half of the expected list lost: "most" means more than half.
  const four = [MEGA, FEST, UP2, UP3];
  g = shrunkEvents(four, carryOver([MEGA, FEST], four, NOW).merged, NOW);
  check("losing exactly half is accepted", !g.refused && g.lost.length === 2 && g.retained === 2);
  g = shrunkEvents(four, carryOver([MEGA], four, NOW).merged, NOW);
  check("losing more than half is refused", g.refused && g.lost.length === 3);

  // A feed-wide retitle changes every id and keeps the length: not a shrink.
  const retitled = [FEST, UP2, UP3].map((r) => ({ ...r, id: `${r.id}-renamed` }));
  merged = carryOver([MEGA, ...retitled], snapshot, NOW).merged;
  g = shrunkEvents(snapshot, merged, NOW);
  check("a retitle that loses every upcoming id but not the length is accepted",
    !g.refused && g.lost.length === 3 && merged.length === 5, JSON.stringify(g));

  // New events alongside a loss: the merged list did not shrink, so accepted.
  const NEW1 = rec("event-new-one", "2026-09-07T10:00:00", "2026-09-07T20:00:00");
  const NEW2 = rec("event-new-two", "2026-09-09T10:00:00", "2026-09-09T20:00:00");
  const NEW3 = rec("event-new-three", "2026-09-11T10:00:00", "2026-09-11T20:00:00");
  merged = carryOver([MEGA, NEW1, NEW2, NEW3], snapshot, NOW).merged;
  check("three withdrawn and three new: same length, accepted", !shrunkEvents(snapshot, merged, NOW).refused);

  // A cached upcoming event beyond the horizon is not expected (the horizon
  // only ever moves forward, so this needs a shorter one to show).
  g = shrunkEvents([MEGA, UP3], [MEGA], NOW, { upcomingHorizonMs: 5 * DAY });
  check("an event beyond a shortened horizon is not counted as lost", !g.refused && g.expected === 1 && g.lost.length === 0);

  check("no previous snapshot: nothing expected, nothing refused",
    [undefined, null, []].every((prev) => { const r = shrunkEvents(prev, [MEGA], NOW); return !r.refused && r.expected === 0; }));
  const junk = [null, {}, { id: "no-dates" }, { id: "bad", start: "yesterday", end: "later" }];
  check("records without parseable dates are skipped", shrunkEvents(junk, [], NOW).expected === 0);
  check("an unchanged snapshot is accepted", !shrunkEvents(snapshot, carryOver(snapshot, snapshot, NOW).merged, NOW).refused);
}

console.log("\nW7 — the fetcher's decision: write or keep the cache, and how to exit");
{
  // Like D11 for the raid fetcher: the decision only ever runs against the live
  // feed, in the daily sync and in every prebuild, so it is pinned here.
  const UP2 = rec("event-upcoming-two", "2026-09-08T10:00:00", "2026-09-10T20:00:00");
  const UP3 = rec("event-upcoming-three", "2026-09-12T10:00:00", "2026-09-13T20:00:00");
  const snapshot = [XP, MEGA, FEST, UP2, UP3];
  const healthy = carryOver([MEGA, FEST, UP2, UP3], snapshot, NOW).merged;
  const broken = carryOver([MEGA], snapshot, NOW).merged;

  let g = guardShrunkEvents(snapshot, healthy, NOW);
  check("a healthy feed: written, exit 0", !g.refused && g.write && g.exitCode === 0);
  g = guardShrunkEvents(snapshot, broken, NOW);
  check("a shrunken feed in the sync: nothing written, exit 1", g.refused && !g.write && g.exitCode === 1);
  check("… and the measurement rides along for the ✗ line", g.expected === 5 && g.retained === 2 && g.lost.length === 3);
  g = guardShrunkEvents(snapshot, broken, NOW, { offlineOk: true });
  check("a shrunken feed under --offline-ok: nothing written, the build goes on (exit 0)", g.refused && !g.write && g.exitCode === 0);
  g = guardShrunkEvents(snapshot, broken, NOW, { acceptShrink: true });
  check("--accept-shrink: still reported as a shrink, but written, exit 0", g.refused && g.write && g.exitCode === 0);
  g = guardShrunkEvents(null, broken, NOW);
  check("no previous snapshot: written as is (nothing to compare against)", !g.refused && g.write && g.exitCode === 0);
}

done("All event-window checks passed.", (n) => `${n} event-window check(s) failed.`);
