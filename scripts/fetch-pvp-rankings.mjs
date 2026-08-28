#!/usr/bin/env node
// Pulls Great / Ultra / Master league rankings from PvPoke (MIT), dedupes by
// base dex number, takes the top N, and writes a slim per-league artifact at
// src/data/pvp-rankings.json that App.jsx imports at build time.
//
// PvPoke is the upstream every community PvP feed derives from, so we read it
// directly rather than through a mirror. lily-dex-api stays as the fallback: if
// PvPoke is unreachable or reshapes, we degrade to the old feed instead of
// publishing a hole. `source` records which one produced the file.
//
// The join: PvPoke's rankings carry `speciesId` but NO dex number. dex comes
// from gamemaster.min.json's `pokemon[]`, keyed by the same speciesId. That is
// the only reason we fetch the game master here.
//
// Why store dex + name pairs (not raw speciesIds): forms like
// `darmanitan_galarian_zen` need to fold into the base species so PoGo's
// family-search (`+darmanitan`) catches every form. dexNr is stable identity;
// speciesName is a locale fallback if our dex dict doesn't have a matching
// entry at render time. That fallback is why `name` must be the BASE name —
// App.jsx:3865 falls back to `s.name.toLowerCase()`, and a stored
// "Quagsire (Shadow)" would emit `+quagsire (shadow)`, a filter token with a
// space in it that matches nothing.
//
// Cups come from the game master's `formats[]` (15 entries carrying the
// {cup, cp, title} triple the ranking path needs) — NOT its `cups[]`, which has
// no CP field and includes the non-cups `all` and `custom`. Each format is
// paired with the ScrapedDuck GBL event windows that name it, so the app can
// render an "active cup" card that hides itself outside the cup's run.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "pvp-rankings.json");
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");

const PVPOKE_BASE = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data";
const GAMEMASTER = `${PVPOKE_BASE}/gamemaster.min.json`;
const rankingsUrl = (cup, cp) => `${PVPOKE_BASE}/rankings/${cup}/overall/rankings-${cp}.json`;

const LILY_DEX = "https://mknepprath.github.io/lily-dex-api/rankings.json";
const SCRAPED_DUCK_EVENTS = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json";

const TOP_N = 30;
// How deep into a ranking list we look. Far enough past TOP_N to fold every
// alternate form of a top-30 species into its base entry, shallow enough that a
// tail of unranked junk can't skew the join-miss ratio.
const SCAN_DEPTH = 300;
// A gamemaster reshape looks like a sudden inability to resolve speciesIds.
const MAX_JOIN_MISS_RATIO = 0.05;

const LEAGUES = {
  great:  { cpCap: 1500 },
  ultra:  { cpCap: 2500 },
  master: { cpCap: 10000 },
};
// What the app writes out as the CP clause. Master has no cap in game, so
// buildLeagueFilter skips its IV math entirely — represent that as null even
// though PvPoke addresses the file as `rankings-10000.json`.
const STORED_CP_CAP = { great: 1500, ultra: 2500, master: null };
// PvPoke addresses the uncapped league as cp 10000. Stored as null so
// buildLeagueFilter skips the CP clause AND the rank-1 IV math: with no cap to
// squeeze under, a low-attack spread is worse than a hundo, not better.
const storedCap = (cp) => (typeof cp === "number" && cp < 10000 ? cp : null);
// League tokens in a LeekDuck event slug, and the CP cap each implies.
const LEAGUE_TOKEN_CP = { "great-league": 1500, "ultra-league": 2500, "master-league": 10000 };
// Not cups: `all` is the open-league pseudo-cup, `custom` is the site's builder.
const NON_CUPS = new Set(["all", "custom"]);

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop pvp-fetcher/2.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Cup ranking files legitimately 404 — not every (cup, cap) pair is published.
async function fetchJsonOrNull(url) {
  try {
    return await fetchJson(url);
  } catch (e) {
    console.warn(`  ⚠  ${e.message}`);
    return null;
  }
}

// Small pool so a burst of cup fetches can't trip GitHub's 60-requests-per-hour
// unauthenticated cap as a 429 storm.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const stripForm = (name) => String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();

