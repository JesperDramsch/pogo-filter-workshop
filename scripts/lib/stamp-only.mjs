// Tells a snapshot whose content changed from one where only a provenance
// stamp moved.
//
// Three fetchers (meta-rankings, species-meta, game-master-watch) compare
// everything except `fetchedAt`, so a new upstream batch rewrites the file even
// when nothing a filter reads has changed. Of the bot commits between
// 2026-08-29 and 2026-10-13 that was 27 of 30 for meta-rankings, 21 of 22 for
// species-meta and 20 of 25 for game-master-watch, and all 3 grunt-quotes
// commits (enKeys only). Each was named as a sync of that source, so the log
// said "meta" moved on days when only PvPoke's roster stamp had. The commit still has to
// happen (check-meta-rankings needs the roster stamp to keep advancing), but
// the subject and the job summary should say what actually moved.
//
// The stamps stay in the snapshots: they are how a reader tells which mirror
// answered and how old its batch was. This only decides how a change is
// labelled, so a field missing from the list costs an overstated "changed",
// never a dropped commit.

import { canonicalStringify } from "./json.mjs";

// The one list. Dotted paths from the snapshot root; a last segment that starts
// with `*` matches every key ending in the rest. `quiet` stamps move on every
// write, so they are named only when nothing else moved.
export const STAMP_FIELDS = [
  // Every snapshot: when the file was last written.
  { path: "fetchedAt", quiet: true },
  // The skill reference: when it was last regenerated.
  { path: "generatedAt", quiet: true },
  // meta-rankings: the epoch-ms twin of sources.mechanicsBatch.
  { path: "gameMasterTimestamp", quiet: true },
  // The upstream batch each snapshot was built from: mechanicsBatch and
  // rosterBatch (meta-rankings), gameMasterBatch (species-meta), pveBatch
  // (game-master-watch).
  { path: "sources.*Batch" },
  // Grunt quotes: the key count of the whole holoholo-text export, which grows
  // with every game release whether or not a quote changed.
  { path: "sources.enKeys" },
  // The skill reference: game-master-watch's fetchedAt, copied.
  { path: "gameMasterWatch.checkedAt" },
];

function keyMatches(pattern, key) {
  return pattern.startsWith("*") ? key.endsWith(pattern.slice(1)) : key === pattern;
}

// Every [dottedPath, value] in `doc` that the list names.
function stampEntries(doc) {
  const out = [];
  const walk = (node, segs, at) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const [head, ...rest] = segs;
    for (const key of Object.keys(node)) {
      if (!keyMatches(head, key)) continue;
      const path = at ? `${at}.${key}` : key;
      if (rest.length) walk(node[key], rest, path);
      else out.push([path, node[key]]);
    }
  };
  for (const f of STAMP_FIELDS) walk(doc, f.path.split("."), "");
  return out;
}

const isQuiet = (path) => STAMP_FIELDS.some((f) => f.quiet && f.path === path);

// A deep copy of `doc` without its stamp fields.
export function stripStamps(doc) {
  const copy = structuredClone(doc);
  for (const [path] of stampEntries(doc)) {
    const segs = path.split(".");
    const parent = segs.slice(0, -1).reduce((n, k) => n?.[k], copy);
    if (parent && typeof parent === "object") delete parent[segs.at(-1)];
  }
  return copy;
}

// The stamps whose value differs, quiet ones last:
// [{ path: "sources.rosterBatch", key: "rosterBatch", from, to, quiet }].
export function movedStamps(before, after) {
  const a = new Map(stampEntries(before ?? {}));
  const b = new Map(stampEntries(after ?? {}));
  const moved = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (canonicalStringify(a.get(path)) === canonicalStringify(b.get(path))) continue;
    moved.push({ path, key: path.split(".").at(-1), from: a.get(path), to: b.get(path), quiet: isQuiet(path) });
  }
  return moved.sort((x, y) => Number(x.quiet) - Number(y.quiet));
}

// The stamps worth naming: the loud ones, or the quiet ones when nothing else
// moved (a regenerated reference whose content is identical moves only
// generatedAt).
export function namedStamps(moved) {
  const loud = moved.filter((m) => !m.quiet);
  return loud.length ? loud : moved;
}

const parse = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

// Compares two versions of one file, each as text, or null when the file does
// not exist on that side. Returns { kind, stamps }:
//   "none"       byte-identical, or both missing
//   "provenance" JSON whose content is identical once the stamps are stripped
//   "content"    anything else, including a file new since the base or gone
//                from the working tree, and any non-JSON change (META.md)
export function classifyChange(beforeText, afterText) {
  if (beforeText === afterText) return { kind: "none", stamps: [] };
  if (beforeText == null || afterText == null) return { kind: "content", stamps: [] };
  const a = parse(beforeText), b = parse(afterText);
  if (a === undefined || b === undefined) return { kind: "content", stamps: [] };
  if (canonicalStringify(a) === canonicalStringify(b)) return { kind: "none", stamps: [] };
  const stamps = movedStamps(a, b);
  const same = canonicalStringify(stripStamps(a)) === canonicalStringify(stripStamps(b));
  return { kind: same ? "provenance" : "content", stamps };
}
