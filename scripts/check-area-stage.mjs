// Render-level checks for useAreaStage (src/App.jsx), the hook that moves the
// four filter-area panels between (area, settings) states as an animated card.
// Run with: npx vite-node scripts/check-area-stage.mjs
//
// scripts/check-swipe-areas.mjs pins the shape of the code; this pins what the
// stage actually does, in jsdom, under React.StrictMode the way src/main.jsx
// mounts the app. StrictMode runs every effect as mount, cleanup, mount in
// development, and the first version of this hook set its `mounted` ref only
// in the cleanup — so under `npm run dev` the stage believed it was unmounted,
// never swapped faces, never cleared `active`, and locked after the first
// animation while the production build was fine. A regex over the source
// cannot see that; a render can.
//
// Covers:
//   S1 — an area change animates (the old face is still shown mid-way) and
//        ends on the real area with `active` back to false, under StrictMode
//   S2 — a settings change flips: mid-way the old face, then the new one
//   S3 — changes that arrive mid-animation are caught up: it ends on the last
//   S4 — reduced motion swaps instantly and never goes active
//   S5 — a drag pull moves the card and a settle brings it back

import { JSDOM } from "jsdom";
import { createChecker } from "./lib/check.mjs";

// A DOM before anything that looks for one is imported. pretendToBeVisual
// gives jsdom a real requestAnimationFrame, which motion's frameloop needs.
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true });
const { window } = dom;
for (const key of ["document", "HTMLElement", "Element", "Node", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  globalThis[key] = window[key];
}
globalThis.window = window;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
// jsdom has no matchMedia; useReducedMotion asks it once at mount.
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { useAreaStage, FILTER_AREAS } = await import("../src/App.jsx");

const { check, done } = createChecker();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [A, B, C] = FILTER_AREAS;

// Renders the hook and hands every render's result back out.
let latest = null;
function Harness({ area, settings, reduced }) {
  latest = useAreaStage({ area, settings, areas: FILTER_AREAS, reduced });
  return React.createElement("div", { "data-area": latest.area, "data-settings": String(latest.settings) });
}
const root = createRoot(window.document.getElementById("root"));
async function show(props) {
  root.render(React.createElement(React.StrictMode, null, React.createElement(Harness, props)));
  await sleep(20);
}
// Waits for the stage to come to rest on the given state, or gives up.
async function settled(area, settings, timeoutMs = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (latest && !latest.active && latest.area === area && latest.settings === settings) return Date.now() - t0;
    await sleep(10);
  }
  return null;
}

console.log("S1 — an area change under StrictMode");
{
  await show({ area: A, settings: false, reduced: false });
  check("mounts showing the initial area, not active", latest.area === A && latest.active === false);
  await show({ area: B, settings: false, reduced: false });
  await sleep(40);
  check("mid-way the old face is still shown and the stage is active", latest.area === A && latest.active === true);
  const took = await settled(B, false);
  check("ends on the new area with active back to false", took !== null, took === null ? `stuck at area=${latest.area} active=${latest.active}` : `${took}ms`);
  // The regression the review found: a second change after the first.
  await show({ area: C, settings: false, reduced: false });
  check("a second change still ends on its area (the stage did not lock)", (await settled(C, false)) !== null, `area=${latest?.area} active=${latest?.active}`);
}

console.log("\nS2 — a settings flip");
{
  await show({ area: C, settings: true, reduced: false });
  await sleep(40);
  check("mid-flip the filters face is still shown", latest.settings === false && latest.active === true);
  check("ends on the settings face", (await settled(C, true)) !== null, `settings=${latest?.settings} active=${latest?.active}`);
  await show({ area: C, settings: false, reduced: false });
  check("flips back to the filters face", (await settled(C, false)) !== null, `settings=${latest?.settings} active=${latest?.active}`);
}

console.log("\nS3 — changes that arrive mid-animation");
{
  await show({ area: A, settings: false, reduced: false });
  await sleep(30);
  await show({ area: B, settings: true, reduced: false });
  const took = await settled(B, true, 3000);
  check("the stage catches up to the last requested state", took !== null, `area=${latest?.area} settings=${latest?.settings} active=${latest?.active}`);
}

console.log("\nS4 — reduced motion");
{
  await show({ area: B, settings: true, reduced: true });
  await sleep(20);
  await show({ area: A, settings: false, reduced: true });
  await sleep(20);
  check("swaps instantly without going active", latest.area === A && latest.settings === false && latest.active === false);
  check("the card does not move", latest.x.get() === 0 && latest.rotateY.get() === 0);
}

console.log("\nS5 — a pull and a settle");
{
  await show({ area: A, settings: false, reduced: false });
  await settled(A, false);
  latest.pull(-90);
  check("a pull moves and tilts the card and dims it", latest.x.get() === -90 && latest.rotate.get() < 0 && latest.opacity.get() < 1);
  latest.settle();
  await sleep(600);
  check("a settle brings it back to rest", Math.abs(latest.x.get()) < 0.5 && Math.abs(latest.rotate.get()) < 0.05 && latest.opacity.get() > 0.99,
    `x=${latest.x.get()} rotate=${latest.rotate.get()} opacity=${latest.opacity.get()}`);
}

root.unmount();
done("All area-stage checks passed.", (n) => `${n} area-stage check(s) failed.`);
