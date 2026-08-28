// Shared JSON helpers for the scripts/fetch-*.mjs family.
//
// These three functions implement the fetcher convention CLAUDE.md describes:
// `canonicalStringify` compares content so `fetchedAt` is preserved when nothing
// changed, `writeJson` fixes the on-disk format, and `readPreviousJson` is what
// makes `--offline-ok` and the fetchedAt-preservation logic possible.
//
// They used to be copy-pasted, byte-identical, into ten separate fetchers. A
// load-bearing invariant maintained in ten places is one a fix silently misses
// in nine of them, so it lives here now.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Key-sorted stringify, used to answer "did the content actually change?"
// without a `fetchedAt` bump.
//
// Must agree with JSON.stringify on `undefined`, because that is what the write
// path uses: JSON.stringify DROPS an undefined-valued object key and coerces an
// undefined array element to null. A naive implementation emits the literal text
// `undefined` for the key instead, so a record built by direct field copy from a
// feed that omitted one field compares unequal to its own round-tripped self
// forever — bumping fetchedAt on every run and committing a one-line date change
// indefinitely, which is the exact churn this function exists to prevent.
export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v) ?? "null").join(",")}]`;
  }
  const keys = Object.keys(value).sort().filter((k) => value[k] !== undefined);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

export function writeJson(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Null when there is no cache, and null when the cache is unreadable — callers
// treat both as "first run".
export function readPreviousJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}
