// Niantic's own localized text export, and the seven locale paths this app
// reads out of it.
//
// sora10pls/holoholo-text mirrors the text bundles Pokémon GO itself ships, for
// all fifteen languages Niantic publishes, updated every one to three days —
// 30 commits in the two months before this was written. Two directories:
//
//   Release/ — the text in the latest shipped client. What players actually see.
//   Remote/  — the latest server-pushed text, which may contain unreleased
//              content: names for species not yet in the game, event copy for
//              events not yet announced.
//
// This repo reads Release/ everywhere. A filter string is typed into a live
// client's search box, so a name that only exists in Remote/ is a name the
// game will not match — the failure is silent and looks like the app is wrong.
// Anything that deliberately wants the unreleased set has to say so.
//
// REPLACING WHAT. Two upstreams collapse into this one:
//
//   PokeMiners/pogo_assets `Texts/Latest APK/JSON` — the previous source for
//   Rocket grunt quotes. That directory last changed 2025-08-24 and had zero
//   commits in the two months before this was written, while the repo itself
//   still commits daily (images only). It serves 36,406 keys against
//   holoholo's 42,243.
//
//   A community-maintained published Google Sheet — the previous source for
//   `ingame.*`, `move.*` and pokemon-names.json. Verified against the live
//   German export: 112 of its 115 `ingame.*` keys are present verbatim (the
//   three absent ones are this repo's own synthetic `hardcoded_*` keys), all
//   371 move names resolve, and 1153 of 1155 species-name keys resolve.
//
// SHAPE. `{"data": ["key1","val1","key2","val2", ...]}` — one flat alternating
// array, which is why every reader here goes through parseTextBundle rather
// than indexing the array directly.

// App locale → the export's own directory and file naming. The directory is the
// English language name and the file is `<code>_raw.json`; both are needed, and
// the language name contains a space for Traditional Chinese, so this is a
// table rather than a derivation. `Latin American Spanish`/`es-mx` also exists
// upstream — this app wants the European `es-es`.
export const HOLOHOLO_LOCALES = {
  en: { language: "English", code: "en-us" },
  de: { language: "German", code: "de-de" },
  es: { language: "Spanish", code: "es-es" },
  fr: { language: "French", code: "fr-fr" },
  "zh-TW": { language: "Traditional Chinese", code: "zh-tw" },
  hi: { language: "Hindi", code: "hi-in" },
  ja: { language: "Japanese", code: "ja-jp" },
};

const BASE = "https://raw.githubusercontent.com/sora10pls/holoholo-text/master/Release";

export function holoholoUrl(locale) {
  const entry = HOLOHOLO_LOCALES[locale];
  if (!entry) throw new Error(`no holoholo-text mapping for locale ${locale}`);
  return `${BASE}/${encodeURIComponent(entry.language)}/${entry.code}_raw.json`;
}

// The flat alternating array → a plain key/value map. An odd-length array means
// a key lost its value somewhere upstream, which would silently shift every
// subsequent pair by one; that is a failure, not a partial result.
export function parseTextBundle(json, label = "bundle") {
  if (!json || !Array.isArray(json.data)) {
    throw new Error(`Unexpected shape for ${label} — expected { data: [...] }`);
  }
  if (json.data.length % 2 !== 0) {
    throw new Error(`Odd-length data array in ${label} — expected key/value pairs`);
  }
  const map = {};
  for (let i = 0; i < json.data.length; i += 2) map[json.data[i]] = json.data[i + 1];
  return map;
}

// Values arrive with occasional trailing whitespace — three of the German keys
// this repo reads carry one, and two Spanish grunt quotes differ between their
// male and female variants by a trailing newline alone, which used to make the
// snapshot record an identical line as gendered. Trimming is safe: a leading or
// trailing space is meaningless in a search keyword, and pogoKeywords() in
// src/i18n/pogo-keywords.js already trims on the way out.
//
// UNICODE NORMALISATION IS DELIBERATELY NOT APPLIED. Niantic's Hindi is
// internally inconsistent about the nukta: `फ़` ships precomposed (U+095E) in
// six keys and decomposed (U+092B U+093C) in the rest, and because the
// precomposed forms are Unicode composition exclusions, NFC rewrites the first
// group into the second rather than the other way round. Either way it would
// mean emitting a string Niantic does not publish into a filter that gets typed
// into the game's own search box, on a guess about how that box indexes text.
// The rule here is byte-for-byte what the client ships, trimmed — a keyword
// that does not match is invisible to the user, so a guess is not affordable.
export function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : value;
}

// Some values are not display strings but unresolved cross-references the
// client substitutes at runtime: `move_name_0495` is literally
// "<<move_name_0246>>+", the Adventure-Effect upgrade of Dark Pulse. Emitting
// one verbatim would put "<<move_name_0246>>+" in a filter string; resolving it
// would invent a search term ("dark pulse+") that nobody here has typed into
// the game. Neither is this project's call to make, so they are skipped and
// counted. 26 move names carry one today; no species name or filter keyword does.
export const PLACEHOLDER = /<<[^>]+>>/;

export function isDisplayable(value) {
  return typeof value === "string" && value.length > 0 && !PLACEHOLDER.test(value);
}

export async function fetchLocaleBundle(locale, { userAgent } = {}) {
  const url = holoholoUrl(locale);
  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent || "pogo-filter-workshop holoholo-text-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const map = parseTextBundle(await res.json(), url);
  for (const k of Object.keys(map)) map[k] = normalizeValue(map[k]);
  return map;
}

// All seven at once. Locale order in the result follows HOLOHOLO_LOCALES, not
// completion order, so downstream key ordering is stable across runs.
export async function fetchAllLocaleBundles(locales = Object.keys(HOLOHOLO_LOCALES), opts = {}) {
  const entries = await Promise.all(
    locales.map(async (loc) => [loc, await fetchLocaleBundle(loc, opts)]),
  );
  return Object.fromEntries(locales.map((loc) => [loc, entries.find(([l]) => l === loc)[1]]));
}
