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

## Phase 2: World and Folk MVP

Each milestone ends in something to look at or play with, followed by a feedback session and a roadmap update.

1. **Scaffold and tooling** (done). npm workspaces monorepo, ESLint, Prettier, Vitest, CI, git hooks. An empty sim that ticks and a client that connects to the server.
2. **World** (in review). Seeded, configurable world generation. Terrain rendered in the browser with pan and zoom. Click a tile to inspect it.
3. **Resources.** Four resource fields with regrowth and diffusion, a toggleable overlay, and resource stocks in the tile inspector.
4. **Folk, minimal, with basic logging.** A few Folk with stats and inventory who wander and eat. Click a Folk to inspect it. Run folder with `manifest.json` and `events.jsonl`, plus periodic CSV snapshots, readable from Python.
5. **Actions and decisions.** Gather, dig, snare and chase. Rule-based and utility AI deciders behind the `decide()` interface, with trait and weight variation, deaths and replacement spawns.
6. **Analysis and benchmarks.** A Python notebook analysing run logs, per-decision performance logging, and the decision-time benchmark harness.

## Later (candidates)

Perception and memory, births, more goods, seasons, groups and property, trade and markets, governance and policy experiments, disease, raiding.
