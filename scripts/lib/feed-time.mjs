// The two spellings of a time in leak-duck's event feed, read as one.
//
// Every `start_time` / `end_time` in zhenga8533/leak-duck's events.json comes
// in one of two forms, and `is_local_time` decides which:
//
//   is_local_time: true   a naive local wall-clock string, "2026-11-14T10:00:00",
//                         the same instant in every time zone (an event that
//                         starts at 10:00 wherever you are).
//   is_local_time: false  a NUMBER: seconds since the Unix epoch, UTC. One fixed
//                         instant worldwide: GO Battle League rotations, the
//                         city Wild Area / GO Tour / Night Out events.
//
// Verified 2026-11-01 against ScrapedDuck, the other scrape of the same Leek
// Duck pages, which spells the same events as zoned ISO strings: Wild Area
// Sendai 1793926800 is "2026-11-06T01:00:00.000Z" there (10:00–18:00 JST),
// Mexico City 1793980800 is 16:00Z (10:00 CST), GO Tour Kaohsiung 1802966400
// is local midnight in UTC+8. The feed's whole visible history (May 2026 on)
// never carried a fixed-time event as a string, nor a local one as a number.
//
// Date.parse(number) is NaN, so until this helper existed every fixed-time
// event was skipped without a word — the fetcher's `continue` on an unparseable
// window neither counted nor logged it. The helper is the one place both forms
// are read; every feed-time parse goes through it.

// Epoch seconds and epoch milliseconds are three orders of magnitude apart
// (1.8e9 vs 1.8e12 in 2026). Anything at or above this is read as milliseconds,
// so a flip to the other unit upstream still parses instead of landing in the
// year 58,000. Seconds stay below it until the year 5138.
const EPOCH_MS_FLOOR = 1e11;

// Milliseconds since the epoch, or NaN when the value is neither form.
//   number → epoch seconds (or milliseconds, see EPOCH_MS_FLOOR)
//   string → Date.parse, exactly as before: a naive string is local time (the
//            machine's zone: UTC in the sync and on Pages' build), a zoned one
//            exact. An all-digit string is NaN under Date.parse and is read as
//            a number here instead: it can only be an epoch that was quoted.
//   anything else → NaN
export function parseFeedTime(value) {
  if (typeof value === "number") return fromEpoch(value);
  if (typeof value !== "string") return NaN;
  if (/^\d{9,14}$/.test(value)) return fromEpoch(Number(value));
  return Date.parse(value);
}

function fromEpoch(n) {
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n >= EPOCH_MS_FLOOR ? n : n * 1000;
}

// The string form of a feed time, for ids and snapshot fields: a string comes
// back untouched (so every existing id and record stays byte-identical), a
// number becomes its UTC ISO stamp without milliseconds, "2026-11-06T01:00:00Z".
// That is the form ScrapedDuck gives the same instant up to its ".000", so
// `takeoverId`'s minute prefix agrees across the two feeds, and the trailing Z
// is what makes the app's Date.parse read it as the fixed instant it is rather
// than as the viewer's local wall clock. Unparseable input comes back as it
// came (null stays null), so a caller can still tell what the feed sent.
export function normaliseFeedTime(value) {
  if (typeof value === "string" && !/^\d{9,14}$/.test(value)) return value;
  const ms = parseFeedTime(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z");
}

// An event's window, parsed and normalised in one go, or null when either edge
// cannot be read. `start` / `end` are the normalised strings for ids and
// snapshot records; `startMs` / `endMs` are for the window arithmetic.
export function feedWindow(ev) {
  const startMs = parseFeedTime(ev?.start_time);
  const endMs = parseFeedTime(ev?.end_time);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs, start: normaliseFeedTime(ev.start_time), end: normaliseFeedTime(ev.end_time) };
}

// What to say about an event whose window did not parse: the raw values as the
// feed sent them, JSON-quoted so a number and a string are told apart.
export function describeUnparseableWindow(ev) {
  return `start_time=${JSON.stringify(ev?.start_time ?? null)} end_time=${JSON.stringify(ev?.end_time ?? null)}`;
}
