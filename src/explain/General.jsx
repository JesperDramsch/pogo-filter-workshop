import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "../i18n/I18nProvider.jsx";
import { C } from "./colors.js";
import { ChapterShell, HeroPill } from "./Shell.jsx";

// ─── Story grid ──────────────────────────────────────────────────────────────
// 12 cols × 5 rows = 60 dots. Rows = IV tier (0★ top, 4★ bottom). Each dot has
// fixed attributes; `dotStateAt(dot, act)` picks the highest-priority "reason"
// it sits in the keeper set at each act.

const COLS = 12;
const ROWS = 5;
const TOTAL = COLS * ROWS;

const REASON_KEEP     = { color: C.cyan,   priority: 1 };
const REASON_VALUABLE = { color: C.green,  priority: 4 };
const REASON_TAGGED   = { color: C.purple, priority: 3 };
const REASON_PVP      = { color: C.amber,  priority: 5 };

const LEGEND = [
  { color: C.cyan,   key: "app.landing.story.legend.iv" },
  { color: C.green,  key: "app.landing.story.legend.valuable" },
  { color: C.purple, key: "app.landing.story.legend.tagged" },
  { color: C.amber,  key: "app.landing.story.legend.pvp" },
  { color: C.red,    key: "app.landing.story.legend.trash" },
];

const ix = (row, col) => row * COLS + col;

const ATTR_SHINY = new Set([
  ix(0, 2), ix(1, 8), ix(2, 5), ix(3, 11), ix(4, 4),
]);
const ATTR_LEGENDARY = new Set([
  ix(0, 9), ix(2, 1), ix(4, 7),
]);
const ATTR_FAVORITE = new Set([
  ix(0, 5), ix(1, 0), ix(2, 9), ix(3, 3), ix(3, 8), ix(4, 1), ix(4, 10),
]);
const ATTR_TAGGED = new Set([
  ix(1, 4), ix(2, 7), ix(3, 6),
]);
const ATTR_PVP = new Set([
  ix(1, 1), ix(1, 6), ix(2, 3), ix(2, 10), ix(2, 11),
]);
const ATTR_HUNDO_FAMILY = new Set([
  ix(3, 0), ix(3, 1), ix(3, 2), ix(3, 5), ix(3, 7), ix(3, 9), ix(3, 10),
  ix(4, 0), ix(4, 2), ix(4, 5), ix(4, 8),
]);
// 3★ Pokémon with two stats at 15 — kept even when a hundo of the family
// exists, since they're still PvP-relevant.
const ATTR_TWO_BAR_PERFECT = new Set([ix(3, 5), ix(3, 9)]);

const STORY_DOTS = Array.from({ length: TOTAL }, (_, i) => {
  const row = Math.floor(i / COLS);
  return {
    i,
    row,
    iv: row,
    isShiny: ATTR_SHINY.has(i),
    isLegendary: ATTR_LEGENDARY.has(i),
    isFavorite: ATTR_FAVORITE.has(i),
    isTagged: ATTR_TAGGED.has(i),
    isPvp: ATTR_PVP.has(i),
    hasHundoFamily: ATTR_HUNDO_FAMILY.has(i),
    isTwoBarPerfect: ATTR_TWO_BAR_PERFECT.has(i),
  };
});

function dotStateAt(dot, act) {
  if (act < 1) return { color: C.borderHi, kept: false, idle: true };
  const reasons = [];
  const trimmedByHundoLogic =
    act >= 5 && dot.iv === 3 && dot.hasHundoFamily && !dot.isTwoBarPerfect;
  if (act >= 1 && dot.iv >= 3 && !trimmedByHundoLogic) reasons.push(REASON_KEEP);
  if (act >= 2 && (dot.isShiny || dot.isLegendary)) reasons.push(REASON_VALUABLE);
  if (act >= 3 && (dot.isFavorite || dot.isTagged)) reasons.push(REASON_TAGGED);
  if (act >= 4 && dot.isPvp) reasons.push(REASON_PVP);
  if (reasons.length === 0) return { color: C.red, kept: false, idle: false };
  const top = reasons.reduce((a, b) => (b.priority > a.priority ? b : a));
  return { color: top.color, kept: true, idle: false };
}

function StoryGrid({ act, reducedMotion }) {
  return (
    <div
      className="grid mx-auto"
      style={{
        gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
        gap: "6px",
        maxWidth: "30rem",
      }}
      aria-hidden="true"
    >
      {STORY_DOTS.map((dot) => {
        const { color, kept, idle } = dotStateAt(dot, act);
        const opacity = idle ? 0.25 : kept ? 1 : 0.55;
        const trashCandidate = !kept && !idle;
        return (
          <span
            key={dot.i}
            className="block aspect-square rounded-full transition-all duration-500"
            style={{
              backgroundColor: color,
              opacity,
              boxShadow: kept ? `0 0 8px ${color}aa` : "none",
              animation:
                trashCandidate && !reducedMotion
                  ? "trashPulse 1.8s ease-in-out infinite"
                  : "none",
            }}
          />
        );
      })}
    </div>
  );
}

function StoryLegend({ t }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {LEGEND.map((item) => (
        <span
          key={item.key}
          className="mono text-[11px] px-2.5 py-1 rounded inline-flex items-center gap-1.5"
          style={{
            backgroundColor: `${item.color}14`,
            color: item.color,
            border: `1px solid ${item.color}40`,
          }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {t(item.key)}
        </span>
      ))}
    </div>
  );
}

