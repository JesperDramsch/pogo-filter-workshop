// Offline checks for scripts/lib/game-master.mjs and the two catalog builders
// that migrated onto it (regional forms, raid-boss name index).
// Run with: npx vite-node scripts/check-game-master.mjs
//
// Four fetchers now read the Niantic game master instead of pogoapi.net. Their
// own assertions only run in the daily syncs, and each of those pulls 19 MB —
// so a PR that breaks a parser would otherwise go green. These drive the
// exported parsers from hand-built templates instead: no network, no download,
// every PR.
//
// Covers:
//   G1 — payload/shape normalization (wrappers, nesting, junk templates)
//   G2 — evolution steps at FORM granularity, and the chain aggregates
//   G3 — the regional-form catalog off game-master form suffixes
//   G4 — the raid-boss name index (ids, canonical form, apostrophe folding)
//
// The generation table that replaced pogoapi's pokemon_generations feed is
// covered where its consumer is: scripts/check-friend-collect.mjs, Scenario 12.

import {
  dexByPokemonId,
  dexFromTemplateId,
  evoParentsFromSteps,
  evolutionChainsFromSteps,
  evolutionStepsFromGameMaster,
  formSuffix,
  pokemonTemplates,
  releasedDexFromPvpoke,
  templateList,
  typeSlug,
  typesOf,
} from "./lib/game-master.mjs";
import { buildCatalog, validate } from "./fetch-regional-forms.mjs";
import { buildNameIndex } from "./fetch-raid-bosses.mjs";
import { createChecker } from "./lib/check.mjs";

const { check, done } = createChecker();

// A template in the shape the real mirrors publish: the node is repeated under
// `data`, which is where every parser reads it from.
const mon = (dex, name, settings) => {
  const templateId = `V${String(dex).padStart(4, "0")}_POKEMON_${name}`;
  return { templateId, data: { templateId, pokemonSettings: settings } };
};
const T = (t) => `POKEMON_TYPE_${t}`;

console.log("\nG1: payload and template normalization");
{
  const sample = [
    mon(52, "MEOWTH", { pokemonId: "MEOWTH", type: T("NORMAL") }),
    mon(52, "MEOWTH_ALOLA", { pokemonId: "MEOWTH", form: "MEOWTH_ALOLA", type: T("DARK") }),
    { templateId: "COMBAT_V0001_MOVE_WRAP", data: { templateId: "COMBAT_V0001_MOVE_WRAP" } },
    // Prefixed template families carry different payloads and must not be read
    // as species templates.
    { templateId: "SPAWN_V0052_POKEMON_MEOWTH", data: { templateId: "SPAWN_V0052_POKEMON_MEOWTH", pokemonSettings: { pokemonId: "MEOWTH" } } },
    null,
  ];
  check("only V####_POKEMON_ templates with settings are species", pokemonTemplates(sample).length === 2);
  check("dexFromTemplateId reads the padded dex", dexFromTemplateId("V0052_POKEMON_MEOWTH_ALOLA") === 52);
  check("prefixed template families do not match", dexFromTemplateId("EXTENDED_V0052_POKEMON_MEOWTH") === null);
  for (const wrapper of ["template", "templates", "itemTemplate"]) {
    check(`wrapped payload '{ ${wrapper}: [...] }' normalizes`,
      pokemonTemplates({ [wrapper]: sample }).length === 2);
  }
  check("a bare array normalizes", templateList(sample).length === sample.length);
  check("an unrecognized object yields no templates", pokemonTemplates({ foo: 1 }).length === 0);
  check("a null payload yields no templates", pokemonTemplates(null).length === 0);

  const [base, alola] = pokemonTemplates(sample);
  check("a form-less template has no suffix", formSuffix(base) === null);
  check("a form suffix drops the species prefix", formSuffix(alola) === "ALOLA");
  check("typeSlug lowercases the enum tail", typeSlug(T("DARK")) === "dark" && typeSlug("nonsense") === null);
  check("typesOf keeps slot order and drops the absent second type",
    JSON.stringify(typesOf({ type: T("FIRE"), type2: T("FLYING") })) === '["fire","flying"]' &&
    JSON.stringify(typesOf({ type: T("NORMAL") })) === '["normal"]');
  check("dexByPokemonId maps the species enum", dexByPokemonId(sample).get("MEOWTH") === 52);

  check("releasedDexFromPvpoke reads the released flag",
    JSON.stringify([...releasedDexFromPvpoke({
      pokemon: [{ dex: 1, released: true }, { dex: 2, released: false }, { dex: 3, released: true }, { noDex: true }],
    })]) === "[1,3]");
  check("a missing PvPoke payload yields an empty set — never a full roster",
    releasedDexFromPvpoke(null).size === 0);
}

