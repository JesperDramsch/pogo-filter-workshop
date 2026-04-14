import React, { useState, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { X, Plus, Copy, Check, ChevronDown, ChevronRight, RotateCcw, Sparkles, Settings } from "lucide-react";

// ─── DATA ──────────────────────────────────────────────────────────────────

const DEFAULT_HUNDOS = [];

// Trade-evo families: base name → all family members (lowercase) for dedup detection
const TRADE_EVO_FAMILIES = {
  abra:       ["abra","kadabra","simsala"],
  machollo:   ["machollo","maschock","machomei"],
  kleinstein: ["kleinstein","georok","geowaz"],
  nebulak:    ["nebulak","alpollo","gengar"],
  kiesling:   ["kiesling","sedimantur","brockoloss"],
  praktibalk: ["praktibalk","strepoli","meistagrif"],
  laukaps:    ["laukaps","cavalanzas"],
  schnuthelm: ["schnuthelm","hydragil"],
  paragoni:   ["paragoni","trombork"],
  irrbis:     ["irrbis","pumpdjinn"],
};

// Display names with PoGo's typical capitalization
const TE_DISPLAY = {
  abra: "Abra", machollo: "Machollo", kleinstein: "Kleinstein", nebulak: "Nebulak",
  kiesling: "Kiesling", praktibalk: "Praktibalk", laukaps: "Laukaps",
  schnuthelm: "Schnuthelm", paragoni: "Paragoni", irrbis: "Irrbis",
};

const DEFAULT_CONFIG = {
  // Mode
  expertMode: false,           // hides niche toggles in normal mode

  // PvP
  pvpMode: "loose",            // "loose" | "strict" | "none"

  // Universal protections (most always-on in normal mode; visible in expert)
  protectFavorites: true,
  protectFourStar: true,       // never toss any 4★ hundo (Regel 1) — expert can disable with confirmation
  protectTradeEvos: true,      // protect trade-evolution candidates from trash (free evos via tausch)
  protectAnyTag: true,         // protects ANY tagged Pokémon (catch-all !# clause)
  protectShinies: true,
  protectLuckies: true,
  protectLegendaries: true,
  protectMythicals: true,
  mythTooManyOf: "808,649",    // species you have spares of (Meltan, Genesect, ...)
  protectUltraBeasts: true,
  protectShadows: true,        // Crypto in trash; trade ALWAYS excludes (untradeable)
  protectPurified: true,
  protectCostumes: true,
  protectBackgrounds: true,
  protectLegacyMoves: true,
  protectBabies: true,
  protectXXL: true,
  protectXL: true,
  protectXXS: true,
  protectDoubleMoved: true,
  protectDynamax: true,
  protectNewEvolutions: true,  // (was protectMegaConditional — name simplified, mega0 logic preserved)
  protectBuddies: false,

  // Trade tags (both protected as TAGS in PoGo via #name syntax)
  basarTagName: "Trade",          // bulk trade tag (was hardcoded #)
  fernTauschTagName: "Fern-Tausch", // Niantic's official long-distance trade tag (Dec 2025)

  // Custom tag protections — comma-separated list of additional #tags to protect
  customProtectedTags: "",     // e.g. "pvpiv,keep,shiny-hunting"

  // League tags — configurable for users with different naming conventions
  leagueTags: "ⓤ,ⓖ,ⓛ",       // comma-separated; my default uses Unicode circles

  // Regional groups (populated by App init)
  regionalGroups: {},
  enabledTradeEvos: [],
  customCollectibles: [],      // user-added species to protect (lowercase German names)
  // Trade buddies — list of { id, name, tagPrefix, events: [event-names] }
  // tagPrefix matches any sub-tag (e.g. #Anna matches #Anna:hat-pika via PoGo prefix match).
  buddies: [],

  // Scope safety
  cpCap: 2000,
  ageScopeDays: 30,            // "Vor wie vielen Tagen gefangen — Filterumfang"
  distanceProtect: 100,        // km — Pilot medal protection
};

// ─── REGIONAL FORM CHECKS ───────────────────────────────────────────────────
//
// Each entry is grouped by collection theme. Type-checked entries protect a
// regional FORM (e.g. Hisui Typhlosion) without touching the regular form.
// Pure-name entries protect the species outright; if all members of a known
// "form trio" (e.g. all 3 Vivillon patterns) are enabled, we auto-collapse
// to "+Family" syntax to save chars and protect the whole evolution line.

const REGIONAL_GROUPS = {
  alolan: {
    label: "Alola-Formen",
    description: "Generation 7 — alolanische Formen",
    typeChecks: [
      { species: "Raichu",     type: "psycho",  note: "Alola Raichu (Elektro/Psycho) — der reguläre Raichu ist nicht Psycho" },
      { species: "Sandan",     type: "eis",     note: "Alola Sandan (Eis/Stahl)" },
      { species: "Vulpix",     type: "eis",     note: "Alola Vulpix (Eis)" },
      { species: "Digda",      type: "stahl",   note: "Alola Digda (Boden/Stahl)" },
      { species: "Mauzi",      type: "unlicht", note: "Alola Mauzi (Unlicht)" },
      { species: "Kleinstein", type: "elektro", note: "Alola Kleinstein (Gestein/Elektro)" },
      { species: "Kokowei",    type: "drache",  note: "Alola Kokowei (Pflanze/Drache)" },
      { species: "Knogga",     type: "geist",   note: "Alola Knogga (Boden/Geist)" },
    ],
    collectors: [],
  },
  galarian: {
    label: "Galar-Formen",
    description: "Generation 8 — galarische Formen",
    typeChecks: [
      { species: "Smogmog",  type: "fee",   note: "Galar Smogmog (Gift/Fee)" },
      { species: "Pantimos", type: "eis",   note: "Galar Pantimos (Eis/Psycho)" },
      { species: "Makabaja", type: "boden", note: "Galar Makabaja (Boden/Geist)" },
      { species: "Porenta",  type: "kampf", note: "Galar Porenta (Kampf)" },
      { species: "Corasonn", type: "geist", note: "Galar Corasonn (Geist) — reguläres ist Wasser/Gestein" },
    ],
    collectors: [],
  },
  hisuian: {
    label: "Hisui-Formen",
    description: "Pokémon Legends: Arceus — hisuische Formen",
    typeChecks: [
      { species: "Tornupto",  type: "geist",   note: "Hisui Tornupto (Feuer/Geist)" },
      { species: "Admurai",   type: "unlicht", note: "Hisui Admurai (Wasser/Unlicht)" },
      { species: "Dressella", type: "kampf",   note: "Hisui Dressella (Pflanze/Kampf)" },
      { species: "Arktilas",  type: "gestein", note: "Hisui Arktilas (Eis/Gestein)" },
      { species: "Silvarro",  type: "kampf",   note: "Hisui Silvarro (Pflanze/Kampf)" },
      { species: "Voltobal",  type: "pflanze", note: "Hisui Voltobal (Elektro/Pflanze)" },
      { species: "Lektrobal", type: "pflanze", note: "Hisui Lektrobal (Elektro/Pflanze)" },
      { species: "Sichlor",   type: "gestein", note: "Hisui Sichlor (Käfer/Gestein) → Axantor" },
    ],
    collectors: [],
  },
  paldean: {
    label: "Paldea-Formen",
    description: "Generation 9 — Paldean Tauros (3 Rassen)",
    typeChecks: [
      { species: "Tauros", type: "kampf",  note: "Paldean Tauros (Kampfrasse) — Iberische Halbinsel" },
      { species: "Tauros", type: "feuer",  note: "Paldean Tauros (Flammenrasse) — westliche Hemisphäre" },
      { species: "Tauros", type: "wasser", note: "Paldean Tauros (Aquarasse) — östliche Hemisphäre" },
    ],
    collectors: [],
  },
  regionals: {
    label: "Regionale Pokémon",
    description: "Kontinent-exklusive Spezies — alle paired/hemispheric/trio Regionalen",
    typeChecks: [],
    collectors: [
      // Kontinent-exklusiv (Type 1 polygons in KMZ)
      "Kangama", "Tauros", "Skaraborn", "Corasonn", "Qurtel",
      "Tropius", "Relicanth", "Pachirisu", "Plaudagei",
      "Venuflibis", "Maracamba", "Symvolara", "Bisofank", "Humanolith",
      "Resladero", "Clavion", "Curelei",
      // Type 3 paired (Zangoose/Seviper, Lunatone/Solrock — swap regions periodically)
      "Sengo", "Vipitis",     // Zangoose / Seviper
      "Lunastein", "Sonnfel", // Lunatone / Solrock
      // Type 4 hemispheric (Throh/Sawk, Heatmor/Durant)
      "Karadonis", "Jiutesto",   // Sawk / Throh
      "Furnifraß", "Fermicula",  // Heatmor / Durant
      // Type 5 Big-Three trios (3 continents — Lake Guardians, Elemental Monkeys)
      "Selfe", "Vesprit", "Tobutz",        // Uxie / Mesprit / Azelf
      "Vegimak", "Grillmak", "Sodamak",    // Pansage / Pansear / Panpour
    ],
  },
  collectibles: {
    label: "Sammler-Pokémon",
    description: "Multi-Form / Muster-Sammlungen — Formen sind in PoGo nicht separat suchbar",
    typeChecks: [],
    collectors: [
      // Vivillon-line — flat collectors; collapses to +Purmel if all 3 selected
      "Purmel", "Puponcho", "Vivillon",
      // Letter / pattern collections
      "Icognito",
      // Rare research/PokéStop encounters with multiple forms
      "Pandir",        // Spinda — 9 patterns, monthly Field Research
      "Kecleon",       // PokéStop hide encounter (rare)
      // Multi-form Pokémon (forms aren't search-distinguishable, so we protect the species)
      "Coiffwaff",     // Furfrou — multiple trims
      "Nigiragi",      // Tatsugiri — Curly/Droopy/Stretchy
      "Schalellos", "Gastrodon",  // West/Ost forms not separately searchable
      "Barschuft",     // Basculin — red/blue stripe forms not separately searchable
    ],
  },
};

// Family expansion: when collectors include all members of a +family,
// collapse to "+Family" instead of repeated entries (saves chars + protects whole line).
const FAMILY_COLLAPSES = {
  "+Purmel": ["Purmel", "Puponcho", "Vivillon"],
};

// Default: all enabled, but each can be toggled or filtered down to specific species.
function defaultRegionalToggles() {
  const out = {};
  for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
    out[key] = {
      enabled: true,
      // null = all species in group are protected; if array, only listed species
      typeChecksEnabled: null,
      collectorsEnabled: null,
    };
  }
  return out;
}

// ─── POKÉMON NAME DICTIONARY (from PoGo APK strings, leidwesen.github.io) ───
//
// Maps dex# → [English, German] for all 1025 species available in PoGo.
// Source: Leidwesen's PhraseTranslator data sheet (last updated 2026-04-17, APK 0.407.0).
// Used by the resolver below so users can input numbers, English names, or
// German names interchangeably.

