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

import {
  ENDED_RETENTION_MS,
  UPCOMING_HORIZON_MS,
  outsideWindow,
  carryOver,
} from "./lib/event-window.mjs";
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

done("All event-window checks passed.", (n) => `${n} event-window check(s) failed.`);
