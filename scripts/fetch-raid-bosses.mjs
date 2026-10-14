#!/usr/bin/env node
// Pulls current raid + max-battle bosses from lily-dex-api, and the dated
// event raids and event Max Battles from ScrapedDuck's event feed, derives
// per-boss resistorTypes (defender types that resist the boss's STAB) and
// seMoveTypes (move types that hit the boss super-effectively), and writes a
// slim artifact at src/data/raid-bosses.json that App.jsx imports at build
// time.
//
// Why the derivation lives in this script (not the app):
//   - Keeps runtime bundle small (one json file, no type matrix at runtime).
//   - Filter strings rebuild deterministically from a committed snapshot.
//   - lily-dex-api refreshes every 6h; user runs this on demand before raid hour.
//
// Flags:
//   --offline-ok   tolerate fetch failures if src/data/raid-bosses.json exists,
//                  and leave that cache whole when a family comes back empty
//                  (see guardEmptiedFamilies).

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultFormByDex,
  fetchGameMaster,
  formSuffix,
  gameMasterAgeDays,
  pokemonTemplates,
  typeSlug,
  typesOf,
  warnIfStale,
} from "./lib/game-master.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "raid-bosses.json");

const API_BASE = "https://mknepprath.github.io/lily-dex-api";
const ENDPOINTS = {
  raidboss:   `${API_BASE}/raidboss.json`,
  maxbattles: `${API_BASE}/maxbattles.json`,
  types:      `${API_BASE}/types.json`,
  // ScrapedDuck event feed — covers raid-day / raid-hour / raid-battles /
  // raid-weekend events that lily-dex-api's `currentList` doesn't carry, and
  // the Max Mondays and Max Battle Days its empty maxbattles.json doesn't.
  events:     "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json",
};

// The name → types index used to resolve bosses parsed out of event titles
// (raid-day / raid-hour entries don't carry structured boss metadata) is built
// from the game master and this repo's own name dictionary. It read pogoapi's
// pokemon_types.json until August 2026; that feed had not moved since November
// 2025 and published no freshness signal, so a boss released after it stalled
// could not be resolved out of an event title at all. See
// scripts/lib/game-master.mjs and docs/upstream-sources.md.
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");

// Window for surfacing upcoming events: active now + the next 7 days. Anything
// further out is noise (rotation slots routinely shift) and would force a
// daily diff in the snapshot file.
const EVENT_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_RAID_TYPES = new Set([
  "raid-day", "raid-hour", "raid-battles", "raid-weekend",
]);
// ScrapedDuck's eventType for each kind of dated Max Battle, as the live feed
// spelled them on 2026-10-13: "Dynamax Sneasel during Max Monday" is a
// max-mondays event, "Dynamax Uxie, Mesprit, and Azelf Max Battle Day" a
// max-battles one.
const EVENT_MAX_TYPES = new Set(["max-mondays", "max-battles"]);