// speciesId → {dex, speciesName}, plus dex → base (suffix-free) species name.
// The base name matters: it is what App.jsx falls back to when the dex dict
// misses, and a parenthesised form name there produces a broken filter token.
function buildSpeciesIndex(gm) {
  const bySpeciesId = new Map();
  const baseNameByDex = new Map();
  for (const p of gm?.pokemon || []) {
    if (typeof p?.dex !== "number" || typeof p?.speciesId !== "string") continue;
    bySpeciesId.set(p.speciesId, { dex: p.dex, speciesName: p.speciesName || "" });
    // First parenthesis-free name wins; that is the base species.
    if (!baseNameByDex.has(p.dex) && p.speciesName && !p.speciesName.includes("(")) {
      baseNameByDex.set(p.dex, p.speciesName);
    }
  }
  return { bySpeciesId, baseNameByDex };
}

// Dedupe by dex (forms collapse to base species — `+raichu` already catches
// both regular and Alolan via family search). Preserve PvPoke's score order.
// The folded-away forms are kept as metadata: which form is the RANKED one is a
// real collection signal (a Shadow ranking above its base means build the
// Shadow), even though it cannot change the emitted filter token.
function topNFromPvpoke(rankings, index, n) {
  if (!Array.isArray(rankings)) return { list: [], scanned: 0, missed: 0 };
  const byDex = new Map();
  const out = [];
  let scanned = 0;
  let missed = 0;
  for (const entry of rankings.slice(0, SCAN_DEPTH)) {
    const speciesId = entry?.speciesId;
    if (typeof speciesId !== "string") continue;
    scanned++;
    const meta = index.bySpeciesId.get(speciesId);
    if (!meta) { missed++; continue; }
    const existing = byDex.get(meta.dex);
    if (existing) { existing.forms.push(speciesId); continue; }
    const record = {
      dex: meta.dex,
      name: index.baseNameByDex.get(meta.dex) || stripForm(meta.speciesName) || `dex_${meta.dex}`,
      speciesId,
      score: typeof entry.score === "number" ? entry.score : null,
      forms: [speciesId],
    };
    byDex.set(meta.dex, record);
    if (out.length < n) out.push(record);
  }
  return { list: out, scanned, missed };
}

// lily-dex fallback: its entries already carry dexNr, so no join is needed.
function topNByDex(rankings, n) {
  if (!Array.isArray(rankings)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of rankings) {
    const dex = entry?.dexNr;
    if (typeof dex !== "number" || seen.has(dex)) continue;
    seen.add(dex);
    out.push({ dex, name: stripForm(entry.speciesName) || `dex_${dex}` });
    if (out.length >= n) break;
  }
  return out;
}

// Lowercase kebab token stream. The eventID is the higher-signal field — it is
// LeekDuck's URL slug, so it is already stable kebab-case — but the display
// name is folded in too because a slug can drop a qualifier.
const tokenize = (...parts) =>
  parts.join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Whole-token match only. The old matcher used a bare substring test, where cup
// id `all` matched "Fall" and `catch` matched "catching".
const hasToken = (stream, token) =>
  new RegExp(`(^|-)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-|$)`).test(stream);

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

function readPrevious() {
  if (!existsSync(OUT_PATH)) return null;
  try { return JSON.parse(readFileSync(OUT_PATH, "utf8")); } catch { return null; }
}

// ---------------------------------------------------------------- PvPoke path

async function fromPvpoke() {
  console.log("→ PvPoke: game master");
  const gm = await fetchJson(GAMEMASTER);
  const index = buildSpeciesIndex(gm);
  if (index.bySpeciesId.size === 0) throw new Error("game master carried no pokemon[] — refusing");
  console.log(`  ${index.bySpeciesId.size} speciesIds indexed`);

  console.log("→ PvPoke: standing leagues");
  const leagues = {};
  for (const [key, meta] of Object.entries(LEAGUES)) {
    const raw = await fetchJson(rankingsUrl("all", meta.cpCap));
    const { list, scanned, missed } = topNFromPvpoke(raw, index, TOP_N);
    if (scanned > 0 && missed / scanned > MAX_JOIN_MISS_RATIO) {
      throw new Error(
        `${key}: ${missed}/${scanned} speciesIds failed the dex join — game master reshaped?`,
      );
    }
    if (list.length === 0) throw new Error(`${key}: no rankings survived the join`);
    leagues[key] = { cpCap: STORED_CP_CAP[key], species: list };
    console.log(`  ${key}: ${list.length} species (${missed} join misses of ${scanned} scanned)`);
  }

  return { leagues, index, formats: gm?.formats || [] };
}

