import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  animate,
  useMotionValue,
  useTransform,
  useReducedMotion,
} from "motion/react";
import {
  Star, Sparkles, Crown, Clover, Trophy, Gem, Ghost, Sun, Shirt,
  Image as ImageIcon, Swords, Baby, Maximize2, Minimize2, Repeat,
  Atom, Tag, ArrowUp, Layers, Flame, TrendingUp, Heart, Clock, Frown,
  Check, X as XIcon, Undo2, SkipForward, ArrowRight, Hand, MapPin,
} from "lucide-react";
import { useTranslation } from "./i18n/I18nProvider.jsx";
import { useDialogBehavior } from "./Dialog.jsx";
import { C } from "./explain/colors.js";
import { AppCredit } from "./explain/Shell.jsx";

// ─── Deck ─────────────────────────────────────────────────────────────────
// Each card maps 1:1 to a `protect*` boolean in DEFAULT_CONFIG. Swipe right =
// keep (set true), left = toss (set false). Titles/descriptions reuse the
// existing `app.protect.*` i18n keys (`.label` / `.why`) so the cards need no
// new per-locale copy. `confirmToss` guards a destructive "turn a safe default
// off" gesture, mirroring ConfigPanel's `requireConfirmOff`.
//
// Cards are organised into thematic groups (group label i18n key:
// `app.onboarding.swipe.group.<id>`), surfaced in the deck header. Hundos
// (protectFourStar) are deliberately NOT in the beginner (core) flow — they're
// "Rule 1", protected by default; only the opted-in advanced "IV extremes"
// group lets a power user toss them, and only behind a confirm.
const CARDS = {
  favorites:      { key: "protectFavorites",     base: "app.protect.favorites",       Icon: Star,       accent: C.amber },
  any_tag:        { key: "protectAnyTag",        base: "app.protect.any_tag",         Icon: Tag,        accent: C.cyan },
  shinies:        { key: "protectShinies",       base: "app.protect.shinies",         Icon: Sparkles,   accent: C.cyan },
  luckies:        { key: "protectLuckies",       base: "app.protect.luckies",         Icon: Clover,     accent: C.green },
  legendaries:    { key: "protectLegendaries",   base: "app.protect.legendaries",     Icon: Trophy,     accent: C.purple },
  mythicals:      { key: "protectMythicals",     base: "app.protect.mythicals",       Icon: Gem,        accent: C.purple },
  shadows:        { key: "protectShadows",       base: "app.protect.shadows",         Icon: Ghost,      accent: C.purple },
  purified:       { key: "protectPurified",      base: "app.protect.purified",        Icon: Sun,        accent: C.cyan },
  costumes:       { key: "protectCostumes",      base: "app.protect.costumes",        Icon: Shirt,      accent: C.amber },
  backgrounds:    { key: "protectBackgrounds",   base: "app.protect.backgrounds",     Icon: ImageIcon,  accent: C.cyan },
  babies:         { key: "protectBabies",        base: "app.protect.babies",          Icon: Baby,       accent: C.green },
  trade_evos:     { key: "protectTradeEvos",     base: "app.protect.trade_evos",      Icon: Repeat,     accent: C.green },
  xxl:            { key: "protectXXL",           base: "app.protect.xxl",             Icon: Maximize2,  accent: C.cyan },
  xxs:            { key: "protectXXS",           base: "app.protect.xxs",             Icon: Minimize2,  accent: C.cyan },
  four_star:      { key: "protectFourStar",      base: "app.protect.four_star",       Icon: Crown,      accent: C.amber, confirmToss: true },
  nundos:         { key: "protectNundos",        base: "app.protect.nundos",          Icon: Frown,      accent: C.purple },
  legacy_moves:   { key: "protectLegacyMoves",   base: "app.protect.legacy_moves",    Icon: Swords,     accent: C.amber },
  double_moved:   { key: "protectDoubleMoved",   base: "app.protect.double_moved",    Icon: Layers,     accent: C.amber },
  dynamax:        { key: "protectDynamax",       base: "app.protect.dynamax",         Icon: Flame,      accent: C.amber },
  ultra_beasts:   { key: "protectUltraBeasts",   base: "app.protect.ultra_beasts",    Icon: Atom,       accent: C.purple },
  new_evolutions: { key: "protectNewEvolutions", base: "app.protect.new_evolutions",  Icon: TrendingUp, accent: C.green },
  xl:             { key: "protectXL",            base: "app.protect.xl",              Icon: ArrowUp,    accent: C.cyan },
  buddies:        { key: "protectBuddies",       base: "app.protect.buddies_protect", Icon: Heart,      accent: C.green },
  lucky_eligible: { key: "protectLuckyEligible", base: "app.protect.lucky_eligible",  Icon: Clock,      accent: C.cyan },
};

