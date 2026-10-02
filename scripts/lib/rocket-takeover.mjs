// Takeover-gated direct read of LeekDuck's Rocket lineup page.
//
// ScrapedDuck is the primary Rocket source and stays that way: it scrapes
// LeekDuck with LeekDuck's permission, we do not. But its scraper swallows its
// own failures — `pages/rocketLineups.js` catches any error and re-publishes the
// previous `rocketLineups.min.json` unchanged — so when its scrape broke, the
// feed kept "updating" every ten minutes with the same content. Observed on
// 2026-10-02, the first day of "Harvest Festival: Taken Over": LeekDuck showed
// Giovanni → Zekrom while ScrapedDuck (and leak-duck's copy) still served the
// lineup from 2026-06-27.
//
// Lineups change almost only at a takeover, so that is the only time we read
// LeekDuck ourselves: at most once per UTC day while a takeover is live, and
// never again for that takeover once the page shows something ScrapedDuck
// does not. Everything here is pure so scripts/check-rocket-takeover.mjs can pin
// it; the fetching lives in scripts/fetch-rocket-lineups.mjs.

export const LEEKDUCK_ROCKET_URL = "https://leekduck.com/rocket-lineups/";

const HOUR_MS = 60 * 60 * 1000;
// Local-time events start at local midnight in UTC+14 first and end last in
// UTC-12. The feed's naive timestamps are read as UTC and widened by these.
const LOCAL_EARLIEST_OFFSET_MS = 14 * HOUR_MS;
const LOCAL_LATEST_OFFSET_MS = 12 * HOUR_MS;

// A takeover is named as one ("Taken Over", "Takeover"), or lists a Rocket
// bonus. The bonus is the steadier signal: Niantic's titles vary, the
// "More Team GO Rocket appearances" bonus line has not.
export function isTakeoverEvent(ev) {
  if (!ev) return false;
  if (/\btaken\s+over\b|\btake-?over\b/i.test(ev.title || "")) return true;
  const bonuses = ev.details?.bonuses || ev.bonuses || [];
  if (bonuses.some((b) => /team go rocket/i.test(typeof b === "string" ? b : b?.text || ""))) return true;
  return /team go rocket (takes|is taking|took) over/i.test(ev.description || "");
}

// Naive timestamps (no zone) are local-time events: read as UTC and widened
// by the edge offset so the window covers every timezone. Zoned ones are exact.
function parseEdge(stamp, offsetMs) {
  if (!stamp) return NaN;
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(stamp);
  const ms = Date.parse(hasZone ? stamp : `${stamp}Z`);
  if (!Number.isFinite(ms)) return NaN;
  return hasZone ? ms : ms + offsetMs;
}

