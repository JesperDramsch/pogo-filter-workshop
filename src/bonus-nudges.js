// Event bonuses → "use this filter now" nudges.
//
// Leek Duck lists each event's bonuses as English prose ("1/2 Stardust cost
// for trades"). Several of them change what a filter the app already builds is
// worth for a few days: half-price trades make the trade filter the thing to
// open, 2× catch Candy makes the Mega planner worth a look before heading out.
// This module reads the prose into a small closed set of nudge kinds; the app
// renders each kind from its own translated string, so the English text never
// reaches the screen.
//
// Three outcomes per bonus string:
//   - a nudge kind (BONUS_KINDS), with an optional `factor` ("½", "2×") or
//     `count` the copy shows,
//   - known but not a nudge (IGNORED_BONUS): a real bonus with no filter
//     behind it (Incense duration, Gift limits, a species' shiny odds), or a
//     paid tier ("GO Pass Deluxe: …"),
//   - unrecognised: scripts/fetch-events.mjs logs these during the sync, the
//     same way it logs spawn names it cannot resolve, so a Leek Duck wording
//     change shows up in the daily job instead of a nudge silently vanishing.
//
// The patterns are pinned to the phrasings the feed carried on 2026-10-31 in
// scripts/check-bonus-nudges.mjs. Pure functions, no React.
//
// IN-PERSON EVENTS: a record may carry `venue: { name, lat, lng }` (the city
// of a Wild Area, GO Tour, Night Out or City Safari, from the fetcher's pinned
// table in scripts/lib/event-venues.mjs). Its bonuses hold in that city only,
// so such a record nudges when the home pin (App.jsx `homeLocation`, a
// [lng, lat] pair) lies within VENUE_RADIUS_KM of the venue, and is hidden
// without a pin. A record spelt as a fixed instant (`isLocalTime: false`) with
// no venue is an in-person event nobody has placed yet, and is hidden too; the
// fetcher writes no bonus record for one, this is the belt to its braces.

// Each kind's target: the area tab and the AreaGroup (`area-group-<id>`) the
// nudge opens. Only groups the app already renders; nothing new is built.
export const BONUS_KINDS = {
	trade_stardust: { area: 'trade', group: 'trades' },
	special_trades: { area: 'trade', group: 'trades' },
	trade_candy: { area: 'trade', group: 'trades' },
	catch_candy: { area: 'catch', group: 'mega-plan' },
	catch_xl: { area: 'catch', group: 'mega-plan' },
	catch_stardust: { area: 'catch', group: 'clean' },
	hatch_distance: { area: 'catch', group: 'clean' },
	hatch_rewards: { area: 'catch', group: 'clean' },
	raid_bonus: { area: 'battle', group: 'raids' },
	max_bonus: { area: 'battle', group: 'raids' },
	max_particles: { area: 'battle', group: 'raids' },
};

// Order in the strip: what the player can act on with a filter in hand first.
const KIND_ORDER = Object.keys(BONUS_KINDS);