function StoryAct({ act, t, reducedMotion }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="rounded-lg border p-6 sm:p-8"
      style={{ backgroundColor: C.panel, borderColor: C.border }}
    >
      <h3 className="mono text-base font-bold mb-3" style={{ color: C.text }}>
        {t(`app.landing.story.act${act}.heading`)}
      </h3>
      <p className="text-sm leading-relaxed mb-6" style={{ color: C.text }}>
        {t(`app.landing.story.act${act}.body`)}
      </p>
      <StoryGrid act={act} reducedMotion={reducedMotion} />
    </motion.section>
  );
}

// ─── Finisher ───────────────────────────────────────────────────────────────

const FINISHER_POKEMON = [
  "Mewtwo", "Latios", "Rayquaza", "Garchomp", "Tyranitar", "Lucario",
  "Dragonite", "Salamence", "Metagross", "Gardevoir", "Lugia", "Mew",
];

function useTypingRotator(items, reducedMotion) {
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState(reducedMotion ? items[0] : "");
  const [phase, setPhase] = useState("typing");
  useEffect(() => {
    if (reducedMotion) return;
    const target = items[idx];
    let timer;
    if (phase === "typing") {
      if (text.length < target.length) {
        timer = setTimeout(() => setText(target.slice(0, text.length + 1)), 70);
      } else {
        timer = setTimeout(() => setPhase("deleting"), 1500);
      }
    } else if (phase === "deleting") {
      if (text.length > 0) {
        timer = setTimeout(() => setText(text.slice(0, -1)), 38);
      } else {
        setIdx((i) => (i + 1) % items.length);
        setPhase("typing");
      }
    }
    return () => clearTimeout(timer);
  }, [items, idx, text, phase, reducedMotion]);
  return text;
}

function FinisherSection({ t, reducedMotion }) {
  const typed = useTypingRotator(FINISHER_POKEMON, reducedMotion);
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="rounded-lg p-8 sm:p-12 text-center relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${C.cyan}15, ${C.green}15)`,
        border: `1px solid ${C.cyan}40`,
      }}
    >
      <div
        className="mono text-xs uppercase tracking-wider mb-3"
        style={{ color: C.dim }}
      >
        {t("app.landing.finisher.heading")}
      </div>
      <p
        className="text-lg sm:text-2xl leading-relaxed font-medium"
        style={{ color: C.text }}
      >
        {t("app.landing.finisher.lead")}{" "}
        <span
          className="mono font-bold inline-flex items-baseline"
          style={{ color: C.cyan, minWidth: "1ch" }}
        >
          {typed}
          <span
            className="inline-block ml-0.5"
            style={{
              width: "2px",
              height: "1em",
              backgroundColor: C.cyan,
              animation: reducedMotion ? "none" : "cursorBlink 1s step-start infinite",
              transform: "translateY(0.15em)",
            }}
          />
        </span>
        {t("app.landing.finisher.tail")}
      </p>
    </motion.section>
  );
}

// ─── Supporting sections ────────────────────────────────────────────────────

function ProblemSection({ t }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="rounded-lg border p-6 sm:p-8"
      style={{ backgroundColor: C.panel, borderColor: C.border }}
    >
      <h2 className="mono text-lg font-bold tracking-tight mb-3" style={{ color: C.text }}>
        {t("app.landing.problem.heading")}
      </h2>
      <p className="text-sm leading-relaxed" style={{ color: C.text }}>
        {t("app.landing.problem.body")}
      </p>
    </motion.section>
  );
}

function IdeaSection({ t }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="rounded-lg border p-6 sm:p-8"
      style={{ backgroundColor: C.panel, borderColor: C.border }}
    >
      <h2 className="mono text-lg font-bold tracking-tight mb-3" style={{ color: C.text }}>
        {t("app.landing.idea.heading")}
      </h2>
      <p className="text-sm leading-relaxed mb-2" style={{ color: C.text }}>
        {t("app.landing.idea.body")}
      </p>
      <p className="text-xs italic" style={{ color: C.dim }}>
        {t("app.landing.idea.aside")}
      </p>
    </motion.section>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
// The Venn + nerd capstone moved out of this chapter into the dedicated
// `Algebra` chapter (`#explain/algebra`). General now ends with the finisher;
// readers who want the math click through to that chapter from the nav.

export default function General({ onNavigate }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  return (
    <ChapterShell currentKey="general" onNavigate={onNavigate}>
      <style>{`
        @keyframes trashPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.12); }
        }
        @keyframes cursorBlink { 50% { opacity: 0; } }
      `}</style>

      <header className="text-center pt-4 pb-8">
        <div className="mb-6">
          <HeroPill target="explain" />
        </div>
        <h1
          className="mono text-3xl sm:text-4xl font-bold tracking-tight leading-tight"
          style={{ color: C.text }}
        >
          {t("app.landing.title")}{" "}
          <span style={{ color: C.red }}>{t("app.landing.title_accent")}</span>
        </h1>
        <p
          className="mt-4 text-sm sm:text-base max-w-xl mx-auto leading-relaxed"
          style={{ color: C.dim }}
        >
          {t("app.landing.subtitle")}
        </p>
      </header>

      <div className="space-y-6">
        <ProblemSection t={t} />
        <IdeaSection t={t} />
        <section className="space-y-6">
          <div
            className="rounded-lg border p-6 sm:p-8 text-center"
            style={{ backgroundColor: C.panel, borderColor: C.border }}
          >
            <p
              className="text-sm leading-relaxed mb-5 max-w-xl mx-auto"
              style={{ color: C.text }}
            >
              {t("app.landing.story.intro")}
            </p>
            <StoryLegend t={t} />
          </div>
          {[1, 2, 3, 4, 5].map((act) => (
            <StoryAct key={act} act={act} t={t} reducedMotion={reducedMotion} />
          ))}
        </section>
        <FinisherSection t={t} reducedMotion={reducedMotion} />
      </div>
    </ChapterShell>
  );
}
