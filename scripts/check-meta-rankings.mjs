// Offline checks for the raid-attacker pipeline in fetch-meta-rankings.mjs.
// Run with: npx vite-node scripts/check-meta-rankings.mjs
//
// The fetcher's own assertions are thorough, but they only run in the daily
// sync — a PR that breaks the parsing or the damage model goes green. These
// drive the exported parsers from hand-built game-master templates instead, so
// they run on every PR without a 19 MB download and without a network call.
//
// Covers:
//   M1 — battle constants come from battleSettings (PvE), not combatSettings
//   M2 — move parsing: fast/charged split, unnamed ids, Frustration, Hidden Power
//   M3 — species parsing: the release gate, form dedupe, Shadow and battle-only forms
//   M4 — Dynamax eligibility from breadOverrides
//   M5 — the damage model behaves the way the ranking depends on it behaving
//   M6 — the shipped snapshot is internally consistent and app-resolvable

import META_RANKINGS from "../src/data/meta-rankings.json";
import POKEMON_NAMES from "../src/locales/pokemon-names.json";
import LOCALE_EN from "../src/locales/en.json";
import { resolveSpecies } from "../src/data/species.js";
import {
  battleConstants,
  cpMultiplierFor,
  cycleDps,
  evolutionDescendants,
  moveDamage,
  parseMaxEligibility,
  parseMoves,
  parseSpeciesForms,
} from "./fetch-meta-rankings.mjs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// Minimal template helpers — the same shapes the real game master uses.
const move = (movementId, over = {}) => ({
  templateId: `V0001_MOVE_${movementId}`,
  data: { moveSettings: {
    movementId, pokemonType: "POKEMON_TYPE_STEEL", power: 50,
    durationMs: 1000, energyDelta: 10, ...over,
  } },
});
const species = (dex, pokemonId, over = {}) => ({
  templateId: `V${String(dex).padStart(4, "0")}_POKEMON_${over.form || pokemonId}`,
  data: { pokemonSettings: {
    pokemonId, type: "POKEMON_TYPE_STEEL",
    stats: { baseAttack: 200, baseDefense: 180, baseStamina: 170 },
    quickMoves: ["METAL_CLAW_FAST"], cinematicMoves: ["IRON_HEAD"],
    modelScaleV2: 1, ...over,
  } },
});

console.log("M1 — battle constants read the PvE template");
{
  const templates = [
    { templateId: "COMBAT_SETTINGS", data: { combatSettings: {
      sameTypeAttackBonusMultiplier: 9, shadowPokemonAttackBonusMultiplier: 9,
      shadowPokemonDefenseBonusMultiplier: 9 } } },
    { templateId: "BATTLE_SETTINGS", data: { battleSettings: {
      sameTypeAttackBonusMultiplier: 1.2, shadowPokemonAttackBonusMultiplier: 1.2,
      shadowPokemonDefenseBonusMultiplier: 0.8333333, energyDeltaPerHealthLost: 0.5 } } },
  ];
  const c = battleConstants(templates);
  // combatSettings governs PvP. Its Shadow numbers happen to match today, so a
  // pipeline reading the wrong one looks correct until Niantic splits them.
  check("prefers battleSettings over combatSettings", c.source === "battleSettings");
  check("STAB 1.2", c.stab === 1.2);
  check("shadow attack ×1.2", c.shadowAttack === 1.2);
  check("shadow defence ×0.8333333 (not the rounded 0.833)", c.shadowDefense === 0.8333333);
  check("energy per HP lost 0.5", c.energyPerHpLost === 0.5);

  const only = battleConstants([templates[0]]);
  check("falls back to combatSettings if the PvE block vanishes", only.source === "combatSettings");
  const none = battleConstants([]);
  check("falls back to documented defaults with neither", none.source === "defaults" && none.stab === 1.2);

  check("CPM is indexed by level − 1",
    cpMultiplierFor([{ templateId: "PLAYER_LEVEL_SETTINGS",
      data: { playerLevel: { cpMultiplier: [0.094, 0.166, 0.215] } } }], 1) === 0.094);
}

