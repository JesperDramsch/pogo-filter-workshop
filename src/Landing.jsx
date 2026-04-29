import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, BookOpen } from "lucide-react";
import { useTranslation } from "./i18n/I18nProvider.jsx";
import { C } from "./explain/colors.js";
import { ChapterNav, HeroPill, AppCredit } from "./explain/Shell.jsx";

// ─── Looping demo ───────────────────────────────────────────────────────────
// 8×6 grid of 48 dots. A few dots are pre-assigned a "role" (favorite, shiny,
// hundo, trade-evo) and the loop walks through phases lighting them up in
// turn, then locks them all on, then pulses the unprotected dots red.
//
// Quick-glance, ~12 second cycle. Stops cycling when off-screen or tab is
// hidden, and falls back to a static "all-protected" frame for users with
// `prefers-reduced-motion: reduce`.

const ROLES = [
  { key: "favorites", color: C.green,  phase: 1, labelKey: "app.landing.demo.phase_favorites" },
  { key: "shinies",   color: C.amber,  phase: 2, labelKey: "app.landing.demo.phase_shinies" },
  { key: "hundos",    color: C.cyan,   phase: 3, labelKey: "app.landing.demo.phase_hundos" },
  { key: "tradeEvos", color: C.purple, phase: 4, labelKey: "app.landing.demo.phase_trade_evos" },
];

const COLS = 8;
const ROWS = 6;
const TOTAL = COLS * ROWS;

const PROTECTED_INDICES = {
  favorites: [3, 11, 17, 24, 32, 41],
  shinies:   [5, 14, 28, 39],
  hundos:    [8, 22, 35],
  tradeEvos: [16, 26, 33, 44],
};

const DOTS = Array.from({ length: TOTAL }, (_, i) => {
  for (const role of ROLES) {
    if (PROTECTED_INDICES[role.key].includes(i)) {
      return { i, color: role.color, revealAt: role.phase };
    }
  }
  return { i, color: null, revealAt: Infinity };
});

// Phase indices: 0 idle → 1-4 reveal each role → 5 all protected → 6 trash
// pulse → 7 brief reset before looping.
const PHASE_DURATIONS_MS = [1200, 1300, 1300, 1300, 1300, 1800, 2200, 600];

function Legend({ phase, t }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {ROLES.map((role) => {
        const active = phase === role.phase;
        const allLit = phase === 5 || phase === 7;
        const intensity = active ? 1 : allLit ? 0.7 : 0.45;
        return (
          <span
            key={role.key}
            className="mono text-[11px] px-2.5 py-1 rounded inline-flex items-center gap-1.5 transition-all"
            style={{
              backgroundColor: `${role.color}${active ? "26" : "12"}`,
              color: active ? role.color : C.dim,
              border: `1px solid ${role.color}${active ? "66" : "26"}`,
              opacity: phase === 6 && !active ? 0.5 : 1,
            }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: role.color,
                boxShadow: active ? `0 0 8px ${role.color}` : "none",
                opacity: intensity,
              }}
            />
            {t(role.labelKey)}
          </span>
        );
      })}
    </div>
  );
}

function PhaseLabel({ phase, t }) {
  let key = null;
  if (phase >= 1 && phase <= 4) key = ROLES[phase - 1].labelKey;
  else if (phase === 5 || phase === 7) key = "app.landing.demo.phase_protected";
  else if (phase === 6) key = "app.landing.demo.phase_trash";
  return (
    <div
      className="mono text-xs uppercase tracking-wider min-h-[1.25rem] mt-4 text-center"
      style={{ color: C.dim }}
    >
      {key ? t(key) : "\u00A0"}
    </div>
  );
}

