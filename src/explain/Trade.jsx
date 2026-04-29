import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Users } from "lucide-react";
import { useTranslation } from "../i18n/I18nProvider.jsx";
import { C } from "./colors.js";
import { ChapterShell, HeroPill } from "./Shell.jsx";

function DistanceGauge({ t, reducedMotion }) {
  return (
    <div className="mt-2">
      <div className="flex justify-between mb-1.5">
        <span className="mono text-[11px]" style={{ color: C.red }}>
          40,000 dust
        </span>
        <span className="mono text-[11px]" style={{ color: C.green }}>
          800 dust
        </span>
      </div>
      <motion.div
        className="relative h-3 rounded overflow-hidden"
        initial={{ scaleX: 0.6, opacity: 0 }}
        whileInView={{ scaleX: 1, opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: reducedMotion ? 0 : 0.7, ease: "easeOut" }}
        style={{
          background: `linear-gradient(to right, ${C.red}, ${C.amber} 40%, ${C.green})`,
          transformOrigin: "left",
        }}
      >
        <div
          className="absolute top-0 bottom-0"
          style={{ left: "40%", width: "2px", backgroundColor: C.text }}
        />
      </motion.div>
      <div className="relative mt-1 mono text-[10px]" style={{ color: C.dim }}>
        <span className="absolute" style={{ left: "0%" }}>1km</span>
        <span
          className="absolute"
          style={{ left: "40%", transform: "translateX(-50%)", color: C.text }}
        >
          100km ←
        </span>
        <span className="absolute" style={{ right: "0%" }}>1000km+</span>
        <span className="invisible">spacer</span>
      </div>
      <div className="text-center mt-6 mono text-[11px]" style={{ color: C.dim }}>
        {t("app.landing.trade.act1_dust_label")}
      </div>
    </div>
  );
}

function EvoFlow() {
  const pairs = [
    { from: "Abra 1★",    to: "Alakazam" },
    { from: "Machop 0★",  to: "Machamp"  },
    { from: "Geodude 2★", to: "Golem"    },
  ];
  return (
    <div className="mt-2 space-y-2">
      {pairs.map((p, i) => (
        <motion.div
          key={p.from}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4, delay: i * 0.1 }}
          className="grid items-center gap-3"
          style={{ gridTemplateColumns: "1fr auto 1fr" }}
        >
          <span
            className="mono text-xs px-3 py-1.5 rounded text-center"
            style={{
              backgroundColor: `${C.dim}15`,
              color: C.dim,
              border: `1px solid ${C.dim}40`,
            }}
          >
            {p.from}
          </span>
          <ArrowRight size={14} style={{ color: C.cyan }} />
          <span
            className="mono text-xs px-3 py-1.5 rounded text-center font-bold"
            style={{
              backgroundColor: `${C.cyan}1f`,
              color: C.cyan,
              border: `1px solid ${C.cyan}66`,
              boxShadow: `0 0 10px ${C.cyan}33`,
            }}
          >
            {p.to}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function BuddyRoster() {
  const buddies = [
    { name: "Anna", tag: "#anna", staged: "Bagon · Beldum · Gible", color: C.purple },
    { name: "Bo",   tag: "#bo",   staged: "Deino",                    color: C.green  },
    { name: "Cara", tag: "#cara", staged: "Larvitar · Goomy",         color: C.amber  },
  ];
  return (
    <div className="mt-2 space-y-2">
      {buddies.map((b, i) => (
        <motion.div
          key={b.name}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4, delay: i * 0.1 }}
          className="rounded p-3 flex items-center gap-3 flex-wrap"
          style={{
            backgroundColor: `${b.color}12`,
            border: `1px solid ${b.color}40`,
          }}
        >
          <span
            className="inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0"
            style={{ backgroundColor: `${b.color}30`, color: b.color }}
          >
            <Users size={12} />
          </span>
          <span className="mono text-sm font-bold" style={{ color: C.text }}>
            {b.name}
          </span>
          <span
            className="mono text-[11px] px-2 py-0.5 rounded"
            style={{
              backgroundColor: `${b.color}26`,
              color: b.color,
              border: `1px solid ${b.color}60`,
            }}
          >
            {b.tag}
          </span>
          <span className="mono text-[11px] ml-auto" style={{ color: C.dim }}>
            {b.staged}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

const TRADE_VISUALS = {
  1: DistanceGauge,
  2: EvoFlow,
  3: BuddyRoster,
};

function TradeAct({ act, t, reducedMotion }) {
  const Visual = TRADE_VISUALS[act];
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
        {t(`app.landing.trade.act${act}_heading`)}
      </h3>
      <p className="text-sm leading-relaxed mb-6" style={{ color: C.text }}>
        {t(`app.landing.trade.act${act}_body`)}
      </p>
      <Visual t={t} reducedMotion={reducedMotion} />
      {act > 1 && (
        <p
          className="mono text-xs uppercase tracking-wider text-center mt-6"
          style={{ color: C.dim }}
        >
          {t(`app.landing.trade.act${act}_caption`)}
        </p>
      )}
    </motion.section>
  );
}

export default function Trade({ onNavigate }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  return (
    <ChapterShell currentKey="trade" onNavigate={onNavigate}>
      <header className="text-center pt-4 pb-8">
        <div className="mb-6">
          <HeroPill target="explain" />
        </div>
        <h1
          className="mono text-3xl sm:text-4xl font-bold tracking-tight leading-tight"
          style={{ color: C.text }}
        >
          {t("app.landing.trade.intro_heading")}
        </h1>
        <p
          className="mt-4 text-sm sm:text-base max-w-xl mx-auto leading-relaxed"
          style={{ color: C.dim }}
        >
          {t("app.landing.trade.intro_body")}
        </p>
      </header>
      <div className="space-y-6">
        {[1, 2, 3].map((act) => (
          <TradeAct
            key={act}
            act={act}
            t={t}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>
    </ChapterShell>
  );
}
