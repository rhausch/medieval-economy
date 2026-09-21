"""Plot and summarise a genetic algorithm run (the folder written by `npm run evolve`).

Usage: python3 scripts/analyze_evolution.py [evolve_dir]   (defaults to the newest *evolve* folder)
Writes plots to <dir>/analysis/. Needs pandas and matplotlib.
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


def find_run(arg: str | None) -> Path:
    if arg:
        return Path(arg)
    runs = sorted(Path("experiments/output").glob("*evolve*/"), key=lambda p: p.stat().st_mtime)
    runs = [r for r in runs if (r / "generations.csv").exists()]
    if not runs:
        sys.exit("no evolve run found")
    return runs[-1]


def load(run: Path) -> tuple[dict, pd.DataFrame]:
    manifest = json.loads((run / "manifest.json").read_text())
    return manifest, pd.read_csv(run / "generations.csv")


def summary(manifest: dict, gens: pd.DataFrame) -> str:
    last = gens.tail(10)
    return (
        f"{manifest['decider']}: {len(gens)} generations, {manifest['folk']} Folk\n"
        f"food coverage now {gens['coverage'].iloc[-1]:.3f} (lowest {gens['coverage'].min():.3f}); "
        f"mean of last 10 generations: coverage {last['coverage'].mean():.3f}, survival {last['survival'].mean():.0%}\n"
        f"generations that stopped early: {int(gens['stoppedEarly'].sum())}"
    )


def plot(manifest: dict, gens: pd.DataFrame, out: Path) -> None:
    out.mkdir(exist_ok=True)
    fig, (a, b) = plt.subplots(2, 1, figsize=(9, 6), sharex=True)
    a.plot(gens["generation"], gens["coverage"])
    a.set(ylabel="food coverage", title=f"{manifest['decider']}: how lean the world became")
    b.plot(gens["generation"], gens["survival"], label="survival at end")
    b.axhline(manifest["curriculum"]["targetSurvival"], color="grey", ls="--", label="target")
    b.set(ylabel="share alive", xlabel="generation", ylim=(0, 1.02))
    b.legend()
    fig.tight_layout()
    fig.savefig(out / "coverage_survival.png", dpi=120)
    plt.close(fig)

    keys = manifest["params"]
    fig, axes = plt.subplots(len(keys), 1, figsize=(9, 1.6 * len(keys)), sharex=True)
    for ax, key in zip(axes, keys):
        ax.plot(gens["generation"], gens[f"mean_{key}"], label="population mean")
        ax.plot(gens["generation"], gens[f"best_{key}"], alpha=0.5, label="best Folk")
        ax.set_ylabel(key, rotation=0, ha="right")
    axes[-1].set_xlabel("generation")
    axes[0].legend(ncol=2)
    fig.tight_layout()
    fig.savefig(out / "parameters.png", dpi=120)
    plt.close(fig)


if __name__ == "__main__":
    run = find_run(sys.argv[1] if len(sys.argv) > 1 else None)
    manifest, gens = load(run)
    print(summary(manifest, gens))
    plot(manifest, gens, run / "analysis")
    print(f"plots in {run / 'analysis'}")
