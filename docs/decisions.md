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
