# Foundation: the hunter-gatherer ecology simulation

Status: planned. This replaces the MVP's satiety, energy and health stats and its dense food with a calorie economy, sparse patchy food, real movement and a memory of where food was seen. It is the base that trade, storage, groups and governance will be built on. The MVP build is described in `docs/design.md`; where the two disagree, this document is the direction.

## Why change

Measured on the MVP build (see `docs/decisions.md`, "Findings to tune from"):

- Hunger drains at a fixed rate, so effort never costs food. Energy barely binds and health only matters when starving. Three stats do the work of one.
- Every forest tile has food, so the nearest food is always a step away. Folk spend about 45% of their time moving and 30% idle, and 86% of their energy goes on walking, yet they never go hungry. Search, patches and travel do not matter.
- Animals eat the berries and roots that Folk gather, which strips grassland and hills to about 1% of capacity and leaves only forest.
- Folk see the whole map within 60 tiles, so sparse food would not force any searching.
- Most decisions are one-tick wanders.

## Units

| Quantity | Unit             | Notes                                                                   |
| -------- | ---------------- | ----------------------------------------------------------------------- |
| Time     | tick = 6 minutes | a day is 240 ticks, a year 87,600                                       |
| Length   | tile = 360 m     | walking at 1 m/s crosses one tile in one tick                           |
| Mass     | kg               | plant stock per tile in kg, animals in heads with an edible kg per head |
| Energy   | kcal             | one reserve per Folk                                                    |

A 256 by 256 world is about 92 km across. All of these are defaults in the run configuration (below), not constants.

## One currency: calories

Each Folk has a single stat, its **calorie reserve** in kcal, replacing satiety, energy and health.

- **Metabolism:** a baseline burn every tick (default 1,900 kcal a day, about 7.9 kcal per tick, which is 1 MET). Every activity adds a cost above that baseline. Resting burns slightly less.
- **Food:** every food is a mass with an energy density (kcal per kg). Eating adds to the reserve up to a cap and is limited to a maximum intake per tick, so meals take time and a full Folk cannot eat more.
- **Death:** the reserve reaching zero. A Folk that dies is replaced (fresh decider parameters, same decider) until births exist.
- **Injury** stays a status, not a stat. It still multiplies walking and action durations (minor 2 times, serious 10 times) and heals over time, and now healing burns extra calories every tick while it lasts. A serious injury is therefore a slow starvation risk because the Folk forages badly. An optional small chance of death from a serious injury is a config value, default 0.
- **Fatigue (stamina) is dropped** for now. It only earns its place once there is a day and night cycle to sleep through. Rest remains as a low-burn option that speeds healing.
- Placeholder defaults, all adjustable per run: reserve capacity 15,000 kcal (about 8 days at baseline, about 3 days at working pace), start at 60%, maximum intake 300 kcal per tick.

### Activities

Each activity has a duration and a calorie cost per tick above baseline. Real-world anchors (1 MET is about 7.9 kcal per tick):

| Activity           | About         | Cost above baseline per tick | Notes                      |
| ------------------ | ------------- | ---------------------------- | -------------------------- |
| Rest               | 0.9 MET       | slightly below baseline      | speeds healing             |
| Stand or idle      | 1.3 MET       | 2                            |                            |
| Eat                | 1.5 MET       | 4                            | limited by intake per tick |
| Walk               | 3.5 MET       | about 20 per tile            | see movement below         |
| Gather berries     | 3 MET         | about 16                     |                            |
| Set a snare        | 3 MET         | about 16                     |                            |
| Dig roots and nuts | 5.5 MET       | about 36                     |                            |
| Chase              | 12 MET and up | about 87                     | spiky, and injury risk     |
| Healing            |               | 6 (minor), 20 (serious)      | while injured              |

Food energy densities (kcal per kg, edible): berries about 500, roots and nuts about 1,200, hare and deer meat about 1,500; a hare is about 1.5 kg edible, a deer about 45 kg. The targets are the ratios real foragers see: berries and roots return about 3 to 4 times what they cost, snaring hare more but only when a warren is found, and deer a similar average with a heavy tail (a kill is worth thousands of kcal, a miss costs an hour and may injure). Exact yields are set in the configuration and tuned in F5.