const POKEMON_NAMES = JSON.parse(`{"1":["Bulbasaur","Bisasam"],"2":["Ivysaur","Bisaknosp"],"3":["Venusaur","Bisaflor"],"4":["Charmander","Glumanda"],"5":["Charmeleon","Glutexo"],"6":["Charizard","Glurak"],"7":["Squirtle","Schiggy"],"8":["Wartortle","Schillok"],"9":["Blastoise","Turtok"],"10":["Caterpie","Raupy"],"11":["Metapod","Safcon"],"12":["Butterfree","Smettbo"],"13":["Weedle","Hornliu"],"14":["Kakuna","Kokuna"],"15":["Beedrill","Bibor"],"16":["Pidgey","Taubsi"],"17":["Pidgeotto","Tauboga"],"18":["Pidgeot","Tauboss"],"19":["Rattata","Rattfratz"],"20":["Raticate","Rattikarl"],"21":["Spearow","Habitak"],"22":["Fearow","Ibitak"],"23":["Ekans","Rettan"],"24":["Arbok","Arbok"],"25":["Pikachu","Pikachu"],"26":["Raichu","Raichu"],"27":["Sandshrew","Sandan"],"28":["Sandslash","Sandamer"],"29":["Nidoran♀","Nidoran♀"],"30":["Nidorina","Nidorina"],"31":["Nidoqueen","Nidoqueen"],"32":["Nidoran♂","Nidoran♂"],"33":["Nidorino","Nidorino"],"34":["Nidoking","Nidoking"],"35":["Clefairy","Piepi"],"36":["Clefable","Pixi"],"37":["Vulpix","Vulpix"],"38":["Ninetales","Vulnona"],"39":["Jigglypuff","Pummeluff"],"40":["Wigglytuff","Knuddeluff"],"41":["Zubat","Zubat"],"42":["Golbat","Golbat"],"43":["Oddish","Myrapla"],"44":["Gloom","Duflor"],"45":["Vileplume","Giflor"],"46":["Paras","Paras"],"47":["Parasect","Parasek"],"48":["Venonat","Bluzuk"],"49":["Venomoth","Omot"],"50":["Diglett","Digda"],"51":["Dugtrio","Digdri"],"52":["Meowth","Mauzi"],"53":["Persian","Snobilikat"],"54":["Psyduck","Enton"],"55":["Golduck","Entoron"],"56":["Mankey","Menki"],"57":["Primeape","Rasaff"],"58":["Growlithe","Fukano"],"59":["Arcanine","Arkani"],"60":["Poliwag","Quapsel"],"61":["Poliwhirl","Quaputzi"],"62":["Poliwrath","Quappo"],"63":["Abra","Abra"],"64":["Kadabra","Kadabra"],"65":["Alakazam","Simsala"],"66":["Machop","Machollo"],"67":["Machoke","Maschock"],"68":["Machamp","Machomei"],"69":["Bellsprout","Knofensa"],"70":["Weepinbell","Ultrigaria"],"71":["Victreebel","Sarzenia"],"72":["Tentacool","Tentacha"],"73":["Tentacruel","Tentoxa"],"74":["Geodude","Kleinstein"],"75":["Graveler","Georok"],"76":["Golem","Geowaz"],"77":["Ponyta","Ponita"],"78":["Rapidash","Gallopa"],"79":["Slowpoke","Flegmon"],"80":["Slowbro","Lahmus"],"81":["Magnemite","Magnetilo"],"82":["Magneton","Magneton"],"83":["Farfetch'd","Porenta"],"84":["Doduo","Dodu"],"85":["Dodrio","Dodri"],"86":["Seel","Jurob"],"87":["Dewgong","Jugong"],"88":["Grimer","Sleima"],"89":["Muk","Sleimok"],"90":["Shellder","Muschas"],"91":["Cloyster","Austos"],"92":["Gastly","Nebulak"],"93":["Haunter","Alpollo"],"94":["Gengar","Gengar"],"95":["Onix","Onix"],"96":["Drowzee","Traumato"],"97":["Hypno","Hypno"],"98":["Krabby","Krabby"],"99":["Kingler","Kingler"],"100":["Voltorb","Voltobal"],"101":["Electrode","Lektrobal"],"102":["Exeggcute","Owei"],"103":["Exeggutor","Kokowei"],"104":["Cubone","Tragosso"],"105":["Marowak","Knogga"],"106":["Hitmonlee","Kicklee"],"107":["Hitmonchan","Nockchan"],"108":["Lickitung","Schlurp"],"109":["Koffing","Smogon"],"110":["Weezing","Smogmog"],"111":["Rhyhorn","Rihorn"],"112":["Rhydon","Rizeros"],"113":["Chansey","Chaneira"],"114":["Tangela","Tangela"],"115":["Kangaskhan","Kangama"],"116":["Horsea","Seeper"],"117":["Seadra","Seemon"],"118":["Goldeen","Goldini"],"119":["Seaking","Golking"],"120":["Staryu","Sterndu"],"121":["Starmie","Starmie"],"122":["Mr. Mime","Pantimos"],"123":["Scyther","Sichlor"],"124":["Jynx","Rossana"],"125":["Electabuzz","Elektek"],"126":["Magmar","Magmar"],"127":["Pinsir","Pinsir"],"128":["Tauros","Tauros"],"129":["Magikarp","Karpador"],"130":["Gyarados","Garados"],"131":["Lapras","Lapras"],"132":["Ditto","Ditto"],"133":["Eevee","Evoli"],"134":["Vaporeon","Aquana"],"135":["Jolteon","Blitza"],"136":["Flareon","Flamara"],"137":["Porygon","Porygon"],"138":["Omanyte","Amonitas"],"139":["Omastar","Amoroso"],"140":["Kabuto","Kabuto"],"141":["Kabutops","Kabutops"],"142":["Aerodactyl","Aerodactyl"],"143":["Snorlax","Relaxo"],"144":["Articuno","Arktos"],"145":["Zapdos","Zapdos"],"146":["Moltres","Lavados"],"147":["Dratini","Dratini"],"148":["Dragonair","Dragonir"],"149":["Dragonite","Dragoran"],"150":["Mewtwo","Mewtu"],"151":["Mew","Mew"],"152":["Chikorita","Endivie"],"153":["Bayleef","Lorblatt"],"154":["Meganium","Meganie"],"155":["Cyndaquil","Feurigel"],"156":["Quilava","Igelavar"],"157":["Typhlosion","Tornupto"],"158":["Totodile","Karnimani"],"159":["Croconaw","Tyracroc"],"160":["Feraligatr","Impergator"],"161":["Sentret","Wiesor"],"162":["Furret","Wiesenior"],"163":["Hoothoot","Hoothoot"],"164":["Noctowl","Noctuh"],"165":["Ledyba","Ledyba"],"166":["Ledian","Ledian"],"167":["Spinarak","Webarak"],"168":["Ariados","Ariados"],"169":["Crobat","Iksbat"],"170":["Chinchou","Lampi"],"171":["Lanturn","Lanturn"],"172":["Pichu","Pichu"],"173":["Cleffa","Pii"],"174":["Igglybuff","Fluffeluff"],"175":["Togepi","Togepi"],"176":["Togetic","Togetic"],"177":["Natu","Natu"],"178":["Xatu","Xatu"],"179":["Mareep","Voltilamm"],"180":["Flaaffy","Waaty"],"181":["Ampharos","Ampharos"],"182":["Bellossom","Blubella"],"183":["Marill","Marill"],"184":["Azumarill","Azumarill"],"185":["Sudowoodo","Mogelbaum"],"186":["Politoed","Quaxo"],"187":["Hoppip","Hoppspross"],"188":["Skiploom","Hubelupf"],"189":["Jumpluff","Papungha"],"190":["Aipom","Griffel"],"191":["Sunkern","Sonnkern"],"192":["Sunflora","Sonnflora"],"193":["Yanma","Yanma"],"194":["Wooper","Felino"],"195":["Quagsire","Morlord"],"196":["Espeon","Psiana"],"197":["Umbreon","Nachtara"],"198":["Murkrow","Kramurx"],"199":["Slowking","Laschoking"],"200":["Misdreavus","Traunfugil"],"201":["Unown","Icognito"],"202":["Wobbuffet","Woingenau"],"203":["Girafarig","Girafarig"],"204":["Pineco","Tannza"],"205":["Forretress","Forstellka"],"206":["Dunsparce","Dummisel"],"207":["Gligar","Skorgla"],"208":["Steelix","Stahlos"],"209":["Snubbull","Snubbull"],"210":["Granbull","Granbull"],"211":["Qwilfish","Baldorfish"],"212":["Scizor","Scherox"],"213":["Shuckle","Pottrott"],"214":["Heracross","Skaraborn"],"215":["Sneasel","Sniebel"],"216":["Teddiursa","Teddiursa"],"217":["Ursaring","Ursaring"],"218":["Slugma","Schneckmag"],"219":["Magcargo","Magcargo"],"220":["Swinub","Quiekel"],"221":["Piloswine","Keifel"],"222":["Corsola","Corasonn"],"223":["Remoraid","Remoraid"],"224":["Octillery","Octillery"],"225":["Delibird","Botogel"],"226":["Mantine","Mantax"],"227":["Skarmory","Panzaeron"],"228":["Houndour","Hunduster"],"229":["Houndoom","Hundemon"],"230":["Kingdra","Seedraking"],"231":["Phanpy","Phanpy"],"232":["Donphan","Donphan"],"233":["Porygon2","Porygon2"],"234":["Stantler","Damhirplex"],"235":["Smeargle","Farbeagle"],"236":["Tyrogue","Rabauz"],"237":["Hitmontop","Kapoera"],"238":["Smoochum","Kussilla"],"239":["Elekid","Elekid"],"240":["Magby","Magby"],"241":["Miltank","Miltank"],"242":["Blissey","Heiteira"],"243":["Raikou","Raikou"],"244":["Entei","Entei"],"245":["Suicune","Suicune"],"246":["Larvitar","Larvitar"],"247":["Pupitar","Pupitar"],"248":["Tyranitar","Despotar"],"249":["Lugia","Lugia"],"250":["Ho-Oh","Ho-Oh"],"251":["Celebi","Celebi"],"252":["Treecko","Geckarbor"],"253":["Grovyle","Reptain"],"254":["Sceptile","Gewaldro"],"255":["Torchic","Flemmli"],"256":["Combusken","Jungglut"],"257":["Blaziken","Lohgock"],"258":["Mudkip","Hydropi"],"259":["Marshtomp","Moorabbel"],"260":["Swampert","Sumpex"],"261":["Poochyena","Fiffyen"],"262":["Mightyena","Magnayen"],"263":["Zigzagoon","Zigzachs"],"264":["Linoone","Geradaks"],"265":["Wurmple","Waumpel"],"266":["Silcoon","Schaloko"],"267":["Beautifly","Papinella"],"268":["Cascoon","Panekon"],"269":["Dustox","Pudox"],"270":["Lotad","Loturzel"],"271":["Lombre","Lombrero"],"272":["Ludicolo","Kappalores"],"273":["Seedot","Samurzel"],"274":["Nuzleaf","Blanas"],"275":["Shiftry","Tengulist"],"276":["Taillow","Schwalbini"],"277":["Swellow","Schwalboss"],"278":["Wingull","Wingull"],"279":["Pelipper","Pelipper"],"280":["Ralts","Trasla"],"281":["Kirlia","Kirlia"],"282":["Gardevoir","Guardevoir"],"283":["Surskit","Gehweiher"],"284":["Masquerain","Maskeregen"],"285":["Shroomish","Knilz"],"286":["Breloom","Kapilz"],"287":["Slakoth","Bummelz"],"288":["Vigoroth","Muntier"],"289":["Slaking","Letarking"],"290":["Nincada","Nincada"],"291":["Ninjask","Ninjask"],"292":["Shedinja","Ninjatom"],"293":["Whismur","Flurmel"],"294":["Loudred","Krakeelo"],"295":["Exploud","Krawumms"],"296":["Makuhita","Makuhita"],"297":["Hariyama","Hariyama"],"298":["Azurill","Azurill"],"299":["Nosepass","Nasgnet"],"300":["Skitty","Eneco"],"301":["Delcatty","Enekoro"],"302":["Sableye","Zobiris"],"303":["Mawile","Flunkifer"],"304":["Aron","Stollunior"],"305":["Lairon","Stollrak"],"306":["Aggron","Stolloss"],"307":["Meditite","Meditie"],"308":["Medicham","Meditalis"],"309":["Electrike","Frizelbliz"],"310":["Manectric","Voltenso"],"311":["Plusle","Plusle"],"312":["Minun","Minun"],"313":["Volbeat","Volbeat"],"314":["Illumise","Illumise"],"315":["Roselia","Roselia"],"316":["Gulpin","Schluppuck"],"317":["Swalot","Schlukwech"],"318":["Carvanha","Kanivanha"],"319":["Sharpedo","Tohaido"],"320":["Wailmer","Wailmer"],"321":["Wailord","Wailord"],"322":["Numel","Camaub"],"323":["Camerupt","Camerupt"],"324":["Torkoal","Qurtel"],"325":["Spoink","Spoink"],"326":["Grumpig","Groink"],"327":["Spinda","Pandir"],"328":["Trapinch","Knacklion"],"329":["Vibrava","Vibrava"],"330":["Flygon","Libelldra"],"331":["Cacnea","Tuska"],"332":["Cacturne","Noktuska"],"333":["Swablu","Wablu"],"334":["Altaria","Altaria"],"335":["Zangoose","Sengo"],"336":["Seviper","Vipitis"],"337":["Lunatone","Lunastein"],"338":["Solrock","Sonnfel"],"339":["Barboach","Schmerbe"],"340":["Whiscash","Welsar"],"341":["Corphish","Krebscorps"],"342":["Crawdaunt","Krebutack"],"343":["Baltoy","Puppance"],"344":["Claydol","Lepumentas"],"345":["Lileep","Liliep"],"346":["Cradily","Wielie"],"347":["Anorith","Anorith"],"348":["Armaldo","Armaldo"],"349":["Feebas","Barschwa"],"350":["Milotic","Milotic"],"351":["Castform","Formeo"],"352":["Kecleon","Kecleon"],"353":["Shuppet","Shuppet"],"354":["Banette","Banette"],"355":["Duskull","Zwirrlicht"],"356":["Dusclops","Zwirrklop"],"357":["Tropius","Tropius"],"358":["Chimecho","Palimpalim"],"359":["Absol","Absol"],"360":["Wynaut","Isso"],"361":["Snorunt","Schneppke"],"362":["Glalie","Firnontor"],"363":["Spheal","Seemops"],"364":["Sealeo","Seejong"],"365":["Walrein","Walraisa"],"366":["Clamperl","Perlu"],"367":["Huntail","Aalabyss"],"368":["Gorebyss","Saganabyss"],"369":["Relicanth","Relicanth"],"370":["Luvdisc","Liebiskus"],"371":["Bagon","Kindwurm"],"372":["Shelgon","Draschel"],"373":["Salamence","Brutalanda"],"374":["Beldum","Tanhel"],"375":["Metang","Metang"],"376":["Metagross","Metagross"],"377":["Regirock","Regirock"],"378":["Regice","Regice"],"379":["Registeel","Registeel"],"380":["Latias","Latias"],"381":["Latios","Latios"],"382":["Kyogre","Kyogre"],"383":["Groudon","Groudon"],"384":["Rayquaza","Rayquaza"],"385":["Jirachi","Jirachi"],"386":["Deoxys","Deoxys"],"387":["Turtwig","Chelast"],"388":["Grotle","Chelcarain"],"389":["Torterra","Chelterrar"],"390":["Chimchar","Panflam"],"391":["Monferno","Panpyro"],"392":["Infernape","Panferno"],"393":["Piplup","Plinfa"],"394":["Prinplup","Pliprin"],"395":["Empoleon","Impoleon"],"396":["Starly","Staralili"],"397":["Staravia","Staravia"],"398":["Staraptor","Staraptor"],"399":["Bidoof","Bidiza"],"400":["Bibarel","Bidifas"],"401":["Kricketot","Zirpurze"],"402":["Kricketune","Zirpeise"],"403":["Shinx","Sheinux"],"404":["Luxio","Luxio"],"405":["Luxray","Luxtra"],"406":["Budew","Knospi"],"407":["Roserade","Roserade"],"408":["Cranidos","Koknodon"],"409":["Rampardos","Rameidon"],"410":["Shieldon","Schilterus"],"411":["Bastiodon","Bollterus"],"412":["Burmy","Burmy"],"413":["Wormadam","Burmadame"],"414":["Mothim","Moterpel"],"415":["Combee","Wadribie"],"416":["Vespiquen","Honweisel"],"417":["Pachirisu","Pachirisu"],"418":["Buizel","Bamelin"],"419":["Floatzel","Bojelin"],"420":["Cherubi","Kikugi"],"421":["Cherrim","Kinoso"],"422":["Shellos","Schalellos"],"423":["Gastrodon","Gastrodon"],"424":["Ambipom","Ambidiffel"],"425":["Drifloon","Driftlon"],"426":["Drifblim","Drifzepeli"],"427":["Buneary","Haspiror"],"428":["Lopunny","Schlapor"],"429":["Mismagius","Traunmagil"],"430":["Honchkrow","Kramshef"],"431":["Glameow","Charmian"],"432":["Purugly","Shnurgarst"],"433":["Chingling","Klingplim"],"434":["Stunky","Skunkapuh"],"435":["Skuntank","Skuntank"],"436":["Bronzor","Bronzel"],"437":["Bronzong","Bronzong"],"438":["Bonsly","Mobai"],"439":["Mime Jr.","Pantimimi"],"440":["Happiny","Wonneira"],"441":["Chatot","Plaudagei"],"442":["Spiritomb","Kryppuk"],"443":["Gible","Kaumalat"],"444":["Gabite","Knarksel"],"445":["Garchomp","Knakrack"],"446":["Munchlax","Mampfaxo"],"447":["Riolu","Riolu"],"448":["Lucario","Lucario"],"449":["Hippopotas","Hippopotas"],"450":["Hippowdon","Hippoterus"],"451":["Skorupi","Pionskora"],"452":["Drapion","Piondragi"],"453":["Croagunk","Glibunkel"],"454":["Toxicroak","Toxiquak"],"455":["Carnivine","Venuflibis"],"456":["Finneon","Finneon"],"457":["Lumineon","Lumineon"],"458":["Mantyke","Mantirps"],"459":["Snover","Shnebedeck"],"460":["Abomasnow","Rexblisar"],"461":["Weavile","Snibunna"],"462":["Magnezone","Magnezone"],"463":["Lickilicky","Schlurplek"],"464":["Rhyperior","Rihornior"],"465":["Tangrowth","Tangoloss"],"466":["Electivire","Elevoltek"],"467":["Magmortar","Magbrant"],"468":["Togekiss","Togekiss"],"469":["Yanmega","Yanmega"],"470":["Leafeon","Folipurba"],"471":["Glaceon","Glaziola"],"472":["Gliscor","Skorgro"],"473":["Mamoswine","Mamutel"],"474":["Porygon-Z","Porygon-Z"],"475":["Gallade","Galagladi"],"476":["Probopass","Voluminas"],"477":["Dusknoir","Zwirrfinst"],"478":["Froslass","Frosdedje"],"479":["Rotom","Rotom"],"480":["Uxie","Selfe"],"481":["Mesprit","Vesprit"],"482":["Azelf","Tobutz"],"483":["Dialga","Dialga"],"484":["Palkia","Palkia"],"485":["Heatran","Heatran"],"486":["Regigigas","Regigigas"],"487":["Giratina","Giratina"],"488":["Cresselia","Cresselia"],"489":["Phione","Phione"],"490":["Manaphy","Manaphy"],"491":["Darkrai","Darkrai"],"492":["Shaymin","Shaymin"],"493":["Arceus","Arceus"],"494":["Victini","Victini"],"495":["Snivy","Serpifeu"],"496":["Servine","Efoserp"],"497":["Serperior","Serpiroyal"],"498":["Tepig","Floink"],"499":["Pignite","Ferkokel"],"500":["Emboar","Flambirex"],"501":["Oshawott","Ottaro"],"502":["Dewott","Zwottronin"],"503":["Samurott","Admurai"],"504":["Patrat","Nagelotz"],"505":["Watchog","Kukmarda"],"506":["Lillipup","Yorkleff"],"507":["Herdier","Terribark"],"508":["Stoutland","Bissbark"],"509":["Purrloin","Felilou"],"510":["Liepard","Kleoparda"],"511":["Pansage","Vegimak"],"512":["Simisage","Vegichita"],"513":["Pansear","Grillmak"],"514":["Simisear","Grillchita"],"515":["Panpour","Sodamak"],"516":["Simipour","Sodachita"],"517":["Munna","Somniam"],"518":["Musharna","Somnivora"],"519":["Pidove","Dusselgurr"],"520":["Tranquill","Navitaub"],"521":["Unfezant","Fasasnob"],"522":["Blitzle","Elezeba"],"523":["Zebstrika","Zebritz"],"524":["Roggenrola","Kiesling"],"525":["Boldore","Sedimantur"],"526":["Gigalith","Brockoloss"],"527":["Woobat","Fleknoil"],"528":["Swoobat","Fletiamo"],"529":["Drilbur","Rotomurf"],"530":["Excadrill","Stalobor"],"531":["Audino","Ohrdoch"],"532":["Timburr","Praktibalk"],"533":["Gurdurr","Strepoli"],"534":["Conkeldurr","Meistagrif"],"535":["Tympole","Schallquap"],"536":["Palpitoad","Mebrana"],"537":["Seismitoad","Branawarz"],"538":["Throh","Jiutesto"],"539":["Sawk","Karadonis"],"540":["Sewaddle","Strawickl"],"541":["Swadloon","Folikon"],"542":["Leavanny","Matrifol"],"543":["Venipede","Toxiped"],"544":["Whirlipede","Rollum"],"545":["Scolipede","Cerapendra"],"546":["Cottonee","Waumboll"],"547":["Whimsicott","Elfun"],"548":["Petilil","Lilminip"],"549":["Lilligant","Dressella"],"550":["Basculin","Barschuft"],"551":["Sandile","Ganovil"],"552":["Krokorok","Rokkaiman"],"553":["Krookodile","Rabigator"],"554":["Darumaka","Flampion"],"555":["Darmanitan","Flampivian"],"556":["Maractus","Maracamba"],"557":["Dwebble","Lithomith"],"558":["Crustle","Castellith"],"559":["Scraggy","Zurrokex"],"560":["Scrafty","Irokex"],"561":["Sigilyph","Symvolara"],"562":["Yamask","Makabaja"],"563":["Cofagrigus","Echnatoll"],"564":["Tirtouga","Galapaflos"],"565":["Carracosta","Karippas"],"566":["Archen","Flapteryx"],"567":["Archeops","Aeropteryx"],"568":["Trubbish","Unratütox"],"569":["Garbodor","Deponitox"],"570":["Zorua","Zorua"],"571":["Zoroark","Zoroark"],"572":["Minccino","Picochilla"],"573":["Cinccino","Chillabell"],"574":["Gothita","Mollimorba"],"575":["Gothorita","Hypnomorba"],"576":["Gothitelle","Morbitesse"],"577":["Solosis","Monozyto"],"578":["Duosion","Mitodos"],"579":["Reuniclus","Zytomega"],"580":["Ducklett","Piccolente"],"581":["Swanna","Swaroness"],"582":["Vanillite","Gelatini"],"583":["Vanillish","Gelatroppo"],"584":["Vanilluxe","Gelatwino"],"585":["Deerling","Sesokitz"],"586":["Sawsbuck","Kronjuwild"],"587":["Emolga","Emolga"],"588":["Karrablast","Laukaps"],"589":["Escavalier","Cavalanzas"],"590":["Foongus","Tarnpignon"],"591":["Amoonguss","Hutsassa"],"592":["Frillish","Quabbel"],"593":["Jellicent","Apoquallyp"],"594":["Alomomola","Mamolida"],"595":["Joltik","Wattzapf"],"596":["Galvantula","Voltula"],"597":["Ferroseed","Kastadur"],"598":["Ferrothorn","Tentantel"],"599":["Klink","Klikk"],"600":["Klang","Kliklak"],"601":["Klinklang","Klikdiklak"],"602":["Tynamo","Zapplardin"],"603":["Eelektrik","Zapplalek"],"604":["Eelektross","Zapplarang"],"605":["Elgyem","Pygraulon"],"606":["Beheeyem","Megalon"],"607":["Litwick","Lichtel"],"608":["Lampent","Laternecto"],"609":["Chandelure","Skelabra"],"610":["Axew","Milza"],"611":["Fraxure","Sharfax"],"612":["Haxorus","Maxax"],"613":["Cubchoo","Petznief"],"614":["Beartic","Siberio"],"615":["Cryogonal","Frigometri"],"616":["Shelmet","Schnuthelm"],"617":["Accelgor","Hydragil"],"618":["Stunfisk","Flunschlik"],"619":["Mienfoo","Lin-Fu"],"620":["Mienshao","Wie-Shu"],"621":["Druddigon","Shardrago"],"622":["Golett","Golbit"],"623":["Golurk","Golgantes"],"624":["Pawniard","Gladiantri"],"625":["Bisharp","Caesurio"],"626":["Bouffalant","Bisofank"],"627":["Rufflet","Geronimatz"],"628":["Braviary","Washakwil"],"629":["Vullaby","Skallyk"],"630":["Mandibuzz","Grypheldis"],"631":["Heatmor","Furnifraß"],"632":["Durant","Fermicula"],"633":["Deino","Kapuno"],"634":["Zweilous","Duodino"],"635":["Hydreigon","Trikephalo"],"636":["Larvesta","Ignivor"],"637":["Volcarona","Ramoth"],"638":["Cobalion","Kobalium"],"639":["Terrakion","Terrakium"],"640":["Virizion","Viridium"],"641":["Tornadus","Boreos"],"642":["Thundurus","Voltolos"],"643":["Reshiram","Reshiram"],"644":["Zekrom","Zekrom"],"645":["Landorus","Demeteros"],"646":["Kyurem","Kyurem"],"647":["Keldeo","Keldeo"],"648":["Meloetta","Meloetta"],"649":["Genesect","Genesect"],"650":["Chespin","Igamaro"],"651":["Quilladin","Igastarnish"],"652":["Chesnaught","Brigaron"],"653":["Fennekin","Fynx"],"654":["Braixen","Rutena"],"655":["Delphox","Fennexis"],"656":["Froakie","Froxy"],"657":["Frogadier","Amphizel"],"658":["Greninja","Quajutsu"],"659":["Bunnelby","Scoppel"],"660":["Diggersby","Grebbit"],"661":["Fletchling","Dartiri"],"662":["Fletchinder","Dartignis"],"663":["Talonflame","Fiaro"],"664":["Scatterbug","Purmel"],"665":["Spewpa","Puponcho"],"666":["Vivillon","Vivillon"],"667":["Litleo","Leufeo"],"668":["Pyroar","Pyroleo"],"669":["Flabébé","Flabébé"],"670":["Floette","Floette"],"671":["Florges","Florges"],"672":["Skiddo","Mähikel"],"673":["Gogoat","Chevrumm"],"674":["Pancham","Pam-Pam"],"675":["Pangoro","Pandagro"],"676":["Furfrou","Coiffwaff"],"677":["Espurr","Psiau"],"678":["Meowstic","Psiaugon"],"679":["Honedge","Gramokles"],"680":["Doublade","Duokles"],"681":["Aegislash","Durengard"],"682":["Spritzee","Parfi"],"683":["Aromatisse","Parfinesse"],"684":["Swirlix","Flauschling"],"685":["Slurpuff","Sabbaione"],"686":["Inkay","Iscalar"],"687":["Malamar","Calamanero"],"688":["Binacle","Bithora"],"689":["Barbaracle","Thanathora"],"690":["Skrelp","Algitt"],"691":["Dragalge","Tandrak"],"692":["Clauncher","Scampisto"],"693":["Clawitzer","Wummer"],"694":["Helioptile","Eguana"],"695":["Heliolisk","Elezard"],"696":["Tyrunt","Balgoras"],"697":["Tyrantrum","Monargoras"],"698":["Amaura","Amarino"],"699":["Aurorus","Amagarga"],"700":["Sylveon","Feelinara"],"701":["Hawlucha","Resladero"],"702":["Dedenne","Dedenne"],"703":["Carbink","Rocara"],"704":["Goomy","Viscora"],"705":["Sliggoo","Viscargot"],"706":["Goodra","Viscogon"],"707":["Klefki","Clavion"],"708":["Phantump","Paragoni"],"709":["Trevenant","Trombork"],"710":["Pumpkaboo","Irrbis"],"711":["Gourgeist","Pumpdjinn"],"712":["Bergmite","Arktip"],"713":["Avalugg","Arktilas"],"714":["Noibat","eF-eM"],"715":["Noivern","UHaFnir"],"716":["Xerneas","Xerneas"],"717":["Yveltal","Yveltal"],"718":["Zygarde","Zygarde"],"719":["Diancie","Diancie"],"720":["Hoopa","Hoopa"],"721":["Volcanion","Volcanion"],"722":["Rowlet","Bauz"],"723":["Dartrix","Arboretoss"],"724":["Decidueye","Silvarro"],"725":["Litten","Flamiau"],"726":["Torracat","Miezunder"],"727":["Incineroar","Fuegro"],"728":["Popplio","Robball"],"729":["Brionne","Marikeck"],"730":["Primarina","Primarene"],"731":["Pikipek","Peppeck"],"732":["Trumbeak","Trompeck"],"733":["Toucannon","Tukanon"],"734":["Yungoos","Mangunior"],"735":["Gumshoos","Manguspektor"],"736":["Grubbin","Mabula"],"737":["Charjabug","Akkup"],"738":["Vikavolt","Donarion"],"739":["Crabrawler","Krabbox"],"740":["Crabominable","Krawell"],"741":["Oricorio","Choreogel"],"742":["Cutiefly","Wommel"],"743":["Ribombee","Bandelby"],"744":["Rockruff","Wuffels"],"745":["Lycanroc","Wolwerock"],"746":["Wishiwashi","Lusardin"],"747":["Mareanie","Garstella"],"748":["Toxapex","Aggrostella"],"749":["Mudbray","Pampuli"],"750":["Mudsdale","Pampross"],"751":["Dewpider","Araqua"],"752":["Araquanid","Aranestro"],"753":["Fomantis","Imantis"],"754":["Lurantis","Mantidea"],"755":["Morelull","Bubungus"],"756":["Shiinotic","Lamellux"],"757":["Salandit","Molunk"],"758":["Salazzle","Amfira"],"759":["Stufful","Velursi"],"760":["Bewear","Kosturso"],"761":["Bounsweet","Frubberl"],"762":["Steenee","Frubaila"],"763":["Tsareena","Fruyal"],"764":["Comfey","Curelei"],"765":["Oranguru","Kommandutan"],"766":["Passimian","Quartermak"],"767":["Wimpod","Reißlaus"],"768":["Golisopod","Tectass"],"769":["Sandygast","Sankabuh"],"770":["Palossand","Colossand"],"771":["Pyukumuku","Gufa"],"772":["Type: Null","Typ:Null"],"773":["Silvally","Amigento"],"774":["Minior","Meteno"],"775":["Komala","Koalelu"],"776":["Turtonator","Tortunator"],"777":["Togedemaru","Togedemaru"],"778":["Mimikyu","Mimigma"],"779":["Bruxish","Knirfish"],"780":["Drampa","Sen-Long"],"781":["Dhelmise","Moruda"],"782":["Jangmo-o","Miniras"],"783":["Hakamo-o","Mediras"],"784":["Kommo-o","Grandiras"],"785":["Tapu Koko","Kapu-Riki"],"786":["Tapu Lele","Kapu-Fala"],"787":["Tapu Bulu","Kapu-Toro"],"788":["Tapu Fini","Kapu-Kime"],"789":["Cosmog","Cosmog"],"790":["Cosmoem","Cosmovum"],"791":["Solgaleo","Solgaleo"],"792":["Lunala","Lunala"],"793":["Nihilego","Anego"],"794":["Buzzwole","Masskito"],"795":["Pheromosa","Schabelle"],"796":["Xurkitree","Voltriant"],"797":["Celesteela","Kaguron"],"798":["Kartana","Katagami"],"799":["Guzzlord","Schlingking"],"800":["Necrozma","Necrozma"],"801":["Magearna","Magearna"],"802":["Marshadow","Marshadow"],"803":["Poipole","Venicro"],"804":["Naganadel","Agoyon"],"805":["Stakataka","Muramura"],"806":["Blacephalon","Kopplosio"],"807":["Zeraora","Zeraora"],"808":["Meltan","Meltan"],"809":["Melmetal","Melmetal"],"810":["Grookey","Chimpep"],"811":["Thwackey","Chimstix"],"812":["Rillaboom","Gortrom"],"813":["Scorbunny","Hopplo"],"814":["Raboot","Kickerlo"],"815":["Cinderace","Liberlo"],"816":["Sobble","Memmeon"],"817":["Drizzile","Phlegleon"],"818":["Inteleon","Intelleon"],"819":["Skwovet","Raffel"],"820":["Greedent","Schlaraffel"],"821":["Rookidee","Meikro"],"822":["Corvisquire","Kranoviz"],"823":["Corviknight","Krarmor"],"824":["Blipbug","Sensect"],"825":["Dottler","Keradar"],"826":["Orbeetle","Maritellit"],"827":["Nickit","Kleptifux"],"828":["Thievul","Gaunux"],"829":["Gossifleur","Cottini"],"830":["Eldegoss","Cottomi"],"831":["Wooloo","Wolly"],"832":["Dubwool","Zwollock"],"833":["Chewtle","Kamehaps"],"834":["Drednaw","Kamalm"],"835":["Yamper","Voldi"],"836":["Boltund","Bellektro"],"837":["Rolycoly","Klonkett"],"838":["Carkol","Wagong"],"839":["Coalossal","Montecarbo"],"840":["Applin","Knapfel"],"841":["Flapple","Drapfel"],"842":["Appletun","Schlapfel"],"843":["Silicobra","Salanga"],"844":["Sandaconda","Sanaconda"],"845":["Cramorant","Urgl"],"846":["Arrokuda","Pikuda"],"847":["Barraskewda","Barrakiefa"],"848":["Toxel","Toxel"],"849":["Toxtricity","Riffex"],"850":["Sizzlipede","Thermopod"],"851":["Centiskorch","Infernopod"],"852":["Clobbopus","Klopptopus"],"853":["Grapploct","Kaocto"],"854":["Sinistea","Fatalitee"],"855":["Polteageist","Mortipot"],"856":["Hatenna","Brimova"],"857":["Hattrem","Brimano"],"858":["Hatterene","Silembrim"],"859":["Impidimp","Bähmon"],"860":["Morgrem","Pelzebub"],"861":["Grimmsnarl","Olangaar"],"862":["Obstagoon","Barrikadax"],"863":["Perrserker","Mauzinger"],"864":["Cursola","Gorgasonn"],"865":["Sirfetch'd","Lauchzelot"],"866":["Mr. Rime","Pantifrost"],"867":["Runerigus","Oghnatoll"],"868":["Milcery","Hokumil"],"869":["Alcremie","Pokusan"],"870":["Falinks","Legios"],"871":["Pincurchin","Britzigel"],"872":["Snom","Snomnom"],"873":["Frosmoth","Mottineva"],"874":["Stonjourner","Humanolith"],"875":["Eiscue","Kubuin"],"876":["Indeedee","Servol"],"877":["Morpeko","Morpeko"],"878":["Cufant","Kupfanti"],"879":["Copperajah","Patinaraja"],"880":["Dracozolt","Lectragon"],"881":["Arctozolt","Lecryodon"],"882":["Dracovish","Pescragon"],"883":["Arctovish","Pescryodon"],"884":["Duraludon","Duraludon"],"885":["Dreepy","Grolldra"],"886":["Drakloak","Phandra"],"887":["Dragapult","Katapuldra"],"888":["Zacian","Zacian"],"889":["Zamazenta","Zamazenta"],"890":["Eternatus","Endynalos"],"891":["Kubfu","Dakuma"],"892":["Urshifu","Wulaosu"],"893":["Zarude","Zarude"],"894":["Regieleki","Regieleki"],"895":["Regidrago","Regidrago"],"896":["Glastrier","Polaross"],"897":["Spectrier","Phantoross"],"898":["Calyrex","Coronospa"],"899":["Wyrdeer","Damythir"],"900":["Kleavor","Axantor"],"901":["Ursaluna","Ursaluna"],"902":["Basculegion","Salmagnis"],"903":["Sneasler","Snieboss"],"904":["Overqwil","Myriador"],"905":["Enamorus","Cupidos"],"906":["Sprigatito","Felori"],"907":["Floragato","Feliospa"],"908":["Meowscarada","Maskagato"],"909":["Fuecoco","Krokel"],"910":["Crocalor","Lokroko"],"911":["Skeledirge","Skelokrok"],"912":["Quaxly","Kwaks"],"913":["Quaxwell","Fuentente"],"914":["Quaquaval","Bailonda"],"915":["Lechonk","Ferkuli"],"916":["Oinkologne","Fragrunz"],"917":["Tarountula","Tarundel"],"918":["Spidops","Spinsidias"],"919":["Nymble","Micrick"],"920":["Lokix","Lextremo"],"921":["Pawmi","Pamo"],"922":["Pawmo","Pamamo"],"923":["Pawmot","Pamomamo"],"924":["Tandemaus","Zwieps"],"925":["Maushold","Famieps"],"926":["Fidough","Hefel"],"927":["Dachsbun","Backel"],"928":["Smoliv","Olini"],"929":["Dolliv","Olivinio"],"930":["Arboliva","Olithena"],"931":["Squawkabilly","Krawalloro"],"932":["Nacli","Geosali"],"933":["Naclstack","Sedisal"],"934":["Garganacl","Saltigant"],"935":["Charcadet","Knarbon"],"936":["Armarouge","Crimanzo"],"937":["Ceruledge","Azugladis"],"938":["Tadbulb","Blipp"],"939":["Bellibolt","Wampitz"],"940":["Wattrel","Voltrel"],"941":["Kilowattrel","Voltrean"],"942":["Maschiff","Mobtiff"],"943":["Mabosstiff","Mastifioso"],"944":["Shroodle","Sproxi"],"945":["Grafaiai","Affiti"],"946":["Bramblin","Weherba"],"947":["Brambleghast","Horrerba"],"948":["Toedscool","Tentagra"],"949":["Toedscruel","Tenterra"],"950":["Klawf","Klibbe"],"951":["Capsakid","Chilingel"],"952":["Scovillain","Halupenjo"],"953":["Rellor","Relluk"],"954":["Rabsca","Skarabaks"],"955":["Flittle","Flattutu"],"956":["Espathra","Psiopatra"],"957":["Tinkatink","Forgita"],"958":["Tinkatuff","Tafforgita"],"959":["Tinkaton","Granforgita"],"960":["Wiglett","Schligda"],"961":["Wugtrio","Schligdri"],"962":["Bombirdier","Adebom"],"963":["Finizen","Normifin"],"964":["Palafin","Delfinator"],"965":["Varoom","Knattox"],"966":["Revavroom","Knattatox"],"967":["Cyclizar","Mopex"],"968":["Orthworm","Schlurm"],"969":["Glimmet","Lumispross"],"970":["Glimmora","Lumiflora"],"971":["Greavard","Gruff"],"972":["Houndstone","Friedwuff"],"973":["Flamigo","Flaminkno"],"974":["Cetoddle","Flaniwal"],"975":["Cetitan","Kolowal"],"976":["Veluza","Agiluza"],"977":["Dondozo","Heerashai"],"978":["Tatsugiri","Nigiragi"],"979":["Annihilape","Epitaff"],"980":["Clodsire","Suelord"],"981":["Farigiraf","Farigiraf"],"982":["Dudunsparce","Dummimisel"],"983":["Kingambit","Gladimperio"],"984":["Great Tusk","Riesenzahn"],"985":["Scream Tail","Brüllschweif"],"986":["Brute Bonnet","Wutpilz"],"987":["Flutter Mane","Flatterhaar"],"988":["Slither Wing","Kriechflügel"],"989":["Sandy Shocks","Sandfell"],"990":["Iron Treads","Eisenrad"],"991":["Iron Bundle","Eisenbündel"],"992":["Iron Hands","Eisenhand"],"993":["Iron Jugulis","Eisenhals"],"994":["Iron Moth","Eisenfalter"],"995":["Iron Thorns","Eisendorn"],"996":["Frigibax","Frospino"],"997":["Arctibax","Cryospino"],"998":["Baxcalibur","Espinodon"],"999":["Gimmighoul","Gierspenst"],"1000":["Gholdengo","Monetigo"],"1001":["Wo-Chien","Chongjian"],"1002":["Chien-Pao","Baojian"],"1003":["Ting-Lu","Dinglu"],"1004":["Chi-Yu","Yuyu"],"1005":["Roaring Moon","Donnersichel"],"1006":["Iron Valiant","Eisenkrieger"],"1007":["Koraidon","Koraidon"],"1008":["Miraidon","Miraidon"],"1009":["Walking Wake","Windewoge"],"1010":["Iron Leaves","Eisenblatt"],"1011":["Dipplin","Sirapfel"],"1012":["Poltchageist","Mortcha"],"1013":["Sinistcha","Fatalitcha"],"1014":["Okidogi","Boninu"],"1015":["Munkidori","Benesaru"],"1016":["Fezandipiti","Beatori"],"1017":["Ogerpon","Ogerpon"],"1018":["Archaludon","Briduradon"],"1019":["Hydrapple","Hydrapfel"],"1020":["Gouging Fire","Keilflamme"],"1021":["Raging Bolt","Furienblitz"],"1022":["Iron Boulder","Eisenfels"],"1023":["Iron Crown","Eisenhaupt"],"1024":["Terapagos","Terapagos"],"1025":["Pecharunt","Infamomo"]}`);

// Lookup tables built once at module load — case-insensitive
const _DEX_BY_EN = (() => {
  const m = {};
  for (const [dex, [en]] of Object.entries(POKEMON_NAMES)) {
    m[en.toLowerCase()] = +dex;
  }
  return m;
})();
const _DEX_BY_DE = (() => {
  const m = {};
  for (const [dex, [, de]] of Object.entries(POKEMON_NAMES)) {
    m[de.toLowerCase()] = +dex;
  }
  return m;
})();

// Resolve any input (number/EN/DE/case-insensitive) → canonical lowercase German name.
// Returns null if not found. Strips +prefix and #tags.
function resolveSpecies(input) {
  const raw = String(input || "").trim().replace(/^\+/, "");
  if (!raw) return null;
  // Pure number (1-1025) — strip leading zeros so "0001" works too
  if (/^\d+$/.test(raw)) {
    const dexStr = String(parseInt(raw, 10));
    const entry = POKEMON_NAMES[dexStr];
    return entry ? entry[1].toLowerCase() : null;
  }
  const lower = raw.toLowerCase();
  // German match (passthrough for already-correct German input)
  if (_DEX_BY_DE[lower]) {
    const dex = _DEX_BY_DE[lower];
    return POKEMON_NAMES[String(dex)][1].toLowerCase();
  }
  // English match
  if (_DEX_BY_EN[lower]) {
    const dex = _DEX_BY_EN[lower];
    return POKEMON_NAMES[String(dex)][1].toLowerCase();
  }
  return null;
}

