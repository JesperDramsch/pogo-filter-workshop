# Pile purposes

One row per Sorting pile: the question you're asking when you open it, and
the ① keep steps. Read the steps top to bottom and stop once you have enough.
③ (pile & protection tail) stays the same everywhere.

## The default ladder

Unless a row says otherwise, ① is:

1. **special:** shiny (plus costume and background where it matters)
2. **4\*:** hundos
3. **3-4 all:** no weak stat (`3-4attack&3-4defense&3-4hp`, every stat 11+)
4. **3\*:** 82 % or better; the fallback for when 2 and 3 found nothing

Rule: a step must be able to find something no earlier step found. A
narrower copy of an earlier step gets cut. That is the test that would have
caught the evolve duplicate.

## Piles

| Pile | The question | ① keep, top to bottom | vs. now |
|---|---|---|---|
| Event | What's worth keeping from this event? | ladder | the "two 4-bars" step goes, 3\* comes in |
| Costumes | Too many hats: which ones stay? | ladder | `costume&evolve` cut |
| CD backgrounds | Which background ones stay (3 per species)? | ladder | was one step that kept them all |
| XXL | Which one goes to a showcase? | special → calculator verdict → 4\* → 3\* | special added |
| XXS | Which tiny ones still matter? | special → one still to evolve → 4\* | special and 4\* added |
| Luckies | Which luckies are worth the cheap power-up? | special → 4\* → meta species → 3\* | was just `3*,4*` |
| Lucky families | Did a lucky one turn up for a family on my list? | lucky | no change |
| Received trades | Can't be traded again: which ones stay? | special → lucky → 4\* → PvP pattern | low-IV step becomes an explicit PvP step (see Q1) |
| Shadows | Which shadows to keep, purify or TM? | special → meta species → 4\* → 3-4 all | "TM done" stops being a keep step |
| Dynamax | Which Max ones are worth the Max Particles? | special → G-max → Max attacker roster → 4\* → 3-4 all | "unlevelled" step cut (Q3) |
| Ready to evolve | What do I evolve now? | new Pokédex entry → tagged Dex-Evolve | the dex+ copy is cut |
| Meta | Raid and PvP keepers among the top 7 per type | special → 4\* → raid: 3-4 all → PvP: loose pattern per league | "every meta shadow" becomes "meta shadow & 3-4 all" (Q2) |
| Watchlist | Not meta yet: keep a few just in case | special → 4\* → 3\* | no change, just reordered |
| Non-meta | Everything else | special → 4\* → PvP loose | no change |
| **Legendaries** (new) | Raided one all weekend: which ones stay? | special → 4\* → meta: 3-4 all, up to the raid budget → 3\* | new pile; floats into "Right now" after a legendary raid event (Q5) |
| Hundo sort | Got a hundo: which 3\* copies of it can go? | as now | no change |

Extras that stay beside their pile, as filters you copy, not keep steps:
- **Shadows:** cheap purify (`candykm1`, not meta) and the Frustration TM on meta shadows.
- **Ready to evolve:** cheap XP evolves, and mega-evolve as its own tile.

## Your call

1. **Received trades:** a trade re-rolls IVs, so low-attack ones can be Great
   League gold. Keep a PvP step there, or leave PvP to the meta and non-meta
   piles?
2. **Meta shadows:** today every meta shadow is kept whatever its IVs. Cut
   that to 3-4 all, or keep all of them because shadows are rare?
3. **Dynamax:** is "not levelled yet" a reason to keep one, or just noise?
4. **Shadow "purify to hundo":** the search can't tell 11 from 13 (both show
   as bar 3), so the step can't promise a hundo after purifying. Rename it
   "purify to near-hundo", or drop it?
5. **Legendaries:** one pile for every legendary, or one per boss (Mewtwo
   after its raids)? I'd go with one per boss, floated after the event:
   that's when the stack exists. Raid catches never go below 10 in any stat,
   so "3-4 all" (11+ in every stat) is the cut that actually separates them.

## Not covered here

The Catching, Battle and Trade filters predate this PR. They get the same
treatment as a separate pass once this sheet is settled.