// lily-dex-api uses spreadsheet-column language labels; we use BCP47.
const LOCALE_MAP = {
  English: "en", German: "de", French: "fr", Italian: "it",
  Japanese: "ja", Korean: "ko", Spanish: "es",
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop raid-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Builds defender→{double, half, none} lookups for O(1) effectiveness checks.
function indexTypes(typesArr) {
  const idx = {};
  for (const entry of typesArr) {
    idx[entry.type] = {
      doubleFrom: new Set(entry.doubleDamageFrom || []),
      halfFrom:   new Set(entry.halfDamageFrom   || []),
      noFrom:     new Set(entry.noDamageFrom     || []),
    };
  }
  return idx;
}

// effectiveness(attackerType → defenderType). Single-type interaction.
function eff(att, def, typeIdx) {
  const d = typeIdx[def];
  if (!d) return 1;
  if (d.noFrom.has(att))     return 0;
  if (d.halfFrom.has(att))   return 0.5;
  if (d.doubleFrom.has(att)) return 2;
  return 1;
}

// A resistor is a defender type that takes ≤1× from every boss STAB type AND
// resists at least one of them. Captures "safely tank the boss's STAB".
function resistorsFor(bossTypes, allTypes, typeIdx) {
  const out = [];
  for (const cand of allTypes) {
    const effs = bossTypes.map((bt) => eff(bt, cand.type, typeIdx));
    const maxEff = Math.max(...effs);
    if (maxEff > 1) continue;          // weak to a STAB type
    if (!effs.some((e) => e < 1)) continue; // neither STAB resisted
    out.push(cand.type);
  }
  return out;
}

// SE move types = types whose product over the boss's defending types is >1×.
// Used when the boss entry doesn't already carry a `counter` field.
function seFromTypes(bossTypes, allTypes, typeIdx) {
  const out = [];
  for (const cand of allTypes) {
    const product = bossTypes.reduce(
      (acc, bt) => acc * eff(cand.type, bt, typeIdx),
      1,
    );
    if (product > 1) out.push(cand.type);
  }
  return out;
}

function seFromCounter(counter) {
  return Object.entries(counter || {})
    .filter(([, mult]) => Number(mult) > 1)
    .map(([type]) => type);
}

function normalizeNames(names) {
  if (!names || typeof names !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(names)) {
    if (LOCALE_MAP[k] && v) out[LOCALE_MAP[k]] = v;
  }
  return out;
}

// types come back as TitleCase ("Fire"); keys in App.jsx's kw.type are lowercase.
function lowerTypes(arr) {
  return arr.map((t) => String(t).toLowerCase());
}

function deriveBoss(boss, allTypes, typeIdx) {
  const bossTypes = boss.types || [];
  if (bossTypes.length === 0) return null;

  const resistors = resistorsFor(bossTypes, allTypes, typeIdx);
  const seTypes = boss.counter
    ? seFromCounter(boss.counter)
    : seFromTypes(bossTypes, allTypes, typeIdx);

  return {
    id: boss.id,
    names: normalizeNames(boss.names),
    types: lowerTypes(bossTypes),
    resistorTypes: lowerTypes(resistors),
    seMoveTypes: lowerTypes(seTypes),
  };
}

// Event titles are marketing copy: they use a typographic apostrophe where the
// name dictionary uses a straight one, and vice versa. Fold both, so
// "Farfetch’d Raid Hour" resolves against a dictionary entry spelled
// "Farfetch'd".
function nameKey(name) {
  return String(name).toLowerCase().replace(/[‘’ʼ]/g, "'").trim();
}

// Keep types in TitleCase ("Fire"/"Ground") to match the type index keys built
// from the upstream typesArr — `eff()` lookups fail silently on case-mismatched
// strings and would emit empty resistor/SE arrays. `lowerTypes()` inside
// `deriveBoss` handles the lowercase emit shape.
const titleTypes = (types) => types.map(t => t[0].toUpperCase() + t.slice(1));

// Build a lowercase-name → {id, types, displayName, forms} index from the game
// master, named via this repo's own dictionary. `types` are the types of the
// template a bare species name stands for, picked in this order: the default
// form the species' FORMS_ template lists first (see defaultFormByDex), the
// form-less template, the NORMAL form, then the first template seen. So bare
// "Meowth" gets Kanto Meowth's types, not Alolan Meowth's, and bare "Zacian"
// gets Hero Zacian's, where the form-less template carries the Crowned ones.
// `forms` maps every form suffix of the species (INCARNATE, CROWNED_SWORD,
// ALOLA, …) to that form's types, for resolveBossKey.
//
// The index also holds every temporary evolution the dictionary names, under
// that name: "mega charizard x", "primal groudon" (see tempEvoEntries).
export function buildNameIndex(templates, names) {
  const defaults = defaultFormByDex(templates);
  const rank = (template, form) => {
    if (template.form === defaults.get(template.dex)) return 0;
    if (form === null) return 1;
    return form === "NORMAL" ? 2 : 3;
  };
  const byDex = new Map();
  for (const template of pokemonTemplates(templates)) {
    const types = typesOf(template.settings);
    if (types.length === 0) continue;
    const form = formSuffix(template);
    const r = rank(template, form);
    let entry = byDex.get(template.dex);
    if (!entry) byDex.set(template.dex, (entry = { template, types, rank: r, forms: new Map() }));
    // Among equals the first template seen stays.
    else if (r < entry.rank) Object.assign(entry, { template, types, rank: r });
    if (form !== null) entry.forms.set(form, titleTypes(types));
  }
  const idx = new Map();
  for (const [dex, { template, types, forms }] of byDex) {
    const name = names[String(dex)]?.en;
    if (!name) continue;
    idx.set(nameKey(name), {
      // The game's own species enum — TAPU_LELE, MR_MIME, HO_OH — which is the
      // convention lily-dex-api's boss ids follow, so the dedupe key built
      // from these matches the standing-tier ids exactly. A form template
      // carries the same enum, so a forme-suffixed boss dedupes the same way.
      id: template.settings.pokemonId,
      types: titleTypes(types),
      displayName: name,
      forms,
    });
  }
  // A species name always wins over a temporary evolution's.
  for (const [key, entry] of tempEvoEntries(byDex, names)) {
    if (!idx.has(key)) idx.set(key, entry);
  }
  return idx;
}

// A temporary evolution's words as its tempEvoId spells them:
// TEMP_EVOLUTION_MEGA_X → mega, x; TEMP_EVOLUTION_PRIMAL → primal.
function tempEvoWords(tempEvoId) {
  return tempEvoId.replace(/^TEMP_EVOLUTION_/, "").toLowerCase().split("_").filter(Boolean);
}

// `words` with each of `remove` taken out once, or null if one is missing.
function withoutWords(words, remove) {
  const rest = [...words];
  for (const word of remove) {
    const i = rest.indexOf(word);
    if (i < 0) return null;
    rest.splice(i, 1);
  }
  return rest;
}

// Index entries for the temporary evolutions, Mega and Primal, keyed by the
// dictionary's own name for each. Event titles name a Mega by that name, and
// buildEventEntry looks it up by that name. Stripped to its species, a Mega
// took the base form's types (Mega Gyarados is water/dark, not water/flying),
// and a lettered one found nothing at all: "Mega Charizard X" without the
// tier word is "charizard x", which is no species.
//
// The game master carries a temporary evolution's types in its species'
// tempEvoOverrides, on the default form's template, which is the one byDex
// kept: TEMP_EVOLUTION_MEGA_X makes Charizard fire/dragon. The dictionary
// names it under the Niantic text key pokemon_name_<dex>_<n> ("6_2"), but <n>
// does not name the evolution reliably (Mega Absol Z is 359_2, Mega Lucario Z
// 448_5), so the two are joined by words: the dictionary name with the
// species' own name taken out ("Mega Charizard X" → mega, x) must be exactly
// the tempEvoId's words. A name no override matches, such as Mega Absol Z
// while the game master has no TEMP_EVOLUTION_MEGA_Z, gets no entry and so
// stays unresolved: there are no types to give it. Three-part keys
// ("6_178_2") are Gigantamax names, not temporary evolutions.
//
// Each entry is { id, types, displayName }: the species' id, so a Mega
// dedupes against lily-dex-api's species-level ids as a forme does, the
// evolution's types, and the dictionary name, through which the app names it
// in every locale.
function tempEvoEntries(byDex, names) {
  const namesByDex = new Map();
  for (const [dexKey, entry] of Object.entries(names)) {
    const parts = dexKey.split("_");
    if (parts.length !== 2 || !entry?.en) continue;
    const dex = Number(parts[0]);
    if (!namesByDex.has(dex)) namesByDex.set(dex, []);
    namesByDex.get(dex).push(entry.en);
  }
  const out = new Map();
  for (const [dex, { template }] of byDex) {
    const speciesName = names[String(dex)]?.en;
    const overrides = template.settings.tempEvoOverrides;
    if (!speciesName || !Array.isArray(overrides)) continue;
    const speciesWords = nameKey(speciesName).split(/\s+/);
    for (const evoName of namesByDex.get(dex) || []) {
      const rest = withoutWords(nameKey(evoName).split(/\s+/), speciesWords);
      if (!rest) continue;
      const match = overrides.find((o) => {
        if (typeof o?.tempEvoId !== "string") return false;
        const words = tempEvoWords(o.tempEvoId);
        return words.length === rest.length && words.every((w) => rest.includes(w));
      });
      const types = [typeSlug(match?.typeOverride1), typeSlug(match?.typeOverride2)].filter(Boolean);
      if (types.length === 0) continue;
      out.set(nameKey(evoName), {
        id: template.settings.pokemonId,
        types: titleTypes(types),
        displayName: evoName,
      });
    }
  }
  return out;
}

// "landorus (incarnate)" from a raid-battles boss list, "giratina (origin
// forme)" from a raid-hour title: a species name with its forme in brackets.
const FORME_QUALIFIER = /^(.+?)\s*\(([^()]+)\)$/;

// Every word of a forme qualifier, with any punctuation inside a word read
// both ways, so "Pa'u" can meet PAU and "Rapid-Strike" RAPID_STRIKE.
function qualifierWords(qualifier) {
  const words = new Set();
  for (const word of qualifier.split(/\s+/)) {
    words.add(word.replace(/[^a-z0-9]/g, ""));
    for (const part of word.split(/[^a-z0-9]+/)) words.add(part);
  }
  words.delete("");
  return words;
}

// Resolves a boss key through the name index to {id, types, displayName}, or
// null. A bare species name is a plain lookup, and so is a temporary
// evolution's own name ("mega charizard x"). A forme in brackets resolves
// against that species' own form suffixes in the game master: the form whose
// suffix words all appear in the qualifier wins, the longest such suffix if
// several do, so "Incarnate" and "Incarnate Forme" both find
// LANDORUS_INCARNATE and "Zen Mode" finds DARMANITAN_ZEN, not
// DARMANITAN_GALARIAN_ZEN. A forme no form matches, or two match equally well,
// stays unresolved: another form can carry other types, and a guessed form's
// types build a counter filter for a different battle. Only the types are the
// form's. The id and display name stay the species', so the boss dedupes
// against lily-dex-api's species-level ids and the app names it through the
// dictionary.
export function resolveBossKey(nameIdx, key) {
  const hit = nameIdx.get(key);
  if (hit) return hit;
  const m = FORME_QUALIFIER.exec(key);
  const species = m && nameIdx.get(m[1]);
  if (!species) return null;
  const words = qualifierWords(m[2]);
  let best = null;
  let bestLength = 0;
  let tied = false;
  for (const [suffix, types] of species.forms || []) {
    const parts = suffix.toLowerCase().split("_");
    if (!parts.every((p) => words.has(p))) continue;
    if (parts.length > bestLength) [best, bestLength, tied] = [types, parts.length, false];
    else if (parts.length === bestLength) tied = true;
  }
  if (!best || tied) return null;
  return { id: species.id, types: best, displayName: species.displayName };
}

// Pulls boss name(s) and shadow/mega flags out of a ScrapedDuck event entry.
// raid-battles events ship with extraData.raidbattles.bosses[] — preferred
// since the names are already canonical. raid-day / raid-hour / raid-weekend
// entries only have a marketing title, so we strip the event-type tail
// ("Raid Day"/"Raid Hour"/"Raid Weekend"), the "Super Mega" community-day
// qualifier (which is not a Mega-tier marker) and the leading Shadow prefix
// (which IS a tier flag), and split multi-boss titles like
// "Buzzwole, Pheromosa, and Xurkitree Raid Hour". A leading Mega stays on the
// name, as it is in a raid-battles boss list: it is part of the Mega's name,
// which buildEventEntry looks the boss up by.
function parseEventBosses(event) {
  const title = event.name || "";
  // "Super Mega" is a community-day qualifier ("Falinks Super Mega Raid Day"),
  // not a Mega-tier marker, and a forme in brackets is part of a name
  // ("Calyrex (Shadow Rider)"), not a Shadow one. Strip both before testing
  // so neither trips a tier flag.
  const cleanTitle = title.replace(/\bSuper\s+Mega\b/gi, " ").replace(/\([^()]*\)/g, " ");
  const isShadow = /\bShadow\b/i.test(cleanTitle);
  const isMega   = /\bMega\b/i.test(cleanTitle);

  const fromExtra = event?.extraData?.raidbattles?.bosses;
  if (Array.isArray(fromExtra) && fromExtra.length > 0) {
    return {
      isShadow, isMega,
      names: fromExtra.map(b => b.name).filter(Boolean),
    };
  }

  // Fallback: parse the event title for raid-day / raid-hour / raid-weekend.
  let s = title
    .replace(/\s+Raid\s+(Day|Hour|Weekend)$/i, "")
    .replace(/\s+Super\s+Mega$/i, "")
    .replace(/^Super\s+Mega\s+/i, "")
    .replace(/^Shadow\s+/i, "");
  // Multi-boss split — try ", and ", " and ", then ", " in that order so
  // "A, B, and C" splits cleanly into [A, B, C].
  const names = s
    .split(/,\s*and\s+|\s+and\s+|,\s*/i)
    .map(n => n.trim())
    .filter(Boolean);
  return { isShadow, isMega, names };
}

// Pulls the bosses out of a Max Battle event. ScrapedDuck's max-mondays and
// max-battles entries carry no boss metadata (extraData holds only the generic
// flags), so the title is all there is: "Dynamax Sneasel during Max Monday",
// "Dynamax Uxie, Mesprit, and Azelf Max Battle Day". The event tail goes, the
// names split as a raid title's do, and each name's Dynamax / Gigantamax
// prefix is read off it. A name without a prefix of its own takes the title's,
// so "Gigantamax Venusaur, Charizard, and Blastoise" marks all three. A tail
// this does not know stays on the last name, which then fails to resolve and
// warns rather than being guessed at.
const MAX_PREFIX = /^(Dynamax|Gigantamax)\s+/i;
export function parseMaxEventBosses(event) {
  const names = String(event?.name || "")
    .trim()
    .replace(/\s+(?:during\s+)?Max\s+(?:Battle\s+(?:Day|Weekend)|Mondays?)$/i, "")
    .split(/,\s*and\s+|\s+and\s+|,\s*/i)
    .map(n => n.trim())
    .filter(Boolean);
  const titlePrefix = MAX_PREFIX.exec(names[0] || "")?.[1] || "";
  return names.map((n) => ({
    name: n.replace(MAX_PREFIX, ""),
    gigantamax: /^gigantamax$/i.test(MAX_PREFIX.exec(n)?.[1] || titlePrefix),
  }));
}

// Resolves an event's boss names through the name index (resolveBossKey, so a
// forme in brackets resolves too), drops the ones the standing rotation
// already lists, and derives the rest. Each pick is
// { name, key, dedupeKey(id), extra }: `name` as the feed spelled it (for the
// warning), `key` the index key with any tier prefix stripped, `extra` fields
// added to the derived boss. Returns `{bosses, status}` where status is
// "ok" | "deduped" | "unresolved", which the caller logs.
function resolveEventBosses(event, picks, nameIdx, allTypes, typeIdx, dedupeSet) {
  const bosses = [];
  let anyUnresolved = false;
  let anyDeduped = false;
  for (const { name, key, dedupeKey, extra } of picks) {
    const hit = resolveBossKey(nameIdx, key);
    if (!hit) {
      anyUnresolved = true;
      console.warn(`  ⚠ event "${event.name}": cannot resolve boss "${name}" — skipped`);
      continue;
    }
    if (dedupeSet.has(dedupeKey(hit.id))) { anyDeduped = true; continue; }

    // `normalizeNames()` keys off lily-dex-api's TitleCase language labels
    // ("English", "German"), not BCP47 — pass the same shape so the resulting
    // boss carries an `en` name that buildBossEntry() can fall back on.
    const derived = deriveBoss(
      { id: hit.id, names: { English: hit.displayName }, types: hit.types },
      allTypes, typeIdx,
    );
    if (derived) bosses.push({ ...derived, ...extra });
  }
  if (bosses.length > 0) return { bosses, status: "ok" };
  return { bosses, status: anyUnresolved && !anyDeduped ? "unresolved" : "deduped" };
}

// Builds the per-event entry that the workshop UI consumes. Returns
// `{entry, status}` where status is "ok" | "deduped" | "unresolved". Caller
// uses the status to log a meaningful summary; an entry of null means we
// drop the event entirely so the UI doesn't render an empty accordion.
function buildEventEntry(event, nameIdx, allTypes, typeIdx, dedupeSet) {
  const { isShadow, isMega, names } = parseEventBosses(event);
  if (names.length === 0) return { entry: null, status: "unresolved" };

  // Dedupe against the standing tier rotation so e.g. Shadow Latios doesn't
  // appear twice (once in shadow_lvl5, once as a raid-battles event).
  // Shadow is only a tier word, so it goes. Mega stays: a Mega is looked up
  // by its own name, "mega gyarados", which the index holds with the Mega's
  // types (see tempEvoEntries). Stripped to its species, it would take the
  // base form's: water/flying for Mega Gyarados, which is water/dark. A Mega
  // the index does not hold stays unresolved rather than getting those.
  const picks = names.map((rawName) => ({
    name: rawName,
    key: nameKey(rawName).replace(/^shadow\s+/i, "").trim(),
    dedupeKey: (id) => `${id}|${isShadow ? "S" : ""}|${isMega ? "M" : ""}`,
  }));
  const { bosses, status } = resolveEventBosses(event, picks, nameIdx, allTypes, typeIdx, dedupeSet);
  if (bosses.length === 0) return { entry: null, status };
  return {
    entry: {
      eventID: event.eventID,
      name: event.name,
      eventType: event.eventType,
      start: event.start,
      end: event.end,
      isShadow,
      isMega,
      bosses,
    },
    status,
  };
}

// A Gigantamax battle is a different battle from a Dynamax one of the same
// species, so the two never dedupe against each other.
const maxDedupeKey = (id, gigantamax) => `${id}|${gigantamax ? "G" : ""}`;

// The Max Battle counterpart of buildEventEntry: the same entry without the
// raid tier flags, each boss in the standing maxBattles shape, and
// `gigantamax: true` on a boss the title calls Gigantamax.
function buildMaxEventEntry(event, nameIdx, allTypes, typeIdx, dedupeSet) {
  const parsed = parseMaxEventBosses(event);
  if (parsed.length === 0) {
    console.warn(`  ⚠ event "${event.name}": no boss named in the title, skipped`);
    return { entry: null, status: "unresolved" };
  }
  const picks = parsed.map(({ name, gigantamax }) => ({
    name,
    key: nameKey(name),
    dedupeKey: (id) => maxDedupeKey(id, gigantamax),
    extra: gigantamax ? { gigantamax: true } : undefined,
  }));
  const { bosses, status } = resolveEventBosses(event, picks, nameIdx, allTypes, typeIdx, dedupeSet);
  if (bosses.length === 0) return { entry: null, status };
  return {
    entry: {
      eventID: event.eventID,
      name: event.name,
      eventType: event.eventType,
      start: event.start,
      end: event.end,
      bosses,
    },
    status,
  };
}

// Runs every feed event of `types` that is live now or starts within the
// lookahead through `build`, counting what it drops. One date gate for event
// raids and event Max Battles alike: an event without a parseable window
// (ScrapedDuck publishes a just-ended Max Monday with null dates) is skipped.
function surfaceEvents(eventsRaw, types, now, build) {
  const horizon = now + EVENT_LOOKAHEAD_MS;
  const entries = [];
  let deduped = 0;
  let unresolved = 0;
  for (const event of (Array.isArray(eventsRaw) ? eventsRaw : [])) {
    if (!types.has(event?.eventType)) continue;
    const startMs = Date.parse(event.start);
    const endMs = Date.parse(event.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs < now) continue;          // already over
    if (startMs > horizon) continue;    // beyond the 7-day lookahead
    const { entry, status } = build(event);
    if (entry) entries.push(entry);
    else if (status === "deduped") deduped++;
    else unresolved++;
  }
  // Chronological order so the UI can render top-down without re-sorting.
  entries.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { entries, deduped, unresolved };
}

// Event raids from ScrapedDuck's feed, deduped against the standing raid
// tiers. Exported for check-data-filters.mjs, which runs a synthetic feed
// through it, as it does through buildEventMaxBattles below.
export function buildEventRaids(eventsRaw, { nameIdx, allTypes, raids, now = Date.now() }) {
  const typeIdx = indexTypes(allTypes);
  const dedupeSet = buildStandingDedupeSet(raids);
  return surfaceEvents(eventsRaw, EVENT_RAID_TYPES, now,
    (event) => buildEventEntry(event, nameIdx, allTypes, typeIdx, dedupeSet));
}

// Event Max Battles from ScrapedDuck's feed, deduped against lily-dex-api's
// standing list should it ever come back. That list carries no Gigantamax
// marker, so every standing boss counts as a Dynamax one. Exported for
// check-data-filters.mjs, which runs a synthetic feed through it.
export function buildEventMaxBattles(eventsRaw, { nameIdx, allTypes, maxBattles, now = Date.now() }) {
  const typeIdx = indexTypes(allTypes);
  const dedupeSet = new Set(
    Object.values(maxBattles || {}).flatMap((list) => (list || []).map((b) => maxDedupeKey(b.id, false))),
  );
  return surfaceEvents(eventsRaw, EVENT_MAX_TYPES, now,
    (event) => buildMaxEventEntry(event, nameIdx, allTypes, typeIdx, dedupeSet));
}

// Standing-tier dedupe set: every (id, shadow?, mega?) already covered by
// raids.{mega, lvl5, shadow_lvl5, …}. Built from the derived tier output so
// the ID format matches downstream consumers exactly.
function buildStandingDedupeSet(tieredRaids) {
  const set = new Set();
  for (const [tier, list] of Object.entries(tieredRaids || {})) {
    const isShadow = tier.startsWith("shadow_");
    const isMega = tier === "mega";
    for (const boss of list) {
      set.add(`${boss.id}|${isShadow ? "S" : ""}|${isMega ? "M" : ""}`);
    }
  }
  return set;
}

function deriveTiered(rawBossesByTier, allTypes, typeIdx) {
  const out = {};
  for (const [tier, list] of Object.entries(rawBossesByTier || {})) {
    if (!Array.isArray(list)) continue;
    const derived = list
      .map((b) => deriveBoss(b, allTypes, typeIdx))
      .filter(Boolean);
    if (derived.length > 0) out[tier] = derived;
  }
  return out;
}

function writeJson(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Order-independent stringify for content comparison. The upstream API
// returns objects in stable key order across runs, but normalize anyway so
// a future re-key on either side doesn't trigger a spurious diff.
function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

function readPrevious(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

// The two standing rotations lily-dex-api publishes. Neither event list is
// one of them: eventRaids and eventMaxBattles are 7-day windows, legitimately
// empty between events, and they are built after this guard runs.
export const GUARDED_FAMILIES = ["raids", "maxBattles"];

function bossCount(tiers) {
  return Object.values(tiers || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

// Decides what an emptied family costs. lily-dex-api reports an outage as a
// well-formed empty list with HTTP 200, not as an error: maxbattles.json has
// answered {"currentList":[]} since 2026-06-11 while its Last-Modified kept
// moving, and the old guard, which fired only when raids AND maxBattles were
// both empty, kept the sync green for four months. So the refusal is per
// family and judged against the previous snapshot: a family that had bosses
// and now has none is refused. One that was already empty stays quiet, or
// every daily run would fail on a hole nothing in this repo can fill. An
// entirely empty result is refused whatever came before, since no rotation
// ever looks like that.
//
// Returns { refused, write, exitCode }. `refused` lists { family, was }, and
// `write` is the content to write, or null to leave the cache untouched:
//   - under --offline-ok (prebuild) the whole cache stays and the exit is 0,
//     as on every other offline route: a refusal must not take down
//     `npm run build` over a problem the committed snapshot already solves.
//   - in the sync job each refused family keeps the previous snapshot's tiers,
//     the rest is written, and the exit is 1, so the healthy family and the
//     event lists still land and the run goes red. A failed Rocket takeover
//     read is handled the same way.
//   - with no previous snapshot there is nothing to keep, so nothing is
//     written and the exit is 1.
export function guardEmptiedFamilies(prev, next, { offlineOk = false } = {}) {
  const allEmpty = GUARDED_FAMILIES.every((f) => bossCount(next[f]) === 0);
  const refused = GUARDED_FAMILIES
    .map((family) => ({ family, was: bossCount(prev?.[family]) }))
    .filter(({ family, was }) => bossCount(next[family]) === 0 && (was > 0 || allEmpty));
  if (refused.length === 0) return { refused, write: next, exitCode: 0 };
  if (!prev) return { refused, write: null, exitCode: 1 };
  if (offlineOk) return { refused, write: null, exitCode: 0 };
  const write = { ...next };
  for (const { family } of refused) write[family] = prev[family] || {};
  return { refused, write, exitCode: 1 };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  // A failed fetch and a refused result take the same route, as in
  // fetch-pvp-rankings.mjs: rejecting what came back means the committed cache
  // is the better answer, not that `npm run build` should die. A throw here
  // used to exit 1 under --offline-ok too, and prebuild chains every fetcher
  // with &&.
  const keepCacheOrExit = (message) => {
    console.error(`✗ ${message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  };

  let typesArr, raidBossRaw, maxBattlesRaw, eventsRaw, gameMaster;
  try {
    console.log("→ Fetching lily-dex-api + ScrapedDuck + game master");
    [typesArr, raidBossRaw, maxBattlesRaw, eventsRaw, gameMaster] = await Promise.all([
      fetchJson(ENDPOINTS.types),
      fetchJson(ENDPOINTS.raidboss),
      fetchJson(ENDPOINTS.maxbattles),
      fetchJson(ENDPOINTS.events),
      fetchGameMaster({ userAgent: "pogo-filter-workshop raid-fetcher/1.0" }),
    ]);
  } catch (e) {
    return keepCacheOrExit(`Fetch failed: ${e.message}`);
  }

  if (!Array.isArray(typesArr) || typesArr.length < 18) {
    return keepCacheOrExit(`types.json missing or too short (got ${typesArr?.length ?? 0} entries)`);
  }
  const typeIdx = indexTypes(typesArr);

  const prev = readPrevious(OUT_PATH);
  // lily-dex-api wraps boss listings in `currentList`; the rest of the response
  // is graphics/headers we don't need.
  const guard = guardEmptiedFamilies(prev, {
    raids: deriveTiered(raidBossRaw?.currentList, typesArr, typeIdx),
    maxBattles: deriveTiered(maxBattlesRaw?.currentList, typesArr, typeIdx),
  }, { offlineOk });
  for (const { family, was } of guard.refused) {
    console.error(`✗ ${family} came back empty (${was} bosses in the previous snapshot): refusing to overwrite it`);
  }
  if (!guard.write) {
    if (guard.exitCode !== 0) process.exit(guard.exitCode);
    console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
    return;
  }
  const { raids, maxBattles } = guard.write;

  // Event raids and event Max Battles: currently active + upcoming within
  // the lookahead window. Built after the standing-tier derivation so dedupe
  // can prune events whose bosses are already in the rotation.
  if (gameMaster.failures.length > 0) {
    console.warn(`⚠  fell back to ${gameMaster.mirror} after ${gameMaster.failures.join("; ")}`);
  }
  warnIfStale(gameMaster, "A boss released since that batch cannot be resolved out of an event title.");
  const nameIdx = buildNameIndex(
    gameMaster.templates,
    JSON.parse(readFileSync(NAMES_PATH, "utf8")),
  );
  if (nameIdx.size < 500) {
    return keepCacheOrExit(`species name index collapsed to ${nameIdx.size} entries — refusing to drop event bosses silently`);
  }
  const now = Date.now();
  const raidEvents = buildEventRaids(eventsRaw, { nameIdx, allTypes: typesArr, raids, now });
  const eventRaids = raidEvents.entries;
  const maxEvents = buildEventMaxBattles(eventsRaw, { nameIdx, allTypes: typesArr, maxBattles, now });
  const eventMaxBattles = maxEvents.entries;

  const totalRaids = Object.values(raids).reduce((a, l) => a + l.length, 0);
  const totalMax = Object.values(maxBattles).reduce((a, l) => a + l.length, 0);

  // Preserve the previous fetchedAt when boss content is unchanged, so the
  // scheduled sync workflow doesn't open a PR every day just because the
  // timestamp moved. The UI's "last sync · Xh ago" still reflects the
  // moment we last observed real upstream changes.
  //
  // `eventRaids` is intentionally excluded from the canonical hash: each event
  // entry's relative window shifts every time the script runs (by definition,
  // since we filter by `now`), so including it would force a daily diff even
  // when nothing material changed in the rotation.
  //
  // `eventMaxBattles` is included although it is windowed the same way. With
  // lily-dex-api's standing list empty it is everything the Max Battle panel
  // shows, and the panel's "last sync" would otherwise date a boss that
  // arrived today to whenever the raid rotation last moved. Max events come a
  // few times a week at most, so this moves the stamp that often, not daily.
  const newContent = { raids, maxBattles, eventMaxBattles };
  let fetchedAt = new Date().toISOString();
  if (prev) {
    const prevContent = { raids: prev.raids, maxBattles: prev.maxBattles, eventMaxBattles: prev.eventMaxBattles ?? [] };
    if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
      fetchedAt = prev.fetchedAt;
      console.log("  ↺ content unchanged — preserving previous fetchedAt");
    }
  }

  writeJson(OUT_PATH, { fetchedAt, raids, maxBattles, eventRaids, eventMaxBattles });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  raids: ${totalRaids} bosses across ${Object.keys(raids).length} tiers`);
  console.log(`  maxBattles: ${totalMax} bosses across ${Object.keys(maxBattles).length} tiers`);
  console.log(`  eventRaids: ${eventRaids.length} surfaced · ${raidEvents.deduped} deduped against standing tiers · ${raidEvents.unresolved} unresolved`);
  console.log(`  eventMaxBattles: ${eventMaxBattles.length} surfaced · ${maxEvents.deduped} deduped against the standing list · ${maxEvents.unresolved} unresolved`);
  const gmAgeDays = gameMasterAgeDays(gameMaster.batchMs);
  console.log(`  boss name index: ${nameIdx.size} species from ${gameMaster.mirror}` +
    `${gmAgeDays != null ? ` (${gmAgeDays}d old)` : " (unstamped)"}`);
  if (guard.exitCode !== 0) {
    const kept = guard.refused.map((r) => r.family).join(" and ");
    console.error(`✗ kept the previous ${kept} and wrote the rest; failing the run so the empty upstream is seen`);
    process.exitCode = guard.exitCode;
  }
}

// Only run when executed directly — the offline checks import buildNameIndex,
// resolveBossKey, guardEmptiedFamilies and the event raid and Max Battle
// builders above without triggering a fetch.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