console.log("\nM2 — move parsing");
{
  const parsed = parseMoves([
    move("METAL_CLAW_FAST", { energyDelta: 8, durationMs: 500 }),
    move("IRON_HEAD", { energyDelta: -50, durationMs: 1900, power: 70 }),
    move("FRUSTRATION", { energyDelta: -33 }),
    move("RETURN", { energyDelta: -33 }),
    move("STRUGGLE", { energyDelta: -33 }),
    move("HIDDEN_POWER_BUG_FAST", { energyDelta: 8 }),
    { templateId: "V0482_MOVE_DYNAMAX_CANNON",
      data: { moveSettings: { movementId: 482, pokemonType: "POKEMON_TYPE_DRAGON",
        power: 215, durationMs: 2000, energyDelta: -50 } } },
    move("ZERO_DURATION_FAST", { durationMs: 0, energyDelta: 5 }),
    move("WRONG_SIGN_FAST", { energyDelta: -5 }),
  ]);
  check("fast move kept, flagged fast", parsed.get("METAL_CLAW_FAST")?.fast === true);
  check("charged move kept, energy cost is absolute", parsed.get("IRON_HEAD")?.energy === 50);
  check("charged move not flagged fast", parsed.get("IRON_HEAD")?.fast === false);
  // Frustration is the move a keeper is kept in order to remove; Return only
  // exists once purified. Scoring either ranks a species on an unbuildable set.
  for (const id of ["FRUSTRATION", "RETURN", "STRUGGLE"]) {
    check(`${id} excluded`, !parsed.has(id));
  }
  check("Hidden Power excluded (its type is re-rollable)", !parsed.has("HIDDEN_POWER_BUG_FAST"));
  // This is the one that handed Eternatus a 215-power move and the top Dragon
  // slot: the game master ships a few moves with the raw enum ordinal for a
  // name, and App.jsx cannot localize a number.
  check("unnamed numeric move id excluded", !parsed.has(482) && !parsed.has("482"));
  check("zero-duration move excluded", !parsed.has("ZERO_DURATION_FAST"));
  check("fast move with negative energy excluded", !parsed.has("WRONG_SIGN_FAST"));
  check("type lowercased off the enum", parsed.get("METAL_CLAW_FAST")?.type === "steel");
}

console.log("\nM3 — species parsing");
{
  const forms = parseSpeciesForms([
    species(376, "METAGROSS"),
    species(376, "METAGROSS", { form: "METAGROSS_NORMAL" }),
    species(555, "DARMANITAN", { form: "DARMANITAN_GALARIAN_STANDARD" }),
    species(555, "DARMANITAN", { form: "DARMANITAN_GALARIAN_ZEN" }),
    // Unreleased: full stats and moves, no client render data.
    species(1007, "KORAIDON", { modelScaleV2: undefined }),
    species(150, "MEWTWO", { shadow: { purificationCandyNeeded: 5 },
      pokemonClass: "POKEMON_CLASS_LEGENDARY" }),
    { templateId: "NOT_A_POKEMON", data: { pokemonSettings: { pokemonId: "X", stats: {} } } },
  ]);
  check("bare template and its _NORMAL twin collapse to one form",
    (forms.get(376) || []).length === 1);
  // Zen mode triggers below half HP mid-battle; you cannot select one for a
  // raid, and scoring it put Galarian Darmanitan on top of Ice on false strength.
  const darmanitan = (forms.get(555) || []).map((f) => f.form);
  check("battle-only Zen form dropped, Standard kept",
    darmanitan.length === 1 && darmanitan[0] === "DARMANITAN_GALARIAN_STANDARD",
    darmanitan.join(", "));
  // The game master is not a released-species list — it carries the whole
  // national dex long before Niantic ships it. Unreleased species have no model.
  check("unreleased species gated out by modelScaleV2", !forms.has(1007));
  check("shadow-capable flag read off pokemonSettings.shadow",
    forms.get(150)?.[0]?.shadowCapable === true);
  check("non-shadow species not flagged", forms.get(376)?.[0]?.shadowCapable === false);
  check("pokemonClass preserved for the reference-boss population",
    forms.get(150)?.[0]?.pokemonClass === "POKEMON_CLASS_LEGENDARY");
  check("template ids that are not species are skipped",
    [...forms.values()].flat().every((f) => f.pokemonId !== "X"));

  const descendants = evolutionDescendants(new Map([
    [92, [{ pokemonId: "GASTLY", evolvesTo: ["HAUNTER"], dex: 92 }]],
    [93, [{ pokemonId: "HAUNTER", evolvesTo: ["GENGAR"], dex: 93 }]],
    [94, [{ pokemonId: "GENGAR", evolvesTo: [], dex: 94 }]],
  ]));
  check("evolution closure is transitive (Gastly → Haunter, Gengar)",
    [...(descendants.get(92) || [])].sort((a, b) => a - b).join(",") === "93,94");
  check("a final stage has no descendants", (descendants.get(94) || new Set()).size === 0);
  const cyclic = evolutionDescendants(new Map([
    [1, [{ pokemonId: "A", evolvesTo: ["B"], dex: 1 }]],
    [2, [{ pokemonId: "B", evolvesTo: ["A"], dex: 2 }]],
  ]));
  check("an evolution cycle terminates instead of hanging", cyclic.get(1) instanceof Set);
}

