// Offline checks for the "best Mega for these spawns" panel on the wild-spawn
// card: the ranking (src/mega-boost.js), the two parsers that feed it
// (megaFormsFromGameMaster in fetch-species-meta, resolveSpawnForm in
// fetch-events) and the snapshots they wrote.
// Run with: npx vite-node scripts/check-mega-boost.mjs
//
// Covers:
//   M1 — ranking: a Mega matches a spawn sharing any boosted type; Megas with
//        the same coverage group; groups order by coverage, then group size;
//        a Mega covering nothing is left out
//   M2 — a Primal ranks by its boostTypes, not its own types
//   M3 — the live pool is the union of the events running at `now`, deduped
//   M4 — megaFormsFromGameMaster: one entry per form with the form's types,
//        Primal boost types pinned, unreleased and unnamed forms left out
//   M5 — resolveSpawnForm: a regional adjective picks the regional form's
//        types; a costume or bare name falls back to the default form
//   M6 — the committed snapshots carry what the panel reads
//   M7 — the built filters, in every output locale: a panel per event, the
//        filter is the top group's species AND the locale's mega-evolve key
//   M8 — the panel's UI strings exist in every locale with their placeholders

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChecker } from "./lib/check.mjs";
import { liveSpawnPool, mergeSpawnForms, rankMegaGroups } from "../src/mega-boost.js";
import { megaFormsFromGameMaster, PRIMAL_BOOST_TYPES } from "./fetch-species-meta.mjs";
import { resolveSpawnForm } from "./fetch-events.mjs";
import { buildNameIndex } from "./fetch-raid-bosses.mjs";
import { POKEMON_NAMES_DICT, pokemonNameFor } from "../src/data/species.js";
import { pogoKeywords } from "../src/i18n/pogo-keywords.js";
import { SUPPORTED_LOCALES } from "../src/i18n/index.js";
import { buildResult } from "./lib/fixture.mjs";
import EVENTS from "../src/data/events.json";
import SPECIES_META from "../src/data/species-meta.json";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { check, done } = createChecker();

const spawn = (dex, types, region = null) => ({ name: String(dex), dex, region, types });
const mega = (key, dex, types, boostTypes = types, kind = "mega") => ({ key, dex, kind, types, boostTypes });

// ── M1 ──
console.log("M1 — ranking");
{
  const pool = [spawn(16, ["normal", "flying"]), spawn(58, ["fire"]), spawn(129, ["water"]), spawn(92, ["ghost", "poison"])];
  const megas = [
    mega("6_3", 6, ["fire", "flying"]),
    mega("18_1", 18, ["normal", "flying"]),
    mega("130_1", 130, ["water", "dark"]),
    mega("9_1", 9, ["water"]),
    mega("306_1", 306, ["steel"]),
  ];
  const groups = rankMegaGroups(pool, megas);
  check("Mega Charizard Y tops: fire OR flying covers Pidgey and Growlithe", groups[0].megas.map((m) => m.key).join() === "6_3" && groups[0].matched.length === 2);
  check("the hit types are the boosted types the pool actually has", groups[0].types.join() === "fire,flying", groups[0].types.join());
  const water = groups.find((g) => g.megas.some((m) => m.key === "130_1"));
  check("Megas with the same coverage group (Mega Gyarados + Mega Blastoise)", water?.megas.map((m) => m.key).join() === "9_1,130_1", water?.megas.map((m) => m.key).join());
  check("a bigger group outranks a smaller one at equal coverage", groups.indexOf(water) < groups.findIndex((g) => g.megas.some((m) => m.key === "18_1")));
  check("a Mega that boosts nothing in the pool is left out", !groups.some((g) => g.megas.some((m) => m.key === "306_1")));
  check("an empty pool ranks nothing", rankMegaGroups([], megas).length === 0);
}

// ── M2 ──
console.log("M2 — Primal boost types");
{
  const pool = [spawn(25, ["electric"]), spawn(10, ["bug"])];
  const kyogre = mega("382_4", 382, ["water"], ["water", "electric", "bug"], "primal");
  const groups = rankMegaGroups(pool, [kyogre, mega("9_1", 9, ["water"])]);
  check("Primal Kyogre covers Pikachu and Caterpie through its boostTypes", groups[0]?.megas[0].key === "382_4" && groups[0].matched.length === 2);
  check("a water-only Mega covers neither", groups.length === 1);
}

