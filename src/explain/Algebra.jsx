import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Search, Trash2 } from "lucide-react";
import { useTranslation } from "../i18n/I18nProvider.jsx";
import { C } from "./colors.js";
import { ChapterShell, HeroPill } from "./Shell.jsx";

// Section wrapper — consistent reveal-on-scroll card.
function Section({ children, id }) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="rounded-lg border p-6 sm:p-8"
      style={{ backgroundColor: C.panel, borderColor: C.border }}
    >
      {children}
    </motion.section>
  );
}

function SectionHeading({ children }) {
  return (
    <h2 className="mono text-base font-bold mb-3" style={{ color: C.text }}>
      {children}
    </h2>
  );
}

function SectionBody({ children }) {
  return (
    <p className="text-sm leading-relaxed mb-6" style={{ color: C.text }}>
      {children}
    </p>
  );
}

// ─── Section 1: Syntax cheatsheet ───────────────────────────────────────────

function SyntaxCheatsheet({ t }) {
  // Each row: operator (the actual PoGo syntax token), label, example.
  const ops = [
    { op: ",",      color: C.green,  label: t("app.algebra.s1.op_or_label"),     example: "pikachu,charizard" },
    { op: "&",      color: C.cyan,   label: t("app.algebra.s1.op_and_label"),    example: "4*&shiny" },
    { op: "!",      color: C.red,    label: t("app.algebra.s1.op_not_label"),    example: "!shiny" },
    { op: "★",      color: C.amber,  label: t("app.algebra.s1.op_star_label"),   example: "0*,1*,2*,3*,4*" },
    { op: "n−m",    color: C.purple, label: t("app.algebra.s1.op_range_label"),  example: "cp1500-2000" },
    { op: "#",      color: C.cyan,   label: t("app.algebra.s1.op_tag_label"),    example: "#auri" },
    { op: "+",      color: C.green,  label: t("app.algebra.s1.op_family_label"), example: "+pikachu" },
  ];
  return (
    <div>
      <div className="space-y-2">
        {ops.map((row, i) => (
          <motion.div
            key={row.op}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
            className="grid items-center gap-3"
            style={{ gridTemplateColumns: "auto 1fr auto" }}
          >
            <span
              className="mono text-base font-bold px-3 py-1.5 rounded shrink-0 text-center"
              style={{
                backgroundColor: `${row.color}20`,
                color: row.color,
                border: `1px solid ${row.color}55`,
                minWidth: "3rem",
              }}
            >
              {row.op}
            </span>
            <span className="text-sm" style={{ color: C.text }}>{row.label}</span>
            <span
              className="mono text-xs px-2 py-1 rounded"
              style={{
                backgroundColor: C.bg,
                color: C.dim,
                border: `1px solid ${C.borderHi}`,
              }}
            >
              {row.example}
            </span>
          </motion.div>
        ))}
      </div>
      {/* Precedence callout — the unusual property that drives Section 8. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.4, delay: 0.5 }}
        className="rounded-lg p-4 mt-5"
        style={{
          backgroundColor: `${C.red}0d`,
          border: `1px solid ${C.red}40`,
        }}
      >
        <div
          className="mono text-[11px] uppercase tracking-wider mb-1.5 font-bold"
          style={{ color: C.red }}
        >
          ⚠ {t("app.algebra.s1.precedence_label")}
        </div>
        <p className="text-xs leading-relaxed" style={{ color: C.text }}>
          {t("app.algebra.s1.precedence_body")}
        </p>
      </motion.div>
    </div>
  );
}

// ─── Section 2: Inversion ───────────────────────────────────────────────────

function InversionPanels({ t }) {
  return (
    <div>
      <div className="grid items-stretch gap-3 mb-6" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
        {/* Left: search box's actual job */}
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4 }}
          className="rounded p-4 text-center"
          style={{
            backgroundColor: `${C.cyan}10`,
            border: `1px solid ${C.cyan}40`,
          }}
        >
          <Search size={20} style={{ color: C.cyan }} className="mx-auto mb-2" />
          <div className="mono text-xs uppercase tracking-wider mb-1" style={{ color: C.cyan }}>
            search box does
          </div>
          <div className="text-sm" style={{ color: C.text }}>
            list keepers
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="flex items-center justify-center"
        >
          <span className="mono text-2xl" style={{ color: C.dim }}>≠</span>
        </motion.div>
        {/* Right: what you actually want */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded p-4 text-center"
          style={{
            backgroundColor: `${C.red}10`,
            border: `1px solid ${C.red}40`,
          }}
        >
          <Trash2 size={20} style={{ color: C.red }} className="mx-auto mb-2" />
          <div className="mono text-xs uppercase tracking-wider mb-1" style={{ color: C.red }}>
            what you want
          </div>
          <div className="text-sm" style={{ color: C.text }}>
            bulk-toss trash
          </div>
        </motion.div>
      </div>

      <div className="rounded-lg p-4" style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
        <div className="mono text-xs uppercase tracking-wider mb-3" style={{ color: C.dim }}>
          {t("app.algebra.s2.naive_label")}
        </div>
        <div className="space-y-3">
          <div>
            <div className="mono text-sm font-bold mb-1" style={{ color: C.red }}>
              ✗ {t("app.algebra.s2.naive1_title")}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: C.text }}>
              {t("app.algebra.s2.naive1_body")}
            </div>
          </div>
          <div>
            <div className="mono text-sm font-bold mb-1" style={{ color: C.red }}>
              ✗ {t("app.algebra.s2.naive2_title")}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: C.text }}>
              {t("app.algebra.s2.naive2_body")}
            </div>
          </div>
          <div>
            <div className="mono text-sm font-bold mb-1" style={{ color: C.green }}>
              ✓ {t("app.algebra.s2.working_label")}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: C.text }}>
              {t("app.algebra.s2.working_body")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section 3: Set algebra definitions ─────────────────────────────────────

function SetAlgebraDefs({ t }) {
  const defs = [
    { sym: t("app.algebra.s3.def_u_label"),  body: t("app.algebra.s3.def_u_value"),  color: C.dim    },
    { sym: t("app.algebra.s3.def_ki_label"), body: t("app.algebra.s3.def_ki_value"), color: C.amber  },
    { sym: t("app.algebra.s3.def_k_label"),  body: t("app.algebra.s3.def_k_value"),  color: C.cyan   },
    { sym: t("app.algebra.s3.def_t_label"),  body: t("app.algebra.s3.def_t_value"),  color: C.red    },
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {defs.map((d, i) => (
        <motion.div
          key={d.sym}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.3, delay: i * 0.08 }}
          className="rounded p-4 flex gap-3 items-start"
          style={{
            backgroundColor: `${d.color}0d`,
            border: `1px solid ${d.color}33`,
          }}
        >
          <span
            className="mono font-bold shrink-0 px-2.5 py-1 rounded text-center"
            style={{
              backgroundColor: `${d.color}26`,
              color: d.color,
              border: `1px solid ${d.color}66`,
              minWidth: "2.5rem",
              fontSize: "1rem",
            }}
          >
            {d.sym}
          </span>
          <span className="text-sm leading-relaxed" style={{ color: C.text }}>
            {d.body}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Section 4: De Morgan's flip ────────────────────────────────────────────

function DeMorganFlip({ t }) {
  // Three lines stacked: set notation → De Morgan → syntax. Each line fades
  // in on scroll with a small delay so the transformation reads sequentially.
  const lines = [
    {
      label: t("app.algebra.s4.law_label"),
      tokens: [
        { v: "T",  c: C.red    },
        { v: "=",  c: C.dim    },
        { v: "¬",  c: C.red    },
        { v: "(",  c: C.dim    },
        { v: "K₁", c: C.cyan   },
        { v: "∪",  c: C.dim    },
        { v: "K₂", c: C.green  },
        { v: "∪",  c: C.dim    },
        { v: "K₃", c: C.purple },
        { v: ")",  c: C.dim    },
      ],
      delay: 0,
    },
    {
      tokens: [
        { v: "=",  c: C.dim    },
        { v: "¬K₁", c: C.cyan   },
        { v: "∩",  c: C.dim    },
        { v: "¬K₂", c: C.green  },
        { v: "∩",  c: C.dim    },
        { v: "¬K₃", c: C.purple },
      ],
      delay: 0.4,
    },
    {
      label: t("app.algebra.s4.translate_label"),
      tokens: [
        { v: "→",        c: C.dim   },
        { v: "!K₁",      c: C.cyan  },
        { v: "&",        c: C.amber },
        { v: "!K₂",      c: C.green },
        { v: "&",        c: C.amber },
        { v: "!K₃",      c: C.purple },
      ],
      delay: 0.85,
      separator: true,
    },
  ];
  return (
    <div
      className="rounded-lg p-5 space-y-3"
      style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}
    >
      {lines.map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4, delay: line.delay }}
        >
          {line.label && (
            <div
              className="mono text-[10px] uppercase tracking-wider mb-1"
              style={{ color: C.dim }}
            >
              {line.label}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap font-bold" style={{ fontSize: "1.05rem" }}>
            {line.tokens.map((tok, j) => (
              <span
                key={j}
                className="mono"
                style={{ color: tok.c }}
              >
                {tok.v}
              </span>
            ))}
          </div>
        </motion.div>
      ))}
      {/* Operator translation footnote */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.4, delay: 1.2 }}
        className="mono text-[11px] flex items-center gap-3 pt-3 mt-2"
        style={{ borderTop: `1px solid ${C.border}`, color: C.dim }}
      >
        <span>∩ → <span style={{ color: C.amber }}>&</span></span>
        <span style={{ color: C.borderHi }}>·</span>
        <span>¬ → <span style={{ color: C.red }}>!</span></span>
      </motion.div>
    </div>
  );
}