The Folk that balances these costs is doing optimal foraging: leave a patch when the marginal return drops below the cost of travelling to the next one. The utility decider is rebuilt around that: expected net kcal per tick, discounted by risk and by how stale its knowledge is.

## Movement

**Answer to "multi-tick action or a goal in the blackboard": both, in layers.** The goal lives in the blackboard; walking is executed one step at a time.

- The **goal** (what and where, why, when it was chosen) is stored on the blackboard, so it can be inspected, dropped, replaced and later shared or handed to a planner.
- Each **step** is a small action whose duration and calorie cost depend on the terrain and slope under the Folk, its gait and any injury. Steps are cheap and need no decision.
- The decider only runs again when the goal is reached or becomes invalid (the food is gone), or an **interrupt** fires: the reserve crosses a threshold, something better is sighted, or the path is blocked. This is what keeps decisions few and cheap.
- One giant multi-tick "walk there" action was rejected: it cannot be interrupted, cannot adapt its cost to terrain, and hides the goal from the inspector.

**Gaits and speed:** walking is 1 m/s (1 tile per tick in the open), a jog about 2.5 m/s and a run about 4 m/s. A Folk covers several tiles in a tick at speed, accumulating fractional progress. Faster gaits cost more per tile; a chase is the sprint. Terrain scales speed (defaults: sand 0.8, grass 1.0, forest 0.7, hills 0.6) and calorie cost (forest 1.3, hills 1.4), and slope adds cost and slows using the elevation we already have (the elevation range in metres is a config value, default 1,500 m). Water and mountains stay impassable for now.

## Perception and the blackboard

Each Folk has a private blackboard (shared boards come with groups):

- **Sightings:** where it saw food, of which species, how much, and when. Entries near each other for the same species merge into one patch entry (the richest tile), and a Folk's own harvesting updates its entry. A fixed number of entries is kept; the least valuable, oldest is evicted. Deciders read them as options with an **age**: how long ago it was seen, so stale knowledge is discounted (a decider parameter sets how fast).
- **Explored map:** a coarse grid recording when each area was last visited, used to pick where to scout.
- **Goal:** the current goal and its path (above).
- **Camp:** where the settlement is, to return to.
- The whole blackboard is shown in the inspector, with the goal and path drawn on the map.

**Perception:** Folk see a radius around them each step, and different things are seen from different distances (defaults: plants 1 tile, animals 3 tiles, less in forest). Anything with stock worth working updates the sightings. This replaces the 60-tile omniscient search; the shared breadth-first search stays as the pathfinder, but only toward known places.

**Exploration** is an option like any other: walk toward the stalest or unexplored area nearby. It is chosen when known food is scarce, far or stale, and it is the price of finding new patches.

## Patchy food and overgrazing

Food is sparse and clumped.

- Each species has its own noise field, thresholded so it occupies only a **coverage** fraction of its habitable tiles, in clumps of a chosen **patch scale**, with variable richness inside a patch. Defaults start sparse: berries about 4% of habitable tiles in small thickets, roots about 3%, hare warrens about 8%, deer ranges about 2% in large areas. Raise coverage if the world is unsustainable.
- Tiles outside a patch hold none of that species. Terrain and moisture still decide where a species can live at all.
- **Slow recovery:** regrowth is logistic inside a patch and there is no spontaneous seeding, so a patch picked or grazed to nothing recovers only from neighbouring stock, and below a viability threshold not at all. Overgrazing, by animals and by Folk, is now possible and permanent.
- **Giving-up density:** how much a Folk leaves behind before it moves on is a decider parameter. Taking everything wins today and can wreck the patch; leaving seed stock lets it recover. This is the seed of the commons problems later governance experiments need.
- **Animal food, an experiment:** animals could graze their own base forage (grass and browse) instead of the berries and roots Folk gather. We are unsure this is needed, so it is a per-run switch (`animalFood: shared | separate`, default shared) and we will compare the two in F5.
- **Performance:** the ecology only visits tiles that can hold a species (the patches), which should cut the update on a 1M tile world from about 60 ms to a small fraction.

## Deciders

Options: eat, forage (best known or sighted patch), explore, rest, camp. Both frameworks stay, each with a parameter array (genome) that is randomised per Folk and logged, ready for a genetic algorithm:

