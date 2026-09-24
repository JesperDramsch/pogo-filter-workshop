// Checks species-name autocomplete and the species-list tokenizer.
// Run with: npx vite-node scripts/check-species-suggest.mjs
//
//   A1 — suggestions rank whole-name prefix > word prefix > substring, base
//        species before Mega/Gigantamax, output locale first
//   A2 — tolerant spellings (diacritics, skipped punctuation) suggest AND
//        resolve, and never change what an exact spelling resolves to
//   A3 — multi-word names survive the tokenizer; separate names still split
//   A4 — the caret query is the right run of words in the current chunk
//
// A3 is the one with history: every species editor split on whitespace, so
// the 166 EN/DE names containing a space (Tapu Koko, Mr. Mime, Type: Null,
// the Mega forms) could only be added by dex number.

import {
  POKEMON_NAMES_DICT,
  SUPPORTED_NAME_LOCALES,
  looseName,
  resolveSpecies,
  resolveSpeciesInfo,
  speciesQueryAt,
  splitSpeciesInput,
  suggestSpecies,
} from "../src/data/species.js";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const keys = (q, loc = "de", n) => suggestSpecies(q, loc, n).map((r) => r.dexKey);
// Expected rows are identified by dex key and read back from the name data,
// never written out as names here.
const nameOf = (dexKey, loc) => POKEMON_NAMES_DICT[dexKey][loc];

console.log("A1 — ranking");
{
  const tapuKoko = "785";
  check("word prefix finds a name's second word", keys(looseName(nameOf(tapuKoko, "en")).split(" ")[1]).includes(tapuKoko));
  const pika = keys("pika");
  check("whole-name prefix ranks first", pika[0] === "25", pika.join(","));
  const glurak = keys(nameOf("6", "de"));
  check("base species before its Mega/Gigantamax forms", glurak[0] === "6" && glurak.slice(1).every((k) => k.startsWith("6_")), glurak.join(","));
  const char = suggestSpecies("char", "en");
  check("EN output lists EN prefix matches first", char[0].name.toLowerCase().startsWith("char"), char[0].name);
  check("one row per species", new Set(keys("a", "de", 50)).size === keys("a", "de", 50).length);
  check("limit is respected", suggestSpecies("a", "de", 5).length === 5);
  check("substring matching needs 3+ characters", keys("ka").every((k) => SUPPORTED_NAME_LOCALES.some((l) => {
    const n = POKEMON_NAMES_DICT[k][l];
    return n && looseName(n).split(" ").some((w) => w.startsWith("ka"));
  })));
  check("dex number: exact first, then prefix", keys("25").slice(0, 2).join(",") === "25,250", keys("25").join(","));
  check("dex number rows carry no matched name", suggestSpecies("25")[0].matched === null);
  check("unknown query gives nothing", keys("zzzzq").length === 0);
  check("empty query gives nothing", keys("  ").length === 0);
  const ja = suggestSpecies(nameOf("6", "ja").slice(0, 2), "de");
  check("non-Latin prefix matches", ja.some((r) => r.dexKey === "6"), ja.map((r) => r.dexKey).join(","));
  check("display name follows output locale", suggestSpecies(nameOf("6", "en"), "fr")[0].name === nameOf("6", "fr"));
}

console.log("\nA2 — tolerant spellings");
{
  const cases = [
    ["669", "flabebe"],
    ["83", "farfetchd"],
    ["250", "ho oh"],
    ["250", "hooh"],
    ["122", "mr mime"],
    ["785", "tapukoko"],
  ];
  for (const [dexKey, typed] of cases) {
    check(`"${typed}" resolves to #${dexKey}`, resolveSpeciesInfo(typed)?.dexKey === dexKey, String(resolveSpeciesInfo(typed)?.dexKey));
    check(`"${typed}" suggests #${dexKey} first`, keys(typed)[0] === dexKey, keys(typed).join(","));
  }
  // Every official name still resolves to itself in its own locale: the
  // tolerant fallback runs only after all exact lookups miss.
  const drift = [];
  for (const [dexKey, names] of Object.entries(POKEMON_NAMES_DICT)) {
    for (const loc of SUPPORTED_NAME_LOCALES) {
      const v = names[loc];
      if (!v) continue;
      const got = resolveSpeciesInfo(v, loc);
      if (got && POKEMON_NAMES_DICT[got.dexKey][loc] !== v) drift.push(`${loc}:${v}→${got.dexKey}`);
    }
  }
  check("no exact name resolves to a different species", drift.length === 0, drift.slice(0, 5).join(" | "));
  check("Devanagari vowel signs are kept", looseName(nameOf("785", "hi")) !== nameOf("785", "hi").replace(/[ा-ौ]/g, ""));
  check("a non-name stays unresolved", resolveSpecies("mime") === null);
}

console.log("\nA3 — tokenizer");
{
  const spaced = [];
  for (const [dexKey, names] of Object.entries(POKEMON_NAMES_DICT)) {
    for (const loc of ["en", "de"]) {
      const v = names[loc];
      if (!v || !/\s/.test(v)) continue;
      const toks = splitSpeciesInput(`${v} ${nameOf("25", "en")}`);
      // Compared by name: two Gigantamax Toxtricity forms share one name, so
      // the dex key alone would flag a correct token.
      const first = resolveSpeciesInfo(toks[0]);
      const ok = toks.length === 2 && first?.names[loc] === v && resolveSpeciesInfo(toks[1])?.dex === 25;
      if (!ok) spaced.push(`${v} → ${JSON.stringify(toks)}`);
    }
  }
  check("every multi-word EN/DE name stays one token", spaced.length === 0, spaced.slice(0, 5).join(" | "));
  const list = splitSpeciesInput("pikachu raichu, bisasam;glurak\n25");
  check("whitespace, comma, semicolon and newline still separate", list.join("|") === "pikachu|raichu|bisasam|glurak|25", list.join("|"));
  check("unresolved words stay single tokens", splitSpeciesInput("foo bar").join("|") === "foo|bar");
  check("blank input gives no tokens", splitSpeciesInput("  , ;").length === 0);
}

console.log("\nA4 — caret query");
{
  const at = (v, c) => speciesQueryAt(v, c ?? v.length)?.query ?? null;
  check("completes the last word", at("pikachu r") === "r", String(at("pikachu r")));
  check("keeps a multi-word prefix together", at("pikachu tapu k") === "tapu k", String(at("pikachu tapu k")));
  check("scoped to the current comma chunk", at("tapu koko, pi") === "pi", String(at("tapu koko, pi")));
  check("nothing after a separator", at("pikachu, ") === null && at("pikachu ") === null);
  check("nothing for an empty field", at("") === null);
  check("follows the caret, not the end", at("glu, pika", 3) === "glu", String(at("glu, pika", 3)));
}

console.log(failures === 0 ? "\n✓ all species-suggest checks passed" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