// Returns full info for an input — useful for showing "[EN] → [DE] (#dex)" feedback
function resolveSpeciesInfo(input) {
  const raw = String(input || "").trim().replace(/^\+/, "");
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const dex = parseInt(raw, 10);
    const entry = POKEMON_NAMES[String(dex)];
    return entry ? { dex, en: entry[0], de: entry[1], inputType: "number" } : null;
  }
  const lower = raw.toLowerCase();
  if (_DEX_BY_DE[lower]) {
    const dex = _DEX_BY_DE[lower];
    return { dex, en: POKEMON_NAMES[String(dex)][0], de: POKEMON_NAMES[String(dex)][1], inputType: "german" };
  }
  if (_DEX_BY_EN[lower]) {
    const dex = _DEX_BY_EN[lower];
    return { dex, en: POKEMON_NAMES[String(dex)][0], de: POKEMON_NAMES[String(dex)][1], inputType: "english" };
  }
  return null;
}

// ─── FILTER GENERATION (set-theoretic) ────────────────────────────────────

function deduppedTradeEvos(hundos, enabled) {
  const hundoSet = new Set(hundos.map(h => h.toLowerCase()));
  const trimmed = [];
  const full = [];
  for (const base of enabled) {
    const family = TRADE_EVO_FAMILIES[base];
    if (!family) continue;
    full.push(base);
    const overlapsH = family.some(m => hundoSet.has(m));
    if (!overlapsH) trimmed.push(base);
  }
  return { full, trimmed };
}

// Helper: split comma-separated tag list, returning array of trimmed tag names.
function parseTagList(s) {
  return (s || "").split(",").map(t => t.trim()).filter(Boolean);
}

// Helper: collapse collectors to family names where possible.
function collapseFamilies(speciesList, familyCollapses) {
  const remaining = new Set(speciesList);
  const out = [];
  for (const [familyTag, members] of Object.entries(familyCollapses)) {
    if (members.every(m => remaining.has(m))) {
      out.push(familyTag);
      members.forEach(m => remaining.delete(m));
    }
  }
  for (const sp of speciesList) {
    if (remaining.has(sp)) out.push(sp);
  }
  return out;
}