console.log("\nG2: evolution steps are form-granular, and chains aggregate per base");
{
  // The two cases that decide whether a dex-level collapse is safe. It is not:
  //   Zigzagoon — Galarian evolves for 25 and only that form reaches Obstagoon
  //     (100). Kanto costs 50 and stops at Linoone. Collapsing on the dex pair
  //     and keeping the dearest invents a 150-candy line nobody can walk.
  //   Sinistea — the Antique form costs 400 where Phony costs 50. Keeping the
  //     cheapest loses the jump that puts the line in the candy-heavy pool.
  const sample = [
    mon(263, "ZIGZAGOON", { pokemonId: "ZIGZAGOON", evolutionBranch: [{ evolution: "LINOONE", candyCost: 50, form: "LINOONE_NORMAL" }] }),
    mon(263, "ZIGZAGOON_GALARIAN", { pokemonId: "ZIGZAGOON", form: "ZIGZAGOON_GALARIAN", evolutionBranch: [{ evolution: "LINOONE", candyCost: 25, form: "LINOONE_GALARIAN" }] }),
    mon(264, "LINOONE_GALARIAN", { pokemonId: "LINOONE", form: "LINOONE_GALARIAN", evolutionBranch: [{ evolution: "OBSTAGOON", candyCost: 100, form: "OBSTAGOON_NORMAL" }] }),
    mon(264, "LINOONE_NORMAL", { pokemonId: "LINOONE", form: "LINOONE_NORMAL" }),
    mon(862, "OBSTAGOON_NORMAL", { pokemonId: "OBSTAGOON", form: "OBSTAGOON_NORMAL" }),
    mon(854, "SINISTEA_PHONY", { pokemonId: "SINISTEA", form: "SINISTEA_PHONY", evolutionBranch: [{ evolution: "POLTEAGEIST", candyCost: 50, form: "POLTEAGEIST_PHONY" }] }),
    mon(854, "SINISTEA_ANTIQUE", { pokemonId: "SINISTEA", form: "SINISTEA_ANTIQUE", evolutionBranch: [{ evolution: "POLTEAGEIST", candyCost: 400, form: "POLTEAGEIST_ANTIQUE" }] }),
    mon(855, "POLTEAGEIST_PHONY", { pokemonId: "POLTEAGEIST", form: "POLTEAGEIST_PHONY" }),
    mon(855, "POLTEAGEIST_ANTIQUE", { pokemonId: "POLTEAGEIST", form: "POLTEAGEIST_ANTIQUE" }),
    // An item-gated step, and a lure-gated one — the only two conditions the
    // EvoSwap pools key off.
    mon(999, "GIMMIGHOUL", { pokemonId: "GIMMIGHOUL", evolutionBranch: [{ evolution: "GHOLDENGO", evolutionItemRequirement: "ITEM_OTHER_EVOLUTION_STONE_A", evolutionItemRequirementCost: 999 }] }),
    mon(1000, "GHOLDENGO", { pokemonId: "GHOLDENGO" }),
    mon(133, "EEVEE", { pokemonId: "EEVEE", evolutionBranch: [{ evolution: "LEAFEON", candyCost: 25, lureItemRequirement: "ITEM_TROY_DISK_MOSSY" }] }),
    mon(470, "LEAFEON", { pokemonId: "LEAFEON" }),
    // Not evolution steps: a Mega temp-evo and a same-dex form change.
    mon(3, "VENUSAUR", { pokemonId: "VENUSAUR", evolutionBranch: [{ temporaryEvolution: "TEMP_EVOLUTION_MEGA" }] }),
    { templateId: "COMBAT_V0001_MOVE_WRAP", data: { templateId: "COMBAT_V0001_MOVE_WRAP" } },
    null,
  ];
  const steps = evolutionStepsFromGameMaster(sample);
  const step = (p, c) => steps.find((s) => s.parentForm === p && s.childForm === c);
  check("Galarian and Kanto Zigzagoon are separate steps",
    step("ZIGZAGOON", "LINOONE_NORMAL")?.candyCost === 50 &&
    step("ZIGZAGOON_GALARIAN", "LINOONE_GALARIAN")?.candyCost === 25);
  check("mega temp-evo branches are not evolution steps",
    !steps.some((s) => s.parentDex === 3));

  const chains = evolutionChainsFromSteps(steps);
  const zig = chains.get(263);
  check("Zigzagoon's dearest real path is the Galarian 25+100, not a merged 150",
    zig.maxCumulativeCandy === 125, String(zig?.maxCumulativeCandy));
  check("Zigzagoon reaches three stages", zig.maxStages === 3, String(zig?.maxStages));
  check("Zigzagoon's single-jump peak is 100", zig.maxSingleCandy === 100, String(zig?.maxSingleCandy));
  check("Zigzagoon's line ends at Linoone or Obstagoon",
    JSON.stringify([...zig.finalDex].sort((a, b) => a - b)) === "[264,862]");

  const tea = chains.get(854);
  check("Antique Sinistea's 400-candy jump survives", tea.maxSingleCandy === 400, String(tea?.maxSingleCandy));
  check("Sinistea is a two-stage line", tea.maxStages === 2, String(tea?.maxStages));

  check("an evolutionItemRequirement gates the line", chains.get(999).itemGated);
  check("a lureItemRequirement gates the line", chains.get(133).itemGated);
  check("a plain candy evolution does not", !chains.get(263).itemGated);

  check("only true bases get a chain",
    [...chains.keys()].sort((a, b) => a - b).join(",") === "133,263,854,999",
    [...chains.keys()].join(","));

  const parents = evoParentsFromSteps(steps);
  check("child → parent collapses onto dex", parents.get(264) === 263 && parents.get(862) === 264);
  check("bases have no parent", parents.get(263) === undefined);
}

