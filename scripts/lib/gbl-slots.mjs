// Splitting a GBL event into its battle SLOTS, and matching PvPoke's formats[]
// to them. Shared by both source paths in scripts/fetch-pvp-rankings.mjs.
//
// A GBL week runs three concurrent slots, and LeekDuck names every one of them
// in a single event: "Great League, Ultra League: Mega Edition, and Little Cup".
// The matcher this replaces flattened the whole event into one token stream, so
// it could not tell which slot a token came from. Three defects fell out of
// that, all of them live on the September 2026 feed:
//
//   - Caps were pooled across the event. "Great League, Ultra League: Mega
//     Edition" named 1500 and 2500, so the `mega` format matched at BOTH — the
//     snapshot published a Mega Great League that was not running.
//   - "Mega Color Cup: Great League Edition" matched the `mega` format, i.e.
//     Mega Master League. "Mega" there is the first word of the CUP's name and
//     has nothing to do with the Mega Edition of a standing league.
//   - The guard against a runaway matcher asserted at most ONE cup per event.
//     That premise is false — two of the three slots can be cups — so it threw
//     on "Great League, Ultra League: Mega Edition, and Little Cup", took the
//     whole PvPoke path down with it, and silently degraded every field of the
//     snapshot to the lily-dex fallback.
//
// Matching per slot fixes all three, and it makes the runaway guard true by
// construction rather than false: ONE slot names at most one cup.

// League tokens in a LeekDuck event slug, and the CP cap each implies.
export const LEAGUE_TOKEN_CP = { "great-league": 1500, "ultra-league": 2500, "master-league": 10000 };

// Not cups: `all` is the open-league pseudo-cup, `custom` is the site's builder.
export const NON_CUPS = new Set(["all", "custom"]);

// How many consecutive slug tokens a single cup id is allowed to span. Cup ids
// are one to three words ("mega", "copadiluvio", "championshipseries").
const MAX_TOKEN_WINDOW = 4;

// Lowercase kebab token stream.
export const tokenize = (...parts) =>
  parts.join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Every run of CONSECUTIVE tokens in the stream, joined. `copa-diluvio` yields
// {copa, copadiluvio, diluvio}.
//
// Whole-token matching alone is not enough, because PvPoke's cup ids concatenate
// words that LeekDuck's slug hyphenates: `copadiluvio` vs `copa-diluvio`, and
// likewise `championshipseries`, `ligaultra`, `coupedusillage`. A token-equality
// test never matches those, so the cup is never fetched and the user gets no cup
// card for the entire event, silently.
//
// Joining only whole tokens is what keeps the old substring bug fixed: `fall` is
// a single token, so `all` is not in its window set and cannot match it — which
// is the false positive the whole-token rule was introduced to kill.
export function tokenWindows(stream) {
  const parts = stream.split("-").filter(Boolean);
  const out = new Set();
  for (let i = 0; i < parts.length; i++) {
    let joined = "";
    for (let j = i; j < parts.length && j - i < MAX_TOKEN_WINDOW; j++) {
      joined += parts[j];
      out.add(joined);
    }
  }
  return out;
}

// Tokens are compared with separators stripped from BOTH sides, so the league
// token `great-league` matches the window `greatleague`.
export const hasToken = (windows, token) =>
  windows.has(String(token).toLowerCase().replace(/[^a-z0-9]/g, ""));

// One slot of one event.
//
// `isLeague` is the discriminator the format match turns on: a slot is a
// standing league (optionally with an Edition modifier) when it OPENS with a
// league token and never says "cup". Everything else names a cup, whatever else
// it also mentions — "Mega Catch Cup: Great League Edition" is a cup slot, and
// so is "Copa Dilúvio", which says neither "league" nor "cup".
function makeSlot(text) {
  const stream = tokenize(text);
  if (!stream) return null;
  const parts = stream.split("-");
  const head = `${parts[0]}-${parts[1] || ""}`;
  const windows = tokenWindows(stream);
  const league = Object.hasOwn(LEAGUE_TOKEN_CP, head) ? head : null;
  // Every league this slot names, not just the leading one: a cup slot's
  // "…: Great League Edition" suffix is what states the cup's cap.
  const caps = new Set(
    Object.keys(LEAGUE_TOKEN_CP).filter(t => hasToken(windows, t)).map(t => LEAGUE_TOKEN_CP[t]),
  );
  return { text, stream, windows, caps, league, isLeague: league !== null && !hasToken(windows, "cup") };
}

