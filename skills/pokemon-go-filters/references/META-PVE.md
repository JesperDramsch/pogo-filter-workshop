# Pokémon GO PvE / Collection Reference — HAND-MAINTAINED, UNVERIFIED

> ⚠️ **Read this banner before quoting anything below.**
>
> This file is the non-PvP remainder of the old `META.md`, carried over **verbatim**. It was
> hand-written and last verified in **April 2026, against GBL Season 26**. Nothing regenerates
> it and nothing checks it. Treat every number here as a hypothesis, not a fact.
>
> For scale of the drift this kind of file accumulates: the PvP tables that used to live
> alongside these had gone badly wrong within four months — their entire Great League S-tier
> (Azumarill, Galarian Stunfisk, Medicham) had dropped out of the live top 30. Those tables are
> now generated into `META.md` instead. These have had no such correction.
>
> **Where the real data lives.** Several sections below are already automated in the
> [pogo-filter-workshop](https://github.com/JesperDramsch/pogo-filter-workshop) app, which
> derives them from synced snapshots rather than from a list:
>
> | Section below | Automated source |
> |---|---|
> | Raid attackers by type | `src/data/raid-bosses.json` + `src/data/meta-rankings.json` (counters are generated in-app) |
> | Regionals | `src/data/regional-forms.json` (KMZ-driven regional map) |
> | Dynamax / Gigantamax | `src/data/meta-rankings.json` `topMaxAttackers` (partly — the eligibility seed is still hand-maintained) |
> | Never-transfer / legacy moves | not automated; see `docs/gbl-collection-research.md` |
>
> Prefer the app's output over these tables wherever the two disagree.
>
> The old "Quick Reference: Combined Filter Lists" section was dropped rather than carried over:
> half of it was the stale PvP dex lists, and a combined block invites copying the stale half
> along with the rest. PvP lists now come from `META.md` / `pvp-meta.json`.

---

## Raid Attackers by Type

### Fire
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Reshiram | 643 | No | No | Fusion Flare* |
| Blacephalon | 806 | No | No | Overheat |
| Shadow Heatran | 485 | Yes | No | Magma Storm |
| Charizard | 6 | Yes | Yes | Blast Burn* |
| Blaziken | 257 | Yes | Yes | Blast Burn* |
| Chandelure | 609 | Yes | No | Overheat |
| Entei | 244 | Yes | No | Overheat |

### Water
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Primal Kyogre | 382 | No | Primal | Origin Pulse* |
| Shadow Kyogre | 382 | Yes | No | Surf |
| Shadow Greninja | 658 | Yes | No | Hydro Cannon* |
| Kingler | 99 | Yes | No | Crabhammer |
| Swampert | 260 | Yes | Yes | Hydro Cannon* |
| Gyarados | 130 | Yes | Yes | Hydro Pump |

### Electric
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Shadow Raikou | 243 | Yes | No | Wild Charge |
| Regieleki | 894 | No | No | Zap Cannon |
| Xurkitree | 796 | No | No | Discharge |
| Electivire | 466 | Yes | No | Wild Charge |
| Magnezone | 462 | Yes | No | Wild Charge |
| Manectric | 310 | Yes | Yes | Wild Charge |
| Zekrom | 644 | No | No | Fusion Bolt |

### Grass
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Kartana | 798 | No | No | Leaf Blade |
| Shadow Chesnaught | 652 | Yes | No | Frenzy Plant* |
| Zarude | 893 | No | No | Power Whip |
| Roserade | 407 | Yes | No | Grass Knot |
| Venusaur | 3 | Yes | Yes | Frenzy Plant* |
| Sceptile | 254 | Yes | Yes | Frenzy Plant* |

### Ice
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| White Kyurem | 646 | No | No | Ice Burn* |
| Black Kyurem | 646 | No | No | Blizzard |
| Shadow Mamoswine | 473 | Yes | No | Avalanche |
| Glaceon | 471 | Yes | No | Avalanche |
| Weavile | 461 | Yes | No | Avalanche |
| Galarian Darmanitan | 555 | Yes | No | Avalanche |
| Glalie | 362 | Yes | Yes | Avalanche |

### Fighting
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Mega Lucario | 448 | No | Yes | Aura Sphere |
| Mega Blaziken | 257 | No | Yes | Focus Blast |
| Keldeo | 647 | No | No | Sacred Sword |
| Shadow Machamp | 68 | Yes | No | Dynamic Punch |
| Shadow Hariyama | 297 | Yes | No | Dynamic Punch |
| Conkeldurr | 534 | Yes | No | Dynamic Punch |
| Terrakion | 639 | No | No | Sacred Sword |

### Psychic
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Shadow Mewtwo | 150 | Yes | No | Psystrike* |
| Mewtwo | 150 | No | Yes | Psystrike* |
| Hoopa-Unbound | 720 | No | No | Psychic |
| Espeon | 196 | Yes | No | Psychic |
| Alakazam | 65 | Yes | Yes | Psychic |
| Metagross | 376 | Yes | No | Psychic |
| Gardevoir | 282 | Yes | Yes | Psychic |

### Dark
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Mega Tyranitar | 248 | No | Yes | Brutal Swing |
| Shadow Tyranitar | 248 | Yes | No | Brutal Swing |
| Shadow Hydreigon | 635 | Yes | No | Brutal Swing |
| Darkrai | 491 | No | No | Dark Pulse |
| Yveltal | 717 | No | No | Dark Pulse |
| Honchkrow | 430 | Yes | No | Dark Pulse |
| Weavile | 461 | Yes | No | Foul Play |

### Ghost
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Dawn Wings Necrozma | 800 | No | No | Moongeist Beam* |
| Mega Gengar | 94 | No | Yes | Shadow Ball |
| Shadow Chandelure | 609 | Yes | No | Shadow Ball |
| Giratina-O | 487 | Yes | No | Shadow Ball |
| Lunala | 792 | No | No | Shadow Ball |
| Gengar | 94 | Yes | No | Shadow Ball |

### Dragon
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Mega Rayquaza | 384 | No | Yes | Dragon Ascent* |
| Eternatus | 890 | No | No | Dynamax Cannon* |
| Black Kyurem | 646 | No | No | Outrage |
| Shadow Garchomp | 445 | Yes | No | Outrage |
| Shadow Salamence | 373 | Yes | Yes | Outrage |
| Shadow Dragonite | 149 | Yes | No | Outrage |
| Rayquaza | 384 | Yes | No | Outrage |
| Dialga | 483 | No | No | Draco Meteor |

### Rock
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Mega Diancie | 719 | No | Yes | Rock Slide |
| Shadow Rampardos | 409 | Yes | No | Rock Slide |
| Shadow Rhyperior | 464 | Yes | No | Rock Wrecker* |
| Shadow Tyranitar | 248 | Yes | No | Smack Down* |
| Terrakion | 639 | No | No | Rock Slide |
| Gigalith | 526 | Yes | No | Rock Slide |

### Ground
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Primal Groudon | 383 | No | Primal | Precipice Blades* |
| Shadow Groudon | 383 | Yes | No | Earthquake |
| Landorus-T | 645 | No | No | Earth Power |
| Shadow Garchomp | 445 | Yes | Yes | Earth Power* |
| Excadrill | 530 | Yes | No | Drill Run |
| Shadow Mamoswine | 473 | Yes | No | Bulldoze |

### Flying
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Mega Rayquaza | 384 | No | Yes | Dragon Ascent* |
| Shadow Moltres | 146 | Yes | No | Sky Attack |
| Mega Salamence | 373 | No | Yes | Fly |
| Shadow Staraptor | 398 | Yes | No | Fly |
| Honchkrow | 430 | Yes | No | Sky Attack |
| Yveltal | 717 | No | No | Oblivion Wing |

### Steel
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Crowned Zacian | 888 | No | No | Behemoth Blade* |
| Dusk Mane Necrozma | 800 | No | No | Sunsteel Strike |
| Shadow Metagross | 376 | Yes | Yes | Meteor Mash* |
| Shadow Excadrill | 530 | Yes | No | Iron Head |
| Dialga | 483 | No | No | Iron Head |

### Fairy
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Mega Gardevoir | 282 | No | Yes | Dazzling Gleam |
| Crowned Zacian | 888 | No | No | Play Rough |
| Shadow Gardevoir | 282 | Yes | No | Dazzling Gleam |
| Togekiss | 468 | Yes | No | Dazzling Gleam |
| Xerneas | 716 | No | No | Moonblast |
| Sylveon | 700 | Yes | No | Moonblast |

### Poison
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Eternatus | 890 | No | No | Dynamax Cannon* |
| Mega Gengar | 94 | No | Yes | Sludge Bomb |
| Nihilego | 793 | No | No | Sludge Bomb |
| Shadow Roserade | 407 | Yes | No | Sludge Bomb |
| Shadow Toxicroak | 454 | Yes | No | Sludge Bomb |

### Bug
| Pokemon | Dex | Shadow? | Mega? | Key Move |
|---------|-----|---------|-------|----------|
| Mega Heracross | 214 | No | Yes | Megahorn |
| Mega Pinsir | 127 | No | Yes | X-Scissor |
| Mega Scizor | 212 | No | Yes | X-Scissor |
| Shadow Pinsir | 127 | Yes | No | X-Scissor |
| Vikavolt | 738 | Yes | No | X-Scissor |

### Dex numbers for filters
```
# Top raid attackers (all types, shadows included)
643,806,485,6,257,609,244,382,658,99,260,130,243,894,796,466,462,310,644,798,652,893,407,3,254,646,473,471,461,555,362,448,647,68,297,534,639,150,720,196,65,376,282,248,635,491,717,430,800,94,487,792,384,890,445,373,149,483,719,409,464,639,526,383,645,530,146,398,888,376,468,716,700,793,454,214,127,212,738

# Priority raid investments (top DPS per type)
150,382,383,384,473,448,643,798,646,248,94,800,888,282,890
```

---

## Dynamax & Gigantamax Meta

### Top Attackers
| Pokemon | Dex | ATK | G-Max? | Role |
|---------|-----|-----|--------|------|
| Crowned Zacian | 888 | 332 | No | #1 Attacker + Tank |
| G-Max Inteleon | 818 | 262 | Yes | Water DPS |
| G-Max Gengar | 94 | 261 | Yes | Ghost DPS |
| G-Max Kingler | 99 | 240 | Yes | Water DPS |
| G-Max Rillaboom | 812 | 239 | Yes | Grass DPS |
| G-Max Cinderace | 815 | 238 | Yes | Fire DPS |
| G-Max Machamp | 68 | 234 | Yes | Fighting DPS |
| G-Max Charizard | 6 | 223 | Yes | Fire DPS |
| G-Max Venusaur | 3 | 198 | Yes | Grass/Poison |
| G-Max Blastoise | 9 | 171 | Yes | Water Tank |

### Top Tanks & Healers
| Pokemon | Dex | HP | Role | Notes |
|---------|-----|-----|------|-------|
| Dynamax Blissey | 242 | 496 | #1 Healer/Tank | MUST BUILD |
| Crowned Zamazenta | 889 | 245 | Tank | Pre-applied Guard |
| G-Max Snorlax | 143 | 330 | Tank | Outclassed by Blissey |
| G-Max Lapras | 131 | 260 | Tank | Ice/Water |
| Dynamax Chansey | 113 | 500 | Healer | Evolves to Blissey |

### All Gigantamax Forms (as of April 2026)
| Pokemon | Dex | Type | Release |
|---------|-----|------|---------|
| Venusaur | 3 | Grass/Poison | Oct 2024 |
| Charizard | 6 | Fire/Flying | Oct 2024 |
| Blastoise | 9 | Water | Oct 2024 |
| Butterfree | 12 | Bug/Flying | Mid 2025 |
| Pikachu | 25 | Electric | Mar 2026 |
| Meowth | 52 | Normal | Jan 2026 |
| Machamp | 68 | Fighting | Mid 2025 |
| Gengar | 94 | Ghost/Poison | Oct 2024 |
| Kingler | 99 | Water | Early 2025 |
| Lapras | 131 | Water/Ice | Early 2025 |
| Snorlax | 143 | Normal | Early 2025 |
| Garbodor | 569 | Poison | Late 2025 |
| Grimmsnarl | 861 | Dark/Fairy | Late 2025 |
| Rillaboom | 812 | Grass | GO Fest 2025 |
| Cinderace | 815 | Fire | GO Fest 2025 |
| Inteleon | 818 | Water | GO Fest 2025 |
| Toxtricity | 849 | Electric/Poison | Late 2025 |

### Dex numbers for filters
```
# Giga top tier attackers
818,94,99,812,815,68,6,3,9

# Giga all forms
3,6,9,12,25,52,68,94,99,131,143,569,861,812,815,818,849

# Dyna top tier tanks/healers
242,889,143,131,113

# Dyna top tier attackers (non-Giga)
888,530,475,381,555,376,143

# All worth building for Max Battles
888,889,242,113,818,94,99,812,815,68,6,3,9,131,143,530,475,381,555,376,849
```

---

## Regionals (High Trade Value)

### Extremely Rare (small regions)
| Pokemon | Dex | Region |
|---------|-----|--------|
| Tropius | 357 | Africa, Mediterranean |
| Relicanth | 369 | New Zealand, Pacific |
| Pachirisu | 417 | Arctic (Canada, Alaska, Russia) |
| Klefki | 707 | France |
| Comfey | 764 | Hawaii |
| Hawlucha | 701 | Mexico |
| Sigilyph | 561 | Greece, Egypt |
| Bouffalant | 626 | NYC metro |

### Notable Regionals
| Pokemon | Dex | Region |
|---------|-----|--------|
| Kangaskhan | 115 | Australia |
| Mr. Mime | 122 | Europe |
| Tauros | 128 | North America |
| Heracross | 214 | Central/South America |
| Corsola | 222 | Tropical band |
| Torkoal | 324 | India, SE Asia |
| Zangoose | 335 | varies (swaps with Seviper) |
| Seviper | 336 | varies (swaps with Zangoose) |
| Lunatone | 337 | varies (swaps) |
| Solrock | 338 | varies (swaps) |
| Carnivine | 455 | Southeast US |
| Chatot | 441 | Southern hemisphere |
| Pansage | 511 | Asia-Pacific |
| Pansear | 513 | Europe, Africa |
| Panpour | 515 | Americas |
| Throh | 538 | varies (swaps) |
| Sawk | 539 | varies (swaps) |
| Maractus | 556 | Central/South America |
| Durant | 632 | varies (swaps) |
| Heatmor | 631 | varies (swaps) |
| Furfrou (trims) | 676 | varies by trim |
| Vivillon | 666 | 18 patterns by postcard region |
| Flabébé (colors) | 669 | varies by color |

### Lake Trio (region-locked legends)
| Pokemon | Dex | Region |
|---------|-----|--------|
| Uxie | 480 | Asia-Pacific |
| Mesprit | 481 | Europe, Africa |
| Azelf | 482 | Americas |

### Dex numbers for filters
```
# Top trade value regionals
357,369,417,707,764,701,561,626

# All regionals (keep any from outside your region)
115,122,128,214,222,324,335,336,337,338,357,369,417,441,455,480,481,482,511,513,515,538,539,556,561,626,631,632,676,666,669,701,707,764
```

---

## Never Transfer List

### Ultra Rare
| Pokemon | Dex | Reason |
|---------|-----|--------|
| Unown (all forms) | 201 | Event-only letters |
| Rotom (all forms) | 479 | Event photobombs only |
| Larvesta | 636 | <1% hatch, 400 candy to evolve |
| Salandit (female) | 757 | 12.5% female rate |
| Gimmighoul | 999 | Requires Scarlet/Violet |
| Zygarde | 718 | 250 cells needed |
| Eternatus | 890 | Extremely limited |

### Shadow Legends (never purify)
| Pokemon | Dex | Notes |
|---------|-----|-------|
| Shadow Mewtwo | 150 | #1 raid attacker with Psystrike |
| Shadow Raikou | 243 | #1 Electric |
| Shadow Entei | 244 | Top Fire |
| Shadow Suicune | 245 | Decent Water |
| Shadow Lugia | 249 | Aeroblast |
| Shadow Ho-Oh | 250 | Sacred Fire |
| Shadow Latios | 381 | Dragon DPS |
| Shadow Latias | 380 | Bulk |
| Shadow Articuno | 144 | Ice coverage |
| Shadow Zapdos | 145 | Electric |
| Shadow Moltres | 146 | #1 Flying |
| Shadow Regirock | 377 | Rock tank |
| Shadow Regice | 378 | Ice tank |
| Shadow Registeel | 379 | Steel tank |

### Must-keep Legacy/CD Moves
| Pokemon | Dex | Move | Use |
|---------|-----|------|-----|
| Mewtwo | 150 | Psystrike + Shadow Ball | Double legacy = most valuable |
| Metagross | 376 | Meteor Mash | #1 Steel |
| Swampert | 260 | Hydro Cannon | All leagues PvP |
| Charizard | 6 | Blast Burn | Mega Fire |
| Venusaur | 3 | Frenzy Plant | Mega Grass |
| Salamence | 373 | Outrage | Dragon DPS |
| Garchomp | 445 | Earth Power | ML PvP |
| Corviknight | 823 | Air Cutter | GL/UL meta |
| Annihilape | 979 | Rage Fist | GL/UL core |
| Walrein | 365 | Icicle Spear | GL/UL spam |
| Ho-Oh | 250 | Sacred Fire+ | ML viable |
| Groudon | 383 | Precipice Blades | ML + raids |
| Rhyperior | 464 | Rock Wrecker | Rock DPS |
| Empoleon | 395 | Hydro Cannon | GL/UL |
| Feraligatr | 160 | Hydro Cannon | Water DPS |
| Greninja | 658 | Hydro Cannon | Raid Water |
| Gengar | 94 | Shadow Claw (fast) | Ghost DPS |
| Tyranitar | 248 | Smack Down (fast) | Rock DPS |

### Dex numbers for filters
```
# Never transfer (ultra rare)
201,479,636,757,999,718,890

# Shadow legends (never purify)
150,243,244,245,249,250,381,380,144,145,146,377,378,379

# Legacy move Pokemon (check @spezial)
150,376,260,6,3,373,445,823,979,365,250,383,464,395,160,658,94,248
```

---
