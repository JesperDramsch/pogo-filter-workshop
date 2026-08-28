#!/usr/bin/env node
// Derives the raid-attacker allowlists App.jsx seeds its Step-3 chip editors
// with — topAttackers, shadowKeepers, topMaxAttackers — by simulating raid
// damage against a reference boss, straight from the PokeMiners game master.
//
// WHY THIS REPLACED THE PREVIOUS SCORING. The old version ranked species by
// `base_attack × max charged-move power of that type` off pogoapi.net. That
// proxy has no fast move in it at all: no energy generation, no move duration,
// no bulk, no STAB. It therefore rewarded species that own one high-power
// charged move and nothing to fuel it, which is how Komala, Octillery,
// Liepard, Muk and Cacturne ended up in a "top raid attackers" list next to
// Mewtwo. A cycle-DPS model fixes the ordering because it prices the whole
// moveset — you cannot fire Hydro Cannon without the energy to reach it.
//
// WHY THE GAME MASTER IS NOW THE ONLY UPSTREAM. pogoapi.net is a derived,
// re-published mirror; the game master is what the game itself ships, and it
// is the only source that carries the three mechanics this script needs to be
// correct rather than approximate:
//   - battleSettings — the live STAB and Shadow multipliers, so the Shadow
//     ranking uses the game's own numbers instead of a hard-coded 1.2/0.83.
//   - pokemonSettings.shadow — which species actually exist as Shadow, which
//     is what makes shadowKeepers derivable at all.
//   - pokemonExtendedSettings.breadOverrides — Niantic's internal name for
//     Dynamax ("bread"): BREAD_MODE marks a Dynamax-capable species and
//     BREAD_DOUGH_MODE a Gigantamax one. That retires the hand-maintained
//     DYNAMAX_ELIGIBLE_SEED, which had drifted wrong: it listed Zacian,
//     Zamazenta, Urshifu, Eternatus, Lugia, Ho-Oh and the legendary birds as
//     Dynamax-eligible, and none of them carry breadOverrides.
// TWO SOURCES, SPLIT BY WHAT EACH IS ACTUALLY GOOD FOR. The game master is the
// only published source of PvE move mechanics — power, durationMs and
// energyDelta for raids, as opposed to the turn-based PvP numbers every other
// feed carries — so the damage model has to come from it. But "the game master"
// is a mirror of a Niantic dump, and mirrors stall.
//
// The obvious mirror, PokeMiners, is the one that stalled: it served a
// 2026-04-17 batch for at least 133 days, still carrying pre-Season-27 values
// for every move that rebalance touched (scripts/fetch-game-master-watch.mjs
// documents the four). alexelgt/game_masters is the same dump, published every
// one to three days — 57 commits in the three months before this was written —
// and it is transitively where DialgaDex's numbers come from, since its
// resource repo (mgrann03/pokemon-resources) regenerates from that file. So
// alexelgt is the primary and PokeMiners the fallback: a stalled mirror still
// beats no mechanics, and a second source costs one request.
//
// The difference is not academic. Run against the April batch, this script
// missed thirty Dynamax-capable species released since — Rhyperior, Hydreigon,
// Magmortar, Electivire, Milotic, Weavile, Gyarados, Registeel and more — and
// twenty moves. The staleness warning in scripts/lib/game-master.mjs makes a
// stall loud rather than silent, and the snapshot records which mirror answered
// and when.
//
// The ROSTER — which species are released, and which have a Shadow form — comes
// from PvPoke's game master instead, which fetch-pvp-rankings.mjs and
// fetch-game-master-watch.mjs already read and which rebuilds daily:
//   - `released` — an explicit flag, replacing the modelScaleV2 heuristic below
//     as the primary gate (the heuristic stays as the offline fallback).
//   - `shadowPokemon` — unioned with the game master's own shadow blocks, so
//     neither a stalled mirror nor PvPoke's flat list can drop a keeper on its
//     own. The game master is the side that knows a Shadow's whole evolution
//     line; PvPoke is the side that is guaranteed current.
// The two agree where both are current: PvPoke independently says Espeon,
// Sylveon, Glaceon, Togekiss and Roserade have no Shadow form, which is what
// the game master and the Rocket lineup snapshot both say too.
// Dynamax eligibility stays game-master-only — PvPoke carries no Max data at
// all, so there is nothing to union it with.
//
// Dropping pogoapi also removes its name-mangling bug. It publishes display
// names that the old script normalized by string munging, so the Tapus came
// out as "tapu-bulu"/"tapu-lele"/"tapu-koko" — none of which resolveSpecies
// can match (the dictionary has "Tapu Bulu"). App.jsx's canonicalize() passes
// an unresolved entry through verbatim, so all three silently shipped into
// users' filters as dead search terms. Keying species by dex number out of
// the template id and reading the name from the repo's own dictionary makes
// that class of bug impossible: every emitted name round-trips through
// resolveSpecies by construction, and the assertions below prove it.
//
// THE MODEL. For every released species × form × moveset, in a normal and (if
// the species has a shadow entry) a Shadow variant:
//
//   Atk = (baseAttack  + 15) × CPM(level) × shadowAttackMultiplier
//   Def = (baseDefense + 15) × CPM(level) × shadowDefenseMultiplier
//   HP  = floor((baseStamina + 15) × CPM(level))
//   dmg(move) = floor(0.5 × power × Atk/Def_boss × STAB × effectiveness) + 1
//
// Steady-state cycle DPS. The attacker gains energy two ways: from its own
// fast moves, and from damage taken (battleSettings.energyDeltaPerHealthLost,
// 0.5 energy per HP lost). Solving the energy balance for `n`, the number of
// fast moves per charged move, gives a real-valued cadence rather than the
// ceil() a naive cycle uses — energy carries over between cycles, and a boss
// hitting you hard genuinely buys you extra charged moves:
//
//   n × E_fast + 0.5 × y × (n × T_fast + T_charged) = E_charged
//   ⇒ n = (E_charged − 0.5 × y × T_charged) / (E_fast + 0.5 × y × T_fast)
//   ⇒ DPS = (n × dmg_fast + dmg_charged) / (n × T_fast + T_charged)
//
// where y is the boss's DPS against this attacker. Time on field is HP / y,
// so TDO = DPS × HP / y, and the ranking metric is the standard mixture
//
//   rating = DPS × TOF^RATING_EXPONENT = DPS^(1−e) × TDO^e
//
// where e is RATING_EXPONENT, set and justified with the other tunables below
// rather than repeated here — this comment carried a stale 0.15 through the
// change that settled on 0.25, which is exactly the drift naming it twice
// invites. e = 0 would be raw DPS and rank glass cannons top; e = 1 would be
// raw TDO and rank blobs top. dps and tdo are emitted alongside the rating so
// the exponent can be second-guessed without a re-fetch.
//
// The reference boss is deliberately GENERIC — neutral type effectiveness, no
// weather. Per-boss counters are a different feature with a different source
// (raidFilters, off src/data/raid-bosses.json); this list answers "which of my
// Pokémon are worth powering up at all", where assuming a boss type would be
// wrong. Its stats are derived rather than invented: median base stats across
// released legendary-class species (the tier-5 population), at the tier-5 raid
// CPM, with a median-fast + median-charged moveset. So the reference drifts
// only when Niantic ships new legendaries, never on a whim of this script.
//
// WHAT IS NOT MODELLED, on purpose: weather boost (unknowable at sync time),
// party power, dodging, relobby time (so this is DPS/TDO, not DialgaDex's
// eDPS), and Mega/Primal forms. Megas are excluded because they are a
// separate mechanic with a separate filter (megaEvolve) and a separate pack
// (megaDex in species-meta.json) — folding a Mega's stats into its base
// species would tell a user to power up a Charizard on the strength of a
// form they can only hold for four hours.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGameMaster, fetchPvpokeGameMaster } from "./lib/game-master.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "meta-rankings.json");
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");
// The EN glossary, read for one job only: confirming every emitted charger
// move has a `move.<name>` entry the app can localize (see chargerMoves below).
const LOCALE_EN = JSON.parse(readFileSync(resolve(ROOT, "src/locales/en.json"), "utf8"));

