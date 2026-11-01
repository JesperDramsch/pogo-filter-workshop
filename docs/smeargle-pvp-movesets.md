# Smeargle PvP movesets

Research behind the Smeargle moveset protection and finder (`protectSmeargleMovesets`,
`smeargleChargedMoves`, `SMEARGLE_FAST_MOVE` in `src/App.jsx`). Collected 2026-11-01.

## How Smeargle learns moves

Smeargle (Farbeagle, dex 235) has no move pool of its own. It learns its moves by
photobombing a GO Snapshot: it copies the photographed Pokémon's fast move and its
**first** charged move, and it never holds a second charged move. So a Smeargle set is
one fast move plus one charged move, and the Pokémon in the photo decides both. The
app's legacy-move protection carves Smeargle out on purpose (every Sketched move carries
the `@special` flag, so without the carve-out every Smeargle would be protected); this
feature puts back exactly the Smeargle worth keeping.

## Where it is playable

Smeargle reaches 487 CP at level 50, which keeps it out of every open league. It cannot
evolve, so it is not eligible for Little Cup, and it has been banned intermittently from
Little Jungle Cup and from the Holiday Cup Little Edition. The format it is ranked for is
the open 500 CP cup. This is a collector and tournament feature, not a ladder one, and
the help copy says so.

## Ranking in the open 500 CP format

PvPoke's ranking for the Holiday Cup Little Edition (December 2024), as reported by
Sportskeeda, orders Smeargle's sets:

1. Incinerate + Flying Press.
2. Lock-On + Flying Press. Maximum energy generation, the best set in the mirror and
   against Team GO Rocket; Stadium Gaming's "smeargle-photobomb-candidates" list is built
   around it.
3. Counter + Flying Press. Counter was rebalanced on 2024-09-03 to 6 energy, which
   dropped it below Lock-On.

Special cases:

- Lock-On + Techno Blast (Normal) when Fighting-type moves are banned.
- Thunder Shock + Flying Press, learnt from Pikachu Libre.
- Lock-On or Shadow Claw + Shadow Ball against Wobbuffet.

## What the app models

Only the Lock-On family is in scope: one fixed fast move, Lock-On, and a user-editable
list of charged moves seeded with Flying Press and Techno Blast. A Smeargle matches when
it has Lock-On **and** any one of the listed charged moves. Incinerate sets can be added
later as their own entry; the app deliberately does not build a fast-move list, because a
fast list times a charged list would also match crosses nobody asked for.

Output shape, in the output locale with move names from the `move.*` glossary
(lowercased, whitespace collapsed, hyphens kept, no slot prefix, the Max-tank charger
convention):

- Protection, one clause per charged move, in trash, trade, buddy-catch and every Sorting
  pile's protection tail: `!farbeagle,!@zielschuss,!@flyingpress`. Keep unless Smeargle
  with Lock-On and that charged move. One clause naming every charged move would demand
  all of them, which a Smeargle cannot carry.
- Finder, Battle area, expert mode: `farbeagle&@zielschuss&@flyingpress,@techblaster`.

Config stores the charged moves as canonical lowercase EN move names (`flying press`,
`techno blast`), the way species lists store canonical species names; a move typed in
any of the seven locales resolves through `moveKeyFromKeyword` in
`src/i18n/pogo-keywords.js`.

## Verified names

Move names come from the per-locale `move.*` keys (holoholo-text via
`scripts/fetch-translations.mjs`). German names cross-checked against PokéWiki on
2026-11-01: Zielschuss = Lock-On, Einäschern = Incinerate, Konter = Counter,
Techblaster = Techno Blast, Donnerschock = Thunder Shock, Flying Press = Flying Press.

## Open bound

The bare `@move` form and the whitespace collapse are the app's shipped conventions
(`@frustration`, `@1mudshot`), but no in-game test of a two-word charged move such as
`@flyingpress` exists yet. The verify panel leaves `@` move terms unknown by design.

## Sources

- PvPoke rankings, Holiday Cup Little Edition (December 2024), via Sportskeeda's
  "Best Smeargle moveset" write-up.
- Stadium Gaming, "smeargle-photobomb-candidates".
- Niantic's 2024-09-03 move rebalance (Counter to 6 energy).
- PokéWiki for the German move names.