// Discover the cups a GBL event is actually running, from the game master's
// formats[]. Keyed `${cup}-${cp}` because `mega` appears three times (1500 /
// 2500 / 10000) and a bare cup id would collide.
function matchFormatsToEvent(formats, stream) {
  const leagueTokens = Object.keys(LEAGUE_TOKEN_CP).filter(t => hasToken(stream, t));
  const capsNamed = new Set(leagueTokens.map(t => LEAGUE_TOKEN_CP[t]));
  const matched = [];
  for (const f of formats) {
    if (!f || typeof f.cup !== "string" || typeof f.cp !== "number") continue;
    if (NON_CUPS.has(f.cup)) continue;
    if (!hasToken(stream, f.cup)) continue;
    // A cup published at several caps ("Mega Great/Ultra/Master League") is
    // disambiguated by the league the event names. If the event names none,
    // every cap of that cup is running.
    if (capsNamed.size > 0 && !capsNamed.has(f.cp)) continue;
    matched.push(f);
  }
  return { matched, leagues: leagueTokens.map(t => t.replace("-league", "")) };
}

async function buildCups(formats, index, sdEvents) {
  const events = (Array.isArray(sdEvents) ? sdEvents : []).filter(
    e => e?.eventType === "go-battle-league",
  );

  const wanted = new Map(); // `${cup}-${cp}` → format
  const gblEvents = [];
  for (const e of events) {
    const stream = tokenize(e.eventID || "", e.name || "");
    const { matched, leagues } = matchFormatsToEvent(formats, stream);
    // A runaway matcher is the failure mode worth catching loudly: a real GBL
    // week runs at most one cup across three caps.
    if (matched.length > 4) {
      console.warn(`  ⚠  "${e.name}" matched ${matched.length} formats — matcher may be too loose`);
    }
    const ids = [];
    for (const f of matched) {
      const id = `${f.cup}-${f.cp}`;
      wanted.set(id, f);
      ids.push(id);
    }
    gblEvents.push({
      eventID: e.eventID,
      name: e.name,
      start: e.start,
      end: e.end,
      cups: ids,
      leagues,
    });
  }
  gblEvents.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const entries = [...wanted.entries()];
  if (entries.length > 0) console.log(`→ PvPoke: ${entries.length} cup ranking file(s)`);
  const fetched = await mapLimit(entries, 3, async ([id, f]) => {
    const raw = await fetchJsonOrNull(rankingsUrl(f.cup, f.cp));
    if (!raw) return null;
    const { list } = topNFromPvpoke(raw, index, TOP_N);
    if (list.length === 0) return null;
    return [id, {
      id,
      cup: f.cup,
      meta: f.meta || f.cup,
      name: f.title || id,
      cpCap: storedCap(f.cp),
      species: list,
    }];
  });

  const cups = {};
  for (const row of fetched) if (row) cups[row[0]] = row[1];
  // Drop ids we could not fetch, so gblEvents never references a missing cup.
  for (const e of gblEvents) e.cups = e.cups.filter(id => cups[id]);
  return { cups, gblEvents };
}

// -------------------------------------------------------------- lily-dex path

function fromLilyDex(raw) {
  const leagues = {};
  for (const key of Object.keys(LEAGUES)) {
    const list = topNByDex(raw?.[key], TOP_N);
    if (list.length === 0) continue;
    leagues[key] = { cpCap: STORED_CP_CAP[key], species: list };
  }
  const cups = {};
  for (const cup of raw?.cups || []) {
    if (!cup || typeof cup.id !== "string") continue;
    const list = topNByDex(cup.rankings, TOP_N);
    if (list.length === 0) continue;
    cups[cup.id] = {
      id: cup.id,
      cup: cup.id,
      meta: cup.id,
      name: cup.name || cup.id,
      cpCap: storedCap(cup.cp),
      species: list,
    };
  }
  return { leagues, cups };
}

// ---------------------------------------------------------------------- guards