// ── M3 ──
console.log("M3 — live pool");
{
  const now = Date.parse("2026-10-15T12:00:00");
  const ev = (start, end, forms) => ({ start, end, spawnForms: forms });
  const events = [
    ev("2026-10-13T10:00:00", "2026-10-19T20:00:00", [spawn(58, ["fire", "rock"], "hisui"), spawn(77, ["fire"])]),
    ev("2026-10-14T10:00:00", "2026-10-16T20:00:00", [spawn(77, ["fire"]), spawn(77, ["psychic"], "galar")]),
    ev("2026-10-10T14:00:00", "2026-10-10T17:00:00", [spawn(570, ["dark"])]),
    ev("2026-10-27T10:00:00", "2026-11-01T10:00:00", [spawn(355, ["ghost"])]),
  ];
  const live = liveSpawnPool(events, now);
  check("only the two running events are live", live.events.length === 2);
  check("their spawns merge, Ponyta's two forms kept apart, the shared one once", live.spawnForms.length === 3, JSON.stringify(live.spawnForms.map((f) => [f.dex, f.region])));
  check("mergeSpawnForms sorts by dex", mergeSpawnForms([[spawn(77, ["fire"])], [spawn(58, ["fire"])]]).map((f) => f.dex).join() === "58,77");
  check("nothing live, nothing pooled", liveSpawnPool(events, Date.parse("2026-12-24T12:00:00")).spawnForms.length === 0);
}

// Synthetic game master, shaped as the real one (see check-data-filters D15).
const pad = (dex) => String(dex).padStart(4, "0");
const T = (t) => (t ? `POKEMON_TYPE_${t}` : undefined);
const evo = (id, type, type2) => ({ tempEvoId: `TEMP_EVOLUTION_${id}`, typeOverride1: T(type), typeOverride2: T(type2) });
const tpl = (dex, form, [type, type2], tempEvoOverrides) => {
  const id = POKEMON_NAMES_DICT[String(dex)].en.toUpperCase();
  const templateId = `V${pad(dex)}_POKEMON_${id}${form ? `_${form}` : ""}`;
  const pokemonSettings = {
    pokemonId: id, ...(form && { form: `${id}_${form}` }), type: T(type), type2: T(type2), tempEvoOverrides,
  };
  return { templateId, data: { templateId, pokemonSettings } };
};
const species = (dex, types, overrides, extraForms = []) => {
  const id = POKEMON_NAMES_DICT[String(dex)].en.toUpperCase();
  const templateId = `FORMS_V${pad(dex)}_POKEMON_${id}`;
  return [
    tpl(dex, null, types, overrides), tpl(dex, "NORMAL", types, overrides),
    ...extraForms.map(([form, formTypes]) => tpl(dex, form, formTypes)),
    { templateId, data: { templateId, formSettings: { pokemon: id, forms: [{ form: `${id}_NORMAL` }] } } },
  ];
};
const templates = [
  ...species(6, ["FIRE", "FLYING"], [evo("MEGA_X", "FIRE", "DRAGON"), evo("MEGA_Y", "FIRE", "FLYING")]),
  ...species(130, ["WATER", "FLYING"], [evo("MEGA", "WATER", "DARK")]),
  ...species(359, ["DARK"], [evo("MEGA", "DARK")]),
  ...species(609, ["GHOST", "FIRE"], [evo("MEGA", "GHOST", "FIRE")]),
  ...species(382, ["WATER"], [evo("PRIMAL", "WATER")]),
  ...species(58, ["FIRE"], undefined, [["HISUIAN", ["FIRE", "ROCK"]]]),
  ...species(77, ["FIRE"], undefined, [["GALARIAN", ["PSYCHIC"]]]),
  ...species(41, ["POISON", "FLYING"]),
];

// ── M4 ──
console.log("M4 — megaFormsFromGameMaster");
{
  const pvpoke = {
    pokemon: [
      { speciesId: "charizard_mega_x", released: true },
      { speciesId: "charizard_mega_y", released: true },
      { speciesId: "gyarados_mega", released: true },
      { speciesId: "absol_mega", released: true },
      { speciesId: "chandelure_mega", released: false },
      { speciesId: "kyogre_primal", released: true },
    ],
  };
  const { forms, unreleased } = megaFormsFromGameMaster(templates, POKEMON_NAMES_DICT, pvpoke);
  const byKey = Object.fromEntries(forms.map((f) => [f.key, f]));
  check("Mega Charizard X and Y are two forms with their own types",
    byKey["6_2"]?.types.join("/") === "fire/dragon" && byKey["6_3"]?.types.join("/") === "fire/flying");
  check("Mega Gyarados carries the Mega's types, not the base form's", byKey["130_1"]?.types.join("/") === "water/dark");
  check("a Mega PvPoke marks unreleased is left out and reported",
    !forms.some((f) => f.dex === 609) && unreleased.includes(POKEMON_NAMES_DICT["609_1"].en), unreleased.join());
  check("a dictionary name with no override (Mega Absol Z) gets no entry",
    forms.filter((f) => f.dex === 359).map((f) => f.key).join() === "359_1");
  const kyogre = forms.find((f) => f.dex === 382);
  check("Primal Kyogre is a primal whose boostTypes are the pinned set",
    kyogre?.kind === "primal" && kyogre.boostTypes.join() === PRIMAL_BOOST_TYPES[382].join() && kyogre.types.join() === "water");
  check("a Mega boosts exactly its own types", forms.filter((f) => f.kind === "mega").every((f) => f.boostTypes.join() === f.types.join()));
}

