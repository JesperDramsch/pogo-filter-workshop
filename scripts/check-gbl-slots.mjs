// Offline checks for scripts/lib/gbl-slots.mjs — how a GBL event is split into
// battle slots, and which PvPoke formats each slot is running.
// Run with: npx vite-node scripts/check-gbl-slots.mjs
//
// This matcher only runs inside the daily PvP sync, against a live event feed
// that nothing in CI sees, so every one of its failure modes goes green on the
// PR that introduces it and surfaces days later as a red cron job — or, worse,
// as a snapshot that is quietly wrong while the job stays green. The four cases
// below are all real: they are what the September 2026 "Twilight Trails" feed
// did to the whole-event matcher this replaces.
//
// Covers:
//   S1 — splitting an event into slots (slug segments, display-name segments)
//   S2 — league slots vs cup slots
//   S3 — format matching across a full live season, including the four defects
//   S4 — the runaway-matcher guard, per slot
//   S5 — the fallback path matching through the same code

import { eventSlots, leaguesForSlots, matchEventFormats } from "./lib/gbl-slots.mjs";
import { createChecker } from "./lib/check.mjs";

const { check, done } = createChecker();

// PvPoke's formats[], trimmed to the entries these events can reach. `mega` at
// three caps is the only multi-cap entry, which is what marks it a league
// variant rather than a cup.
const FORMATS = [
  { title: "Mega Great League", cup: "mega", cp: 1500 },
  { title: "Mega Ultra League", cup: "mega", cp: 2500 },
  { title: "Mega Master League", cup: "mega", cp: 10000 },
  { title: "Little Cup", cup: "little", cp: 500 },
  { title: "Catch Cup", cup: "catch", cp: 1500 },
  { title: "Master Premier Cup", cup: "premier", cp: 10000 },
  { title: "Devon Chrysalis Cup", cup: "chrysalis", cp: 1500 },
  { title: "Battle Frontier (Copa Dilúvio)", cup: "copadiluvio", cp: 1500 },
  // Never cups: the open-league pseudo-cup and the site's team builder.
  { title: "GO Battle League", cup: "all", cp: 1500 },
  { title: "Custom", cup: "custom", cp: 1500 },
];

const cupIds = (eventID, name) =>
  [...new Set(matchEventFormats(FORMATS, eventSlots(eventID, name)).map(f => `${f.cup}-${f.cp}`))]
    .sort()
    .join(", ");

console.log("\nS1: an event splits into slots");
{
  const slots = eventSlots(
    "gbl-twilight-trails_great-league_ultra-league-mega-edition_little-cup",
    "Great League, Ultra League: Mega Edition, and Little Cup | Twilight Trails",
  );
  const streams = slots.map(s => s.stream);
  check("the gbl-<season> segment is not a slot",
    !streams.some(s => s.includes("twilight")), streams.join(" | "));
  check("each slug segment is one slot",
    ["great-league", "ultra-league-mega-edition", "little-cup"].every(s => streams.includes(s)),
    streams.join(" | "));
  check("the display name adds no duplicate slots", streams.length === 3, String(streams.length));

  // A season name is dropped from both fields, and for the same reason: a season
  // called "Little Journeys" would otherwise hand every week of it a Little Cup.
  const seasonNamed = eventSlots("gbl-little-journeys_great-league", "Great League | Little Journeys");
  check("a season named after a cup does not name that cup",
    cupIds("gbl-little-journeys_great-league", "Great League | Little Journeys") === "",
    seasonNamed.map(s => s.stream).join(" | "));

  // The name is folded in because a slug can drop a qualifier — so it has to
  // survive on its own when the slug is missing entirely.
  const nameOnly = eventSlots("", "Master League and Little Cup | Twilight Trails");
  check("the display name alone still yields both slots",
    nameOnly.map(s => s.stream).join(" | ") === "master-league | little-cup",
    nameOnly.map(s => s.stream).join(" | "));

  // An eventID with no slot structure degrades to a single slot rather than none.
  const flat = eventSlots("go-battle-day", "");
  check("a slug with no segments is still one slot",
    flat.length === 1 && flat[0].stream === "go-battle-day", flat.map(s => s.stream).join(" | "));
}

console.log("\nS2: league slots and cup slots");
{
  const slotFor = (text) => eventSlots("", text)[0];
  check("a bare league is a league slot", slotFor("Great League").isLeague === true);
  check("a league with an Edition modifier is a league slot",
    slotFor("Ultra League: Mega Edition").isLeague === true);
  check("a cup is a cup slot", slotFor("Little Cup").isLeague === false);
  // The discriminator has to survive a cup that opens with a league name and one
  // that says neither "league" nor "cup".
  check("a cup that names a league in its cap suffix is still a cup slot",
    slotFor("Retro Cup: Great League Edition").isLeague === false);
  check("a cup that opens with a league word is a cup slot",
    slotFor("Master Premier Cup").isLeague === false);
  check("a cup that says neither league nor cup is a cup slot",
    slotFor("Copa Dilúvio").isLeague === false);
  check("a cup slot still reads the cap its suffix names",
    [...slotFor("Retro Cup: Great League Edition").caps].join() === "1500");
  check("a cup slot naming no league carries no cap of its own",
    slotFor("Little Cup").caps.size === 0);
}