// ─── Section 5: Worked example ─────────────────────────────────────────────

function WorkedExample({ t }) {
  // The three keep rules driving the worked example. Each maps one set to
  // its PoGo syntax clause.
  const rules = [
    { sym: "K_#", desc: "tagged",    clause: "#",     color: C.green  },
    { sym: "K_S", desc: "shinies",   clause: "shiny", color: C.amber  },
    { sym: "K_4", desc: "4★ hundos", clause: "4*",    color: C.cyan   },
  ];
  // Derivation lines, with annotations on the right.
  const derivation = [
    { eq: ["K", "=", "K_#", "∪", "K_S", "∪", "K_4"], note: "union of keep rules" },
    { eq: ["T", "=", "¬K"],                          note: "complement" },
    { eq: ["",   "=", "¬(", "K_#", "∪", "K_S", "∪", "K_4", ")"], note: "expand K" },
    { eq: ["",   "=", "¬K_#", "∩", "¬K_S", "∩", "¬K_4"], note: "De Morgan" },
    { eq: ["",   "→", "!#", "&", "!shiny", "&", "!4*"],  note: "translate to syntax" },
  ];
  // Map symbol/text → color so derivation tokens render with the right hue.
  const colorFor = (tok) => {
    if (tok === "K"   || tok.startsWith("¬K") && tok.length === 2) return C.text;
    if (tok === "T"   || tok.startsWith("¬K") && tok === "¬K")     return C.red;
    if (tok.includes("K_#") || tok === "!#")     return C.green;
    if (tok.includes("K_S") || tok === "!shiny") return C.amber;
    if (tok.includes("K_4") || tok === "!4*")    return C.cyan;
    if (tok === "&" || tok === "→")              return C.amber;
    if (tok === "¬" || tok === "¬K")             return C.red;
    return C.dim;
  };
  return (
    <div className="space-y-5">
      {/* Keep rules box */}
      <div>
        <div className="mono text-xs uppercase tracking-wider mb-2" style={{ color: C.dim }}>
          {t("app.algebra.s5.rules_label")}
        </div>
        <div className="space-y-1.5">
          {rules.map((r, i) => (
            <motion.div
              key={r.sym}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              className="grid items-center gap-3 mono text-xs"
              style={{ gridTemplateColumns: "auto auto 1fr auto" }}
            >
              <span className="font-bold" style={{ color: r.color, minWidth: "2.5rem" }}>
                {r.sym}
              </span>
              <span style={{ color: C.dim }}>=</span>
              <span style={{ color: C.text }}>{r.desc}</span>
              <span
                className="px-2 py-0.5 rounded"
                style={{
                  backgroundColor: `${r.color}1f`,
                  color: r.color,
                  border: `1px solid ${r.color}55`,
                }}
              >
                {r.clause}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Derivation block */}
      <div
        className="rounded-lg p-5"
        style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}
      >
        <div className="mono text-xs uppercase tracking-wider mb-3" style={{ color: C.dim }}>
          {t("app.algebra.s5.derivation_label")}
        </div>
        <div className="space-y-2">
          {derivation.map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.18 }}
              className="grid items-baseline gap-3"
              style={{ gridTemplateColumns: "1fr auto" }}
            >
              <div className="flex items-baseline gap-2 flex-wrap mono text-sm font-bold">
                {line.eq.map((tok, j) => (
                  <span key={j} style={{ color: colorFor(tok) }}>
                    {tok}
                  </span>
                ))}
              </div>
              <span
                className="mono text-[10px] italic"
                style={{ color: C.dim }}
              >
                {line.note}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Result — styled like a search box */}
      <div>
        <div className="mono text-xs uppercase tracking-wider mb-2" style={{ color: C.dim }}>
          {t("app.algebra.s5.result_label")}
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.4, delay: 1.1 }}
          className="rounded p-3 flex items-center gap-2 mono"
          style={{
            backgroundColor: `${C.cyan}0d`,
            border: `1.5px solid ${C.cyan}66`,
            boxShadow: `0 0 18px ${C.cyan}22`,
          }}
        >
          <Search size={14} style={{ color: C.cyan }} />
          <code className="text-sm font-bold" style={{ color: C.text }}>
            !#&!shiny&!4*
          </code>
        </motion.div>
        <p className="text-xs italic mt-3" style={{ color: C.dim }}>
          {t("app.algebra.s5.result_note")}
        </p>
      </div>
    </div>
  );
}

