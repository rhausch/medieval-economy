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

## 2026-09-20: Actions, injury and deciders with parameter arrays (milestone 5)

- Carrying only, no storage; food enters the inventory by foraging and Folk eat only from it. A weight penalty on movement comes later.
- Four foraging actions with the agreed placeholder numbers. Actions take several ticks and decisions happen when one finishes.
- Injury slows walking and every action (minor 2x, serious 10x) and heals a level at a time (300 and 400 ticks, chosen by me, to tune).
- Every decider owns a parameter array with min and max per parameter; each Folk gets random values, recorded in its spawn event, so a genetic algorithm can be added without touching the deciders. Rules and utility deciders run side by side in one world, colored on the map, and a replacement keeps the dead Folk's decider with fresh parameters.
- Skills grow slowly with use (a fixed rate for now; a per-Folk talent trait was dropped in favour of parameter arrays).
- Decision timing and the benchmark harness stay in milestone 6.

## 2026-09-20: Plant scarcity cannot be produced by slowing regrowth with 20 Folk

Two settings exist and default to 1: `plantRegrowthScale` (plant regrowth and animal appetite together, so the balance holds) and `hungerScale` (how fast Folk get hungry). Measured on the milestone 5 build, seeds 1-3:

- Regrowth scaled to 0.3-100% for 6000 ticks: no hunger and no deaths at any setting; results barely differ from full regrowth.
- Regrowth at 0.3% for 60000 ticks: still no deaths and no hunger (plants fell from about 1.2M to 0.6M units). The standing stock is large next to what 20 Folk eat.
- Hunger 2x to 6x: light pressure at most (0-4% of Folk-ticks hungry, one death in 18 runs), because gathering yields about 0.75 food per tick against a need of 0.12 x scale per tick.
  Real scarcity therefore needs more Folk, a smaller or poorer world, much higher hunger, or seasons. The knobs are available in the panel, CLI and server (`REGROWTH` environment variable) so it can be explored by playing.
  Observed decider behaviour: rules Folk dig and are injured 1-5% of the time; utility Folk mix gathering with snaring hares, are rarely injured, and almost never chase deer.

## 2026-09-20: Measurement approach (milestone 6)

Timing uses an injected clock so the sim stays pure and results unchanged; decisions are timed as the shared search plus each decider's own call, because the search, not the decider, is the variable cost. Tracking is cumulative counters per decider (time, energy, food sources, consumption) plus per-Folk lifetime counters, logged as tidy CSVs for pandas; per-Folk lifetimes double as the fitness data a genetic algorithm will need. A live Stats panel shows the same numbers while playing. The Python analysis is tested against a freshly logged run so it cannot drift from the log format, and CI installs pandas and matplotlib for that.

## 2026-09-20: Findings to tune from (end of milestone 6)

From a 6000-tick run (seed 2) and the benchmarks; all to be revisited in the tuning phase:

- **Cost:** the ecology dominates: about 3.7 ms per tick at 256x256 and about 60 ms at 1024x1024 (1M tiles, about 17 ticks/s). All Folk together cost about 1 to 2 microseconds per Folk per tick, so even 5000 Folk add only 5 to 9 ms. Decisions themselves are under the timer floor (about 1.2 us); the shared search has p95 of 3 to 13 us and rare tails of hundreds of us.
- **Decisions are mostly wandering:** about 0.9 decisions per Folk per tick, because wander, idle and eat last a single tick. Longer wander actions would cut this.
- **Where Folk spend time:** about 44 to 46% moving, about 29 to 31% idle, about 10% resting, 5 to 14% working. About 86% of all energy goes on walking.
- **Food is concentrated in forest:** berries and roots in grassland and hills settle at about 1% of capacity within 500 ticks (grazed out by animals), so forest supplies 85 to 99% of Folk food; only forest and sand keep plants at a useful level. Hare and deer stay at 30 to 100% of capacity everywhere.
- **Deciders:** rules Folk gather berries and dig roots; utility Folk mix in hare snaring (about 60% success), are hurt slightly more often, and nobody chases deer.
- **Parameters:** for rules Folk, hunger threshold and risk tolerance correlate most strongly with satiety eaten per tick; for utility Folk, hunger weight correlates positively and risk, distance and reserve weights negatively (small samples, not conclusive).