function buildFilters(hundos, cfg, homeLocals = []) {
  const H = hundos.map(h => `+${h}`).join(",");
  const { full: TE_full, trimmed: TE_trim } = deduppedTradeEvos(hundos, cfg.enabledTradeEvos);
  const TE_full_str = TE_full.map(b => `+${TE_DISPLAY[b]}`).join(",");
  const TE_trim_str = TE_trim.map(b => `+${TE_DISPLAY[b]}`).join(",");

  // PoGo's IV-bucket filter accepts ranges like `0-2angriffs-wert` (works alone),
  // but SILENTLY IGNORES `!N` negation on IV tokens — `!4angriffs-wert` is a no-op.
  // So we encode "atk ≠ 4" as the positive range `0-3angriffs-wert` instead.
  //
  // Buckets: 0 = 0 IV, 1 = 1-5, 2 = 6-10, 3 = 11-14, 4 = 15

  // ¬P clause depending on PvP mode
  const notP = cfg.pvpMode === "loose"  ? "2-4angriffs-wert,0-2verteidigungs-wert,0-2kp"
            : cfg.pvpMode === "strict" ? "1-4angriffs-wert,0-2verteidigungs-wert,0-2kp"
            : null; // none → no PvP keep

  const S012 = "0*,1*,2*";

  // Configurable lists
  const leagueTags = parseTagList(cfg.leagueTags);
  const customTags = parseTagList(cfg.customProtectedTags);
  const basarTag = (cfg.basarTagName || "").trim();
  const fernTauschTag = (cfg.fernTauschTagName || "").trim();

  // Each clause is { clause: string, why: string } so the UI can explain attribution.
  const trashClauses = [];
  const tradeClauses = [];
  const push = (arr, clause, why) => arr.push({ clause, why });

  // ── TRASH ──────────────────────────────────────────────────────────────
  // ¬K1 = ¬(4atk ∧ 4def ∧ ≥3hp) = (atk≤3) ∨ (def≤3) ∨ (hp≤2)
  // ¬K2 = ¬(4atk ∧ ≥3def ∧ 4hp) = (atk≤3) ∨ (def≤2) ∨ (hp≤3)
  // ¬K3 = ¬(≥3atk ∧ 4def ∧ 4hp) = (atk≤2) ∨ (def≤3) ∨ (hp≤3)
  // Trade-evo escape: when on, protect trade-evolution candidates from trash —
  // BUT only if they haven't already been traded (a traded one gets no free evo).
  //
  // Set theory: Trash = T ∩ ¬(F ∩ ¬G) = T ∩ (¬F ∪ G), where F = TE families, G = getauscht.
  // ¬F = ⋂ ¬Familyᵢ. By distribution: (⋂ ¬Familyᵢ) ∪ G = ⋂ (¬Familyᵢ ∪ G).
  // → one filter clause per TE family: `!+Family,getauscht`.
  push(trashClauses, [S012, H].filter(Boolean).join(","), "Set H ∪ S012 — Spezies-Filter");
  push(trashClauses, `${S012},0-3angriffs-wert,0-3verteidigungs-wert,0-2kp`, "¬K1 — Keeper-Schutz (4,4,3-4)");
  push(trashClauses, `${S012},0-3angriffs-wert,0-2verteidigungs-wert,0-3kp`, "¬K2 — Keeper-Schutz (4,3-4,4)");
  push(trashClauses, `${S012},0-2angriffs-wert,0-3verteidigungs-wert,0-3kp`, "¬K3 — Keeper-Schutz (3-4,4,4)");
  if (notP) push(trashClauses, notP, `¬P — PvP-Schutz (${cfg.pvpMode})`);

  if (cfg.protectTradeEvos && TE_full.length > 0) {
    for (const base of TE_full) {
      const display = TE_DISPLAY[base];
      push(trashClauses, `!+${display},getauscht`,
        `Tausch-Evo: +${display}-Familie (außer schon getauscht — dann ist die Gratis-Evo verbraucht)`);
    }
  }

  // Regel 1: niemals 4★ tossen. Default-on, expert-mode kann deaktivieren.
  // Note: technisch redundant da ¬K1/¬K2/¬K3 alle 4★ schon ausschließen — aber
  // explizit ist ein zusätzlicher Sicherheitsgürtel falls jemand die IV-Klauseln
  // versehentlich entfernt oder modifiziert.
  if (cfg.protectFourStar) {
    push(trashClauses, "!4*", "Regel 1: niemals 4★ Pokémon tossen (Sicherheitsgürtel)");
  }

  // Tag protections.
  // If the catch-all `!#` (any tag) is on, individual tag clauses are redundant
  // (any of {Basar, Fern-Tausch, custom, buddy-prefixes} would already match `!#`), so skip them.
  const activeBuddies = (cfg.buddies || []).filter(b => b.active !== false && b.tagPrefix);
  if (cfg.protectAnyTag) {
    push(trashClauses, "!#", "irgendein Tag — egal welches, geschützt");
  } else {
    if (basarTag) push(trashClauses, `!#${basarTag}`, `dein Tausch-Sammeltag #${basarTag}`);
    if (fernTauschTag) push(trashClauses, `!#${fernTauschTag}`, `Niantic-Tag #${fernTauschTag} (Fern-Tausche)`);
    for (const t of customTags) push(trashClauses, `!#${t}`, `dein Custom-Tag #${t}`);
    for (const b of activeBuddies) {
      const prefix = b.tagPrefix.replace(/^#/, "");
      push(trashClauses, `!#${prefix}`, `Tausch-Buddy ${b.name}: alles mit #${prefix}-Präfix (Substring-Match)`);
    }
  }

  // Universal protections
  if (cfg.protectFavorites)    push(trashClauses, "!favorit", "Favoriten");
  if (cfg.protectShinies)      push(trashClauses, "!schillernd", "Schillernde");
  if (cfg.protectLegendaries)  push(trashClauses, "!legendär", "Legendäre");
  if (cfg.protectMythicals) {
    const carve = (cfg.mythTooManyOf || "").trim();
    push(trashClauses,
      carve ? `!mysteriös,${carve}` : "!mysteriös",
      carve
        ? `Mysteriöse außer Spezies ${carve} (du hast Spares von denen)`
        : "Mysteriöse Pokémon");
  }
  if (cfg.protectUltraBeasts)  push(trashClauses, "!ultrabestien", "Ultrabestien");
  if (cfg.protectShadows)      push(trashClauses, "!crypto", "Crypto-Pokémon");
  if (cfg.protectCostumes)     push(trashClauses, "!kostümiert", "Kostümierte (Event-Forms)");
  if (cfg.protectLuckies)      push(trashClauses, "!glücks", "Glücks-Pokémon");
  if (cfg.protectBackgrounds)  push(trashClauses, "!hintergrund", "Pokémon mit Hintergrund");
  if (cfg.protectDynamax)      push(trashClauses, "!dynaattacke1-", "Dynamax-fähige");
  if (cfg.protectNewEvolutions) push(trashClauses, "!neueentwicklung,mega0", "Neue Evolutionen (Trick: nur falls noch nicht mega'd — sonst hast du genug Mega-Energie)");
  if (cfg.protectLegacyMoves)  push(trashClauses, "!@spezial", "Legacy-Attacken");
  if (cfg.protectBabies)       push(trashClauses, "!nurauseiern", "Baby-Pokémon (nur aus Eiern)");
  if (cfg.distanceProtect && cfg.distanceProtect > 0)
    push(trashClauses, `!entfernung${cfg.distanceProtect}-,getauscht`, `Distanz ≥${cfg.distanceProtect}km — Pilot-Medaillen-Schutz`);
  if (cfg.protectXXL)          push(trashClauses, "!xxl", "XXL Pokémon (Größe)");
  if (cfg.protectXL)           push(trashClauses, "!xl",  "XL Pokémon (Größe)");
  if (cfg.protectXXS)          push(trashClauses, "!xxs", "XXS Pokémon (Größe)");
  for (const t of leagueTags)  push(trashClauses, `!${t}`, `dein Liga-Tag ${t}`);
  if (cfg.protectBuddies)      push(trashClauses, "!kumpel1-", "Schon mal Kumpel gewesen");
  if (cfg.protectDoubleMoved)  push(trashClauses, "@3move", "Zweiter Charge-Move freigeschaltet (@3move ist invertiert!)");

  // Regional groups
  const groups = cfg.regionalGroups || {};
  const hundoLower = new Set(hundos.map(s => s.toLowerCase()));
  for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
    const state = groups[key];
    if (!state || !state.enabled) continue;
    for (const tc of group.typeChecks) {
      if (state.typeChecksEnabled !== null && !state.typeChecksEnabled.includes(tc.species)) continue;
      push(trashClauses, `!${tc.species},!${tc.type}`, `${group.label}: ${tc.note}`);
    }
    // Collectors — collapse to +Family where complete
    const enabledCollectors = group.collectors.filter(sp => {
      if (state.collectorsEnabled !== null && !state.collectorsEnabled.includes(sp)) return false;
      if (hundoLower.has(sp.toLowerCase())) return false;  // skip hundo overlaps
      return true;
    });
    const collapsed = collapseFamilies(enabledCollectors, FAMILY_COLLAPSES);
    for (const entry of collapsed) {
      push(trashClauses, `!${entry}`,
        entry.startsWith("+")
          ? `${group.label}: ${entry} (alle Familien-Mitglieder)`
          : `${group.label}: ${entry}`);
    }
  }
  // Custom collectibles — user-added species to protect.
  // Skip ones in hundo list (would conflict with H widening) and ones already
  // covered by regional groups (avoid duplicate clauses).
  const allRegionalCollectors = new Set(
    Object.values(REGIONAL_GROUPS).flatMap(g => g.collectors).map(s => s.toLowerCase())
  );
  for (const sp of (cfg.customCollectibles || [])) {
    const lower = sp.toLowerCase();
    if (hundoLower.has(lower)) continue;
    if (allRegionalCollectors.has(lower)) continue;
    // Capitalize first letter for the filter (PoGo names are usually capitalized)
    const display = sp.charAt(0).toUpperCase() + sp.slice(1);
    push(trashClauses, `!${display}`, `Eigene Sammler-Pokémon: ${display}`);
  }
  if (cfg.cpCap && cfg.cpCap > 0)
    push(trashClauses, `wp-${cfg.cpCap}`, `Sicherheitsnetz: WP ≤ ${cfg.cpCap}`);
  if (cfg.ageScopeDays && cfg.ageScopeDays > 0)
    push(trashClauses, `alter-${cfg.ageScopeDays},getauscht`, `Sicherheitsnetz: vor ≤${cfg.ageScopeDays} Tagen gefangen ODER getauscht`);

  const trash = trashClauses.map(c => c.clause).join("&");

  // ── TRADE ──────────────────────────────────────────────────────────────
  push(tradeClauses, [S012, TE_trim_str, H].filter(Boolean).join(","), "Set H ∪ S012 ∪ TE — Spezies (TE-trimmed)");
  push(tradeClauses, [S012, TE_full_str, "0-3angriffs-wert,0-3verteidigungs-wert,0-2kp"].filter(Boolean).join(","), "¬K1 mit TE-Escape");
  push(tradeClauses, [S012, TE_full_str, "0-3angriffs-wert,0-2verteidigungs-wert,0-3kp"].filter(Boolean).join(","), "¬K2 mit TE-Escape");
  push(tradeClauses, [S012, TE_full_str, "0-2angriffs-wert,0-3verteidigungs-wert,0-3kp"].filter(Boolean).join(","), "¬K3 mit TE-Escape");
  if (notP) push(tradeClauses, notP, `¬P — PvP-Schutz (${cfg.pvpMode})`);

  // Mandatory: cannot re-trade, cannot trade Crypto/Lucky/Mythical (except Meltan/Melmetal #808/#809).
  // These are physical game constraints, not user preferences — they always apply.
  push(tradeClauses, "!getauscht", "PFLICHT: schon getauschte Pokémon können nicht erneut getauscht werden");
  push(tradeClauses, "!crypto", "PFLICHT: Crypto-Pokémon können nicht getauscht werden");
  push(tradeClauses, "!glücks", "PFLICHT: Glücks-Pokémon können nicht erneut getauscht werden (waren schon ein Tausch)");
  // Mythicals: untradable EXCEPT Meltan (808) and Melmetal (809) — special trade only
  push(tradeClauses, "!mysteriös,808,809", "PFLICHT: Mysteriöse nicht tauschbar (außer Meltan/Melmetal via Spezial-Tausch)");
  // Tag protections — same catch-all-vs-specific pattern as trash
  if (cfg.protectAnyTag) {
    push(tradeClauses, "!#", "irgendein Tag — egal welches, nicht für Massen-Tausch");
  } else {
    if (basarTag) push(tradeClauses, `!#${basarTag}`,
      `dein Tausch-Sammeltag #${basarTag} (zeigt nur das, was du noch NICHT zum Tausch markiert hast — getauscht-Listen-Verwaltung)`);
    if (fernTauschTag) push(tradeClauses, `!#${fernTauschTag}`, `Niantic-Tag #${fernTauschTag}`);
    for (const t of customTags) push(tradeClauses, `!#${t}`, `dein Custom-Tag #${t}`);
  }

  if (cfg.protectLegendaries)  push(tradeClauses, "!legendär", "Legendäre");
  if (cfg.protectUltraBeasts)  push(tradeClauses, "!ultrabestien", "Ultrabestien");
  if (cfg.protectShinies)      push(tradeClauses, "!schillernd", "Schillernde (zu wertvoll für Massentausch)");
  if (cfg.protectCostumes)     push(tradeClauses, "!kostümiert", "Kostümierte");
  if (cfg.protectPurified)     push(tradeClauses, "!erlöst", "Erlöste (= ehemals Crypto, verlieren Bonus beim Tausch)");
  if (cfg.protectBackgrounds)  push(tradeClauses, "!hintergrund", "Mit Hintergrund");
  if (cfg.protectFavorites)    push(tradeClauses, "!favorit", "Favoriten");
  push(tradeClauses, "!4*", "Regel 1 explizit: niemals 4★ tauschen");
  for (const t of leagueTags)  push(tradeClauses, `!${t}`, `dein Liga-Tag ${t}`);
  if (cfg.protectDoubleMoved)  push(tradeClauses, "@3move", "Zweiter Charge-Move freigeschaltet");
  if (cfg.protectDynamax)      push(tradeClauses, "!dynaattacke1-", "Dynamax-fähige");
  if (cfg.protectXXL)          push(tradeClauses, "!xxl", "XXL Größe");
  if (cfg.protectXL)           push(tradeClauses, "!xl",  "XL Größe");
  // XXS not in original trade filter — too small a category to bother
  if (cfg.protectLegacyMoves)  push(tradeClauses, "!@spezial", "Legacy-Attacken");
  if (cfg.ageScopeDays && cfg.ageScopeDays > 0)
    push(tradeClauses, `alter-${cfg.ageScopeDays}`, `Sicherheitsnetz: ≤${cfg.ageScopeDays} Tage alt`);
  push(tradeClauses, "entfernung0-", "Sicherheitsnetz: Entfernung > 0km (= war mal woanders)");

  const trade = tradeClauses.map(c => c.clause).join("&");

  // ── PRE-STAGED TRADES ──────────────────────────────────────────────────
  // Just shows what's already tagged for trade — no IV/protection logic.
  // Useful for visiting your "ready to trade" pile.
  const prestagedClauses = [];
  const tagList = [];
  if (basarTag)      tagList.push(`#${basarTag}`);
  if (fernTauschTag) tagList.push(`#${fernTauschTag}`);
  if (tagList.length > 0) {
    push(prestagedClauses, tagList.join(","), `bereits markiert (#${basarTag}${fernTauschTag ? ` oder #${fernTauschTag}` : ""})`);
    push(prestagedClauses, "!getauscht", "PFLICHT: schon getauscht");
    push(prestagedClauses, "!crypto", "PFLICHT: Crypto nicht tauschbar");
    push(prestagedClauses, "!glücks", "PFLICHT: Glücks-Pokémon nicht erneut tauschbar");
    push(prestagedClauses, "!mysteriös,808,809", "PFLICHT: Mysteriöse nicht tauschbar (außer Meltan/Melmetal)");
  }
  const prestaged = prestagedClauses.map(c => c.clause).join("&");

  // ── BUDDY FILTERS ──────────────────────────────────────────────────────
  // For each buddy with target species (or trade-evo opt-in), generate a
  // "catch for buddy" filter: trashable (0-2★) Pokémon of the species the
  // buddy wants, not yet tagged. The point is to find candidates to tag —
  // not to look up what's already tagged (a single `#Anna` search does that).
  const buddyCatchFilters = []; // [{ buddyName, prefix, filter, clauses }]
  for (const b of activeBuddies) {
    const prefix = b.tagPrefix.replace(/^#/, "");
    const targets = (b.targetSpecies || []).filter(Boolean);
    const wantsTE = !!b.wantsTradeEvos && TE_full.length > 0;
    if (targets.length === 0 && !wantsTE) continue;

    const catchClauses = [];
    const speciesParts = [
      ...targets.map(s => `+${s}`),
      ...(wantsTE ? TE_full.map(base => `+${TE_DISPLAY[base]}`) : []),
    ];
    const why = [
      targets.length > 0 ? `${targets.length} Wunsch-Spezies` : null,
      wantsTE ? `${TE_full.length} Tausch-Evo-Familien` : null,
    ].filter(Boolean).join(" + ");
    push(catchClauses, speciesParts.join(","), `${b.name}: ${why}`);
    push(catchClauses, "0*,1*,2*", "nur trashbare Sterne (0-2★) — 3★+ behältst du selbst");
    push(catchClauses, "!#", "nicht schon irgendwie getaggt");
    push(catchClauses, "!favorit", "Favoriten geschützt");
    push(catchClauses, "!getauscht", "PFLICHT: schon getauscht");
    push(catchClauses, "!crypto", "PFLICHT: Crypto nicht tauschbar");
    push(catchClauses, "!glücks", "PFLICHT: Glücks-Pokémon nicht erneut tauschbar");
    push(catchClauses, "!mysteriös,808,809", "PFLICHT: Mysteriöse nicht tauschbar (außer Meltan/Melmetal)");
    push(catchClauses, "!schillernd", "Schillernde behältst du selbst");
    push(catchClauses, "!legendär", "Legendäre behältst du selbst");
    buddyCatchFilters.push({
      buddyName: b.name,
      prefix,
      filter: catchClauses.map(c => c.clause).join("&"),
      clauses: catchClauses,
    });
  }

  // ── HUNDO-SORT ─────────────────────────────────────────────────────────
  // A quick "show me everything in my hundo families that isn't already protected"
  // filter — useful for sorting/managing your hundo lines. Only meaningful when
  // hundos exist; returns "" otherwise.
  const sortClauses = [];
  if (hundos.length > 0) {
    push(sortClauses, H, "alle Hundo-Familien (Sortierung)");
    if (cfg.protectAnyTag)   push(sortClauses, "!#", "alle Tags geschützt");
    if (cfg.protectFavorites) push(sortClauses, "!favorit", "Favoriten geschützt");
    if (cfg.protectShinies)  push(sortClauses, "!schillernd", "Schillernde geschützt");
    if (cfg.protectLuckies)  push(sortClauses, "!glücks", "Glücks geschützt");
  }
  const sort = sortClauses.map(c => c.clause).join("&");

  // ── GIFT FILTER ────────────────────────────────────────────────────────
  // High-value Pokémon worth gifting to far-away friends — flips trash logic.
  // SHOW: shinies ∪ legendaries ∪ ultrabeasts ∪ costumes ∪ backgrounds ∪ home-locals
  // STRIP (untradeable / dangerous): mythicals, luckies, crypto, legacy moves
  // STRIP (you keep): 4★ hundos, favorites, traded
  // STRIP (other tags): everything tagged with NON-trade tags (preserve user's tag intent)
  const giftClauses = [];
  const valuables = ["schillernd", "legendär", "ultrabestien", "kostümiert", "hintergrund"];
  const homeLocalsList = (homeLocals || []).map(n => n).filter(Boolean);
  // Clause 1: any valuable property OR is a local regional
  const valueParts = [...valuables, ...homeLocalsList];
  if (valueParts.length > 0) {
    push(giftClauses, valueParts.join(","),
      `Wertsachen: schillernd, legendär, Ultrabestie, Kostüm, Hintergrund${homeLocalsList.length ? ` + lokale Regionale (${homeLocalsList.length})` : ""}`);
  }
  // Hard untradeable
  push(giftClauses, "!getauscht", "PFLICHT: nicht erneut tauschbar");
  push(giftClauses, "!crypto", "PFLICHT: Crypto kann nicht getauscht werden");
  push(giftClauses, "!mysteriös,808,809", "PFLICHT: Mysteriöse nicht tauschbar (außer Meltan/Melmetal)");
  push(giftClauses, "!glücks", "PFLICHT: Glücks-Pokémon sind nicht tauschbar");
  // Don't accidentally give away top stuff
  push(giftClauses, "!4*", "niemals 4★ verschenken");
  push(giftClauses, "!favorit", "Favoriten geschützt");
  push(giftClauses, "!@spezial", "Legacy-Attacken nicht verschenken");
  // Tag handling: exclude any non-trade tags but allow trade tags through
  const tagAllowList = [];
  if (basarTag)      tagAllowList.push(`#${basarTag}`);
  if (fernTauschTag) tagAllowList.push(`#${fernTauschTag}`);
  if (tagAllowList.length > 0) {
    push(giftClauses, `!#,${tagAllowList.join(",")}`,
      `untagged ODER schon zum Tausch markiert (${tagAllowList.join(", ")}) — andere Tags geschützt`);
  } else {
    push(giftClauses, "!#", "andere Tags geschützt");
  }
  const gift = giftClauses.map(c => c.clause).join("&");

  return { trash, trade, sort, prestaged, gift, buddyCatchFilters, TE_full, TE_trim,
           trashClauses, tradeClauses, sortClauses, prestagedClauses, giftClauses };
}

// ─── PARSER (for verification panel) ──────────────────────────────────────

function evalFilter(filterStr, mon) {
  const clauses = filterStr.split("&");
  return clauses.every(c => evalClause(c, mon));
}
function evalClause(c, mon) {
  for (const raw of c.split(",")) {
    const t = raw.trim();
    const negated = t.startsWith("!");
    const term = negated ? t.slice(1) : t;
    const v = evalTerm(term, mon);
    if (v === null) continue;
    if ((negated ? !v : v)) return true;
  }
  return false;
}
function evalTerm(t, mon) {
  if (t.startsWith("+")) {
    const name = t.slice(1).toLowerCase();
    return mon.families.includes(name);
  }
  let m = t.match(/^(\d+)(?:-(\d+))?\*$/);
  if (m) { const lo=+m[1], hi=m[2]?+m[2]:lo; return mon.star>=lo && mon.star<=hi; }
  m = t.match(/^(\d+)(?:-(\d+))?angriffs-wert$/);
  if (m) { const lo=+m[1], hi=m[2]?+m[2]:lo; return mon.atk>=lo && mon.atk<=hi; }
  m = t.match(/^(\d+)(?:-(\d+))?verteidigungs-wert$/);
  if (m) { const lo=+m[1], hi=m[2]?+m[2]:lo; return mon.def>=lo && mon.def<=hi; }
  m = t.match(/^(\d+)?(-)?(\d+)?kp$/);
  if (m && (m[1]||m[3])) {
    const lo = m[1]?+m[1]:0; const hi = m[3]?+m[3]:(m[2]?99:lo);
    return mon.hp>=lo && mon.hp<=hi;
  }
  m = t.match(/^entfernung(\d+)-?$/); if (m) return (mon.distance||0) >= +m[1];
  m = t.match(/^wp-?(\d+)$/);          if (m) return (mon.wp||9999) <= +m[1];
  m = t.match(/^alter-(\d+)$/);        if (m) return (mon.ageDays||9999) <= +m[1];
  m = t.match(/^jahr(\d+)-$/);         if (m) return (mon.year||0) >= 2000 + +m[1];
  m = t.match(/^(\d+)$/);              if (m) return mon.dex === +m[1];
  if (t === "kumpel1-")     return mon.flags?.buddy;
  if (t === "mega1-")       return mon.flags?.megaEvolved;
  if (t === "mega0")        return !mon.flags?.megaEvolved;
  if (t === "dynaattacke1-")return mon.flags?.dynamaxCapable;
  if (t === "#")            return mon.flags?.tagged;
  if (t === "@3move")       return !mon.flags?.doubleMoved;  // INVERTED per game
  const flagMap = {
    favorit:"favorite", schillernd:"shiny", glücks:"lucky", legendär:"legendary",
    mysteriös:"mythical", ultrabestien:"ultrabeast", crypto:"shadow",
    erlöst:"purified", kostümiert:"costume", hintergrund:"background",
    "@spezial":"legacyMove", nurauseiern:"eggOnly", xxl:"xxl", xl:"xl", xxs:"xxs",
    "ⓤ":"leagueU", "ⓖ":"leagueG", "ⓛ":"leagueL",
    neueentwicklung:"newDexEvo", getauscht:"traded",
    psycho:false, fee:false, eis:false, geist:false, unlicht:false,
    kampf:false, boden:false, gestein:false,  // type checks — for now treated as not-matching unless mon.types
  };
  if (t in flagMap) {
    const v = flagMap[t];
    if (v === false) return (mon.types || []).includes(t);
    return !!mon.flags?.[v];
  }
  return null;
}

// ─── STORAGE ──────────────────────────────────────────────────────────────

const KEY_HUNDOS = "pogo:hundos";
const KEY_CONFIG = "pogo:config";

// Storage shim: was window.storage in the Claude.ai artifact runtime.
// In the standalone app we use localStorage directly. Same async API for
// minimal code change.
async function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
async function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─── REGIONAL MAP DATA (from KMZ — u/zoglandboy / u/Mattman243 / pokemoncalendar.com) ───

const VIEW_W = 800, VIEW_H = 400;

// Real polygon geometry from PoGo Regional Map KMZ. NOT rendered visually —
// used only for point-in-polygon hit testing when the user taps the map.
const POGO_REGIONS = JSON.parse(`[{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Pom-Pom Oricorio/Yellow Flabébé/Panpour/Azelf","english":["Pom-Pom Oricorio","Yellow Flabébé","Panpour","Azelf"],"german":["Choreogel (Cheerleading)","Flabébé (gelb)","Sodamak","Tobutz"],"geometry":{"type":"Polygon","coordinates":[[[179.9788423,85.0371116],[179.4930617,-84.9676454],[-26.1197931,-85.0824329],[-23.203125,85.0207077],[179.9788423,85.0371116]]]}},{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Sensu Oricorio/Blue Flabébé/Pansage/Uxie","english":["Sensu Oricorio","Blue Flabébé","Pansage","Uxie"],"german":["Choreogel (Buyo)","Flabébé (blau)","Vegimak","Selfe"],"geometry":{"type":"Polygon","coordinates":[[[90.9771923,85.0570722],[90.1036767,64.613503],[90.0457357,54.6777412],[89.9924066,48.9758687],[89.9896598,48.7599692],[89.9855392,48.6085576],[89.9842279,48.3717998],[90.0020807,22.0296934],[86.8261326,-85.0575818],[179.4930617,-84.9676454],[179.9788423,85.0371116],[90.9771923,85.0570722]]]}},{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Baile Oricorio/Red Flabébé/Pansear/Mesprit","english":["Baile Oricorio","Red Flabébé","Pansear","Mesprit"],"german":["Choreogel (Flamenco)","Flabébé (rot)","Grillmak","Vesprit"],"geometry":{"type":"Polygon","coordinates":[[[86.8261326,-85.0575818],[89.9918303,48.9656349],[90.0462269,56.2339545],[90.9771923,85.0570722],[-23.203125,85.0207077],[-23.1787953,84.9056643],[-24.2386427,65.8003482],[-26.1197931,-85.0824329],[86.8261326,-85.0575818]]]}},{"folder":"Type 4 [Hemispheric Regionals]","name":"Chatot - Type 4 [Hemispheric Regional]","english":["Chatot"],"german":["Plaudagei"],"geometry":{"type":"Polygon","coordinates":[[[78.4737327,-0.0655574],[77.0587661,-65.8269101],[83.4967544,-65.9536888],[92.0660904,-65.9536888],[102.4371841,-65.9536888],[114.7858169,-65.9536888],[125.6403091,-65.9536888],[137.4933308,-65.9705568],[171.7706746,-65.9705568],[-152.1941692,-65.9705568],[-114.4012004,-65.9705568],[-85.0457317,-65.9705568],[-49.0105754,-65.9705568],[-12.9754192,-65.9705568],[12.9523152,-65.7909809],[27.4542683,-65.7909809],[50.8331746,-65.718798],[77.0245808,-65.8269967],[78.4692215,-0.066183],[-28.6095949,-0.0750637],[-120.5886795,-0.0690087],[145.7979514,-0.0655574],[78.4737327,-0.0655574]]]}},{"folder":"Type 3 [Paired Regional Line]","name":"Type 3 [Paired Regional Line]","english":["Type 3 [Paired Regional Line]"],"german":["Type 3 [Paired Regional Line]"],"geometry":{"type":"LineString","coordinates":[[-29.0478436,85.0397427],[-29.1357322,33.3213485],[-21.3835305,33.3385554],[-14.5557243,33.3327905],[-6.5154841,33.496424],[1.1645508,33.5413946],[9.3965509,33.5230259],[17.5122071,33.3947592],[26.916504,33.3764123],[36.2400056,33.3935447],[43.59375,33.4497766],[49.5074177,33.4598794],[54.5800781,33.4864354],[53.437502,-85.0207077]]}},{"folder":"Type 3 [Paired Regional Line]","name":"Type 3 [Paired Meridian Line]","english":["Type 3 [Paired Meridian Line]"],"german":["Type 3 [Paired Meridian Line]"],"geometry":{"type":"LineString","coordinates":[[-0.0015,-85.051],[-0.0015,51.4779],[-0.0015,85.05]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Maractus/Heracross","english":["Maractus","Heracross"],"german":["Maracamba","Skaraborn"],"geometry":{"type":"Polygon","coordinates":[[[-28.7126839,-60.8079488],[-29.0003358,28.8387285],[-31.0039204,28.8426785],[-33.0184819,28.8445857],[-35.0099838,28.8333665],[-37.0025528,28.8387736],[-39.0055406,28.8446463],[-41.002899,28.8384495],[-43.0042338,28.8359558],[-45.0014522,28.8457198],[-46.9920227,28.8428544],[-49.0138632,28.8378503],[-51.0134117,28.8391466],[-53.0015012,28.8433519],[-56.9979247,28.8399738],[-57.9907668,28.8371582],[-59.0015822,28.8384688],[-60.005754,28.8350249],[-60.9975612,28.8427744],[-61.9998994,28.8399356],[-62.9998658,28.839383],[-63.9996692,28.8398557],[-65.0000689,28.8399257],[-65.9992077,28.8401876],[-67.0000958,28.8401086],[-68.0000649,28.8399587],[-68.9999796,28.8402988],[-70.0003426,28.8401009],[-71.4878807,28.844786],[-72.4378771,28.8476871],[-73.4042996,28.8390047],[-76.3887972,28.8366705],[-79.2558588,28.8595511],[-81.0000026,28.8405108],[-82.0008589,28.8382549],[-83.5955598,28.8437688],[-85.5989242,28.8407351],[-87.1683985,28.8478368],[-88.7602735,28.8450618],[-90.2696907,28.8437939],[-91.5015451,28.8435616],[-92.7155388,28.8431238],[-93.7681432,28.8423097],[-95.1296132,28.8414159],[-96.9952763,28.8486886],[-99.5711717,28.8373746],[-100.7334133,28.8302342],[-101.8403142,28.83693],[-103.0372329,28.8386833],[-104.0691416,28.8168433],[-106.1237099,28.838453],[-107.9099433,28.8397707],[-108.4255453,28.8395984],[-108.8930633,28.8433065],[-109.811583,28.8412668],[-111.6679274,28.8419586],[-113.4914062,28.8465438],[-116.0492626,28.8602196],[-117.6440143,28.8458629],[-119.1353522,28.845896],[-120.9994904,28.8407632],[-123.9999279,28.8391765],[-125.0000215,28.8373549],[-125.9963467,28.8409241],[-127.0080506,28.8337881],[-128.0006884,28.8302599],[-128.9933704,28.8288623],[-129.2406481,-60.4394174],[-123.3079167,-60.5951658],[-115.2413217,-60.6442764],[-106.8736263,-60.6542888],[-97.5777026,-60.6538503],[-91.1512129,-60.8224591],[-86.1420809,-60.8023277],[-78.4595209,-60.8445596],[-68.6119016,-60.8928151],[-61.8343977,-60.8234963],[-50.4218225,-60.7841079],[-40.5706879,-60.9342487],[-28.7126839,-60.8079488]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Kangaskhan","english":["Kangaskhan"],"german":["Kangama"],"geometry":{"type":"Polygon","coordinates":[[[154.6435546,-50.0359736],[154.2480469,-0.3955047],[139.7460938,-0.5273363],[139.7460938,-10.9196178],[124.9907865,-11.1567369],[118.1733601,-10.983058],[111.6210938,-11.0921659],[111.4453125,-50.0641917],[120.7617188,-50.0641917],[124.994723,-50.1057947],[129.3750001,-50.0641917],[136.7578125,-49.9512199],[144.6679688,-50.0641917],[150.6445313,-50.0641917],[154.6435546,-50.0359736]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Relicanth","english":["Relicanth"],"german":["Relicanth"],"geometry":{"type":"Polygon","coordinates":[[[154.6435546,-50.0359736],[158.0273438,-50.0641917],[162.3779297,-50.1768981],[165.1068748,-50.2661105],[168.0029297,-50.1768982],[171.5185547,-50.2893392],[175.78125,-50.2893393],[-179.1142346,-50.2654442],[-172.6369959,-50.3012819],[-167.1034055,-50.2131875],[-162.4912283,-50.2328883],[-156.4453165,-50.0641918],[-156.7749163,-13.132979],[-163.0334483,-13.1266564],[-167.4799992,-13.0095058],[-175.1374124,-13.0690463],[175.7153341,-12.9403221],[169.2334025,-12.8867798],[162.1911662,-12.8867798],[154.2919942,-12.8010882],[154.6435546,-50.0359736]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Torkoal","english":["Torkoal"],"german":["Qurtel"],"geometry":{"type":"Polygon","coordinates":[[[52.7453632,1.9661667],[60.3815883,1.8864211],[71.2804828,1.9915931],[79.7167969,1.845384],[91.3472203,1.8333542],[98.5787908,1.7590192],[100.4509769,1.7386207],[102.4442077,1.711366],[103.5193966,1.7166697],[104.4545042,1.7215441],[106.5938691,1.7132064],[109.9302184,1.7321508],[111.9561768,1.7067483],[112.1704141,44.4494676],[112.1173677,50.5577109],[105.4840983,50.5324609],[99.148713,50.5162291],[92.1655657,50.5085978],[86.3053298,50.4299745],[79.371408,50.3882202],[73.5753126,50.416405],[67.9900495,50.3808714],[62.567102,50.3851389],[57.6802124,50.3430302],[53.2122924,50.3769995],[52.7453632,1.9661667]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Tropius","english":["Tropius"],"german":["Tropius"],"geometry":{"type":"Polygon","coordinates":[[[-29.1432522,36.7850711],[-28.8147581,-49.4355627],[-21.433732,-49.5437028],[-12.8320312,-49.6107099],[-3.5617921,-49.7415299],[4.921875,-49.6107099],[15.6445313,-49.6107099],[23.203125,-49.2678046],[31.1132813,-49.2678046],[39.6936035,-49.3752201],[46.6918945,-49.4109732],[52.157406,-49.2734073],[53.0914729,36.6774152],[52.097168,36.7300795],[50.690918,36.7036596],[46.7028809,36.7388841],[43.2476807,36.7432861],[39.7595215,36.7388841],[36.0351563,36.7212739],[32.1459961,36.7212739],[29.0017068,36.7002903],[25.452919,36.7245761],[21.9946289,36.7388841],[17.7319336,36.7388841],[13.458252,36.7124672],[10.8764648,36.7476877],[7.0000631,36.7002758],[3.3837891,36.7124672],[-0.3405762,36.7300795],[-2.2638135,36.7122808],[-4.0934758,36.722256],[-5.6855589,36.7460958],[-7.2729492,36.7608913],[-10.5194092,36.7608913],[-13.5406494,36.782892],[-16.8035888,36.7960895],[-20.5718994,36.782892],[-24.3951416,36.7916906],[-29.1432522,36.7850711]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Farfetch'd","english":["Farfetch'd"],"german":["Porenta"],"geometry":{"type":"Polygon","coordinates":[[[112.2363707,21.0724084],[116.267753,21.041066],[120.2716707,21.0755242],[124.1547096,21.0782104],[128.3788226,21.0698857],[132.7239722,21.0913307],[137.2781571,21.1321598],[141.227315,21.1515131],[146.3094692,21.1897179],[149.8515658,21.2484025],[152.4695452,21.2458494],[154.7355133,21.2638365],[154.5874152,48.478032],[150.1594106,48.4052644],[145.6498147,48.3771996],[139.770296,48.3925578],[134.487265,48.3680023],[129.748832,48.367673],[124.9151903,48.3664688],[119.8363995,48.3635568],[116.0626359,48.3723472],[112.0959005,48.3707026],[112.2363707,21.0724084]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Sigilyph","english":["Sigilyph"],"german":["Symvolara"],"geometry":{"type":"Polygon","coordinates":[[[19.3452587,39.811537],[19.332032,38.8462217],[25.1577296,31.6611084],[25.0973048,31.6260348],[25.0780787,31.5535073],[24.8583521,31.4012506],[24.885818,31.2651819],[24.8693385,31.1712268],[25.0286402,30.7708791],[24.9297633,30.487273],[24.7100367,30.1458518],[24.9901881,29.2487944],[24.9943556,21.9964122],[31.3005079,22.0065984],[31.4488234,22.2406793],[31.5092482,22.1898253],[31.4048781,22.0065984],[37.0247159,21.9759484],[36.1375357,27.3199596],[35.9178091,29.5035957],[35.945275,31.5709639],[35.891936,31.9680917],[34.8616611,32.3582582],[31.5425417,33.8918277],[26.9118043,37.1918091],[26.4271827,37.8239696],[26.6455318,39.0216347],[26.4342401,40.1524457],[25.9672679,40.6711027],[26.3435497,40.9164648],[26.354536,41.2477097],[26.6182079,41.3302599],[26.6291942,41.5937186],[26.2227001,41.7496405],[26.0579051,41.729146],[25.816206,41.7332454],[25.4756298,41.7250464],[24.9592724,41.7332455],[24.6846142,41.7414435],[24.3330517,41.7250463],[23.5475292,41.7209464],[22.7674999,41.7209465],[22.2181835,41.7332455],[21.6242351,42.053723],[21.4222728,42.0567402],[20.8256664,41.8970075],[20.4977198,41.7584865],[20.0813427,41.7004428],[19.2024364,41.6963413],[19.1914501,41.3385092],[19.2024365,41.0988561],[19.1914501,40.8500155],[19.2134227,40.6335948],[19.2463817,40.5000631],[19.2683544,40.316022],[19.323286,40.0726541],[19.3452587,39.811537]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Tauros","english":["Tauros"],"german":["Tauros"],"geometry":{"type":"Polygon","coordinates":[[[-62.6981825,28.8445398],[-62.8481171,52.0054047],[-63.2573713,52.0037827],[-63.7378819,51.9994762],[-64.4194369,51.9990793],[-64.9109279,52.0016288],[-65.429802,52.0062566],[-66.4145651,51.9994221],[-67.6554899,51.9969],[-68.4822449,52.0026605],[-69.5116346,52.0133904],[-69.9579592,52.0137245],[-70.6946856,51.9932767],[-71.8748781,51.9975447],[-73.9580435,51.9804658],[-75.3060432,51.9804309],[-76.1178445,51.9878938],[-77.1583682,51.9957354],[-77.9075456,52.0016725],[-78.3071278,52.0001727],[-78.6905126,51.9981522],[-79.45816,52.0049625],[-80.3506581,52.0192006],[-81.0746939,52.0267377],[-82.0307286,52.0174783],[-82.8914443,52.0089162],[-83.7152743,52.0184946],[-84.9422433,52.0146625],[-85.924956,52.0034694],[-87.1295952,52.0017378],[-88.2514299,52.0117435],[-89.4583413,52.0204869],[-90.7548885,52.0101238],[-92.1496536,51.9931606],[-93.2990015,51.9993943],[-93.9371159,52.0044191],[-94.551186,51.9950674],[-94.9074249,51.9904954],[-95.582477,51.9973399],[-96.0395531,51.994354],[-96.6505118,51.9965269],[-97.5041855,52.0078736],[-98.6142635,52.0231562],[-99.9904715,52.0284745],[-100.5386593,52.0183937],[-100.9741831,52.0159875],[-101.5111785,52.0178867],[-101.7818663,52.0141983],[-102.5375993,52.0091147],[-103.478188,52.0134692],[-103.9638903,52.0104674],[-104.3410526,52.0128156],[-104.7649122,52.017303],[-105.1346408,52.0228441],[-105.4455277,52.0226371],[-105.8277341,52.0216675],[-106.3306878,52.0185641],[-106.663113,52.0182406],[-107.4608763,52.0178845],[-107.8954091,52.0197334],[-109.0594264,52.0064121],[-109.7367911,52.0090744],[-110.7663496,52.0099515],[-111.3946285,52.0068604],[-112.6145388,52.0085099],[-113.8198416,52.0185119],[-115.409954,52.0228131],[-116.9985247,52.0108539],[-118.9132609,52.0096775],[-120.9591053,52.0103634],[-124.1664122,52.0220991],[-126.4804707,52.0083551],[-129.406906,52.0470712],[-128.9843308,28.8320727],[-127.9916179,28.8335311],[-126.9989489,28.8371191],[-125.9872129,28.844315],[-124.9908547,28.8408038],[-123.9907278,28.8426825],[-120.9901869,28.8444342],[-119.9917111,28.8444044],[-118.9895013,28.8437919],[-117.9900646,28.8439095],[-116.9919012,28.8452754],[-115.9932549,28.8480304],[-114.9942208,28.8458381],[-113.9912996,28.8458027],[-109.9919722,28.8445069],[-105.9911669,28.8441653],[-103.9907051,28.8432564],[-99.990369,28.8417632],[-98.0287243,28.8486587],[-97.0061875,28.8470795],[-95.9901076,28.8452835],[-91.9897197,28.8446589],[-87.9894034,28.84468],[-83.9896595,28.8446139],[-82.0008589,28.8382549],[-81.0000026,28.8405108],[-77.9885192,28.8449496],[-73.9886869,28.8447182],[-70.0003426,28.8401009],[-65.9992077,28.8401876],[-65.9875305,28.8447962],[-63.9879039,28.8444177],[-62.6981825,28.8445398]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Pachirisu","english":["Pachirisu"],"german":["Pachirisu"],"geometry":{"type":"Polygon","coordinates":[[[-51.2465545,70.2484435],[-64.318617,70.3891648],[-73.3124088,70.4963258],[-83.0549535,70.498633],[-92.9226511,70.5052488],[-100.2965151,70.5568918],[-114.2409737,70.3642874],[-126.9825731,70.2723088],[-139.1951946,70.1513385],[-152.8194494,70.2245787],[-164.3310537,70.2225052],[-177.2391023,70.2155618],[169.8505556,70.2061816],[157.6624196,70.2417241],[146.9690404,70.2415726],[137.3397908,70.2083194],[129.301766,70.1948432],[119.8298713,70.1754445],[108.1946569,70.0935009],[97.1380316,69.9378562],[86.9395483,70.0742043],[79.1749259,70.1927158],[68.6184122,70.2211917],[60.8457833,70.2036538],[53.6408717,70.2347072],[53.2232787,51.7372346],[61.8584701,51.7334294],[69.8364621,51.720933],[76.9254962,51.6799256],[83.1343521,51.7040547],[89.4013995,51.6432551],[96.4844281,51.7116091],[101.0014975,51.657683],[106.3918914,51.6283886],[111.8448624,51.6665148],[116.5778169,51.7157428],[120.8849629,51.7813005],[125.7690167,51.72023],[130.5228836,51.7631141],[138.7502881,51.7933421],[144.3377356,51.8291829],[150.9179817,51.826963],[157.5879027,51.6997998],[166.25318,51.7300823],[175.249209,51.912705],[-176.4702637,51.9280344],[-168.7749605,52.031642],[-160.7222092,52.1029519],[-150.5437768,52.0746591],[-142.9613354,52.0542054],[-136.2307457,52.003468],[-129.406906,52.0470712],[-125.2192777,52.0625262],[-120.8680013,52.0422204],[-117.3698897,52.0471706],[-113.3858473,52.0687081],[-110.1157983,52.0559769],[-105.7257016,52.054004],[-100.5252026,52.0435328],[-94.4411182,52.0262978],[-88.5626004,52.0575712],[-84.542311,52.0543008],[-79.3380562,52.0328387],[-73.4900913,52.0057617],[-69.9579592,52.0137245],[-66.3853772,52.0143383],[-63.2573713,52.0037827],[-60.3623456,51.9494106],[-54.8736641,51.9172342],[-51.0543203,51.90911],[-51.2465545,70.2484435]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Mr Mime/Mime Jr.","english":["Mr Mime","Mime Jr."],"german":["Pantimos","Pam-Pam"],"geometry":{"type":"Polygon","coordinates":[[[-29.1405056,36.7850711],[-24.1671733,36.7784924],[-19.404602,36.7784924],[-14.6200562,36.7784924],[-10.5743409,36.7718924],[-7.9623413,36.7608913],[-6.7513612,36.7485787],[-5.5674779,36.7399849],[-4.79987,36.7291205],[-3.9561467,36.7178529],[-2.2391428,36.7040322],[-0.1730346,36.7124672],[4.2214966,36.7036596],[7.5723267,36.6948509],[12.9336548,36.6948509],[17.5369263,36.7124672],[21.0025277,36.7000656],[24.9964148,36.7326622],[28.7539673,36.7124672],[36.6531372,36.6948509],[43.1130982,36.7179913],[48.8699341,36.6948509],[53.0942195,36.6774152],[53.5557277,67.5813142],[47.9251099,67.6008493],[42.3220825,67.5547538],[37.0156861,67.5463631],[31.1929321,67.5337716],[25.8425904,67.5421667],[19.4155884,67.6050353],[12.9666138,67.6426763],[4.6060181,67.6593864],[-3.3082463,67.7418725],[-12.2909546,67.7261082],[-19.6847534,67.7011097],[-27.2323608,67.6802573],[-29.012146,67.7261082],[-29.1405056,36.7850711]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Bouffalant","english":["Bouffalant"],"german":["Bisofank"],"geometry":{"type":"Polygon","coordinates":[[[-73.8062973,42.7501784],[-77.7804633,42.7497062],[-77.7805706,38.299451],[-69.6122202,38.2765677],[-69.5682748,42.7692939],[-73.8062973,42.7501784]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Klefki","english":["Klefki"],"german":["Klefki"],"geometry":{"type":"Polygon","coordinates":[[[4.9043716,51.1396041],[2.5811475,51.1555567],[0.2602515,51.1479171],[-0.327061,51.139914],[-0.3253782,51.0626544],[-0.3194154,50.5075184],[-1.0124062,50.4947919],[-2.3486183,50.0100913],[-4.9414772,48.7116759],[-4.9854226,42.1948049],[-2.7442117,42.1948049],[-0.2832742,42.2110815],[0.8072301,42.2147195],[1.2569872,42.2171207],[1.4637488,42.5194975],[1.5735335,42.5176965],[1.9020399,42.2095219],[2.7709251,42.1948049],[8.5497337,42.3249009],[8.359721,49.6485873],[4.9043716,51.1396041]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Comfey","english":["Comfey"],"german":["Curelei"],"geometry":{"type":"Polygon","coordinates":[[[-160.9057817,23.0554244],[-161.015645,23.0503699],[-161.0376177,22.2239737],[-161.0705767,20.772501],[-161.0705767,19.0682984],[-161.081563,17.5560065],[-160.0598345,17.5036259],[-158.4887896,17.493148],[-156.4343462,17.493148],[-154.4018755,17.5350561],[-152.7539263,17.5560065],[-152.7978716,18.9020792],[-152.7868853,20.4434354],[-152.8198442,22.0204229],[-152.8198442,23.0857474],[-154.116231,23.0857474],[-155.2697954,23.0958536],[-156.5112505,23.0857474],[-158.1042681,23.0958536],[-159.4775591,23.0655328],[-160.9057817,23.0554244]]]}},{"folder":"Type 2 [Habitat-Based Regionals]","name":"Corsola/Pa’u Oricorio","english":["Corsola","Pa’u Oricorio"],"german":["Corasonn","Choreogel (Hula)"],"geometry":{"type":"Polygon","coordinates":[[[-9.8730602,31.1405201],[-15.9403397,30.9844594],[-20.189579,30.8801952],[-23.802537,30.9342908],[-28.64567,31.0092758],[-34.0963484,30.8901409],[-39.426738,30.828582],[-44.6014742,30.9156176],[-49.6031406,30.8120615],[-53.3472016,30.8296243],[-55.8638853,30.818043],[-58.8068607,30.7929712],[-61.8283727,30.7815837],[-64.1057336,30.8240551],[-66.2843656,30.8256618],[-68.3964003,30.8415856],[-71.1216886,30.8648288],[-73.8922327,30.9036423],[-76.6061928,30.9021854],[-79.6780482,30.930443],[-82.1168898,30.932255],[-84.2487434,30.9835443],[-86.8523484,30.9883056],[-89.2438965,31.0050124],[-91.0297149,31.0043649],[-92.8164803,31.0011573],[-94.2435175,30.9957742],[-95.4522558,30.9903655],[-97.4799473,30.9876793],[-98.7757055,30.9959298],[-100.9234648,27.0096587],[-100.0400649,22.3826332],[-101.2687294,20.9937268],[-104.2592833,24.474896],[-106.8102442,27.8625293],[-111.2273666,31.0519459],[-115.3513697,31.081647],[-117.3939438,31.0874676],[-119.1984618,31.1222558],[-122.3722559,31.1319945],[-126.1960924,31.1624648],[-131.4947178,31.1922318],[-139.8822028,31.2843323],[-145.4591375,31.2839777],[-155.2020422,31.312575],[-162.7126005,31.3995877],[-167.4612609,31.3617441],[-171.4315472,31.2318951],[-176.4400706,31.2135856],[179.1692626,31.173936],[174.0524992,31.2160826],[165.4890964,31.0286072],[160.4342741,30.9597223],[155.5141738,30.8661785],[150.0901759,30.8175575],[145.3815998,30.8292284],[141.4061321,30.8501124],[137.6676859,30.8552472],[133.9763724,30.866859],[130.1320517,30.895796],[126.6151981,30.9277537],[123.9974778,30.9565044],[121.7315405,30.9774533],[119.9762153,30.9791843],[119.4822065,29.2348055],[117.928279,27.1142978],[116.4967885,25.9576725],[115.2193979,24.7522335],[113.7492959,24.1417649],[111.7776431,23.7140653],[109.8817007,23.561248],[92.7431808,24.0928872],[90.3978269,24.4591837],[87.6307239,24.7685212],[85.6999548,24.1574274],[73.7226059,24.2159078],[72.0647136,24.9659701],[67.6514684,27.1955854],[62.3471546,27.9932575],[60.1037347,27.9522144],[57.2315282,28.561835],[54.176727,29.1549615],[52.5606432,31.0079201],[49.7380794,30.8439855],[44.7438127,30.7820179],[45.9741178,27.5570092],[48.768518,23.3022446],[52.2153465,21.1561647],[55.5309196,22.2955058],[54.6632579,20.3844527],[51.0451227,18.8237121],[45.8143578,16.948764],[44.8821521,18.0995502],[41.6638374,22.5410451],[38.6189052,26.0933813],[36.8434551,28.4869537],[35.258142,29.7517315],[33.5406249,31.1790328],[30.3539301,31.0598979],[27.6323001,31.1174246],[26.362672,31.192921],[23.704193,31.2472629],[21.0012214,31.2715175],[18.3919199,31.2726521],[15.8626621,31.2437797],[13.82018,31.2426341],[9.9582717,31.0975627],[11.8449804,30.8195168],[13.3757519,30.502565],[14.3954242,29.6490472],[16.1912139,29.0631292],[18.7789897,28.0479114],[20.6440146,28.0554983],[22.2545047,29.2621584],[22.8185884,30.4967223],[25.1016404,29.5437103],[28.9783511,28.8947811],[30.1158967,28.0202289],[32.0642181,23.9313349],[34.230276,20.1698059],[36.2115913,16.0309512],[41.2219555,8.5632616],[43.3809818,7.3593591],[44.090565,5.6629187],[40.0646189,2.7352649],[36.3951438,0.2568017],[35.8592962,-2.3905462],[36.8831946,-11.1572569],[37.0007472,-13.8184392],[33.8380723,-16.7348841],[31.7758851,-19.553338],[32.6872899,-22.6865188],[30.9055821,-23.9340014],[30.0281674,-25.7798741],[33.9431073,-25.8378162],[37.2509118,-25.8407001],[40.8028922,-25.8473073],[43.9081896,-25.8941862],[45.6245026,-25.9193263],[47.6947949,-25.9561292],[49.4898176,-25.9353591],[53.3486982,-25.9739475],[55.2132596,-26.0123918],[59.2452843,-26.0220039],[62.6465338,-26.011137],[66.299694,-25.8854081],[69.3405539,-25.9684893],[72.9738702,-25.7732303],[77.8478919,-25.7889412],[87.2241138,-25.9011762],[92.5305345,-26.1447776],[97.3919282,-26.2469562],[101.4153377,-26.0607277],[105.6521469,-26.1545034],[109.3609172,-26.1413373],[113.6090926,-26.0635771],[114.9633694,-26.0691184],[114.8896323,-22.9591519],[119.7889378,-21.3915166],[123.6841364,-17.9149865],[126.9228351,-15.9903977],[130.6806572,-15.9714886],[134.9236675,-15.5879592],[138.1647282,-17.6821249],[141.3681879,-18.4767463],[145.5715547,-18.7497148],[148.0921879,-21.7502209],[150.6500166,-24.1988793],[151.853642,-25.8026412],[153.0472339,-27.0721797],[156.873194,-27.0393387],[160.3934371,-27.0391951],[164.3315572,-27.1710527],[168.1206229,-27.1942641],[172.1627062,-27.0857387],[176.9902805,-26.9382684],[-172.2956982,-27.2560217],[-165.4342248,-27.0839054],[-157.1180891,-27.3828246],[-147.7651953,-27.2019117],[-133.7622327,-26.9706395],[-119.5669501,-26.7038461],[-106.9411339,-26.5642586],[-92.7051728,-26.6555626],[-82.2009483,-26.491401],[-77.0479595,-26.3582221],[-74.4724702,-26.3506146],[-70.4805681,-26.2021512],[-67.730384,-26.0516216],[-67.2426696,-22.0095771],[-67.699906,-16.22921],[-70.7117075,-13.7030529],[-74.6058639,-8.351967],[-76.3632214,-4.3242599],[-75.0591351,0.4602624],[-72.9448494,5.2373984],[-69.6291923,6.7288898],[-65.9274051,6.6565043],[-62.3645572,5.0828222],[-59.3131786,3.5354593],[-55.7854924,1.0547215],[-53.7318478,-1.1392688],[-50.8845203,-3.4198878],[-46.2468024,-4.6854824],[-37.4326971,-5.0147754],[-31.4062199,-5.0241429],[-25.30721,-5.0119669],[-18.7225409,-4.987044],[-13.3548468,-5.0002811],[-9.8725249,-4.8987376],[1.5368346,-4.5982864],[11.3112549,-4.4354411],[12.3565641,-4.4150876],[10.1557311,-1.0447361],[11.0848511,2.5290932],[10.1852768,5.8438644],[7.0741069,7.6479433],[2.7268913,9.0455965],[-4.4269965,6.9624321],[-10.0933303,9.2060823],[-12.0053514,11.0537785],[-12.8358667,13.4404954],[-13.1039698,14.3954109],[-13.110911,16.2011545],[-13.2036401,21.3364108],[-13.0046678,22.6730186],[-12.0904078,24.3326327],[-11.6732044,25.3200941],[-9.7877374,26.3047469],[-9.8730602,31.1405201]]]}},{"folder":"Type 2 [Habitat-Based Regionals]","name":"Carnivine","english":["Carnivine"],"german":["Venuflibis"],"geometry":{"type":"Polygon","coordinates":[[[-87.0406486,36.638558],[-87.2245764,24.8972135],[-79.8857092,24.777572],[-75.0956701,24.7775719],[-75.0216056,36.5591767],[-79.6907951,36.5503515],[-84.4039299,36.576824],[-87.0406486,36.638558]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Indian Ocean","english":["Indian Ocean"],"german":["Indian Ocean"],"geometry":{"type":"Polygon","coordinates":[[[52.8222675,1.9332268],[52.03125,-61.7731229],[59.765625,-61.7731229],[66.796875,-61.9389504],[74.53125,-61.9389504],[82.7929688,-61.9389505],[91.7578125,-61.7731229],[101.25,-61.7731229],[108.6328125,-61.6063964],[111.796875,-61.522695],[111.9561768,1.7067483],[103.0078125,1.7575368],[92.109375,1.9771466],[83.3203125,2.1088987],[76.3561664,2.0794282],[69.8737758,2.1060142],[61.2597656,1.9771466],[52.8222675,1.9332268]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Malay Archipelago","english":["Malay Archipelago"],"german":["Malay Archipelago"],"geometry":{"type":"Polygon","coordinates":[[[112.0222351,20.8938841],[111.6210938,-11.0921659],[118.1733601,-10.983058],[123.75,-11.0059045],[130.078125,-10.833306],[135.703125,-10.660608],[139.7460938,-10.9196178],[139.7460978,20.9614396],[133.7695333,20.9614396],[128.5620178,20.9409197],[123.0249063,20.9203969],[117.8173868,20.8177411],[112.0222351,20.8938841]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Greenland","english":["Greenland"],"german":["Greenland"],"geometry":{"type":"Polygon","coordinates":[[[-62.8899613,29.0921022],[-56.8652344,29.0753752],[-48.8671875,28.9216313],[-37.8768593,29.0766214],[-28.1397269,29.1436267],[-28.0780564,67.6930404],[-22.2964334,67.6464554],[-13.2877821,67.6968464],[-0.4255646,67.7617242],[9.4021206,67.6848782],[19.0294378,67.6281471],[27.8880865,67.5133968],[36.5751531,67.5613206],[44.9819703,67.5219765],[53.5529811,67.5813142],[51.9433614,85.0288468],[41.2207071,85.0359415],[29.8828125,85.0511288],[21.4453125,85.0207077],[11.6015625,85.0511288],[4.1524615,85.0806101],[-5.625,85.0511288],[-15.46875,85.0511288],[-23.203125,85.0207077],[-31.640625,85.0511288],[-39.2983701,85.0620929],[-49.5703125,85.0207077],[-56.25,85.0435409],[-62.9296875,85.0511288],[-62.8899613,29.0921022]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Eastern Pacific","english":["Eastern Pacific"],"german":["Eastern Pacific"],"geometry":{"type":"Polygon","coordinates":[[[-129.7049052,51.9163929],[-139.0429687,51.7270282],[-147.7001953,51.9442648],[-156.796875,52.0524905],[-172.7929687,51.5087425],[-177.1899046,51.6927994],[178.7695373,51.3443387],[179.4726563,-12.8546489],[-156.7749163,-13.132979],[-156.4453165,-50.0641918],[-143.0859375,-50.7364551],[-129.0234375,-50.7364552],[-129.7049052,51.9163929]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Western Pacific","english":["Western Pacific"],"german":["Western Pacific"],"geometry":{"type":"Polygon","coordinates":[[[178.7695373,51.3443387],[173.2763793,51.2344073],[167.3437521,51.3443387],[159.8730489,51.179343],[154.2476615,50.6799],[154.4676551,21.0836313],[139.7460958,20.9614396],[139.7460958,-0.5273363],[154.2480489,-0.3955047],[154.2919962,-12.8010882],[166.7147588,-12.8679333],[179.4726563,-12.8546489],[178.7695373,51.3443387]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Arctic","english":["Arctic"],"german":["Arctic"],"geometry":{"type":"Polygon","coordinates":[[[59.5656778,67.66648],[87.206391,67.5169917],[105.1411255,67.9642187],[123.4321834,67.9628762],[144.7952752,67.9310079],[154.8191355,68.0714537],[169.1494251,68.0950643],[-179.3346701,68.0662897],[-163.0147619,67.9028756],[-145.1916138,67.9678554],[-122.2691713,67.8123225],[-99.0510473,67.8127055],[-87.3749088,67.8100953],[-71.3334416,68.0944105],[-54.1980242,68.1040319],[-34.9641471,67.9635529],[-16.1833516,68.0693841],[-3.3109929,67.7418725],[6.8686002,68.0725594],[19.4128418,67.6050353],[37.0129395,67.5463631],[59.5656778,67.66648]]]}},{"folder":"Geoblock Region","name":"China Geoblock","english":["China Geoblock"],"german":["China Geoblock"],"geometry":{"type":"Polygon","coordinates":[[[118.599704,24.325883],[120.228212,24.0531],[120.395501,26.623242],[124.833977,26.249418],[124.361565,38.044059],[124.85595,38.044059],[125.482171,37.357356],[128.811028,39.550936],[98.408684,46.114308],[97.771477,44.975614],[96.431145,45.037754],[96.079582,43.877239],[94.255852,43.924735],[94.124016,42.693673],[85.12409,31.214182],[84.992254,28.624521],[87.27741,28.605232],[87.299382,27.811356],[92.682683,28.04432],[94.748113,29.316549],[96.37409,29.220711],[96.615789,28.566643],[97.714422,28.508734],[97.604558,23.676191],[100.59284,21.127004],[101.581609,22.939646],[104.503972,22.838434],[104.679754,23.625874],[106.789129,23.162048],[106.613347,21.842603],[114.090645,20.859728],[114.137337,21.872605],[113.474257,22.046109],[113.482031,22.258102],[113.592581,22.330529],[113.773842,22.469042],[113.94825,22.448102],[113.95855,22.515989],[114.041671,22.504941],[114.049224,22.502245],[114.055233,22.503118],[114.05755,22.505734],[114.057722,22.509382],[114.059352,22.513346],[114.062013,22.515329],[114.065189,22.516994],[114.068966,22.517152],[114.072055,22.517945],[114.074459,22.520244],[114.077841,22.529056],[114.079472,22.530563],[114.082004,22.531038],[114.084364,22.532109],[114.086896,22.534011],[114.088398,22.536192],[114.091531,22.537064],[114.093806,22.536271],[114.096123,22.534289],[114.097968,22.534289],[114.102346,22.534804],[114.104105,22.535121],[114.107667,22.533694],[114.109126,22.531356],[114.111787,22.529492],[114.114276,22.530523],[114.115993,22.531554],[114.116036,22.532902],[114.116422,22.534091],[114.117237,22.534447],[114.119297,22.534527],[114.120628,22.535478],[114.121786,22.537262],[114.125134,22.538926],[114.130687,22.541551],[114.138841,22.543216],[114.144248,22.54171],[114.14545,22.540838],[114.14854,22.542027],[114.148368,22.543374],[114.1506,22.546228],[114.151716,22.546704],[114.151458,22.547497],[114.150342,22.54718],[114.14957,22.548448],[114.149827,22.550905],[114.151544,22.550905],[114.15163,22.554948],[114.15635,22.554393],[114.159354,22.560576],[114.161586,22.562002],[114.163474,22.559228],[114.166049,22.559307],[114.167508,22.561368],[114.169654,22.561051],[114.170942,22.559387],[114.176521,22.560179],[114.177551,22.558515],[114.177722,22.555582],[114.181156,22.554234],[114.181842,22.555582],[114.18682,22.554551],[114.187078,22.555978],[114.195747,22.55582],[114.196433,22.557326],[114.201412,22.557564],[114.201669,22.556216],[114.207248,22.556533],[114.20905,22.557246],[114.213428,22.554948],[114.217977,22.555978],[114.221238,22.553045],[114.222097,22.55146],[114.227247,22.547814],[114.225616,22.545673],[114.226474,22.544167],[114.23716,22.545356],[114.246601,22.556097],[114.24952,22.5536],[114.299461,22.563223],[114.312164,22.578916],[114.426035,22.561983],[114.430155,22.389402],[114.511179,22.381783],[114.512553,21.760733],[114.144511,21.870378],[114.100848,20.857276],[118.451434,20.033746],[118.599704,24.325883]]]}},{"folder":"Confirmed Spawn Points","name":"Pansage Spawn","english":["Pansage Spawn"],"german":["Pansage Spawn"],"geometry":{"type":"Point","coordinates":[90.4858278,56.2348717]}},{"folder":"Confirmed Spawn Points","name":"Pansear Spawn","english":["Pansear Spawn"],"german":["Pansear Spawn"],"geometry":{"type":"Point","coordinates":[82.9378939,55.009464]}},{"folder":"Type 1 [Geographical Regionals]","name":"Hawlucha","english":["Hawlucha"],"german":["Hawlucha"],"geometry":{"type":"Polygon","coordinates":[[[-117.4,32.7],[-114.8,32.7],[-110.5,31.4],[-106.5,31.8],[-103.0,29.0],[-100.0,28.7],[-99.5,27.5],[-97.4,25.9],[-97.2,21.5],[-94.8,18.5],[-92.0,18.5],[-90.4,21.5],[-86.7,21.5],[-86.7,19.5],[-87.5,17.8],[-88.3,17.8],[-89.2,17.5],[-91.4,16.0],[-92.2,14.5],[-95.5,16.2],[-100.0,16.7],[-104.3,19.5],[-105.5,20.0],[-106.5,23.2],[-108.5,22.5],[-110.3,22.7],[-110.5,23.5],[-112.5,27.0],[-114.5,29.5],[-115.5,30.5],[-116.5,31.5],[-117.4,32.7]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Stonjourner","english":["Stonjourner"],"german":["Stonjourner"],"geometry":{"type":"Polygon","coordinates":[[[-7.6,55.2],[-5.5,54.3],[-6.0,50.0],[-3.0,50.6],[0.5,50.9],[1.8,52.5],[0.0,53.7],[-1.5,55.0],[-1.7,56.0],[-2.0,57.7],[-3.5,58.7],[-5.0,58.6],[-6.5,58.0],[-7.5,57.0],[-6.4,55.9],[-5.3,54.8],[-7.6,55.2]]]}}]`);

const KEY_LASTPIN = "pogo:lastpin";
const KEY_BAZAARTAGS = "pogo:bazaartags";
const KEY_HOME = "pogo:home";
const KEY_STEP = "pogo:step";

// Module-level point-in-polygon (handles antimeridian via unwrap).
// Used by both the App (homeLocals computation) and RegionalMap (matches).
function unwrapRing(ring) {
  if (!ring || ring.length === 0) return ring;
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const prevLon = out[out.length - 1][0];
    let curLon = ring[i][0];
    const curLat = ring[i][1];
    while (curLon - prevLon >  180) curLon -= 360;
    while (curLon - prevLon < -180) curLon += 360;
    out.push([curLon, curLat]);
  }
  return out;
}
function shiftPointToRing(pt, ring) {
  if (!ring.length) return pt;
  let lonMin = ring[0][0], lonMax = ring[0][0];
  for (const p of ring) {
    if (p[0] < lonMin) lonMin = p[0];
    if (p[0] > lonMax) lonMax = p[0];
  }
  let [x, y] = pt;
  while (x < lonMin - 0.5 && x + 360 <= lonMax + 0.5) x += 360;
  while (x > lonMax + 0.5 && x - 360 >= lonMin - 0.5) x -= 360;
  return [x, y];
}
function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
function pointInRegionGeom(pt, geom) {
  if (geom.type === "Polygon") {
    const ring = unwrapRing(geom.coordinates[0]);
    return pointInRing(shiftPointToRing(pt, ring), ring);
  }
  if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      const ring = unwrapRing(poly[0]);
      if (pointInRing(shiftPointToRing(pt, ring), ring)) return true;
    }
    return false;
  }
  return false;
}