console.log("\nS3: formats matched across a live season");
{
  // The full September–November 2026 Twilight Trails rotation, verbatim from
  // ScrapedDuck. Every expectation below is read off the event's own wording.
  const season = [
    ["gbl-twilight-trails_great-league-mega-edition_ultra-league-mega-edition_master-league-mega-edition-split-1",
     "Great League: Mega Edition, Ultra League: Mega Edition, and Master League: Mega Edition | Twilight Trails",
     "mega-10000, mega-1500, mega-2500", "great,ultra,master"],
    ["gbl-twilight-trails_great-league_ultra-league-mega-edition_willpower-cup-great-league-edition",
     "Great League, Ultra League: Mega Edition, and Willpower Cup: Great League Edition | Twilight Trails",
     "mega-2500", "great,ultra"],
    ["gbl-twilight-trails_ultra-league_master-league-mega-edition_retro-cup-great-league-edition",
     "Ultra League, Master League: Mega Edition, and Retro Cup: Great League Edition | Twilight Trails",
     "mega-10000", "ultra,master"],
    ["gbl-twilight-trails_master-league_mega-color-cup-great-league-edition",
     "Master League and Mega Color Cup: Great League Edition | Twilight Trails",
     "", "master"],
    ["gbl-twilight-trails_great-league_ultra-league-mega-edition_little-cup",
     "Great League, Ultra League: Mega Edition, and Little Cup | Twilight Trails",
     "little-500, mega-2500", "great,ultra"],
    ["gbl-twilight-trails_master-league_mega-catch-cup-great-league-edition",
     "Master League and Mega Catch Cup: Great League Edition | Twilight Trails",
     "catch-1500", "master"],
    ["gbl-twilight-trails_great-league_ultra-league-mega-edition_2026-go-laic-cup",
     "Great League, Ultra League: Mega Edition, and 2026 GO LAIC Cup | Twilight Trails",
     "mega-2500", "great,ultra"],
  ];
  for (const [eventID, name, expected, leagues] of season) {
    const label = name.replace(" | Twilight Trails", "");
    const got = cupIds(eventID, name);
    check(`${label} → ${expected || "no cup"}`, got === expected, got || "no cup");
    const gotLeagues = leaguesForSlots(eventSlots(eventID, name)).join(",");
    check(`  …leagues ${leagues}`, gotLeagues === leagues, gotLeagues);
  }

  // The four defects above, stated as the invariants they broke.
  check("a cup named in one slot does not take the cap named in another",
    cupIds("gbl-s_great-league_ultra-league-mega-edition", "Great League and Ultra League: Mega Edition")
      === "mega-2500");
  check("a cup whose name merely starts with Mega is not the Mega league variant",
    cupIds("gbl-s_master-league_mega-color-cup-great-league-edition",
           "Master League and Mega Color Cup: Great League Edition") === "");
  check("two of the three slots may be cups",
    cupIds("gbl-s_little-cup_chrysalis-cup-great-league-edition",
           "Little Cup and Chrysalis Cup: Great League Edition") === "chrysalis-1500, little-500");
  check("a cup at a cap no slot names is still matched when the slot names none",
    cupIds("gbl-s_little-cup", "Little Cup") === "little-500");

  // Standing regressions the whole-token rule already carried.
  check("`all` and `custom` are never cups",
    cupIds("gbl-s_great-league_ultra-league_master-league", "Great League, Ultra League, and Master League")
      === "");
  check("a substring of a token does not match a cup id",
    cupIds("gbl-s_fall-cup-great-league-edition", "Fall Cup: Great League Edition") === "");
  check("a hyphenated slug matches a concatenated cup id",
    cupIds("gbl-s_copa-diluvio", "Copa Dilúvio") === "copadiluvio-1500");
  check("a single-cap format in a league slot is still reachable",
    cupIds("gbl-s_master-league-premier-edition", "Master League: Premier Edition") === "premier-10000");
}

console.log("\nS4: the runaway-matcher guard");
{
  // Two distinct cups in ONE slot is the shape of a matcher inventing them. It
  // throws rather than warns: a warn-only guard on a robot-run job is
  // indistinguishable from no guard, and the run would publish the bogus cups.
  let threw = "";
  try {
    matchEventFormats(FORMATS, eventSlots("", "Little Catch Cup"));
  } catch (e) {
    threw = e.message;
  }
  check("one slot matching two cups throws", threw.includes("2 distinct cups"), threw);
  check("the diagnostic names the slot and the cups",
    threw.includes("Little Catch Cup") && threw.includes("catch") && threw.includes("little"), threw);

  // …and the case that used to throw wrongly must not.
  let ok = true;
  try {
    matchEventFormats(FORMATS, eventSlots(
      "gbl-twilight-trails_great-league_ultra-league-mega-edition_little-cup",
      "Great League, Ultra League: Mega Edition, and Little Cup | Twilight Trails",
    ));
  } catch {
    ok = false;
  }
  check("two cups in two different slots do not throw", ok);
}

console.log("\nS5: the lily-dex fallback matches through the same code");
{
  // The fallback has no formats[]; it synthesizes the same {cup, cp} shape from
  // the cups it ships. It never runs in CI, so a second matcher there would only
  // ever be found wrong on the one day it runs.
  const lilyFormats = [
    { cup: "mega", cp: 1500 }, { cup: "mega", cp: 2500 }, { cup: "mega", cp: 10000 },
    { cup: "little", cp: 500 },
  ];
  const slots = eventSlots(
    "gbl-twilight-trails_great-league_ultra-league-mega-edition_little-cup",
    "Great League, Ultra League: Mega Edition, and Little Cup | Twilight Trails",
  );
  const ids = matchEventFormats(lilyFormats, slots).map(f => `${f.cup}-${f.cp}`).sort().join(", ");
  check("the fallback resolves the same ids as the game master",
    ids === "little-500, mega-2500", ids);
}

done("All GBL slot checks passed.", (n) => `${n} GBL slot check(s) failed.`);