// The game master and PvPoke's roster are both fetched through
// scripts/lib/game-master.mjs — the mirror preference list, the batch stamp,
// the staleness warning and the download cache live there, shared with the
// three other fetchers that read the same dump.

const TYPES = [
  "normal", "fighting", "flying", "poison", "ground", "rock",
  "bug", "ghost", "steel", "fire", "water", "grass",
  "electric", "psychic", "ice", "dragon", "dark", "fairy",
];

// ── Tunables ────────────────────────────────────────────────────────────────

// Per-type cut for each list. 6 per type × 18 types, deduped, lands near the
// ~70-100 the chip editor was sized for.
//
// shadowKeepers cuts at 7 by explicit choice. Each keeper costs a `!+species`
// clause in shadowSafe, a `+species` term in shadowFrustration and one more in
// the trash crypto floor, so the depth trades roster coverage against the
// length of a string that gets typed into the game's search box. A shallower
// cut of 5 dropped two picks the community treats as canonical — Shadow
// Machamp sat 6th in Fighting and Shadow Swampert 7th in Water, both within a
// few percent of the cut — because those are the two deepest Shadow pools.
// Anyone who disagrees can delete chips; the list is a seed, not a verdict.
const TOP_PER_TYPE = 6;
const SHADOW_TOP_PER_TYPE = 7;

// Attacker level. 40 is the stardust-efficient standard the community builds
// to, and the ranking is a comparison — every candidate is evaluated at the
// same level, so the cut barely moves at 50.
const ATTACKER_LEVEL = 40;
const ATTACKER_IV = 15;

// Tier-5 raid bosses fight at a fixed CPM with a 15/15/15 IV floor. This is a
// server-side constant — it is not in the game master, so it lives here.
const RAID_BOSS_CPM = 0.79;
const RAID_BOSS_IV = 15;

// Rating mixture exponent — see the header for the formula. The community's
// fitted values sit between 0.15 ("TER") and 0.25 ("ER"); this uses 0.25.
// The per-type cuts are strikingly insensitive to it — Steel, Ice and Dragon
// return the same five species anywhere from 0.15 to 0.35 — so the choice only
// arbitrates the frail-vs-bulky borderline, and 0.25 is where it lands the way
// the community reads it: Shadow Sharpedo (TDO 129) drops out of the Water cut
// and Shadow Swampert (TDO 273) takes its place. That is the same glass-cannon
// penalty DialgaDex says it tuned its own metric for.
const RATING_EXPONENT = 0.25;

// The Max-Battle "charger" tier: fast moves at or under the in-game 0.5s bar.
const MAX_CHARGER_DURATION_MS = 500;

// Charged moves that exist but are never an investment target. Frustration is
// the move a keeper is being kept in order to REMOVE; Return only exists after
// purifying, which is the opposite of keeping a Shadow. Struggle is the
// no-moveset fallback. Scoring any of them would rank a species on a moveset
// no one would ever build.
const EXCLUDED_MOVES = /^(FRUSTRATION|RETURN|STRUGGLE)/;
// Hidden Power is a single move whose type is rolled per-Pokémon and can be
// re-rolled. Letting it count would hand every Hidden Power user a fast move
// in all 18 types, which is true of the game and useless as investment advice.
const HIDDEN_POWER = /^HIDDEN_POWER/;

// Forms a Pokémon transforms into mid-battle and cannot be owned, caught or
// powered up. The game master has no flag for these — Darmanitan's Zen entry
// is structurally identical to its Standard one, right down to buddy and model
// data — so, like BABY_DEX in App.jsx, this is a short explicit list rather
// than a derivation. It is named per form id, not by suffix, because a suffix
// rule gets Zacian wrong: ZACIAN_HERO is the ownable base form, not a
// transformation. Scoring these put Galarian Darmanitan's Zen mode at the top
// of Ice, which is advice a player cannot act on — Zen triggers below half HP
// and is not a Pokémon you can select for a raid.
// Deliberately NOT here: Aegislash's Blade form, the Kyurem/Calyrex/Necrozma
// fusions, Palkia Origin and Zacian Crowned Sword, all of which are real forms
// a player holds outside battle.
const BATTLE_ONLY_FORMS = new Set([
  "DARMANITAN_ZEN", "DARMANITAN_GALARIAN_ZEN", "MELOETTA_PIROUETTE",
  "PALAFIN_HERO", "EISCUE_NOICE", "MORPEKO_HANGRY", "MIMIKYU_BUSTED",
  "WISHIWASHI_SCHOOL", "CRAMORANT_GULPING", "CRAMORANT_GORGING",
]);

// ── Fetch + IO helpers ──────────────────────────────────────────────────────

