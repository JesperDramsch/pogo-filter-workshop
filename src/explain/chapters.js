import { Sparkles, MapPin, Users, ScrollText } from "lucide-react";

// Single source of truth for the explainer story chain. Order matters — drives
// the chapter tabs at the top of every explain page and the prev/next footer.
//
// To add a new chapter:
//   1. Drop a new file in src/explain/<Name>.jsx that default-exports a page
//      component receiving { onNavigate } props. Wrap content in <ChapterShell>.
//   2. Append an entry here with a unique `key`, the `hash` it lives under
//      (without leading #), an icon, and an i18n key for the tab label.
//   3. Register the component + view branch in src/App.jsx routing.
export const CHAPTERS = [
  {
    key: "general",
    hash: "explain/general",
    icon: Sparkles,
    titleKey: "app.explain.chapter.general",
  },
  {
    key: "regional",
    hash: "explain/regional",
    icon: MapPin,
    titleKey: "app.explain.chapter.regional",
  },
  {
    key: "trade",
    hash: "explain/trade",
    icon: Users,
    titleKey: "app.explain.chapter.trade",
  },
  {
    key: "rules",
    hash: "rules",
    icon: ScrollText,
    titleKey: "app.explain.chapter.rules",
  },
];

export function chapterIndex(key) {
  return CHAPTERS.findIndex((c) => c.key === key);
}

export function neighbours(key) {
  const i = chapterIndex(key);
  return {
    prev: i > 0 ? CHAPTERS[i - 1] : null,
    next: i >= 0 && i < CHAPTERS.length - 1 ? CHAPTERS[i + 1] : null,
  };
}
