// Paste-a-quote → match-the-grunt widget. The user types whatever the
// Rocket grunt said before battle (in their outputLocale) and we pick the
// closest match across all 36 in-game quotes (18 typed × 1 + 3 generic +
// 10 decoy + 5 balloon). Typed matches surface the grunt's primary type so
// the parent can highlight the corresponding card; generic/decoy/balloon
// matches show a category info chip since those don't pin a lineup.
//
// Scoring: trigram-coverage (|inputTrigrams ∩ quoteTrigrams| / |input|).
// Coverage rewards "is the user's fragment contained in the quote," which
// fits the use case (player typed a fragment they remember). Plain Jaccard
// over-punishes short inputs. Min input length of 6 chars (post-normalize)
// prevents trivial substrings like "die" matching everything.

import React, { useMemo, useState } from "react";
import { C } from "./colors.js";

const MIN_INPUT_CHARS = 6;
const SCORE_THRESHOLD = 0.5;

function normalize(s) {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}]+/gu, " ") // strip punctuation/whitespace runs
    .trim()
    .replace(/\s+/g, " ");
}

function trigrams(s) {
  const out = new Set();
  if (s.length < 3) return out;
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
  return out;
}

function coverage(inputTri, quoteTri) {
  if (inputTri.size === 0) return 0;
  let hits = 0;
  for (const t of inputTri) if (quoteTri.has(t)) hits++;
  return hits / inputTri.size;
}

// Resolve a quote entry against the user's locale and a candidate gender.
// Same shape as the App.jsx helper — kept local so the widget stays
// self-contained. Tries both genders since the user doesn't tell us which
// they encountered. Returns an array (1 or 2 strings) per locale entry.
function resolveBoth(entry, locale) {
  if (!entry) return [];
  const localized = entry[locale] ?? entry.en;
  if (!localized) return [];
  if (typeof localized === "string") return [localized];
  return [localized.female, localized.male].filter(Boolean);
}

function buildCorpus(data, locale) {
  const corpus = [];
  for (const [type, entry] of Object.entries(data.typed || {})) {
    for (const text of resolveBoth(entry, locale)) {
      corpus.push({ category: "typed", type, text });
    }
  }
  (data.generic || []).forEach((entry, i) => {
    for (const text of resolveBoth(entry, locale)) {
      corpus.push({ category: "generic", index: i + 1, text });
    }
  });
  (data.decoy || []).forEach((entry, i) => {
    const text = entry[locale] ?? entry.en;
    if (text) corpus.push({ category: "decoy", index: i + 1, text });
  });
  (data.balloon || []).forEach((entry, i) => {
    for (const text of resolveBoth(entry, locale)) {
      corpus.push({ category: "balloon", index: i + 1, text });
    }
  });
  return corpus.map(q => ({ ...q, _tri: trigrams(normalize(q.text)) }));
}

export default function RocketQuoteLookup({
  data, outputLocale, t,
  onTypedMatch, // callback (type | null) — used by parent to highlight a card
  localizedTypeDisplay, // (typeKey) → "Eis" / "Ice"
}) {
  const [input, setInput] = useState("");
  const corpus = useMemo(() => buildCorpus(data, outputLocale), [data, outputLocale]);

  const result = useMemo(() => {
    const norm = normalize(input);
    if (norm.length < MIN_INPUT_CHARS) return null;
    const inputTri = trigrams(norm);
    let best = null;
    for (const q of corpus) {
      const score = coverage(inputTri, q._tri);
      if (!best || score > best.score) best = { ...q, score };
    }
    if (!best || best.score < SCORE_THRESHOLD) return { kind: "none" };
    return { kind: "match", ...best };
  }, [input, corpus]);

  // Inform parent of typed-grunt match so it can outline the corresponding
  // card. Effect-style via render-callback pattern: the parent stores the
  // match in its own state on each onTypedMatch call.
  React.useEffect(() => {
    if (!onTypedMatch) return;
    if (result?.kind === "match" && result.category === "typed") onTypedMatch(result.type);
    else onTypedMatch(null);
  }, [result, onTypedMatch]);

  const matchLabel = (() => {
    if (!result || result.kind !== "match") return null;
    if (result.category === "typed") {
      const typeName = localizedTypeDisplay ? localizedTypeDisplay(result.type) : result.type;
      return t("app.filter.rocket_quote_match_typed", { params: { type: typeName } });
    }
    const key = `app.filter.rocket_quote_match_${result.category}`;
    return t(key, { params: { n: result.index } });
  })();

  return (
    <div className="rounded border border-[#1F2933] bg-[#0E141A] p-3 space-y-2">
      <div className="mono text-[11px] uppercase tracking-wider" style={{ color: C.dim }}>
        {t("app.filter.rocket_quote_lookup_title")}
      </div>
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t("app.filter.rocket_quote_lookup_label")}
        className="w-full mono text-xs bg-[#0A0F14] border border-[#1F2933] rounded px-2 py-1.5 text-[#E6EDF3] placeholder:text-[#5A6772] focus:outline-none focus:border-[#5EAFC5]"
      />
      <div className="mono text-[10.5px]" style={{ color: C.dim }}>
        {t("app.filter.rocket_quote_lookup_hint")}
      </div>
      {result?.kind === "none" && (
        <div className="mono text-[11px] text-[#E67E22]">
          {t("app.filter.rocket_quote_no_match")}
        </div>
      )}
      {result?.kind === "match" && (
        <div className="mono text-[11px] flex items-baseline gap-2">
          <span className="text-[#5EAFC5] font-medium">{matchLabel}</span>
          <span className="italic text-[#8090A0] truncate">&ldquo;{result.text}&rdquo;</span>
        </div>
      )}
    </div>
  );
}
