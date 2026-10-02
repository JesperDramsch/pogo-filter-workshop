// Offline checks for scripts/lib/rocket-takeover.mjs — the takeover-gated
// direct read of LeekDuck's Rocket lineup page.
// Run with: npx vite-node scripts/check-rocket-takeover.mjs
//
// This only runs inside the daily Rocket sync against live pages nothing in CI
// sees, so every case is pinned here. The fixtures are the 2026-10-02 shapes:
// "Harvest Festival: Taken Over" in leak-duck's feed and in this repo's own
// events snapshot, and one LeekDuck .rocket-profile block per trainer kind.
//
// Covers:
//   T1 — takeover detection: title, bonus line, description; plain events are not takeovers
//   T2 — the live window, widened for local-time events, and both feed shapes
//   T3 — read gating: once per UTC day, never once settled, fresh for a new takeover
//   T4 — LeekDuck parsing matches ScrapedDuck's shape; layout drift and markup in names throw

import {
  isTakeoverEvent,
  findActiveTakeover,
  shouldReadLeekDuck,
  parseLeekDuckLineups,
} from "./lib/rocket-takeover.mjs";
import { createChecker } from "./lib/check.mjs";

const { check, done } = createChecker();

const HFTO = {
  title: "Harvest Festival: Taken Over",
  article_url: "https://leekduck.com/events/harvest-festival-taken-over-2026/",
  is_local_time: true,
  start_time: "2026-10-02T00:00:00",
  end_time: "2026-10-05T20:00:00",
  description: "Rescue Shadow Zekrom as Team GO Rocket takes over the Harvest Festival!",
  details: { bonuses: ["More Team GO Rocket appearances at PokéStops and in balloons"] },
};
const HARVEST = {
  title: "Harvest Festival 2026: Applin Picking",
  article_url: "https://leekduck.com/events/harvest-festival-2026/",
  is_local_time: true,
  start_time: "2026-09-29T10:00:00",
  end_time: "2026-10-05T20:00:00",
  details: { bonuses: ["2× Catch Candy"] },
};
const FEED = { Event: [HARVEST, HFTO], "Raid Battles": [] };

console.log("T1 — takeover detection");
check("title 'Taken Over' is a takeover", isTakeoverEvent({ title: "Harvest Festival: Taken Over" }));
check("title 'Takeover' is a takeover", isTakeoverEvent({ title: "Team GO Rocket Takeover" }));
check("a Rocket bonus line alone is a takeover",
  isTakeoverEvent({ title: "Some Event", details: { bonuses: ["More Team GO Rocket appearances"] } }));
check("a 'Team GO Rocket takes over' description alone is a takeover",
  isTakeoverEvent({ title: "Some Event", description: "Team GO Rocket takes over PokéStops" }));
check("an ordinary event is not", !isTakeoverEvent(HARVEST));
check("null is not", !isTakeoverEvent(null));

console.log("\nT2 — live window");
const at = (iso) => Date.parse(iso);
check("live on its first day", findActiveTakeover(FEED, at("2026-10-02T08:13:00Z"))?.title === HFTO.title);
check("live from UTC+14 midnight (01 Oct 10:00 UTC)", !!findActiveTakeover(FEED, at("2026-10-01T10:30:00Z")));
check("not live the day before that", findActiveTakeover(FEED, at("2026-10-01T09:00:00Z")) === null);
check("still live in UTC-12 after the local end", !!findActiveTakeover(FEED, at("2026-10-06T07:00:00Z")));
check("over a day after the end", findActiveTakeover(FEED, at("2026-10-07T00:00:00Z")) === null);
check("id is the article URL (stable across syncs)",
  findActiveTakeover(FEED, at("2026-10-02T08:13:00Z"))?.id === HFTO.article_url);
const SNAPSHOT = { events: [{ id: "event-harvest-festival-taken-over-2026-10-02t00-00-00", title: HFTO.title,
  start: HFTO.start_time, end: HFTO.end_time, isLocalTime: true }] };
check("the repo's own events.json shape works as the fallback",
  findActiveTakeover(SNAPSHOT, at("2026-10-02T08:13:00Z"))?.title === HFTO.title);
check("missing / malformed source → null",
  findActiveTakeover(null, Date.now()) === null && findActiveTakeover({ Event: "x" }, Date.now()) === null);

console.log("\nT3 — read gating");
const TO = { id: HFTO.article_url };
check("no takeover → no read", !shouldReadLeekDuck(null, undefined, "2026-10-02"));
check("first sight of a takeover → read", shouldReadLeekDuck(TO, undefined, "2026-10-02"));
check("already tried today → no read",
  !shouldReadLeekDuck(TO, { id: TO.id, attempts: ["2026-10-02"], settled: false }, "2026-10-02"));
