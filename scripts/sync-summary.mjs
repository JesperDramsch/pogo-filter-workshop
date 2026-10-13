#!/usr/bin/env node
// The sync job's data-commit message, built from one table of what the job
// tracks.
//
// classify compares each tracked file between a base commit (HEAD, before the
// commit) and the working tree, and labels each part: no change, provenance
// only (nothing but an upstream batch stamp moved, see
// scripts/lib/stamp-only.mjs) or changed. The subject names only the parts
// whose content changed, so the git log, which is the provenance trail
// CLAUDE.md points at, stops saying "meta" moved on days when only PvPoke's
// roster stamp did.
//
//   npx vite-node scripts/sync-summary.mjs classify --base HEAD --out <dir>

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalStringify } from "./lib/json.mjs";
import { classifyChange, namedStamps } from "./lib/stamp-only.mjs";

const REF = "skills/pokemon-go-filters/references";

// One row per fetch step, in workflow order. `id` is the step id, the
// workflow_dispatch input and the name of the step's log; `scope` and `what`
// make the commit line "- <scope>: <what>", as they did when this table was a
// list of track() calls in the workflow.
export const PARTS = [
  { id: "raids", scope: "raids", label: "Raids",
    what: () => "boss snapshot from lily-dex-api", paths: ["src/data/raid-bosses.json"] },
  { id: "rocket-lineups", scope: "rocket", label: "Rocket lineups",
    what: () => "lineup snapshot", paths: ["src/data/rocket-lineups.json"] },
  { id: "rocket-quotes", scope: "rocket", label: "Rocket quotes",
    what: () => "grunt quotes from holoholo-text", paths: ["src/data/rocket-grunt-quotes.json"] },
  // Name the upstream the PvP snapshot actually came from. The fetcher falls
  // back to lily-dex whenever PvPoke is unreachable, and that snapshot is
  // materially different (no speciesId, score or forms, so the reference's
  // "Ranked form" and "Score" columns collapse to "—"). The git log is the
  // provenance trail CLAUDE.md points at.
  { id: "pvp", scope: "pvp", label: "PvP rankings",
    what: (doc) => `ranking snapshot from ${doc?.source ?? "an unknown source"}`, paths: ["src/data/pvp-rankings.json"] },
  { id: "meta", scope: "meta", label: "Raid attackers (meta)",
    what: () => "raid-attacker + shadow-keeper rankings from the game master", paths: ["src/data/meta-rankings.json"] },
  { id: "species-meta", scope: "species-meta", label: "Species meta",
    what: () => "special-trade/starter/power-line/mega pools", paths: ["src/data/species-meta.json"] },
  { id: "events", scope: "events", label: "Events",
    what: () => "wildspawn snapshot from leak-duck", paths: ["src/data/events.json"] },
  { id: "regional-forms", scope: "forms", label: "Regional forms",
    what: () => "regional-form catalog from the game master", paths: ["src/data/regional-forms.json"] },
  // The watch's history IS the rebalance notification, so its commit line names
  // each new entry and its stream rather than a generic "move stats".
  { id: "game-master-watch", scope: "game-master", label: "Game-master watch",
    what: () => "move stats", paths: ["src/data/game-master-watch.json"],
    commitLines: (r) => {
      const fresh = newHistory(r.before, r.after);
      return fresh.length ? fresh.map((h) => `${h.stream ?? "pvp"} ${h.summary}`) : null;
    } },
];

// Not a fetch step: regenerated from pvp and game-master-watch every run.
export const REFERENCE = {
  id: "reference", scope: "reference", label: "Skill reference",
  what: () => "regenerated PvP meta reference", paths: [`${REF}/pvp-meta.json`, `${REF}/META.md`],
};

const RANK = { none: 0, provenance: 1, content: 2 };
const parseOrNull = (text) => { try { return text == null ? null : JSON.parse(text); } catch { return null; } };

// read = { base(path), head(path) }, each returning the file's text or null.
export function classifyAll(read) {
  return [...PARTS, REFERENCE].map((part) => {
    const files = part.paths.map((path) => {
      const before = read.base(path), after = read.head(path);
      return { path, before, after, ...classifyChange(before, after) };
    });
    const kind = files.reduce((k, f) => (RANK[f.kind] > RANK[k] ? f.kind : k), "none");
    return {
      part,
      kind,
      stamps: files.flatMap((f) => f.stamps),
      changedPaths: files.filter((f) => f.kind !== "none").map((f) => f.path),
      before: parseOrNull(files[0].before),
      after: parseOrNull(files[0].after),
    };
  });
}

// History entries in `after` that `before` does not have, newest first. Keyed by
// the whole entry: on 2026-09-09 a pvp and a pve entry shared one timestamp.
export function newHistory(before, after) {
  const seen = new Set((before?.history ?? []).map(canonicalStringify));
  return (after?.history ?? []).filter((h) => !seen.has(canonicalStringify(h)));
}

const stampKeys = (stamps) => [...new Set(namedStamps(stamps).map((s) => s.key))];

// The data commit. Every file that moved is committed, provenance-only ones
// too (check-meta-rankings needs the roster stamp to keep advancing), but only
// parts whose content changed reach the subject.
export function commitMessage(results) {
  const scopes = [], body = [], paths = [];
  for (const r of results) {
    if (r.kind === "none") continue;
    paths.push(...r.changedPaths);
    if (r.kind === "provenance") {
      body.push(`- ${r.part.scope}: provenance only (${stampKeys(r.stamps).join(", ")})`);
      continue;
    }
    if (!scopes.includes(r.part.scope)) scopes.push(r.part.scope);
    for (const line of r.part.commitLines?.(r) ?? [r.part.what(r.after)]) body.push(`- ${r.part.scope}: ${line}`);
  }
  if (!paths.length) return null;
  const subject = scopes.length ? `chore(data): sync ${scopes.join(", ")}` : "chore(data): refresh provenance stamps";
  return { subject, body, paths, text: `${subject}\n\n${body.join("\n")}\n` };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

// --name value pairs; nothing here takes a bare flag.
function args(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument "${argv[i]}"`);
    opts[argv[i].slice(2)] = argv[i + 1];
  }
  return opts;
}

// git show <base>:<path>, or null when the path does not exist at that commit.
export function gitReader(root, base) {
  return {
    base(path) {
      try {
        return execFileSync("git", ["show", `${base}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 256e6, stdio: ["ignore", "pipe", "ignore"] });
      } catch { return null; }
    },
    head(path) {
      const p = join(root, path);
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    },
  };
}

// Writes <out>/commit-message.txt and <out>/commit-paths.txt (one path per
// line), both empty when nothing moved, and returns the message text.
export function classifyCli(argv) {
  const opts = args(argv);
  if (!opts.out) throw new Error("classify needs --out <dir>");
  const root = resolve(opts.root ?? process.cwd());
  const msg = commitMessage(classifyAll(gitReader(root, opts.base ?? "HEAD")));
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "commit-paths.txt"), msg ? `${msg.paths.join("\n")}\n` : "");
  writeFileSync(join(opts.out, "commit-message.txt"), msg ? msg.text : "");
  return msg ? msg.text : "No snapshot changes.\n";
}

// vite-node hands a script its arguments but not its own path, so the usual
// `argv[1] === this file` guard cannot tell "run" from "imported". The mode
// decides instead: the workflow always names one, and
// scripts/check-sync-summary.mjs imports this with no arguments at all.
const CLI = { classify: classifyCli };
const mode = process.argv[2];
if (CLI[mode]) {
  try {
    process.stdout.write(CLI[mode](process.argv.slice(3)));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
