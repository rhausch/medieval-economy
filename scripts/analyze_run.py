#!/usr/bin/env python3
"""Analyze a run folder written by the sim logger, with pandas and matplotlib.

Usage:
    python3 scripts/analyze_run.py [run_dir] [--out DIR]

Defaults to the newest run in experiments/output/. Prints the key tables and writes plots to
<run_dir>/analysis/ (or --out). Every function returns a DataFrame or a figure, so the same code
drives notebooks/analyze_run.ipynb.

What it answers, for tuning the world and the behaviours:
  food_over_time      total food (plants, animals, and what Folk carry) over time
  terrain_fill        how full each terrain type is, per species, over time
  time_by_action      how each decider's Folk spend their time
  calorie_ledger      calories in and out: eaten, baseline, healing and each activity
  reserve             calorie reserves over time
  food_sources        where calories come from: species, terrain, success rate
  lifetimes           per-Folk outcomes with the decider parameters (fitness data for a GA)
  performance         decision and tick timings
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

DECIDER_COLORS = {"rules": "#ffd23f", "utility": "#4fd1c5"}
ACTION_COLORS = {
    "idle": "#556070", "moving": "#8b98a8", "eating": "#e0a030", "resting": "#4f9bd9",
    "gathering": "#b04a9c", "digging": "#d98a3d", "snaring": "#dfe6ee", "chasing": "#8a5a32",
}
TERRAIN_COLORS = {
    "water": "#2f6fb0", "sand": "#e6d99b", "grass": "#6fae4f",
    "forest": "#2f7a3a", "hills": "#93694a", "mountain": "#8a8a92",
}
SPECIES_COLORS = {"berries": "#b04a9c", "roots": "#d98a3d", "hare": "#bbbbbb", "deer": "#5a3a20"}


def newest_run() -> Path:
    root = Path(__file__).resolve().parent.parent / "experiments" / "output"
    runs = sorted(
        (p for p in root.iterdir() if p.is_dir() and (p / "manifest.json").exists()),
        key=lambda p: p.stat().st_mtime,
    )
    if not runs:
        sys.exit(f"no runs found in {root}")
    return runs[-1]


class Run:
    """One run folder, loaded lazily."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.manifest = json.loads((self.path / "manifest.json").read_text())

    def csv(self, name: str) -> pd.DataFrame:
        return pd.read_csv(self.path / name)

    @property
    def events(self) -> pd.DataFrame:
        return pd.read_json(self.path / "events.jsonl", lines=True)

    @property
    def performance(self) -> dict | None:
        f = self.path / "performance.json"
        return json.loads(f.read_text()) if f.exists() else None

    def __repr__(self) -> str:
        m = self.manifest
        return f"Run({m['runId']}: seed {m['seed']}, {m['ticks']} ticks, {m['folkCount']} Folk)"


# --- tables -------------------------------------------------------------------------------------


def food_over_time(run: Run) -> pd.DataFrame:
    """Species totals, plus food carried by Folk, at each snapshot tick."""
    return run.csv("resources.csv")


def terrain_fill(run: Run) -> pd.DataFrame:
    """Stock as a share of capacity for each terrain and species at each metrics tick."""
    df = run.csv("terrain_resources.csv")
    df = df[df["capacity"] > 0].copy()
    df["fill"] = df["stock"] / df["capacity"]
    return df


def _final(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["tick"] == df["tick"].max()]


def time_by_action(run: Run) -> pd.DataFrame:
    """Share of each decider's Folk-ticks spent on each action (whole run)."""
    last = _final(run.csv("activity.csv")).copy()
    last["share"] = last["folkTicks"] / last.groupby("decider")["folkTicks"].transform("sum")
    return last[["decider", "action", "folkTicks", "share"]]