check("tried yesterday, unsettled → read",
  shouldReadLeekDuck(TO, { id: TO.id, attempts: ["2026-10-02"], settled: false }, "2026-10-03"));
check("settled → never again for this takeover",
  !shouldReadLeekDuck(TO, { id: TO.id, attempts: ["2026-10-02"], settled: true }, "2026-10-04"));
check("state from an older takeover does not block a new one",
  shouldReadLeekDuck({ id: "next" }, { id: TO.id, attempts: ["2026-10-02"], settled: true }, "2026-10-02"));

console.log("\nT4 — LeekDuck parsing");
const mon = (name, t1, t2 = "None") =>
  `<span class="shadow-pokemon" data-pokemon="${name}" data-type1="${t1}" data-type2="${t2}" data-double-weaknesses="" data-single-weaknesses="">` +
  `<span class="image-wrapper"><img class="pokemon-image" src="x.png" alt="${name}" /></span></span>`;
const slot = (cls, ...mons) => `<div class="slot ${cls}"><span class="number">1</span><span class="shadow-pokemon-wrapper">${mons.join("")}</span></div>`;
const profile = (name, typeImg, slots) =>
  `<div class="rocket-profile" style="--x: #000;"><div class="employee-info"><span class="name-title-wrapper">` +
  `<div class="name">${name}</div><div class="title">Team GO Rocket</div></span>` +
  (typeImg ? `<span class="type"><img loading="lazy" src="/assets/img/type_symbols/${typeImg}.png" alt="" /></span>` : "") +
  `</div><div class="lineup-info">${slots.join("")}</div></div>`;
const PAGE = "<html><body>" +
  profile("Giovanni", null, [slot("", mon("Persian", "normal")), slot("", mon("Rhyperior", "ground", "Rock")), slot("encounter", mon("Zekrom", "dragon", "Electric"))]) +
  profile("Fire-type Female&nbsp;Grunt", "fire", [slot("encounter", mon("Litwick", "ghost", "Fire")), slot("", mon("Ponyta", "fire")), slot("", mon("Slugma", "fire"))]) +
  profile("Decoy Female&nbsp;Grunt", null, [slot("", mon("Ralts", "psychic", "Fairy")), slot("", mon("Kirlia", "psychic", "Fairy")), slot("", mon("Gardevoir", "psychic", "Fairy"))]) +
  "</body></html>";
const parsed = parseLeekDuckLineups(PAGE);
check("three profiles parsed", parsed.length === 3);
check("leader has no type and three slots",
  parsed[0].type === "" && parsed[0].thirdPokemon[0]?.name === "Zekrom");
check("dual types are lowercased, 'None' dropped",
  JSON.stringify(parsed[0].secondPokemon[0].types) === '["ground","rock"]' &&
  JSON.stringify(parsed[0].firstPokemon[0].types) === '["normal"]');
check("&nbsp; in a grunt name becomes a plain space (ScrapedDuck's naming)",
  parsed[1].name === "Fire-type Female Grunt");
check("typed grunt type comes from the type icon", parsed[1].type === "fire");
check("generic grunt has an empty type", parsed[2].type === "");
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
check("a page without profiles throws", throws(() => parseLeekDuckLineups("<html></html>")));
check("a profile with two slots throws",
  throws(() => parseLeekDuckLineups(profile("Cliff", null, [slot("", mon("Cubone", "ground")), slot("", mon("Snorlax", "normal"))]))));
check("a Pokémon without types throws",
  throws(() => parseLeekDuckLineups(profile("Cliff", null, [slot("", mon("Cubone", "None")), slot("", mon("Snorlax", "normal")), slot("", mon("Tyranitar", "rock", "Dark"))]))));

check("a name that decodes to markup throws",
  throws(() => parseLeekDuckLineups(profile("&lt;script&gt;x", null, [slot("", mon("Cubone", "ground")), slot("", mon("Snorlax", "normal")), slot("", mon("Tyranitar", "rock", "Dark"))]))));
check("a name containing a tag throws (never stripped)",
  throws(() => parseLeekDuckLineups(profile("<b>Cliff</b>", null, [slot("", mon("Cubone", "ground")), slot("", mon("Snorlax", "normal")), slot("", mon("Tyranitar", "rock", "Dark"))]))));
check("a Pokémon name that decodes to markup throws",
  throws(() => parseLeekDuckLineups(profile("Cliff", null, [slot("", mon("&lt;img&gt;", "ground")), slot("", mon("Snorlax", "normal")), slot("", mon("Tyranitar", "rock", "Dark"))]))));

done("All rocket takeover checks passed.", (n) => `${n} rocket takeover check(s) failed.`);
