---
name: run-experiment
description: Run the headless simulation with a given policy set and seed(s) and summarize the outcome. Use when comparing policies or checking for collapse or instability.
---

1. Confirm policy settings, seed(s), and run length in ticks.
2. Run the headless runner in `scripts/` (define its command in CLAUDE.md once it exists).
3. Report: population, food stock, wealth inequality, price stability, collapse events, over time.
4. Compare against a baseline run with the same seeds; note variance across seeds.
5. Write large outputs to `experiments/output/` (git-ignored); summarize in chat.
