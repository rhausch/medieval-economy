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

- [x] **F1: calories and configuration** (in review). One calorie reserve, metabolism, calorie costs for activities and injury healing, kg and kcal units, per-run configuration file recorded in the manifest, the energy ledger.
- [x] **F2: movement and goals** (in review). Terrain and slope speed and cost, goal on the blackboard with step-by-step walking and decider-defined interrupts, path shown in the inspector. Gaits deferred.
- [ ] **F3: patchy food.** Sparse clumped patches by species, slow recovery and overgrazing, the animal food experiment switch, active-tile ecology updates, world panel controls, sustainability sweep.
- [ ] **F4: perception and memory.** Sight radii, blackboard sightings with age, explored map, explore option, deciders using memory, giving-up density.
- [ ] **F5: tune and evaluate.** Sweeps across seeds, rules versus utility, shared versus separate animal food, decide on a first genetic algorithm run.

## Later (candidates)

Births and growth, storage and carrying penalties, seasons and a day and night cycle (fatigue returns with sleep), groups and shared knowledge, group hunting, property, trade and markets, a medieval setting with governance and policy experiments, disease, raiding.