// ─── Section 6: Venn (relocated from General.jsx) ───────────────────────────

const VENN_A = { cx: 140, cy: 100 };
const VENN_B = { cx: 110, cy: 152 };
const VENN_C = { cx: 170, cy: 152 };
const VENN_R = 65;

const VENN_DOTS = [
  { x: 140, y: 60,  r: "a",   kept: true, color: "cyan" },
  { x: 120, y: 75,  r: "a",   kept: true, color: "cyan" },
  { x: 75,  y: 175, r: "b",   kept: true, color: "green" },
  { x: 90,  y: 195, r: "b",   kept: true, color: "green" },
  { x: 205, y: 175, r: "c",   kept: true, color: "purple" },
  { x: 195, y: 200, r: "c",   kept: true, color: "purple" },
  { x: 105, y: 130, r: "ab",  kept: true, color: "ab" },
  { x: 175, y: 130, r: "ac",  kept: true, color: "ac" },
  { x: 140, y: 195, r: "bc",  kept: true, color: "bc" },
  { x: 140, y: 145, r: "abc", kept: true, color: "abc" },
  { x: 250, y: 60,  r: "t", kept: false },
  { x: 35,  y: 75,  r: "t", kept: false },
  { x: 240, y: 230, r: "t", kept: false },
  { x: 50,  y: 240, r: "t", kept: false },
];

