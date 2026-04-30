#!/usr/bin/env node
// Pulls Great / Ultra / Master league rankings from lily-dex-api,
// dedupes by base dex number, takes the top N, and writes a slim
// per-league artifact at src/data/pvp-rankings.json that App.jsx
// imports at build time.
//
// Why store dex + name pairs (not raw speciesIds): forms like
// `darmanitan_galarian_zen` need to fold into the base species so
// PoGo's family-search (`+darmanitan`) catches every form. dexNr is
// stable identity; speciesName is a locale fallback if our dex dict
// doesn't have a matching entry at render time.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "pvp-rankings.json");

const ENDPOINT = "https://mknepprath.github.io/lily-dex-api/rankings.json";
const TOP_N = 30;
const LEAGUES = {
  great:  { cpCap: 1500 },
  ultra:  { cpCap: 2500 },
  master: { cpCap: null },
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop pvp-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Dedupe by dex (forms collapse to base species — `+raichu` already
// catches both regular and Alolan via family search). Preserve rank
// order from the upstream feed.
function topNByDex(rankings, n) {
  if (!Array.isArray(rankings)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of rankings) {
    const dex = entry?.dexNr;
    if (typeof dex !== "number" || seen.has(dex)) continue;
    seen.add(dex);
    out.push({ dex, name: entry.speciesName || `dex_${dex}` });
    if (out.length >= n) break;
  }
  return out;
}

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

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let raw;
  try {
    console.log("→ Fetching lily-dex-api rankings");
    raw = await fetchJson(ENDPOINT);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  const leagues = {};
  let totalEntries = 0;
  for (const [key, meta] of Object.entries(LEAGUES)) {
    const list = topNByDex(raw[key], TOP_N);
    if (list.length === 0) continue;
    leagues[key] = { cpCap: meta.cpCap, species: list };
    totalEntries += list.length;
  }

  if (Object.keys(leagues).length === 0) {
    throw new Error("All leagues came back empty — refusing to overwrite cache");
  }

  const newContent = { topN: TOP_N, leagues };
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const prevContent = { topN: prev.topN, leagues: prev.leagues };
      if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  ${Object.keys(leagues).length} leagues, ${totalEntries} species total (top ${TOP_N} each, deduped by dex)`);
}

main().catch(e => { console.error(e); process.exit(1); });