def calorie_ledger(run: Run) -> pd.DataFrame:
    """Calories in and out per decider over the whole run.

    `eaten` is calories in. Out is the baseline burn, healing, and each activity's cost above baseline
    (resting is negative: it burns less than baseline). `share_of_burn` is each out item's share of all
    calories burned.
    """
    act = _final(run.csv("activity.csv"))[["decider", "action", "kcal"]].rename(columns={"action": "category"})
    led = _final(run.csv("ledger.csv"))[["decider", "category", "kcal"]]
    out = pd.concat([led, act], ignore_index=True)
    out["direction"] = out["category"].map(lambda c: "in" if c == "eaten" else "out")
    burn = out["direction"] == "out"
    out.loc[burn, "share_of_burn"] = out[burn]["kcal"] / out[burn].groupby("decider")["kcal"].transform("sum")
    return out


def reserve_over_time(run: Run) -> pd.DataFrame:
    """Calorie reserve per decider at each snapshot: mean, minimum and maximum, as a share of capacity."""
    capacity = run.manifest["settings"]["body"]["reserveCapacity"]
    df = run.csv("entities.csv")
    df["fraction"] = df["reserve"] / capacity
    return df.groupby(["tick", "decider"])["fraction"].agg(["mean", "min", "max"]).reset_index()


def food_sources(run: Run) -> pd.DataFrame:
    """Where food came from (whole run): by decider, species and terrain."""
    df = _final(run.csv("food_sources.csv")).copy()
    df["success_rate"] = df["successes"] / df["attempts"]
    df["kcal_share"] = df["kcal"] / df.groupby("decider")["kcal"].transform("sum")
    return df.drop(columns="tick")


def lifetimes(run: Run) -> pd.DataFrame:
    """One row per Folk that lived, with decider parameters and outcomes per tick of life."""
    df = run.csv("lifetimes.csv")
    lived = df["lived"].clip(lower=1)
    df["alive_at_end"] = df["died"].isna()
    df["kcal_in_per_tick"] = df["kcalEaten"] / lived
    df["kcal_out_per_tick"] = df["kcalSpent"] / lived
    df["net_kcal_per_tick"] = df["kcal_in_per_tick"] - df["kcal_out_per_tick"]
    df["steps_per_tick"] = df["steps"] / lived
    return df


def parameter_effects(run: Run) -> pd.DataFrame:
    """Correlation of each decider parameter with calories eaten per tick lived and with net calories."""
    df = lifetimes(run)
    out = []
    for decider in run.manifest["deciders"]:
        mine = df[df["decider"] == decider["key"]]
        for i, p in enumerate(decider["params"]):
            col = f"p{i}"
            if len(mine) > 3 and mine[col].nunique() > 1:
                out.append({
                    "decider": decider["key"], "param": p["key"],
                    "corr_kcal_in": mine[col].corr(mine["kcal_in_per_tick"]),
                    "corr_net_kcal": mine[col].corr(mine["net_kcal_per_tick"]),
                })
    return pd.DataFrame(out)


def performance(run: Run) -> pd.DataFrame:
    """Timing summary in microseconds: whole tick, phases, the search, and each decider."""
    perf = run.performance
    if not perf:
        return pd.DataFrame()
    rows = []
    for name in ("step", "ecology", "folk", "scan"):
        rows.append({"what": name, **perf[name]})
    for key, stat in perf["decide"].items():
        if stat["count"]:
            rows.append({"what": f"decide:{key}", **stat})
    df = pd.DataFrame(rows).set_index("what")
    for col in ("meanMs", "p50Ms", "p95Ms", "p99Ms", "maxMs"):
        df[col.replace("Ms", "Us")] = df[col] * 1000
    return df.drop(columns=["meanMs", "p50Ms", "p95Ms", "p99Ms", "maxMs"])


# --- plots --------------------------------------------------------------------------------------


def plot_food_over_time(run: Run) -> plt.Figure:
    df = food_over_time(run)
    species = run.manifest["species"]
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))
    for s in species:
        axes[0].plot(df["tick"], df[s] / df[s].iloc[0], label=s, color=SPECIES_COLORS.get(s))
    axes[0].set(title="World stock relative to start", xlabel="tick", ylabel="share of initial")
    axes[0].legend()
    for col in [c for c in df.columns if c.startswith("carried_")]:
        axes[1].plot(df["tick"], df[col], label=col.replace("carried_", ""))
    axes[1].set(title="Food carried by Folk", xlabel="tick", ylabel="units")
    axes[1].legend()
    fig.tight_layout()
    return fig