- **Rules** (baseline): eat below a reserve threshold, go to the nearest remembered patch that is not too stale, scout if none, rest when injured.
- **Utility:** net kcal per tick for each known patch (expected gain minus walking and working cost and risk, over travel and work time), discounted by staleness, plus an exploration drive that rises as known food runs out.
- Parameters to expect: eat threshold, reserve wanted, risk aversion, staleness half-life, exploration drive, giving-up density, gait preference.

## Run configuration

Everything in the tables above lives in a configuration file, adjustable between runs (not during a run): units, body, activities, gaits and terrain speeds, goods and their energy densities, species (coverage, patch scale, regrowth, density), perception radii, decider parameter ranges, world generation and run settings. `configs/default.json` holds the defaults; `--config path` (CLI) or `CONFIG` (server) overrides them. The resolved configuration and a hash of it are written to the run manifest, so every run is reproducible. It is validated on load with clear errors, and the default file is tested to load and to match the built-in defaults.

## Tracking

The existing counters carry over, and the energy story becomes an **energy ledger**: kcal in (eaten) and kcal out by category (baseline, each gait, each activity, healing), per decider and per Folk, with a test that a Folk's reserve change equals kcal eaten minus kcal spent. The Stats panel and the analysis show calories in place of satiety, energy and health, plus patch and memory measures (patches known, average knowledge age, area explored, patches emptied).

## Milestones

Each ends in something to play with, followed by feedback.

1. **F1: calories and configuration.** One calorie reserve, metabolism, activity and injury calorie costs, kg and kcal units, per-run configuration and manifest, the energy ledger. Same world, dense food, so behaviour can be compared with the MVP.
2. **F2: movement and goals.** Gaits, terrain and slope speed and cost, walking as goal following with the goal on the blackboard, interrupts, the path shown in the inspector.
3. **F3: patchy food.** Patch generation with coverage and scale, slow recovery, viability threshold, the animal food switch, active-tile ecology updates and a benchmark showing the speed-up, world panel controls, and a sustainability sweep to pick the starting sparsity.
4. **F4: perception and memory.** Sight radii, blackboard sightings with age, the explored grid, the explore option, deciders using it, giving-up density, the memory in the inspector.
5. **F5: tune and evaluate.** Sweeps across seeds, rules versus utility, shared versus separate animal food, and a decision on a first genetic algorithm run over the parameter arrays; then back to the wider roadmap.

## F1 as built

- **One reserve:** `reserve` (kcal) replaces satiety, energy and health. Each tick a Folk burns the baseline plus the cost of what it is doing plus healing; eating is capped by room in the reserve and by intake per tick, so a meal of 1,500 kcal takes 5 ticks. Death is reserve at or below zero (or, if configured, a chance per tick at a serious injury). Energy is conserved and tested: a Folk's reserve changes by exactly what it ate minus what it burned.
- **Units:** plants are kg per tile (capacities unchanged at 100 kg berries and 150 kg roots at best, so the ecology balance is the same), animals are heads with a fixed edible kg per kill, goods are berries, roots and meat with energy densities of 500, 1,200 and 1,500 kcal per kg. The inventory is in kg with a 20 kg limit, so a 45 kg deer kill is truncated to what can be carried.
- **Configuration:** `Settings` holds every number; `configs/default.json` is generated from it and `--config` or `CONFIG` load a file over the defaults, with strict validation. The manifest records the resolved settings and a hash. Which goods, actions, species, deciders and terrains exist is still fixed by the code; the configuration changes their numbers.
- **Energy ledger:** calories eaten, and calories burned as baseline, healing and per activity, per decider (`ledger.csv`, `activity.csv`), and per Folk (`lifetimes.csv`); shown in the Stats panel and analysis.
- **Deciders reworked:** rules eat below a reserve share, rest when hurt, restock a food target in kcal, and never chase big game while starving. Utility scores net kcal per tick (soft-saturated), a food motive that falls to almost nothing once enough is carried, effort, risk and distance, with two guarantees that no personality can switch off: an emergency term so eating beats anything when the reserve is low, and a survival bonus so a hungry Folk short of food always forages. Both were found by tracing Folk that starved with food in their pocket or wandered until they died, and are covered by tests.
- **Dense-food baseline (what F3 will change):** with food everywhere, Folk sit at about 45 to 70% reserve with no deaths. Walking is the biggest calorie cost, and utility Folk take almost all their food from snaring hare, since a hare is worth about 1,100 kcal expected per attempt against about 300 for a handful of berries.