const CORE_GROUPS = [
  { id: "marked",     cards: [CARDS.favorites, CARDS.any_tag] },
  { id: "rare",       cards: [CARDS.shinies, CARDS.luckies, CARDS.legendaries, CARDS.mythicals] },
  { id: "shadow",     cards: [CARDS.shadows, CARDS.purified] },
  { id: "looks",      cards: [CARDS.costumes, CARDS.backgrounds] },
  { id: "collection", cards: [CARDS.babies, CARDS.trade_evos] },
  { id: "size",       cards: [CARDS.xxl, CARDS.xxs] },
];

const ADVANCED_GROUPS = [
  { id: "iv",     cards: [CARDS.four_star, CARDS.nundos] },
  { id: "battle", cards: [CARDS.legacy_moves, CARDS.double_moved, CARDS.dynamax] },
  { id: "niche",  cards: [CARDS.ultra_beasts, CARDS.new_evolutions, CARDS.xl, CARDS.buddies, CARDS.lucky_eligible] },
];

// Flatten to ordered decks, stamping each card with its group id for the header.
const withGroup = (groups) => groups.flatMap((g) => g.cards.map((c) => ({ ...c, groupId: g.id })));
const CORE = withGroup(CORE_GROUPS);
const ADVANCED = withGroup(ADVANCED_GROUPS);

const SWIPE_OFFSET = 110;    // px of drag distance that commits a decision
const SWIPE_VELOCITY = 600;  // px/s fling shortcut

// ─── Card faces ─────────────────────────────────────────────────────────────