console.log("\nG3: regional-form catalog off game-master form suffixes");
{
  const rows = [
    { dex: 52, name: "Meowth", form: "NORMAL", types: ["normal"] },
    { dex: 52, name: "Meowth", form: "ALOLA", types: ["dark"] },
    { dex: 52, name: "Meowth", form: "GALARIAN", types: ["steel"] },
    { dex: 58, name: "Growlithe", form: "NORMAL", types: ["fire"] },
    { dex: 58, name: "Growlithe", form: "HISUIAN", types: ["fire", "rock"] },
    { dex: 128, name: "Tauros", form: "NORMAL", types: ["normal"] },
    { dex: 128, name: "Tauros", form: "PALDEA_COMBAT", types: ["fighting"] },
    { dex: 128, name: "Tauros", form: "PALDEA_BLAZE", types: ["fighting", "fire"] },
    { dex: 128, name: "Tauros", form: "PALDEA_AQUA", types: ["fighting", "water"] },
    { dex: 194, name: "Wooper", form: "NORMAL", types: ["water", "ground"] },
    { dex: 194, name: "Wooper", form: "PALDEA", types: ["poison", "ground"] },
    { dex: 413, name: "Wormadam", form: "PLANT", types: ["bug", "grass"] },
    { dex: 413, name: "Wormadam", form: "SANDY", types: ["bug", "ground"] },
    { dex: 413, name: "Wormadam", form: "TRASH", types: ["bug", "steel"] },
    // Burmy's cloaks are all pure Bug — no predicate can separate them, so the
    // species must be dropped rather than shipped with wrong predicates.
    { dex: 412, name: "Burmy", form: "PLANT", types: ["bug"] },
    { dex: 412, name: "Burmy", form: "SANDY", types: ["bug"] },
    { dex: 412, name: "Burmy", form: "TRASH", types: ["bug"] },
    // Costume/weather/letter forms are not regional and must be filtered out.
    { dex: 25, name: "Pikachu", form: "NORMAL", types: ["electric"] },
    { dex: 25, name: "Pikachu", form: "COSTUME_2020", types: ["electric"] },
  ];
  const { species, indistinctCount } = buildCatalog(rows);
  const form = (dex, key) => (species[String(dex)]?.forms || []).find((f) => f.key === key);
  check("GALARIAN maps to the galar key", form(52, "galar")?.include.join() === "steel");
  check("HISUIAN maps to the hisui key", form(58, "hisui")?.include.join() === "rock");
  check("PALDEA_COMBAT maps to a variant key",
    form(128, "paldea:combat")?.variant === "combat" &&
    JSON.stringify(form(128, "paldea:combat")?.exclude.sort()) === '["fire","water"]');
  check("plain PALDEA maps to the paldea key", form(194, "paldea")?.include.join() === "poison");
  check("the base form is labelled by its origin region",
    form(52, "base")?.region === "kanto" && form(194, "base")?.region === "johto");
  check("cloak axes carry an axis, not an invented region",
    form(413, "cloak:trash")?.axis === "cloak" && form(413, "cloak:trash")?.include.join() === "steel");
  check("indistinguishable forms drop the species", species["412"] === undefined && indistinctCount === 1);
  check("a species with only non-regional forms is not a picker", species["25"] === undefined);
  check("names come from the dictionary, not the feed", species["52"].name === "Meowth");

  // The fetcher's own hand-verified self-check must pass on this catalog too,
  // minus the cases the fixture above does not cover.
  let validated = true;
  try {
    validate({
      ...species,
      26: { name: "Raichu", forms: [{ key: "base", region: "kanto", include: [], exclude: ["psychic"] }, { key: "alola", region: "alola", include: ["psychic"], exclude: [] }] },
      79: { name: "Slowpoke", forms: [{ key: "galar", region: "galar", include: [], exclude: ["water"] }] },
      157: { name: "Typhlosion", forms: [{ key: "base", region: "johto", include: [], exclude: [] }] },
      724: { name: "Decidueye", forms: [{ key: "base", region: "alola", include: [], exclude: [] }] },
      741: { name: "Oricorio", forms: [
        { key: "style:baile", axis: "style", variant: "baile", include: ["fire"], exclude: [] },
        { key: "style:sensu", axis: "style", variant: "sensu", include: ["ghost"], exclude: [] },
      ] },
    });
  } catch { validated = false; }
  check("the fetcher's hand-verified self-check accepts this catalog", validated);
}

