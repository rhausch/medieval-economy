#!/usr/bin/env python3
"""Summarize a run folder written by the sim logger (standard library only).

Usage: python3 scripts/summarize_run.py [run_dir]
Defaults to the newest folder in experiments/output/.

The same files load directly into pandas:
    pd.read_csv(run / "entities.csv"), pd.read_csv(run / "resources.csv"),
    pd.read_json(run / "events.jsonl", lines=True)
Spawn events carry each Folk's decider and parameter array, which is what a genetic algorithm
would read as a genome; join them to entities.csv and events.jsonl on the Folk id.
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
    settings = manifest["settings"]
    capacity = settings["body"]["reserveCapacity"]
    print(f"code {str(git.get('commit'))[:8]} dirty={git.get('dirty')} deciders={manifest.get('deciderMix')} "
          f"config={manifest.get('configPath') or 'defaults'} hash={manifest.get('settingsHash')}")

    decider_of: dict[int, str] = {}
    kinds = Counter()
    per = defaultdict(Counter)
    with (run / "events.jsonl").open() as f:
        for line in f:
            e = json.loads(line)
            kinds[e["type"]] += 1
            if e["type"] == "spawn":
                decider_of[e["folk"]] = e["decider"]
                continue
            d = per[decider_of.get(e["folk"], "?")]
            t = e["type"]
            if t == "eat":
                d["meals"] += 1
            elif t == "gather":
                d["gathers"] += 1
            elif t == "hunt":
                d["hunts"] += 1
                d["kills"] += 1 if e["success"] else 0
            elif t == "injure":
                d[f"injury_{e['severity']}"] += 1
            elif t == "die":
                d[f"death_{e['cause']}"] += 1
    print("events:", dict(kinds))
    print("\nby decider:")
    for name in sorted(per):
        print(f"  {name:8s} {dict(sorted(per[name].items()))}")

    by_tick = defaultdict(list)
    with (run / "entities.csv").open() as f:
        for row in csv.DictReader(f):
            by_tick[int(row["tick"])].append(row)
    ticks = sorted(by_tick)
    print("\nmean over time            reserve (share of capacity)  injured")
    for t in dict.fromkeys(ticks[:: max(1, len(ticks) // 6)] + [ticks[-1]]):
        rows = by_tick[t]
        mean = sum(float(r["reserve"]) for r in rows) / len(rows) / capacity
        injured = sum(1 for r in rows if int(r["injury"]) > 0)
        print(f"  tick {t:6d}                  {mean:6.2f}                  {injured:5d}")

    hungry = defaultdict(lambda: [0, 0])
    for rows in by_tick.values():
        for r in rows:
            h = hungry[r["decider"]]
            h[1] += 1
            h[0] += 1 if float(r["reserve"]) < 0.25 * capacity else 0
    print("\nhungry (reserve below 25% of capacity) share of Folk snapshots:",
          {k: f"{100 * a / b:.1f}%" for k, (a, b) in sorted(hungry.items())})

    with (run / "resources.csv").open() as f:
        rows = list(csv.DictReader(f))
    first, last = rows[0], rows[-1]
    print("\nspecies totals (first -> last snapshot):")
    for key in manifest["species"]:
        print(f"  {key:8s} {float(first[key]):12.0f} -> {float(last[key]):12.0f}")


if __name__ == "__main__":
    main()