function CardFace({ card, t }) {
  const { Icon, accent, base } = card;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-7">
      <div
        className="flex items-center justify-center rounded-2xl mb-6"
        style={{
          width: 88,
          height: 88,
          backgroundColor: `${accent}1A`,
          border: `1px solid ${accent}59`,
        }}
        aria-hidden="true"
      >
        <Icon size={40} style={{ color: accent, filter: `drop-shadow(0 0 10px ${accent}66)` }} />
      </div>
      <h3 className="mono text-xl font-bold leading-tight" style={{ color: C.text }}>
        {t(`${base}.label`)}
      </h3>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: C.dim }}>
        {t(`${base}.why`)}
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function SwipeOnboarding({ onComplete, onSkip, onNavigate }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState("core"); // core | offer | advanced | done
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState({});
  const [confirm, setConfirm] = useState(null); // card awaiting toss confirmation
  // The toss confirmation is the app's only DESTRUCTIVE dialog and had none of
  // the dialog contract — no role, no name, no focus management, no Escape.
  // It keeps its own animated markup (motion + AnimatePresence) and borrows the
  // behaviour. It renders inside the deck rather than a portal, so it inerts the
  // deck container specifically; pointing at #root would inert the dialog too.
  const confirmPanelRef = useRef(null);
  const confirmKeepRef = useRef(null);
  const deckRef = useRef(null);
  const onConfirmKeyDown = useDialogBehavior({
    panelRef: confirmPanelRef,
    onClose: () => setConfirm(null),
    initialFocusRef: confirmKeepRef,
    backgroundRef: deckRef,
    active: !!confirm,
  });
  const busyRef = useRef(false);
  const hintPlayedRef = useRef(false);
  const hintControlsRef = useRef(null);

  const deck = phase === "advanced" ? ADVANCED : CORE;
  const card = deck[index] || null;
  const behind = deck[index + 1] || null;

  // Drag motion value lives at the parent (only the top card is draggable).
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-320, 320], [-16, 16]);
  const keepOpacity = useTransform(x, [40, 150], [0, 1]);
  const tossOpacity = useTransform(x, [-40, -150], [0, 1]);

  const swiping = phase === "core" || phase === "advanced";

  const stopHint = useCallback(() => {
    if (hintControlsRef.current) {
      hintControlsRef.current.stop();
      hintControlsRef.current = null;
    }
  }, []);

  const commit = useCallback(
    (value) => {
      busyRef.current = false;
      x.set(0);
      setConfirm(null);
      if (!card) return;
      setDecisions((d) => ({ ...d, [card.key]: value }));
      if (index + 1 >= deck.length) {
        setPhase(phase === "core" ? "offer" : "done");
      } else {
        setIndex((i) => i + 1);
      }
    },
    [card, index, deck.length, phase, x]
  );

  // Fling the card off-screen, then commit (or commit instantly when the user
  // prefers reduced motion / acts via buttons or keys).
  const decide = useCallback(
    (dir) => {
      if (!card || busyRef.current || confirm) return;
      stopHint();
      if (dir < 0 && card.confirmToss) {
        // Destructive: snap back and ask before turning a safe default off.
        animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
        setConfirm(card);
        return;
      }
      const value = dir > 0;
      if (reduced) {
        commit(value);
        return;
      }
      busyRef.current = true;
      const w = typeof window !== "undefined" ? window.innerWidth : 800;
      animate(x, dir * (w + 200), {
        duration: 0.28,
        ease: "easeOut",
        onComplete: () => commit(value),
      });
    },
    [card, confirm, reduced, commit, x, stopHint]
  );

  const onDragEnd = useCallback(
    (_event, info) => {
      if (!card) return;
      const past =
        Math.abs(info.offset.x) > SWIPE_OFFSET ||
        Math.abs(info.velocity.x) > SWIPE_VELOCITY;
      if (!past) {
        animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
        return;
      }
      decide(info.offset.x > 0 ? 1 : -1);
    },
    [card, decide, x]
  );

  const undo = useCallback(() => {
    if (busyRef.current || confirm || index === 0) return;
    const prevCard = deck[index - 1];
    setDecisions((d) => {
      const next = { ...d };
      delete next[prevCard.key];
      return next;
    });
    x.set(0);
    setIndex((i) => i - 1);
  }, [confirm, index, deck, x]);

  // Keyboard: → keep, ← toss, Backspace undo.
  useEffect(() => {
    if (!swiping || confirm) return undefined;
    const onKey = (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); decide(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); decide(-1); }
      else if (e.key === "Backspace") { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swiping, confirm, decide, undo]);

  // One-time swipe affordance: gently nudge the very first card right then
  // left so the KEEP/TOSS overlays peek in, telegraphing that the card is
  // draggable. Skipped under reduced motion; cancelled the moment the user
  // grabs the card or makes a choice.
  useEffect(() => {
    if (reduced || hintPlayedRef.current) return undefined;
    if (phase !== "core" || index !== 0 || !card) return undefined;
    hintPlayedRef.current = true;
    const controls = animate(x, [0, 90, 0, -90, 0], {
      duration: 1.9,
      delay: 0.6,
      ease: "easeInOut",
      times: [0, 0.28, 0.5, 0.78, 1],
    });
    hintControlsRef.current = controls;
    return () => controls.stop();
  }, [phase, index, card, reduced, x]);

  const keptCount = useMemo(
    () => Object.values(decisions).filter((v) => v === true).length,
    [decisions]
  );
  const tossCount = useMemo(
    () => Object.values(decisions).filter((v) => v === false).length,
    [decisions]
  );

  function startOver() {
    setDecisions({});
    x.set(0);
    setIndex(0);
    setPhase("core");
  }

  const spring = reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 24 };

  return (
    <div className="grid-bg min-h-screen flex flex-col" style={{ backgroundColor: C.bg }}>
      <div ref={deckRef} className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex-1 flex flex-col">
        {/* Header — brand + skip */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => onNavigate("landing")}
            className="mono text-sm font-bold tracking-tight"
            style={{ color: C.text }}
          >
            pogo<span style={{ color: C.red }}>.</span>filter
            <span style={{ color: C.cyan }}>.workshop</span>
          </button>
          <button
            onClick={onSkip}
            className="mono text-xs px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition"
            style={{ color: C.dim, border: `1px solid ${C.border}` }}
            onMouseEnter={(e) => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.borderHi; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.dim; e.currentTarget.style.borderColor = C.border; }}
          >
            {t("app.onboarding.swipe.skip")} <SkipForward size={13} />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center py-6">
          <AnimatePresence mode="wait">
            {/* ── Swiping ─────────────────────────────────────────────── */}
            {swiping && card && (
              <motion.div
                key={`swiping-${phase}`}
                className="w-full max-w-sm flex flex-col items-center"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduced ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {/* Title + intro */}
                <div className="text-center mb-5">
                  <div className="mono text-[11px] uppercase tracking-wider" style={{ color: C.cyan }}>
                    {t("app.onboarding.swipe.eyebrow")}
                  </div>
                  <h1 className="mono text-2xl font-bold mt-1" style={{ color: C.text }}>
                    {t("app.onboarding.swipe.title")}
                  </h1>
                  <p className="text-xs mt-2 max-w-xs mx-auto leading-relaxed" style={{ color: C.dim }}>
                    {t("app.onboarding.swipe.subtitle")}
                  </p>
                </div>

                {/* Progress */}
                <div className="w-full mb-4">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={card.groupId}
                      className="mono text-sm font-bold mb-1"
                      style={{ color: C.text }}
                      initial={reduced ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduced ? { opacity: 1 } : { opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                    >
                      {t(`app.onboarding.swipe.group.${card.groupId}`)}
                    </motion.div>
                  </AnimatePresence>
                  <div className="flex items-center justify-between mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.dim }}>
                    <span>
                      {t(phase === "advanced" ? "app.onboarding.swipe.section_advanced" : "app.onboarding.swipe.section_core")}
                    </span>
                    <span>
                      {t("app.onboarding.swipe.progress", { params: { current: index + 1, total: deck.length } })}
                    </span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: C.cyan }}
                      animate={{ width: `${(index / deck.length) * 100}%` }}
                      transition={spring}
                    />
                  </div>
                </div>

                {/* Card stack */}
                <div className="relative w-full" style={{ height: 360 }}>
                  {behind && (
                    <div
                      className="absolute inset-0 rounded-2xl"
                      style={{
                        backgroundColor: C.panel,
                        border: `1px solid ${C.border}`,
                        transform: "scale(0.94) translateY(14px)",
                        opacity: 0.6,
                      }}
                      aria-hidden="true"
                    >
                      <CardFace card={behind} t={t} />
                    </div>
                  )}

                  <motion.div
                    key={`${phase}-${card.key}`}
                    className="absolute inset-0 rounded-2xl overflow-hidden"
                    style={{
                      x,
                      rotate,
                      backgroundColor: C.panel,
                      border: `1px solid ${C.borderHi}`,
                      cursor: reduced ? "default" : "grab",
                      touchAction: "pan-y",
                    }}
                    drag={reduced ? false : "x"}
                    onDragEnd={onDragEnd}
                    whileTap={reduced ? undefined : { cursor: "grabbing" }}
                    initial={reduced ? false : { scale: 0.96, y: 10, opacity: 0 }}
                    animate={reduced ? {} : { scale: 1, y: 0, opacity: 1 }}
                    transition={spring}
                    role="group"
                    aria-label={t(`${card.base}.label`)}
                  >
                    <CardFace card={card} t={t} />

                    {/* Drag overlays */}
                    <motion.div
                      className="absolute top-4 left-4 mono text-sm font-bold px-2.5 py-1 rounded"
                      style={{
                        opacity: keepOpacity,
                        color: C.green,
                        border: `2px solid ${C.green}`,
                        transform: "rotate(-12deg)",
                      }}
                      aria-hidden="true"
                    >
                      {t("app.onboarding.swipe.keep")}
                    </motion.div>
                    <motion.div
                      className="absolute top-4 right-4 mono text-sm font-bold px-2.5 py-1 rounded"
                      style={{
                        opacity: tossOpacity,
                        color: C.red,
                        border: `2px solid ${C.red}`,
                        transform: "rotate(12deg)",
                      }}
                      aria-hidden="true"
                    >
                      {t("app.onboarding.swipe.toss")}
                    </motion.div>
                  </motion.div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center justify-center gap-4 mt-6">
                  <button
                    onClick={() => decide(-1)}
                    aria-label={t("app.onboarding.swipe.toss")}
                    className="flex items-center justify-center rounded-full transition"
                    style={{ width: 56, height: 56, backgroundColor: `${C.red}1A`, border: `1px solid ${C.red}59`, color: C.red }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${C.red}33`)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = `${C.red}1A`)}
                  >
                    <XIcon size={24} />
                  </button>

                  <button
                    onClick={undo}
                    disabled={index === 0}
                    aria-label={t("app.onboarding.swipe.undo")}
                    className="flex items-center justify-center rounded-full transition"
                    style={{
                      width: 44, height: 44,
                      backgroundColor: "transparent",
                      border: `1px solid ${C.border}`,
                      color: C.dim,
                      opacity: index === 0 ? 0.35 : 1,
                      cursor: index === 0 ? "not-allowed" : "pointer",
                    }}
                  >
                    <Undo2 size={18} />
                  </button>

                  <button
                    onClick={() => decide(1)}
                    aria-label={t("app.onboarding.swipe.keep")}
                    className="flex items-center justify-center rounded-full transition"
                    style={{ width: 56, height: 56, backgroundColor: `${C.green}1A`, border: `1px solid ${C.green}59`, color: C.green }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${C.green}33`)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = `${C.green}1A`)}
                  >
                    <Check size={24} />
                  </button>
                </div>

                <div className="mono text-[10.5px] mt-4 inline-flex items-center gap-1.5" style={{ color: C.dim }}>
                  <Hand size={12} /> {t("app.onboarding.swipe.hint")}
                </div>
              </motion.div>
            )}

            {/* ── Offer advanced batch ────────────────────────────────── */}
            {phase === "offer" && (
              <motion.div
                key="offer"
                className="w-full max-w-sm text-center"
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 1 } : { opacity: 0 }}
                transition={spring}
              >
                <div
                  className="flex items-center justify-center rounded-2xl mx-auto mb-5"
                  style={{ width: 72, height: 72, backgroundColor: `${C.green}1A`, border: `1px solid ${C.green}59` }}
                  aria-hidden="true"
                >
                  <Check size={34} style={{ color: C.green }} />
                </div>
                <h2 className="mono text-xl font-bold" style={{ color: C.text }}>
                  {t("app.onboarding.swipe.offer_title")}
                </h2>
                <p className="text-sm mt-3 leading-relaxed" style={{ color: C.dim }}>
                  {t("app.onboarding.swipe.offer_body", { params: { count: ADVANCED.length } })}
                </p>
                <div className="flex flex-col gap-2.5 mt-6">
                  <button
                    onClick={() => { setPhase("advanced"); setIndex(0); }}
                    className="mono text-sm font-bold px-5 py-2.5 rounded transition"
                    style={{ backgroundColor: C.cyan, color: C.bg }}
                  >
                    {t("app.onboarding.swipe.offer_yes")}
                  </button>
                  <button
                    onClick={() => setPhase("done")}
                    className="mono text-sm px-5 py-2.5 rounded transition"
                    style={{ backgroundColor: "transparent", color: C.dim, border: `1px solid ${C.border}` }}
                  >
                    {t("app.onboarding.swipe.offer_no")}
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Done ────────────────────────────────────────────────── */}
            {phase === "done" && (
              <motion.div
                key="done"
                className="w-full max-w-sm text-center"
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
              >
                <div
                  className="flex items-center justify-center rounded-2xl mx-auto mb-5"
                  style={{ width: 80, height: 80, backgroundColor: `${C.green}1A`, border: `1px solid ${C.green}59` }}
                  aria-hidden="true"
                >
                  <Sparkles size={38} style={{ color: C.green, filter: `drop-shadow(0 0 12px ${C.green}66)` }} />
                </div>
                <h2 className="mono text-2xl font-bold" style={{ color: C.text }}>
                  {t("app.onboarding.swipe.done_title")}
                </h2>
                <p className="text-sm mt-3 leading-relaxed" style={{ color: C.dim }}>
                  {t("app.onboarding.swipe.done_body", { params: { kept: keptCount, tossed: tossCount } })}
                </p>
                <div className="flex flex-col gap-2.5 mt-6">
                  <button
                    onClick={() => onComplete(decisions)}
                    className="mono text-sm font-bold px-5 py-2.5 rounded transition inline-flex items-center justify-center gap-2"
                    style={{ backgroundColor: C.red, color: "#fff" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#FF5A4A")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.red)}
                  >
                    {t("app.onboarding.swipe.done_cta")} <ArrowRight size={14} />
                  </button>
                  <button
                    onClick={() => onComplete(decisions, "where")}
                    className="mono text-sm px-5 py-2.5 rounded transition inline-flex items-center justify-center gap-2"
                    style={{ backgroundColor: "transparent", color: C.cyan, border: `1px solid ${C.cyan}59` }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${C.cyan}1A`)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <MapPin size={14} /> {t("app.onboarding.swipe.done_map")}
                  </button>
                  <button
                    onClick={startOver}
                    className="mono text-xs px-5 py-2 rounded transition inline-flex items-center justify-center gap-1.5"
                    style={{ backgroundColor: "transparent", color: C.dim, border: `1px solid ${C.border}` }}
                  >
                    <Undo2 size={13} /> {t("app.onboarding.swipe.done_restart")}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AppCredit />
      </div>

      {/* ── Confirm destructive toss ──────────────────────────────────── */}
      <AnimatePresence>
        {confirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.15 }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setConfirm(null);
            }}
          >
            <motion.div
              ref={confirmPanelRef}
              // alertdialog, not dialog: this interrupts to confirm something
              // destructive, so AT should announce it rather than wait to be asked.
              role="alertdialog"
              aria-modal="true"
              aria-label={t("app.onboarding.swipe.confirm_title")}
              tabIndex={-1}
              onKeyDown={onConfirmKeyDown}
              className="w-full max-w-sm rounded-2xl p-6 text-center"
              style={{ backgroundColor: C.panel, border: `1px solid ${C.borderHi}` }}
              initial={reduced ? false : { scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduced ? { opacity: 1 } : { scale: 0.94, opacity: 0 }}
              transition={spring}
            >
              <h3 className="mono text-lg font-bold" style={{ color: C.text }}>
                {t("app.onboarding.swipe.confirm_title")}
              </h3>
              <p className="text-sm mt-3 leading-relaxed" style={{ color: C.dim }}>
                {t("app.onboarding.swipe.confirm_body", { params: { label: t(`${confirm.base}.label`) } })}
              </p>
              <div className="flex flex-col gap-2.5 mt-6">
                <button
                  // Initial focus lands on the SAFE choice (keep the protection),
                  // never the destructive one.
                  ref={confirmKeepRef}
                  onClick={() => commit(true)}
                  className="mono text-sm font-bold px-5 py-2.5 rounded transition"
                  style={{ backgroundColor: C.green, color: C.bg }}
                >
                  {t("app.onboarding.swipe.confirm_no")}
                </button>
                <button
                  onClick={() => commit(false)}
                  className="mono text-sm px-5 py-2.5 rounded transition"
                  style={{ backgroundColor: "transparent", color: C.red, border: `1px solid ${C.red}59` }}
                >
                  {t("app.onboarding.swipe.confirm_yes")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