function dotFill(color) {
  switch (color) {
    case "cyan":   return C.cyan;
    case "green":  return C.green;
    case "purple": return C.purple;
    case "ab":     return "#42B388";
    case "ac":     return "#7AA8C0";
    case "bc":     return "#7C8B66";
    case "abc":    return C.text;
    default:       return C.dim;
  }
}

function VennCircle({ pos, color, label, labelOffset, delay, reducedMotion }) {
  return (
    <>
      <motion.circle
        initial={{ scale: 0, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : delay, ease: "easeOut" }}
        cx={pos.cx}
        cy={pos.cy}
        r={VENN_R}
        fill={`${color}1f`}
        stroke={color}
        strokeWidth="1.6"
      />
      <motion.text
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: reducedMotion ? 0 : 0.3, delay: reducedMotion ? 0 : delay + 0.25 }}
        x={pos.cx + labelOffset.x}
        y={pos.cy + labelOffset.y}
        fill={color}
        fontFamily="JetBrains Mono, monospace"
        fontSize="12"
        fontWeight="bold"
        textAnchor="middle"
      >
        {label}
      </motion.text>
    </>
  );
}

function VennDiagram({ reducedMotion }) {
  return (
    <svg
      viewBox="0 0 480 280"
      className="w-full max-w-lg mx-auto"
      role="img"
      aria-label="Venn-3 of K with sample Pokémon dots; trash dots outside the union"
    >
      <rect x="2" y="2" width="476" height="276" fill="none" stroke={C.borderHi} strokeDasharray="3 3" rx="6" />

      <VennCircle pos={VENN_A} color={C.cyan}   label="A" labelOffset={{ x: 0, y: -VENN_R - 4 }} delay={0.1}  reducedMotion={reducedMotion} />
      <VennCircle pos={VENN_B} color={C.green}  label="B" labelOffset={{ x: -VENN_R - 4, y: 4 }} delay={0.25} reducedMotion={reducedMotion} />
      <VennCircle pos={VENN_C} color={C.purple} label="C" labelOffset={{ x: VENN_R + 4, y: 4 }}  delay={0.4}  reducedMotion={reducedMotion} />

      {VENN_DOTS.map((dot, i) => {
        const fill = dot.kept ? dotFill(dot.color) : C.red;
        return (
          <motion.circle
            key={i}
            initial={{ scale: 0, opacity: 0 }}
            whileInView={{ scale: 1, opacity: dot.kept ? 1 : 0.85 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: reducedMotion ? 0 : 0.3, delay: reducedMotion ? 0 : 0.7 + i * 0.04 }}
            cx={dot.x}
            cy={dot.y}
            r={dot.kept ? 4 : 3.5}
            fill={fill}
            style={{
              filter: dot.kept ? `drop-shadow(0 0 4px ${fill}aa)` : `drop-shadow(0 0 3px ${C.red}88)`,
              animation: !dot.kept && !reducedMotion ? "trashPulse 1.6s ease-in-out infinite" : "none",
            }}
          />
        );
      })}

      <motion.text
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: reducedMotion ? 0 : 0.3 }}
        x="14" y="22" fill={C.red} fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight="bold"
      >
        T = ¬K
      </motion.text>

      <motion.text
        initial={{ opacity: 0, x: -8 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : 0.55 }}
        x="290" y="105" fontFamily="JetBrains Mono, monospace" fontSize="16" fontWeight="bold" fill={C.text}
      >
        K =
        <tspan fill={C.cyan} dx="6">A</tspan>
        <tspan fill={C.dim} dx="4">∪</tspan>
        <tspan fill={C.green} dx="4">B</tspan>
        <tspan fill={C.dim} dx="4">∪</tspan>
        <tspan fill={C.purple} dx="4">C</tspan>
      </motion.text>

      <motion.text
        initial={{ opacity: 0, x: -8 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : 0.85 }}
        x="290" y="140" fontFamily="JetBrains Mono, monospace" fontSize="16" fontWeight="bold" fill={C.red}
      >
        T = ¬K
      </motion.text>

      <motion.text
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : 1.1 }}
        x="290" y="175" fontFamily="JetBrains Mono, monospace" fontSize="9" fill={C.dim}
      >
        <tspan>● in K — kept</tspan>
        <tspan x="290" dy="14">● in T — trashed</tspan>
        <tspan x="290" dy="14" opacity="0.7">3 of N keep sets</tspan>
        <tspan x="290" dy="14" opacity="0.7">shown for clarity</tspan>
      </motion.text>
    </svg>
  );
}

