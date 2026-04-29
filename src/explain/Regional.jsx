import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Home, MapPin } from "lucide-react";
import { useTranslation } from "../i18n/I18nProvider.jsx";
import { C } from "./colors.js";
import { ChapterShell, HeroPill } from "./Shell.jsx";

const REGIONAL_PALETTE = {
  na:   "#E67E22",
  eu:   "#3498DB",
  sa:   "#16A085",
  asia: "#E91E63",
  au:   "#F39C12",
};
const REGIONAL_KEYS = ["na", "eu", "sa", "asia", "au"];

// 12 storage items — biased toward NA (the default home in act 2) so the
// auto-drop is visible. `souvenir` marks a background-tagged catch.
const REGIONAL_STORAGE = [
  { region: "na",   souvenir: false },
  { region: "na",   souvenir: false },
  { region: "na",   souvenir: true  },
  { region: "eu",   souvenir: true  },
  { region: "sa",   souvenir: true  },
  { region: "na",   souvenir: false },
  { region: "asia", souvenir: true  },
  { region: "na",   souvenir: false },
  { region: "au",   souvenir: true  },
  { region: "eu",   souvenir: true  },
  { region: "na",   souvenir: false },
  { region: "sa",   souvenir: true  },
];
const HOME_REGION = "na";

function MapStrip({ act, t, reducedMotion }) {
  const [travelerIdx, setTravelerIdx] = useState(0);
  useEffect(() => {
    if (act !== 1 || reducedMotion) return;
    const id = setInterval(
      () => setTravelerIdx((i) => (i + 1) % REGIONAL_KEYS.length),
      1500
    );
    return () => clearInterval(id);
  }, [act, reducedMotion]);

  const homeIdx = REGIONAL_KEYS.indexOf(HOME_REGION);
  const pinLeft = (idx) => `${(idx + 0.5) * 20}%`;

  return (
    <div className="relative pt-10 pb-2">
      {act === 1 && (
        <motion.div
          className="absolute z-10"
          style={{ top: 0, transform: "translateX(-50%)" }}
          animate={{ left: pinLeft(travelerIdx) }}
          transition={{
            type: reducedMotion ? "tween" : "spring",
            stiffness: 180,
            damping: 22,
            duration: reducedMotion ? 0 : undefined,
          }}
        >
          <MapPin
            size={22}
            style={{
              color: REGIONAL_PALETTE[REGIONAL_KEYS[travelerIdx]],
              filter: `drop-shadow(0 0 4px ${REGIONAL_PALETTE[REGIONAL_KEYS[travelerIdx]]})`,
            }}
            fill="currentColor"
          />
        </motion.div>
      )}
      {act === 2 && (
        <motion.div
          className="absolute z-10"
          style={{ top: 2, transform: "translateX(-50%)" }}
          initial={{ scale: 0, opacity: 0, left: pinLeft(homeIdx) }}
          whileInView={{ scale: 1, opacity: 1, left: pinLeft(homeIdx) }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{
            type: reducedMotion ? "tween" : "spring",
            stiffness: 220,
            damping: 18,
            duration: reducedMotion ? 0 : undefined,
          }}
        >
          <Home
            size={20}
            style={{ color: C.green, filter: `drop-shadow(0 0 6px ${C.green})` }}
            fill={`${C.green}40`}
          />
        </motion.div>
      )}
      <div className="grid grid-cols-5 gap-1.5">
        {REGIONAL_KEYS.map((key) => {
          const color = REGIONAL_PALETTE[key];
          const isHome = act === 2 && key === HOME_REGION;
          return (
            <div
              key={key}
              className="rounded p-2 text-center transition-all"
              style={{
                backgroundColor: `${color}${isHome ? "26" : "12"}`,
                border: `1px solid ${color}${isHome ? "70" : "40"}`,
              }}
            >
              <div
                className="mono text-[10px] uppercase tracking-wider"
                style={{ color }}
              >
                {t(`app.landing.regional.region_${key}`)}
              </div>
              <div
                className="mono text-[11px] mt-1 font-bold"
                style={{ color: C.text }}
              >
                {t(`app.landing.regional.species_${key}`)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RegionalStorageStrip({ act }) {
  return (
    <div
      className="grid gap-1.5 mx-auto mt-6 max-w-md"
      style={{
        gridTemplateColumns: `repeat(${REGIONAL_STORAGE.length}, minmax(0, 1fr))`,
      }}
      aria-hidden="true"
    >
      {REGIONAL_STORAGE.map((item, i) => {
        const color = REGIONAL_PALETTE[item.region];
        const dropped =
          act === 2 && item.region === HOME_REGION && !item.souvenir;
        return (
          <span
            key={i}
            className="block aspect-square rounded-full transition-all duration-700"
            style={{
              backgroundColor: color,
              opacity: dropped ? 0.18 : item.souvenir ? 1 : 0.85,
              boxShadow:
                item.souvenir && !dropped
                  ? `0 0 8px ${C.amber}cc, 0 0 0 2px ${C.amber}`
                  : "none",
            }}
          />
        );
      })}
    </div>
  );
}

function RegionalAct({ act, t, reducedMotion }) {
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
        {t(`app.landing.regional.act${act}_heading`)}
      </h3>
      <p className="text-sm leading-relaxed mb-6" style={{ color: C.text }}>
        {t(`app.landing.regional.act${act}_body`)}
      </p>
      <MapStrip act={act} t={t} reducedMotion={reducedMotion} />
      <RegionalStorageStrip act={act} />
      <p
        className="mono text-xs uppercase tracking-wider text-center mt-4"
        style={{ color: C.dim }}
      >
        {t(`app.landing.regional.act${act}_caption`)}
      </p>
    </motion.section>
  );
}

export default function Regional({ onNavigate }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  return (
    <ChapterShell currentKey="regional" onNavigate={onNavigate}>
      <header className="text-center pt-4 pb-8">
        <div className="mb-6">
          <HeroPill target="explain" />
        </div>
        <h1
          className="mono text-3xl sm:text-4xl font-bold tracking-tight leading-tight"
          style={{ color: C.text }}
        >
          {t("app.landing.regional.intro_heading")}
        </h1>
        <p
          className="mt-4 text-sm sm:text-base max-w-xl mx-auto leading-relaxed"
          style={{ color: C.dim }}
        >
          {t("app.landing.regional.intro_body")}
        </p>
      </header>
      <div className="space-y-6">
        <RegionalAct act={1} t={t} reducedMotion={reducedMotion} />
        <RegionalAct act={2} t={t} reducedMotion={reducedMotion} />
      </div>
    </ChapterShell>
  );
}