// The eventID is LeekDuck's URL slug and is already `_`-delimited per slot:
// `gbl-twilight-trails_great-league_ultra-league-mega-edition_little-cup`.
// The leading `gbl-<season>` segment is the series, not a slot, and dropping it
// keeps a season name out of the match — a season called "Little Journeys" would
// otherwise hand every week of it a Little Cup.
function slugSlots(eventID) {
  const segments = String(eventID || "").split("_").filter(Boolean);
  if (segments.length > 1 && /^gbl-/i.test(segments[0])) segments.shift();
  return segments;
}

// The display name is folded in too, because a slug can drop a qualifier. Its
// season suffix (" | Twilight Trails") goes for the same reason as the slug's
// prefix. Slots are split on the list separators LeekDuck writes: "Great League,
// Ultra League: Mega Edition, and Little Cup".
function nameSlots(name) {
  return String(name || "")
    .split("|")[0]
    .split(/,|\sand\s/i)
    .map(s => s.trim())
    .filter(Boolean);
}

// Slots from BOTH fields, unioned by token stream rather than zipped: nothing
// pairs a slug segment with a name segment, so the two disagreeing about how
// many pieces the event has is harmless. A slot matched from both sides yields
// the same formats and dedupes on the id.
export function eventSlots(eventID, name) {
  const out = [];
  const seen = new Set();
  for (const text of [...slugSlots(eventID), ...nameSlots(name)]) {
    const slot = makeSlot(text);
    if (!slot || seen.has(slot.stream)) continue;
    seen.add(slot.stream);
    out.push(slot);
  }
  return out;
}

// The leagues an event actually runs, in canonical order. Read off the LEAGUE
// slots only: "Master League and Mega Color Cup: Great League Edition" runs
// Master League and a Great-League-capped cup, not Great League itself.
export function leaguesForSlots(slots) {
  return Object.keys(LEAGUE_TOKEN_CP)
    .filter(t => slots.some(s => s.isLeague && s.league === t))
    .map(t => t.replace("-league", ""));
}

// `formats` is [{cup, cp, ...}] — the game master's formats[] on the PvPoke
// path, and the same shape synthesized from the fallback's cups on the other, so
// one matcher serves both. Returns the formats this event is running.
export function matchEventFormats(formats, slots) {
  const usable = (formats || []).filter(
    f => f && typeof f.cup === "string" && typeof f.cp === "number" && !NON_CUPS.has(f.cup),
  );
  // How many caps each cup is published at. A format published at SEVERAL caps
  // is not a cup at all: it is a rule set applied to each standing league, which
  // is exactly what "Mega Great/Ultra/Master League" is. That is what makes it
  // matchable only from a league slot, and it comes from the shape of the feed
  // rather than from a title string that upstream is free to reword.
  const capsPerCup = new Map();
  for (const f of usable) {
    if (!capsPerCup.has(f.cup)) capsPerCup.set(f.cup, new Set());
    capsPerCup.get(f.cup).add(f.cp);
  }

  const matched = [];
  for (const slot of slots) {
    const hits = [];
    for (const f of usable) {
      if (!hasToken(slot.windows, f.cup)) continue;
      // One-way, not a biconditional: a league variant in a cup slot is the
      // "Mega Color Cup" false positive and must go, while a single-cap format
      // in a league slot ("Master League: Premier Edition") has no such failure
      // mode and is left to the cap check below.
      if ((capsPerCup.get(f.cup)?.size || 0) > 1 && !slot.isLeague) continue;
      // The cap the slot names decides which publication of the cup is running:
      // a league slot names exactly one, and a cup slot names one only when it
      // carries an "…: Great League Edition" suffix. A cup slot that names none
      // (Little Cup, at cp 500) keeps the cap the format publishes — the old
      // whole-event matcher had to carve that case out by hand, because the
      // caps it pooled came from other slots entirely.
      if (slot.caps.size > 0 && !slot.caps.has(f.cp)) continue;
      hits.push(f);
    }
    // A runaway matcher is the failure mode worth catching, and per slot the
    // shape of it is unambiguous: one slot is one format, so two distinct cup
    // ids from one slot means the matcher is inventing them. Asserted rather
    // than warned — a warn-only guard on a robot-run job is indistinguishable
    // from no guard, and the run would still publish the bogus cups as live.
    const cups = new Set(hits.map(f => f.cup));
    if (cups.size > 1) {
      throw new Error(
        `slot "${slot.text}" matched ${cups.size} distinct cups (${[...cups].join(", ")}) — ` +
        "one battle slot runs one format; the matcher is too loose",
      );
    }
    matched.push(...hits);
  }
  return matched;
}
