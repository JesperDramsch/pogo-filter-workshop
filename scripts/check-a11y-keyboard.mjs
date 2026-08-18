// Checks the keyboard path to the map pin actually works.
// Run with: npx vite-node scripts/check-a11y-keyboard.mjs
//
// The world-map <svg> used to be the ONLY caller of setLastPin, and
// setHomeLocation is offered only once a pin exists — so without a pointer,
// step 1 of the workshop could not be completed at all. Everything downstream
// of a home location (home-local regional trims, hemisphere and season
// inference, Furfrou travel tips) therefore silently never engaged.
//
// The replacement is a coordinate form plus a region-jump <select>. This pins
// the two things that can quietly break it:
//   K1 — every region offers a finite, in-range centroid to jump to
//   K2 — the coordinate validation accepts real input and rejects junk

import * as d3 from "d3";
import { POGO_REGIONS } from "../src/App.jsx";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

console.log("K1 — every region is reachable by the region-jump select");
{
  const polygonal = POGO_REGIONS.filter(
    (r) => r.geometry?.type === "Polygon" || r.geometry?.type === "MultiPolygon",
  );
  check(`${polygonal.length} polygonal regions in the catalog`, polygonal.length > 0);

  const bad = [];
  for (const r of polygonal) {
    const c = d3.geoCentroid(r.geometry);
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      bad.push(`${r.name}: centroid ${JSON.stringify(c)}`);
    } else if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) {
      bad.push(`${r.name}: out of range ${JSON.stringify(c)}`);
    }
  }
  check("every region yields a finite, in-range centroid", bad.length === 0, bad.slice(0, 4).join(" | "));

  // Names are the option labels and the lookup key, so duplicates would make
  // one of the pair unreachable.
  const names = polygonal.map((r) => r.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check("region names are unique (they key the option lookup)", dupes.length === 0, [...new Set(dupes)].join(", "));
}

console.log("\nK2 — coordinate entry accepts real input and rejects junk");
{
  // Mirrors submitCoords in RegionalMap.
  const parse = (latIn, lonIn) => {
    const latRaw = String(latIn).trim().replace(",", ".");
    const lonRaw = String(lonIn).trim().replace(",", ".");
    // Number('') is 0, so empty must be rejected explicitly or a blank submit
    // silently pins 0°,0° in the Atlantic.
    if (latRaw === "" || lonRaw === "") return null;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return [lon, lat];
  };
  const ok = [
    ["52.52", "13.405", "Berlin"],
    ["-33.87", "151.21", "Sydney"],
    ["0", "0", "null island"],
    ["90", "180", "corner"],
    ["-90", "-180", "opposite corner"],
    ["52,52", "13,405", "comma decimal (de/es/fr keyboards)"],
    ["  51.5  ", " -0.12 ", "surrounding whitespace"],
  ];
  for (const [lat, lon, label] of ok) check(`accepts ${label}`, parse(lat, lon) !== null, `${lat}/${lon}`);

  const bad = [
    ["91", "0", "latitude over 90"],
    ["0", "181", "longitude over 180"],
    ["-91", "0", "latitude under -90"],
    ["abc", "0", "non-numeric"],
    ["", "", "empty"],
    ["NaN", "0", "literal NaN"],
  ];
  for (const [lat, lon, label] of bad) check(`rejects ${label}`, parse(lat, lon) === null, `${lat}/${lon}`);
}

console.log(`\n${failures === 0 ? "✓ All keyboard-path checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
