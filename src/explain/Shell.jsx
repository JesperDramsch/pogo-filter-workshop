import React, { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useTranslation } from "../i18n/I18nProvider.jsx";
import { C } from "./colors.js";
import { CHAPTERS, neighbours } from "./chapters.js";

// Words the slot machine cycles through. Adding a new top-level URL? Drop a
// word in here and that's it. The longest word ("workshop") sets the slot
// width so we don't get layout thrash as it rolls.
export const HERO_WORDS = ["workshop", "explain", "general", "regional", "trade", "rules"];

// Branded hero pill with a slot-machine final segment.
//   <HeroPill target="workshop" />  ← rolls through HERO_WORDS, settles on "workshop".
// On `prefers-reduced-motion: reduce` it skips the roll and just shows the
// target word statically. Decoration only — not interactive.
//
// Timing curve: tick delays ramp from `rollMs` (start, fast) to `rollMaxMs`
// (end, slow) with a quadratic ease — the reel stays snappy at first, then
// visibly decelerates into the target. The slide-in transition itself is
// always short (linear) so each word lands cleanly before the next pause.
export function HeroPill({
  target = "workshop",
  rollCount = 12,
  rollMs = 90,
  rollMaxMs = 340,
}) {
  const reducedMotion = useReducedMotion();
  const [word, setWord] = useState(reducedMotion ? target : HERO_WORDS[0]);

  useEffect(() => {
    if (reducedMotion) {
      setWord(target);
      return;
    }
    let count = 0;
    let timer;

    const tick = () => {
      count++;
      if (count >= rollCount) {
        setWord(target);
        return;
      }
      // Pick a different word each tick so consecutive frames always change.
      setWord((prev) => {
        const rest = HERO_WORDS.filter((w) => w !== prev);
        return rest[Math.floor(Math.random() * rest.length)];
      });
      // Quadratic ramp: t² keeps delays near rollMs for most of the roll,
      // then climbs sharply at the end. Feels like a slot reel slowing down.
      const t = count / rollCount;
      const delay = rollMs + (rollMaxMs - rollMs) * t * t;
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, rollMs);
    return () => clearTimeout(timer);
  }, [target, rollCount, rollMs, rollMaxMs, reducedMotion]);

  return (
    <div
      className="mono inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs"
      style={{ backgroundColor: C.border, color: C.dim }}
    >
      <Sparkles size={12} />
      <span>
        pogo<span style={{ color: C.red }}>.</span>filter
      </span>
      <span
        className="inline-block relative overflow-hidden"
        style={{
          width: "5.5em",
          height: "1.2em",
          color: C.cyan,
          verticalAlign: "bottom",
        }}
      >
        <AnimatePresence initial={false}>
          <motion.span
            key={word}
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.09, ease: "linear" }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              lineHeight: "1.2em",
              whiteSpace: "nowrap",
            }}
          >
            .{word}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

// Brand mark — pseudo-Venn of two outlines.
//   1. A single yellow line: head circle + two pointed seed-shaped ears
//      whose wide bases open onto the head (no closing line at the bottom).
//   2. A green lucide Sparkles glyph (the same icon used in the General tab),
//      sized large and dropped low so it visibly clips the head's lower-right.
export function HomeLogo({ size = 36 }) {
  const wrapperWidth = size * 1.2;
  const wrapperHeight = size * 1.1;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: wrapperWidth, height: wrapperHeight }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 32 32"
        width={size}
        height={size}
        className="block"
        style={{ overflow: "visible" }}
      >
        {/* Head — split into two arcs so the head outline opens at the ear
            bases instead of running through them. Inner ear bases sit at
            ~55°/125° on the head; outer bases at ~35°/145°. */}
        <path
          d="M 20.6 13.5 A 8 8 0 0 0 11.4 13.5"
          fill="none"
          stroke={C.amber}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M 22.6 15.4 A 8 8 0 1 1 9.4 15.4"
          fill="none"
          stroke={C.amber}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        {/* Right ear — bases and tip rotated 15° further around the head
            (from the previous 70°/50° down to 55°/35°). Tip moves outward
            from (24, 5) to (27.6, 7.6) so the ear lays more horizontally. */}
        <path
          d="M 20.6 13.5 Q 21 8 27.6 7.6 Q 27.5 12 22.6 15.4"
          fill="none"
          stroke={C.amber}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Left ear (mirror around x = 16) */}
        <path
          d="M 11.4 13.5 Q 11 8 4.4 7.6 Q 4.5 12 9.4 15.4"
          fill="none"
          stroke={C.amber}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Sparkles
        size={size * 0.7}
        strokeWidth={1.8}
        style={{
          color: C.green,
          position: "absolute",
          right: -size * 0.04,
          bottom: -size * 0.1,
          filter: `drop-shadow(0 0 5px ${C.green}88)`,
        }}
      />
    </span>
  );
}