// ─── Section 7: Trade is symmetric ──────────────────────────────────────────

function TradeSymmetric({ t }) {
  return (
    <div
      className="rounded-lg p-5 grid sm:grid-cols-2 gap-4"
      style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}
    >
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.4 }}
        className="rounded p-4 text-center"
        style={{ backgroundColor: `${C.red}10`, border: `1px solid ${C.red}40` }}
      >
        <div className="mono text-[10px] uppercase tracking-wider mb-1" style={{ color: C.dim }}>
          trash filter
        </div>
        <div className="mono text-base font-bold mb-1" style={{ color: C.text }}>
          T = ¬<span style={{ color: C.cyan }}>K</span>
        </div>
        <div className="text-xs" style={{ color: C.dim }}>
          things to throw away
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, x: 8 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="rounded p-4 text-center"
        style={{ backgroundColor: `${C.cyan}10`, border: `1px solid ${C.cyan}40` }}
      >
        <div className="mono text-[10px] uppercase tracking-wider mb-1" style={{ color: C.dim }}>
          trade filter
        </div>
        <div className="mono text-base font-bold mb-1" style={{ color: C.text }}>
          <span style={{ color: C.amber }}>K_trade</span> = ¬(things to keep)
        </div>
        <div className="text-xs" style={{ color: C.dim }}>
          things to send to a friend
        </div>
      </motion.div>
    </div>
  );
}

// ─── Section 8: Nested filters (the parens PoGo doesn't have) ─────────────

// Render an annotated derivation block: each line has an optional label and
// a sequence of colored tokens. Used by both worked examples in Section 8.
function DerivationBlock({ lines, baseDelay = 0 }) {
  return (
    <div
      className="rounded-lg p-5"
      style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}
    >
      <div className="space-y-3">
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.35, delay: baseDelay + i * 0.18 }}
          >
            {line.label && (
              <div
                className="mono text-[10px] uppercase tracking-wider mb-1"
                style={{ color: C.dim }}
              >
                {line.label}
              </div>
            )}
            <div className="flex items-baseline gap-1.5 flex-wrap mono text-sm font-bold">
              {line.tokens.map((tok, j) => (
                <span key={j} style={{ color: tok.c }}>
                  {tok.v}
                </span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SearchBoxResult({ value, delay = 0.6 }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay }}
      className="rounded p-3 flex items-center gap-2 mono"
      style={{
        backgroundColor: `${C.cyan}0d`,
        border: `1.5px solid ${C.cyan}66`,
        boxShadow: `0 0 18px ${C.cyan}22`,
      }}
    >
      <Search size={14} style={{ color: C.cyan }} />
      <code className="text-sm font-bold break-all" style={{ color: C.text }}>
        {value}
      </code>
    </motion.div>
  );
}

function NestedExample1({ t }) {
  // trash = ≤3★ ∩ (pikachu ∪ (raichu ∩ ¬alolan))
  //       = ≤3★ ∩ (pikachu ∪ raichu) ∩ (pikachu ∪ ¬alolan)    (distribute ∪ over ∩)
  //       = ≤3★ ∩ (pikachu ∪ raichu) ∩ (pikachu ∪ ¬psychic)    (type trick)
  //       → !4* & pikachu,raichu & pikachu,!psychic
  // CNF form — three AND-of-OR clauses, the only shape PoGo's parser handles.
  const lines = [
    {
      label: t("app.algebra.s8.ex1_set_label"),
      tokens: [
        { v: "trash",    c: C.red    },
        { v: "=",        c: C.dim    },
        { v: "≤3★",      c: C.amber  },
        { v: "∩",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "pikachu",  c: C.cyan   },
        { v: "∪",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "raichu",   c: C.purple },
        { v: "∩",        c: C.dim    },
        { v: "¬alolan",  c: C.green  },
        { v: ")",        c: C.dim    },
        { v: ")",        c: C.dim    },
      ],
    },
    {
      label: t("app.algebra.s8.ex1_distribute_label"),
      tokens: [
        { v: "=",        c: C.dim    },
        { v: "≤3★",      c: C.amber  },
        { v: "∩",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "pikachu",  c: C.cyan   },
        { v: "∪",        c: C.dim    },
        { v: "raichu",   c: C.purple },
        { v: ")",        c: C.dim    },
        { v: "∩",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "pikachu",  c: C.cyan   },
        { v: "∪",        c: C.dim    },
        { v: "¬alolan",  c: C.green  },
        { v: ")",        c: C.dim    },
      ],
    },
    {
      label: t("app.algebra.s8.ex1_typetrick_label"),
      tokens: [
        { v: "=",        c: C.dim    },
        { v: "≤3★",      c: C.amber  },
        { v: "∩",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "pikachu",  c: C.cyan   },
        { v: "∪",        c: C.dim    },
        { v: "raichu",   c: C.purple },
        { v: ")",        c: C.dim    },
        { v: "∩",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "pikachu",  c: C.cyan   },
        { v: "∪",        c: C.dim    },
        { v: "¬psychic", c: C.green  },
        { v: ")",        c: C.dim    },
      ],
    },
    {
      label: t("app.algebra.s8.ex1_translate_label"),
      tokens: [
        { v: "→",        c: C.dim    },
        { v: "!4*",      c: C.amber  },
        { v: "&",        c: C.amber  },
        { v: "pikachu",  c: C.cyan   },
        { v: ",",        c: C.green  },
        { v: "raichu",   c: C.purple },
        { v: "&",        c: C.amber  },
        { v: "pikachu",  c: C.cyan   },
        { v: ",",        c: C.green  },
        { v: "!psychic", c: C.green  },
      ],
    },
  ];
  return (
    <div className="space-y-3">
      <h3 className="mono text-sm font-bold" style={{ color: C.text }}>
        {t("app.algebra.s8.ex1_title")}
      </h3>
      <div>
        <div className="mono text-[10px] uppercase tracking-wider mb-1" style={{ color: C.dim }}>
          {t("app.algebra.s8.ex1_intent_label")}
        </div>
        <p className="text-sm leading-relaxed" style={{ color: C.text }}>
          {t("app.algebra.s8.ex1_intent")}
        </p>
      </div>
      <DerivationBlock lines={lines} />
      <SearchBoxResult value="!4*&pikachu,raichu&pikachu,!psychic" />
      <p className="text-xs italic leading-relaxed" style={{ color: C.dim }}>
        {t("app.algebra.s8.ex1_typetrick_note")}
      </p>
    </div>
  );
}

