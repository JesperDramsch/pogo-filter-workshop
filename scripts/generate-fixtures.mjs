// Generates src/__fixtures__/default-filter-output.json — the buildFilters
// output for the default config across every supported locale. Used as a
// regression snapshot so silent changes to filter syntax break loudly in CI.
//
// The snapshot itself is built by scripts/lib/fixture.mjs, which check-fixtures
// also imports — so the fields written here and the fields compared there
// cannot drift apart.
//
// Run with: npx vite-node scripts/generate-fixtures.mjs

import { writeFileSync } from "node:fs";
import { buildFixture, countLeaves } from "./lib/fixture.mjs";

const fixture = buildFixture();
const out = "src/__fixtures__/default-filter-output.json";
writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n", "utf8");

const locales = Object.keys(fixture);
console.log(`Wrote ${out}`);
console.log(`Locales: ${locales.join(", ")}`);
console.log(`Pinned values: ${countLeaves(fixture)} across ${Object.keys(fixture[locales[0]]).length} fields per locale`);
console.log(`DE trash: ${fixture.de.trash.slice(0, 80)}${fixture.de.trash.length > 80 ? "…" : ""}`);
console.log(`EN trash: ${fixture.en.trash.slice(0, 80)}${fixture.en.trash.length > 80 ? "…" : ""}`);