## 2026-09-20: Pivot to a hunter-gatherer ecology simulation

After reviewing the MVP against its measurements, the project focus moves to a hunter-gatherer ecology simulation as the foundation; the medieval economy and governance experiments remain the long-term goal and are built on top of it. Why: costs were disconnected from food, food was everywhere, and Folk knew the whole map, so there were no real trade-offs to build an economy on. Plan in `docs/foundation.md`.

## 2026-09-20: One calorie reserve; injury is a status; fatigue dropped

Satiety, energy and health merge into a single calorie reserve; activities carry calorie costs; healing an injury burns calories; injury keeps its duration multipliers (minor 2x, serious 10x). Fatigue is dropped until a day and night cycle exists. Death is the reserve reaching zero.

## 2026-09-20: Units

Tick = 6 minutes, tile = 360 m (walking at 1 m/s crosses a tile per tick; running up to 4 m/s crosses several), mass in kg, energy in kcal. All are defaults in the run configuration.

## 2026-09-20: Movement is a goal on the blackboard, walked step by step

A goal (target, purpose, time chosen) is stored on the blackboard; each step is a small action whose time and calorie cost depend on gait, terrain, slope and injury; decisions run only on arrival, invalid goal or an interrupt. A single multi-tick walk action was rejected: it cannot be interrupted or adapt to terrain, and it hides the goal.

## 2026-09-20: Blackboard remembers sightings with their age

Each Folk stores where it saw food, of what and how much, and when, plus a coarse explored map, its goal and the camp. Deciders see age and discount stale knowledge. Perception has per-kind sight radii (plants 1 tile, animals 3 by default) and replaces the 60-tile omniscient search.

## 2026-09-20: Food starts sparse and patchy; animal food separation is an experiment

Per-species patch coverage starts low (berries about 4% of habitable tiles, roots 3%, hare 8%, deer 2%) and is raised if the world is unsustainable. Regrowth needs neighbouring stock, so emptied patches stay empty. Whether animals should graze their own forage instead of the berries and roots Folk gather is uncertain, so it is a per-run switch, default shared, compared in F5.

## 2026-09-20: Activities and costs are configured per run

All costs, yields, speeds, densities and ranges live in a configuration file loaded at the start of a run (not adjustable during one); the resolved configuration and its hash are recorded in the manifest.

## 2026-09-20: F1 built: calories and per-run configuration

- One calorie reserve per Folk; baseline burn plus activity plus healing every tick; eating limited by room and intake per tick; energy conservation tested. Yields and costs are set from real-world anchors (1 MET is 7.9 kcal per tick), listed in `docs/foundation.md`.
- The run configuration is a strict JSON overlay on built-in defaults: numbers only, collections keyed by name, unknown or protected settings rejected with the path, impossible values rejected, resolved settings and a hash written to the manifest, `configs/default.json` generated and tested against the code. Relative paths resolve from the directory the command was started in (npm runs workspace scripts from the package folder). Adding new goods, species or actions through the file is not supported yet.
- The old `hungerScale` setting is gone: metabolism is `body.baselineKcalPerTick` in the configuration.
- The utility decider needed two guarantees found by trace: eating must win in an emergency, and a hungry Folk short of food must forage, regardless of its random personality; before them, low-yield-weight, high-wander-weight Folk wandered until they starved. A regression test runs five seeds and requires no starvation in a food-rich world.
- Known consequence of realistic calories: utility Folk favour snaring hare over gathering, and a deer kill is wasted beyond the 20 kg they can carry. Both are for F3 (sparse food) and later (sharing, storage, group hunting) to resolve.

## 2026-09-20: F2 built: movement and goals (gaits dropped)

