// Community Days whose featured Pokémon came with a special background: the
// species list behind the Community Day background pile.
//
// Two halves, for the same reason generations.mjs pins its boundaries: a
// Community Day that has happened never changes, so the past is pinned here
// once, researched by hand, and the future is appended from the event feed.
//
//   LEGACY  — every Community Day from the first one with a special
//             background (December 2024 recap) to 2026-10-29. Each entry is
//             confirmed by two independent sources (LeekDuck and Pokémon GO
//             Hub; the official news site, Serebii and Bulbapedia could not be
//             reached when this was researched). `background: false` is kept
//             for the record and left out of the pile: the December 2025 recap
//             mentions none in either source, and the game master carries no
//             2025 recap background.
//   rolling — each Community Day leak-duck lists from then on, appended by
//             scripts/fetch-events.mjs and never removed (the feed drops an
//             event once it ends). The feed does not say whether a background
//             came with it, so these carry `background: null` and the pile
//             includes them: a species without one only adds Pokémon that
//             `specialbackground` already matches.
//
// The background itself is not one asset: the 2024 recap had its own, Jan–Nov
// 2025 used the current season's, and 2026 has a shared
// LC_SPECIALBACKGROUND_2026_COMMUNITYDAY. `specialbackground` matches all of
// them, and also any other event's special background on these species, which
// no search term can tell apart.

const LD = "https://leekduck.com/events/";
const HUB = "https://pokemongohub.net/post/event/";

// [date, event, [[dex, English name], ...], background, [LeekDuck slug, Hub slug]]
const RAW = [
  ["2024-12-21", "December Community Day 2024", [[69, "Bellsprout"], [113, "Chansey"], [704, "Goomy"], [722, "Rowlet"], [725, "Litten"], [761, "Bounsweet"], [56, "Mankey"], [77, "Ponyta"], [540, "Sewaddle"], [602, "Tynamo"], [728, "Popplio"], [137, "Porygon"], [371, "Bagon"], [155, "Cyndaquil"], [374, "Beldum"]], true, ["december-communityday2024/", "december-community-day-2024/"]],
  ["2025-01-05", "Sprigatito Community Day", [[906, "Sprigatito"]], true, ["january-communityday2025/", "sprigatito-community-day-january-2025/"]],
  ["2025-01-25", "Ralts Community Day Classic", [[280, "Ralts"]], true, ["january-communitydayclassic2025/", "january-2025-cd-classic-ralts/"]],
  ["2025-02-09", "Karrablast and Shelmet Community Day", [[588, "Karrablast"], [616, "Shelmet"]], true, ["february-communityday2025/", "karrablast-and-shelmet-community-day-february-2025/"]],
  ["2025-03-08", "Fuecoco Community Day", [[909, "Fuecoco"]], true, ["march-communityday2025/", "fuecoco-pokemon-go-community-day-march-2025/"]],
  ["2025-03-22", "Totodile Community Day Classic", [[158, "Totodile"]], true, ["march-communitydayclassic2025/", "march-2025-cd-classic-totodile/"]],
  ["2025-04-27", "Vanillite Community Day", [[582, "Vanillite"]], true, ["april-communityday2025/", "april-2025-community-day-vanillite/"]],
  ["2025-05-11", "Pawmi Community Day", [[921, "Pawmi"]], true, ["may-communityday2025/", "pawmi-community-day-may-2025/"]],
  ["2025-05-24", "Machop Community Day Classic", [[66, "Machop"]], true, ["may-communitydayclassic2025/", "may-community-day-classic-machop/"]],
  ["2025-06-21", "Jangmo-o Community Day", [[782, "Jangmo-o"]], true, ["june-communityday2025/", "jangmo-o-community-day/"]],
  ["2025-07-05", "Eevee Community Day Classic", [[133, "Eevee"]], true, ["july-communitydayclassic2025/", "july-2025-community-day-classic-eevee/"]],
  ["2025-07-20", "Quaxly Community Day", [[912, "Quaxly"]], true, ["july-communityday2025/", "quaxly-community-day-july-2025/"]],
  ["2025-08-30", "Rookidee Community Day", [[821, "Rookidee"]], true, ["august-communityday2025/", "august-2025-rookidee/"]],
  ["2025-09-14", "Flabébé Community Day", [[669, "Flabébé"]], true, ["september-communityday2025/", "pokemon-go-flabebe-community-day-september-2025/"]],
  ["2025-10-12", "Solosis Community Day", [[577, "Solosis"]], true, ["october-communityday2025/", "pokemon-go-solosis-community-day-october-2025/"]],
  ["2025-11-30", "Pikipek Community Day", [[731, "Pikipek"]], true, ["november-communityday2025/", "november-community-day-2025-pikipek/"]],
  ["2025-12-06", "December Community Day 2025", [[906, "Sprigatito"], [588, "Karrablast"], [616, "Shelmet"], [909, "Fuecoco"], [582, "Vanillite"], [921, "Pawmi"], [782, "Jangmo-o"], [912, "Quaxly"], [821, "Rookidee"], [669, "Flabébé"], [577, "Solosis"], [731, "Pikipek"], [280, "Ralts"], [158, "Totodile"], [66, "Machop"], [133, "Eevee"]], false, ["december-communityday2025/", "pokemon-go-december-2025-community-day/"]],
  ["2026-01-04", "Piplup Community Day Classic", [[393, "Piplup"]], true, ["january-communitydayclassic2026/", "piplup-community-day-classic-january-2026/"]],
  ["2026-01-18", "Grookey Community Day", [[810, "Grookey"]], true, ["january-communityday2026/", "pokemon-go-january-2026-community-day/"]],
  ["2026-02-01", "Vulpix Community Day", [[37, "Vulpix"]], true, ["february-communityday2026/", "vulpix-and-alolan-vulpix-community-day-february-2026/"]],
  ["2026-03-14", "Scorbunny Community Day", [[813, "Scorbunny"]], true, ["march-communityday2026/", "scorbunny-cd-march-2026/"]],
  ["2026-04-11", "Tinkatink Community Day", [[957, "Tinkatink"]], true, ["april-communityday2026/", "tinkatink-community-day-april-2026/"]],
  ["2026-05-09", "Lechonk Community Day", [[915, "Lechonk"]], true, ["may-communityday2026/", "lechonk-community-day-may-2026-shiny-odds-bonuses-mud-slap-oinkologne/"]],
  ["2026-05-16", "Deino Community Day Classic", [[633, "Deino"]], true, ["may-communitydayclassic2026/", "deino-community-day-classic-2026/"]],
  ["2026-06-20", "Frigibax Community Day", [[996, "Frigibax"]], true, ["june-communityday2026/", "frigibax-community-day-june-2026/"]],
  ["2026-07-04", "Sobble Community Day", [[816, "Sobble"]], true, ["july-communityday2026/", "sobble-community-day-july-2026/"]],
  ["2026-08-16", "Nickit Community Day", [[827, "Nickit"]], true, ["august-communityday2026/", "nickit-community-day-august-2026/"]],
  ["2026-09-12", "Gible Community Day Classic", [[443, "Gible"]], true, ["september-communitydayclassic2026/", "gible-community-day-classic-september-2026/"]],
  ["2026-10-10", "Zorua Community Day", [[570, "Zorua"]], true, ["october-communityday2026/", "zorua-community-day-october-2026/"]],
];