// A bonus window longer than this is a Season or a monthly GO Pass: the bonus
// is the standing baseline, not a reason to act this week, and a nudge that
// never goes away is one nobody reads.
export const NUDGE_MAX_SPAN_DAYS = 14;
// How far ahead an upcoming bonus is shown ("from Fri 6 Nov").
export const NUDGE_LOOKAHEAD_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// How close the home pin must be to an in-person event's city for its bonuses
// to nudge. Wide enough for a day trip (Cologne to Bonn is 26 km, Yamagata to
// Sendai 46 km) and for a city-centre pin against a venue in the suburbs,
// narrow enough that London (511 km from Bonn) stays out.
export const VENUE_RADIUS_KM = 150;
const EARTH_RADIUS_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in km between the home pin ([lng, lat], the map's
// order) and a venue ({ lat, lng }, the table's order). Haversine; good to a
// fraction of a percent, which is plenty for a 150 km question.
export function distanceKm(homeLngLat, venue) {
	const [lng1, lat1] = homeLngLat;
	const dLat = rad(venue.lat - lat1);
	const dLng = rad(venue.lng - lng1);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(venue.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// A distance as the card shows it, "9,100 km" rather than "9,140.36 km": the
// nearest 100 km from 1,000 km, the nearest 10 km from 100 km, whole km below.
export function roundDistanceKm(km) {
	if (!Number.isFinite(km)) return null;
	const step = km >= 1000 ? 100 : km >= 100 ? 10 : 1;
	return Math.round(km / step) * step;
}

const hasPin = (home) => Array.isArray(home) && home.length === 2 && home.every(Number.isFinite);
const isVenue = (v) => !!v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;

// How an in-person event's venue stands to the home pin, or null for a record
// with no venue (a global event). `distanceKm` is null without a pin, and
// `near` is then false: an event whose distance nobody can tell is far.
export function venueReach(venue, homeLocation, radiusKm = VENUE_RADIUS_KM) {
	if (!isVenue(venue)) return null;
	const km = hasPin(homeLocation) ? distanceKm(homeLocation, venue) : null;
	return { name: venue.name, distanceKm: km, near: km !== null && km <= radiusKm };
}

// Does this record's bonus apply where the user plays? A record with a venue
// applies within VENUE_RADIUS_KM of it; a fixed-time record without one is an
// in-person event nobody has placed and never applies; anything else is a
// global event and always does.
export function bonusAppliesAtHome(rec, homeLocation, radiusKm = VENUE_RADIUS_KM) {
	if (isVenue(rec?.venue)) return venueReach(rec.venue, homeLocation, radiusKm).near;
	if (rec?.isLocalTime === false) return false;
	return true;
}

const FRACTIONS = { '1/2': '½', '1/3': '⅓', '1/4': '¼', '3/4': '¾' };
const fraction = (s) => FRACTIONS[s] || null;
const multiplier = (s) => `${s}×`;

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const toCount = (s) => {
	const n = /^\d+$/.test(s) ? parseInt(s, 10) : NUMBER_WORDS[String(s).toLowerCase()];
	return Number.isFinite(n) ? n : null;
};

// Checked in order; the first hit wins. `params` turns the match into the
// copy's parameters and may return null to reject a match.
const RULES = [
	// "1/2 Stardust cost for trades", "Trades made will require 50% less Stardust*"
	{ kind: 'trade_stardust', re: /^(1\/2|1\/4|3\/4) Stardust cost for trades\b/i, params: (m) => ({ factor: fraction(m[1]) }) },
	{ kind: 'trade_stardust', re: /^Trades? made will require (50|75|25)% less Stardust/i, params: (m) => ({ factor: { 50: '½', 75: '¼', 25: '¾' }[m[1]] }) },
	// "Up to 6 Special Trades per day",
	// "One additional Special Trade can be made for a maximum of two for the day*"
	{ kind: 'special_trades', re: /^Up to (\w+) Special Trades per day/i, params: (m) => ({ count: toCount(m[1]) }) },
	{ kind: 'special_trades', re: /Special Trades? can be made for a maximum of (\w+)/i, params: (m) => ({ count: toCount(m[1]) }) },
	// "One additional Candy for trading Pokémon",
	// "Trainers level 31 and above will receive one guaranteed Candy XL when trading Pokémon",
	// "One guaranteed Candy XL when trading Pokémon for Trainers level 31 and above"
	{ kind: 'trade_candy', re: /\bCandy(?: XL)? (?:for|when) trading Pokémon\b/i },
	// "2× Candy for catching Pokémon", "2x Catch Candy". A GO Pass Deluxe line
	// is a paid tier and is ignored before it gets here.
	// The lookahead keeps a raid or Max Battle catch line out ("… Pokémon in
	// raids" is a raid bonus, not a wild-catch one).
	{ kind: 'catch_candy', re: /^(\d)\s*[×x] (?:Candy for catching Pokémon(?! in (?:raids|Max Battles))|Catch Candy)\b/i, params: (m) => ({ factor: multiplier(m[1]) }) },
	// "2x Chance for Trainers level 31 and up to receive Candy XL from catching Pokémon"
	{ kind: 'catch_xl', re: /Candy XL from catching Pokémon/i },
	// "2× Stardust for catching Pokémon", "2× Catch Stardust"
	{ kind: 'catch_stardust', re: /^(\d)\s*[×x] (?:Stardust for catching Pokémon(?! in (?:raids|Max Battles))|Catch Stardust)\b/i, params: (m) => ({ factor: multiplier(m[1]) }) },
	// "1/2 Hatch Distance for Eggs placed in Incubators during the event", "1/4 Egg Hatch Distance"
	{ kind: 'hatch_distance', re: /^(1\/2|1\/3|1\/4|3\/4) (?:Egg )?Hatch Distance\b/i, params: (m) => ({ factor: fraction(m[1]) }) },
	// "3× Hatch Candy", "3× Hatch Stardust", "3× Hatch XP",
	// "Increased XP and Stardust from hatching Eggs"
	{ kind: 'hatch_rewards', re: /^\d\s*[×x] Hatch (?:Candy|Stardust|XP)\b/i },
	{ kind: 'hatch_rewards', re: /\bfrom hatching Eggs\b/i },
	// Max Battles before raids: "Candy for catching Pokémon in Max Battles" must
	// not read as a raid line. The catch rules above exclude both settings.
	// "1 additional Candy for catching Pokémon in Max Battles", "+1 Candy from Max Battles",
	// "Additional Candy and Candy XL from Max Battles", "2× XP from completed Max Battles"
	{ kind: 'max_bonus', re: /\b(?:Candy|XP|Stardust)\b.*\b(?:from|in) (?:completed )?Max Battles\b/i },
	// "3/4 Max Particle cost …", "Increased Max Particles from Power Spots …",
	// "Daily Max Particle collection limit increased to 8,000", "8× Max Particles from Power Spots",
	// "Chance to receive Max Particles when catching …", "More Power Spots than usual will be active",
	// "Power Spots will refresh more frequently"
	{ kind: 'max_particles', re: /\bMax Particles?\b|\bPower Spots\b/i },
	// "6 additional Candy for catching Pokémon in raids", "+1 Candy XL from raids (…)",
	// "5,000 additional XP from completed raids", "Up to 10 free Raid Passes per day from Gyms",
	// "Receive up to 14 Raid Passes from spinning Gym Photo Discs",
	// "Remote Raid limit increased to 20 …", "No Remote Raid limit from …",
	// "An additional 5,000 Stardust from Super Mega Raid Battles",
	// "Increased chance to get Rare Candy XL from Raid Battles"
	{ kind: 'raid_bonus', re: /\b(?:Candy|XP|Stardust)\b.*\b(?:from|in) (?:completed )?(?:Super Mega )?(?:raids|Raid Battles)\b/i },
	{ kind: 'raid_bonus', re: /\bRaid Pass(?:es)?\b|\bRemote Raid limit\b/i },
];

// Real bonuses that point at no filter. Listed so the sync only logs what is
// genuinely new; each line names the phrasing it was written for.
export const IGNORED_BONUS = [
	/^GO Pass Deluxe:/i, //                                   paid tier
	/\bIncense\b/i, //                                        "2× Daily Adventure Incense duration", "3-hour Incense"
	/\bLures?\b/i, //                                         "Lure Modules last for 2 hours", "1-hour Lures*"
	/\bGifts?\b/i, //                                         "Open up to 50 Gifts per day", Gift bag and Photo Disc limits
	/\bGO Snapshot\b/i, //                                    "3 GO Snapshot surprise encounters per day"
	/\bRoutes\b/i, //                                         "Chance to encounter mighty Pokémon on Routes"
	/\bGO Safari Balls?\b/i, //                               "Chance to get GO Safari Balls from PokéStops and Gyms"
	/\bParty Play\b/i, //                                     "Party Play lasts for 8 hours"
	/\bkm Eggs from PokéStops\b/i, //                         "Increased chance of 10 km Eggs from PokéStops and Gyms"
	/\bShiny\b/i, //                                          "Increased chance to encounter Shiny Pokémon", "Shiny Chandelure …"
	/\bchance to encounter\b/i, //                            "Increased chance to encounter Minior from 5:00 p.m. …"
	/\bfor catching (?!Pokémon\b)\S/i, //                     one species' catch bonus: "Increased Stardust for catching Minior"
	/\bstickers?\b/i, //                                      "special event stickers from PokéStops and Gifts"
	/\bMystery Box\b|\bCoin Bag\b/i, //                       Meltan / Gimmighoul mechanics
	/^Increased Spawns\b/i, //                                "Increased Spawns"
	/\bMega Level\b/i, //                                     "Chandelure caught from Super Mega Raids will have Mega Level 1 unlocked"
	/\bDynamax Cannon\b/i, //                                 "1/2 Candy and Stardust cost to activate the Dynamax Cannon Adventure Effect"
];

// One bonus string → { kind, factor?, count? } for a nudge, { ignored: true }
// for a known non-nudge, or null for a phrasing nothing here recognises.
export function classifyBonus(text) {
	const s = String(text || '').replace(/\s+/g, ' ').trim();
	if (!s) return null;
	// The paid tier first: "GO Pass Deluxe: 3× Candy for catching Pokémon"
	// would otherwise read as a catch-Candy nudge most players do not have.
	if (/^GO Pass Deluxe:/i.test(s)) return { ignored: true };
	for (const rule of RULES) {
		const m = s.match(rule.re);
		if (!m) continue;
		const params = rule.params ? rule.params(m) : {};
		if (!params || Object.values(params).some((v) => v == null)) continue;
		return { kind: rule.kind, ...params };
	}
	if (IGNORED_BONUS.some((re) => re.test(s))) return { ignored: true };
	return null;
}

// The phrasings in a list of events.json `bonuses` records that classify as
// neither, deduped and sorted (what the fetcher logs).
export function unrecognisedBonuses(records) {
	const out = new Set();
	for (const rec of records || []) {
		for (const b of rec?.bonuses || []) if (!classifyBonus(b)) out.add(b);
	}
	return [...out].sort();
}

const paramKey = (n) => `${n.kind}|${n.factor ?? ''}|${n.count ?? ''}`;

// The nudges to show at `now`, from events.json `bonuses` records
// ({ id, title, start, end, bonuses: [...] }). `start`/`end` are local wall
// clock strings read the way the event card reads them (Date.parse without a
// zone is the viewer's local time).
//
// Returns [{ id, kind, area, group, factor?, count?, start, end, live, sources }]:
//   - live bonuses, and ones starting within NUDGE_LOOKAHEAD_DAYS (`live` false),
//   - nothing from a window over NUDGE_MAX_SPAN_DAYS, nothing already ended,
//   - one nudge per kind and value; back-to-back or overlapping windows of the
//     same bonus (Halloween Part I then Part II) merge into one, so the strip
//     says "until" the real end and not the first part's,
//   - when one kind carries two values at once (2× and 3×), the one ending
//     last is kept and the other dropped, so the strip names a kind once,
//   - an in-person event's record (see IN-PERSON EVENTS above) only when
//     `homeLocation` ([lng, lat]) is within `venueRadiusKm` of its venue.
// `end`/`start` come back as epoch ms; sorted live first, then by KIND_ORDER.
export function bonusNudges(records, now = Date.now(), {
	maxSpanDays = NUDGE_MAX_SPAN_DAYS,
	lookaheadDays = NUDGE_LOOKAHEAD_DAYS,
	homeLocation = null,
	venueRadiusKm = VENUE_RADIUS_KM,
} = {}) {
	const windows = new Map();
	for (const rec of records || []) {
		if (!bonusAppliesAtHome(rec, homeLocation, venueRadiusKm)) continue;
		const start = Date.parse(rec?.start);
		const end = Date.parse(rec?.end);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
		if (end - start > maxSpanDays * DAY_MS) continue;
		const seen = new Set();
		for (const text of rec.bonuses || []) {
			const c = classifyBonus(text);
			if (!c || c.ignored) continue;
			const key = paramKey(c);
			if (seen.has(key)) continue;
			seen.add(key);
			if (!windows.has(key)) windows.set(key, { nudge: c, spans: [] });
			windows.get(key).spans.push({ start, end, title: rec.title });
		}
	}

	const candidates = [];
	for (const [key, { nudge, spans }] of windows) {
		spans.sort((a, b) => a.start - b.start);
		const merged = [];
		for (const s of spans) {
			const last = merged[merged.length - 1];
			if (last && s.start <= last.end) {
				last.end = Math.max(last.end, s.end);
				if (!last.sources.includes(s.title)) last.sources.push(s.title);
			} else {
				merged.push({ start: s.start, end: s.end, sources: [s.title] });
			}
		}
		// The window that matters now: the running one, else the next to start.
		const current = merged.find((w) => w.start <= now && now <= w.end)
			|| merged.find((w) => w.start > now && w.start - now <= lookaheadDays * DAY_MS);
		if (!current) continue;
		const target = BONUS_KINDS[nudge.kind];
		candidates.push({
			id: `${key}|${current.start}`,
			...nudge,
			area: target.area,
			group: target.group,
			start: current.start,
			end: current.end,
			live: current.start <= now,
			sources: current.sources,
		});
	}

	// One nudge per kind: a live one beats an upcoming one, then the later end.
	const byKind = new Map();
	for (const n of candidates) {
		const have = byKind.get(n.kind);
		if (!have || (n.live && !have.live) || (n.live === have.live && n.end > have.end)) byKind.set(n.kind, n);
	}
	return [...byKind.values()].sort(
		(a, b) => Number(b.live) - Number(a.live) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
	);
}