console.log("\nG4: raid-boss name index");
{
  const templates = [
    mon(122, "MR_MIME", { pokemonId: "MR_MIME", type: T("PSYCHIC"), type2: T("FAIRY") }),
    mon(83, "FARFETCHD", { pokemonId: "FARFETCHD", type: T("NORMAL"), type2: T("FLYING") }),
    mon(83, "FARFETCHD_GALARIAN", { pokemonId: "FARFETCHD", form: "FARFETCHD_GALARIAN", type: T("FIGHTING") }),
    mon(52, "MEOWTH_NORMAL", { pokemonId: "MEOWTH", form: "MEOWTH_NORMAL", type: T("NORMAL") }),
    mon(52, "MEOWTH_ALOLA", { pokemonId: "MEOWTH", form: "MEOWTH_ALOLA", type: T("DARK") }),
    mon(250, "HO_OH", { pokemonId: "HO_OH", type: T("FIRE"), type2: T("FLYING") }),
  ];
  const names = {
    122: { en: "Mr. Mime" }, 83: { en: "Farfetch'd" },
    52: { en: "Meowth" }, 250: { en: "Ho-Oh" },
  };
  const idx = buildNameIndex(templates, names);
  check("ids are the game's own species enum, matching lily-dex-api",
    idx.get("mr. mime")?.id === "MR_MIME" && idx.get("ho-oh")?.id === "HO_OH");
  check("types are TitleCase, to match the upstream type index",
    JSON.stringify(idx.get("mr. mime")?.types) === '["Psychic","Fairy"]');
  check("the canonical (form-less or NORMAL) form wins over a regional one",
    JSON.stringify(idx.get("meowth")?.types) === '["Normal"]' &&
    JSON.stringify(idx.get("farfetch\'d")?.types) === '["Normal","Flying"]');
  check("a typographic apostrophe in an event title still resolves",
    idx.get("farfetch’d".toLowerCase().replace(/[‘’ʼ]/g, "'"))?.id === "FARFETCHD");
  check("display names come from the dictionary", idx.get("ho-oh")?.displayName === "Ho-Oh");
  check("a species with no dictionary entry is skipped, not indexed as undefined",
    buildNameIndex(templates, {}).size === 0);
}

done("All game-master checks passed.", (n) => `${n} game-master check(s) failed.`);
