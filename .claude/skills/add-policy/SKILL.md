---
name: add-policy
description: Checklist for adding a new economic policy or rule end to end. Use when adding a governance or economic lever.
---

1. Define the policy in `src/data/` (id, parameters, defaults, description).
2. Add the sim hook in `src/sim/` (pure, seeded, conserves goods).
3. Add the UI control and any metric it should influence.
4. Add tests: effect on the intended metric, determinism, conservation.
5. Add a headless experiment comparing on vs. off.
6. Add an entry to `docs/decisions.md` and update the roadmap.
