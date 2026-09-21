"""Compare the runs of a genetic algorithm batch (folders made by `scripts/overnight.sh` or `npm run evolve`).

Usage: python3 scripts/compare_evolution.py [batch_dir]   (defaults to the newest overnight-* folder)
Run folders are named <decider>-<space>-seed<N>. Prints a table per run and a summary per decider and
parameter space, and writes plots and `summary.csv` to <batch_dir>/analysis/. Needs pandas and matplotlib.

The score of a run is the food coverage it reached while keeping about half its Folk alive: the mean coverage
over its last 30 generations (lower is better).
"""
import json
import re
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

LAST = 30


def find_batch(arg: str | None) -> Path:
    if arg:
        return Path(arg)
    batches = sorted(Path("experiments/output").glob("overnight-*/"), key=lambda p: p.stat().st_mtime)
    if not batches:
        sys.exit("no overnight-* batch found")
    return batches[-1]


def load_runs(batch: Path) -> dict[str, tuple[dict, pd.DataFrame]]:
    runs = {}
    for d in sorted(p for p in batch.iterdir() if (p / "generations.csv").exists()):
        gens = pd.read_csv(d / "generations.csv")
        if len(gens):
            runs[d.name] = (json.loads((d / "manifest.json").read_text()), gens)
    return runs


def summarise(runs: dict[str, tuple[dict, pd.DataFrame]]) -> pd.DataFrame:
    rows = []
    for name, (manifest, gens) in runs.items():
        m = re.match(r"(?P<decider>\w+?)-(?P<space>\w+)-seed(?P<seed>\d+)", name)
        tail = gens.tail(LAST)
        rows.append({
            "run": name,
            "decider": m["decider"] if m else manifest["decider"],
            "space": m["space"] if m else "?",
            "seed": int(m["seed"]) if m else manifest["seed"],
            "generations": len(gens),
            "coverage": tail["coverage"].mean(),
            "survival": tail["survival"].mean(),
            "lowest_coverage": gens["coverage"].min(),
            "best_fitness": gens["bestFitness"].max(),
        })
    return pd.DataFrame(rows)


def plot(runs: dict[str, tuple[dict, pd.DataFrame]], table: pd.DataFrame, out: Path) -> None:
    out.mkdir(exist_ok=True)
    groups = table.groupby(["decider", "space"])
    fig, axes = plt.subplots(1, len(groups), figsize=(4 * len(groups), 3.6), sharey=True, squeeze=False)
    for ax, ((decider, space), grp) in zip(axes[0], groups):
        for name in grp["run"]:
            gens = runs[name][1]
            ax.plot(gens["generation"], gens["coverage"], label=name.split("-")[-1])
        ax.set(title=f"{decider}, {space} ranges", xlabel="generation", yscale="log")
        ax.legend(fontsize=7)
    axes[0][0].set_ylabel("food coverage (lower = tougher world survived)")
    fig.tight_layout()
    fig.savefig(out / "coverage_by_group.png", dpi=120)
    plt.close(fig)

    # Where the best Folk of each run ended up in its parameter range, as a share of the (default or wide) range.
    for decider, grp in table.groupby("decider"):
        keys = runs[grp["run"].iloc[0]][0]["params"]
        fig, axes = plt.subplots(len(keys), 1, figsize=(8, 1.5 * len(keys)), sharex=True)
        for ax, key in zip(axes, keys):
            for name in grp["run"]:
                gens = runs[name][1]
                ax.plot(gens["generation"], gens[f"mean_{key}"], alpha=0.7)
            ax.set_ylabel(key, rotation=0, ha="right")
        axes[-1].set_xlabel("generation")
        fig.suptitle(f"{decider}: population mean of each parameter, every run")
        fig.tight_layout()
        fig.savefig(out / f"parameters_{decider}.png", dpi=110)
        plt.close(fig)


if __name__ == "__main__":
    batch = find_batch(sys.argv[1] if len(sys.argv) > 1 else None)
    runs = load_runs(batch)
    if not runs:
        sys.exit(f"no runs with results in {batch}")
    table = summarise(runs)
    pd.set_option("display.width", 200)
    print(f"== runs (coverage and survival: mean of each run's last {LAST} generations) ==")
    print(table.round(3).to_string(index=False))
    print("\n== by decider and parameter space (coverage: lower is better) ==")
    print(table.groupby(["decider", "space"])[["coverage", "survival", "lowest_coverage"]]
          .agg(["mean", "min", "max"]).round(3).to_string())
    out = batch / "analysis"
    plot(runs, table, out)
    table.to_csv(out / "summary.csv", index=False)
    print(f"\nplots and summary.csv in {out}")
