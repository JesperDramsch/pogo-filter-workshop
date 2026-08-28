# Published skill material

The canonical copy of the `pokemon-go-filters` skill's meta reference lives here, in the repo,
rather than only in the account's synced skill directory. Two reasons:

1. **It has to be generated.** `references/META.md` and `references/pvp-meta.json` are produced by
   `scripts/generate-pvp-meta-reference.mjs` from `src/data/pvp-rankings.json`, in the same CI job
   that syncs the snapshot. A file that is regenerated daily cannot live only in a skill editor.
2. **It has to be fetchable.** `scripts/refresh-meta.py` pulls the current pair from this repo over
   raw.githubusercontent, exactly as the sibling `pokemon-name-translate` skill pulls
   `src/locales/pokemon-names.json`. The repo is the endpoint.

## Syncing into the skill

The generated files refresh themselves in place — `python3 scripts/refresh-meta.py` inside the
skill directory overwrites `references/META.md` and `references/pvp-meta.json` from this repo, so
they only need copying once.

The hand-written files (`SKILL.md`, `scripts/refresh-meta.py`, `references/META-PVE.md`) change
rarely and need copying into the synced skill directory when they do:

```
skills/pokemon-go-filters/
├── SKILL.md                      hand-written — replaces the existing one
├── scripts/refresh-meta.py       hand-written — new
└── references/
    ├── META.md                   GENERATED — do not hand-edit
    ├── pvp-meta.json             GENERATED — do not hand-edit
    └── META-PVE.md               the old META.md's non-PvP remainder, unverified
```

`references/SYNTAX.md`, `TRANSLATION.md`, `PATTERNS.md` and `POKEDEX.md` are unchanged and are not
mirrored here.

## Why the split

The old `references/META.md` was one hand-maintained file mixing PvP tier lists with raid,
Dynamax, regional and never-transfer lists. Its PvP half went stale without any signal: by August
2026 its entire Great League S-tier had dropped out of the live top 30. Generating the PvP half
fixes that; leaving the unverified PvE half inside a file headed "generated" would have
re-created exactly the confusion being removed, so it moved to `META-PVE.md` under its own banner.
