// Locale registry. Bundles are static-imported so Vite tree-shakes nothing
// dynamically and the build is fully offline-deterministic.

import en from "../locales/en.json";
import de from "../locales/de.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import zhTW from "../locales/zh-TW.json";
import hi from "../locales/hi.json";
import ja from "../locales/ja.json";

export const LOCALES = {
  en: { messages: en, label: "English" },
  de: { messages: de, label: "Deutsch" },
  es: { messages: es, label: "Español" },
  fr: { messages: fr, label: "Français" },
  "zh-TW": { messages: zhTW, label: "繁體中文" },
  hi: { messages: hi, label: "हिन्दी" },
  ja: { messages: ja, label: "日本語" },
};

export const SUPPORTED_LOCALES = Object.keys(LOCALES);
export const DEFAULT_LOCALE = "de";

// Map a navigator.language tag (e.g. "de-DE", "fr-CA", "zh-Hant-TW") to one of
// our supported locales. Falls back to DEFAULT_LOCALE.
export function detectLocale(navLang) {
  if (!navLang || typeof navLang !== "string") return DEFAULT_LOCALE;
  const lower = navLang.toLowerCase();

  // Chinese: only zh-TW supported (Traditional). Map Hant/TW/HK/MO to zh-TW;
  // Simplified Chinese has no spreadsheet column so fall back to default
  // rather than ship the wrong script.
  if (lower.startsWith("zh")) {
    if (
      lower.includes("hant") ||
      lower.includes("tw") ||
      lower.includes("hk") ||
      lower.includes("mo")
    ) {
      return "zh-TW";
    }
    return DEFAULT_LOCALE;
  }

  // Exact match (e.g. "zh-TW")
  for (const code of SUPPORTED_LOCALES) {
    if (lower === code.toLowerCase()) return code;
  }

  // Primary subtag match (e.g. "de-DE" → "de", "fr-CA" → "fr")
  const primary = lower.split("-")[0];
  if (LOCALES[primary]) return primary;

  return DEFAULT_LOCALE;
}

export const STORAGE_KEY_LOCALE = "pogo_filter_locale";
export const STORAGE_KEY_OUTPUT_LOCALE = "pogo_filter_output_locale";
