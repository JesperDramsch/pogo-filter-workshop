// The surfacing window for the wild-spawn events snapshot, and the carry-over
// that keeps a just-ended event in it.
//
// The window has two edges. The future edge stops the card filling up with
// events weeks out (their rotations shift and every shift would be a snapshot
// churn commit). The past edge is the one that matters for tidying: an event's
// spawn card is most useful AFTER the event, when the bag is full of its
// species and the question is which ones to keep.
//
// The past edge cannot come from the feed alone. leak-duck drops an event from
// events.json the moment it ends — observed 2026-08-31, when "PokémonXP & 2026
// Worlds" (ended 08-30 20:00) was already gone from the feed while the fetcher
// still had a two-day retention that, on paper, should have kept it. The
// fetcher was only ever filtering what upstream still listed, so the retention
// window was dead code and every ended event vanished on the next daily sync.
//
// `carryOver` fixes that at the only place it can be fixed: the previous
// snapshot is the record of what upstream used to say, so an event that has
// already started and is still inside the retention window is carried forward
// from it when upstream no longer lists it. Fresh feed records always win when
// present (the carry-over fills gaps, it never overrides). Only records that
// have STARTED are carried: an upcoming event that upstream withdrew is a
// correction, and resurrecting it would put a cancelled event on the card.

const DAY_MS = 24 * 60 * 60 * 1000;

// A week after the end. Two days was never long enough for a working person to
// get to the tidy-up, and the card already collapses ended events by default,
// so a lingering one costs nothing but a folded accordion row.
export const ENDED_RETENTION_MS = 7 * DAY_MS;
export const UPCOMING_HORIZON_MS = 14 * DAY_MS;

export function windowEdges(now, {
  endedRetentionMs = ENDED_RETENTION_MS,
  upcomingHorizonMs = UPCOMING_HORIZON_MS,
} = {}) {
  return { pastEdge: now - endedRetentionMs, futureEdge: now + upcomingHorizonMs };
}

// Feed-side filter: does an event with these bounds belong in the snapshot?
// Returns "ended" / "upcoming" for the two ways of being outside the window
// (the fetcher counts them), or null when inside.
export function outsideWindow(startMs, endMs, now, opts) {
  const { pastEdge, futureEdge } = windowEdges(now, opts);
  if (endMs < pastEdge) return "ended";
  if (startMs > futureEdge) return "upcoming";
  return null;
}

// Merge fresh feed-derived records with the previous snapshot's records.
// `fresh` and `previous` are arrays of { id, start, end, ... } as written to
// events.json (both `events` and `eggPools` have that shape). Returns the merged
// list sorted by start, plus the ids that were carried so the fetcher can log
// them.
export function carryOver(fresh, previous, now, opts) {
  const { pastEdge } = windowEdges(now, opts);
  const seen = new Set((fresh || []).map((r) => r?.id).filter(Boolean));
  const carried = [];
  for (const rec of previous || []) {
    if (!rec || !rec.id || seen.has(rec.id)) continue;
    const startMs = Date.parse(rec.start);
    const endMs = Date.parse(rec.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (startMs > now) continue;       // withdrawn before it started: upstream correction
    if (endMs < pastEdge) continue;    // retention expired
    seen.add(rec.id);
    carried.push(rec);
  }
  const merged = [...(fresh || []), ...carried].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
  return { merged, carriedIds: carried.map((r) => r.id) };
}

// The shrink guard's measurement (scripts/fetch-events.mjs decides what to do
// with it). `previous` is the cached snapshot's list, `merged` what the sync is
// about to write in its place, i.e. carryOver's output.
//
// The question is "did the feed lose events it should still list?", and the
// carry-over narrows it: a cached event that has started is in `merged`
// whether the feed lists it or not, and one past retention is meant to go. So
// a cached record still inside the window that is missing from `merged` can
// only be an UPCOMING event upstream no longer lists. One is a correction (a
// cancelled or rescheduled event; a reschedule changes the title and so the
// id). Most of them at once, with nothing taking their place, is what a broken
// or half-written scrape looks like: Leek Duck publishes events.json straight
// out of a scraper, and a run that saw a partial page lists a handful of
// events where it listed thirty the day before.
//
// Refused when both hold:
//   - `merged` is SHORTER than the cached list still inside the window (a
//     feed-wide retitle loses every id and keeps the length: not a shrink), and
//   - more of those cached events were lost than kept.
// An event that aged past retention is not "still inside the window" and does
// not count: the 2026-11-01 18:35 sync that dropped City Safari Boston, ended
// a week and 35 minutes earlier, is the shape this must accept. A feed that
// yields nothing at all is the fetcher's own, earlier refusal; here it reads
// as "every upcoming event lost".
export function shrunkEvents(previous, merged, now, opts) {
  const { pastEdge, futureEdge } = windowEdges(now, opts);
  const kept = new Set((merged || []).map((r) => r?.id).filter(Boolean));
  const lost = [];
  let expected = 0;
  for (const rec of previous || []) {
    if (!rec || !rec.id) continue;
    const startMs = Date.parse(rec.start);
    const endMs = Date.parse(rec.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs < pastEdge || startMs > futureEdge) continue;   // aged out, or beyond the horizon
    expected++;
    if (!kept.has(rec.id)) lost.push(rec.id);
  }
  const retained = expected - lost.length;
  const refused = (merged || []).length < expected && lost.length > retained;
  return { expected, retained, lost, refused };
}