console.log("\nM4 — Dynamax eligibility from the game master's own flags");
{
  const ext = (dex, uniqueId, modes) => ({
    templateId: `EXTENDED_V${String(dex).padStart(4, "0")}_POKEMON_${uniqueId}`,
    data: { pokemonExtendedSettings: { uniqueId,
      breadOverrides: modes.map((breadMode) => ({ breadMode })) } },
  });
  const { dynamax, gigantamax } = parseMaxEligibility([
    ext(6, "CHARIZARD", ["BREAD_MODE", "BREAD_DOUGH_MODE"]),
    ext(530, "EXCADRILL", ["BREAD_MODE"]),
    ext(890, "ETERNATUS", ["BREAD_SPECIAL_MODE"]),
    { templateId: "EXTENDED_V0888_POKEMON_ZACIAN",
      data: { pokemonExtendedSettings: { uniqueId: "ZACIAN" } } },
  ]);
  check("BREAD_MODE ⇒ Dynamax-capable", dynamax.has(6) && dynamax.has(530));
  check("BREAD_DOUGH_MODE ⇒ Gigantamax-capable", gigantamax.has(6));
  check("Dynamax-only species is not Gigantamax", !gigantamax.has(530));
  // Eternamax Eternatus is the raid boss, not a Pokémon you Dynamax.
  check("BREAD_SPECIAL_MODE is not Dynamax", !dynamax.has(890));
  // The hand-maintained seed this replaced claimed Zacian was Dynamax-eligible.
  check("no breadOverrides ⇒ not eligible", !dynamax.has(888));
}

console.log("\nM5 — the damage model");
{
  // floor(0.5 × power × atk/def × STAB × effectiveness) + 1
  check("damage formula matches the game's",
    moveDamage({ power: 100 }, 200, 100, 1.2, 1) === Math.floor(0.5 * 100 * 2 * 1.2) + 1);
  check("the +1 floor means a 0-power move still chips",
    moveDamage({ power: 0 }, 200, 100, 1, 1) === 1);

  const base = {
    fastDamage: 10, fastDurationS: 0.5, fastEnergy: 10,
    chargedDamage: 100, chargedDurationS: 2, chargedEnergy: 50,
    incomingDps: 0, energyPerHpLost: 0.5,
  };
  // With no incoming damage the cadence is purely self-fed: 50/10 = 5 fast
  // moves, so (5×10 + 100) / (5×0.5 + 2) = 150/4.5.
  check("cycle DPS solves the energy balance",
    Math.abs(cycleDps(base) - 150 / 4.5) < 1e-9, String(cycleDps(base)));
  // Taking damage feeds energy, so charged moves come round sooner and DPS
  // rises. This is the term the naive ceil() cycle model throws away.
  check("incoming damage raises DPS (energy from damage taken)",
    cycleDps({ ...base, incomingDps: 20 }) > cycleDps(base));
  check("a fast move that generates no energy cannot cycle",
    cycleDps({ ...base, fastEnergy: 0, incomingDps: 0 }) === 0);
  // n is clamped at 0: a boss can out-feed the charged move's cost, but nobody
  // fires more often than back-to-back.
  const flooded = cycleDps({ ...base, incomingDps: 1000 });
  check("charged-move cadence is floored at back-to-back",
    Number.isFinite(flooded) && flooded > 0 && flooded <= base.chargedDamage / base.chargedDurationS,
    String(flooded));
}