// ── M5 ──
console.log("M5 — resolveSpawnForm");
{
  const formIdx = buildNameIndex(templates, POKEMON_NAMES_DICT);
  const growlithe = { dex: 58, name: POKEMON_NAMES_DICT["58"].en };
  const ponyta = { dex: 77, name: POKEMON_NAMES_DICT["77"].en };
  const zubat = { dex: 41, name: POKEMON_NAMES_DICT["41"].en };
  const h = resolveSpawnForm("Hisuian Growlithe", growlithe, formIdx);
  check("Hisuian Growlithe resolves to its form: fire/rock, region hisui",
    h?.types.join("/") === "fire/rock" && h.region === "hisui", JSON.stringify(h));
  const g = resolveSpawnForm("Galarian Ponyta", ponyta, formIdx);
  check("Galarian Ponyta is psychic, region galar", g?.types.join() === "psychic" && g.region === "galar", JSON.stringify(g));
  const p = resolveSpawnForm("Ponyta", ponyta, formIdx);
  check("bare Ponyta is the default form: fire, no region", p?.types.join() === "fire" && p.region === null, JSON.stringify(p));
  const z = resolveSpawnForm("Zubat wearing a top hat", zubat, formIdx);
  check("a costume spawn takes the species' types and drops the costume from its name",
    z?.types.join("/") === "poison/flying" && z.name === "Zubat", JSON.stringify(z));
  check("a species the index lacks resolves to null", resolveSpawnForm("Abra", { dex: 63, name: "Abra" }, formIdx) === null);
}

// ── M6 ──
console.log("M6 — committed snapshots");
{
  const forms = SPECIES_META.megaForms || [];
  check("species-meta.json lists Mega forms", forms.length >= 40, `${forms.length}`);
  check("every Mega form is named in the dictionary", forms.every((f) => POKEMON_NAMES_DICT[f.key]?.en));
  check("every Mega form boosts at least its own types",
    forms.every((f) => f.types.length > 0 && f.types.every((t) => f.boostTypes.includes(t))));
  const events = EVENTS.events || [];
  check("every event carries spawnForms", events.length > 0 && events.every((ev) => Array.isArray(ev.spawnForms)));
  check("every spawn form belongs to its event's spawnDex and has types",
    events.every((ev) => ev.spawnForms.every((f) => ev.spawnDex.includes(f.dex) && f.types.length > 0)));
}

// ── M7 ──
console.log("M7 — built filters");
for (const locale of SUPPORTED_LOCALES) {
  const result = buildResult(locale);
  const kw = pogoKeywords(locale);
  const megaKeys = new Set((SPECIES_META.megaForms || []).map((f) => f.key));
  const issues = [];
  for (const ev of result.eventFilters || []) {
    const src = (EVENTS.events || []).find((e) => e.id === ev.id);
    const boost = ev.megaBoost;
    if (!boost) { issues.push(`${ev.id}: no megaBoost`); continue; }
    if (boost.poolSize !== (src?.spawnForms || []).length) issues.push(`${ev.id}: poolSize`);
    if (boost.groups.some((g) => g.megaKeys.some((k) => !megaKeys.has(k)))) issues.push(`${ev.id}: unknown Mega`);
    if (boost.groups.length === 0) continue;
    const topDex = [...new Set(boost.groups[0].megaKeys.map((k) => k.split("_")[0]))];
    const expected = `${topDex.map((d) => pokemonNameFor(d, locale)).join(",")}&${kw.flag.mega_evolve}`;
    if (boost.filter !== expected) issues.push(`${ev.id}: filter ${boost.filter} ≠ ${expected}`);
  }
  check(`${locale}: every event gets a Mega panel, filter = top species & ${kw.flag.mega_evolve}`, issues.length === 0, issues.slice(0, 3).join("; "));
}

// ── M8 ──
console.log("M8 — UI strings");
{
  const KEYS = {
    mega_live_heading: [], mega_live_sub: ["count", "events"], mega_heading: [], mega_any_of: [],
    mega_more: ["count"], mega_covers: ["hits", "total", "types"], mega_none: [],
    mega_filter_label: [], mega_filter_hint: [],
  };
  for (const locale of SUPPORTED_LOCALES) {
    const app = JSON.parse(readFileSync(resolve(ROOT, `src/locales/app/${locale}.json`), "utf8"));
    const bad = Object.entries(KEYS).filter(([k, params]) => {
      const v = app[`app.events.${k}`];
      if (!v) return true;
      const found = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
      return found !== [...params].sort().join();
    }).map(([k]) => k);
    check(`${locale}: every Mega-panel string present with exactly its placeholders`, bad.length === 0, bad.join(", "));
  }
}

done("All Mega-boost checks passed.", (n) => `${n} Mega-boost check(s) failed.`);