export const LEGACY_COMMUNITY_DAYS = RAW.map(([date, event, species, background, [ld, hub]]) => ({
  date,
  event,
  dex: species.map(([dex]) => dex),
  names: species.map(([, name]) => name),
  background,
  sources: [`${LD}${ld}`, `${HUB}${hub}`],
}));

// The day the legacy list was researched to; feed entries on or before it are
// already pinned and never appended twice.
export const LEGACY_THROUGH = "2026-10-29";

const keyOf = (cd) => `${cd.date}|${cd.event.toLowerCase()}`;

// The Community Days in a leak-duck feed (category-keyed object), each
// resolved with `resolveSpawns` (the events fetcher's name → dex resolver).
// A Community Day is named as one; Spotlight Hours and the like are not.
export function communityDaysFromFeed(feed, resolveSpawns) {
  const out = [];
  for (const list of Object.values(feed || {})) {
    if (!Array.isArray(list)) continue;
    for (const ev of list) {
      if (!/\bcommunity day\b/i.test(ev?.title || "")) continue;
      const date = String(ev.start_time || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const featured = ev.details?.features?.length ? ev.details.features : ev.details?.spawns || [];
      const { spawnDex } = resolveSpawns(featured);
      if (spawnDex.length === 0) continue;
      out.push({ date, event: ev.title, dex: spawnDex, background: null, source: "leak-duck" });
    }
  }
  return out;
}

// Append-only: every previous rolling entry stays, a fresh one is added once,
// and nothing the legacy list already covers is added again.
export function mergeRollingCommunityDays(previous = [], fresh = []) {
  const seen = new Set([...LEGACY_COMMUNITY_DAYS, ...previous].map(keyOf));
  const added = [];
  for (const cd of fresh) {
    if (cd.date <= LEGACY_THROUGH || seen.has(keyOf(cd))) continue;
    seen.add(keyOf(cd));
    added.push(cd);
  }
  const rolling = [...previous, ...added].sort((a, b) => a.date.localeCompare(b.date));
  return { rolling, added };
}

// Every species the pile covers: legacy entries with a background, and every
// rolling entry (the feed can't say, see the header).
export function communityDayBackgroundDex({ legacy = [], rolling = [] } = {}) {
  const dex = new Set();
  for (const cd of legacy) if (cd.background) cd.dex.forEach((d) => dex.add(d));
  for (const cd of rolling) cd.dex.forEach((d) => dex.add(d));
  return [...dex].sort((a, b) => a - b);
}