const USER_AGENT = "pogo-filter-workshop meta-rankings-fetcher/2.0";

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

function writeJson(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function assertOrDie(cond, label) {
  if (!cond) {
    console.error(`✗ assertion failed: ${label}`);
    process.exit(1);
  }
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// POKEMON_TYPE_ICE → "ice".
const typeKey = (t) => String(t || "").replace(/^POKEMON_TYPE_/, "").toLowerCase();

// ── Game-master parsing ─────────────────────────────────────────────────────
// Every parser below is exported so scripts/check-meta-rankings.mjs can drive
// them from a hand-built template array, offline and without a 19 MB download.

// battleSettings is the PvE block (raids and gyms). combatSettings carries the
// same STAB and Shadow numbers but governs PvP — the research this was built
// from named combatSettings, which is the wrong template for a raid ranking
// even though today the values happen to agree. Read battleSettings, and fall
// back to combatSettings only if Niantic ever drops the PvE copy.
export function battleConstants(templates) {
  let battle = null, combat = null;
  for (const t of templates || []) {
    const d = t?.data || {};
    if (d.battleSettings) battle = d.battleSettings;
    if (d.combatSettings) combat = d.combatSettings;
  }
  const src = battle || combat || {};
  return {
    stab: src.sameTypeAttackBonusMultiplier ?? 1.2,
    shadowAttack: src.shadowPokemonAttackBonusMultiplier ?? 1.2,
    shadowDefense: src.shadowPokemonDefenseBonusMultiplier ?? 0.8333333,
    // Energy gained per point of HP lost — the term that makes a boss's own
    // damage accelerate the attacker's charged moves.
    energyPerHpLost: src.energyDeltaPerHealthLost ?? 0.5,
    source: battle ? "battleSettings" : (combat ? "combatSettings" : "defaults"),
  };
}

// playerLevel.cpMultiplier is indexed by level − 1 (index 0 = level 1).
export function cpMultiplierFor(templates, level) {
  for (const t of templates || []) {
    const arr = t?.data?.playerLevel?.cpMultiplier;
    if (Array.isArray(arr) && arr.length >= level) return arr[level - 1];
  }
  return null;
}

// moveSettings → { id: { type, power, energyDelta, durationS, fast } }.
// The game master has no isFast flag: fast moves GENERATE energy (positive
// energyDelta) and charged moves SPEND it (negative). The _FAST id suffix
// agrees, and both are checked so a zero-energy oddity cannot land in the
// wrong bucket silently.
export function parseMoves(templates) {
  const moves = new Map();
  for (const t of templates || []) {
    const m = t?.data?.moveSettings;
    if (!m?.movementId) continue;
    const id = m.movementId;
    // A handful of moves ship with the raw enum ordinal instead of a name
    // (406/407 = Aura Wheel, 482 = Dynamax Cannon in the batch this was
    // written against). App.jsx localizes move ids through the move-name
    // dictionary, which has no entry for a number, and an unnamed move is not
    // a moveset anyone can build toward. Dynamax Cannon in particular handed
    // Eternatus a 215-power charged move and the top Dragon slot outright.
    if (typeof id !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(id)) continue;
    if (EXCLUDED_MOVES.test(id) || HIDDEN_POWER.test(id)) continue;
    const durationS = (m.durationMs ?? 0) / 1000;
    if (!(durationS > 0)) continue;
    const energyDelta = m.energyDelta ?? 0;
    const fast = /_FAST$/.test(id);
    if (fast ? energyDelta <= 0 : energyDelta >= 0) continue;
    moves.set(id, {
      id,
      type: typeKey(m.pokemonType),
      power: m.power ?? 0,
      energy: Math.abs(energyDelta),
      durationS,
      fast,
      durationMs: m.durationMs ?? 0,
    });
  }
  return moves;
}

// Species forms out of pokemonSettings, keyed by dex from the template id.
//
// The RELEASE GATE is `modelScaleV2`. The game master is not a released-species
// list: it carries essentially the whole national dex (1024 of 1025 base
// species in the batch this was written against), stats and movesets included,
// long before Niantic ships them. What unreleased species lack is the
// client-side render data — Koraidon, Miraidon, Ogerpon and Terapagos all have
// stats and moves but no modelScaleV2, modelHeight, buddyScale or
// buddyGroupNumber, because nothing has ever had to draw them. Gating on
// modelScaleV2 keeps 975 base species, and it reproduces pogoapi's released
// set on the previous output exactly: all 96 of the old topAttackers pass it.
//
// Mega and Primal forms live in tempEvoOverrides INSIDE a form entry rather
// than as their own templates, so ignoring that field is all it takes to keep
// them out (see the header for why they are out). Regional and alternate forms
// — Alolan, Galarian, Hisuian, Therian, Crowned — are genuine separate
// attackers and are kept; they fold back into their base species' dex, which
// is the granularity the app's `+species` family search works at anyway.
export function parseSpeciesForms(templates) {
  const byDex = new Map();
  const seen = new Set();
  for (const t of templates || []) {
    const ps = t?.data?.pokemonSettings;
    if (!ps?.stats) continue;
    const m = /^V(\d{4})_POKEMON_/.exec(t.templateId || "");
    if (!m) continue;
    if (ps.modelScaleV2 == null) continue; // release gate
    if (ps.form && BATTLE_ONLY_FORMS.has(ps.form)) continue;

    const dex = parseInt(m[1], 10);
    const types = [typeKey(ps.type), ps.type2 ? typeKey(ps.type2) : null].filter(Boolean);
    const form = {
      dex,
      pokemonId: ps.pokemonId,
      form: ps.form || null,
      types,
      baseAttack: ps.stats.baseAttack ?? 0,
      baseDefense: ps.stats.baseDefense ?? 0,
      baseStamina: ps.stats.baseStamina ?? 0,
      fastMoveIds: [...(ps.quickMoves || []), ...(ps.eliteQuickMove || [])],
      chargedMoveIds: [...(ps.cinematicMoves || []), ...(ps.eliteCinematicMove || [])],
      // pokemonSettings.shadow is present exactly when the form can be caught
      // or hatched as a Shadow — the game's own answer to "does a Shadow of
      // this exist", which is what shadowKeepers is a ranking of.
      shadowCapable: Boolean(ps.shadow),
      pokemonClass: ps.pokemonClass || null,
      // Species this form evolves into, used to drop a pre-evolution that its
      // own evolution already outranks — see evolvesToByDex below.
      evolvesTo: (ps.evolutionBranch || [])
        .map(b => b.evolution)
        .filter(Boolean),
    };
    // The game master ships the same form more than once under different
    // template ids — a bare V0376_POKEMON_METAGROSS alongside a
    // V0376_POKEMON_METAGROSS_NORMAL, and V0555_POKEMON_DARMANITAN alongside
    // V0555_POKEMON_DARMANITAN_STANDARD. Deduping on the id would need a rule
    // per naming convention, so dedupe on the fields the model actually reads:
    // if two entries agree on typing, stats, moves and Shadow availability they
    // score identically and only one of them is worth rating.
    const signature = JSON.stringify([
      form.types, form.baseAttack, form.baseDefense, form.baseStamina,
      form.fastMoveIds, form.chargedMoveIds, form.shadowCapable,
    ]);
    const key = `${dex}:${signature}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!byDex.has(dex)) byDex.set(dex, []);
    byDex.get(dex).push(form);
  }
  return byDex;
}

// PvPoke's game master → { releasedDex, shadowDex, timestamp }. Roster only:
// its move stats are the turn-based PvP numbers, which say nothing about raid
// DPS, so nothing here reads them. Entries are per form (`charizard_mega_y`)
// and each carries its `dex`, so both sets collapse to dex level — the
// granularity the app's `+species` family search works at anyway.
export function parsePvpokeRoster(gamemaster) {
  const releasedDex = new Set();
  const shadowDex = new Set();
  const dexById = new Map();
  for (const p of gamemaster?.pokemon || []) {
    if (!Number.isInteger(p?.dex)) continue;
    if (p.speciesId) dexById.set(p.speciesId, p.dex);
    if (p.released) releasedDex.add(p.dex);
    // Both spellings of the same fact; a species carrying either is eligible.
    if ((p.tags || []).includes("shadoweligible")) shadowDex.add(p.dex);
  }
  for (const id of gamemaster?.shadowPokemon || []) {
    const dex = dexById.get(id);
    if (dex != null) shadowDex.add(dex);
  }
  return { releasedDex, shadowDex, timestamp: gamemaster?.timestamp || null };
}

// Dynamax and Gigantamax eligibility from pokemonExtendedSettings.
// "Bread" is Niantic's internal codename for the Max mechanic — the same
// templates carry maxBattleVisualSettings and maxStationVisualSettings, and
// pokemonSettings has a breadTierGroup. BREAD_MODE means the species can
// Dynamax; BREAD_DOUGH_MODE additionally means it can Gigantamax.
export function parseMaxEligibility(templates) {
  const dynamax = new Set();
  const gigantamax = new Set();
  for (const t of templates || []) {
    const ext = t?.data?.pokemonExtendedSettings;
    if (!ext?.breadOverrides) continue;
    const m = /^EXTENDED_V(\d{4})_POKEMON_/.exec(t.templateId || "");
    if (!m) continue;
    const dex = parseInt(m[1], 10);
    for (const b of ext.breadOverrides) {
      if (b?.breadMode === "BREAD_MODE") dynamax.add(dex);
      if (b?.breadMode === "BREAD_DOUGH_MODE") gigantamax.add(dex);
    }
  }
  return { dynamax, gigantamax };
}

// ── The damage model ────────────────────────────────────────────────────────

// One hit of `move`, neutral effectiveness assumed by the caller.
export function moveDamage(move, attack, defense, stab, effectiveness = 1) {
  return Math.floor(0.5 * move.power * (attack / defense) * stab * effectiveness) + 1;
}

// Steady-state cycle DPS for one (fast, charged) pair — see the header for the
// derivation. `incomingDps` is the boss's DPS against this attacker; it feeds
// the energy-from-damage term, so a frailer attacker charges faster.
export function cycleDps({ fastDamage, fastDurationS, fastEnergy,
                           chargedDamage, chargedDurationS, chargedEnergy,
                           incomingDps, energyPerHpLost }) {
  const gain = energyPerHpLost * incomingDps;
  const denom = fastEnergy + gain * fastDurationS;
  if (!(denom > 0)) return 0;
  // n can solve negative when the boss alone out-feeds the charged move's
  // cost; the attacker cannot fire more often than back-to-back, so floor it.
  const n = Math.max(0, (chargedEnergy - gain * chargedDurationS) / denom);
  const time = n * fastDurationS + chargedDurationS;
  if (!(time > 0)) return 0;
  return (n * fastDamage + chargedDamage) / time;
}

// ── Ranking ─────────────────────────────────────────────────────────────────

// Best moveset per (form, variant, charged-move type) → rating/dps/tdo.
// The charged move decides which type bucket an entry competes in (it carries
// the damage); the fast move is free to be any type, since the player picks
// whichever pairs best.
//
// A bucket only admits movesets where the charged move gets STAB — that is,
// the attacker is actually of that type. Without the gate, "top Fighting
// attackers" came back as Latios, Mewtwo, Raikou and Darkrai, high-attack
// legendaries carrying Aura Sphere or Focus Blast as coverage. They are not
// Fighting attackers and nobody powers one up to be one; the ×1.2 STAB a real
// Machamp or Blaziken gets is exactly the difference the ranking is supposed
// to express. This is the same "off types" cut DialgaDex applies by default.
function rateForm(form, { moves, consts, cpm, boss, shadow }) {
  const atkMult = shadow ? consts.shadowAttack : 1;
  const defMult = shadow ? consts.shadowDefense : 1;
  const attack = (form.baseAttack + ATTACKER_IV) * cpm * atkMult;
  const defense = (form.baseDefense + ATTACKER_IV) * cpm * defMult;
  const hp = Math.floor((form.baseStamina + ATTACKER_IV) * cpm);

  // The boss's DPS against THIS attacker — the only place the attacker's own
  // defense enters, and the reason a Shadow's −20% defence costs it bulk.
  const incomingDps = boss.dpsAgainst(defense);
  if (!(incomingDps > 0)) return [];
  const timeOnField = hp / incomingDps;

  const stabFor = (t) => (form.types.includes(t) ? consts.stab : 1);
  const fasts = form.fastMoveIds.map(id => moves.get(id)).filter(m => m?.fast);
  const chargeds = form.chargedMoveIds.map(id => moves.get(id)).filter(m => m && !m.fast);
  if (fasts.length === 0 || chargeds.length === 0) return [];

  const best = new Map(); // type → entry
  for (const c of chargeds) {
    if (!form.types.includes(c.type)) continue; // STAB gate — see above
    const chargedDamage = moveDamage(c, attack, boss.defense, stabFor(c.type));
    for (const f of fasts) {
      const fastDamage = moveDamage(f, attack, boss.defense, stabFor(f.type));
      const dps = cycleDps({
        fastDamage, fastDurationS: f.durationS, fastEnergy: f.energy,
        chargedDamage, chargedDurationS: c.durationS, chargedEnergy: c.energy,
        incomingDps, energyPerHpLost: consts.energyPerHpLost,
      });
      if (!(dps > 0)) continue;
      const tdo = dps * timeOnField;
      const rating = dps * Math.pow(timeOnField, RATING_EXPONENT);
      const prev = best.get(c.type);
      if (!prev || rating > prev.rating) {
        best.set(c.type, {
          type: c.type, rating, dps, tdo,
          fast: f.id, charged: c.id,
          shadow, dex: form.dex, form: form.form,
        });
      }
    }
  }
  return [...best.values()];
}

// dex → Set of dex ids it evolves into, transitively. Built from the game
// master's own evolutionBranch, so it needs no evolution feed of its own.
export function evolutionDescendants(formsByDex) {
  const idToDex = new Map();
  for (const [dex, forms] of formsByDex) {
    for (const f of forms) if (!idToDex.has(f.pokemonId)) idToDex.set(f.pokemonId, dex);
  }
  const direct = new Map();
  for (const [dex, forms] of formsByDex) {
    const to = new Set();
    for (const f of forms) {
      for (const id of f.evolvesTo) {
        const d = idToDex.get(id);
        if (d != null && d !== dex) to.add(d);
      }
    }
    direct.set(dex, to);
  }
  const closure = new Map();
  const walk = (dex, seen = new Set()) => {
    if (closure.has(dex)) return closure.get(dex);
    const out = new Set();
    for (const next of direct.get(dex) || []) {
      if (seen.has(next)) continue; // defensive: no evolution loop can hang this
      out.add(next);
      for (const d of walk(next, new Set([...seen, dex, next]))) out.add(d);
    }
    closure.set(dex, out);
    return out;
  };
  for (const dex of formsByDex.keys()) walk(dex);
  return closure;
}

// Collapse per-form entries to per-dex bests, then cut the top N per type.
// Per-dex is the right granularity because the app's allowlists are family
// searches: `+darmanitan` already covers Galarian Darmanitan.
//
// A pre-evolution is dropped when its own evolution outranks it in the SAME
// bucket: recommending a Shadow Haunter is noise when Shadow Gengar is right
// next to it in the list, and PoGo's `+gengar` family search covers the
// Haunter anyway. The comparison is per-bucket and rating-ordered rather than
// a blanket "finals only" rule, because the evolution is not always a real
// alternative — Ursaring stays a Shadow keeper precisely because there is no
// Shadow Ursaluna to keep instead. Dropping before the slice means the freed
// slot backfills with the next real candidate instead of being lost.
function topPerType(entries, perType, descendants) {
  const buckets = Object.fromEntries(TYPES.map(t => [t, new Map()]));
  for (const e of entries) {
    const bucket = buckets[e.type];
    if (!bucket) continue;
    const prev = bucket.get(e.dex);
    if (!prev || e.rating > prev.rating) bucket.set(e.dex, e);
  }
  const out = {};
  for (const t of TYPES) {
    const bucket = buckets[t];
    out[t] = [...bucket.values()]
      .filter((e) => {
        for (const d of descendants.get(e.dex) || []) {
          const evo = bucket.get(d);
          if (evo && evo.rating >= e.rating) return false;
        }
        return true;
      })
      .sort((a, b) => b.rating - a.rating)
      .slice(0, perType);
  }
  return out;
}

// Union the per-type cuts into one dex list, ordered by each species' best
// rating across every type it made — so the head of the list is the roster's
// heaviest hitters, which is the order the chip editor reads best in.
function unionByBestRating(byType) {
  const best = new Map();
  for (const list of Object.values(byType)) {
    for (const e of list) {
      const prev = best.get(e.dex);
      if (!prev || e.rating > prev.rating) best.set(e.dex, e);
    }
  }
  return [...best.values()].sort((a, b) => b.rating - a.rating).map(e => e.dex);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let templates, gameMasterBatchMs = null, mirrorName = null, gameMasterAgeDays = null, pvpoke = null;
  try {
    console.log("→ Fetching game master + PvPoke roster");
    // Roster-only, and the mechanics source is the one that cannot be missing —
    // so a PvPoke outage degrades to the game master's own release heuristic
    // rather than failing the sync. Started first so it overlaps the big fetch.
    const pvpokePromise = fetchPvpokeGameMaster({ userAgent: USER_AGENT });
    ({
      templates,
      batchMs: gameMasterBatchMs,
      mirrorName,
      ageDays: gameMasterAgeDays,
    } = await fetchGameMaster({ userAgent: USER_AGENT, label: "move mechanics" }));
    pvpoke = await pvpokePromise;
    if (!pvpoke) {
      console.warn("⚠  falling back to the game master's own release heuristic for the roster");
    }
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }
  const gameMasterTimestamp = gameMasterBatchMs != null ? String(gameMasterBatchMs) : null;

  assertOrDie(Array.isArray(templates) && templates.length > 5000,
    `game master parsed as ${templates?.length} templates (expected > 5000)`);

  // Species names come from the repo's own dictionary, keyed by dex — the same
  // dictionary resolveSpecies reads, so every emitted name resolves by
  // construction. See the header for the pogoapi name-mangling bug this ends.
  const names = JSON.parse(readFileSync(NAMES_PATH, "utf8"));
  const nameFor = (dex) => names[String(dex)]?.en?.toLowerCase() || null;

  const roster = parsePvpokeRoster(pvpoke);
  // The staleness warning itself is emitted by fetchGameMaster — a mirror going
  // stale is not a failure here (it is the only PvE mechanics source) but it is
  // never silent, and the age is reported alongside the roster below.

  const consts = battleConstants(templates);
  const cpm = cpMultiplierFor(templates, ATTACKER_LEVEL);
  assertOrDie(cpm > 0.7 && cpm < 0.9, `CPM(${ATTACKER_LEVEL}) = ${cpm} out of range`);
  const moves = parseMoves(templates);
  const formsByDex = parseSpeciesForms(templates);
  const { dynamax, gigantamax } = parseMaxEligibility(templates);

  // Overlay the fresh roster. PvPoke's `released` REPLACES the game master's
  // model-data heuristic where it is available: a species released since the
  // last PokeMiners batch has no model data in it and would otherwise be
  // invisible. Shadow eligibility is a UNION rather than a replacement — the
  // game master names the whole evolution line of every Shadow, which is the
  // relationship PvPoke's flat list does not spell out, so dropping either
  // side loses keepers.
  if (roster) {
    for (const dex of [...formsByDex.keys()]) {
      if (!roster.releasedDex.has(dex)) formsByDex.delete(dex);
    }
    for (const [dex, forms] of formsByDex) {
      if (!roster.shadowDex.has(dex)) continue;
      for (const form of forms) form.shadowCapable = true;
    }
  }

  console.log(`  battle constants from ${consts.source}: STAB ${consts.stab}, ` +
    `shadow ×${consts.shadowAttack} atk / ×${consts.shadowDefense} def`);
  console.log(`  moves ${moves.size} · released species ${formsByDex.size} · ` +
    `dynamax ${dynamax.size} (gmax ${gigantamax.size})`);
  console.log(`  roster: ${roster ? `PvPoke ${roster.timestamp} ` +
    `(${roster.releasedDex.size} released, ${roster.shadowDex.size} shadow-eligible)`
    : "game-master heuristic (PvPoke unavailable)"}` +
    ` · mechanics: ${mirrorName} ${gameMasterAgeDays != null ? `${gameMasterAgeDays}d old` : "unstamped"}`);

  // ── Reference boss ────────────────────────────────────────────────────────
  // Derived, not invented: the median released legendary-class species, at the
  // tier-5 raid CPM, swinging a median fast + median charged moveset. Neutral
  // effectiveness (see the header).
  const legendaryForms = [...formsByDex.values()].flat()
    .filter(f => /LEGENDARY/.test(f.pokemonClass || ""));
  assertOrDie(legendaryForms.length > 50,
    `only ${legendaryForms.length} legendary forms found — pokemonClass shape changed?`);
  const bossBaseAttack = median(legendaryForms.map(f => f.baseAttack));
  const bossBaseDefense = median(legendaryForms.map(f => f.baseDefense));
  const bossAttack = (bossBaseAttack + RAID_BOSS_IV) * RAID_BOSS_CPM;
  const bossDefense = (bossBaseDefense + RAID_BOSS_IV) * RAID_BOSS_CPM;

  // The boss's moveset medians come from the moves LEGENDARY species actually
  // carry, not from every move in the game. Tier-5 bosses are drawn from that
  // pool, and the all-moves median is dragged down by the long tail of weak
  // early-gen fast moves — which would understate incoming damage and so
  // overstate every attacker's time on field.
  const legendaryFastIds = new Set(legendaryForms.flatMap(f => f.fastMoveIds));
  const legendaryChargedIds = new Set(legendaryForms.flatMap(f => f.chargedMoveIds));
  const allFast = [...legendaryFastIds].map(id => moves.get(id)).filter(m => m?.fast);
  const allCharged = [...legendaryChargedIds].map(id => moves.get(id)).filter(m => m && !m.fast);
  assertOrDie(allFast.length > 5 && allCharged.length > 5,
    `reference boss moveset pool too small (${allFast.length} fast / ${allCharged.length} charged)`);
  const bossFast = {
    power: median(allFast.map(m => m.power)),
    energy: median(allFast.map(m => m.energy)),
    durationS: median(allFast.map(m => m.durationS)),
  };
  const bossCharged = {
    power: median(allCharged.map(m => m.power)),
    energy: median(allCharged.map(m => m.energy)),
    durationS: median(allCharged.map(m => m.durationS)),
  };

  const boss = {
    defense: bossDefense,
    // The boss runs the same cycle model, minus the energy-from-damage term
    // (a raid boss's HP pool makes it irrelevant over a 300 s fight).
    dpsAgainst(attackerDefense) {
      const fastDamage = moveDamage(
        { power: bossFast.power }, bossAttack, attackerDefense, 1);
      const chargedDamage = moveDamage(
        { power: bossCharged.power }, bossAttack, attackerDefense, 1);
      const n = bossCharged.energy / bossFast.energy;
      const time = n * bossFast.durationS + bossCharged.durationS;
      return (n * fastDamage + chargedDamage) / time;
    },
  };
  console.log(`  reference boss: base ${bossBaseAttack}/${bossBaseDefense} → ` +
    `atk ${bossAttack.toFixed(1)} def ${bossDefense.toFixed(1)}, ` +
    `${boss.dpsAgainst(150).toFixed(1)} DPS vs a 150-def attacker`);

  // ── Rank ──────────────────────────────────────────────────────────────────
  const normalEntries = [];
  const shadowEntries = [];
  for (const forms of formsByDex.values()) {
    for (const form of forms) {
      if (!nameFor(form.dex)) continue; // outside the app's name dictionary
      normalEntries.push(...rateForm(form, { moves, consts, cpm, boss, shadow: false }));
      if (form.shadowCapable) {
        shadowEntries.push(...rateForm(form, { moves, consts, cpm, boss, shadow: true }));
      }
    }
  }

  const descendants = evolutionDescendants(formsByDex);
  const byType = topPerType(normalEntries, TOP_PER_TYPE, descendants);
  const shadowByType = topPerType(shadowEntries, SHADOW_TOP_PER_TYPE, descendants);

  const topAttackers = unionByBestRating(byType).map(nameFor).filter(Boolean);
  const shadowKeepers = unionByBestRating(shadowByType).map(nameFor).filter(Boolean);

  // topMaxAttackers: the same top-N-per-type cut as topAttackers, taken over
  // only the Dynamax-capable species. Max moves are not in the game master as a
  // per-species moveset, so a Max-specific DPS is not computable — the rating is
  // "how good is this species as an attacker at all", and the Dynamax filter is
  // what makes it a Max list.
  //
  // It is a CUT, not the roster. Emitting every Dynamax-capable species ordered
  // by rating — which is what this did, and what the hand-maintained seed before
  // it did — is not a "top attackers" list: it put Combee, Tyrogue, Bounsweet,
  // Wooloo, Squirtle and Beldum in a roster the user is meant to pick a raid
  // team from, and made 151 chips of it in the expert editor. The small hand
  // seed hid the flaw by being small. Cutting per type fixes the meaning and the
  // chip wall in the same move.
  const maxEntries = normalEntries.filter(e => dynamax.has(e.dex));
  const maxByType = topPerType(maxEntries, TOP_PER_TYPE, descendants);
  const topMaxAttackers = unionByBestRating(maxByType).map(nameFor).filter(Boolean);
  const gigantamaxSpecies = [...gigantamax]
    .filter(dex => nameFor(dex))
    .sort((a, b) => a - b)
    .map(nameFor);

  // Per-type detail, so the cut can be reviewed and the exponent argued with
  // in a diff rather than by re-running the fetch.
  const roundTo = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  const detail = (list) => list.map(e => ({
    species: nameFor(e.dex),
    dex: e.dex,
    rating: roundTo(e.rating),
    dps: roundTo(e.dps),
    tdo: roundTo(e.tdo, 1),
    fast: e.fast,
    charged: e.charged,
    ...(e.form ? { form: e.form } : {}),
  }));
  const perType = Object.fromEntries(TYPES.map(t => [t, detail(byType[t])]));
  const shadowPerType = Object.fromEntries(TYPES.map(t => [t, detail(shadowByType[t])]));

  // 0.5s fast moves — the "charger" tier the Max-Tank filter emits, sorted by
  // name for diff stability.
  //
  // These MUST be display names, not game-master movementIds. App.jsx looks
  // each one up as `move.<lowercase name>` in the locale dictionary that
  // fetch-translations.mjs populates from the community sheet, which is keyed
  // on display names ("move.bullet punch"); a movementId would miss every key,
  // fall through the consumer's `fallback: m.name`, and emit `@1metal_claw_fast`
  // — a term the game matches nothing against, in every locale, silently.
  // So the id is converted back to its display name and then VERIFIED against
  // the EN dictionary. A move the dictionary cannot name is dropped rather than
  // shipped: a dropped charger narrows the filter, a dead one breaks it.
  const enMoveNames = new Set(Object.keys(LOCALE_EN)
    .filter(k => k.startsWith("move."))
    .map(k => k.slice(5)));
  const displayName = (id) => id
    .replace(/_FAST$/, "")
    .split("_")
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
  const droppedChargers = [];
  const chargerMoves = [...moves.values()]
    .filter(m => m.fast && m.durationMs <= MAX_CHARGER_DURATION_MS)
    .map(m => ({ name: displayName(m.id), type: m.type, duration: m.durationMs }))
    .filter(m => {
      const lower = m.name.toLowerCase();
      // The consumer tries the hyphenated key first ("lock-on"), so a move the
      // sheet spells with a hyphen still resolves.
      const known = enMoveNames.has(lower) || enMoveNames.has(lower.replace(/\s+/g, "-"));
      if (!known) droppedChargers.push(m.name);
      return known;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  if (droppedChargers.length > 0) {
    console.warn(`⚠  charger moves with no move-name dictionary entry, dropped: ${droppedChargers.join(", ")}`);
  }

  const newContent = {
    gameMasterTimestamp,
    // Provenance, so a reader of the snapshot can tell how fresh each half of
    // it is without re-deriving the split from the script.
    sources: {
      mechanics: mirrorName,
      mechanicsBatch: Number.isFinite(gameMasterBatchMs) && gameMasterBatchMs > 0
        ? new Date(gameMasterBatchMs).toISOString() : null,
      roster: roster ? "pvpoke/pvpoke" : `${mirrorName} (fallback)`,
      rosterBatch: roster?.timestamp || null,
    },
    model: {
      attackerLevel: ATTACKER_LEVEL,
      attackerIv: ATTACKER_IV,
      ratingExponent: RATING_EXPONENT,
      raidBossCpm: RAID_BOSS_CPM,
      bossBaseAttack, bossBaseDefense,
      stab: consts.stab,
      shadowAttackMultiplier: consts.shadowAttack,
      shadowDefenseMultiplier: consts.shadowDefense,
      energyPerHpLost: consts.energyPerHpLost,
      constantsFrom: consts.source,
    },
    topPerType: TOP_PER_TYPE,
    shadowTopPerType: SHADOW_TOP_PER_TYPE,
    maxChargerDurationMs: MAX_CHARGER_DURATION_MS,
    topAttackers,
    shadowKeepers,
    topMaxAttackers,
    gigantamaxSpecies,
    perType,
    shadowPerType,
    chargerMoves,
  };

  // ── Sanity gates ──────────────────────────────────────────────────────────
  // exit 1 reddens the sync workflow, which is the only way an upstream shape
  // change gets a human's attention before the bad data ships to users.
  const ta = new Set(topAttackers);
  const sk = new Set(shadowKeepers);

  // Roster size. A collapsed list means a parse broke; a bloated one means the
  // dedupe or the type bucketing did.
  assertOrDie(topAttackers.length >= 50 && topAttackers.length <= 130,
    `topAttackers is ${topAttackers.length} species (expected 50-130)`);
  // Band, not a target: it catches a collapsed parse or a runaway dedupe, and
  // has to leave room for SHADOW_TOP_PER_TYPE to be retuned without tripping.
  assertOrDie(shadowKeepers.length >= 25 && shadowKeepers.length <= 130,
    `shadowKeepers is ${shadowKeepers.length} species (expected 25-130)`);
  assertOrDie(topMaxAttackers.length >= 30 && topMaxAttackers.length <= 110,
    `topMaxAttackers is ${topMaxAttackers.length} species (expected 30-110)`);
  // A top-N cut must not read as the whole roster: these are Dynamax-capable
  // but nobody brings them to a Max Battle, and their presence is the signature
  // of the cut having silently degraded back into a roster dump.
  for (const n of ["combee", "tyrogue", "bounsweet", "wooloo", "hoothoot"]) {
    assertOrDie(!topMaxAttackers.includes(n),
      `topMaxAttackers contains "${n}" — the per-type cut has degraded into a roster dump`);
  }

  // Every type must be represented, or a whole role silently vanished.
  for (const t of TYPES) {
    assertOrDie(perType[t].length === TOP_PER_TYPE, `perType.${t} has ${perType[t].length} entries`);
    assertOrDie(shadowPerType[t].length > 0, `shadowPerType.${t} is empty`);
  }

  // Names must round-trip. This is the assertion the Tapus would have tripped:
  // an emitted species the app cannot resolve becomes a dead search term.
  const enByName = new Map(Object.entries(names)
    .filter(([k]) => /^\d+$/.test(k))
    .map(([k, v]) => [String(v.en || "").toLowerCase(), k]));
  for (const s of [...topAttackers, ...shadowKeepers, ...topMaxAttackers]) {
    assertOrDie(enByName.has(s), `emitted species "${s}" is not resolvable by name`);
  }

  // Shadow keepers must actually be obtainable as Shadows. A regression here
  // would put species in the "never purify" list that have no Shadow form.
  const shadowCapableDex = new Set([...formsByDex.values()].flat()
    .filter(f => f.shadowCapable).map(f => f.dex));
  for (const s of shadowKeepers) {
    const dex = parseInt(enByName.get(s), 10);
    assertOrDie(shadowCapableDex.has(dex), `shadowKeeper "${s}" (${dex}) has no Shadow form`);
  }

  // Spot checks the model must not get wrong. These are load-bearing on the
  // ordering, not on the exact rating: if Shadow Mamoswine is not a top Ice
  // attacker or Shadow Metagross not a top Steel one, the damage model is
  // broken in a way the size gates above cannot see.
  const inType = (map, t, name) => map[t].some(e => e.species === name);
  assertOrDie(inType(shadowPerType, "ice", "mamoswine"), "Shadow Mamoswine ∈ top Ice");
  assertOrDie(inType(shadowPerType, "steel", "metagross"), "Shadow Metagross ∈ top Steel");
  assertOrDie(sk.has("salamence") || sk.has("dragonite"), "a top Shadow Dragon ∈ shadowKeepers");
  // Fighting is asserted by shape rather than by naming one species: the cut is
  // crowded (Blaziken, Conkeldurr, Emboar, Hariyama, Sneasler and Machamp are
  // all within a few points) and which five land is a legitimate finding, not
  // something this file should pin. What must hold is that the STAB gate is
  // working — every name in the bucket is an actual Fighting-type, not a
  // legendary carrying Focus Blast as coverage, which is what the bucket
  // returned before the gate existed.
  // The STAB gate, asserted structurally rather than against a list of names.
  // An earlier version of this check kept a hand-written roster of "real"
  // Fighting and Water types, which is the same hand-curation this whole file
  // exists to delete — and it promptly cried wolf over Galarian Zapdos, a
  // genuine Fighting-type. What must actually hold is that every entry in a
  // type bucket is of that type: before the gate existed, "top Fighting
  // attackers" came back as Latios, Mewtwo, Raikou and Darkrai carrying Aura
  // Sphere and Focus Blast as coverage.
  const typesByDex = new Map();
  for (const [dex, forms] of formsByDex) {
    typesByDex.set(dex, new Set(forms.flatMap((f) => f.types)));
  }
  for (const [label, map] of [["perType", perType], ["shadowPerType", shadowPerType]]) {
    for (const t of TYPES) {
      for (const e of map[t]) {
        assertOrDie(typesByDex.get(e.dex)?.has(t),
          `${label}.${t} lists "${e.species}", which is not a ${t}-type — STAB gate broken?`);
      }
    }
  }

  // Megas stay out — Mega Rayquaza's stats must not have leaked in as a
  // separate entry, and no dex may appear twice.
  assertOrDie(new Set(topAttackers).size === topAttackers.length, "topAttackers has duplicates");
  assertOrDie(new Set(shadowKeepers).size === shadowKeepers.length, "shadowKeepers has duplicates");

  // Dynamax eligibility, against species whose Max forms are well known. The
  // negative check is the one that matters: it is what caught the old
  // hand-maintained seed listing Zacian and the legendary birds.
  const tma = new Set(topMaxAttackers);
  for (const n of ["charizard", "gengar", "machamp", "blastoise", "venusaur", "cinderace"]) {
    assertOrDie(tma.has(n), `${n} ∈ topMaxAttackers`);
  }
  for (const n of ["zacian", "mewtwo", "rayquaza", "groudon"]) {
    assertOrDie(!tma.has(n), `${n} ∉ topMaxAttackers (no breadOverrides)`);
  }
  assertOrDie(gigantamaxSpecies.includes("charizard"), "Gigantamax Charizard ∈ gigantamaxSpecies");
  // Gigantamax is a strictly stronger claim than Dynamax, so the sets nest.
  // Asserted against the parsed flags rather than against topMaxAttackers: that
  // list is a top-N cut, and a weak Gigantamax species (G-Max Lapras, G-Max
  // Pikachu) can legitimately miss it without anything being wrong.
  for (const dex of gigantamax) {
    assertOrDie(dynamax.has(dex),
      `dex ${dex} is BREAD_DOUGH_MODE but not BREAD_MODE — Gigantamax without Dynamax`);
  }

  assertOrDie(chargerMoves.length >= 20 && chargerMoves.length <= 120,
    `chargerMoves is ${chargerMoves.length} (expected 20-120)`);
  assertOrDie(droppedChargers.length <= 3,
    `${droppedChargers.length} charger moves have no dictionary entry ` +
    `(${droppedChargers.join(", ")}) — the move sheet has fallen behind`);
  // Three moves that are exactly at the 500 ms bar. If the duration units ever
  // change under us (ms → s, say) the cut collapses and these catch it.
  for (const n of ["Mud Shot", "Shadow Claw", "Lock On"]) {
    assertOrDie(chargerMoves.some(m => m.name === n),
      `${n} is a 500 ms charger but is missing from chargerMoves`);
  }

  // Preserve fetchedAt when content didn't change, so a no-op sync doesn't
  // create a noisy commit. Mirrors fetch-pvp-rankings.mjs.
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const { fetchedAt: _prevAt, ...prevContent } = prev;
      if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  top attackers:     ${topAttackers.length} species`);
  console.log(`  shadow keepers:    ${shadowKeepers.length} species`);
  console.log(`  top max attackers: ${topMaxAttackers.length} species (${gigantamaxSpecies.length} G-Max)`);
  console.log(`  charger moves:     ${chargerMoves.length} ≤${MAX_CHARGER_DURATION_MS}ms`);
  console.log(`  sample top-5:      ${topAttackers.slice(0, 5).join(", ")}`);
  console.log(`  sample keepers-5:  ${shadowKeepers.slice(0, 5).join(", ")}`);
}

// Importable for the offline parser tests without firing the fetch.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(e => { console.error(e); process.exit(1); });
}
