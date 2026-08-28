---
name: pokemon-go-filters
description: Generate, validate, and explain Pokémon GO search filters in German. Use when (1) creating new search strings for Pokémon storage/friends, (2) explaining or debugging existing filter strings, (3) translating filter concepts from English to German syntax, (4) combining multiple conditions with AND/OR/NOT logic, (5) user mentions "Pokémon GO filter", "search string", "Suchbegriff", PvP IVs, trash filter, evolve filter, or specific filter terms like schillernd/crypto/entwickeln, (6) user pastes a filter string and asks what it does, (7) user wants to find specific Pokémon by IVs, moves, tags, or other attributes. Trigger generously for any Pokémon GO inventory management context.
---

# Pokémon GO Filter Generator

Generate and explain Pokémon GO search filters in **German** (Jesper's game language).

## Quick Start

Before generating any filter, **read the reference files**:
- `references/SYNTAX.md` — Complete German filter syntax (REQUIRED before generating)
- `references/TRANSLATION.md` — EN↔DE term mapping
- `references/PATTERNS.md` — Jesper's saved patterns with explanations
- `references/META.md` — **PvP meta, generated daily from live rankings** (see the hard rule below)
- `references/META-PVE.md` — Raid/Dynamax/regional/never-transfer lists — **hand-maintained and unverified**
- `references/POKEDEX.md` — Dex number reference (for filter by species)

## Hard rule: never write a PvP species list from memory

**Every PvP species name or dex number you put in an answer must come from
`references/pvp-meta.json`, read in this session.** Not from memory, not from a tier-list
article, not from `META.md`'s prose recalled from an earlier conversation.

1. **Check the age first.** `python3 scripts/refresh-meta.py --check` prints the snapshot date.
2. **Older than 14 days → refresh.** `python3 scripts/refresh-meta.py` pulls the current pair.
3. **Stale and unrefreshable → say so.** "I can't confirm the current meta" is a correct answer.
   Falling back on remembered tiers is not.

This rule exists because the failure already happened. This skill shipped a hand-written tier
list headed "April 2026 / GBL Season 26". Four months later its entire Great League S-tier had
fallen out of the live top 30, it named none of the then-current top five, and one of those
five had not even been GBL-legal when the list was written. Nothing flagged any of it; the list
simply read as authoritative while being wrong.

Note that this paragraph deliberately names no species. It is prose, and it is not regenerated —
so any list it contained would go stale exactly the way the list it describes did, inside the
section telling you not to trust prose. **For who is actually meta right now, read
`references/pvp-meta.json`.** `META.md` is generated from the same snapshot the
pogo.filter.workshop app builds its filters from, so the two can no longer disagree.

The same rule in one line: **PvP species lists are data, never prose.**

## Critical Quirk: Operator Precedence

Pokémon GO has **inverted precedence** compared to standard boolean logic:
- `,` (OR) binds **tighter** than `&` (AND)
- `A&B,C` means `A & (B OR C)`, NOT `(A & B) OR C`

**This breaks intuition constantly.** Example:
```
# WRONG interpretation of what this returns:
0*,1*,2*&!schillernd
# User thinks: "(0* OR 1* OR 2*) AND !schillernd"
# Actual: "0* OR 1* OR (2* AND !schillernd)"
```

**Workaround:** Jesper has a parentheses-aware converter tool. When building complex filters, output **parenthesized form** that the converter can process:
```
(0*,1*,2*)&(!schillernd)
```

For simple filters where precedence doesn't matter (single condition, no mixing AND/OR), use native syntax directly.

## Conceptual Foundations

The *why* behind common filter patterns. Read this before generating PvP, Master League, or Crypto filters — the wrong mental model produces filters that look right but miss the point.

### Why PvP IV filters target low attack (GL/UL only)

Great League and Ultra League are **CP-capped** (1500 / 2500). The CP formula weights attack roughly twice as heavily as defense or HP. At a hard cap, **lower attack lets the same Pokémon reach a higher level before hitting the cap**, which means more total stat product (defense × HP × the now-higher level multiplier) — a "bigger" Pokémon at the same CP.

That's why `0angriffs-wert&3-4verteidigungs-wert&3-4kp` (rank-1 search) is the canonical PvP filter: it minimises the stat that costs you headroom and maximises the two that don't.

### Master League is uncapped — the bulk-fitting trick doesn't apply

ML has no CP cap, so there's no "fit more stats under the ceiling" mechanic. You just want the highest raw stat product → **3*+ or 4* IVs are the right cut, with 4* (hundo) aspirational, not required.** A 3* with the right species crushes a hundo of the wrong species.

For ML filters: use `3*,4*` (or just `4*` if you're being picky), **not** `0angriffs-wert` style filters. Low attack is a handicap here, not an advantage.

### Crypto / Shadow constraints

Three hard rules that change which filter intersections are meaningful:

1. **Crypto can never be traded.** Shadows are bound to their original trainer. Therefore:
   - `crypto&glücks` is always empty (lucky requires trade).
   - `crypto&getauscht` is always empty.
   - (Shadows *can* be XXL or XXS — those are size designations independent of trade history.)

2. **Crypto can never Mega Evolve.** `crypto&megaentwicklung`, `crypto&mega1`, `crypto&mega0` are all always empty. Mega forms are blocked for shadows.

3. **Frustration is a legacy move.** Shadows caught outside a Rocket takeover have **Frustration** as a charged move that can only be removed via Charged TM during a takeover event. Frustration matches `@spezial` (it's a legacy/event move), so:
   - `crypto&@Frustration` — shadows that **still have** Frustration → not yet improved, safe to release if IVs are bad.
   - `crypto&!@Frustration` — shadows where Frustration has been TM'd away → **combat-ready, your investment**.
   - `crypto&@spezial` is broader: it matches Frustration *and* every other legacy move (Psystrike, Hydro Cannon CD, etc.). For surgical "is this an unimproved shadow" filtering, prefer `@Frustration` over `@spezial` — using `!@spezial` to find combat-ready shadows would also exclude shadows carrying other legacy moves.

   Practical implication for trash filters: a `!@spezial` clause protects shadows that still have Frustration as a side effect. That's usually fine (errs on the side of keeping shadows), but if you want to release unimproved shadows specifically, `crypto&@Frustration&<low IV clauses>` is the precise tool.

## Workflow

### 0. Check SYNTAX.md for Operator Conventions You Might Misremember
Particularly:
- `+` is a **prefix**, not a suffix: `+113` not `113+`
- `+` means "entire evolution family" — combines the species AND its evos/pre-evos into one set
- **Range vs negation behavior for non-existent attributes** differs — `dynawall-2` rejects Pokémon with no wall value; `!dynawall3` accepts them
- **Capability vs investment distinction** for multi-level attributes (see SYNTAX.md "Attributes & Status")

### 1. Understand the Goal
Ask clarifying questions if needed:
- What Pokémon should be **shown** vs **hidden**?
- Is this for mass transfer, evolving, PvP selection, trading?
- Any special protections needed (shinies, favorites, hundos)?

### 2. Consult References
Read `references/SYNTAX.md` to verify filter terms exist and their exact German spelling.

### 3. Build via Set-Theoretic Method
For any non-trivial filter (3+ `&`-clauses, or mixing species lists with attribute guards), use the method in [Set-Theoretic Construction](#set-theoretic-construction-method) below. Don't skip this for multi-clause filters — it's the difference between a filter that works and a filter that silently widens your match set.

For simple filters (single condition, no AND/OR mixing), go straight to writing.

### 4. Verify Each Clause's Set-Theoretic Contribution
Before delivery:
- For each `&`-clause, state in one sentence what set it intersects.
- Run a Python oracle with 4–8 edge cases (see method below).
- Do NOT add "safety" terms without checking they don't widen the set.

### 5. Explain the Logic
Always provide:
- The filter string
- Plain-language explanation of what it matches
- Any gotchas or limitations

### 6. Check for Precedence Issues
If the filter mixes `,` and `&`, output both:
- Parenthesized form (for converter)
- Native form (if precedence works out)

---

## Set-Theoretic Construction Method

**Use this for any filter with 3+ `&`-clauses or mixing species lists with attribute guards.** Pokémon GO filter syntax is natively an **AND of ORs** (CNF — conjunctive normal form): every `&`-clause must be expressible as a pure comma-OR. Thinking in sets makes this tractable; thinking in prose does not.

### Step 1 — Define sets explicitly

Name every concept as a set using Python-style notation. Keep names short. Typical sets for a Dyna/Giga filter:

```python
# Species lists
T_g  = {818, 94, 99, 812, 815, 68, 6, 3, 9}   # Giga attackers worth maxing
T_d  = {888, 889, 890, 242, 113, 530, 475, 381, 555, 376}  # Dyna top tier (non-Giga)
A    = {818, 94, 99, 812, 815, 68, 6, 3, 9, 888, 530, 475, 381, 555, 376, 890}  # attacker role
Tk   = {889, 131, 143, 242, 113}  # tank role
H    = {242, 113}                 # healer role

# Attribute flags
G    = "gigadynamax"   # can Giga
S3   = "3*+ IVs"       # 3* or better
U    = "dynamax"       # Dyna-capable

# State predicates
I    = dynaattacke2- ∪ dynawall1- ∪ dynakampfgeist1-   # invested beyond default
A_max  = dynaattacke3   # attacker stat maxed
Tk_max = dynawall3      # tank stat maxed
H_max  = dynakampfgeist3  # healer stat maxed
```

### Step 2 — Write the desired kept set as a boolean expression

Use `∩` (AND), `∪` (OR), `¬` (NOT). This is your source of truth.

```
Keep = U
     ∩ (T_g ∪ T_d ∪ I)                        # worth pushing at all
     ∩ (G ∪ T_d ∪ I ∪ ¬T_g)                   # if in T_g, must be Giga (or already invested)
     ∩ (S3 ∪ G ∪ I ∪ ¬T_d)                    # if in T_d, must be 3*+ (or already invested)
     ∩ ¬(A ∩ A_max ∩ ¬Tk ∩ ¬H)                # skip attacker-role species with maxed attack
     ∩ ¬(Tk ∩ Tk_max ∩ ¬A ∩ ¬H)               # skip tank-role with maxed wall
     ∩ ¬(H ∩ H_max ∩ ¬A ∩ ¬Tk)                # skip healer-role with maxed spirit
```

### Step 3 — Convert to CNF (AND of ORs)

Every `&`-clause in a filter is a pure OR-list. If a clause needs an intersection, split it into separate `&`-clauses. De Morgan's laws apply:
- `¬(A ∩ B)` = `¬A ∪ ¬B` — this is a comma-OR clause with negated terms
- `¬(A ∪ B)` = `¬A ∩ ¬B` — this is TWO separate `&`-clauses

### Step 4 — Write a Python oracle BEFORE shipping

Disposable, in-conversation. 5–10 lines. Use `frozenset` for species, test 4–8 edge cases as a table.

```python
T_g = frozenset({818, 94, 99, 812, 815, 68, 6, 3, 9})
T_d = frozenset({888, 889, 890, 242, 113, 530, 475, 381, 555, 376})
A   = T_g | {888, 530, 475, 381, 555, 376, 890}
Tk  = frozenset({889, 131, 143, 242, 113})
H   = frozenset({242, 113})

def keep_desired(mon):
    U = mon["dyna"]
    G = mon["giga"]
    S3 = mon["stars"] >= 3
    I  = mon["atk_lvl"] >= 2 or mon["wall_lvl"] >= 1 or mon["spirit_lvl"] >= 1
    dex = mon["dex"]
    if not U: return False
    if dex not in (T_g | T_d) and not I: return False
    if dex in T_g and not (G or I): return False
    if dex in T_d and not (S3 or G or I): return False
    if dex in A and mon["atk_lvl"] == 3 and dex not in Tk and dex not in H: return False
    if dex in Tk and mon["wall_lvl"] == 3 and dex not in A and dex not in H: return False
    if dex in H and mon["spirit_lvl"] == 3 and dex not in A and dex not in Tk: return False
    return True

# Test cases: (label, dex, dyna, giga, stars, atk, wall, spirit, expected)
cases = [
    ("Fresh Charizard (T_g, no Giga)",     6, True, False, 2, 1, 0, 0, False),
    ("Fresh Giga Charizard",               6, True, True,  2, 1, 0, 0, True),
    ("Invested Charizard, no Giga",        6, True, False, 2, 2, 0, 0, True),
    ("Fresh Zacian 2*",                  888, True, False, 2, 1, 0, 0, False),
    ("Fresh Zacian 3*",                  888, True, False, 3, 1, 0, 0, True),
    ("Maxed attack Machamp",              68, True, True,  3, 3, 0, 0, False),
    ("Blissey maxed spirit",             242, True, False, 3, 1, 0, 3, False),
    ("Non-Dyna Garchomp",                445, False, False, 4, 0, 0, 0, False),
]
for label, dex, dyna, giga, s, a, w, sp, exp in cases:
    mon = {"dex": dex, "dyna": dyna, "giga": giga, "stars": s,
           "atk_lvl": a, "wall_lvl": w, "spirit_lvl": sp}
    got = keep_desired(mon)
    print(f"{'✓' if got == exp else '✗'} {label}: got={got} expected={exp}")
```

The oracle is **disposable** — it lives in the conversation, not in a module. Its job is to pin down semantics before string-building.

### Step 5 — Translate CNF clauses to filter syntax

For each CNF clause, write the comma-OR. Verify each term's set contribution as you go. Do **not** toss in extra terms for "safety" without checking — `gigadynamax` added to clause 2 would widen the match to all Giga species, not just top-Giga.

### De Morgan Traps

These are the specific traps that cost iterations. Know them cold.

**Trap 1 — Cannot negate a union inside a comma-OR.**
`!+818,!+94` does NOT mean "not in {818, 94}." It means `¬818 ∪ ¬94`, which is trivially true for every Pokémon (every Pokémon is not-818 OR not-94). De Morgan requires `¬A ∩ ¬B`, which is **a separate `&`-clause per term**:
```
# WRONG: "neither 818 nor 94"
!818,!94

# RIGHT:
!818&!94
```

**Trap 2 — Workaround via disjoint-set identities.**
Sometimes you want `¬X` but can't express it cleanly. If domain knowledge tells you `T_d ∩ G = ∅` and `T_d ∩ T_g = ∅`, then `(S3 ∪ G ∪ T_g ∪ I)` correctly implies "if the Pokémon is in T_d, it must be S3 or I." The pattern: **replace `¬X` with the positive conditions known to imply `¬X` within the universe of interest.**

**Trap 3 — Per-species exclusion as last resort.**
`¬(A ∩ A_max)` can be expanded to `|A|` separate `&`-clauses of `!species,!move_max`, one per species. This works — but it costs characters proportional to `|A|`. Fine in most cases given the 5000-char budget; only worth avoiding when `|A|` exceeds a few hundred species.

### Character Budget

The search bar accepts up to **~5000 characters** (empirically verified). This is plenty for most filters — even multi-clause role filters with full S+A+ tier species lists fit comfortably. Compression is rarely needed, but when it is:

1. **Drop `+` when Dyna-capability already filters pre-evos.** Pre-evos aren't Dyna-capable, so clause 1 (`dynaattacke1-`) already excludes them. `+68` is equivalent to `68` in a Dyna context.
2. **Simplify overlapping clauses.** If clause 3 handles the Giga guard, clause 4's T_g list may be redundant.
3. **Replace negative role-max clauses with `!dynaXX3`** instead of `dynaXX-2` (see Trap 4 below).
4. **Last resort: split into two saved searches.** You have 12 favorite slots. Only relevant for filters approaching the 5000-char ceiling.

**Trap 4 — Range syntax is fail-closed for non-existent values.**
`dynawall-2` (range "≤2") **fails to match** Pokémon where wall doesn't exist at all. A fresh Chansey has no `dynakampfgeist` value, and `dynakampfgeist-2` rejects her. `!dynakampfgeist3` (explicit negation) correctly matches — "not at level 3" is trivially true when no value exists. **Rule: for role-maxed exclusion guards, prefer `!dynaXX3` over `dynaXX-2`.**

---

## Common Patterns

### PvP IV Filters
```
# Strict PvP (0 Atk, 15 Def, 15 HP)
0angriffs-wert&4verteidigungs-wert&4kp

# Loose PvP (0-1 Atk, high Def/HP)
0-1angriffs-wert&3-4verteidigungs-wert&3-4kp
```

Note: IV ranges use 0-4 scale:
- 0 = 0 IV
- 1 = 1-5 IV
- 2 = 6-10 IV
- 3 = 11-14 IV
- 4 = 15 IV (perfect)

### Trash Filters
See `references/PATTERNS.md` for Jesper's comprehensive trash filter with explanations.

### Evolution Filters
```
# Can evolve now with enough candy
entwickeln

# New dex entries only
neueentwicklung

# Can evolve for new dex AND has candy
entwickeln&neueentwicklung
```

## Meta-Aware Filtering

The meta material is split by how trustworthy it is. Do not treat the two halves alike.

**`references/META.md` + `references/pvp-meta.json` — PvP, generated, trustworthy.**
Regenerated from `src/data/pvp-rankings.json` in the
[pogo-filter-workshop](https://github.com/JesperDramsch/pogo-filter-workshop) repo, in the same
CI job that syncs the snapshot from [PvPoke](https://github.com/pvpoke/pvpoke). Carries, per
league and per active cup: ranked species with German and English names, dex numbers, which
*form* actually ranks (Shadow Quagsire, Galarian Corsola), PvPoke scores, and a
**ready-made filter string in DE and EN produced by the app's own builder**.

For a plain "give me a Great League filter" request, **quote the filter string** out of
`pvp-meta.json` — do not compose one. It is the app's own output; a hand-composed one is a
second thing that can drift.

The JSON also carries `gameMasterWatch`. If `lastChangeAt` is recent, a move rebalance has
landed and the rankings have not caught up yet — say so rather than presenting them as settled.

**`references/META-PVE.md` — raids, Dynamax, regionals, never-transfer. Hand-maintained,
unverified, April 2026.** No refresh mechanism and no check. Usable as a starting point; label
it as unverified whenever you lean on it. Raid counters and regionals are actually generated
inside the app from `src/data/raid-bosses.json` and `src/data/regional-forms.json` — prefer
those where they disagree.

See `references/PATTERNS.md` for the canonical, verified Dyna/Giga filter built using the set-theoretic method.

## Output Format

When generating a filter, provide:

```
**Filter:** `<the filter string>`

**What it finds:** <plain language explanation>

**Gotchas:** <any edge cases or limitations>
```

If complex, also provide:
```
**Parenthesized (for converter):** `<parenthesized version>`
```

## Key Gotchas to Remember

1. **Operator precedence:** OR binds tighter than AND — verify complex filters work as intended
2. **Shortcut collisions:** `mega`, `count`, `dynamax` trigger internal expansions that break searches
3. **Source tracking cutoff:** Origin filters only work for Pokémon caught after October 2020
4. **German `Anzahl`:** Appears in suggestions but does NOT work — no workaround
5. **evolvenew gender bug:** May show wrong gender as eligible for gender-locked evolutions
6. **~5000 char limit:** Very long strings may need splitting, but this is rarely needed (see Character Budget)

## Failure Modes

Recurring mistakes when building filters. Check this list before delivery.

- **Adding "safety" terms without checking set-theoretic contribution.** A bare `gigadynamax` thrown into a species OR-list widens the match set to all Giga species, not just top-Giga. Every term in every clause should have a stated set contribution.
- **Assuming range syntax handles missing values.** It doesn't for Dyna attributes. Use negation. `!dynawall3` not `dynawall-2` for exclusion guards.
- **Negating a union inside a comma-OR.** `!A,!B` is trivially true. De Morgan: use `!A&!B` as separate clauses.
- **Guessing at syntax instead of reading SYNTAX.md.** The cost of misremembering `+` prefix vs suffix is real. Check the reference.
- **Verifying the filter AFTER delivery instead of during construction.** Discipline: verify each clause's contribution as you add it. The Python oracle is cheap — write it during Step 4 of the workflow, not after.
- **Using `+` habitually.** `+species` includes the evolution family. If the rest of the filter already excludes pre-evos (e.g., via `dynaattacke1-`), `+` is redundant and costs characters.

## Reference Links

### Authoritative Source
- **[pogo-filter-workshop](https://github.com/JesperDramsch/pogo-filter-workshop)** — the PvP meta
  chain: PvPoke (MIT) → `src/data/pvp-rankings.json` → `references/pvp-meta.json`. Refresh with
  `python3 scripts/refresh-meta.py`. The repo's `CLAUDE.md` carries the same data-never-prose rule.
- **[Leidwesen's Translation Spreadsheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vSQubiAFnRgCUp9BSJaCq0-XSGU0-x3LvOwzWdAj-JlrXsdkBWrGrlfmvFmGcbjUnCa5XFSnv4C1Nzs/pubhtml?gid=1236962912)** — THE definitive reference for all filter translations, extracted from game files

### Community Tools
- [Leidwesen's SearchPhrases](https://leidwesen.github.io/SearchPhrases/) — Comprehensive syntax documentation
- [Phrase Translator](https://leidwesen.github.io/PhraseTranslator/) — Auto-translate EN↔DE filter strings
- [Lebeg134's Converter](https://mongo.lebeg134.hu/) — Parentheses to native syntax converter
- [PvPIVs.com](https://pvpivs.com/searchStr.html) — Species-specific PvP IV search strings

### Reference Materials
- [Pokewiki Pokémon-Liste](https://www.pokewiki.de/Pokémon-Liste) — German names ↔ dex numbers
- [Niantic German Help](https://niantic.helpshift.com/hc/de/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/?l=de) — Official (incomplete) German reference
