// Offline checks for the touch swipe between the four filter areas (SwipeAreas
// in src/App.jsx). Run with: npx vite-node scripts/check-swipe-areas.mjs
//
// The gesture only exists on a touch screen, which nothing in CI has, so the
// decision is a pure function and every case is pinned here. The DOM wiring
// is checked by source inspection, the way the a11y scripts do it.
//
// Covers:
//   G1 — direction follows the tabs' order and does not wrap at the ends
//   G2 — short or mostly-vertical gestures are scrolls, not swipes
//   G3 — the panels are wrapped, the map opts out, and nothing blocks scrolling

import { readFileSync } from "node:fs";
import { FILTER_AREAS, SWIPE_MIN_PX, SWIPE_AXIS_RATIO, swipeAreaTarget } from "../src/App.jsx";
import { createChecker } from "./lib/check.mjs";

const { check, done } = createChecker();
const areas = FILTER_AREAS;
const target = (dx, dy, current) => swipeAreaTarget({ dx, dy, areas, current });

console.log("G1 — direction and ends");
{
  const [first, second, , last] = areas;
  check("swipe left from the first area opens the second", target(-120, 0, first) === second);
  check("swipe right from the second area returns to the first", target(120, 0, second) === first);
  check("swipe right on the first area does not wrap to the last", target(120, 0, first) === null);
  check("swipe left on the last area does not wrap to the first", target(-120, 0, last) === null);
  check("an unknown current area yields nothing", target(-120, 0, "nope") === null);
  for (let i = 0; i < areas.length - 1; i++)
    check(`left from ${areas[i]} → ${areas[i + 1]}`, target(-SWIPE_MIN_PX, 0, areas[i]) === areas[i + 1]);
}

console.log("\nG2 — scrolls are not swipes");
{
  const [first, second] = areas;
  check("travel just under the threshold is ignored", target(-(SWIPE_MIN_PX - 1), 0, first) === null);
  check("travel at the threshold commits", target(-SWIPE_MIN_PX, 0, first) === second);
  check("a tap (no travel) is ignored", target(0, 0, first) === null);
  check("a mostly-vertical drag is a scroll", target(-60, -200, first) === null);
  const dyLimit = Math.floor(SWIPE_MIN_PX * 2 / SWIPE_AXIS_RATIO);
  check("a diagonal within the axis ratio still swipes", target(-SWIPE_MIN_PX * 2, dyLimit, first) === second);
  check("a diagonal past the axis ratio does not", target(-SWIPE_MIN_PX * 2, dyLimit + 2, first) === null);
}

console.log("\nG3 — DOM wiring");
{
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const swipe = app.slice(app.indexOf("function SwipeAreas("), app.indexOf("function AreaTabs("));
  check("SwipeAreas exists ahead of AreaTabs", swipe.length > 0);
  check("the four panels sit inside SwipeAreas",
    /<SwipeAreas areas=\{FILTER_AREAS\} current=\{filterArea\} onSelect=\{selectArea\}>\s*<AreaPanel area='catch'/.test(app)
      && /<\/AreaPanel>\s*<\/SwipeAreas>/.test(app));
  check("it never calls preventDefault, so vertical scrolling stays native", !swipe.includes("preventDefault"));
  check("it listens to touch start, move, end and cancel",
    ["onTouchStart", "onTouchMove", "onTouchEnd", "onTouchCancel"].every((h) => swipe.includes(`${h}=`)));
  const ignore = (app.match(/const SWIPE_IGNORE = '([^']*)'/) || [])[1] || "";
  check("text fields, selects and sliders are not swipe surfaces",
    ["input", "textarea", "select", "[data-no-swipe]"].every((sel) => ignore.split(",").map((x) => x.trim()).includes(sel)), ignore);
  const mapBox = app.slice(app.indexOf("function RegionalMap("), app.indexOf("function RegionalMap(") + 20000);
  check("the regional map opts out of swiping", /<div data-no-swipe [^>]*>\s*\{\/\* The map is a POINTER convenience/.test(mapBox));
  check("the tab strip is scrolled back into view after a swipe", swipe.includes("scrollIntoView") && swipe.includes("prefers-reduced-motion"));
}

done("All swipe-areas checks passed.", (n) => `${n} swipe-areas check(s) failed.`);
