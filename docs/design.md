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

Tile grid. Per tile: `terrain` (a data-driven table with a `category` and `walkable` flag; subtypes such as lake, river and ocean are later table entries), `elevation`, `moisture`, and resource stocks per **species**.

**Terrain (v1):** water, sand, grassland, forest, hills, mountain (mountain and water are not walkable). Terrain ids index typed arrays.

**Species registry (replaces the earlier four fixed fields):** plants and animals are entries in a data table, not entities. Each species declares the terrains it lives in, its capacity per terrain, regrowth rate and diffusion rate. Several species can share one terrain (e.g. berries and roots in forest; hare and deer in grassland). The two-tier actions map to species (see Actions). Species are added in milestone 3.

**Resource dynamics (implemented, milestone 3):** lattice model, no individual plants or animals. Each species has a per-tile stock and a per-tile capacity. Capacity = `maxCapacity * terrainAffinity * moistureSuitability`, where moisture suitability falls linearly from 1 at the species' optimum moisture to 0 at its tolerance. Uninhabitable tiles have capacity 0. Tiles start at a uniformly random fraction of capacity (seeded). Each step, in order:

1. **Animals graze and grow.** Demand = stock x intake. Food = sum of the stock of the plants in the diet on that tile. Eaten = min(food, demand), taken from each diet plant in proportion to its availability. Satisfaction = eaten / demand. Growth = `growthRate * stock * (1 - stock / capacity) * satisfaction - starvationRate * stock * (1 - satisfaction)`, so a fed herd grows logistically toward habitat capacity and an unfed one shrinks. On uninhabitable tiles animals decay quickly.
2. **Plants regrow:** `stock += growthRate * stock * (1 - stock / capacity) + seedRate * (capacity - stock)`. The seed bank lets grazed-out tiles recover.
3. **Every species spreads** between 4-neighbours toward equal density (stock / capacity); the flow across an edge is `diffusionRate * densityDifference * min(capacity_a, capacity_b)`, so the world total is conserved. Animals roam faster than plants spread.
   Stocks below 1e-4 are treated as extinct. Update cost is O(tiles x species): about 5 ms per step at 256x256, 18 ms at 512x512 and 72 ms at 1024x1024 with four species, so `ecologyInterval` lets large worlds step the ecology every N ticks.

**Species (v1):** berries (common plant: fast, modest capacity), roots and nuts (rich plant: slow, high capacity, forest and hills), hare (small game, eats berries, grassland) and deer (large game, eats berries and roots, forest, roams widely). With the shipped numbers the ecology settles within a few hundred steps at roughly 40% of plant capacity and 70% of animal capacity, with grazing limiting both; stronger appetites collapse the plants to about 1%.

**World generation (implemented, milestone 2):** seeded Perlin noise (fractal, several octaves) for elevation and for moisture. Terrain is chosen by quantile thresholds, so the requested fractions are honoured regardless of the noise: lowest `waterFraction` of tiles are water, the next `beachFraction` are sand, and of the remaining land the highest are mountain, then hills; the wettest `forestFraction` of lowland is forest and the rest grassland. This gives coherent biome regions (continents, lakes, mountain ranges ringed by hills) instead of random tiling. 1M tiles generate in about 0.5 s.
Parameters: `seed`, `width`, `height`, `noiseScale` (feature size in tiles), `octaves`, `waterFraction`, `beachFraction`, `hillFraction`, `mountainFraction`, `forestFraction`. All are editable from the client panel.

**Rendering:** the terrain is one nearest-filtered texture (1 pixel per tile) shaded by elevation, so large boards are cheap; pan and zoom, a grid that appears when zoomed in, and a tile selection highlight. A per-species heat overlay can be toggled, and when zoomed in each tile shows small sprites (squares for plants, circles for animals, one fixed slot per species) whose size shows how full the tile is, so plentiful versus bare reads at a glance. The server streams one byte per tile per species at 4 Hz to subscribed clients (to be filtered to the viewport at larger scales).

## Actions (v1)

An action is data: species (resource), time, energy cost, success chance, yield, injury risk, skill gain. Two tiers each for forage and hunt. Numbers below are placeholders to tune by playing.

| Action                                      | Field           | Effort | Risk             | Reward |
| ------------------------------------------- | --------------- | ------ | ---------------- | ------ |
| Gather (surface plants, berries and greens) | berries, greens | low    | ~none            | low    |
| Dig/Deep-forage (roots, nuts, mushrooms)    | plantsRich      | high   | injury, bad-food | high   |
| Snare (small game)                          | gameSmall       | low    | ~none            | low    |
| Chase (large game)                          | gameLarge       | high   | serious injury   | high   |

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
