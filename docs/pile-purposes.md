# Pile purposes

One row per Sorting pile: the question you're asking when you open it, and
the ① keep steps. Read the steps top to bottom and stop once you have enough.
③ (pile & protection tail) stays the same everywhere.

## Building blocks

| Step | Filter | Notes |
|---|---|---|
| 4\* | `4*` | hundos |
| shiny | `shiny` | right after 4\* in every ladder: plain shinies aren't protected in ③ |
| 3-4 | `3-4attack&3-4defense&3-4hp` | no weak stat (11+ in each) |
| 3\* | `3*` | 82 % or better |
| 4\*,3\* | `4*,3*` | one step when the pile has a job that comes first |
| PvP | loose pattern per league, under each CP cap | the same clause the meta pile uses today |
| still to evolve | `evolve` | keep one to evolve through |

**Default count:** 1 per stage of the line, plus 3 untraded ones to trade.
A row only names a count when it differs. Each count is a budget, so you can
change it.

Correction: the protection tail does **not** keep plain shinies, costumes or
backgrounds out of ③. It only protects shiny legendaries and legendaries with
a background. A shiny that isn't favourited or tagged shows up in ③.
Your custom collectibles aren't in the tail either: sorting offers them in
③ like any other species, so favourite or tag the ones you keep.

Rule: a step must be able to find something no earlier step found. A
narrower copy of an earlier step gets cut. `4*` sits inside `3-4`, so `4*`
then `3-4` is fine (best first, then wider), but `3-4` then `4*` would be cut.

## Piles

| Pile | The question | ① keep, top to bottom |
|---|---|---|
| Event | What's worth keeping from this event? | 4\* → shiny → 3-4 → 3\* |
| Costumes that evolve (`costume&evolve`) | Which hats to keep for the whole line? | 4\* → shiny → 3-4 → 3\*, default count |
| Costumes that don't (`costume&!evolve`) | Which hats to keep? | 4\* → shiny → 3-4 → 3\*, one plus up to 3 untraded ones to trade |
| Backgrounds (`background`) | Which backgrounds stay? | 4\* → shiny → 3-4 → 3\*, default count |
| Community Days | Hundreds of one species after a Community Day: which stay, which go to trades? | 4\* → shiny → background → 3-4 → 3\* → untraded (tag to trade), over every catch of every Community Day species at once |
| XXL | Which one goes to a showcase? | showcase verdict → still to evolve → 4\*,3\* → shiny |
| XXS | Which tiny ones still matter? | still to evolve → 4\*,3\* → shiny |
| Luckies | Which luckies are worth the cheap power-up? | still to evolve → 4\*,3\* → shiny |
| Received trades | Can't be traded again: which ones stay? | 4\* → shiny → lucky → 3-4 → 3\* → PvP → still to evolve |
| Shadows | Which shadows to keep, purify or TM? | 4\* → shiny → meta → 3\* → `3-4attack` → PvP → still to evolve, keep 2 (one stays shadow, the second is purified and evolved up the line) |
| Dynamax | Which Max ones are worth the Max Particles? | G-max → Max attacker roster → 4\* → shiny → 3-4 → 3\* |
| Ready to evolve | What do I evolve now? | new Pokédex entry: 4\* → shiny → 3-4 → 3\*, then tagged Dex-Evolve |
| Meta | Raid and PvP keepers, top 7 per type | 4\* → shiny → 3-4 → 3\* → PvP, up to the meta budget |
| Watchlist | Not meta yet, something's brewing | same as meta, up to the watchlist budget |
| Non-meta | Everything else | same as meta, up to the non-meta budget |
| Legendaries & Ultra Beasts (`legendary,ultrabeast`) | Raided one all weekend: which ones stay? | 4\* → shiny → 3-4 → 3\*, up to the meta or non-meta budget of that species |
| Hundo sort | Got a hundo: which copies can go? | 4\* → shiny → 3-4 → 3\* |

Lucky families goes: luckies are luckies.

## Utility filters beside their pile

These stay as filters you copy, not keep steps:
- **Shadows:** cheap purify (`candykm1`, not meta), and the Frustration TM on meta shadows.
- **Ready to evolve:** cheap XP evolves (the trade evolutions are named in it species by species, so it covers `tradeevolve`), and mega-evolve as its own tile.

## Settled

- **Shadows, purify then evolve:** a keep step. It keeps a second shadow of
  a line that can still evolve, to purify and evolve up the line. The search
  term is the same `shadow&evolve` as "still to evolve", so the step keeps
  2 of them instead of 1.
- **4\* then 3-4:** two steps, so the hundos turn up first.
- **Shiny step:** right after 4\* (or after the first combined IV step).
- **Community Day list:** stays; it feeds the Community Days pile.
- **Legendaries:** where one came from doesn't matter (raid, research,
  GBL). The pile keeps the good ones up to the budget.

## Not covered here

The Catching, Battle and Trade filters predate this PR. They get the same
treatment as a separate pass.
