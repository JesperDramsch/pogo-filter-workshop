import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  LOCALES,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  detectLocale,
  STORAGE_KEY_LOCALE,
  STORAGE_KEY_OUTPUT_LOCALE,
} from "./index.js";

const I18nContext = createContext(null);

function readStoredLocale(key) {
  try {
    const v = localStorage.getItem(key);
    return v && LOCALES[v] ? v : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore — private mode, quota, etc.
  }
}

function initialUiLocale() {
  const stored = readStoredLocale(STORAGE_KEY_LOCALE);
  if (stored) return stored;
  if (typeof navigator !== "undefined") return detectLocale(navigator.language);
  return DEFAULT_LOCALE;
}

function initialOutputLocale(uiLocale) {
  return readStoredLocale(STORAGE_KEY_OUTPUT_LOCALE) || uiLocale;
}

// Walks fallback chain [locale, en] and returns the first defined message,
// applying {param} substitution if params are provided.
function lookup(messages, key, locale, params) {
  let str = messages[key];
  if (str === undefined && locale !== "en") {
    str = LOCALES.en.messages[key];
  }
  if (str === undefined) return undefined;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(initialUiLocale);
  const [outputLocale, setOutputLocaleState] = useState(() => initialOutputLocale(locale));

  useEffect(() => {
    writeStoredLocale(STORAGE_KEY_LOCALE, locale);
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  useEffect(() => {
    writeStoredLocale(STORAGE_KEY_OUTPUT_LOCALE, outputLocale);
  }, [outputLocale]);

  const setLocale = useCallback((next) => {
    if (!LOCALES[next]) return;
    setLocaleState(next);
  }, []);

  const setOutputLocale = useCallback((next) => {
    if (!LOCALES[next]) return;
    setOutputLocaleState(next);
  }, []);

  const t = useCallback(
    (key, opts) => {
      const messages = LOCALES[locale].messages;
      const result = lookup(messages, key, locale, opts?.params);
      if (result !== undefined) return result;
      if (opts && "fallback" in opts) return opts.fallback;
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] missing key: ${key} (locale: ${locale})`);
      }
      return key;
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      t,
      locale,
      setLocale,
      outputLocale,
      setOutputLocale,
      supportedLocales: SUPPORTED_LOCALES,
      locales: LOCALES,
    }),
    [t, locale, setLocale, outputLocale, setOutputLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used inside <I18nProvider>");
  }
  return ctx;
}
