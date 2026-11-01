// Check: the protection toggles sit in the nine groups the swipe deck uses,
// and everything the settings page renders from that list exists.
// Run with: npm run test:settingsgroups  (or npx vite-node directly).
//
// SETTINGS_GROUPS (src/App.jsx) is the one list behind the Catching settings
// page, the deck's group ids (src/SwipeOnboarding.jsx) and this check, so a
// toggle cannot be added ungrouped, a card cannot sit under a different
// heading than its toggle, and a label cannot be left untranslated.
//
//   G1 — every group has rows, no row repeats, every row is a boolean in DEFAULT_CONFIG
//   G2 — the deck's cards carry the group id their toggle sits under
//   G3 — every group heading, row label and row why resolves in all seven locales, translated
//   G4 — expertSettingsDiffering names only expert-only rows that left their default
//   G5 — presets are gone: no PRESETS, no app.preset.* key, lastAppliedPreset dropped on import
//   G6 — the page renders from SETTINGS_GROUPS and the deck's fine-tuning cards wait for expert mode

import { readFileSync } from "node:fs";
import { createChecker } from "./lib/check.mjs";
import {
  SETTINGS_GROUPS,
  PROTECTION_ROWS,
  DEFAULT_CONFIG,
  expertSettingsDiffering,
  mergeImportedConfig,
} from "../src/App.jsx";

const { check, done } = createChecker();
const LOCALES = ["en", "de", "es", "fr", "zh-TW", "hi", "ja"];
const bundles = Object.fromEntries(
  LOCALES.map((loc) => [loc, JSON.parse(readFileSync(new URL(`../src/locales/app/${loc}.json`, import.meta.url), "utf8"))]),
);
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const deck = readFileSync(new URL("../src/SwipeOnboarding.jsx", import.meta.url), "utf8");
const summarise = (list) => (list.length > 6 ? `${list.slice(0, 6).join(", ")} … (+${list.length - 6})` : list.join(", "));

console.log("G1 — groups and rows");
{
  check("nine groups", SETTINGS_GROUPS.length === 9, SETTINGS_GROUPS.map((g) => g.id).join(", "));
  check("no group is empty", SETTINGS_GROUPS.every((g) => g.rows.length > 0));
  const keys = PROTECTION_ROWS.map(([k]) => k);
  check(`${keys.length} rows, none repeated`, new Set(keys).size === keys.length);
  const notBool = keys.filter((k) => typeof DEFAULT_CONFIG[k] !== "boolean");
  check("every row is a boolean in DEFAULT_CONFIG", notBool.length === 0, notBool.join(", "));
  const shapes = PROTECTION_ROWS.filter(([k, base, extra]) => typeof k !== "string" || !/^app\.protect\.[a-z_]+$/.test(base)
    || (extra !== undefined && Object.keys(extra).some((f) => !["expertOnly", "requireConfirmOff"].includes(f))));
  check("every row is [key, app.protect.<base>, { expertOnly?, requireConfirmOff? }]", shapes.length === 0, shapes.map((r) => r[0]).join(", "));
  // The toggles that hide a Sorting pile on their off edge all have a row.
  const { PROTECTION_PILES } = await import("../src/App.jsx");
  const unrowed = Object.keys(PROTECTION_PILES).filter((k) => !keys.includes(k));
  check("every protection that hides a pile has a row", unrowed.length === 0, unrowed.join(", "));
}