function DemoLoop({ t, reducedMotion }) {
  const [phase, setPhase] = useState(reducedMotion ? 5 : 0);
  const sectionRef = useRef(null);
  const visibleRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (reducedMotion) return;
    const el = sectionRef.current;
    if (!el) return;
    let timer = null;
    const schedule = () => {
      const dur = PHASE_DURATIONS_MS[phaseRef.current] ?? 1500;
      timer = setTimeout(() => {
        if (document.visibilityState === "hidden" || !visibleRef.current) {
          timer = setTimeout(schedule, 600);
          return;
        }
        const next = (phaseRef.current + 1) % PHASE_DURATIONS_MS.length;
        setPhase(next);
        schedule();
      }, dur);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
      io.disconnect();
    };
  }, [reducedMotion]);

  return (
    <section ref={sectionRef} className="my-10">
      <Legend phase={phase} t={t} />
      <div
        className="grid mx-auto mt-6"
        style={{
          gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
          gap: "10px",
          maxWidth: "26rem",
        }}
        aria-hidden="true"
      >
        {DOTS.map((dot) => {
          const isProtected = dot.revealAt !== Infinity;
          let lit = false;
          let color = C.borderHi;
          let glow = 0;
          let scale = 1;

          if (phase === 6) {
            if (isProtected) {
              color = dot.color; lit = true; glow = 0.35;
            } else {
              color = C.red; lit = true; glow = 0.6;
            }
          } else if (phase === 5 || phase === 7) {
            if (isProtected) {
              color = dot.color; lit = true; glow = 0.8; scale = 1.05;
            }
          } else if (phase >= dot.revealAt && isProtected) {
            color = dot.color; lit = true;
            const isActive = phase === dot.revealAt;
            glow = isActive ? 1 : 0.6;
            scale = isActive ? 1.25 : 1.05;
          }

          const trashPulse = phase === 6 && !isProtected;
          const glowHex = Math.round(glow * 255).toString(16).padStart(2, "0");

          return (
            <motion.span
              key={dot.i}
              className="block aspect-square rounded-full"
              animate={
                reducedMotion
                  ? { scale: 1, opacity: lit ? 1 : 0.5 }
                  : { scale, opacity: lit ? 1 : 0.45 }
              }
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 240, damping: 18 }
              }
              style={{
                backgroundColor: color,
                boxShadow: lit ? `0 0 ${10 + 18 * glow}px ${color}${glowHex}` : "none",
                animation: trashPulse && !reducedMotion
                  ? "trashPulse 1.1s ease-in-out infinite"
                  : "none",
              }}
            />
          );
        })}
      </div>
      <PhaseLabel phase={phase} t={t} />
    </section>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Landing({ onNavigate }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  return (
    <div className="grid-bg min-h-screen" style={{ backgroundColor: C.bg }}>
      <style>{`
        @keyframes trashPulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <ChapterNav currentKey="landing" onNavigate={onNavigate} />

        <main className="mt-6">
          <section className="text-center pt-6 pb-2">
            <div className="mb-6">
              <HeroPill target="workshop" />
            </div>
            <h1
              className="mono text-4xl sm:text-5xl font-bold tracking-tight leading-tight"
              style={{ color: C.text }}
            >
              {t("app.landing.title")}{" "}
              <span style={{ color: C.red }}>{t("app.landing.title_accent")}</span>
            </h1>
            <p
              className="mt-5 text-base sm:text-lg max-w-xl mx-auto leading-relaxed"
              style={{ color: C.dim }}
            >
              {t("app.landing.subtitle")}
            </p>
          </section>

          <DemoLoop t={t} reducedMotion={reducedMotion} />

          <div className="flex items-center justify-center gap-3 flex-wrap mt-8">
            <button
              onClick={() => onNavigate("workshop")}
              className="mono text-sm font-bold px-5 py-2.5 rounded transition flex items-center gap-2"
              style={{ backgroundColor: C.red, color: "#fff" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#FF5A4A")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.red)}
            >
              {t("app.landing.cta_workshop")} <ArrowRight size={14} />
            </button>
            <button
              onClick={() => onNavigate("general")}
              className="mono text-sm px-5 py-2.5 rounded transition flex items-center gap-2"
              style={{
                backgroundColor: "transparent",
                color: C.dim,
                border: `1px solid ${C.border}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = C.text;
                e.currentTarget.style.borderColor = C.borderHi;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = C.dim;
                e.currentTarget.style.borderColor = C.border;
              }}
            >
              <BookOpen size={14} /> {t("app.landing.cta_explain")} <ArrowRight size={14} />
            </button>
          </div>
          <AppCredit />
        </main>
      </div>
    </div>
  );
}
