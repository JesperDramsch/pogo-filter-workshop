#!/usr/bin/env node
// Generates the PvP half of the `pokemon-go-filters` skill's reference material
// from the same snapshot the app reads, so the skill and the app can never
// disagree about what the meta is.
//
// This exists because they DID disagree. The skill shipped a hand-maintained
// tier list headed "April 2026 / GBL Season 26" whose entire Great League
// S-tier — Azumarill, Galarian Stunfisk, Medicham — had fallen out of the live
// top 30 by August 2026, while the app, reading src/data/pvp-rankings.json, was
// right the whole time. A hand-written list is wrong within weeks and gives no
// signal that it has gone wrong.
//
// Load-bearing detail: the filter strings in the output are produced by
// App.jsx's own buildFilters(), never re-implemented here. A reimplementation
// would be a second thing to keep in sync, which is the bug this file exists to
// remove. That is also why this runs under vite-node rather than plain node.
//
// Run: npm run generate-pvp-meta-reference   (wired into the PvP sync workflow)

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pokemonNameFor } from "../src/data/species.js";
import { buildResult } from "./lib/fixture.mjs";
import { canonicalStringify } from "./lib/json.mjs";
import { REFERENCE_LOCALES as LOCALES } from "./lib/meta-reference.mjs";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REF_DIR = resolve(ROOT, "skills/pokemon-go-filters/references");
const JSON_OUT = resolve(REF_DIR, "pvp-meta.json");
const MD_OUT = resolve(REF_DIR, "META.md");

const RAW_BASE =
  "https://raw.githubusercontent.com/JesperDramsch/pogo-filter-workshop/main";
const LEAGUE_TITLE = { great: "Great League (Superliga)", ultra: "Ultra League (Hyperliga)", master: "Master League (Meisterliga)" };

function watchInfo() {
  const p = resolve(ROOT, "src/data/game-master-watch.json");
  if (!existsSync(p)) return null;
  try {
    const w = JSON.parse(readFileSync(p, "utf8"));
    // PvP entries only. The watch grew a second, PvE stream (raid move power,
    // duration and energy), and this section is captioned "Trainer-Battle stat
    // change" — rendering a PvE entry under it would be a false statement about
    // what moved. Entries predating the `stream` tag are all PvP.
    const last = (w.history || []).find(h => (h.stream ?? "pvp") === "pvp") || null;
    return {
      checkedAt: w.fetchedAt || null,
      lastChangeAt: last?.at || null,
      lastChangeSummary: last?.summary || null,
      movesChanged: last ? [...new Set(last.changes.map(c => c.move))] : [],
    };
  } catch { return null; }
}

// Via scripts/lib/fixture.mjs's buildResult, which is also what the fixture and
// check-meta-reference call. M4 asserts the strings below are byte-identical to
// the app's own output, so producer and checker must not spell the buildFilters
// call out separately — they would drift the moment it grew a parameter.
const built = Object.fromEntries(
  LOCALES.map(loc => [loc, buildResult(loc, { hundos: [], luckies: [] })]),
);

function speciesRows(list) {
  return list.map((s, i) => ({
    rank: i + 1,
    dex: s.dex,
    name: s.name,
    speciesId: s.speciesId ?? null,
    score: s.score ?? null,
    forms: s.forms ?? null,
    names: Object.fromEntries(LOCALES.map(l => [l, pokemonNameFor(String(s.dex), l) || s.name.toLowerCase()])),
  }));
}

// --------------------------------------------------------------- pvp-meta.json

const leagues = {};
for (const [key, l] of Object.entries(PVP_RANKINGS.leagues || {})) {
  leagues[key] = {
    cpCap: l.cpCap,
    species: speciesRows(l.species || []),
    filters: Object.fromEntries(LOCALES.map(loc => [loc, built[loc].pvpFilters?.[key]?.clause || ""])),
  };
}

// Cups are emitted whether or not one is running right now: the app gates the
// CARD on the event window, but the reference documents what exists, and an
// empty section would read as "the file is broken" rather than "no cup today".
const cups = {};
const cupWindow = {};
for (const e of PVP_RANKINGS.gblEvents || []) {
  for (const id of e.cups || []) cupWindow[id] = { eventName: e.name, start: e.start, end: e.end };
}
for (const [id, c] of Object.entries(PVP_RANKINGS.cups || {})) {
  cups[id] = {
    id,
    name: c.name,
    cpCap: c.cpCap,
    window: cupWindow[id] || null,
    species: speciesRows(c.species || []),
  };
}