// One identity for a takeover whichever feed reported it: title + start to the
// minute. Both feeds carry those verbatim ("2026-10-02T00:00:00" vs
// "2026-10-02T00:00:00.000"); their own ids (leak-duck's article URL,
// ScrapedDuck's eventID) do not agree.
export function takeoverId(title, start) {
  const slug = String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}@${String(start || "").slice(0, 16)}`;
}

// Is `state` (a previous snapshot's `takeover` record) about this takeover?
// Matches on title + start as well as id, so a record written under an
// older id scheme is still recognised and not read again.
export function sameTakeover(takeover, state) {
  if (!takeover || !state) return false;
  return state.id === takeover.id || takeoverId(state.title, state.start) === takeover.id;
}

// Normalise both event feeds we read: leak-duck's category-keyed object
// ({ Event: [{ title, start_time, end_time, description, details }] }, the one
// with bonus lines) and ScrapedDuck's flat array ([{ name, start, end }],
// titles only), the fallback when leak-duck is unreachable. Both list every
// dated event, unlike src/data/events.json, which keeps only events with a
// wild-spawn pool and would miss a takeover without one.
export function normaliseEvents(source) {
  if (Array.isArray(source)) {
    return source
      .filter((e) => e?.name)
      .map((e) => ({ title: e.name, start: e.start, end: e.end, details: e.details, description: e.description }));
  }
  if (!source || typeof source !== "object") return [];
  const out = [];
  for (const list of Object.values(source)) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!e?.title) continue;
      out.push({ title: e.title, start: e.start_time, end: e.end_time, details: e.details, description: e.description });
    }
  }
  return out;
}

// The takeover live somewhere on Earth at `now`, or null. If two overlap, the
// one that started last wins: its lineup is the one LeekDuck is showing.
export function findActiveTakeover(source, now) {
  let best = null;
  for (const ev of normaliseEvents(source)) {
    if (!isTakeoverEvent(ev)) continue;
    const from = parseEdge(ev.start, -LOCAL_EARLIEST_OFFSET_MS);
    const to = parseEdge(ev.end, LOCAL_LATEST_OFFSET_MS);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (now < from || now > to) continue;
    if (!best || from > best.fromMs) best = { title: ev.title, start: ev.start, end: ev.end, fromMs: from };
  }
  if (!best) return null;
  return { id: takeoverId(best.title, best.start), title: best.title, start: best.start, end: best.end };
}

// A LeekDuck parse may replace the snapshot only if it covers every trainer
// ScrapedDuck lists. A partial page or selector drift must not overwrite (and
// then pin) a shrunken roster. Returns the missing names (empty = complete).
export function missingTrainers(candidate, reference) {
  const have = new Set((candidate || []).map((t) => t.name));
  return (reference || []).map((t) => t.name).filter((n) => !have.has(n));
}

// Should this run read LeekDuck? `state` is the previous snapshot's `takeover`
// record (or undefined). One attempt per UTC day; none once settled.
export function shouldReadLeekDuck(takeover, state, today) {
  if (!takeover) return false;
  if (!sameTakeover(takeover, state)) return true;
  if (state.settled) return false;
  return !(state.attempts || []).includes(today);
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&eacute;/g, "é")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Decoded, whitespace-collapsed text; throws on anything that decodes to markup.
function plainText(raw) {
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (/[<>]/.test(text)) throw new Error(`LeekDuck text contains markup: ${JSON.stringify(text)}`);
  return text;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
}

// Parse the LeekDuck page into ScrapedDuck's rocketLineups shape
// ({ name, type, firstPokemon, secondPokemon, thirdPokemon }), so the result
// goes through the exact same deriveTrainer() path. The selectors are the ones
// ScrapedDuck's own scraper uses (.rocket-profile, .name, .type img, .slot,
// .shadow-pokemon[data-pokemon|data-type1|data-type2]). Anything that does not
// look like three slots per trainer throws: a layout change must fail loudly,
// never publish a half-parsed lineup.
export function parseLeekDuckLineups(html) {
  const chunks = String(html).split(/<div class="rocket-profile"/).slice(1);
  const lineups = chunks.map((chunk, i) => {
    // .name is plain text. Markup inside it (raw or entity-encoded) is a layout
    // change or a hostile page, never something to strip and carry on with.
    const nameMatch = chunk.match(/<div class="name">([^<]*)<\/div>/);
    if (!nameMatch) throw new Error(`LeekDuck profile #${i + 1}: no plain-text .name`);
    const name = plainText(nameMatch[1]);
    const typeMatch = chunk.match(/<span class="type">\s*<img[^>]*\ssrc="([^"]+)"/);
    const type = typeMatch ? typeMatch[1].split("/").pop().replace(/\.png$/i, "").toLowerCase() : "";

    const slots = chunk.split(/<div class="slot\b/).slice(1).map((slot) =>
      [...slot.matchAll(/<span class="shadow-pokemon"[^>]*>/g)].map(([tag]) => {
        const types = [attr(tag, "data-type1"), attr(tag, "data-type2")]
          .filter((t) => t && t !== "None")
          .map((t) => t.toLowerCase());
        return { name: plainText(attr(tag, "data-pokemon") || ""), types };
      }),
    );
    if (slots.length !== 3) throw new Error(`LeekDuck profile "${name}": ${slots.length} slots, expected 3`);
    if (slots.some((s) => s.length === 0 || s.some((p) => !p.name || p.types.length === 0))) {
      throw new Error(`LeekDuck profile "${name}": empty slot or Pokémon without name/types`);
    }
    return { name, type, firstPokemon: slots[0], secondPokemon: slots[1], thirdPokemon: slots[2] };
  });
  if (lineups.length === 0) throw new Error("LeekDuck page has no .rocket-profile blocks");
  return lineups;
}
