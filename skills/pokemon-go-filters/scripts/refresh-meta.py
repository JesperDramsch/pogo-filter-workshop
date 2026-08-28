#!/usr/bin/env python3
"""Refresh the generated PvP meta reference from the pogo-filter-workshop repo.

The repo regenerates references/pvp-meta.json and references/META.md from the same
snapshot its app builds filters from, in the same CI job that syncs the snapshot.
This script pulls the current pair down so the skill can quote them.

Mirrors pokemon-name-translate/scripts/lookup.py: the file is the source of truth,
the model is not, and a refresh that would shrink the dataset is refused.

Usage:
  python3 scripts/refresh-meta.py            # download and install
  python3 scripts/refresh-meta.py --check    # report age only, write nothing

Exit codes: 0 = ok, 1 = error (failed download, suspicious data).
"""

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request

SOURCE_BASE = (
    "https://raw.githubusercontent.com/JesperDramsch/pogo-filter-workshop/"
    "main/skills/pokemon-go-filters/references/"
)
HERE = os.path.dirname(os.path.abspath(__file__))
REF_DIR = os.path.join(os.path.dirname(HERE), "references")
JSON_PATH = os.path.join(REF_DIR, "pvp-meta.json")
MD_PATH = os.path.join(REF_DIR, "META.md")

# A real snapshot carries 30 species per league. Anything far below that is a
# truncated download or an upstream failure, not a meta that suddenly shrank.
MIN_SPECIES_PER_LEAGUE = 20
STALE_AFTER_DAYS = 14


def load_local():
    try:
        with open(JSON_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def age_days(payload):
    stamp = (payload or {}).get("fetchedAt")
    if not stamp:
        return None
    try:
        when = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt.datetime.now(dt.timezone.utc) - when).days


def describe(payload, label):
    if not payload:
        print(f"{label}: absent or unreadable")
        return
    days = age_days(payload)
    counts = ", ".join(
        f"{k}={len(v.get('species', []))}" for k, v in (payload.get("leagues") or {}).items()
    )
    cups = len(payload.get("cups") or {})
    print(
        f"{label}: snapshot {payload.get('fetchedAt')} "
        f"({'unknown' if days is None else days} day(s) old), "
        f"source={payload.get('source')}, {counts}, cups={cups}"
    )


def fetch(name):
    url = SOURCE_BASE + name
    print(f"Fetching {url} ...")
    with urllib.request.urlopen(url, timeout=30) as resp:
        return resp.read().decode("utf-8")


def validate(new, old):
    leagues = new.get("leagues") or {}
    if not leagues:
        raise ValueError("downloaded payload has no leagues")
    for key, league in leagues.items():
        n = len(league.get("species") or [])
        if n < MIN_SPECIES_PER_LEAGUE:
            raise ValueError(f"league {key} carries only {n} species — refusing to install")
    # Refuse to shrink: a league losing entries means a bad download, not a meta change.
    for key, league in (old or {}).get("leagues", {}).items():
        before = len(league.get("species") or [])
        after = len((leagues.get(key) or {}).get("species") or [])
        if after < before:
            raise ValueError(f"league {key} would shrink {before} -> {after} — refusing to install")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="report age only, write nothing")
    args = ap.parse_args()

    local = load_local()
    describe(local, "local ")

    if args.check:
        days = age_days(local)
        if days is None:
            print("Cannot determine age — refresh before quoting the tables.")
            return 0
        if days > STALE_AFTER_DAYS:
            print(f"STALE (> {STALE_AFTER_DAYS} days). Run without --check to refresh.")
        else:
            print("Fresh enough to quote.")
        return 0

    try:
        payload = json.loads(fetch("pvp-meta.json"))
        markdown = fetch("META.md")
        validate(payload, local)
    except Exception as exc:  # noqa: BLE001 - surface any failure to the caller
        print(f"Refresh failed: {exc}", file=sys.stderr)
        print("Keeping the existing files. Do NOT fall back on remembered tier lists —", file=sys.stderr)
        print("say the data could not be refreshed.", file=sys.stderr)
        return 1

    os.makedirs(REF_DIR, exist_ok=True)
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    with open(MD_PATH, "w", encoding="utf-8") as fh:
        fh.write(markdown)

    describe(payload, "updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
