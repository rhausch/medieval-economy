#!/usr/bin/env bash
# A batch of genetic algorithm runs: every combination of decider x parameter space x seed, several at a time.
# Run it in its own console:   scripts/overnight.sh
#
# Settings (environment variables, all optional):
#   SEEDS="1 1001 2001"      world/breeding seeds (keep them far apart: generation g uses world seed SEED+g)
#   DECIDERS="utility rules"
#   SPACES="default wide"    default = the built-in parameter ranges; wide = configs/wide-params.json
#   GENERATIONS=150          generations per run
#   PARALLEL=4               runs at once (each uses one CPU core and roughly 0.5 GB)
#   FOLK=400 SIZE=512        population and world size (see docs/decisions.md before changing)
#   BATCH=<name>             batch folder name under experiments/output/ (default overnight-<date-time>)
#
# Safe to stop (Ctrl-C) and start again with the same BATCH=<name>: finished runs are skipped and unfinished
# ones continue from their last checkpoint. Afterwards:   python3 scripts/compare_evolution.py experiments/output/<batch>
set -u
cd "$(dirname "$0")/.."

SEEDS=${SEEDS:-"1 1001 2001"}
DECIDERS=${DECIDERS:-"utility rules"}
SPACES=${SPACES:-"default wide"}
GENERATIONS=${GENERATIONS:-150}
PARALLEL=${PARALLEL:-4}
FOLK=${FOLK:-400}
SIZE=${SIZE:-512}
BATCH=${BATCH:-overnight-$(date +%Y%m%d-%H%M)}
ROOT="experiments/output/$BATCH"
mkdir -p "$ROOT"

run_one() {
  local decider=$1 space=$2 seed=$3
  local dir="$ROOT/$decider-$space-seed$seed"
  [ -f "$dir/done" ] && { echo "skip $dir (done)"; return 0; }
  local config=()
  [ "$space" = wide ] && config=(--config configs/wide-params.json)
  local args=(--decider "$decider" --seed "$seed" --folk "$FOLK" --size "$SIZE" "${config[@]}")
  if [ -f "$dir/checkpoint.json" ]; then
    local done_gens remaining
    done_gens=$(python3 -c "import json,sys; print(json.load(open('$dir/checkpoint.json'))['generation'])")
    remaining=$((GENERATIONS - done_gens))
    [ "$remaining" -le 0 ] && { touch "$dir/done"; return 0; }
    echo "resume $dir at generation $done_gens"
    npm run -s evolve -- "${args[@]}" --generations "$remaining" --resume "$dir" >> "$dir.log" 2>&1
  else
    echo "start $dir"
    npm run -s evolve -- "${args[@]}" --generations "$GENERATIONS" --out "$dir" > "$dir.log" 2>&1
  fi
  if [ $? -eq 0 ]; then touch "$dir/done"; echo "finished $dir"; else echo "FAILED $dir (see $dir.log)"; fi
}
export -f run_one
export ROOT GENERATIONS FOLK SIZE

jobs=()
for seed in $SEEDS; do for space in $SPACES; do for decider in $DECIDERS; do
  jobs+=("$decider $space $seed")
done; done; done

echo "batch $BATCH: ${#jobs[@]} runs, $PARALLEL at a time, $GENERATIONS generations each, logs in $ROOT"
printf '%s\n' "${jobs[@]}" | xargs -P "$PARALLEL" -L 1 bash -c 'run_one $0 $1 $2'
echo "batch $BATCH complete. Compare: python3 scripts/compare_evolution.py $ROOT"
