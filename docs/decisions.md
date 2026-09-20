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
