# Decision log

Format: date, decision, why, alternatives considered.

## 2026-09-19: Provisional stack

TypeScript + Vite + Canvas 2D + Vitest, sim separated from rendering. Why: headless deterministic experiments are central to the goal. To be revisited after the design session.

## 2026-09-19: Graphics style

Simple minimalist tiles, clear at a glance on a large board. Not constrained to ASCII.

## 2026-09-19: Focus on entities and world first

Design proceeds bottom-up: individual entities (stats, inventory) and the base world before seasons, groups, policy or governance. Why: the user wants a solid foundation to build interactions on. Earlier framing around policy metrics was deferred.

## 2026-09-19: Resources as lattice fields, not simulated plants or animals

Four per-tile fields (two plant, two game) with logistic regrowth and neighbour diffusion. Why: avoids per-organism overhead while giving realistic depletion and recovery. Alternative considered: discrete cellular automata states; better suited to world generation than to resource quantities.

## 2026-09-19: Full-map knowledge, population held fixed

Folk see the whole map in v1 behind a `perceive` interface so perception/memory can be added later. Folk can die; no births, and deaths are replaced by spawns to hold population constant. Why: isolate the food loop before adding complexity.

## 2026-09-19: Two-tier forage and hunt

Low effort/risk/reward and high effort/risk/reward variants of each. Why: gives Folk a real risk-reward choice from the start and exercises the data-driven action system.

## 2026-09-19: Run logging format

manifest.json + events.jsonl + periodic CSV snapshots. Why: pandas reads them natively, no extra dependencies.

## 2026-09-19: Entity name is Folk; repo is public

Folk chosen over Serf (implies social status that would clash with governance experiments) and Hind (ambiguous with deer). Repo made public so branch protection is available on the free plan.

## 2026-09-19: Swappable decision framework behind a common interface

Senses, action list with costs and results, and a per-Folk blackboard; decisions on action completion; per-decision performance logging. Utility AI primary, rule list as baseline, GOAP/HTN later for multi-step chains. Why: decision making is the likely bottleneck at high Folk counts, and the user wants to compare frameworks. Blackboards are private in v1 (shared knowledge is where group behaviour begins, which is deferred).

## 2026-09-19: Trait and utility-weight variation from v1

Configurable via `variationStrength`; 0 gives uniform Folk. Why: makes populations differ meaningfully while keeping clean baseline runs possible.

## 2026-09-19: PRs approved in chat

The user approves PRs in chat from a summary or playtest, not on GitHub.

## 2026-09-19: Stack is TypeScript end to end with a Node sim server

Sim, server, CLI and client are all TypeScript on Node 22 (npm workspaces). The sim runs in a Node server that writes logs and streams viewport-filtered deltas over WebSocket to a PixiJS/WebGL client. Why: target scale (over 1M tiles, over 1000 Folk) is within reach of typed-array TypeScript; the lattice can update every N ticks or by active region, and worker threads or WebGPU are available if needed. A browser-only sim cannot write logs to disk reliably. Rust core (with WASM or server) was considered and rejected for now: the user has not used Rust and the scale does not require it. Reconsider only if profiling shows the lattice or planners exceed tick budgets; port just the hot kernel.
Alternatives: all in browser main thread (does not scale), TS sim in a Web Worker only (no native logging), Rust/WASM in a worker.

## 2026-09-19: Emphasis on richer Folk over larger populations

The user prefers fewer, more complex Folk with stronger planning and group behaviour to many simple agents. Decision frameworks are therefore the expected cost centre; planners may run in worker threads, and per-decision performance tracking is a priority.

## 2026-09-19: MVP milestone order

Scaffold, world, resources, Folk with basic logging, actions and decisions, then analysis and benchmarks. Basic event logging was folded into the Folk milestone (rather than last) so runs can be analysed from the first playable Folk. Each milestone ends in a playable or inspectable build and a feedback session.

## 2026-09-19: Terrain as a table, resources as a species registry

Terrain is a data table with categories so subtypes (lake, river, ocean) are additions. The four fixed resource fields are replaced by a species registry: many plant and animal species per terrain, each with terrain affinity, capacity, regrowth and diffusion. Why: the user wants different plants and animals within the same terrain later. Two-tier forage and hunt become different species.

## 2026-09-19: Biomes from Perlin noise with quantile thresholds