console.log("\nG2 — the deck's cards sit under the same headings");
{
  const groupOf = Object.fromEntries(SETTINGS_GROUPS.flatMap((g) => g.rows.map(([k]) => [k, g.id])));
  const cards = Object.fromEntries([...deck.matchAll(/^\s+(\w+):\s+\{ key: "(\w+)"/gm)].map((m) => [m[1], m[2]]));
  check(`${Object.keys(cards).length} cards parsed from the deck`, Object.keys(cards).length >= 20);
  const unknown = Object.values(cards).filter((k) => !groupOf[k]);
  check("every card is a settings row", unknown.length === 0, unknown.join(", "));
  const deckGroups = [...deck.matchAll(/\{ id: "(\w+)",\s+cards: \[([^\]]*)\] \}/g)];
  check(`${deckGroups.length} deck groups parsed`, deckGroups.length >= 9);
  const mismatched = [];
  for (const [, id, list] of deckGroups) {
    for (const [, cardId] of list.matchAll(/CARDS\.(\w+)/g)) {
      const key = cards[cardId];
      if (groupOf[key] !== id) mismatched.push(`${cardId} (${key}): deck ${id}, settings ${groupOf[key]}`);
    }
  }
  check("every card's group id is its toggle's settings group", mismatched.length === 0, summarise(mismatched));
  const deckIds = new Set(deckGroups.map((m) => m[1]));
  const absent = SETTINGS_GROUPS.map((g) => g.id).filter((id) => !deckIds.has(id));
  check("every settings group is a deck group", absent.length === 0, absent.join(", "));
  // The essentials deck asks every user, so each of its cards is a row normal
  // mode shows; only the fine-tuning deck (expert mode) may carry expert rows.
  const expertOnly = new Set(PROTECTION_ROWS.filter(([, , extra]) => extra?.expertOnly).map(([k]) => k));
  const core = deck.slice(deck.indexOf("const CORE_GROUPS"), deck.indexOf("const ADVANCED_GROUPS"));
  const coreCards = [...core.matchAll(/CARDS\.(\w+)/g)].map((m) => m[1]);
  const hidden = coreCards.filter((id) => expertOnly.has(cards[id]));
  check(`${coreCards.length} essentials cards, none expert-only on the settings page`, coreCards.length >= 10 && hidden.length === 0, hidden.join(", "));
}

console.log("\nG3 — headings, labels and whys in every locale");
{
  const en = bundles.en;
  for (const loc of LOCALES) {
    const b = bundles[loc];
    const missing = [];
    for (const g of SETTINGS_GROUPS) {
      const k = `app.onboarding.swipe.group.${g.id}`;
      if (!b[k]) missing.push(k);
      else if (loc !== "en" && b[k] === en[k]) missing.push(`${k} (== en)`);
    }
    for (const [, base] of PROTECTION_ROWS) {
      for (const suffix of ["label", "why"]) if (!b[`${base}.${suffix}`]) missing.push(`${base}.${suffix}`);
    }
    for (const k of ["app.protect.section_title", "app.protect.expert_badge", "app.protect.confirm_off",
      "app.protect.cards.label", "app.protect.cards.help", "app.protect.cards.button",
      "app.protect.expert_diff.note", "app.protect.expert_diff.reset", "app.protect.expert_diff.done",
      "app.changelog.entry.settings_groups.title", "app.changelog.entry.settings_groups.body"]) {
      if (!b[k]) missing.push(k);
      else if (loc !== "en" && b[k] === en[k] && !/^app\.protect\.(expert_badge|cards\.label)$/.test(k)) missing.push(`${k} (== en)`);
    }
    if (!b["app.protect.expert_diff.note"]?.includes("{count}")) missing.push("expert_diff.note {count}");
    check(`${loc}: every heading, label, why and page string present${loc === "en" ? "" : " and translated"}`, missing.length === 0, summarise(missing));
  }
}

console.log("\nG4 — expertSettingsDiffering");
{
  const expertKeys = PROTECTION_ROWS.filter(([, , extra]) => extra?.expertOnly).map(([k]) => k);
  const plainKeys = PROTECTION_ROWS.filter(([, , extra]) => !extra?.expertOnly).map(([k]) => k);
  check(`${expertKeys.length} expert-only rows, ${plainKeys.length} plain rows`, expertKeys.length > 0 && plainKeys.length > 0);
  check("defaults differ in nothing", expertSettingsDiffering(mergeImportedConfig(DEFAULT_CONFIG)).length === 0);
  check("a null config differs in nothing", expertSettingsDiffering(null).length === 0);
  const flipped = Object.fromEntries(expertKeys.map((k) => [k, !DEFAULT_CONFIG[k]]));
  const all = expertSettingsDiffering({ ...DEFAULT_CONFIG, ...flipped });
  check("every expert-only row flipped is named, in row order", all.join(",") === expertKeys.join(","));
  const plainFlipped = Object.fromEntries(plainKeys.map((k) => [k, !DEFAULT_CONFIG[k]]));
  check("a plain row flipped is not named", expertSettingsDiffering({ ...DEFAULT_CONFIG, ...plainFlipped }).length === 0);
  check("one expert row flipped names just that row", expertSettingsDiffering({ ...DEFAULT_CONFIG, [expertKeys[0]]: !DEFAULT_CONFIG[expertKeys[0]] }).join(",") === expertKeys[0]);
  // The reset writes DEFAULT_CONFIG values back; those are the rows' defaults, not a hand copy.
  const reset = { ...DEFAULT_CONFIG, ...flipped, ...Object.fromEntries(all.map((k) => [k, DEFAULT_CONFIG[k]])) };
  check("writing the defaults back clears the list", expertSettingsDiffering(reset).length === 0);
}

