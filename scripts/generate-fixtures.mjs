// Generates src/__fixtures__/default-filter-output.json — the buildFilters
// output for the default config across every supported locale. Used as a
// regression snapshot so silent changes to filter syntax break loudly in CI.
//
// Run with: npx vite-node scripts/generate-fixtures.mjs

import { writeFileSync } from "node:fs";
import { buildFilters, DEFAULT_CONFIG, DEFAULT_HUNDOS } from "../src/App.jsx";
import { LOCALES } from "../src/i18n/index.js";

// Mimic the in-app `t()` lookup so fixture output matches what users see.
function makeTFn(locale) {
  const messages = LOCALES[locale]?.messages || LOCALES.en.messages;
  return (key, opts) => {
    let str = messages[key];
    if (str === undefined && locale !== "en") str = LOCALES.en.messages[key];
    if (str === undefined) return opts && "fallback" in opts ? opts.fallback : key;
    if (opts?.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };
}

const fixture = {};
for (const locale of Object.keys(LOCALES)) {
  const tFn = makeTFn(locale);
  const result = buildFilters(DEFAULT_HUNDOS, DEFAULT_CONFIG, [], locale, tFn);
  fixture[locale] = {
    trash: result.trash,
    trade: result.trade,
    sort: result.sort,
    prestaged: result.prestaged,
    gift: result.gift,
    trashClauseCount: result.trashClauses.length,
    tradeClauseCount: result.tradeClauses.length,
  };
}

const out = "src/__fixtures__/default-filter-output.json";
writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n", "utf8");
console.log(`Wrote ${out}`);
console.log(`Locales: ${Object.keys(fixture).join(", ")}`);
console.log(`DE trash: ${fixture.de.trash.slice(0, 80)}${fixture.de.trash.length > 80 ? "…" : ""}`);
console.log(`EN trash: ${fixture.en.trash.slice(0, 80)}${fixture.en.trash.length > 80 ? "…" : ""}`);
