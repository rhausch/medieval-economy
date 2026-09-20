# Design

Scope of the current layer: the base world and the entities that live in it. No seasons, weather, groups, trade or governance yet. Stack is provisional and will be revisited after this design session.

## Guiding principles

- Bottom-up: individual entities with stats and inventory are the focus.
- Simple, minimalist graphics; every tile type is clear at a glance on a large board.
- Sim is pure and seeded; rendering and UI only read state.
- Every run is fully logged for later analysis in Python.
- Design extension points now (perception, goods, actions, resource fields) so later layers are additions.

## Entity: Folk

Generic `Entity` (id, position) with `Folk` as the first kind. Animals and plants are NOT entities. Folk are stored as typed-array columns (one slot per Folk), not objects.

**Stats (implemented):** `satiety` (0-100, decays 0.12 per tick; at 0, health drops), `health` (0-100; regenerates slowly while well fed), `energy` (0-100; spent by moving, restored by resting), `age`, `position`, `skills` (`foraging`, `hunting`; present but not yet used), `currentAction` (idle, moving, eating, resting).

**Inventory:** a quantity per good, with a carry limit of 20 weight units (carrying only for now; a weight penalty on movement comes later). Goods are a data table (plant food, meat). Food enters the inventory by foraging and leaves it by eating; a Folk never eats straight from the ground.

**Population:** 20 Folk (configurable) around one **settlement**: the best of several random walkable tiles within 4 tiles of water, scored by nearby plant food. A Folk that dies is replaced at the settlement by a new one with fresh stats and fresh random decider parameters but the same decider, so the population and the decider mix stay constant.

## Actions (implemented)

An action is data (`data/actions.ts`): species worked, ticks, energy, minimum stock worth working, yield, base success, and the chance of a minor or serious injury. A Folk walks to the nearest tile that qualifies, works it for the action's duration (locked in, so decisions happen only when an action finishes), then the outcome resolves. Plants always yield and the amount comes out of the tile's stock. Animals succeed with a chance that rises with skill; a kill removes one head and yields meat. Skills (foraging, hunting) grow with use.

| Action | Species        | Ticks | Energy | Yield                | Injury chance         |
| ------ | -------------- | ----- | ------ | -------------------- | --------------------- |
| Gather | berries        | 4     | 0.5    | 3 plant food         | none                  |
| Dig    | roots and nuts | 12    | 3      | 14 plant food        | 3% minor              |
| Snare  | hare           | 5     | 0.5    | 3 meat, 50% success  | none                  |
| Chase  | deer           | 20    | 6      | 20 meat, 50% success | 15% minor, 5% serious |

Eating takes one tick and eats up to 10 units from the inventory, best food per unit first. Resting takes 3 ticks and restores 3 energy.

**Injury:** minor injuries make walking and every action take 2x as long, serious ones 10x. An injury costs health when it happens (5 minor, 25 serious) and heals one level after 300 ticks (minor to none) or 400 ticks (serious to minor). Healing values are placeholders. Injury can kill.

## Behaviour (decision making)

**Interface:** `decide(senses, out, scores)`. Senses are a read-only snapshot: stats, injury, what is carried and how much room is left, skills, the duration multiplier, the Folk's parameter array, and for each foraging option the nearest qualifying tile and the walking distance (one breadth-first search per decision, so deciders never search themselves). The decider returns an option (eat, gather, dig, snare, chase, rest, wander) and may write a score per option for the inspector. Folk keep a small blackboard-like state: current intent and the path to it.

**Deciders (both implemented, both running in the same world):**

- **Rules** (yellow): eat when hungry and carrying food, rest when tired until rested, restock food when the reserve is low (bold and healthy Folk try the risky high-yield work first), otherwise wander.
- **Utility** (teal): scores each available option on hunger and how far the carried reserve is below the wanted one, expected satiety per tick including the walk, effort, injury risk (higher when hurt) and distance, each scaled by that Folk's own weights, and takes the highest.

**Parameter arrays (genomes):** each decider declares a list of parameters with a min and max. Every Folk gets a random value for each, drawn uniformly at spawn; replacements draw fresh ones. Rules has 5 (eat threshold, rest thresholds, food target, risk tolerance), utility has 8 (weights for hunger, yield, effort, risk, distance, rest, wander, and the reserve wanted). The arrays are recorded in each spawn event, so a future genetic algorithm can select, breed and mutate them without changing the deciders. Folk are drawn in the color of their decider, with a legend and per-decider counts, and the inspector shows the array and the last decision scores.