const content = {
  // Copied verbatim, never regenerated: check-meta-reference asserts these match
  // so a snapshot sync that skips regeneration fails CI instead of silently
  // refreezing the reference.
  fetchedAt: PVP_RANKINGS.fetchedAt,
  topN: PVP_RANKINGS.topN,
  source: PVP_RANKINGS.source || "unknown",
  sourceUrls: {
    snapshot: `${RAW_BASE}/src/data/pvp-rankings.json`,
    upstream: "https://github.com/pvpoke/pvpoke (MIT)",
  },
  gameMasterWatch: watchInfo(),
  leagues,
  cups,
};

// Same preserve-when-unchanged rule the fetchers apply to `fetchedAt`, and for
// the same reason. pvp-meta.json is in the sync workflow's `git diff --quiet`
// path list, so a timestamp that moves on every run makes that guard permanently
// false: the fetcher would correctly report "content unchanged", and the job
// would still push a "sync ranking snapshot" commit containing nothing but this
// line — every day, burying real meta movements in the log.
function previousGeneratedAt() {
  if (!existsSync(JSON_OUT)) return null;
  try {
    const { generatedAt, ...prevContent } = JSON.parse(readFileSync(JSON_OUT, "utf8"));
    return canonicalStringify(prevContent) === canonicalStringify(content) ? generatedAt : null;
  } catch { return null; }
}

const carried = previousGeneratedAt();
if (carried) console.log("  ↺ reference unchanged — preserving previous generatedAt");
const payload = { generatedAt: carried || new Date().toISOString(), ...content };

