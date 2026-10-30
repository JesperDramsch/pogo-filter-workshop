# Pile purposes

One row per Sorting pile: the question you're asking when you open it, and
the ① keep steps. Read the steps top to bottom and stop once you have enough.
③ (pile & protection tail) stays the same everywhere.

## Building blocks

| Step | Filter | Notes |
|---|---|---|
| 4\* | `4*` | hundos |
| 3-4 | `3-4attack&3-4defense&3-4hp` | no weak stat (11+ in each) |
| 3\* | `3*` | 82 % or better |
| 4\*,3\* | `4*,3*` | one step when the pile has a job that comes first |
| PvP | loose pattern per league, under each CP cap | the same clause the meta pile uses today |
| still to evolve | `evolve` | keep one to evolve through |

Shiny, costume and background are left out of every ladder: the protection
tail already keeps them out of ③.

Rule: a step must be able to find something no earlier step found. A
narrower copy of an earlier step gets cut. `4*` sits inside `3-4`, so `4*`
then `3-4` is fine (best first, then wider), but `3-4` then `4*` would be cut.

## Piles

| Pile | The question | ① keep, top to bottom |
|---|---|---|
| Event | What's worth keeping from this event? | 4\* → 3-4 → 3\* |
| Costumes | Too many hats: which ones stay? | 4\* → 3-4 → 3\* |
| CD backgrounds | Which background ones stay (3 per species)? | 4\* → 3-4 → 3\* |
| XXL | Which one goes to a showcase? | showcase verdict → still to evolve → 4\*,3\* |
| XXS | Which tiny ones still matter? | still to evolve → 4\*,3\* |
| Luckies | Which luckies are worth the cheap power-up? | still to evolve → 4\*,3\* |
| Received trades | Can't be traded again: which ones stay? | 4\* → lucky → 3-4 → 3\* → PvP → still to evolve |
| Shadows | Which shadows to keep, purify or TM? | 4\* → meta → 3\* → `3-4attack` → PvP → still to evolve |
| Dynamax | Which Max ones are worth the Max Particles? | G-max → Max attacker roster → 4\* → 3-4 → 3\* |
| Ready to evolve | What do I evolve now? | new Pokédex entry: 4\* → 3-4 → 3\*, then tagged Dex-Evolve |
| Meta | Raid and PvP keepers, top 7 per type | 4\* → 3-4 → 3\* → PvP, up to the meta budget |
| Watchlist | Not meta yet, something's brewing | same as meta, up to the watchlist budget |
| Non-meta | Everything else | same as meta, up to the non-meta budget |
| Legendaries | Raided one all weekend: which ones stay? | 4\* → 3-4 → 3\*, up to the meta or non-meta budget of that species |
| Hundo sort | Got a hundo: which copies can go? | 4\* → 3-4 → 3\* |

Lucky families goes: luckies are luckies.

## Utility filters beside their pile

These stay as filters you copy, not keep steps:
- **Shadows:** purify first, then evolve (shadows worth purifying because the purified one evolves cheaper), and cheap purify (`candykm1`, not meta). Also the Frustration TM on meta shadows.
- **Ready to evolve:** cheap XP evolves, and mega-evolve as its own tile.

Candidates for more, from the game's own search keywords. I can't test what
they match from here, so each one needs a check in the game first:
- `tradeevolve`: species that evolve for free after a trade. These go beside
  Received trades and Ready to evolve: trade them first.
- `raid`: caught in a raid. This would let the Legendaries pile split raid
  catches from research ones.
- `duplicate`: species you hold more than one of. If it does what the name
  says, it could make every pile skip species you only have once.

## Two readings to confirm

1. **Shadows, "purify still evolve":** I read it as the purify-then-evolve
   utility above, not as a keep step. Right?
2. **4\* and 3-4 together:** as one step, the pair is just `3-4`, because
   every hundo already matches it. I kept `4*` as its own first step, as in
   your list, so the hundos turn up first.

## Not covered here

The Catching, Battle and Trade filters predate this PR. They get the same
treatment as a separate pass once this sheet is settled.