// Inline TopoJSON → GeoJSON decoder (avoids needing topojson-client as a dep)
function decodeTopo(topology, objectName) {
  const obj = topology.objects[objectName];
  const { scale, translate } = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map((d) => {
      x += d[0]; y += d[1];
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const resolveArc = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ringPoints = (refs) => {
    const out = [];
    refs.forEach((r, i) => {
      const seg = resolveArc(r);
      if (i === 0) out.push(...seg);
      else out.push(...seg.slice(1));
    });
    return out;
  };
  const procGeom = (g) => {
    if (g.type === "Polygon") return { type: "Polygon", coordinates: g.arcs.map(ringPoints) };
    if (g.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: g.arcs.map((rs) => rs.map(ringPoints)) };
    return null;
  };
  return {
    type: "FeatureCollection",
    features: obj.geometries
      .map((g) => ({ type: "Feature", id: g.id, properties: g.properties || {}, geometry: procGeom(g) }))
      .filter((f) => f.geometry),
  };
}

// ─── UI ───────────────────────────────────────────────────────────────────

export default function App() {
  const [hundos, setHundos] = useState(DEFAULT_HUNDOS);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [newHundo, setNewHundo] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showSetTheory, setShowSetTheory] = useState(false);
  const [showRawClauses, setShowRawClauses] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [homeLocation, setHomeLocation] = useState(null);   // [lon, lat] — drives defaults
  const [lastPin, setLastPin] = useState(null);             // [lon, lat] — inspector
  const [bazaarTags, setBazaarTags] = useState([]);
  const [copied, setCopied] = useState({ trash: false, trade: false, sort: false, prestaged: false, gift: false });
  const [resetArmed, setResetArmed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    if (!resetArmed) return;
    const t = setTimeout(() => setResetArmed(false), 3000);
    return () => clearTimeout(t);
  }, [resetArmed]);

  // Load from storage once
  useEffect(() => {
    (async () => {
      const h = await loadJSON(KEY_HUNDOS, DEFAULT_HUNDOS);
      const c = await loadJSON(KEY_CONFIG, DEFAULT_CONFIG);
      const home = await loadJSON(KEY_HOME, null);
      const p = await loadJSON(KEY_LASTPIN, null);
      const b = await loadJSON(KEY_BAZAARTAGS, []);
      const step = await loadJSON(KEY_STEP, 1);
      setHundos(h);
      const merged = { ...DEFAULT_CONFIG, ...c };
      if (!merged.regionalGroups || Object.keys(merged.regionalGroups).length === 0) {
        merged.regionalGroups = defaultRegionalToggles();
      }
      if (!merged.enabledTradeEvos || merged.enabledTradeEvos.length === 0) {
        merged.enabledTradeEvos = Object.keys(TRADE_EVO_FAMILIES);
      }
      // Drop legacy keys (replaced or split)
      delete merged.protectRegionals;
      delete merged.protectSizes;        // split into XXL/XL/XXS
      delete merged.protectLeagueTags;   // replaced with leagueTags string
      delete merged.protectMegaConditional; // renamed to protectNewEvolutions
      delete merged.yearMin;             // removed
      // Migrate old field names
      if (c.mythCarveOuts && !c.mythTooManyOf) merged.mythTooManyOf = c.mythCarveOuts;
      if (c.protectMegaConditional !== undefined && c.protectNewEvolutions === undefined) {
        merged.protectNewEvolutions = c.protectMegaConditional;
      }
      // Old `protectTagged` (catch-all !#) → new `protectAnyTag`
      if (c.protectTagged !== undefined && c.protectAnyTag === undefined) {
        merged.protectAnyTag = c.protectTagged;
      }
      delete merged.protectTagged;
      setConfig(merged);
      setHomeLocation(home);
      setLastPin(p);
      setBazaarTags(b);
      setCurrentStep(step);
      setLoaded(true);
    })();
  }, []);

  // Persist on change
  useEffect(() => { if (loaded) saveJSON(KEY_HUNDOS, hundos); }, [hundos, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_CONFIG, config); }, [config, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_HOME, homeLocation); }, [homeLocation, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_LASTPIN, lastPin); }, [lastPin, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_BAZAARTAGS, bazaarTags); }, [bazaarTags, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_STEP, currentStep); }, [currentStep, loaded]);

  // Locals at home location (drives auto-drop from Regionals protection + bazaar suggestions)
  const homeLocals = useMemo(() => {
    if (!homeLocation) return [];
    const out = new Set();
    for (const r of POGO_REGIONS) {
      if (r.geometry.type !== "Polygon" && r.geometry.type !== "MultiPolygon") continue;
      if (pointInRegionGeom(homeLocation, r.geometry)) {
        r.german.forEach(n => out.add(n));
      }
    }
    return [...out];
  }, [homeLocation]);

  // Build effective config: home-locals get auto-removed from collector protections
  // across ALL regional groups (so e.g. Sengo in collectibles also gets dropped if Bonn is home).
  const effectiveConfig = useMemo(() => {
    if (!homeLocals.length || !config.regionalGroups) return config;
    const newGroups = { ...config.regionalGroups };
    let changed = false;
    for (const [groupKey, groupDef] of Object.entries(REGIONAL_GROUPS)) {
      const groupState = newGroups[groupKey];
      if (!groupState || !groupState.enabled) continue;
      const baseList = groupDef.collectors;
      const explicitlyEnabled = groupState.collectorsEnabled === null ? baseList : groupState.collectorsEnabled;
      const filtered = explicitlyEnabled.filter(sp => !homeLocals.includes(sp));
      if (filtered.length !== explicitlyEnabled.length) {
        newGroups[groupKey] = { ...groupState, collectorsEnabled: filtered };
        changed = true;
      }
    }
    if (!changed) return config;
    return { ...config, regionalGroups: newGroups };
  }, [config, homeLocals]);

  const { trash, trade, sort, prestaged, gift, buddyCatchFilters, TE_full, TE_trim,
          trashClauses, tradeClauses, sortClauses, prestagedClauses, giftClauses } = useMemo(
    () => buildFilters(hundos, effectiveConfig, homeLocals),
    [hundos, effectiveConfig, homeLocals]
  );

  function addHundo() {
    // Accept comma/space/semicolon-separated lists. Each token can be:
    // - a dex number (e.g. "1", "201", "0666")
    // - an English name (e.g. "Bulbasaur", "venusaur")
    // - a German name (e.g. "bisasam", "Bisaflor")
    // Resolves each to canonical lowercase German via resolveSpecies().
    const tokens = newHundo.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(hundos);
    const unresolved = [];
    for (const tok of tokens) {
      const resolved = resolveSpecies(tok);
      if (resolved) {
        set.add(resolved);
      } else {
        unresolved.push(tok);
      }
    }
    setHundos([...set].sort());
    if (unresolved.length > 0) {
      // Keep unresolved tokens in the input so the user sees what didn't match
      setNewHundo(unresolved.join(", "));
    } else {
      setNewHundo("");
    }
  }
  function removeHundo(h) { setHundos(hundos.filter(x => x !== h)); }
  function copyToClipboard(which, text) {
    // Robust copy: try modern clipboard API, fall back to legacy execCommand,
    // surface errors so user knows to manually select.
    const flash = (state) => {
      setCopied(p => ({ ...p, [which]: state }));
      setTimeout(() => setCopied(p => ({ ...p, [which]: false })), 2000);
    };

    // Modern clipboard API — but it can throw or reject in iframes without permission
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => flash("ok"))
        .catch(() => fallbackCopy(text) ? flash("ok") : flash("err"));
      return;
    }
    // Legacy fallback
    if (fallbackCopy(text)) flash("ok"); else flash("err");
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  function resetAll() {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setHundos(DEFAULT_HUNDOS);
    setConfig(DEFAULT_CONFIG);
    setHomeLocation(null);
    setLastPin(null);
    setBazaarTags([]);
    setResetArmed(false);
    setShowSettings(false);
  }

  // Step navigation helpers
  const steps = [
    { n: 1, key: "where", label: "Wo bist du?",       desc: "Heimat-Standort + Sub-Regionen erkunden" },
    { n: 2, key: "what",  label: "Was schützt du?",    desc: "Sammler-Ziele + Schutz-Optionen" },
    { n: 3, key: "have",  label: "Was hast du?",       desc: "Deine 4★-Sammlung" },
    { n: 4, key: "filter", label: "Dein Filter",       desc: "trash + trade · zum Kopieren" },
  ];
  function gotoStep(n) { setCurrentStep(n); }

  return (
    <div className="min-h-screen bg-[#0F1419] text-[#E6EDF3] font-['IBM_Plex_Sans',sans-serif]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');
        body { font-family: 'IBM Plex Sans', sans-serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .grid-bg {
          background-image:
            linear-gradient(rgba(94,175,197,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(94,175,197,0.04) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        details > summary { list-style: none; cursor: pointer; }
        details > summary::-webkit-details-marker { display: none; }
        .chip-enter { animation: chipIn 0.18s ease-out; }
        @keyframes chipIn { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>

      <div className="grid-bg min-h-screen">
        <div className="max-w-5xl mx-auto px-6 py-10">

          {/* HEADER */}
          <header className="mb-8 border-b border-[#1F2933] pb-6">
            <div className="flex items-baseline gap-4 flex-wrap">
              <h1 className="mono text-3xl font-bold tracking-tight text-[#E6EDF3]">
                pogo<span className="text-[#E74C3C]">.</span>filter<span className="text-[#5EAFC5]">.workshop</span>
              </h1>
              <span className="mono text-xs text-[#8B98A5]">v2 · stepper</span>
              <button
                onClick={() => setShowSettings(true)}
                className="ml-auto mono text-xs text-[#8B98A5] hover:text-[#E6EDF3] transition flex items-center gap-1.5"
                aria-label="Einstellungen öffnen">
                <Settings size={12} /> Einstellungen
              </button>
            </div>
            <p className="mt-3 text-sm text-[#8B98A5] max-w-2xl leading-relaxed">
              Wo → Was → Was du hast → Dein Filter.
              <span className="text-[#5EAFC5]"> Toss = (S012 ∪ (H ∩ ¬K)) ∩ ¬P ∩ ¬Prot</span>
            </p>
          </header>

          {/* STEP HEADERS — clickable progress bar */}
          <div className="mb-8">
            <div className="flex items-stretch gap-1.5">
              {steps.map((s, i) => {
                const active = currentStep === s.n;
                const done = currentStep > s.n;
                return (
                  <button key={s.n}
                    onClick={() => gotoStep(s.n)}
                    className={`flex-1 group rounded transition-all px-3 py-2 text-left ${
                      active
                        ? "bg-[#E74C3C] text-white"
                        : done
                          ? "bg-[#5EAFC5]/15 text-[#5EAFC5] hover:bg-[#5EAFC5]/25"
                          : "bg-[#1F2933] text-[#8090A0] hover:bg-[#2D3A47]"
                    }`}>
                    <div className="flex items-center gap-2">
                      <span className={`mono text-[10px] inline-flex items-center justify-center rounded-full w-4 h-4 ${
                        active ? "bg-white text-[#E74C3C]"
                          : done ? "bg-[#5EAFC5] text-[#0F1419]"
                          : "bg-[#2D3A47] text-[#8090A0]"
                      }`}>
                        {done ? "✓" : s.n}
                      </span>
                      <span className="mono text-xs font-semibold">{s.label}</span>
                    </div>
                    <div className={`mono text-[10px] mt-0.5 ${active ? "text-white/80" : "text-[#8090A0]"}`}>
                      {s.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* STEP 1 — WHERE */}
          {currentStep === 1 && (
            <StepWrapper
              title="Wo bist du?"
              hint="Setze deinen Heimat-Standort. Lokale Regionale werden automatisch aus dem Sammler-Schutz entfernt (du fängst sie ja eh) und stattdessen für den Tausch vorgeschlagen."
              onNext={() => gotoStep(2)}
              nextLabel="Weiter zu Schutz-Optionen"
            >
              <RegionalMap
                lastPin={lastPin}
                setLastPin={setLastPin}
                bazaarTags={bazaarTags}
                setBazaarTags={setBazaarTags}
                homeLocation={homeLocation}
                setHomeLocation={setHomeLocation}
                homeLocals={homeLocals}
                tradeTagName={config.basarTagName || "Trade"}
              />
            </StepWrapper>
          )}

          {/* STEP 2 — WHAT */}
          {currentStep === 2 && (
            <StepWrapper
              title="Was willst du schützen?"
              hint="Presets als Startpunkt, dann fein-tunen. Form-Schutz unterscheidet zwischen regulären und regionalen/Hisui-Formen."
              onBack={() => gotoStep(1)}
              onNext={() => gotoStep(3)}
              nextLabel="Weiter zu deiner Sammlung"
            >
              <ConfigPanel config={config} setConfig={setConfig} homeLocals={homeLocals} />
            </StepWrapper>
          )}

          {/* STEP 3 — HAVE */}
          {currentStep === 3 && (
            <StepWrapper
              title="Was hast du schon?"
              hint="Deine 4★-Sammlung. Für jede Spezies werden alle Nicht-Keeper-IVs (außer PvP) automatisch tossable — egal welche Sterne."
              onBack={() => gotoStep(2)}
              onNext={() => gotoStep(4)}
              nextLabel="Filter generieren"
            >
              <HundosEditor
                hundos={hundos}
                setHundos={setHundos}
                newHundo={newHundo}
                setNewHundo={setNewHundo}
                addHundo={addHundo}
                removeHundo={removeHundo}
              />
            </StepWrapper>
          )}

          {/* STEP 4 — FILTER */}
          {currentStep === 4 && (
            <StepWrapper
              title="Dein Filter"
              hint="Live aus deinen Eingaben generiert. trash für Willow, trade für Freunde."
              onBack={() => gotoStep(3)}
            >
              <div className="space-y-6">
                <FilterBox
                  label="trash"
                  accent="#E74C3C"
                  filterStr={trash}
                  copied={copied.trash}
                  onCopy={() => copyToClipboard("trash", trash)}
                />
                <FilterBox
                  label="trade"
                  accent="#5EAFC5"
                  filterStr={trade}
                  copied={copied.trade}
                  onCopy={() => copyToClipboard("trade", trade)}
                />
                {sort && (
                  <FilterBox
                    label="hundo-sort"
                    accent="#F5B82E"
                    filterStr={sort}
                    copied={copied.sort}
                    onCopy={() => copyToClipboard("sort", sort)}
                  />
                )}
                {prestaged && (
                  <FilterBox
                    label="vorbereitete Tausche"
                    accent="#9B59B6"
                    filterStr={prestaged}
                    copied={copied.prestaged}
                    onCopy={() => copyToClipboard("prestaged", prestaged)}
                  />
                )}
                {gift && (
                  <FilterBox
                    label="Ferne Freunde"
                    accent="#27AE60"
                    filterStr={gift}
                    copied={copied.gift}
                    onCopy={() => copyToClipboard("gift", gift)}
                  />
                )}
                {buddyCatchFilters.length > 0 && (
                  <BuddyCatchSection
                    buddyCatchFilters={buddyCatchFilters}
                    copied={copied}
                    onCopy={(key, text) => copyToClipboard(key, text)}
                  />
                )}

                {/* Summary stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mono text-xs">
                  <StatBox label="Standort" value={homeLocation ? `${homeLocation[1].toFixed(1)}°,${homeLocation[0].toFixed(1)}°` : "—"} />
                  <StatBox label="Hundos" value={hundos.length} />
                  <StatBox label="trash" value={`${trash.length}c`} />
                  <StatBox label="trade" value={`${trade.length}c`} />
                </div>

                {/* Collapsibles */}
                <div className="space-y-3 pt-2">
                  <Collapsible
                    icon="∑"
                    label="set-theoretischer Aufbau"
                    open={showSetTheory}
                    onToggle={() => setShowSetTheory(s => !s)}>
                    <SetTheory hundos={hundos} TE_full={TE_full} TE_trim={TE_trim} cfg={effectiveConfig} />
                  </Collapsible>

                  <Collapsible
                    icon="≡"
                    label="rohe Filter-Klauseln · was woher kommt"
                    open={showRawClauses}
                    onToggle={() => setShowRawClauses(s => !s)}>
                    <RawClausesPanel trashClauses={trashClauses} tradeClauses={tradeClauses} sortClauses={sortClauses} prestagedClauses={prestagedClauses} giftClauses={giftClauses} buddyCatchFilters={buddyCatchFilters} />
                  </Collapsible>

                  <Collapsible
                    icon="✓"
                    label="Pokémon prüfen"
                    open={showVerify}
                    onToggle={() => setShowVerify(s => !s)}>
                    <VerifyPanel trash={trash} trade={trade} hundos={hundos} TE_families={TRADE_EVO_FAMILIES} />
                  </Collapsible>
                </div>
              </div>
            </StepWrapper>
          )}

          {/* FOOTER */}
          <footer className="mt-12 pt-6 border-t border-[#1F2933] mono text-xs text-[#8090A0] flex items-center gap-2 flex-wrap">
            <Sparkles size={11} className="text-[#5EAFC5]" />
            persistiert lokal · {hundos.length} hundos · trash {trash.length}c · trade {trade.length}c
            {homeLocation && <span> · home {homeLocation[1].toFixed(1)}°,{homeLocation[0].toFixed(1)}°</span>}
          </footer>
        </div>
      </div>

      <SettingsModal
        open={showSettings}
        onClose={() => { setShowSettings(false); setResetArmed(false); }}
        config={config}
        setConfig={setConfig}
        onResetAll={resetAll}
        resetArmed={resetArmed}
      />
    </div>
  );
}

// ── Stepper-internal subcomponents ─────────────────────────────────────────

function StepWrapper({ title, hint, children, onBack, onNext, nextLabel }) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="mono text-xl font-bold text-[#E6EDF3]">{title}</h2>
        {hint && <p className="text-sm text-[#8B98A5] mt-1.5 max-w-2xl">{hint}</p>}
      </div>
      <div>{children}</div>
      <div className="flex items-center gap-2 pt-4 border-t border-[#1F2933]">
        {onBack && (
          <button onClick={onBack}
            className="mono text-sm bg-[#1F2933] hover:bg-[#2D3A47] text-[#E6EDF3] px-4 py-2 rounded transition">
            ← Zurück
          </button>
        )}
        <div className="flex-1" />
        {onNext && (
          <button onClick={onNext}
            className="mono text-sm bg-[#E74C3C] hover:bg-[#FF5A4A] text-white px-4 py-2 rounded transition">
            {nextLabel || "Weiter →"}
          </button>
        )}
      </div>
    </section>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="border border-[#1F2933] rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[#8090A0]">{label}</div>
      <div className="text-[#E6EDF3] mt-0.5">{value}</div>
    </div>
  );
}

function BuddyCatchSection({ buddyCatchFilters, copied, onCopy }) {
  return (
    <div className="space-y-3">
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#E67E22] flex items-baseline gap-2">
        <span>für Buddies fangen</span>
        <span className="text-[#8090A0] normal-case">· trashbare Pokémon der Wunsch-Spezies</span>
      </div>
      {buddyCatchFilters.map(b => {
        const key = `buddyCatch:${b.prefix}`;
        return (
          <FilterBox
            key={b.prefix}
            label={`fangen für ${b.buddyName}`}
            accent="#E67E22"
            filterStr={b.filter}
            copied={copied[key]}
            onCopy={() => onCopy(key, b.filter)}
          />
        );
      })}
    </div>
  );
}

function HundosEditor({ hundos, setHundos, newHundo, setNewHundo, addHundo, removeHundo }) {
  // Live preview of what's about to be added: parse the input, resolve each token,
  // show a green chip for each resolved one + a red marker for unresolved tokens.
  const previewTokens = useMemo(() => {
    return newHundo.split(/[,;\s]+/).filter(Boolean).map(tok => {
      const info = resolveSpeciesInfo(tok);
      return { input: tok, info };
    });
  }, [newHundo]);

  const resolved = previewTokens.filter(t => t.info);
  const unresolved = previewTokens.filter(t => !t.info);
  const newResolved = resolved.filter(t => !hundos.includes(t.info.de.toLowerCase()));
  const dupes = resolved.filter(t => hundos.includes(t.info.de.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
        |H| = {hundos.length} Familien
      </div>

      <div className="flex flex-wrap gap-1.5">
        {hundos.map(h => (
          <span key={h}
            className="chip-enter mono text-xs bg-[#1F2933] hover:bg-[#2D3A47] text-[#E6EDF3] pl-2.5 pr-1.5 py-1 rounded flex items-center gap-1.5 transition group">
            <span className="text-[#5EAFC5]">+</span>{h}
            <button onClick={() => removeHundo(h)}
              className="opacity-40 group-hover:opacity-100 hover:text-[#E74C3C] transition">
              <X size={12} />
            </button>
          </span>
        ))}
        {hundos.length === 0 && (
          <span className="mono text-xs text-[#8B98A5] italic">noch keine hundos — füge einen hinzu</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newHundo}
          onChange={e => setNewHundo(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addHundo()}
          placeholder="Nummer, EN oder DE — z.B. 1, Pikachu, Bisasam, 666"
          className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]" />
        <button
          onClick={addHundo}
          disabled={previewTokens.length === 0 || newResolved.length === 0}
          className="mono text-sm bg-[#E74C3C] hover:bg-[#FF5A4A] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5">
          <Plus size={14} /> hinzufügen
        </button>
      </div>

      {/* Live preview of what would be added */}
      {previewTokens.length > 0 && (
        <div className="border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] space-y-1.5">
          <div className="mono text-[10px] uppercase tracking-wider text-[#8090A0]">
            Vorschau · {newResolved.length} neu, {dupes.length} schon vorhanden, {unresolved.length} unbekannt
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewTokens.map((t, i) => {
              if (!t.info) {
                return (
                  <span key={i} className="mono text-[11px] bg-[#E74C3C]/15 text-[#E74C3C] px-2 py-0.5 rounded"
                        title="nicht gefunden — vielleicht Tippfehler?">
                    ✗ {t.input}
                  </span>
                );
              }
              const isDupe = hundos.includes(t.info.de.toLowerCase());
              const labelByType = { number: "#", english: "EN", german: "DE" };
              return (
                <span key={i}
                  className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
                    isDupe
                      ? "bg-[#8090A0]/15 text-[#8B98A5]"
                      : "bg-[#27AE60]/15 text-[#27AE60]"
                  }`}
                  title={`#${t.info.dex} · EN: ${t.info.en} · DE: ${t.info.de}${isDupe ? " (schon dabei)" : ""}`}>
                  <span className="text-[9px] opacity-60">{labelByType[t.info.inputType]}</span>
                  {t.info.de}
                  {isDupe && <span className="opacity-60">✓</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <p className="mono text-xs text-[#8090A0]">
        Akzeptiert <span className="text-[#5EAFC5]">Nummern</span>, <span className="text-[#5EAFC5]">englische</span>, oder <span className="text-[#5EAFC5]">deutsche</span> Namen.
        Mehrere auf einmal trennen mit Komma, Leerzeichen oder Semikolon.
      </p>
    </div>
  );
}

function CustomCollectiblesEditor({ list, onChange }) {
  const [input, setInput] = useState("");

  // Live preview using same resolver as hundo input
  const previewTokens = useMemo(() => {
    return input.split(/[,;\s]+/).filter(Boolean).map(tok => ({
      input: tok,
      info: resolveSpeciesInfo(tok),
    }));
  }, [input]);
  const resolved = previewTokens.filter(t => t.info);
  const newResolved = resolved.filter(t => !list.includes(t.info.de.toLowerCase()));
  const dupes = resolved.filter(t => list.includes(t.info.de.toLowerCase()));
  const unresolved = previewTokens.filter(t => !t.info);

  function addAll() {
    const tokens = input.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(list);
    const remaining = [];
    for (const tok of tokens) {
      const r = resolveSpecies(tok);
      if (r) set.add(r);
      else remaining.push(tok);
    }
    onChange([...set].sort());
    setInput(remaining.join(", "));
  }
  function remove(name) {
    onChange(list.filter(n => n !== name));
  }

  return (
    <div>
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
        Eigene Sammler-Pokémon · zusätzlich zum Trash-Schutz
      </div>
      <p className="mono text-xs text-[#8090A0] mb-3 leading-relaxed">
        Spezies, die du sammelst und nie wegwerfen willst — z.B. dein Lieblings-Pokémon, Form-Sammlungen, etc.
      </p>

      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {list.map(sp => (
            <span key={sp}
              className="chip-enter mono text-xs bg-[#27AE60]/15 text-[#27AE60] border border-[#27AE60]/40 pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group">
              {sp}
              <button onClick={() => remove(sp)}
                className="opacity-50 group-hover:opacity-100 hover:text-[#FF6B5B] transition">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addAll()}
          placeholder="Nummer, EN oder DE — z.B. Glurak, 6, Rayquaza"
          className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]" />
        <button
          onClick={addAll}
          disabled={previewTokens.length === 0 || newResolved.length === 0}
          className="mono text-sm bg-[#27AE60] hover:bg-[#3FCF80] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5">
          <Plus size={14} /> hinzufügen
        </button>
      </div>

      {previewTokens.length > 0 && (
        <div className="border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] mt-2 space-y-1.5">
          <div className="mono text-[10px] uppercase tracking-wider text-[#8090A0]">
            Vorschau · {newResolved.length} neu, {dupes.length} schon dabei, {unresolved.length} unbekannt
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewTokens.map((t, i) => {
              if (!t.info) return (
                <span key={i} className="mono text-[11px] bg-[#FF6B5B]/15 text-[#FF6B5B] px-2 py-0.5 rounded">
                  ✗ {t.input}
                </span>
              );
              const isDupe = list.includes(t.info.de.toLowerCase());
              const labelByType = { number: "#", english: "EN", german: "DE" };
              return (
                <span key={i}
                  className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
                    isDupe
                      ? "bg-[#5C6975]/15 text-[#8090A0]"
                      : "bg-[#27AE60]/15 text-[#27AE60]"
                  }`}>
                  <span className="text-[9px] opacity-60">{labelByType[t.info.inputType]}</span>
                  {t.info.de}
                  {isDupe && <span className="opacity-60">✓</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SUBCOMPONENTS ────────────────────────────────────────────────────────

function FilterBox({ label, accent, filterStr, copied, onCopy }) {
  const len = filterStr.length;
  const pct = Math.min(100, (len / 5000) * 100);
  const codeRef = useRef(null);

  // Tap the filter text to select-all — on mobile this lets long-press → "Copy"
  // surface the system copy menu without needing the clipboard API at all.
  function selectAll() {
    const el = codeRef.current;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // copied tri-state: false | "ok" | "err"
  const buttonLabel =
    copied === "ok"  ? <><Check size={12} /> kopiert</> :
    copied === "err" ? <><X size={12} /> nicht erlaubt — tippe Text an</> :
    <><Copy size={12} /> kopieren</>;
  const buttonColor =
    copied === "ok"  ? "#27AE60" :
    copied === "err" ? "#FF6B5B" :
    "#E6EDF3";

  return (
    <div className="border border-[#1F2933] rounded">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1F2933] bg-[#141A21] gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="mono text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>
            {label}
          </span>
          <span className="mono text-xs text-[#8090A0]">
            {len.toLocaleString()} / 5000 chars
          </span>
          <div className="w-24 h-1 bg-[#1F2933] rounded-full overflow-hidden">
            <div className="h-full transition-all" style={{ width: `${pct}%`, background: accent }} />
          </div>
        </div>
        <button
          onClick={onCopy}
          className="mono text-xs flex items-center gap-1.5 px-2.5 py-1 bg-[#1F2933] hover:bg-[#2D3A47] rounded transition"
          style={{ color: buttonColor }}>
          {buttonLabel}
        </button>
      </div>
      <div className="p-4 max-h-40 overflow-auto bg-[#0B0F14]">
        <code
          ref={codeRef}
          onClick={selectAll}
          className="mono text-xs text-[#E6EDF3] break-all leading-relaxed cursor-text select-all block"
          style={{ userSelect: "all", WebkitUserSelect: "all" }}
          title="Tippen markiert alles — dann kopieren über das System-Menü">
          {filterStr}
        </code>
      </div>
    </div>
  );
}

function Collapsible({ icon, label, open, onToggle, children }) {
  return (
    <details open={open} className="border border-[#1F2933] rounded">
      <summary onClick={e => { e.preventDefault(); onToggle(); }}
        className="px-4 py-3 flex items-center gap-3 hover:bg-[#141A21] transition">
        {open ? <ChevronDown size={14} className="text-[#5EAFC5]" /> : <ChevronRight size={14} className="text-[#8090A0]" />}
        <span className="mono text-sm text-[#5EAFC5]">{icon}</span>
        <span className="mono text-sm font-medium text-[#E6EDF3]">{label}</span>
      </summary>
      {open && <div className="px-4 pb-4 pt-2 border-t border-[#1F2933]">{children}</div>}
    </details>
  );
}

function SetTheory({ hundos, TE_full, TE_trim, cfg }) {
  const Pdesc = cfg.pvpMode === "loose" ? "(0-1, 3-4, 3-4)"
            : cfg.pvpMode === "strict" ? "(0, 3-4, 3-4)" : "∅ (disabled)";
  return (
    <div className="mono text-xs text-[#A8B3BD] leading-relaxed space-y-3">
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <span className="text-[#5EAFC5]">H</span>
        <span>= {`{${hundos.length} families}`} → expanded via <code className="text-[#E6EDF3]">+species</code></span>
        <span className="text-[#5EAFC5]">K</span>
        <span>= (4,4,3-4) ∪ (4,3-4,4) ∪ (3-4,4,4) <span className="text-[#8090A0]">— two perfect bars + third ≥ 11 IV</span></span>
        <span className="text-[#5EAFC5]">P</span>
        <span>= {Pdesc} <span className="text-[#8090A0]">— PvP keep set</span></span>
        <span className="text-[#5EAFC5]">S012</span>
        <span>= 0★ ∪ 1★ ∪ 2★</span>
        <span className="text-[#5EAFC5]">TE</span>
        <span>= {`{${TE_full.length} trade-evo families}`} ({TE_trim.length} after H-overlap dedup in clause 1)</span>
      </div>
      <hr className="border-[#1F2933]" />
      <div className="space-y-1.5">
        <div className="text-[#E74C3C]">Trash<span className="text-[#8090A0]"> = (S012 ∪ (H ∩ ¬K)) ∩ ¬P ∩ ¬Prot</span></div>
        <div className="text-[#5EAFC5]">Trade<span className="text-[#8090A0]"> = (S012 ∪ TE ∪ (H ∩ ¬K)) ∩ ¬P ∩ ¬S4 ∩ ¬Prot ∩ ¬Traded</span></div>
      </div>
      <div className="text-[#8090A0] text-[10.5px] leading-relaxed pt-2">
        <span className="text-[#F5B82E]">▲</span> Rule 1 (never toss 4★) is <em>automatic</em> — any 4★ hundo trivially matches K, so ¬K excludes them.
        K and P are disjoint (atk≥3 vs atk≤1), so they don't overlap.
      </div>
    </div>
  );
}

function RawClausesPanel({ trashClauses, tradeClauses, sortClauses, prestagedClauses, giftClauses, buddyCatchFilters }) {
  return (
    <div className="space-y-5 mono text-xs">
      <div className="text-[#8090A0] leading-relaxed">
        Jede Klausel im finalen Filter, mit Erklärung warum sie da ist. Alle Klauseln werden mit <code className="text-[#E6EDF3]">&amp;</code> kombiniert — jede muss erfüllt sein, damit ein Pokémon im Filter auftaucht.
      </div>

      <ClauseList title="Trash-Filter" accent="#E74C3C" clauses={trashClauses} />
      <ClauseList title="Trade-Filter" accent="#5EAFC5" clauses={tradeClauses} />
      {sortClauses && sortClauses.length > 0 && (
        <ClauseList title="Hundo-Sort-Filter" accent="#F5B82E" clauses={sortClauses} />
      )}
      {prestagedClauses && prestagedClauses.length > 0 && (
        <ClauseList title="Vorbereitete Tausche" accent="#9B59B6" clauses={prestagedClauses} />
      )}
      {giftClauses && giftClauses.length > 0 && (
        <ClauseList title="Ferne Freunde" accent="#27AE60" clauses={giftClauses} />
      )}
      {buddyCatchFilters && buddyCatchFilters.length > 0 && buddyCatchFilters.map(b => (
        <ClauseList key={`catch:${b.prefix}`} title={`fangen für ${b.buddyName}`} accent="#E67E22" clauses={b.clauses} />
      ))}
    </div>
  );
}

function ClauseList({ title, accent, clauses }) {
  return (
    <div>
      <div className="mono text-[10.5px] uppercase tracking-wider mb-2" style={{ color: accent }}>
        {title} · {clauses.length} Klauseln
      </div>
      <div className="border border-[#1F2933] rounded divide-y divide-[#1F2933]">
        {clauses.map((c, i) => (
          <div key={i} className="px-3 py-2 hover:bg-[#141A21] transition">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-[#8090A0] flex-shrink-0">{i+1}.</span>
              <code className="text-[#E6EDF3] flex-1 break-all">{c.clause}</code>
            </div>
            <div className="text-[10.5px] text-[#8090A0] mt-1 ml-5 leading-tight">
              {c.why}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerifyPanel({ trash, trade, hundos, TE_families }) {
  const [m, setM] = useState({
    family: "", star: 2, atk: 1, def: 1, hp: 1,
    flags: {}, types: [], dex: 0,
  });
  function setFlag(k, v) { setM({ ...m, flags: { ...m.flags, [k]: v } }); }

  // Build mon for parser
  const mon = useMemo(() => {
    const fam = m.family.trim().toLowerCase().replace(/^\+/, "");
    let families = fam ? [fam] : [];
    // expand to known families
    for (const [, members] of Object.entries(TE_families)) {
      if (members.includes(fam)) families = [...new Set([...families, ...members])];
    }
    return {
      ...m, families, dex: m.dex || 0,
      wp: 1500, ageDays: 5, distance: m.flags.farDistance ? 200 : 0,
      year: 2025,
    };
  }, [m, TE_families]);

  const inTrash = useMemo(() => evalFilter(trash, mon), [trash, mon]);
  const inTrade = useMemo(() => evalFilter(trade, mon), [trade, mon]);
  const inH = hundos.includes(mon.families[0] || "");

  const flagToggles = [
    ["favorite","fav"],["tagged","tag"],["shiny","shiny"],["lucky","lucky"],
    ["legendary","legend"],["mythical","myth"],["shadow","crypto"],["legacyMove","spezial"],
    ["megaEvolved","mega'd"],["dynamaxCapable","dyna"],["doubleMoved","2nd-move"],
    ["xxl","xxl"],["xl","xl"],["xxs","xxs"],["leagueU","ⓤ"],["buddy","buddy"],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FieldText label="family" value={m.family} onChange={v => setM({ ...m, family: v })} placeholder="e.g. bisasam" />
        <FieldNum label="star" value={m.star} onChange={v => setM({ ...m, star: +v })} min={0} max={4} />
        <FieldNum label="atk IV" value={m.atk} onChange={v => setM({ ...m, atk: +v })} min={0} max={4} />
        <FieldNum label="def IV" value={m.def} onChange={v => setM({ ...m, def: +v })} min={0} max={4} />
        <FieldNum label="hp IV" value={m.hp} onChange={v => setM({ ...m, hp: +v })} min={0} max={4} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {flagToggles.map(([k, label]) => (
          <button key={k}
            onClick={() => setFlag(k, !m.flags[k])}
            className={`mono text-[11px] px-2 py-1 rounded transition ${
              m.flags[k]
                ? "bg-[#5EAFC5] text-[#0F1419]"
                : "bg-[#1F2933] text-[#8B98A5] hover:bg-[#2D3A47]"
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-2">
        <ResultBox label="trash" verdict={inTrash} accent="#E74C3C" />
        <ResultBox label="trade" verdict={inTrade} accent="#5EAFC5" />
      </div>
      <div className="mono text-[11px] text-[#8090A0]">
        family in H: <span className={inH ? "text-[#5EAFC5]" : "text-[#8090A0]"}>{inH ? "yes" : "no"}</span>
        <span className="mx-2">·</span>
        IV class: {classifyIV(m.atk, m.def, m.hp)}
      </div>
    </div>
  );
}

function classifyIV(a, d, h) {
  const isP = a <= 1 && d >= 3 && h >= 3;
  const k1 = a === 4 && d === 4 && h >= 3;
  const k2 = a === 4 && d >= 3 && h === 4;
  const k3 = a >= 3 && d === 4 && h === 4;
  if (k1 || k2 || k3) return <span className="text-[#5EAFC5]">K (keeper)</span>;
  if (isP) return <span className="text-[#F5B82E]">P (PvP)</span>;
  return <span className="text-[#8090A0]">neither</span>;
}

function ResultBox({ label, verdict, accent }) {
  return (
    <div className="border rounded p-3" style={{ borderColor: verdict ? accent : "#1F2933" }}>
      <div className="mono text-[11px] uppercase tracking-wider text-[#8090A0]">{label}</div>
      <div className="mono text-lg font-bold mt-1" style={{ color: verdict ? accent : "#8090A0" }}>
        {verdict ? "✓ visible" : "— hidden"}
      </div>
    </div>
  );
}

function FieldText({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] placeholder:text-[#8090A0] mt-1" />
    </div>
  );
}
function FieldNum({ label, value, onChange, min, max }) {
  return (
    <div>
      <label className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">{label}</label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} min={min} max={max}
        className="mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1" />
    </div>
  );
}

// ─── PRESETS ────────────────────────────────────────────────────────────────

const PRESETS = {
  casual: {
    label: "Casual",
    description: "Alle wichtigen Schutzmaßnahmen aktiv, lockerer PvP-Schutz",
    apply: (cfg) => ({
      ...cfg,
      pvpMode: "loose",
      protectFavorites: true, protectShinies: true, protectLuckies: true,
      protectLegendaries: true, protectMythicals: true,
      protectUltraBeasts: true, protectShadows: true, protectPurified: true,
      protectCostumes: true, protectBackgrounds: true, protectLegacyMoves: true,
      protectBabies: true,
      protectXXL: true, protectXL: true, protectXXS: true,
      protectDoubleMoved: true, protectDynamax: true, protectNewEvolutions: true,
      protectBuddies: true,
      regionalGroups: defaultRegionalToggles(),
    }),
  },
  collector: {
    label: "Sammler",
    description: "Empfohlen für Dex-Komplettierer — schützt alle Formen",
    apply: (cfg) => {
      const groups = defaultRegionalToggles();
      for (const k of Object.keys(groups)) groups[k].enabled = true;
      return { ...cfg,
        pvpMode: "loose",
        protectFavorites: true, protectShinies: true, protectLuckies: true,
        protectLegendaries: true, protectMythicals: true,
        protectUltraBeasts: true, protectShadows: true, protectPurified: true,
        protectCostumes: true, protectBackgrounds: true, protectLegacyMoves: true,
        protectBabies: true,
        protectXXL: true, protectXL: true, protectXXS: true,
        protectDoubleMoved: true, protectDynamax: true, protectNewEvolutions: true,
        protectBuddies: true,
        regionalGroups: groups,
      };
    },
  },
  aggressive: {
    label: "Aggressiv",
    description: "Schnelles Ausmisten — kein Form-Schutz, strenger PvP",
    apply: (cfg) => {
      const groups = defaultRegionalToggles();
      for (const k of Object.keys(groups)) groups[k].enabled = false;
      return { ...cfg,
        pvpMode: "strict",
        protectFavorites: true, protectShinies: true, protectLuckies: true,
        protectLegendaries: true, protectMythicals: true,
        protectUltraBeasts: true, protectShadows: true, protectPurified: true,
        protectCostumes: true, protectBackgrounds: true, protectLegacyMoves: true,
        protectBabies: false,
        protectXXL: false, protectXL: false, protectXXS: false,
        protectDoubleMoved: true, protectDynamax: true, protectNewEvolutions: false,
        protectBuddies: false,
        regionalGroups: groups,
      };
    },
  },
  pvpFocus: {
    label: "PvP-Fokus",
    description: "Strenge PvP-IVs, schützt Liga-Tags, sonst aggressiv",
    apply: (cfg) => {
      const groups = defaultRegionalToggles();
      groups.alolan.enabled = false;
      groups.galarian.enabled = false;
      groups.hisuian.enabled = false;
      groups.paldean.enabled = false;
      return { ...cfg,
        pvpMode: "strict",
        protectFavorites: true, protectShinies: true, protectLuckies: true,
        protectLegendaries: true, protectMythicals: true,
        protectUltraBeasts: true, protectShadows: true, protectPurified: true,
        protectCostumes: false, protectBackgrounds: false, protectLegacyMoves: true,
        protectBabies: false,
        protectXXL: false, protectXL: false, protectXXS: false,
        protectDoubleMoved: true, protectDynamax: false, protectNewEvolutions: false,
        protectBuddies: false,
        regionalGroups: groups,
      };
    },
  },
};

// Settings that are HIDDEN in normal mode and only show with expert toggle on.
// These are: things most people never want to touch (Ultrabestien, Mysteriös,
// Buddies, Distance/CP/age scope, Liga-Tag custom names, etc).
const EXPERT_ONLY_KEYS = new Set([
  "protectMythicals", "mythTooManyOf",
  "protectUltraBeasts",
  "protectPurified",
  "protectBuddies",
  "protectDynamax",
  "leagueTags",
  "customProtectedTags",
  "cpCap",
  "ageScopeDays",
  "distanceProtect",
]);

function ConfigPanel({ config, setConfig, homeLocals = [] }) {
  function set(k, v) { setConfig({ ...config, [k]: v }); }
  function setGroup(groupKey, partial) {
    const groups = { ...(config.regionalGroups || {}) };
    groups[groupKey] = { ...groups[groupKey], ...partial };
    set("regionalGroups", groups);
  }
  function applyPreset(presetKey) {
    setConfig(PRESETS[presetKey].apply(config));
  }

  const expert = !!config.expertMode;

  // Universal protections — shown in all modes (these are the "obviously yes" ones)
  const alwaysOn = [
    ["protectFavorites",     "Favoriten",                 "Pokémon mit Stern markiert"],
    ["protectAnyTag",        "Markierte Pokémon (alle Tags)", "egal welches Tag — alles Markierte ist sicher"],
    ["protectTradeEvos",     "Tausch-Evolutionen",        "Schützt Familien wo Tausch eine Gratis-Evo gibt (Abra, Machollo, Nebulak, ...) — außer schon getauschte (dann ist die Gratis-Evo verbraucht)"],
    ["protectShinies",       "Schillernde",               "Glitzer-Pokémon (selten)"],
    ["protectLuckies",       "Glücks-Pokémon",            "Halbierter Stardust beim Power-up"],
    ["protectLegendaries",   "Legendäre",                 "Mewtu, Lugia, etc — eh nicht tauschbar in Massentausch"],
    ["protectShadows",       "Crypto-Pokémon",            "Schutz im Trash. Tausch ist eh blockiert (Crypto unhandelbar)"],
    ["protectCostumes",      "Kostümierte",               "Event-Forms wie Sonnenbrille-Pikachu"],
    ["protectBackgrounds",   "Mit Hintergrund",           "Spezielle Backgrounds (Pokémon-Day, etc)"],
    ["protectLegacyMoves",   "Legacy-Attacken",           "@spezial — Pokémon mit alten Event-Moves"],
    ["protectBabies",        "Baby-Pokémon",              "Pokémon die nur aus Eiern schlüpfen können"],
    ["protectXXL",           "XXL Größe",                 "Sehr große Pokémon (Größenrekord-Wert)"],
    ["protectXL",            "XL Größe",                  "Große Pokémon"],
    ["protectXXS",           "XXS Größe",                 "Sehr kleine Pokémon (Größenrekord-Wert)"],
    ["protectNewEvolutions", "Neue Evolutionen",          "Pokémon, deren Evolution ein neuer Dex-Eintrag wäre"],
    ["protectDoubleMoved",   "Zweiter Charge-Move",       "Pokémon, bei denen der zweite Charge-Move freigeschaltet ist"],
  ];

  const expertOnly = [
    ["protectFourStar",      "4★ Hundos schützen",        "Sicherheitsgürtel: niemals 4★ Pokémon tossen — Regel 1. AUSSCHALTEN AUF EIGENE GEFAHR.", { requireConfirmOff: true }],
    ["protectMythicals",     "Mysteriöse",                "Mew, Celebi, etc — sind nicht tauschbar"],
    ["protectUltraBeasts",   "Ultrabestien",              "Necrozma, Buzzwole, etc"],
    ["protectPurified",      "Erlöste",                   "Ehemals Crypto, verlieren Bonus beim Tausch"],
    ["protectDynamax",       "Dynamax-fähige",            "Pokémon mit freigeschaltetem Dynamax"],
    ["protectBuddies",       "Schon mal Kumpel gewesen",  "Sentimentaler Schutz — niemand will alte Kumpel tauschen"],
  ];

  return (
    <div className="space-y-6">
      {/* Home-locals banner */}
      {homeLocals.length > 0 && (() => {
        // Find all collector lists across all groups, intersect with homeLocals
        const allCollectors = Object.values(REGIONAL_GROUPS).flatMap(g => g.collectors);
        const autoRemoved = homeLocals.filter(l => allCollectors.includes(l));
        return (
          <div className="border border-[#27AE60]/40 bg-[#27AE60]/5 rounded p-3 mono text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-[#27AE60]">⌂</span>
              <div className="flex-1">
                <div className="text-[#E6EDF3]">
                  Aus dem Schutz automatisch entfernt: <span className="text-[#27AE60]">{autoRemoved.join(", ") || "keine"}</span>
                </div>
                <div className="text-[10.5px] text-[#8090A0] mt-1">
                  Diese spawnen bei dir lokal — Schutz wäre unnötig, würde aber Regel 3 (toss aus H ∩ ¬K) blockieren.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PRESETS */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">Presets</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button key={key}
              onClick={() => applyPreset(key)}
              title={preset.description}
              className="mono text-xs px-3 py-1.5 rounded bg-[#1F2933] text-[#E6EDF3] hover:bg-[#5EAFC5] hover:text-[#0F1419] transition">
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mono text-[10.5px] text-[#8090A0] mt-1.5">
          Presets überschreiben alle Einstellungen unten. Danach Details fein-tunen.
        </div>
      </div>

      <hr className="border-[#1F2933]" />

      {/* PvP MODE */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">PvP-Modus · was als Keeper gilt</div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["loose",  "Loose",  "(0-1, 3-4, 3-4) — schützt auch 1-Atk Spreads"],
            ["strict", "Strict", "(0, 3-4, 3-4) — nur klassische Nundo-PvP"],
            ["none",   "Aus",    "kein PvP-Schutz"],
          ].map(([m, label, desc]) => (
            <button key={m}
              onClick={() => set("pvpMode", m)}
              title={desc}
              className={`mono text-xs px-3 py-1.5 rounded transition ${
                config.pvpMode === m
                  ? "bg-[#5EAFC5] text-[#0F1419]"
                  : "bg-[#1F2933] text-[#8B98A5] hover:bg-[#2D3A47]"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <hr className="border-[#1F2933]" />

      {/* PROTECTIONS */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
          Schutzmaßnahmen · was nie weggeworfen werden soll
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
          {alwaysOn.map(([k, label, why, extra]) => (
            <ToggleRow key={k} k={k} label={label} why={why}
              checked={!!config[k]} onChange={v => set(k, v)} {...(extra || {})} />
          ))}
          {expert && expertOnly.map(([k, label, why, extra]) => (
            <ToggleRow key={k} k={k} label={label} why={why} expertBadge
              checked={!!config[k]} onChange={v => set(k, v)} {...(extra || {})} />
          ))}
        </div>
      </div>

      {/* MYTHICAL CARVE-OUT (only when mythicals protected and expert mode) */}
      {expert && config.protectMythicals && (
        <div>
          <label className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1 block">
            Mysteriöse, von denen du Spares hast (Dex-Nummern, kommasepariert)
          </label>
          <input
            type="text"
            value={config.mythTooManyOf || ""}
            onChange={e => set("mythTooManyOf", e.target.value)}
            placeholder="z.B. 808,649 für Meltan + Genesect"
            className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
          <div className="mono text-[10px] text-[#8090A0] mt-1">
            Diese werden vom Mysteriös-Schutz ausgenommen — z.B. Meltan, von dem man oft hunderte hat
          </div>
        </div>
      )}

      <hr className="border-[#1F2933]" />

      {/* REGIONAL GROUPS */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
          Regionale Formen &amp; Sammler-Pokémon
        </div>
        <div className="space-y-2">
          {Object.entries(REGIONAL_GROUPS).map(([key, group]) =>
            <RegionalGroupEditor
              key={key}
              groupKey={key}
              group={group}
              state={config.regionalGroups?.[key] || { enabled: true, typeChecksEnabled: null, collectorsEnabled: null }}
              setGroup={(partial) => setGroup(key, partial)}
              homeLocals={homeLocals}
            />
          )}
        </div>
      </div>

      <hr className="border-[#1F2933]" />

      {/* BUDDY EVENTS — only shows if buddies are configured */}
      {(config.buddies || []).filter(b => b.active !== false).length > 0 && (
        <>
          <BuddyEventsEditor
            buddies={(config.buddies || []).filter(b => b.active !== false)}
            onUpdateBuddy={(id, partial) => {
              const all = config.buddies || [];
              set("buddies", all.map(b => b.id === id ? { ...b, ...partial } : b));
            }}
          />
          <hr className="border-[#1F2933]" />
        </>
      )}

      {/* CUSTOM COLLECTIBLES */}
      <CustomCollectiblesEditor
        list={config.customCollectibles || []}
        onChange={list => set("customCollectibles", list)}
      />

      <hr className="border-[#1F2933]" />

      {/* TRADE-EVO FAMILIES */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
          Tausch-Entwicklungs-Familien · gratis Evo durch Tausch
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(TRADE_EVO_FAMILIES).map(b => {
            const on = (config.enabledTradeEvos || []).includes(b);
            return (
              <button key={b}
                onClick={() => set("enabledTradeEvos",
                  on
                    ? (config.enabledTradeEvos || []).filter(x => x !== b)
                    : [...(config.enabledTradeEvos || []), b])}
                title={`+${TE_DISPLAY[b]} — wenn aktiv, werden alle Familienmitglieder (Vor- und Nachevolutionen) im Tausch-Filter geschützt`}
                className={`mono text-xs px-2.5 py-1 rounded transition ${
                  on ? "bg-[#5EAFC5] text-[#0F1419]" : "bg-[#1F2933] text-[#8090A0] hover:bg-[#2D3A47]"
                }`}>
                +{TE_DISPLAY[b]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ k, label, why, checked, onChange, expertBadge, requireConfirmOff }) {
  // For dangerous toggles (e.g. "always protect 4★"), turning them OFF requires
  // a two-click confirmation. Turning them back ON is unrestricted.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  function handleChange(e) {
    const newValue = e.target.checked;
    if (requireConfirmOff && checked && !newValue) {
      // Trying to turn OFF a dangerous toggle
      if (!armed) {
        setArmed(true);
        // Don't fire change yet — keep checkbox on
        e.preventDefault?.();
        return;
      }
      // Second click within timeout — actually disable
      setArmed(false);
      onChange(false);
      return;
    }
    setArmed(false);
    onChange(newValue);
  }

  return (
    <label
      className={`mono text-xs flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 transition ${
        armed ? "bg-[#E74C3C]/15 border border-[#E74C3C]/40" : "hover:bg-[#141A21] border border-transparent"
      }`}
      title={why}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={handleChange}
        className="accent-[#E74C3C] mt-0.5" />
      <div className="flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[#E6EDF3]">{label}</span>
          {expertBadge && <span className="text-[9px] text-[#F5B82E]">EXPERT</span>}
          {armed && (
            <span className="text-[10px] text-[#FF6B5B] font-semibold">
              wirklich? klick zur Bestätigung
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#8090A0] leading-tight">{why}</div>
      </div>
    </label>
  );
}


function RegionalGroupEditor({ groupKey, group, state, setGroup, homeLocals = [] }) {
  const [expanded, setExpanded] = useState(false);
  const allTC = group.typeChecks.map(t => t.species);
  const allCol = group.collectors;
  const tcEnabled = state.typeChecksEnabled === null ? allTC : state.typeChecksEnabled;
  const colEnabled = state.collectorsEnabled === null ? allCol : state.collectorsEnabled;
  // Home-locals are auto-dropped by effectiveConfig — exclude them from the counter
  // so the displayed "X/Y aktiv" matches the actual filter output.
  const homeSet = new Set(homeLocals);
  const tcEffective = tcEnabled.filter(sp => !homeSet.has(sp));
  const colEffective = colEnabled.filter(sp => !homeSet.has(sp));
  const totalEffective = allTC.filter(sp => !homeSet.has(sp)).length
                       + allCol.filter(sp => !homeSet.has(sp)).length;
  const droppedByHome = (tcEnabled.length + colEnabled.length) - (tcEffective.length + colEffective.length);
  const enabledCount = state.enabled ? (tcEffective.length + colEffective.length) : 0;

  function toggleTC(species) {
    const cur = tcEnabled;
    const next = cur.includes(species) ? cur.filter(s => s !== species) : [...cur, species];
    setGroup({ typeChecksEnabled: next.length === allTC.length ? null : next });
  }
  function toggleCol(species) {
    const cur = colEnabled;
    const next = cur.includes(species) ? cur.filter(s => s !== species) : [...cur, species];
    setGroup({ collectorsEnabled: next.length === allCol.length ? null : next });
  }
  function selectAll() {
    setGroup({ enabled: true, typeChecksEnabled: null, collectorsEnabled: null });
  }
  function selectNone() {
    setGroup({ typeChecksEnabled: [], collectorsEnabled: [] });
  }

  return (
    <div className={`border rounded transition ${state.enabled ? "border-[#2D3A47]" : "border-[#1F2933] opacity-60"}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <input
          type="checkbox"
          checked={!!state.enabled}
          onChange={e => setGroup({ enabled: e.target.checked })}
          className="accent-[#E74C3C]"
        />
        <button onClick={() => setExpanded(x => !x)} className="flex-1 text-left flex items-center gap-2">
          {expanded
            ? <ChevronDown size={12} className="text-[#5EAFC5]" />
            : <ChevronRight size={12} className="text-[#8090A0]" />}
          <span className="mono text-sm text-[#E6EDF3]">{group.label}</span>
          <span className="mono text-[10px] text-[#8090A0]">
            {state.enabled ? `${enabledCount}/${totalEffective} aktiv` : "deaktiviert"}
            {droppedByHome > 0 && state.enabled && (
              <span className="text-[#27AE60] ml-1">
                (+{droppedByHome} via ⌂)
              </span>
            )}
          </span>
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-[#1F2933]">
          <div className="mono text-[11px] text-[#8090A0] mb-1">{group.description}</div>
          <div className="flex gap-2">
            <button onClick={selectAll} className="mono text-[10px] text-[#5EAFC5] hover:text-[#7FCFE5] transition">
              alle auswählen
            </button>
            <span className="text-[#8090A0]">·</span>
            <button onClick={selectNone} className="mono text-[10px] text-[#8090A0] hover:text-[#E74C3C] transition">
              keine
            </button>
          </div>
          {group.typeChecks.length > 0 && (
            <div>
              <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1">
                Form-Schutz (Type-Check)
              </div>
              <div className="flex flex-wrap gap-1">
                {group.typeChecks.map(tc => {
                  const on = tcEnabled.includes(tc.species);
                  return (
                    <button key={tc.species}
                      onClick={() => toggleTC(tc.species)}
                      title={tc.note}
                      disabled={!state.enabled}
                      className={`mono text-[11px] px-2 py-0.5 rounded transition ${
                        on
                          ? "bg-[#5EAFC5]/20 text-[#5EAFC5] border border-[#5EAFC5]/40"
                          : "bg-[#1F2933] text-[#8090A0] border border-transparent hover:bg-[#2D3A47]"
                      }`}>
                      {tc.species} <span className="opacity-70">/ !{tc.type}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {group.collectors.length > 0 && (
            <div>
              <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1">
                Sammler (Spezies-Schutz)
              </div>
              <div className="flex flex-wrap gap-1">
                {group.collectors.map(sp => {
                  const on = colEnabled.includes(sp);
                  const isHomeLocal = homeLocals.includes(sp);
                  // Home-locals are auto-removed by effectiveConfig regardless of `on`,
                  // so render them as "off" visually with a ⌂ marker.
                  const effectivelyOn = on && !isHomeLocal;
                  return (
                    <button key={sp}
                      onClick={() => toggleCol(sp)}
                      disabled={!state.enabled || isHomeLocal}
                      title={isHomeLocal
                        ? "automatisch deaktiviert — diese Spezies spawnt bei dir lokal (Heimat)"
                        : undefined}
                      className={`mono text-[11px] px-2 py-0.5 rounded transition ${
                        effectivelyOn
                          ? "bg-[#F5B82E]/20 text-[#F5B82E] border border-[#F5B82E]/40"
                          : isHomeLocal
                            ? "bg-[#27AE60]/10 text-[#27AE60] border border-[#27AE60]/30 line-through opacity-60"
                            : "bg-[#1F2933] text-[#8090A0] border border-transparent hover:bg-[#2D3A47]"
                      }`}>
                      {isHomeLocal && <span className="not-italic no-underline mr-0.5">⌂</span>}
                      {sp}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RegionalMap({ lastPin, setLastPin, bazaarTags, setBazaarTags, homeLocation, setHomeLocation, homeLocals, tradeTagName = "Trade" }) {
  const [worldData, setWorldData] = useState(null);
  const [loadStatus, setLoadStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    const urls = [
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
      "https://unpkg.com/world-atlas@2/countries-110m.json",
    ];
    (async () => {
      for (const url of urls) {
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const topo = await r.json();
          const geo = decodeTopo(topo, "countries");
          setWorldData(geo);
          setLoadStatus("ready");
          return;
        } catch {}
      }
      setLoadStatus("error");
    })();
  }, []);

  // d3 equirectangular projection
  const projection = useMemo(
    () =>
      d3.geoEquirectangular()
        .scale(VIEW_W / (2 * Math.PI))
        .translate([VIEW_W / 2, VIEW_H / 2 + 20]),
    []
  );
  const pathGen = useMemo(() => d3.geoPath(projection), [projection]);

  const tropicN = projection([0, 26])[1];
  const tropicS = projection([0, -26])[1];
  const equator = projection([0, 0])[1];
  const meridian = projection([0, 0])[0];

  // SVG ref for click coord conversion
  const svgRef = useRef(null);
  // Hover preview pin — separate from lastPin (the locked one).
  // Updates continuously while mouse moves; cleared when mouse leaves the map.
  const [hoverPin, setHoverPin] = useState(null);

  function clientToLonLat(clientX, clientY) {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const svgPt = pt.matrixTransform(ctm.inverse());
    return projection.invert([svgPt.x, svgPt.y]);
  }

  function handleMapMove(e) {
    if (loadStatus !== "ready") return;
    const lonLat = clientToLonLat(e.clientX, e.clientY);
    if (lonLat) setHoverPin(lonLat);
  }
  function handleMapLeave() { setHoverPin(null); }
  function handleMapClick(e) {
    if (loadStatus !== "ready") return;
    const lonLat = clientToLonLat(e.clientX, e.clientY);
    if (lonLat) setLastPin(lonLat);
  }

  // Preview matches (hover) + locked matches (lastPin) computed separately
  const previewMatches = useMemo(() => {
    if (!hoverPin) return null;
    const out = [];
    for (const r of POGO_REGIONS) {
      if (r.geometry.type !== "Polygon" && r.geometry.type !== "MultiPolygon") continue;
      if (pointInRegionGeom(hoverPin, r.geometry)) out.push(r);
    }
    return out;
  }, [hoverPin]);

  const matches = useMemo(() => {
    if (!lastPin) return [];
    const out = [];
    for (const r of POGO_REGIONS) {
      if (r.geometry.type !== "Polygon" && r.geometry.type !== "MultiPolygon") continue;
      if (pointInRegionGeom(lastPin, r.geometry)) out.push(r);
    }
    return out;
  }, [lastPin]);

  // Aggregate Pokémon names from matched regions, splitting into:
  //   - "wanted": at this pin but NOT already at home (worth bringing back)
  //   - "alreadyLocal": at this pin AND already at home (no need to tag — friends don't need them)
  const homeLocalsSet = useMemo(() => new Set(homeLocals || []), [homeLocals]);
  const { pokemonWanted, pokemonAlreadyLocal } = useMemo(() => {
    const all = new Set();
    matches.forEach(m => m.german.forEach(n => all.add(n)));
    const wanted = [], alreadyLocal = [];
    for (const n of all) {
      if (homeLocalsSet.has(n)) alreadyLocal.push(n);
      else wanted.push(n);
    }
    return { pokemonWanted: wanted, pokemonAlreadyLocal: alreadyLocal };
  }, [matches, homeLocalsSet]);
  // Combined list — kept for the count-only "n region(s) here" display
  const pokemonAtPin = useMemo(
    () => [...pokemonWanted, ...pokemonAlreadyLocal],
    [pokemonWanted, pokemonAlreadyLocal]
  );

  function addAllToBazaar() {
    // Only add the "wanted" ones — adding locals would just duplicate what
    // friends elsewhere already have access to via me.
    const merged = [...new Set([...bazaarTags, ...pokemonWanted])];
    setBazaarTags(merged);
  }
  // Confirm-state for the "löschen" button — confirm() is blocked in iframe artifacts,
  // so we do a two-click confirmation: first click arms it, second click clears.
  const [bazaarClearArmed, setBazaarClearArmed] = useState(false);
  useEffect(() => {
    if (!bazaarClearArmed) return;
    const t = setTimeout(() => setBazaarClearArmed(false), 3000);
    return () => clearTimeout(t);
  }, [bazaarClearArmed]);

  function addOneToBazaar(name) {
    if (!bazaarTags.includes(name)) setBazaarTags([...bazaarTags, name]);
  }
  function removeFromBazaar(name) {
    setBazaarTags(bazaarTags.filter(n => n !== name));
  }
  function clearBazaar() {
    if (bazaarTags.length === 0) return;
    if (!bazaarClearArmed) {
      setBazaarClearArmed(true);
      return;
    }
    setBazaarTags([]);
    setBazaarClearArmed(false);
  }
  function clearPin() { setLastPin(null); }

  // Pin position in SVG coords for rendering
  const pinXY = lastPin ? projection(lastPin) : null;
  const hoverXY = hoverPin ? projection(hoverPin) : null;

  // Folder color hint for matches (visual grouping only)
  const folderColor = (folder) => {
    if (folder.startsWith("Type 5")) return "#E74C3C";
    if (folder.startsWith("Type 4")) return "#9B59B6";
    if (folder.startsWith("Type 3")) return "#F5B82E";
    if (folder.startsWith("Type 2")) return "#27AE60";
    if (folder.startsWith("Type 1")) return "#5EAFC5";
    return "#8090A0";
  };

  return (
    <div className="space-y-4">
      {/* MAP — clean, no polygon overlays */}
      <div className="border border-[#1F2933] rounded bg-[#0B0F14] overflow-hidden relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-auto block"
          style={{ cursor: loadStatus === "ready" ? "crosshair" : "wait" }}
          onClick={handleMapClick}
          onMouseMove={handleMapMove}
          onMouseLeave={handleMapLeave}>

          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#5EAFC5" strokeWidth="0.3" opacity="0.12" />
            </pattern>
          </defs>
          <rect width={VIEW_W} height={VIEW_H} fill="url(#grid)" />

          <line x1="0" y1={equator} x2={VIEW_W} y2={equator} stroke="#5EAFC5" strokeWidth="0.4" strokeDasharray="2 4" opacity="0.4" />
          <line x1={meridian} y1="0" x2={meridian} y2={VIEW_H} stroke="#5EAFC5" strokeWidth="0.4" strokeDasharray="2 4" opacity="0.4" />
          <line x1="0" y1={tropicN} x2={VIEW_W} y2={tropicN} stroke="#F5B82E" strokeWidth="0.4" strokeDasharray="1 3" opacity="0.3" />
          <line x1="0" y1={tropicS} x2={VIEW_W} y2={tropicS} stroke="#F5B82E" strokeWidth="0.4" strokeDasharray="1 3" opacity="0.3" />

          {/* Countries — neutral fill, no continent grouping */}
          {loadStatus === "ready" && worldData && worldData.features.map((f) => (
            <path
              key={f.id ?? Math.random()}
              d={pathGen(f.geometry)}
              fill="#1F2933"
              stroke="#0B0F14"
              strokeWidth="0.3"
              className="transition-colors"
            />
          ))}

          {/* Home marker */}
          {homeLocation && loadStatus === "ready" && (() => {
            const [hx, hy] = projection(homeLocation);
            return (
              <g pointerEvents="none">
                <circle cx={hx} cy={hy} r="3.5" fill="#27AE60" stroke="#FFFFFF" strokeWidth="1" />
                <circle cx={hx} cy={hy} r="7" fill="none" stroke="#27AE60" strokeWidth="0.4" opacity="0.7" />
              </g>
            );
          })()}

          {/* Hover ghost pin — preview while mouse is over the map */}
          {hoverXY && loadStatus === "ready" && (
            <g pointerEvents="none">
              <circle cx={hoverXY[0]} cy={hoverXY[1]} r="3.5" fill="#E74C3C" opacity="0.5" stroke="#FFFFFF" strokeWidth="0.8" strokeOpacity="0.6" />
            </g>
          )}

          {/* Locked pin — committed via click */}
          {pinXY && loadStatus === "ready" && (
            <g pointerEvents="none">
              <circle cx={pinXY[0]} cy={pinXY[1]} r="14" fill="none" stroke="#E74C3C" strokeWidth="0.6" opacity="0.5">
                <animate attributeName="r" values="6;16;6" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={pinXY[0]} cy={pinXY[1]} r="4.5" fill="#E74C3C" stroke="#FFFFFF" strokeWidth="1.2" />
              <circle cx={pinXY[0]} cy={pinXY[1]} r="1.5" fill="#FFFFFF" />
            </g>
          )}

          {/* Loading / error overlay */}
          {loadStatus !== "ready" && (
            <g>
              <rect width={VIEW_W} height={VIEW_H} fill="#0B0F14" opacity="0.85" />
              <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" className="mono" fontSize="14" fill="#5EAFC5">
                {loadStatus === "loading" ? "loading world topology…" : "couldn't load map data"}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Home banner */}
      {homeLocation && (
        <div className="border border-[#27AE60]/40 bg-[#27AE60]/5 rounded p-3 flex items-baseline gap-3 mono text-xs">
          <span className="text-[#27AE60]">⌂</span>
          <div className="flex-1">
            <div className="text-[#E6EDF3]">
              Heimat: {homeLocation[1].toFixed(2)}°{homeLocation[1] >= 0 ? "N" : "S"}
              , {homeLocation[0].toFixed(2)}°{homeLocation[0] >= 0 ? "E" : "W"}
            </div>
            {homeLocals.length > 0 && (
              <div className="text-[10.5px] text-[#8090A0] mt-1">
                Lokale Regionale ({homeLocals.length}): <span className="text-[#27AE60]">{homeLocals.join(" · ")}</span>
              </div>
            )}
          </div>
          <button onClick={() => setHomeLocation(null)}
            className="text-[#8090A0] hover:text-[#E74C3C] transition">
            entfernen
          </button>
        </div>
      )}

      {/* Hover preview — live, replaces "tap somewhere" hint when hovering */}
      {hoverPin && previewMatches !== null && (
        <div className="border border-[#E74C3C]/30 rounded p-2.5 bg-[#E74C3C]/5">
          <div className="flex items-baseline gap-3 mono text-[11px]">
            <span className="text-[#8090A0]">vorschau:</span>
            <span className="text-[#E6EDF3]">
              {hoverPin[1].toFixed(1)}°{hoverPin[1] >= 0 ? "N" : "S"},
              {" "}{hoverPin[0].toFixed(1)}°{hoverPin[0] >= 0 ? "E" : "W"}
            </span>
            <span className="text-[#8090A0] flex-1" />
            <span className="text-[10.5px] text-[#8090A0]">click zum festsetzen</span>
          </div>
          {previewMatches.length === 0 ? (
            <div className="mono text-[10.5px] text-[#8090A0] mt-1">
              keine Regionalen hier
            </div>
          ) : (() => {
              const all = [...new Set(previewMatches.flatMap(m => m.german))];
              const wanted = all.filter(n => !homeLocalsSet.has(n));
              const local = all.filter(n => homeLocalsSet.has(n));
              return (
                <div className="mono text-[11px] mt-1.5 leading-relaxed">
                  {wanted.length > 0 && (
                    <span className="text-[#27AE60]">{wanted.join(" · ")}</span>
                  )}
                  {wanted.length > 0 && local.length > 0 && (
                    <span className="text-[#8090A0]"> · </span>
                  )}
                  {local.length > 0 && (
                    <span className="text-[#8090A0]" title="schon zu Hause — Freunde haben die via dir">
                      {local.join(" · ")}
                    </span>
                  )}
                </div>
              );
            })()}
        </div>
      )}

      {/* Pin info */}
      {!lastPin && !hoverPin && (
        <div className="mono text-xs text-[#8090A0] text-center py-2">
          {homeLocation
            ? "fahre über die Karte für eine Vorschau, klicke zum Festsetzen"
            : "fahre über die Karte, klicke deinen Standort an, dann „Als Heimat setzen"}
        </div>
      )}

      {lastPin && (
        <div className="space-y-3">
          <div className="flex items-baseline gap-3 mono text-[11px]">
            <span className="text-[#8090A0]">pin:</span>
            <span className="text-[#E6EDF3]">
              {lastPin[1].toFixed(2)}°{lastPin[1] >= 0 ? "N" : "S"},
              {" "}{lastPin[0].toFixed(2)}°{lastPin[0] >= 0 ? "E" : "W"}
            </span>
            <span className="text-[#8090A0] flex-1" />
            <button
              onClick={() => setHomeLocation([lastPin[0], lastPin[1]])}
              className="mono text-[11px] bg-[#27AE60]/15 hover:bg-[#27AE60]/25 text-[#27AE60] px-2 py-0.5 rounded transition">
              ⌂ als Heimat setzen
            </button>
            <button onClick={clearPin} className="text-[#8090A0] hover:text-[#E74C3C] transition">
              löschen
            </button>
          </div>

          {/* Matched regions */}
          {matches.length === 0 ? (
            <div className="mono text-xs text-[#8090A0] py-2">
              hier spawnen keine regionalen Pokémon
              <span className="text-[#8090A0]/60"> (Ozean oder nicht-regionale Zone)</span>
            </div>
          ) : (
            <div>
              <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
                {matches.length} Region{matches.length === 1 ? "" : "en"} hier
              </div>
              <div className="space-y-1.5">
                {matches.map((m, i) => (
                  <div key={i} className="flex items-baseline gap-2 mono text-xs">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                          style={{ background: folderColor(m.folder) }} />
                    <div className="flex-1">
                      <div className="text-[#E6EDF3]">{m.german.join(" · ")}</div>
                      <div className="text-[10px] text-[#8090A0]">{m.folder}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add to bazaar — split into "wanted" (green) vs "already at home" (greyed) */}
          {(pokemonWanted.length > 0 || pokemonAlreadyLocal.length > 0) && (
            <div className="space-y-3">
              {pokemonWanted.length > 0 && (
                <div>
                  <div className="mono text-[10.5px] uppercase tracking-wider text-[#27AE60] mb-1.5">
                    {homeLocals.length > 0
                      ? `mitnehmen · ${pokemonWanted.length}`
                      : `gefunden · ${pokemonWanted.length}`}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pokemonWanted.map(name => {
                      const tagged = bazaarTags.includes(name);
                      return (
                        <button key={name}
                          onClick={() => tagged ? removeFromBazaar(name) : addOneToBazaar(name)}
                          className={`mono text-[11px] px-2 py-1 rounded transition ${
                            tagged
                              ? "bg-[#5EAFC5] text-[#0F1419]"
                              : "bg-[#27AE60]/15 text-[#27AE60] border border-[#27AE60]/40 hover:bg-[#27AE60]/25"
                          }`}>
                          {tagged ? "✓ " : "+ "}{name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {pokemonAlreadyLocal.length > 0 && (
                <div>
                  <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1.5">
                    schon zu Hause · {pokemonAlreadyLocal.length}
                    <span className="text-[#8090A0]/70 normal-case font-normal"> · Freunde haben die schon (via dir)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pokemonAlreadyLocal.map(name => {
                      const tagged = bazaarTags.includes(name);
                      return (
                        <button key={name}
                          onClick={() => tagged ? removeFromBazaar(name) : addOneToBazaar(name)}
                          title="Du fängst das eh schon — Tag nur falls du es trotzdem markieren willst"
                          className={`mono text-[11px] px-2 py-1 rounded transition opacity-60 hover:opacity-100 ${
                            tagged
                              ? "bg-[#5EAFC5] text-[#0F1419]"
                              : "bg-[#1F2933] text-[#8090A0] hover:bg-[#2D3A47] hover:text-[#E6EDF3]"
                          }`}>
                          {tagged ? "✓ " : "+ "}{name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {pokemonWanted.length > 0 && (
                <button onClick={addAllToBazaar}
                  className="mono text-[11px] text-[#27AE60] hover:text-[#5DD380] transition">
                  alle zur #{tradeTagName}-Liste hinzufügen →
                  {homeLocals.length > 0 && (
                    <span className="text-[#8090A0] ml-1">
                      ({pokemonWanted.length} mitnehmenswerte, lokale werden ignoriert)
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tradeable accumulator */}
      <div className="border border-[#5EAFC5]/40 rounded p-3 bg-[#5EAFC5]/5">
        <div className="flex items-baseline gap-2 mb-2">
          <div className="mono text-[10.5px] uppercase tracking-wider text-[#5EAFC5] flex-1">
            zum Tausch markieren · {bazaarTags.length} Pokémon
          </div>
          {bazaarTags.length > 0 && (
            <button onClick={clearBazaar}
              className={`mono text-[10.5px] transition ${
                bazaarClearArmed
                  ? "text-[#E74C3C] font-semibold"
                  : "text-[#8090A0] hover:text-[#E74C3C]"
              }`}>
              {bazaarClearArmed ? "wirklich? klick zur Bestätigung" : "löschen"}
            </button>
          )}
        </div>
        {bazaarTags.length === 0 ? (
          <div className="mono text-[11px] text-[#8090A0]">
            Tippe auf die Karte um regionale Pokémon zu finden, dann markiere sie mit deinem Tausch-Tag <code className="text-[#E6EDF3]">#{tradeTagName}</code> in PoGo. Der Trash-Filter schützt sie automatisch.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {bazaarTags.map(name => (
                <span key={name}
                  className="mono text-[11px] bg-[#5EAFC5]/20 text-[#E6EDF3] pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group">
                  {name}
                  <button onClick={() => removeFromBazaar(name)}
                    className="opacity-50 group-hover:opacity-100 hover:text-[#E74C3C] transition">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="mono text-[10.5px] text-[#8090A0] mt-2">
              markiere diese mit <code className="text-[#E6EDF3]">#{tradeTagName}</code> in PoGo
            </div>
          </>
        )}
      </div>

      {/* Attribution */}
      <div className="mono text-[10px] text-[#8090A0] pt-1">
        regional polygon data: u/zoglandboy / u/Mattman243 / pokemoncalendar.com
      </div>
    </div>
  );
}


function NumField({ label, value, onChange, text, hint }) {
  return (
    <div title={hint}>
      <label className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">{label}</label>
      <input type={text ? "text" : "number"} value={value} onChange={e => onChange(e.target.value)}
        className="mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1" />
      {hint && <div className="mono text-[10px] text-[#8090A0] mt-1 leading-tight">{hint}</div>}
    </div>
  );
}

// ─── SETTINGS MODAL ─────────────────────────────────────────────────────────
//
// Holds settings that aren't about "what to protect" but rather "how the tool
// behaves": expert mode, trade tag names, custom tags, league tags, scope
// safety nets, and the dangerous reset. Reachable via gear icon in header.

function SettingsModal({ open, onClose, config, setConfig, onResetAll, resetArmed }) {
  if (!open) return null;
  function set(k, v) { setConfig({ ...config, [k]: v }); }
  const expert = !!config.expertMode;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Einstellungen"
      onClick={onClose}
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
      className="fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: "#0F1419" }}
        className="border border-[#2D3A47] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div
          style={{ backgroundColor: "#0F1419" }}
          className="sticky top-0 border-b border-[#1F2933] px-5 py-3 flex items-center justify-between">
          <h2 className="mono text-base font-semibold text-[#E6EDF3]">Einstellungen</h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="text-[#8090A0] hover:text-[#E6EDF3] transition p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Mode toggle */}
          <div className="flex items-center justify-between border border-[#2D3A47] rounded p-3">
            <div>
              <div className="mono text-sm text-[#E6EDF3]">Modus: {expert ? "Experte" : "Normal"}</div>
              <div className="mono text-[11px] text-[#8090A0] mt-0.5">
                {expert
                  ? "Alle Optionen sichtbar"
                  : "Vernünftige Defaults — Experte für Feinkontrolle"}
              </div>
            </div>
            <button
              onClick={() => set("expertMode", !expert)}
              className={`mono text-xs px-3 py-1.5 rounded transition ${
                expert ? "bg-[#F5B82E] text-[#0F1419]" : "bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47]"
              }`}>
              {expert ? "→ Normal" : "→ Experte"}
            </button>
          </div>

          {/* Trade tags */}
          <div>
            <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
              Tausch-Tags · werden im Filter geschützt
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="mono text-[10.5px] text-[#8090A0] block mb-1">
                  Massentausch-Tag (Standard: Trade)
                </label>
                <input
                  type="text"
                  value={config.basarTagName || ""}
                  onChange={e => set("basarTagName", e.target.value)}
                  placeholder="z.B. Trade, Basar, give-away"
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                <div className="mono text-[10px] text-[#8090A0] mt-1">
                  → Filter-Klausel: <code className="text-[#5EAFC5]">!#{config.basarTagName || "?"}</code>
                </div>
              </div>
              <div>
                <label className="mono text-[10.5px] text-[#8090A0] block mb-1">
                  Niantic Fern-Tausch-Tag
                </label>
                <input
                  type="text"
                  value={config.fernTauschTagName || ""}
                  onChange={e => set("fernTauschTagName", e.target.value)}
                  placeholder="Fern-Tausch (Standardname)"
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                <div className="mono text-[10px] text-[#8090A0] mt-1">offizielles PoGo-Tag (Dezember 2025)</div>
              </div>
            </div>
          </div>

          {expert && (
            <>
              {/* Custom tags */}
              <div>
                <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
                  Custom-Tags · zusätzliche #tags zum Schützen
                </div>
                <input
                  type="text"
                  value={config.customProtectedTags || ""}
                  onChange={e => set("customProtectedTags", e.target.value)}
                  placeholder="z.B. pvpiv, keep, pokegenie (kommasepariert)"
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                <div className="mono text-[10px] text-[#8090A0] mt-1">
                  z.B. wenn du PvPIV oder PokeGenie nutzt
                </div>
              </div>

              {/* League tags */}
              <div>
                <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
                  Liga-Tags · deine Naming-Convention
                </div>
                <input
                  type="text"
                  value={config.leagueTags || ""}
                  onChange={e => set("leagueTags", e.target.value)}
                  placeholder="z.B. ⓤ,ⓖ,ⓛ — kommasepariert"
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                <div className="mono text-[10px] text-[#8090A0] mt-1">
                  direkt im Spitznamen — z.B. „ⓤ Mauzwerg" für Ultraliga
                </div>
              </div>

              {/* Safety nets */}
              <div>
                <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
                  Sicherheitsnetze · begrenzen die Filterausgabe
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <NumField
                    label="WP-Obergrenze"
                    value={config.cpCap}
                    onChange={v => set("cpCap", +v || 0)}
                    hint="zeigt nur Pokémon mit WP ≤ Wert (Standard: 2000)" />
                  <NumField
                    label="Vor wie vielen Tagen gefangen (max)"
                    value={config.ageScopeDays}
                    onChange={v => set("ageScopeDays", +v || 0)}
                    hint="zeigt nur Pokémon der letzten X Tage" />
                  <NumField
                    label="Distanz-Schutz (km)"
                    value={config.distanceProtect}
                    onChange={v => set("distanceProtect", +v || 0)}
                    hint="schützt ≥X km gefangene (Pilot-Medaille)" />
                </div>
              </div>
            </>
          )}

          {/* Trade buddies */}
          <BuddyManager
            buddies={config.buddies || []}
            onChange={list => set("buddies", list)}
          />

          {/* Danger zone */}
          <div className="pt-4 border-t border-[#1F2933]">
            <div className="mono text-[10.5px] uppercase tracking-wider text-[#FF6B5B] mb-2">
              Gefahrenzone
            </div>
            <button
              onClick={onResetAll}
              className={`mono text-xs px-3 py-1.5 rounded transition flex items-center gap-1.5 ${
                resetArmed
                  ? "bg-[#E74C3C] text-white"
                  : "bg-[#1F2933] text-[#FF6B5B] hover:bg-[#2D3A47]"
              }`}>
              <RotateCcw size={11} />
              {resetArmed ? "wirklich? klick zur Bestätigung" : "Alles zurücksetzen"}
            </button>
            <div className="mono text-[10px] text-[#8090A0] mt-1.5">
              Setzt Hundo-Liste, alle Schutzmaßnahmen, Tags, Heimat-Standort und Trash-Liste auf Standard zurück.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BUDDY MANAGER ──────────────────────────────────────────────────────────

function BuddyManager({ buddies, onChange }) {
  const [newName, setNewName] = useState("");

  function addBuddy() {
    const name = newName.trim();
    if (!name) return;
    // Generate a default tag prefix from the name (alpha chars, capitalized)
    const tagPrefix = name.replace(/[^a-zA-ZäöüÄÖÜß0-9]/g, "");
    if (!tagPrefix) return;
    const id = tagPrefix.toLowerCase() + "-" + Date.now().toString(36);
    onChange([
      ...buddies,
      { id, name, tagPrefix, targetSpecies: [], wantsTradeEvos: false, active: true },
    ]);
    setNewName("");
  }
  function update(id, partial) {
    onChange(buddies.map(b => b.id === id ? { ...b, ...partial } : b));
  }
  function remove(id) {
    onChange(buddies.filter(b => b.id !== id));
  }

  return (
    <div className="pt-4 border-t border-[#1F2933]">
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
        Tausch-Buddies · pro Buddy ein Tag-Präfix (z.B. #Anna)
      </div>
      <p className="mono text-[11px] text-[#8090A0] mb-3 leading-relaxed">
        Im Spiel taggst du dann z.B. <code className="text-[#E6EDF3]">#Anna:hat-pika</code> oder <code className="text-[#E6EDF3]">#Anna:meltan</code>. PoGo's Substring-Match schützt alle Sub-Tags automatisch.
      </p>

      {buddies.length > 0 && (
        <div className="space-y-2 mb-3">
          {buddies.map(b => (
            <div key={b.id} className="border border-[#2D3A47] rounded p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={b.active !== false}
                  onChange={e => update(b.id, { active: e.target.checked })}
                  className="accent-[#E67E22]"
                  title={b.active !== false ? "aktiv — Tags werden geschützt" : "inaktiv — keine Wirkung"} />
                <input
                  type="text"
                  value={b.name}
                  onChange={e => update(b.id, { name: e.target.value })}
                  placeholder="Name"
                  className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3]" />
                <span className="mono text-[11px] text-[#8090A0]">#</span>
                <input
                  type="text"
                  value={b.tagPrefix}
                  onChange={e => update(b.id, { tagPrefix: e.target.value })}
                  placeholder="TagPräfix"
                  className="mono text-sm w-32 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3]" />
                <button
                  onClick={() => remove(b.id)}
                  className="text-[#8090A0] hover:text-[#FF6B5B] transition p-1"
                  title="Buddy löschen">
                  <X size={14} />
                </button>
              </div>
              <div className="mono text-[10px] text-[#8090A0]">
                Filter-Klausel: <code className="text-[#E67E22]">!#{b.tagPrefix}</code>
                {" "}— matcht <code className="text-[#E6EDF3]">#{b.tagPrefix}</code>, <code className="text-[#E6EDF3]">#{b.tagPrefix}:event1</code>, etc.
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addBuddy()}
          placeholder="Buddy-Name (z.B. Anna)"
          className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-1.5 rounded text-[#E6EDF3]" />
        <button
          onClick={addBuddy}
          disabled={!newName.trim()}
          className="mono text-sm bg-[#E67E22] hover:bg-[#FF9544] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-3 py-1.5 rounded transition flex items-center gap-1.5">
          <Plus size={14} /> hinzufügen
        </button>
      </div>
    </div>
  );
}

// ─── BUDDY EVENTS EDITOR (in Step 2) ───────────────────────────────────────

function BuddyEventsEditor({ buddies, onUpdateBuddy }) {
  return (
    <div>
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#E67E22] mb-2">
        Tausch-Buddies · Wunsch-Spezies
      </div>
      <p className="mono text-xs text-[#8090A0] mb-3 leading-relaxed">
        Welche Spezies sammelst du gerade für deine Buddies? Tritt im „<span className="text-[#E67E22]">für Buddy fangen</span>" Filter auf — zeigt nur trashbare (0–2★) Pokémon dieser Arten, die du noch nicht getaggt hast.
      </p>

      <div className="space-y-2">
        {buddies.map(b => (
          <BuddyTargetsRow
            key={b.id}
            buddy={b}
            onChange={partial => onUpdateBuddy(b.id, partial)}
          />
        ))}
      </div>
    </div>
  );
}

function BuddyTargetsRow({ buddy, onChange }) {
  const [input, setInput] = useState("");
  const targets = buddy.targetSpecies || [];

  const previewTokens = useMemo(() => {
    return input.split(/[,;\s]+/).filter(Boolean).map(tok => ({
      input: tok,
      info: resolveSpeciesInfo(tok),
    }));
  }, [input]);
  const resolved = previewTokens.filter(t => t.info);
  const newResolved = resolved.filter(t => !targets.includes(t.info.de.toLowerCase()));
  const dupes = resolved.filter(t => targets.includes(t.info.de.toLowerCase()));
  const unresolved = previewTokens.filter(t => !t.info);

  function addAll() {
    const tokens = input.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(targets);
    const remaining = [];
    for (const tok of tokens) {
      const r = resolveSpecies(tok);
      if (r) set.add(r);
      else remaining.push(tok);
    }
    onChange({ targetSpecies: [...set].sort() });
    setInput(remaining.join(", "));
  }
  function remove(name) {
    onChange({ targetSpecies: targets.filter(n => n !== name) });
  }

  return (
    <div className="border border-[#E67E22]/20 rounded p-2.5 space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="mono text-sm text-[#E6EDF3] font-semibold">{buddy.name}</span>
        <span className="mono text-[10.5px] text-[#8090A0]">
          Präfix: <code className="text-[#E67E22]">#{buddy.tagPrefix}</code>
        </span>
        <span className="mono text-[10.5px] text-[#8090A0] ml-auto">
          {targets.length} Wunsch-Spezies
        </span>
      </div>

      <label className="mono text-[11px] flex items-center gap-2 cursor-pointer text-[#E6EDF3] hover:bg-[#E67E22]/5 rounded px-1 py-0.5 transition w-fit"
        title="Fügt Tausch-Evolutions-Familien (Abra, Machollo, Nebulak, ...) zum Fang-Filter hinzu — nützlich wenn der Buddy Gratis-Evos sammelt">
        <input
          type="checkbox"
          checked={!!buddy.wantsTradeEvos}
          onChange={e => onChange({ wantsTradeEvos: e.target.checked })}
          className="accent-[#E67E22]" />
        <span>braucht Tausch-Evolutionen</span>
        <span className="text-[10px] text-[#8090A0]">(Abra, Machollo, Nebulak, ...)</span>
      </label>

      {targets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {targets.map(sp => (
            <span key={sp}
              className="chip-enter mono text-[11px] bg-[#E67E22]/15 text-[#E67E22] border border-[#E67E22]/40 pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group">
              {sp}
              <button onClick={() => remove(sp)}
                className="opacity-50 group-hover:opacity-100 hover:text-[#FF6B5B] transition">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addAll()}
          placeholder="Spezies (Nummer/EN/DE) — z.B. Pikachu, 132, melmetal"
          className="mono text-xs flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3] placeholder:text-[#8090A0]" />
        <button
          onClick={addAll}
          disabled={previewTokens.length === 0 || newResolved.length === 0}
          className="mono text-xs bg-[#E67E22]/20 hover:bg-[#E67E22]/30 disabled:bg-[#1F2933] disabled:text-[#8090A0] text-[#E67E22] px-2.5 py-1 rounded transition flex items-center gap-1">
          <Plus size={11} /> hinzufügen
        </button>
      </div>

      {previewTokens.length > 0 && (
        <div className="border border-[#1F2933] rounded p-2 bg-[#0B0F14] space-y-1.5">
          <div className="mono text-[10px] uppercase tracking-wider text-[#8090A0]">
            Vorschau · {newResolved.length} neu, {dupes.length} schon dabei, {unresolved.length} unbekannt
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewTokens.map((t, i) => {
              if (!t.info) return (
                <span key={i} className="mono text-[11px] bg-[#FF6B5B]/15 text-[#FF6B5B] px-2 py-0.5 rounded">
                  ✗ {t.input}
                </span>
              );
              const isDupe = targets.includes(t.info.de.toLowerCase());
              const labelByType = { number: "#", english: "EN", german: "DE" };
              return (
                <span key={i}
                  className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
                    isDupe ? "bg-[#5C6975]/15 text-[#8090A0]" : "bg-[#E67E22]/15 text-[#E67E22]"
                  }`}>
                  <span className="text-[9px] opacity-60">{labelByType[t.info.inputType]}</span>
                  {t.info.de}
                  {isDupe && <span className="opacity-60">✓</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