function NestedExample2({ t }) {
  // cheap = pidgey ∪ (geodude ∩ traded)
  //       = (pidgey ∪ geodude) ∩ (pidgey ∪ traded)    (distribute ∪ over ∩ → CNF)
  //       → pidgey,geodude & pidgey,traded
  const lines = [
    {
      label: t("app.algebra.s8.ex2_set_label"),
      tokens: [
        { v: "cheap",    c: C.cyan   },
        { v: "=",        c: C.dim    },
        { v: "pidgey",   c: C.green  },
        { v: "∪",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "geodude",  c: C.purple },
        { v: "∩",        c: C.dim    },
        { v: "traded",   c: C.amber  },
        { v: ")",        c: C.dim    },
      ],
    },
    {
      label: t("app.algebra.s8.ex2_distribute_label"),
      tokens: [
        { v: "=",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "pidgey",   c: C.green  },
        { v: "∪",        c: C.dim    },
        { v: "geodude",  c: C.purple },
        { v: ")",        c: C.dim    },
        { v: "∩",        c: C.dim    },
        { v: "(",        c: C.dim    },
        { v: "pidgey",   c: C.green  },
        { v: "∪",        c: C.dim    },
        { v: "traded",   c: C.amber  },
        { v: ")",        c: C.dim    },
      ],
    },
    {
      label: t("app.algebra.s8.ex2_syntax_label"),
      tokens: [
        { v: "→",        c: C.dim    },
        { v: "pidgey",   c: C.green  },
        { v: ",",        c: C.green  },
        { v: "geodude",  c: C.purple },
        { v: "&",        c: C.amber  },
        { v: "pidgey",   c: C.green  },
        { v: ",",        c: C.green  },
        { v: "traded",   c: C.amber  },
      ],
    },
  ];
  return (
    <div className="space-y-3">
      <h3 className="mono text-sm font-bold" style={{ color: C.text }}>
        {t("app.algebra.s8.ex2_title")}
      </h3>
      <div>
        <div className="mono text-[10px] uppercase tracking-wider mb-1" style={{ color: C.dim }}>
          {t("app.algebra.s8.ex2_intent_label")}
        </div>
        <p className="text-sm leading-relaxed" style={{ color: C.text }}>
          {t("app.algebra.s8.ex2_intent")}
        </p>
      </div>
      <DerivationBlock lines={lines} />
      <SearchBoxResult value="pidgey,geodude&pidgey,traded" />
      <p className="text-xs italic leading-relaxed" style={{ color: C.dim }}>
        {t("app.algebra.s8.ex2_note")}
      </p>
    </div>
  );
}

