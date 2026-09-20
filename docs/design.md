# Design

Scope of the current layer: the base world and the entities that live in it. No seasons, weather, groups, trade or governance yet. Stack is provisional and will be revisited after this design session.

## Guiding principles

- Bottom-up: individual entities with stats and inventory are the focus.
- Simple, minimalist graphics; every tile type is clear at a glance on a large board.
- Sim is pure and seeded; rendering and UI only read state.
- Every run is fully logged for later analysis in Python.
- Design extension points now (perception, goods, actions, resource fields) so later layers are additions.

## Entity: Folk

Generic `Entity` (id, position) with `Folk` as the first kind. Animals and plants are NOT entities.

**Stats (v1):** `satiety` (0-100, decays each tick; starvation damages health), `health` (0-100), `energy` (0-100), `age`, `position`, `skills` (`foraging`, `hunting`; 0-1, grow with use), `currentAction`.

**Inventory:** map of good to quantity, with a carry limit by weight. Goods are data-driven. v1 goods: plant food and meat (both edible, different food value). More goods, such as hides, are a data change.

**Behaviour (v1):** needs-driven. Hungry with no food: pick the best available food action and go do it. Tired: rest. Eat from inventory when hungry.

**Perception (v1):** full map knowledge. Access goes through a `perceive(entity)` interface so a radius and memory can replace it later without touching behaviour code.

**Lifecycle (v1):** can die (starvation, injury). No births. To keep population fixed, a new Folk spawns at the spawn point when one dies (logged as a `spawn` event). This is a stand-in until births exist.

## World

Tile grid. Per tile: `terrain` (grass, forest, hills, water, ...), `fertility`, and four resource fields, each a stock with a capacity:

- `plantsCommon`, `plantsRich`
- `gameSmall`, `gameLarge`

**Resource dynamics (lattice model, no individual plants or animals):** per tick, logistic regrowth `stock += rate * stock * (1 - stock / capacity)` with a small seed rate so depleted tiles can recover, plus neighbour diffusion (animals roam, seeds disperse). Overharvesting creates depleted patches that refill from surroundings. Update cost is O(tiles); can chunk or run every N ticks if needed.
Suggested per-field character: small game and common plants regrow fast with low capacity; large game and rich plants regrow slowly, have higher capacity where present, and large game diffuses widely.

**World generation:** seeded noise (elevation, moisture) plus CA smoothing passes for coherent forests, lakes and hills. Capacities derive from terrain and fertility.
Parameters: `seed`, `width`, `height`, `noiseScale`, `waterLevel`, `forestCoverage`, `fertilityVariance`, per-field density scale, per-field `regrowthRate` and `diffusionRate`, `startingFolk`, spawn placement.

## Actions (v1)

An action is data: resource field, time, energy cost, success chance, yield, injury risk, skill gain. Two tiers each for forage and hunt. Numbers below are placeholders to tune by playing.

| Action                                      | Field        | Effort | Risk             | Reward |
| ------------------------------------------- | ------------ | ------ | ---------------- | ------ |
| Gather (surface plants, berries and greens) | plantsCommon | low    | ~none            | low    |
| Dig/Deep-forage (roots, nuts, mushrooms)    | plantsRich   | high   | injury, bad-food | high   |
| Snare (small game)                          | gameSmall    | low    | ~none            | low    |
| Chase (large game)                          | gameLarge    | high   | serious injury   | high   |

Success and yield scale with skill and local density, so sparse tiles are harder and overharvesting is self-limiting. High-effort actions need a minimum local density to be worth attempting.

## Inspection UI

- Click a tile: coordinates, terrain, fertility, all four resource stocks and capacities, occupants.
- Click a Folk: all stats, inventory, current action, recent events.
  Requires read-only queryable sim state by id and coordinate.

## Logging (for Python analysis)

Each run writes `experiments/output/<run-id>/`:

- `manifest.json`: full config, seed, code version (git commit), start time.
- `events.jsonl`: append-only; `tick`, `type`, `entityId`, `tile`, payload. Types include move, forage, hunt, eat, rest, injure, die, spawn, and user actions.
- `entities.csv`: periodic snapshot of every Folk's stats and inventory.
- `tiles.csv`: periodic snapshot of resource fields (aggregated if large).
  Determinism means a replay from manifest reproduces the logs exactly; use that as a test.

## Extension points (planned, not built)

Perception and memory; births; more goods and recipes; specialisation via skills; seasons; groups and property; trade; governance.

## Behaviour (decision making)

**Swappable interface:** `decide(senses, actions, blackboard) -> Intent`. Frameworks are interchangeable and benchmarked against each other.

- **Senses:** read-only snapshot. Internal (stats, inventory, skills, current action) and external (via `perceive()`).
- **Actions:** currently available actions from the data-driven definitions, each with preconditions, cost (time, energy, risk) and expected result. Sim and deciders share one source of truth.
- **Blackboard (per Folk, private in v1):** knowledge (known tile estimates with timestamps), goals with priorities, plan/step queue and scratch space.
- **Cadence:** a Folk decides when its current action completes or is interrupted, not every tick.

**Performance tracking:** every `decide()` call is timed and logged (ms per decision, decisions per tick, p50/p95/max per framework, planner counters such as nodes expanded and cache hits, per-tick decision budget). A headless benchmark runs N Folk for M ticks on a fixed seed and reports ticks/sec per framework as N grows.

**Frameworks:** rule/priority list (baseline, performance floor) and utility AI (primary). GOAP or HTN when multi-step chains (crafting, trade, storage) arrive, with utility choosing goals and the planner producing steps. Behavior tree, RL and LLM-driven remain possible behind the interface.

**Trait and weight variation:** per Folk, drawn from a seeded distribution at spawn.

- Traits: `riskAversion`, `laziness`, `talent` (skill growth multiplier), `hungerThreshold`.
- Utility weights: per-Folk multiplier on each consideration (need urgency, expected yield, effort, risk, distance).
- `variationStrength` scales the spread; 0 gives identical Folk for clean baseline runs. Recorded in the manifest.
- Traits and weights are logged at spawn and shown in the Folk inspector. Replacement spawns draw fresh traits.