// Header row: brand mark on the left, chapter pills + workshop CTA on the
// right. Wraps on mobile to two stacked rows.
export function ChapterNav({ currentKey, onNavigate }) {
  const { t } = useTranslation();
  const homeActive = currentKey === "landing";
  return (
    <nav className="flex items-center justify-between gap-4 flex-wrap py-2">
      <button
        onClick={() => onNavigate("landing")}
        className="flex items-center gap-2.5 transition group"
        style={{ color: homeActive ? C.text : C.dim }}
        onMouseEnter={(e) => { if (!homeActive) e.currentTarget.style.color = C.text; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = homeActive ? C.text : C.dim; }}
        aria-label={t("app.explain.nav.landing")}
      >
        <HomeLogo size={36} />
        <span className="mono text-base font-bold tracking-tight">
          pogo<span style={{ color: C.red }}>.</span>filter<span style={{ color: C.cyan }}>.workshop</span>
        </span>
      </button>
      <div className="flex items-center gap-1.5 flex-wrap">
        {CHAPTERS.map((c) => {
          const Icon = c.icon;
          const active = c.key === currentKey;
          return (
            <NavChip
              key={c.key}
              icon={Icon}
              label={t(c.titleKey)}
              onClick={() => onNavigate(c.key)}
              tone={active ? "active" : "default"}
            />
          );
        })}
        <span className="mx-1 hidden sm:inline" style={{ color: C.borderHi }}>·</span>
        <NavChip
          icon={ArrowRight}
          iconRight
          label={t("app.explain.nav.workshop")}
          onClick={() => onNavigate("workshop")}
          tone="primary"
        />
      </div>
    </nav>
  );
}

function NavChip({ icon: Icon, label, onClick, tone, iconRight = false }) {
  // Visual tones: active (current chapter), primary (workshop), default,
  // muted (landing back-link).
  const styles = {
    active:  { bg: C.border,    fg: C.text, border: C.borderHi },
    primary: { bg: `${C.red}22`, fg: C.red,  border: `${C.red}66` },
    default: { bg: "transparent", fg: C.dim, border: C.border },
    muted:   { bg: "transparent", fg: C.dim, border: "transparent" },
  }[tone] || { bg: "transparent", fg: C.dim, border: C.border };
  return (
    <button
      onClick={onClick}
      className="mono text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded transition"
      style={{
        backgroundColor: styles.bg,
        color: styles.fg,
        border: `1px solid ${styles.border}`,
      }}
      onMouseEnter={(e) => {
        if (tone !== "active") e.currentTarget.style.color = C.text;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = styles.fg;
      }}
    >
      {Icon && !iconRight && <Icon size={12} />}
      {label}
      {Icon && iconRight && <Icon size={12} />}
    </button>
  );
}

// Page wrapper for every explain chapter. Provides the persistent nav strip
// at the top, full-bleed grid background, and a prev/next footer with one
// more workshop CTA so the offer doesn't disappear when users hit bottom.
export function ChapterShell({ currentKey, onNavigate, children }) {
  const { t } = useTranslation();
  const { prev, next } = neighbours(currentKey);
  return (
    <div className="grid-bg min-h-screen" style={{ backgroundColor: C.bg }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <ChapterNav currentKey={currentKey} onNavigate={onNavigate} />
        <main className="mt-4">{children}</main>
        <footer className="mt-12 pt-8 border-t" style={{ borderColor: C.border }}>
          <div className="flex items-center justify-between gap-4 mb-6">
            {prev ? (
              <button
                onClick={() => onNavigate(prev.key)}
                className="mono text-xs flex items-start gap-2 transition text-left"
                style={{ color: C.dim }}
                onMouseEnter={(e) => (e.currentTarget.style.color = C.text)}
                onMouseLeave={(e) => (e.currentTarget.style.color = C.dim)}
              >
                <ArrowLeft size={14} className="mt-0.5 shrink-0" />
                <span>
                  <span className="block uppercase tracking-wider opacity-60 text-[10px]">
                    {t("app.explain.nav.previous")}
                  </span>
                  <span className="block">{t(prev.titleKey)}</span>
                </span>
              </button>
            ) : (
              <div />
            )}
            {next ? (
              <button
                onClick={() => onNavigate(next.key)}
                className="mono text-xs flex items-start gap-2 transition text-right"
                style={{ color: C.dim }}
                onMouseEnter={(e) => (e.currentTarget.style.color = C.text)}
                onMouseLeave={(e) => (e.currentTarget.style.color = C.dim)}
              >
                <span>
                  <span className="block uppercase tracking-wider opacity-60 text-[10px]">
                    {t("app.explain.nav.next")}
                  </span>
                  <span className="block">{t(next.titleKey)}</span>
                </span>
                <ArrowRight size={14} className="mt-0.5 shrink-0" />
              </button>
            ) : (
              <div />
            )}
          </div>
          <div className="text-center">
            <button
              onClick={() => onNavigate("workshop")}
              className="mono text-sm font-bold px-5 py-2.5 rounded transition inline-flex items-center gap-2"
              style={{ backgroundColor: C.red, color: "#fff" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#FF5A4A")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.red)}
            >
              {t("app.landing.cta_workshop")} <ArrowRight size={14} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
