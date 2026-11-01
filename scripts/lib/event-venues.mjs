// Where an in-person event is held: the one hand-maintained table in the
// events fetcher.
//
// leak-duck's feed does not say where an event takes place. A city Wild Area,
// a GO Tour host city, a Pokémon Night Out or a City Safari names its city in
// the title ("Pokémon GO Wild Area 2026: Sendai • Tohoku") and in prose in
// `description` ("Location: Kaohsiung, Taiwan"), and nowhere else; ScrapedDuck
// has an `eventType` and no location either. Without a venue, such an event's
// bonuses ("½ Stardust for trades" for three days in Sendai) would sit in
// every user's nudge strip, so until this table existed the fetcher kept every
// fixed-time event's bonuses out of the strip altogether (TIME FORMS in
// scripts/fetch-events.mjs). With a venue on the record, src/bonus-nudges.js
// shows them only to a home pin within VENUE_RADIUS_KM of the city, and the
// event card folds a far venue's row with its distance.
//
// WHAT IS IN HERE: the fixed-time events on the feed as of 2026-11-01 (Wild
// Area Sendai and Mexico City, Pokémon Night Out London, GO Tour Kaohsiung and
// Los Angeles) and the City Safari city in the snapshot history (Boston). GO
// Battle League rotations are fixed-time too, but carry no bonus, spawn or egg
// list and never reach a record, so they need no entry.
//
// HOW TO ADD ONE: when the sync log shows
//   ⚠ in-person event with no venue … — "<title>"
// add a row whose `match` finds the city in that title as a whole word, with
// the city's coordinates and their source. The city centre is enough: the app
// asks "is my home pin within 150 km?", never "where is the venue gate?".
// Keep the table short, one row per city, and never match a word that could
// appear in a global edition's title ("Global", "Mega Finale").
//
// COORDINATES: GeoNames (geonames.org) city records, read on 2026-11-01 from
// the lutangar/cities.json export of them
// (https://raw.githubusercontent.com/lutangar/cities.json/master/cities.json),
// matched on name and country, disambiguated by admin1 where a name repeats.
// lat/lng are decimal degrees, WGS 84, as GeoNames publishes them.

export const EVENT_VENUES = [
  // Wild Area 2026. GeoNames Sendai, Miyagi (admin1 24), not Sendai, Kagoshima.
  { match: /\bSendai\b/, name: "Sendai", lat: 38.26667, lng: 140.86667 },
  // Wild Area 2026. GeoNames Mexico City, CDMX (admin1 09).
  { match: /\bMexico City\b/, name: "Mexico City", lat: 19.42847, lng: -99.12766 },
  // Pokémon Night Out 2026. GeoNames London, England (admin1 ENG).
  { match: /\bLondon\b/, name: "London", lat: 51.50853, lng: -0.12574 },
  // GO Tour: Alola 2027. GeoNames Kaohsiung, Taiwan (admin1 02).
  { match: /\bKaohsiung\b/, name: "Kaohsiung", lat: 22.61626, lng: 120.31333 },
  // GO Tour: Alola 2027. GeoNames Los Angeles, California (admin1 CA).
  { match: /\bLos Angeles\b/, name: "Los Angeles", lat: 34.05223, lng: -118.24368 },
  // City Safari 2026 (October, in the snapshot history as a local-time event).
  // GeoNames Boston, Massachusetts (admin1 MA), not Boston, GA or NY.
  { match: /\bBoston\b/, name: "Boston", lat: 42.35843, lng: -71.05977 },
];

// The venue an event title names, as { name, lat, lng }, or null when no row
// matches. A copy, never the table's own object, so a record can be written
// and compared without aliasing the pinned row.
export function venueFor(title) {
  const s = String(title || "");
  for (const row of EVENT_VENUES) {
    if (row.match.test(s)) return { name: row.name, lat: row.lat, lng: row.lng };
  }
  return null;
}

// Is this feed event held at one fixed instant (`is_local_time: false`)? On
// every feed seen so far that is the in-person kind, plus the GO Battle League
// rotations. A missing flag reads as local time, as the fetcher's records do.
export function isFixedTimeEvent(ev) {
  return ev?.is_local_time === false;
}

// The venue for a record of this event, and the one place an in-person event
// without a row is noticed: a fixed-time event that no row matches is handed
// to `report(ev, category)`, so the sync log names it and its bonuses stay out
// of the strip until someone adds the row (the safe failure mode). A local-time
// event with no row is simply global, venue null and no report; one WITH a row
// (City Safari is spelt as local time) gets the venue, so its bonuses are
// gated by distance like a fixed-time event's.
export function venueOf(ev, category, report = () => {}) {
  const venue = venueFor(ev?.title);
  if (!venue && isFixedTimeEvent(ev)) report(ev, category);
  return venue;
}