**Later frameworks:** GOAP or HTN when multi-step chains (crafting, trade, storage) arrive, with utility choosing goals and a planner producing steps; a behavior tree, reinforcement learning or an LLM for a few notable Folk remain possible behind the same interface. A genetic algorithm would evolve the parameter arrays.

**Not yet:** perception limits and memory, a shared blackboard, planning (GOAP or HTN).

**Perception (v1):** full map knowledge within the search depth (60 tiles), a stand-in for the perception and memory to come.

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

## Inspection UI

- Click a tile: coordinates, terrain, elevation, moisture, and the stock and capacity of every species that can live there.
- Click a Folk: decider, needs, injury and when it heals, position and action, skills, inventory, the last decision and (for utility Folk) the score of every option, the parameter array with ranges, and recent events.
  Requires read-only queryable sim state by id and coordinate.

## Tracking and analysis (implemented)

The sim keeps cumulative counters, indexed by decider so the deciders can be compared in one world, and exposes them through `sim.metrics`:

- **Time:** Folk-ticks spent on each action (idle, moving, eating, resting, gathering, digging, snaring, chasing).
- **Energy:** energy spent while doing each action, and energy regained by resting or idling.
- **Food sources:** for every decider, species and terrain type: attempts, successes, units taken and the satiety those units are worth.
- **Consumption:** units and satiety eaten per good.
- **Per-Folk lifetime counters:** meals, satiety eaten, plant and meat units, attempts, successes, injuries, energy spent and steps. Written when a Folk dies (in the `die` event) and for the survivors at the end of the run.
- **World food:** stock and capacity of every species on every terrain type, and units of each good carried by Folk (computed on demand from the ecology).
  Food is conserved and tested: every unit taken from the world is either eaten or still carried.

**Performance:** the sim never reads a clock. A caller injects a `timer` (for example `performance.now`) and the sim then records, as count, mean, max and a log-scale histogram (quantiles accurate to about 19%): each whole tick, its ecology and Folk phases, the shared search for work, and each decider's own `decide()`. Timing never changes what the simulation does (tested). Decision times under about 1.2 microseconds are at the timer's resolution floor.

**Where you see it:** the client's Stats panel (updated once a second: ticks per second, ms per tick split into ecology and Folk, decisions per tick, decision percentiles per decider, food by terrain, time and energy by action, food sources), the run logs, and the Python analysis. `npm run bench` runs the benchmark matrix (Folk count by decider mode) and `docs/performance.md` records a baseline.

## Logging (for Python analysis)

Implemented in `packages/runlog`, used by both the server and the headless CLI. Each run writes `experiments/output/<run-id>/` (git-ignored):

- `manifest.json`: run id, start and end time, ticks, seed, full world parameters, ecology interval, regrowth scale, Folk count, decider mix and each decider's parameter specs, action table, injury table, snapshot and metrics intervals, whether it was timed, species and goods lists, settlement, git commit and dirty flag, Node version. Finalized (end time, tick count) when the run closes, including on server shutdown.
- `events.jsonl`: append-only, one JSON object per line with `tick`, `type` and the fields of that type: `spawn` (with decider and parameter array), `eat`, `gather`, `hunt`, `injure`, `heal`, `die` (with cause, lifetime and counters), and optionally `move` (off by default because of volume).
- `entities.csv`: a snapshot of every Folk every N ticks (default 10) plus a final one: stats, action, decider, injury level, skills and inventory.
- `resources.csv`: total stock per species and food carried, at the same ticks.
- `terrain_resources.csv`: stock and capacity per terrain type and species, every M ticks (default 100).
- `activity.csv`, `food_sources.csv`, `consumption.csv`: the cumulative time, energy and food counters above, every M ticks.
- `lifetimes.csv`: one row per Folk (at death, or at the end of the run): decider, birth and death tick, cause, counters and the parameter array, ready to use as fitness data for a genetic algorithm.
- `performance.json`: timing summaries, when the run was timed.
  `scripts/summarize_run.py` gives a quick text summary; `scripts/analyze_run.py` and `notebooks/analyze_run.ipynb` load everything into pandas and plot it. A test runs the analysis on a freshly logged run so the two stay in step. Determinism means a replay from the manifest should reproduce the logs; an automated replay check is still to do.

## Extension points (planned, not built)

Perception and memory; births; more goods and recipes; specialisation via skills; seasons; groups and property; trade; governance.