function DistributiveLawsCard({ t }) {
  // Show the workhorse law (∪ over ∩, produces CNF — paste-able) flagged green,
  // and its dual (∩ over ∪, produces DNF — un-paste-able) flagged red. The
  // visual matters: readers should remember which direction is the right one.
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4 }}
      className="rounded-lg p-5"
      style={{
        backgroundColor: `${C.amber}08`,
        border: `1px solid ${C.amber}33`,
      }}
    >
      <div className="mono text-xs uppercase tracking-wider mb-2" style={{ color: C.amber }}>
        {t("app.algebra.s8.laws_label")}
      </div>
      <p className="text-xs leading-relaxed mb-5" style={{ color: C.text }}>
        {t("app.algebra.s8.laws_intro")}
      </p>
      <div className="space-y-4 mono text-sm">
        {/* The useful direction — green */}
        <div>
          <div
            className="mono text-[10px] uppercase tracking-wider mb-1.5"
            style={{ color: C.green }}
          >
            ✓ {t("app.algebra.s8.laws_useful")}
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span style={{ color: C.cyan }}>A</span>
            <span style={{ color: C.dim }}>∪</span>
            <span style={{ color: C.dim }}>(</span>
            <span style={{ color: C.green }}>B</span>
            <span style={{ color: C.dim }}>∩</span>
            <span style={{ color: C.purple }}>C</span>
            <span style={{ color: C.dim }}>)</span>
            <span style={{ color: C.dim }}>=</span>
            <span style={{ color: C.dim }}>(</span>
            <span style={{ color: C.cyan }}>A</span>
            <span style={{ color: C.dim }}>∪</span>
            <span style={{ color: C.green }}>B</span>
            <span style={{ color: C.dim }}>)</span>
            <span style={{ color: C.dim }}>∩</span>
            <span style={{ color: C.dim }}>(</span>
            <span style={{ color: C.cyan }}>A</span>
            <span style={{ color: C.dim }}>∪</span>
            <span style={{ color: C.purple }}>C</span>
            <span style={{ color: C.dim }}>)</span>
          </div>
        </div>
        {/* The dual — red, marked as wrong direction */}
        <div style={{ opacity: 0.7 }}>
          <div
            className="mono text-[10px] uppercase tracking-wider mb-1.5"
            style={{ color: C.red }}
          >
            ✗ {t("app.algebra.s8.laws_unusable")}
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span style={{ color: C.cyan }}>A</span>
            <span style={{ color: C.dim }}>∩</span>
            <span style={{ color: C.dim }}>(</span>
            <span style={{ color: C.green }}>B</span>
            <span style={{ color: C.dim }}>∪</span>
            <span style={{ color: C.purple }}>C</span>
            <span style={{ color: C.dim }}>)</span>
            <span style={{ color: C.dim }}>=</span>
            <span style={{ color: C.dim }}>(</span>
            <span style={{ color: C.cyan }}>A</span>
            <span style={{ color: C.dim }}>∩</span>
            <span style={{ color: C.green }}>B</span>
            <span style={{ color: C.dim }}>)</span>
            <span style={{ color: C.dim }}>∪</span>
            <span style={{ color: C.dim }}>(</span>
            <span style={{ color: C.cyan }}>A</span>
            <span style={{ color: C.dim }}>∩</span>
            <span style={{ color: C.purple }}>C</span>
            <span style={{ color: C.dim }}>)</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function NestedExamples({ t }) {
  return (
    <div className="space-y-8">
      <NestedExample1 t={t} />
      <div style={{ borderTop: `1px solid ${C.border}` }} />
      <NestedExample2 t={t} />
      <DistributiveLawsCard t={t} />
    </div>
  );
}

// ─── Section 9: The closing punch ───────────────────────────────────────────

// Three identity cards rendered together — the "everything ladders down to
// these three moves" reveal. Each card has a title, a single math identity,
// and a one-line caption tying the move to its job.
function MoveCard({ label, color, formula, caption, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay }}
      className="rounded-lg p-5 flex flex-col gap-3"
      style={{
        backgroundColor: `${color}10`,
        border: `1px solid ${color}55`,
      }}
    >
      <div
        className="mono text-[11px] uppercase tracking-wider font-bold"
        style={{ color }}
      >
        {label}
      </div>
      <div
        className="mono text-base font-bold flex items-center justify-center py-2 rounded"
        style={{
          backgroundColor: C.bg,
          color: C.text,
          border: `1px solid ${color}33`,
          minHeight: "3rem",
        }}
      >
        {formula}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: C.text }}>
        {caption}
      </p>
    </motion.div>
  );
}