Elevation and moisture are fractal Perlin noise; terrain classes are cut at quantiles of those fields. Why: gives coherent biome regions, and requested fractions (water, hills, forest) are honoured regardless of seed. Alternatives: fixed noise thresholds (fractions vary wildly by seed), cellular-automata smoothing (unneeded once noise is smooth).

## 2026-09-19: Terrain drawn as a single texture; sprites for tile state in a separate layer

One pixel per tile, nearest-filtered, so 1M-tile worlds render cheaply. Sprites showing resource levels (plentiful versus bare) go in a decoration layer added with resources.

## 2026-09-19: Default world is large-featured and simple; variety comes from resources

After playing milestone 2 the user found feature size 200 with 6 octaves ideal, and does not want a complex world, just different resource locations. Defaults changed to `noiseScale` 200 and `octaves` 6. Terrain stays a small set of broad biomes; further variety (which plants and animals live where, and how plentiful) comes from the species registry rather than more terrain types or generation complexity.

## 2026-09-20: Ecology rules and starting species

Four species (berries, roots and nuts, hare, deer), tiles initialised at a random fraction of capacity. Plants grow logistically from current stock with a seed bank; animals graze their diet then grow when fed and starve when not; all species spread toward equal density (conserving totals). Capacity depends on terrain affinity and moisture, which gives different resource locations without more terrain types. Appetites were tuned in a headless run: the balanced values (hare 0.15, deer 0.5 food per head per step) leave plants near 40% and animals near 70% of capacity, while stronger values strip plants to about 1%. Why: the user specified these rules and a random initial fill by tile type. Animals can go locally extinct and recolonise by spreading.

## 2026-09-20: Resources streamed as one byte per tile per species

Server sends compact frames at 4 Hz to subscribed clients and answers exact per-tile queries on click. Why: simple and fast at 256x256; viewport filtering and deltas are planned for 1M+ tiles.

## 2026-09-20: Milestone 4 scope and baseline Folk behaviour

Milestone 4 delivers 20 Folk near one settlement, rule-based behaviour (eat when hungry, walk to the nearest food by breadth-first search, rest, wander), click-to-inspect, and run logging. Deliberate scope choices: Folk eat plant stock directly from the tile because gathering into an inventory is milestone 5, so the inventory exists but is empty; death and replacement spawns were pulled forward from milestone 5 because the population must stay constant and deaths must be logged; perception is full-map within a 60-tile search depth as the v1 stand-in. Ecology stays stable, per the user; Folk barely dent it so far.

## 2026-09-20: Run logging shared by server and CLI

A `runlog` package writes manifest, events, entity and resource snapshots for every run, from the live server and from headless runs alike, so headless experiments and playtests produce the same analysable output. Logging one `move` event per step is opt-in because of volume; snapshots carry positions. Two runs starting in the same second get distinct folders (found by a test: `mkdir -p` does not fail on an existing folder).

## 2026-09-20: Servers stop cleanly; test by PID on separate ports

The server flushes and finalizes the run log on SIGINT/SIGTERM. Test servers run on other ports (`PORT`, `VITE_SERVER_PORT`) and are stopped by PID, because a port-based kill takes down whatever holds the port, including the user's own dev session.

## 2026-09-20: Plant scarcity stand-in deferred to milestone 5

The user asked to slow plant regrowth (a stand-in for seasons) rather than add Folk. Headless sweeps on the milestone 4 build (20 Folk, 256x256, seeds 1-3) showed it does not work on its own:

- Slowing plant regrowth alone has a cliff: unchanged down to about 80%, then at 70% and below the animals strip the plants everywhere and Folk starve continuously (about 20 deaths per 1000 ticks). Animals eat orders of magnitude more plant food than 20 Folk.
- Slowing plants and animal appetite together keeps the ecology stable, but Folk are never hungry even at 0.1% regrowth: 20 Folk eat far less than the standing stock of a 65,000-tile world, spread over roughly 80x100 tiles.
- Making plant food low-calorie (satiety per unit) does create pressure, but the range is narrow and seed-dependent: with regrowth at 5% and nutrition 0.025, seeds 1 and 2 saw under 1% hungry Folk-ticks and no deaths, while seed 3 saw 28% and 64 deaths, because settlement placement changes the local food supply.
  Decision: merge milestone 4 with the stable ecology unchanged, and build the scarcity stand-in as one tunable setting in milestone 5, tuned across several seeds, once Folk gather with real effort and competition costs. Seasons will replace it.
