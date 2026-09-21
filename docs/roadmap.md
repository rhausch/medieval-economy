# Roadmap

Living document. Updated after every playtest. Each milestone ends with a playable build and a feedback session.

## Phase 0: Setup (complete)

- [x] Repo, CLAUDE.md, skills, doc scaffolding
- [x] Branch protection on main (repo made public)
- [x] Tooling (lint, format, test, hooks, CI)

## Phase 1: Interactive design session (complete)

- [x] Entities, stats, inventory, resource model, logging (see `docs/design.md`)
- [x] Confirm entity name (Folk)
- [x] Revisit stack against requirements (TypeScript, Node sim server, PixiJS client)
- [x] Draft MVP milestones

## Phase 2: World and Folk MVP (complete)

1. **Scaffold and tooling.** npm workspaces monorepo, lint, format, tests, CI, hooks, ticking sim and connected client.
2. **World.** Seeded biome generation from Perlin noise, terrain in the browser with pan and zoom, tile inspector.
3. **Resources.** Species as per-tile stocks with regrowth, grazing and spreading, overlays, tile sprites, resource stats.
4. **Folk with logging.** 20 Folk, click-to-inspect, run logging readable from Python.
5. **Actions and decisions.** Gather, dig, snare, chase into an inventory; injury; rules and utility deciders with parameter arrays, colored by decider.
6. **Analysis and benchmarks.** Metrics and timing, live Stats panel, `npm run bench`, pandas analysis and notebook, performance baseline.

Findings that motivated the pivot are in `docs/decisions.md` ("Findings to tune from").

## Phase 3: Hunter-gatherer foundation (current)

Planned in detail in `docs/foundation.md`.

- [x] **F1: calories and configuration** (merged). One calorie reserve, metabolism, calorie costs for activities and injury healing, kg and kcal units, per-run configuration file recorded in the manifest, the energy ledger.
- [x] **F2: movement and goals** (merged). Terrain and slope speed and cost, goal on the blackboard with step-by-step walking and decider-defined interrupts, path shown in the inspector. Gaits deferred.
- [x] **F3: patchy food** (merged). Sparse clumped patches by species, realistic slow rates, viability and no seeding so grazed-out patches stay empty, the animal food experiment (separate wins), active-tile ecology updates, world panel controls, sustainability sweep.
- [x] **F4: perception and memory** (merged). Per-species detection ranges (plants 1, animals 3) and terrain range 10, blackboard sightings with age, explored map and fog-of-war view, explore option, deciders choosing among remembered places, giving-up density and memory half-life as parameters.
- [x] **Solo Folk** (merged). Each Folk starts alone at a random place, optional no-replacement runs, survival analysis; rules 100% vs utility 99% survive at default food, 94% vs 47% at a quarter of the food.
- [x] **Genetic algorithm** (merged). Evolves a decider's parameter array over solo Folk with no respawn and food lowered as they improve; first run reaches 0.12x food coverage at 50% survival for utility and 0.17x for rules.
- [ ] **Overnight evolution batch** (in review). `scripts/overnight.sh` runs both deciders on default and wide parameter ranges over three seeds; `scripts/compare_evolution.py` summarises it. Results to be read next session.
- [ ] **F5: tune and evaluate.** Read the overnight batch: does utility beat rules across seeds, do wide ranges help, which parameters hit their limits. Then re-check rules versus utility on the evolved parameters and decide what the Folk still lack before cooperation (see "Next session").

## Next session

Start here. Solo Folk, the genetic algorithm and the overnight batch are built; what is missing is reading the results.

1. Run `python3 scripts/compare_evolution.py` (newest `experiments/output/overnight-*` batch; logs are in the batch folder, one `<decider>-<space>-seed<N>.log` per run). Record the table in `docs/decisions.md`.
2. Questions to answer: (a) is utility ahead of rules on every seed (first single-seed run: utility 0.12x, rules 0.17x food coverage at 50% survival)? (b) do wide ranges beat the defaults or just start worse? (c) which parameters sit at the edge of their range in the best Folk (`best_<param>` columns in each `generations.csv`)? Edge values mean the range or the decider itself limits Folk.
3. Take the best evolved parameter sets, write them into a config (`configs/`), and rerun the solo survival test (`npm run sim -- --no-replace --coverage 0.15 ...`) against unevolved Folk to confirm the gain holds on fresh worlds and seeds.
4. Then choose the next slice with the user. Candidates: decide what limits survival (walk the deaths in `lifetimes.csv`), evolve more of the body of the Folk (gait, sight), or start cooperation (groups, shared knowledge) as planned.

Not yet done: the two-process interference test at the _evolved_ coverage (the Folk-count choice of 400 on 512 by 512 was measured at 0.5x food), and no GA run has used the shared-food animal setting.

## Later (candidates)

Births and growth, storage and carrying penalties, seasons and a day and night cycle (fatigue returns with sleep), groups and shared knowledge, group hunting, property, trade and markets, a medieval setting with governance and policy experiments, disease, raiding.