function ClosingPunch({ t }) {
  return (
    <div className="space-y-6">
      {/* Three move cards — the workshop's whole algebraic toolkit. */}
      <div className="grid sm:grid-cols-3 gap-4">
        <MoveCard
          label={t("app.algebra.s9.move1_label")}
          color={C.red}
          formula={
            <span>
              <span style={{ color: C.red }}>T</span>
              <span style={{ color: C.dim }}> = </span>
              <span style={{ color: C.red }}>¬</span>
              <span style={{ color: C.cyan }}>K</span>
            </span>
          }
          caption={t("app.algebra.s9.move1_caption")}
          delay={0}
        />
        <MoveCard
          label={t("app.algebra.s9.move2_label")}
          color={C.cyan}
          formula={
            <span>
              <span style={{ color: C.red }}>¬</span>
              <span style={{ color: C.dim }}>(</span>
              <span style={{ color: C.cyan }}>A</span>
              <span style={{ color: C.dim }}> ∪ </span>
              <span style={{ color: C.green }}>B</span>
              <span style={{ color: C.dim }}>) = </span>
              <span style={{ color: C.red }}>¬</span>
              <span style={{ color: C.cyan }}>A</span>
              <span style={{ color: C.dim }}> ∩ </span>
              <span style={{ color: C.red }}>¬</span>
              <span style={{ color: C.green }}>B</span>
            </span>
          }
          caption={t("app.algebra.s9.move2_caption")}
          delay={0.15}
        />
        <MoveCard
          label={t("app.algebra.s9.move3_label")}
          color={C.amber}
          formula={
            <span style={{ fontSize: "0.8rem" }}>
              <span style={{ color: C.cyan }}>A</span>
              <span style={{ color: C.dim }}> ∪ (</span>
              <span style={{ color: C.green }}>B</span>
              <span style={{ color: C.dim }}> ∩ </span>
              <span style={{ color: C.purple }}>C</span>
              <span style={{ color: C.dim }}>) = (</span>
              <span style={{ color: C.cyan }}>A</span>
              <span style={{ color: C.dim }}>∪</span>
              <span style={{ color: C.green }}>B</span>
              <span style={{ color: C.dim }}>) ∩ (</span>
              <span style={{ color: C.cyan }}>A</span>
              <span style={{ color: C.dim }}>∪</span>
              <span style={{ color: C.purple }}>C</span>
              <span style={{ color: C.dim }}>)</span>
            </span>
          }
          caption={t("app.algebra.s9.move3_caption")}
          delay={0.3}
        />
      </div>

      {/* The manifesto — large, gradient-backed closing card. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className="rounded-lg p-8 sm:p-10 text-center relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${C.cyan}1f, ${C.green}1f, ${C.amber}1f)`,
          border: `1px solid ${C.cyan}55`,
          boxShadow: `0 0 32px ${C.cyan}22`,
        }}
      >
        <p
          className="mono text-base sm:text-lg leading-relaxed font-bold"
          style={{ color: C.text }}
        >
          {t("app.algebra.s9.manifesto")}
        </p>
        <p
          className="mono text-base sm:text-lg leading-relaxed font-bold mt-1"
          style={{ color: C.cyan }}
        >
          {t("app.algebra.s9.manifesto_punch")}
        </p>
        <p
          className="text-sm italic leading-relaxed mt-4 max-w-xl mx-auto"
          style={{ color: C.dim }}
        >
          {t("app.algebra.s9.manifesto_credit")}
        </p>
      </motion.div>

      {/* QED tagline — small, italic, the wink at the end. */}
      <motion.p
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.4, delay: 0.9 }}
        className="mono text-xs italic text-center"
        style={{ color: C.dim }}
      >
        {t("app.algebra.s9.qed")}
      </motion.p>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Algebra({ onNavigate }) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  return (
    <ChapterShell currentKey="algebra" onNavigate={onNavigate}>
      <style>{`
        @keyframes trashPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.12); }
        }
      `}</style>

      <header className="text-center pt-4 pb-8">
        <div className="mb-6">
          <HeroPill target="explain" />
        </div>
        <h1
          className="mono text-3xl sm:text-4xl font-bold tracking-tight leading-tight"
          style={{ color: C.text }}
        >
          {t("app.algebra.title")}{" "}
          <span style={{ color: C.cyan }}>{t("app.algebra.title_accent")}</span>
        </h1>
        <p
          className="mt-4 text-sm sm:text-base max-w-xl mx-auto leading-relaxed"
          style={{ color: C.dim }}
        >
          {t("app.algebra.intro")}
        </p>
      </header>

      <div className="space-y-6">
        <Section id="grammar">
          <SectionHeading>{t("app.algebra.s1.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s1.body")}</SectionBody>
          <SyntaxCheatsheet t={t} />
        </Section>

        <Section id="inversion">
          <SectionHeading>{t("app.algebra.s2.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s2.body")}</SectionBody>
          <InversionPanels t={t} />
        </Section>

        <Section id="set-algebra">
          <SectionHeading>{t("app.algebra.s3.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s3.body")}</SectionBody>
          <SetAlgebraDefs t={t} />
        </Section>

        <Section id="de-morgan">
          <SectionHeading>{t("app.algebra.s4.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s4.body")}</SectionBody>
          <DeMorganFlip t={t} />
        </Section>

        <Section id="example">
          <SectionHeading>{t("app.algebra.s5.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s5.body")}</SectionBody>
          <WorkedExample t={t} />
        </Section>

        <Section id="venn">
          <SectionHeading>{t("app.algebra.s6.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s6.body")}</SectionBody>
          <VennDiagram reducedMotion={reducedMotion} />
        </Section>

        <Section id="trade">
          <SectionHeading>{t("app.algebra.s7.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s7.body")}</SectionBody>
          <TradeSymmetric t={t} />
        </Section>

        <Section id="nested">
          <SectionHeading>{t("app.algebra.s8.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s8.body")}</SectionBody>
          <NestedExamples t={t} />
        </Section>

        <Section id="closing">
          <SectionHeading>{t("app.algebra.s9.heading")}</SectionHeading>
          <SectionBody>{t("app.algebra.s9.body")}</SectionBody>
          <ClosingPunch t={t} />
        </Section>
      </div>
    </ChapterShell>
  );
}