def plot_terrain_fill(run: Run) -> plt.Figure:
    df = terrain_fill(run)
    species = run.manifest["species"]
    fig, axes = plt.subplots(1, len(species), figsize=(3.4 * len(species), 3.4), sharey=True)
    for ax, s in zip(axes, species):
        for terrain, grp in df[df["species"] == s].groupby("terrain"):
            ax.plot(grp["tick"], grp["fill"], label=terrain, color=TERRAIN_COLORS.get(terrain))
        ax.set(title=s, xlabel="tick", ylim=(0, 1.05))
    axes[0].set_ylabel("stock / capacity")
    handles = [plt.Line2D([], [], color=c, label=t) for t, c in TERRAIN_COLORS.items() if t in set(df["terrain"])]
    axes[-1].legend(handles=handles, fontsize=7)
    fig.suptitle("Food fill by terrain")
    fig.tight_layout()
    return fig


def _stacked(df: pd.DataFrame, value: str, title: str, colors: dict[str, str]) -> plt.Figure:
    pivot = df.pivot(index="decider", columns="action", values=value).fillna(0)
    pivot = pivot.div(pivot.sum(axis=1), axis=0)
    fig, ax = plt.subplots(figsize=(8, 2.2 + 0.6 * len(pivot)))
    left = pd.Series(0.0, index=pivot.index)
    for action in pivot.columns:
        if pivot[action].sum() == 0:
            continue
        ax.barh(pivot.index, pivot[action], left=left, label=action, color=colors.get(action))
        left += pivot[action]
    ax.set(title=title, xlim=(0, 1), xlabel="share")
    ax.legend(ncol=4, fontsize=7, loc="upper center", bbox_to_anchor=(0.5, -0.25))
    fig.tight_layout()
    return fig


def plot_time_by_action(run: Run) -> plt.Figure:
    return _stacked(time_by_action(run), "folkTicks", "Time spent by action", ACTION_COLORS)


def plot_calories(run: Run) -> plt.Figure:
    """Calories out by category for each decider, next to calories in."""
    led = calorie_ledger(run)
    deciders = list(led["decider"].unique())
    fig, axes = plt.subplots(1, 2, figsize=(11, 3 + 0.4 * len(deciders)), gridspec_kw={"width_ratios": [3, 1]})
    burn = led[(led["direction"] == "out") & (led["kcal"] > 0)]
    cats = burn.groupby("category")["kcal"].sum().sort_values(ascending=False).index
    colors = {**ACTION_COLORS, "baseline": "#8d6e63", "healing": "#d05050"}
    left = pd.Series(0.0, index=deciders)
    for cat in cats:
        vals = burn[burn["category"] == cat].set_index("decider")["kcal"].reindex(deciders).fillna(0)
        axes[0].barh(deciders, vals, left=left, label=cat, color=colors.get(cat))
        left += vals
    axes[0].set(title="Calories burned (resting's saving not shown)", xlabel="kcal")
    axes[0].legend(ncol=5, fontsize=7, loc="upper center", bbox_to_anchor=(0.5, -0.25))
    eaten = led[led["category"] == "eaten"].set_index("decider")["kcal"].reindex(deciders)
    axes[1].bar(deciders, eaten, color=[DECIDER_COLORS.get(d) for d in deciders])
    axes[1].set(title="Calories eaten", ylabel="kcal")
    fig.tight_layout()
    return fig


def plot_reserve(run: Run) -> plt.Figure:
    """Mean, minimum and maximum calorie reserve over time, per decider."""
    df = reserve_over_time(run)
    fig, ax = plt.subplots(figsize=(8, 3.4))
    for decider, grp in df.groupby("decider"):
        color = DECIDER_COLORS.get(decider)
        ax.plot(grp["tick"], grp["mean"], label=f"{decider} mean", color=color)
        ax.fill_between(grp["tick"], grp["min"], grp["max"], alpha=0.15, color=color)
    ax.set(title="Calorie reserve (share of capacity)", xlabel="tick", ylim=(0, 1.05))
    ax.legend()
    fig.tight_layout()
    return fig