if (!existsSync(REF_DIR)) mkdirSync(REF_DIR, { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");

// -------------------------------------------------------------------- META.md

const md = [];

md.push("# Pokémon GO PvP Meta Reference — GENERATED, DO NOT HAND-EDIT");
md.push("");
// Absolute date only. An "N days ago at generation time" figure was wrong for
// every reader after the moment it was written, and — being clock-derived — it
// rewrote this whole file on any day the snapshot had not moved, which is a
// second churn source on top of `generatedAt`. The 14-day rule below tells the
// reader to compare this date against today.
md.push(`- **Snapshot taken:** ${PVP_RANKINGS.fetchedAt}`);
md.push(`- **Source:** ${payload.source} — ${payload.sourceUrls.upstream}`);
md.push(`- **Snapshot URL:** ${payload.sourceUrls.snapshot}`);
md.push(`- **Depth:** top ${payload.topN} per league, deduped by base dex`);
md.push(`- **Machine-readable twin:** \`references/pvp-meta.json\` — prefer it over this file when you need exact values.`);
md.push("");
md.push("> This file is generated by `scripts/generate-pvp-meta-reference.mjs` in the");
md.push("> [pogo-filter-workshop](https://github.com/JesperDramsch/pogo-filter-workshop) repo,");
md.push("> from the same snapshot the app builds its filters from. Do not hand-edit it: the next");
md.push("> sync overwrites it, and a hand-edit is exactly the drift it exists to prevent.");
md.push(">");
md.push("> **If the snapshot date above is more than 14 days old, run `python3 scripts/refresh-meta.py`");
md.push("> before quoting anything below.** If it is stale and cannot be refreshed, say so — do not");
md.push("> fall back on remembered tier lists.");
md.push("");

const w = payload.gameMasterWatch;
if (w) {
  md.push("## Move rebalance watch");
  md.push("");
  if (w.lastChangeAt) {
    md.push(`Last observed Trainer-Battle stat change: **${w.lastChangeAt.slice(0, 10)}** — ${w.lastChangeSummary} (${w.movesChanged.slice(0, 12).join(", ")}).`);
    md.push("");
    md.push("Rankings lag a rebalance by days, so treat the tables below with caution if that date is recent.");
  } else {
    md.push(`No move stat change observed since the watch began (last checked ${String(w.checkedAt).slice(0, 10)}).`);
  }
  md.push("");
}

// "Ranked form" is only worth printing when the form that actually ranks is NOT
// the plain base species — Shadow Quagsire, Galarian Corsola. Comparing the
// speciesId against the base name (both stripped to alphanumerics, so `ho_oh`
// matches "Ho-Oh") is what separates those from the majority where the base
// form is the ranked one. Counting forms[] would get Galarian Corsola wrong: it
// is the only ranked form of dex 222, but it is not the base.
const alnum = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
function rankedFormLabel(r) {
  if (!r.speciesId) return "—";
  return alnum(r.speciesId) === alnum(r.name) ? "—" : `\`${r.speciesId}\``;
}

function speciesTable(rows) {
  const out = ["| # | German | English | Dex | Ranked form | Score |", "|---:|---|---|---:|---|---:|"];
  for (const r of rows) {
    out.push(`| ${r.rank} | ${r.names.de} | ${r.names.en} | ${r.dex} | ${rankedFormLabel(r)} | ${r.score ?? "—"} |`);
  }
  return out;
}

function section(title, capLabel, data) {
  md.push(`## ${title}`);
  md.push("");
  md.push(`CP cap: ${capLabel}`);
  md.push("");
  md.push(...speciesTable(data.species));
  md.push("");
  md.push("Dex numbers:");
  md.push("");
  md.push("```");
  md.push(data.species.map(s => s.dex).join(","));
  md.push("```");
  md.push("");
  if (data.filters) {
    md.push("Ready-made filter — copy verbatim, this is the app's own output:");
    md.push("");
    for (const loc of LOCALES) {
      if (!data.filters[loc]) continue;
      md.push(`\`\`\`text title="${loc}"`);
      md.push(data.filters[loc]);
      md.push("```");
      md.push("");
    }
  }
}

// Driven by the snapshot, like the JSON half above — not a hardcoded three.
// A league key the snapshot grows produces a real filter string in pvp-meta.json
// via buildFilters, so a fixed list here would drop it from the human-readable
// half only, and M4's "filter strings actually present in META.md" check would
// then fail CI on a purely upstream data change nobody in this repo made.
for (const key of Object.keys(leagues)) {
  const l = leagues[key];
  const cap = l.cpCap ? `${l.cpCap} CP` : "none — Master is uncapped, so a low-attack PvP spread is *worse* here than a hundo. No rank-1 IV clause is emitted.";
  section(LEAGUE_TITLE[key] ?? key, cap, l);
}

md.push("## Cups");
md.push("");
const cupList = Object.values(cups);
if (cupList.length === 0) {
  md.push("No themed cup is published in the current snapshot. This is normal — most GBL weeks are");
  md.push("plain Great/Ultra/Master. It does not mean the data is broken.");
  md.push("");
} else {
  for (const c of cupList) {
    const when = c.window
      ? `${c.window.start.slice(0, 10)} → ${c.window.end.slice(0, 10)} (${c.window.eventName})`
      : "no active window in the current event feed";
    md.push(`### ${c.name} \`${c.id}\``);
    md.push("");
    md.push(`Window: ${when}`);
    md.push("");
    md.push(`CP cap: ${c.cpCap ? `${c.cpCap} CP` : "none (uncapped)"}`);
    md.push("");
    md.push(...speciesTable(c.species));
    md.push("");
    md.push("```");
    md.push(c.species.map(s => s.dex).join(","));
    md.push("```");
    md.push("");
  }
}

md.push("## What this file deliberately does not cover");
md.push("");
md.push("Named explicitly, because a gap you cannot see is a gap you fill from memory:");
md.push("");
md.push("- **Raid attackers, Dynamax/Gigantamax tiers, regionals, never-transfer lists** — moved to");
md.push("  `META-PVE.md`. That file is hand-maintained and unverified; treat every number in it as a");
md.push("  hypothesis. Raid counters and regionals are *generated in the app itself* from");
md.push("  `src/data/raid-bosses.json` and `src/data/regional-forms.json`, which are the real sources.");
md.push("- **Per-species rank-1 IV spreads.** The filters above use one loose rank-1 shape");
md.push("  (atk 0-1, def 3-4, HP 3-4) for the whole pool. For an exact per-species spread, use a PvP");
md.push("  IV checker — this snapshot does not carry one.");
md.push("- **XL-candy requirements and legacy/Elite-TM move gating.** Real collection criteria, not");
md.push("  yet automated. See `docs/gbl-collection-research.md` in the repo.");
md.push("- **Tournament (Play! Pokémon) legality.** Not machine-readable; mythicals and box legendaries");
md.push("  are banned there but legal in casual GBL, so the two lists differ.");
md.push("");

writeFileSync(MD_OUT, md.join("\n") + "\n", "utf8");
console.log(`✓ wrote ${JSON_OUT}`);
console.log(`✓ wrote ${MD_OUT}`);
console.log(`  ${Object.keys(leagues).length} leagues, ${cupList.length} cups, snapshot ${PVP_RANKINGS.fetchedAt}`);