console.log("\nM6 — the shipped snapshot");
{
  const { topAttackers, shadowKeepers, topMaxAttackers, gigantamaxSpecies,
          chargerMoves, perType, shadowPerType, model } = META_RANKINGS;
  const all = [...topAttackers, ...shadowKeepers, ...topMaxAttackers, ...gigantamaxSpecies];
  // The bug this is here to prevent: the previous pogoapi-based sync emitted
  // "tapu-bulu", which resolveSpecies returns null for, and App.jsx's
  // canonicalize() passes unresolved entries through verbatim — straight into a
  // user's filter as a term matching nothing.
  const unresolved = all.filter((s) => !resolveSpecies(s));
  check(`all ${all.length} emitted species resolve`, unresolved.length === 0, unresolved.join(", "));
  check("names are lowercase, as the filter syntax expects",
    all.every((s) => s === s.toLowerCase()));

  for (const [name, list] of Object.entries({ topAttackers, shadowKeepers, topMaxAttackers })) {
    check(`${name} has no duplicates`, new Set(list).size === list.length);
    check(`${name} is non-empty`, list.length > 0);
  }
  check("every Gigantamax species can also Dynamax",
    gigantamaxSpecies.every((s) => topMaxAttackers.includes(s)),
    gigantamaxSpecies.filter((s) => !topMaxAttackers.includes(s)).join(", "));

  const enNames = new Set(Object.entries(POKEMON_NAMES)
    .filter(([k]) => /^\d+$/.test(k))
    .map(([, v]) => String(v.en || "").toLowerCase()));
  check("every per-type entry names a real species",
    Object.values({ ...perType, ...shadowPerType }).flat().every((e) => enNames.has(e.species)));
  check("per-type entries are sorted by rating, descending",
    Object.values({ ...perType, ...shadowPerType })
      .every((l) => l.every((e, i) => i === 0 || l[i - 1].rating >= e.rating)));
  check("every per-type entry carries a full moveset",
    Object.values({ ...perType, ...shadowPerType }).flat()
      .every((e) => e.fast && e.charged && e.dps > 0 && e.tdo > 0));
  check("the union of the per-type cuts is exactly topAttackers",
    new Set(Object.values(perType).flat().map((e) => e.species)).size === topAttackers.length);
  check("the union of the shadow cuts is exactly shadowKeepers",
    new Set(Object.values(shadowPerType).flat().map((e) => e.species)).size === shadowKeepers.length);

  // Charger moves are looked up as `move.<lowercase name>`; a movementId here
  // would emit `@1metal_claw_fast`, which matches nothing in any locale.
  const moveKeys = new Set(Object.keys(LOCALE_EN)
    .filter((k) => k.startsWith("move.")).map((k) => k.slice(5)));
  const unnamed = chargerMoves.filter((m) => {
    const lower = m.name.toLowerCase();
    return !moveKeys.has(lower) && !moveKeys.has(lower.replace(/\s+/g, "-"));
  });
  check(`all ${chargerMoves.length} charger moves have a move-name entry`,
    unnamed.length === 0, unnamed.map((m) => m.name).join(", "));
  check("charger moves are display names, not movementIds",
    chargerMoves.every((m) => !/_|FAST$/.test(m.name)));
  check(`charger moves are all ≤ ${META_RANKINGS.maxChargerDurationMs}ms`,
    chargerMoves.every((m) => m.duration <= META_RANKINGS.maxChargerDurationMs));

  check("the model's provenance is recorded",
    model?.constantsFrom === "battleSettings" && model.shadowAttackMultiplier > 1
      && model.shadowDefenseMultiplier < 1,
    JSON.stringify({ from: model?.constantsFrom }));
  check("a game-master batch stamp is recorded", Boolean(META_RANKINGS.gameMasterTimestamp));
}

console.log(`\n${failures === 0 ? "✓ All meta-ranking checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
