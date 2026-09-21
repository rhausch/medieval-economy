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

**Speed and terrain (as built in F2):** Folk walk at one speed. Terrain scales it (defaults: sand 0.8, grass 1.0, forest 0.7, hills 0.6 tiles per tick) and slope divides it further: a grade g (rise over run, from the elevation we already have, with elevation 0 to 1 spanning 1,500 m) divides speed by 1 + 4g. Because a Folk burns calories every tick it is walking, slower ground costs more per tile automatically (forest is about 1.4 times, hills about 1.7 times), and climbing adds 0.65 kcal per metre on top. Water and mountains stay impassable. **Gaits (jog, run) are deferred:** we are not yet convinced they would add anything to the simulation; the exception would be a chase, which can be revisited with big-game hunting.

**Routes** are chosen by walking time, not tile count (a Dijkstra search), so the nearest food is the one that takes least time to reach and a Folk goes around slow ground when that is quicker.

**Interrupts** are decided by each decider (`shouldInterrupt`), asked between steps: would you rather reconsider now? Rules Folk say yes when carrying food below their own eating level; utility Folk when in the emergency zone with food. An interrupt therefore always leads to a different decision (a meal), which is tested. A goal is also dropped when the place it was heading for runs out. A cooldown stops loops. "Something better was sighted" comes with perception in F4.

## Perception and the blackboard

Built in F4. Each Folk has a private blackboard; shared boards come with groups.

- **Sight (all per-species settings):** how much of a species a tile holds is seen out to that species' `detectRange`: **plants 1 tile, animals 3 tiles** by default, and 0 means it cannot be seen from a distance. The lie of the land is seen out to `perception.terrainRange`, **10 tiles**. The ranges are parameters so they can be played with; nothing is known about places a Folk has never been near.
- **Sightings (remembered places):** each Folk remembers up to 32 places: a species, the richest tile seen there, how much was there, and when it was last seen. Sightings of one species within 2 tiles merge into one place; the least recently seen place is replaced when memory is full; a place is forgotten when the Folk sees it has run out (a Folk far away cannot tell) or after 60,000 ticks unseen. The Folk looks around after every step and every action, so its own harvesting updates what it remembers.
- **Explored map:** a grid of 8-tile squares recording the tick each was last in sight (terrain range). It drives exploring and is shown as fog of war.
- **Home ground:** a new Folk already knows the ground within 16 tiles of the settlement, nearest patches first (a setting; the sweep shows Folk survive even at 0).
- **Goal and path** as in F2. Interrupts now also include "the place ran out", noticed only when the Folk can see it.
- **Decisions use memory, not a search of the map.** Deciders read the remembered places with an estimated walk (straight-line distance, no search) and how old each sighting is; only the chosen place gets a route (A*, checked equal to an exhaustive search). Rules go to the nearest place they still trust; utility scores each place on net calories, trusting old sightings of animals less (a decider parameter, the memory half-life).
- **Exploring** is an option: walk to a nearby unexplored square, or one not seen for 3,000 ticks. Rules explore when nothing remembered is worth going to; utility scores it on how much nearby ground is unexplored, plus the survival bonus when it knows no food.
- **Giving-up density** is a decider parameter (how many kg of a plant a Folk leaves before it moves on). Taking everything wins now but can wreck the patch; leaving some lets it recover. Rules and utility each have one, so a genetic algorithm can find what pays.
- The inspector shows the selected Folk's memory (places with ages), its explored share, and draws its fog of war and remembered places on the map.

## Patchy food and overgrazing

Food is sparse and clumped. Built in F3:

- Each species has its own noise field, cut at the level that makes it cover its `coverage` share of the tiles it could live on at all, in clumps of `patchScale` tiles, with richness varying between a patch's edge and its core (`patchRichness`). Terrain and moisture still decide where a species can live. Defaults: berries 4% (scale 5), roots 3% (6), hare 8% (10), deer 2% (24). A `coverageScale` multiplier raises or lowers all of them.
- Outside its patches a species holds nothing.
- **Realistic rates.** The MVP's regrowth rates were per fast tick, so plants regrew in hours. They are now per 6-minute tick and slow: a berry patch takes days to weeks to regrow (0.0006 per tick), roots longer (0.0002), hare and deer months. The ecology runs every 10 ticks with each step covering 10 ticks.
- **Viability and no seeding.** A plant below 2% of a tile's capacity cannot grow on its own, and there is no spontaneous seeding, so a patch grazed to nothing recovers only from neighbouring stock and, if every tile in it is below the threshold, not at all. Stock spreads between neighbouring tiles of the same patch only.
- **Giving-up density** (how much a Folk leaves behind) is a decider parameter, built in F4.
- **Animal food, the experiment: separate wins.** With `ecology.separateAnimalFood` 0, hare and deer eat the berries and roots Folk gather; with 1 they graze a grass-and-browse layer that exists only under the animals. Over 30,000 ticks on three seeds, shared animals went extinct in every setting (98 to 100% of their patch tiles emptied, 168 to 510 hunts) while separate animals thrived (1,205 to 4,106 hunts), so separate is the default. Both modes stay available.
- **Performance:** only tiles a species lives on are updated. At 256x256 the whole simulation went from 273 to about 2,600 ticks per second; at 1024x1024 the ecology went from 60 ms to about 5 ms per tick.

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

