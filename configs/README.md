# Run configurations

A configuration is a JSON file that changes any of the numbers a run uses: the body (metabolism, reserve,
intake), activity and injury costs, action yields and durations, food energy densities, species (capacity,
growth, diffusion, habitat), decider parameter ranges, perception, ecology and world generation. It is chosen
when a run starts and cannot change during it. Include only what you want to change; everything else keeps its
default.

```
npm run sim -- --config configs/hard-times.json --seed 2 --ticks 4000
CONFIG=configs/hard-times.json npm run dev
```

- `default.json` lists every setting with its default value. It is generated: run `npm run config:default` after
  changing a default in the code (a test fails if they disagree). Use it as a reference; you never need to pass it.
- `wide-params.json` widens every decider parameter range (used by the overnight genetic algorithm batch, where the range is the search space: `npm run evolve -- --config configs/wide-params.json`).
- `hard-times.json` is a small example (a hungrier body, slower plant regrowth).
- Collections (`goods`, `actions`, `species`, `deciders`) are keyed by name, for example
  `{ "actions": { "chase": { "kcalPerTick": 100 } } }`. Which goods, actions, species, deciders and terrains exist
  is fixed by the code for now; the configuration changes their numbers.
- Mistakes are reported with the path of the problem, for example
  `configs/x.json: unknown setting body.reserveCapacty`.
- Every run records the full resolved settings and a fingerprint of them in `manifest.json`, so any run can be
  reproduced by writing its `settings` back to a file.
- Units: a tick is 6 minutes, a tile is 360 m, mass is kg, energy is kcal.
- Perception is configured in `perception` (terrain range, memory slots, home ground) and by each species' `detectRange` (for example `{ "species": { "deer": { "detectRange": 5 } } }` lets Folk see deer from five tiles away).