console.log("\nG5 — presets are gone");
{
  check("App.jsx has no PRESETS or applyPreset", !/\bPRESETS\b|applyPreset/.test(app));
  check("lastAppliedPreset survives only as the import drop", (app.match(/lastAppliedPreset/g) || []).length === 1 && /delete merged\.lastAppliedPreset/.test(app));
  check("an imported config loses it", !("lastAppliedPreset" in mergeImportedConfig({ lastAppliedPreset: "casual" })));
  const stale = LOCALES.filter((loc) => Object.keys(bundles[loc]).some((k) => k.startsWith("app.preset.")));
  check("no locale carries an app.preset.* key", stale.length === 0, stale.join(", "));
}

console.log("\nG6 — the page and the deck");
{
  const panel = app.slice(app.indexOf("function ConfigPanel("), app.indexOf("function ToggleRow("));
  check("ConfigPanel renders the toggles from SETTINGS_GROUPS", /SETTINGS_GROUPS\.map\(\(group\) =>/.test(panel) && !/const settings = \[/.test(panel));
  check("the group heading is the deck's", /t\(`app\.onboarding\.swipe\.group\.\$\{group\.id\}`\)/.test(panel));
  check("expert-only rows are hidden in normal mode, not dropped from the config", /group\.rows\.filter\(\(\[, , extra\]\) => expert \|\| !extra\?\.expertOnly\)/.test(panel));
  check("normal mode shows the expert-differ note with a reset", /!expert && differing\.length > 0/.test(panel) && /onClick=\{resetExpertSettings\}/.test(panel));
  check("the reset is a two-click confirm that announces", /function resetExpertSettings\(\) \{\s*if \(!resetArmed\) \{\s*setResetArmed\(true\);\s*announce\(/.test(panel));
  check("the reset writes the rows' defaults through the panel's setter", /setConfig\(\{ \.\.\.config, \.\.\.Object\.fromEntries\(differing\.map\(\(k\) => \[k, DEFAULT_CONFIG\[k\]\]\)\) \}\)/.test(panel));
  check("the confirm says what happened and lands focus on the section title",
    /announce\(t\('app\.protect\.expert_diff\.done'\)\)/.test(panel) && /getElementById\(protectionsTitleId\)\?\.focus\(\)/.test(panel) && /<SettingsTitle id=\{protectionsTitleId\} tabIndex=\{-1\}>/.test(panel));
  check("each group is a fieldset whose legend is the deck's heading", /<fieldset key=\{group\.id\}/.test(panel) && /function SettingsCaption[\s\S]{0,200}<legend /.test(app));
  check("the deck lands focus on its heading when it mounts", /<h1 ref=\{titleRef\} tabIndex=\{-1\}/.test(deck) && /titleRef\.current\?\.focus\(\)/.test(deck));
  check("the cards block replaces the presets and needs a way to run them", /show\('cards'\) && onRunCards &&/.test(panel) && !/show\('presets'\)/.test(panel));
  const main = app.slice(app.indexOf("export default function App("), app.indexOf("function ConfigPanel("));
  check("the Catching settings offer the cards", /onRunCards=\{\(\) => navigateView\('onboard'\)\}/.test(main) && /sections=\{\['locals', 'cards', 'protections'/.test(main));
  check("the deck is told the mode", /<SwipeOnboarding[\s\S]{0,200}expert=\{!!config\.expertMode\}/.test(main));
  check("the deck offers its fine-tuning cards only in expert mode",
    /expert = false \}\) \{/.test(deck) && /setPhase\(phase === "core" && expert \? "offer" : "done"\)/.test(deck));
}

done("All settings-group checks passed.", (n) => `${n} settings-group check(s) failed.`);