def plot_food_sources(run: Run) -> plt.Figure:
    df = food_sources(run)
    deciders = list(df["decider"].unique())
    fig, axes = plt.subplots(2, len(deciders), figsize=(4.6 * len(deciders), 6), squeeze=False)
    for j, decider in enumerate(deciders):
        mine = df[df["decider"] == decider]
        by_species = mine.groupby("species")["kcal"].sum()
        axes[0][j].bar(by_species.index, by_species.values, color=[SPECIES_COLORS.get(s) for s in by_species.index])
        axes[0][j].set(title=f"{decider}: kcal by species")
        by_terrain = mine.groupby("terrain")["kcal"].sum().sort_values(ascending=False)
        axes[1][j].bar(by_terrain.index, by_terrain.values, color=[TERRAIN_COLORS.get(t) for t in by_terrain.index])
        axes[1][j].set(title=f"{decider}: kcal by terrain")
    fig.tight_layout()
    return fig


def plot_lifetimes(run: Run) -> plt.Figure:
    df = lifetimes(run)
    metrics = [("kcal_in_per_tick", "kcal eaten / tick"), ("kcal_out_per_tick", "kcal burned / tick"),
               ("steps_per_tick", "steps / tick")]
    fig, axes = plt.subplots(1, len(metrics), figsize=(4 * len(metrics), 3.4))
    for ax, (col, label) in zip(axes, metrics):
        for decider, grp in df.groupby("decider"):
            ax.hist(grp[col], bins=12, alpha=0.6, label=decider, color=DECIDER_COLORS.get(decider))
        ax.set(title=label)
    axes[0].legend()
    fig.suptitle("Per-Folk outcomes")
    fig.tight_layout()
    return fig


PLOTS = {
    "food_over_time": plot_food_over_time,
    "terrain_fill": plot_terrain_fill,
    "time_by_action": plot_time_by_action,
    "calories": plot_calories,
    "reserve": plot_reserve,
    "food_sources": plot_food_sources,
    "lifetimes": plot_lifetimes,
}


def report(run: Run, out: Path | None = None) -> Path:
    """Print the key tables and write every plot; returns the output folder."""
    out = out or run.path / "analysis"
    out.mkdir(parents=True, exist_ok=True)
    pd.set_option("display.width", 160)
    pd.set_option("display.float_format", lambda v: f"{v:,.3f}")
    print(run)
    print("\n== time by action (share of Folk-ticks) ==")
    print(time_by_action(run).pivot(index="action", columns="decider", values="share"))
    print("\n== calories: in, and out by category (kcal, and share of all calories burned) ==")
    led = calorie_ledger(run)
    print(led.pivot(index="category", columns="decider", values="kcal"))
    print("\n== where calories come from (by decider and species) ==")
    src = food_sources(run)
    print(src.groupby(["decider", "species"])[["attempts", "successes", "kg", "kcal"]].sum())
    print("\n== where calories come from (by terrain) ==")
    print(src.groupby(["decider", "terrain"])["kcal"].sum().unstack(0))
    print("\n== food fill by terrain, last snapshot ==")
    print(_final(terrain_fill(run)).pivot(index="terrain", columns="species", values="fill"))
    life = lifetimes(run)
    print("\n== per-Folk outcomes by decider ==")
    print(life.groupby("decider")[["lived", "meals", "kcal_in_per_tick", "kcal_out_per_tick", "net_kcal_per_tick", "injuries"]].mean())
    effects = parameter_effects(run)
    if len(effects):
        print("\n== parameter correlation with calories eaten and with net calories, per tick ==")
        print(effects.to_string(index=False))
    perf = performance(run)
    if len(perf):
        print("\n== timing (microseconds) ==")
        print(perf)
    for name, fn in PLOTS.items():
        fig = fn(run)
        fig.savefig(out / f"{name}.png", dpi=110)
        plt.close(fig)
    print(f"\nplots written to {out}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run", nargs="?", help="run folder (default: newest)")
    parser.add_argument("--out", help="folder for plots (default: <run>/analysis)")
    args = parser.parse_args()
    run = Run(Path(args.run) if args.run else newest_run())
    report(run, Path(args.out) if args.out else None)


if __name__ == "__main__":
    main()