## F2 as built

- **Blackboard goal:** the goal (what, where, when chosen, and the path with how far along) lives on the Folk and is shown in the inspector, with the path and target drawn on the map for the selected Folk. A Folk decides only when it has no goal, when it arrives, or when interrupted. Decisions fell from about 0.9 to about 0.16 per Folk per tick.
- **Wandering is a goal:** a Folk with nothing to do strolls to a random spot within 6 tiles as a short goal, or stands still for 4 ticks, instead of taking one random step per decision.
- **Fractional steps:** a step over slow ground takes a fractional number of ticks, and the fraction carries into the next action, so average speed is exact (tested) instead of rounded up.
- **Search:** one walking-time search per decision finds, for every foraging option, the quickest place, the ticks to get there and the calories it costs; utility scores use those directly.
- **Tracking:** walking by terrain (steps, ticks per step, calories per step) in `travel.csv`, the Stats panel and the analysis; goals and interrupts per Folk in `lifetimes.csv`; interrupt events always logged, goal events with `--goals`.
- **Observed:** on the dense-food world about 70% of steps are through forest (1.5 to 1.6 ticks per step and about 37 kcal per step) against 1.1 ticks and 26 kcal on grass; time spent moving fell from about 45% to about 30% and idle time from 30% to under 10%.

## F3 as built

- **Sustainability sweep** (30,000 ticks, seeds 1 to 3, both animal-food modes, coverage 0.25x to 2x): at 1x and 2x nobody died in any run and late reserves were about 55 to 57%; at 0.5x nobody died either but reserves dipped as low as 16%; at 0.25x there were deaths, one seed with a famine of 186 deaths. **The default is therefore 1x (berries 4%, roots 3%, hare 8%, deer 2%)**, sparse but sustainable, and it can be raised from the world panel.
- **Overgrazing is real but shows up in the animals, not the plants.** At 0.5x coverage 37% of hare patch tiles and 16% of deer patch tiles were emptied by hunting; berry and root patches stayed at 97 to 99% of capacity even after 30,000 ticks, because 20 Folk eat far less than regrows. Plant overgrazing needs more Folk, a poorer world, or slower regrowth (`plantRegrowthScale`).
- **The omniscient food search cost real time (fixed in F4).** With food sparse, the nearest of every food type can be far, so each decision's walking-time search explores a large area: 100 to 350 microseconds per decision instead of about 1. That is fine at 20 Folk (about 640 ticks per second) but at 2,000 Folk the Folk phase is about 75 ms per tick. Shrinking the search budget helps only in proportion. F4 fixes it: Folk consult remembered patches instead of searching the map.
- **Patch reporting:** each snapshot records how many patch tiles each species has and how many are emptied (below 5% of capacity), per terrain (`terrain_resources.csv`), in the Stats panel and in the analysis (`patches`).

## F4 as built

- **Survival with perception** (30,000 ticks, three seeds, separate animal food): at 1x coverage 0 to 1 deaths, late reserve 57%, about 12,900 gathers and 3,900 hunts, against about 14,000 and 3,600 for omniscient Folk; each Folk sees about 22 to 26% of the map and sets about 24 explore goals. At 0.5x coverage 1 to 2 deaths, at 0.25x 2 to 13. Folk born knowing nothing (home radius 0) also lived at 1x with 0 deaths, so home ground is a convenience, not a crutch.
- **Speed:** decisions cost about 1.4 microseconds (they were 100 to 350 with the map search) and the Folk phase about 2 to 4 microseconds per Folk per tick. At 256x256 with 2,000 Folk the run goes at 144 ticks per second (13 before); 5,000 Folk at 55.
- **What Folk know** (memory size and age, share of the map seen) is logged per Folk snapshot, in the Stats panel and in the analysis; discoveries and explore goals are per-Folk counters.

## Solo as built

Folk spawn alone at random places on the main landmass (the largest connected walkable region), each knowing only its own surroundings. `folk.replaceDead: 0` turns off replacement so a run measures how long each Folk survives. Try it: `npm run sim -- --folk 100 --ticks 30000 --no-replace --coverage 0.25`, then `python3 scripts/analyze_run.py` (survival section). Results are in `decisions.md`.