// Every emitted dex must resolve in the name dictionary App.jsx renders from.
// This is check-data-filters' "no undefined in a clause" pushed back to the data
// layer, where the diagnostic can name the offending dex.
function assertDexResolvable(leagues, cups) {
  let dict;
  try {
    dict = JSON.parse(readFileSync(NAMES_PATH, "utf8"));
  } catch {
    console.warn("  ⚠  pokemon-names.json unreadable — skipping dex-resolvability check");
    return;
  }
  const bad = [];
  const scan = (label, list) => {
    for (const s of list || []) if (!dict[String(s.dex)]) bad.push(`${label}:${s.dex} (${s.name})`);
  };
  for (const [key, l] of Object.entries(leagues)) scan(key, l.species);
  for (const [id, c] of Object.entries(cups)) scan(id, c.species);
  if (bad.length > 0) {
    throw new Error(`dex numbers absent from pokemon-names.json: ${bad.join(", ")}`);
  }
}

// Mirrors the refuse-to-shrink guard in the skill's refresh script: cups
// rotating out is normal, cups vanishing entirely when we had some is a matcher
// or upstream failure and must not be published.
function assertNoCupCollapse(prev, cups) {
  const before = Object.keys(prev?.cups || {}).length;
  const after = Object.keys(cups).length;
  if (before > 0 && after === 0) {
    throw new Error(`cups collapsed ${before} → 0 — refusing to overwrite cache`);
  }
  if (after < before) console.warn(`  ⚠  cups ${before} → ${after} (rotation, or a matcher regression)`);
}

// ------------------------------------------------------------------------ main

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");
  const prev = readPrevious();

  let sdEvents = [];
  try {
    sdEvents = await fetchJson(SCRAPED_DUCK_EVENTS);
  } catch (e) {
    console.warn(`⚠  ScrapedDuck events unavailable (${e.message}) — cups will be inactive`);
  }

  let leagues = null;
  let cups = {};
  let gblEvents = [];
  let source = "pvpoke";

  try {
    const pv = await fromPvpoke();
    leagues = pv.leagues;
    const built = await buildCups(pv.formats, pv.index, sdEvents);
    cups = built.cups;
    gblEvents = built.gblEvents;
  } catch (e) {
    console.error(`✗ PvPoke failed: ${e.message}`);
    console.warn("→ falling back to lily-dex-api");
    try {
      const raw = await fetchJson(LILY_DEX);
      const lily = fromLilyDex(raw);
      if (Object.keys(lily.leagues).length === 0) throw new Error("lily-dex returned no leagues");
      leagues = lily.leagues;
      cups = lily.cups;
      source = "lily-dex";
      const cupIds = Object.keys(cups);
      gblEvents = (Array.isArray(sdEvents) ? sdEvents : [])
        .filter(ev => ev?.eventType === "go-battle-league")
        .map(ev => {
          const stream = tokenize(ev.eventID || "", ev.name || "");
          return {
            eventID: ev.eventID,
            name: ev.name,
            start: ev.start,
            end: ev.end,
            cups: cupIds.filter(id => hasToken(stream, id)),
            leagues: Object.keys(LEAGUE_TOKEN_CP)
              .filter(t => hasToken(stream, t))
              .map(t => t.replace("-league", "")),
          };
        })
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    } catch (e2) {
      console.error(`✗ Fallback failed: ${e2.message}`);
      if (offlineOk && existsSync(OUT_PATH)) {
        console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
        return;
      }
      process.exit(1);
    }
  }

  if (!leagues || Object.keys(leagues).length === 0) {
    throw new Error("All leagues came back empty — refusing to overwrite cache");
  }
  assertDexResolvable(leagues, cups);
  assertNoCupCollapse(prev, cups);

  const newContent = { topN: TOP_N, source, leagues, cups, gblEvents };
  let fetchedAt = new Date().toISOString();
  if (prev) {
    const { fetchedAt: _prev, ...prevContent } = prev;
    if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
      fetchedAt = prev.fetchedAt;
      console.log("  ↺ content unchanged — preserving previous fetchedAt");
    }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  const total = Object.values(leagues).reduce((n, l) => n + l.species.length, 0);
  const cupTotal = Object.values(cups).reduce((n, c) => n + c.species.length, 0);
  console.log(`✓ wrote ${OUT_PATH} (source: ${source})`);
  console.log(`  ${Object.keys(leagues).length} leagues, ${total} species total (top ${TOP_N} each, deduped by dex)`);
  console.log(`  ${Object.keys(cups).length} cups, ${cupTotal} species; ${gblEvents.length} GBL event windows`);
}

main().catch(e => { console.error(e); process.exit(1); });
