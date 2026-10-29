// Property checks for the sorting piles (docs/sorting-workflow-spec.md, "Pile
// shape"). Every pile goes through buildPile, so every pile is held to the
// same contract here, in every locale:
//
//   P1 — shape: each ① lens is the pile AND the lens, ② is the pile minus
//        starred and tagged, ③ is the pile AND the protection tail, exactly
//   P2 — every step is well formed and fits the in-game search bar
//   P3 — ③ gives a definite "no" for every always-protected kind and still
//        shows what ① and ② leave to the user (scripts/lib/pile-cases.mjs)
//   P4 — ② hides starred and tagged Pokémon and shows the rest
//   P5 — no step of a pile ever matches a Pokémon outside the pile
//   P6 — each lens finds what it names (the hundo lens finds hundos only)
//
// PILE_FAMILIES is the registry: a new pile adds one entry naming where its
// piles come from and which species is in it, and inherits every check.
//
// Run with: npx vite-node scripts/check-piles.mjs

import { evalFilterDetailed, protectionTail, SEARCH_CHAR_BUDGET } from "../src/App.jsx";
import { LOCALES } from "../src/i18n/index.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { pokemonNameFor } from "../src/data/species.js";
import { buildResult, FIXTURE_CONFIG } from "./lib/fixture.mjs";
import { pileCases, pileMon } from "./lib/pile-cases.mjs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const HUNDOS = ["Machop"];
const PILE_FAMILIES = [
  {
    name: "event spawns",
    piles: (r) => (r.eventFilters || []).map((ev) => ({ pile: ev.pile, dex: ev.spawnDex?.[0] })),
  },
  {
    name: "hundo sort",
    piles: (r) => [{ pile: r.hundoPile, dex: 66 }],
    lensCases: {
      hundos: { match: { ivAtk: 15, ivDef: 15, ivHp: 15 }, miss: { ivAtk: 15, ivDef: 15, ivHp: 14 } },
    },
  },
];

const BAD = [/undefined/, /NaN/, /\[object /, /&&|,,/, /^[&,]|[&,]$/, /!!/];
const { PROTECTED, RELEASABLE } = pileCases(FIXTURE_CONFIG);
const localeNames = Object.keys(LOCALES);

for (const fam of PILE_FAMILIES) {
  console.log(`\n${fam.name}`);
  for (const loc of localeNames) {
    const kw = pogoKeywords(loc);
    const tail = protectionTail(kw, FIXTURE_CONFIG).join("&");
    const result = buildResult(loc, { hundos: HUNDOS });
    const entries = fam.piles(result).filter((e) => e.pile);
    const bad = [];
    if (entries.length === 0) bad.push("no pile built");
    for (const { pile, dex } of entries) {
      const where = pile.id;
      const head = pile.overview;
      // P1
      for (const lens of pile.keep) if (!lens.filter.startsWith(`${head}&`)) bad.push(`${where}.${lens.key}: not head & lens`);
      if (pile.sort !== `${head}&!${kw.flag.favorite}&!#`) bad.push(`${where}: ② is not head & !favourite & !#`);
      if (pile.release !== `${head}&${tail}`) bad.push(`${where}: ③ is not head & tail`);
      // P2
      const steps = [["overview", head], ...pile.keep.map((l) => [l.key, l.filter]), ["sort", pile.sort], ["release", pile.release]];
      for (const [k, str] of steps) {
        for (const re of BAD) if (re.test(str)) bad.push(`${where}.${k}: malformed (${re})`);
        if (str.length > SEARCH_CHAR_BUDGET) bad.push(`${where}.${k}: ${str.length} chars`);
      }
      const species = pokemonNameFor(String(dex), "en");
      if (!species) { bad.push(`${where}: member dex ${dex} has no name`); continue; }
      const mon = (o) => pileMon(loc, o, species, dex);
      const verdict = (str, o) => evalFilterDetailed(str, mon(o), loc);
      const note = (v) => (v.unknown.length ? ` (unknown ${v.unknown.join(" ")})` : "");
      // P3
      for (const [label, o] of PROTECTED) {
        const v = verdict(pile.release, o);
        if (v.verdict !== false) bad.push(`${where} ③ ${label}: ${v.verdict}${note(v)}`);
      }
      for (const [label, o] of RELEASABLE) {
        const v = verdict(pile.release, o);
        if (v.verdict !== true) bad.push(`${where} ③ ${label} hidden: ${v.verdict}${note(v)}`);
      }
      // P4
      for (const [label, o, want] of [["starred", { flags: { favorite: true } }, false], ["tagged", { tags: ["Trade"] }, false], ["plain", {}, true]]) {
        const v = verdict(pile.sort, o);
        if (v.verdict !== want) bad.push(`${where} ② ${label}: ${v.verdict}${note(v)}`);
      }
      // P5 — a hundo shiny legendary nobody starred, outside the pile
      const outsider = { families: ["notinthepile"], dex: 0, ivAtk: 15, ivDef: 15, ivHp: 15, flags: { shiny: true } };
      for (const [k, str] of steps) {
        const v = verdict(str, outsider);
        if (v.verdict !== false) bad.push(`${where}.${k} matched a Pokémon outside the pile: ${v.verdict}${note(v)}`);
      }
      // P6
      for (const lens of pile.keep) {
        const c = fam.lensCases?.[lens.key];
        if (!c) continue;
        if (verdict(lens.filter, c.match).verdict !== true) bad.push(`${where}.${lens.key} misses its own kind`);
        if (verdict(lens.filter, c.miss).verdict !== false) bad.push(`${where}.${lens.key} matches a near miss`);
      }
    }
    check(`${loc}: ${entries.length} pile(s)`, bad.length === 0, bad.slice(0, 4).join(" | "));
  }
}

console.log(`\n${failures === 0 ? "✓ All pile checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
