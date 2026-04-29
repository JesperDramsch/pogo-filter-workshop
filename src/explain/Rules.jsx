import React from "react";
import { motion } from "motion/react";
import { Shield, Sparkles, Swords, Tag, Wand2 } from "lucide-react";
import { useTranslation } from "../i18n/I18nProvider.jsx";
import { C } from "./colors.js";
import { ChapterShell, HeroPill } from "./Shell.jsx";

// Rule definitions: id matches the i18n key suffix (r1..r15). Group decides
// which colour band the card sits in. Numbering is the user-facing rule
// number — Rule 1 (4★) is canonical and stays at the top.
const RULES = [
  { id: "r1",  group: "safety"   },
  { id: "r2",  group: "safety"   },
  { id: "r3",  group: "rarity"   },
  { id: "r4",  group: "rarity"   },
  { id: "r5",  group: "rarity"   },
  { id: "r6",  group: "cosmetic" },
  { id: "r7",  group: "cosmetic" },
  { id: "r8",  group: "cosmetic" },
  { id: "r9",  group: "cosmetic" },
  { id: "r10", group: "cosmetic" },
  { id: "r11", group: "smart"    },
  { id: "r12", group: "smart"    },
  { id: "r13", group: "smart"    },
  { id: "r14", group: "smart"    },
  { id: "r15", group: "battle"   },
];

const GROUPS = {
  safety:   { color: C.red,    icon: Shield,   order: 1 },
  rarity:   { color: C.green,  icon: Sparkles, order: 2 },
  cosmetic: { color: C.purple, icon: Tag,      order: 3 },
  smart:    { color: C.cyan,   icon: Wand2,    order: 4 },
  battle:   { color: C.amber,  icon: Swords,   order: 5 },
};

function ruleNumber(id) {
  return id.replace(/^r/, "");
}

function RuleCard({ rule, color, t }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4 }}
      className="rounded-lg border p-5 sm:p-6"
      style={{ backgroundColor: C.panel, borderColor: C.border }}
    >
      <div className="flex items-baseline gap-3 mb-2">
        <span
          className="mono text-xs font-bold px-2 py-0.5 rounded shrink-0"
          style={{
            backgroundColor: `${color}20`,
            color,
            border: `1px solid ${color}40`,
          }}
        >
          {ruleNumber(rule.id)}
        </span>
        <h3 className="mono text-base font-bold tracking-tight" style={{ color: C.text }}>
          {t(`app.rules.${rule.id}.title`)}
        </h3>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: C.text }}>
        {t(`app.rules.${rule.id}.body`)}
      </p>
    </motion.div>
  );
}

function GroupSection({ groupKey, rules, t }) {
  const meta = GROUPS[groupKey];
  const Icon = meta.icon;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 mb-1 mt-2">
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded shrink-0"
          style={{
            backgroundColor: `${meta.color}20`,
            color: meta.color,
            border: `1px solid ${meta.color}40`,
          }}
        >
          <Icon size={14} />
        </span>
        <div>
          <h2 className="mono text-lg font-bold tracking-tight" style={{ color: meta.color }}>
            {t(`app.rules.group.${groupKey}.heading`)}
          </h2>
          <p className="text-xs italic" style={{ color: C.dim }}>
            {t(`app.rules.group.${groupKey}.note`)}
          </p>
        </div>
      </div>
      <div className="space-y-3">
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} color={meta.color} t={t} />
        ))}
      </div>
    </section>
  );
}

export default function Rules({ onNavigate }) {
  const { t } = useTranslation();

  const byGroup = Object.keys(GROUPS)
    .sort((a, b) => GROUPS[a].order - GROUPS[b].order)
    .map((groupKey) => ({
      groupKey,
      rules: RULES.filter((r) => r.group === groupKey),
    }))
    .filter((g) => g.rules.length > 0);

  return (
    <ChapterShell currentKey="rules" onNavigate={onNavigate}>
      <header className="text-center pt-4 pb-8">
        <div className="mb-6">
          <HeroPill target="rules" />
        </div>
        <h1
          className="mono text-3xl sm:text-4xl font-bold tracking-tight leading-tight"
          style={{ color: C.text }}
        >
          {t("app.rules.title")}{" "}
          <span style={{ color: C.cyan }}>{t("app.rules.title_accent")}</span>
        </h1>
        <p
          className="mt-4 text-sm sm:text-base max-w-xl mx-auto leading-relaxed"
          style={{ color: C.dim }}
        >
          {t("app.rules.intro")}
        </p>
      </header>
      <div className="space-y-10">
        {byGroup.map(({ groupKey, rules }) => (
          <GroupSection key={groupKey} groupKey={groupKey} rules={rules} t={t} />
        ))}
      </div>
    </ChapterShell>
  );
}