- **No gaits.** The user was unsure jogging and running would add anything, so Folk walk at one speed; terrain and slope change how fast and how much it costs. Revisit only if big-game hunting needs sprints.
- **Walking time, not tiles.** Routes and "nearest food" use a walking-time search over terrain speed and slope; the cost per tick of walking makes slow ground cost more per tile without a separate multiplier; climbing adds 0.65 kcal per metre.
- **Goal on the blackboard, walked step by step** (as decided earlier), with fractional step times whose remainder carries forward so speed is exact.
- **Decider-defined interrupts (option B).** Each decider says when it would rather reconsider. The first version (a global 30% reserve threshold) interrupted Folk that had chosen to eat late, and a utility Folk interrupted without then choosing differently. Now `shouldInterrupt` implies `decide` picks eating, tested over random senses; the utility emergency score was raised so eating outranks everything in an emergency. A cooldown stops loops. The global `interruptReserve` setting was removed.
- **Wandering is a goal** (a stroll of up to 6 tiles, or standing still for 4 ticks), cutting decisions from about 0.9 to about 0.16 per Folk per tick.

## 2026-09-20: F3 built: sparse patchy food

- **Patches from per-species noise**, cut to a coverage share with richness varying between edge and core; defaults berries 4%, roots 3%, hare 8%, deer 2%, a multiplier in the world panel and configuration.
- **Ecology rates made realistic and the step lengthened.** Rates are per 6-minute tick (days to weeks for plants, months for herds); the ecology steps every 10 ticks with each step covering 10 ticks, tested to match ten single steps within 1%. This is what makes slow recovery and overgrazing possible at all; the MVP's rates regrew plants in hours.
- **Viability threshold and no seeding**: a plant below 2% of capacity cannot regrow alone; emptied patches recover only from neighbours.
- **Sparse updates**: per-species lists of tiles and neighbouring pairs; a test proves the result equals a plain whole-map implementation of the same rules.
- **Animal food: separate is the default.** Measured over 30,000 ticks on three seeds and four coverage levels, shared-diet animals go extinct everywhere while separate ones thrive and give Folk 4 to 25 times as many hunts. The forage layer exists only under the animals to keep it small. Shared stays available (`ecology.separateAnimalFood: 0`).
- **Starting sparsity 1x** from the sweep (no deaths at 1x and 2x, marginal at 0.5x, famines at 0.25x). Overgrazing appears in animals; plants are barely dented by 20 Folk.
- **Known cost, deferred to F4:** sparse food makes each omniscient food search expensive (about 100 to 350 microseconds), which limits Folk counts until Folk use remembered patches. The search budget default stays at 90 ticks.

## 2026-09-20: F4 built: perception and memory

- **Sight ranges are per-species parameters** (the user's spec): how much of a plant is seen at 1 tile, an animal at 3, terrain at 10 (`perception.terrainRange`); `detectRange` 0 hides a species from a distance. Amounts are seen, not just presence.
- **Sightings merge into remembered places** (within 2 tiles, keeping the richer tile), refreshed when the Folk sees them again, forgotten when seen empty (never from afar) or after 60,000 ticks, with the longest unseen replaced when memory (32 places) is full.
- **Decisions read memory; only the chosen place is routed.** Walk estimates for remembered places are straight-line distance (no search); the chosen route uses A*, tested equal to an exhaustive search. This removed the food-search cost from F3 (about 100 to 350 microseconds a decision down to about 1.4).
- **Exploring and fog of war.** An explore option goes to the nearest unexplored or long unvisited 8-tile square; the explored map is the terrain sight; the selected Folk's knowledge is drawn as fog of war with rings on remembered places.
- **Home ground.** A new Folk knows 16 tiles around the settlement. A sweep showed Folk survive even with none, so it is a setting rather than a requirement.
- **Giving-up density and memory half-life are decider parameters**, so leaving a patch to recover, and how far to trust an old sighting of game, can be tuned or evolved. Utility now has 11 parameters and rules 6 (the array limit is 12).
- **Nothing is known that has not been seen.** Interrupts for a place running out fire only when the Folk can see it. "Something better was sighted" as an interrupt is left for later.
