#!/usr/bin/env python3
"""Summarize a run folder written by the sim logger (standard library only).

Usage: python3 scripts/summarize_run.py [run_dir]
Defaults to the newest folder in experiments/output/.

The same files load directly into pandas:
    pd.read_csv(run / "entities.csv"), pd.read_csv(run / "resources.csv"),
    pd.read_json(run / "events.jsonl", lines=True)
"""
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def newest_run() -> Path:
    root = Path(__file__).resolve().parent.parent / "experiments" / "output"
    runs = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime)
    if not runs:
        sys.exit(f"no runs found in {root}")
    return runs[-1]


def main() -> None:
    run = Path(sys.argv[1]) if len(sys.argv) > 1 else newest_run()
    manifest = json.loads((run / "manifest.json").read_text())
    print(f"run {manifest['runId']}: seed {manifest['seed']}, {manifest['ticks']} ticks, "
          f"{manifest['folkCount']} Folk, world {manifest['world']['width']}x{manifest['world']['height']}")
    git = manifest.get("git", {})
    print(f"code {str(git.get('commit'))[:8]} dirty={git.get('dirty')} decider={manifest.get('decider')}")

    kinds = Counter()
    eaten = 0.0
    deaths = []
    with (run / "events.jsonl").open() as f:
        for line in f:
            e = json.loads(line)
            kinds[e["type"]] += 1
            if e["type"] == "eat":
                eaten += e["food"]
            elif e["type"] == "die":
                deaths.append(e["tick"])
    print("events:", dict(kinds), f"| food eaten: {eaten:.0f} | deaths at ticks: {deaths or 'none'}")

    by_tick = defaultdict(list)
    with (run / "entities.csv").open() as f:
        for row in csv.DictReader(f):
            by_tick[int(row["tick"])].append(row)
    ticks = sorted(by_tick)
    print("\ntick  mean satiety  mean health  mean energy  actions")
    for t in ticks[:: max(1, len(ticks) // 8)] + [ticks[-1]]:
        rows = by_tick[t]
        mean = lambda k: sum(float(r[k]) for r in rows) / len(rows)
        actions = Counter(r["action"] for r in rows)
        print(f"{t:5d}  {mean('satiety'):13.1f}  {mean('health'):11.1f}  {mean('energy'):11.1f}  {dict(actions)}")

    with (run / "resources.csv").open() as f:
        rows = list(csv.DictReader(f))
    first, last = rows[0], rows[-1]
    print("\nspecies totals (first -> last snapshot):")
    for key in manifest["species"]:
        print(f"  {key:8s} {float(first[key]):12.0f} -> {float(last[key]):12.0f}")


if __name__ == "__main__":
    main()
