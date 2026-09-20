# Medieval Economy Simulation

A web-based, top-down tile game (minimalist, clear graphics on a large board) for interactively experimenting with economic rules, policies and governance in a medieval setting, to see what produces growth, stability or collapse. Starts with simple agents (farming, hunting, gathering) and grows toward trade, markets, currency, and governance structures.

Development is iterative: build a small slice, playtest with the user, record feedback, update the roadmap, repeat. Do not build ahead of the roadmap.

## Status
Phase 0 (setup) -> Phase 1 (interactive design session) -> Phase 2 (MVP). See `docs/roadmap.md`. The stack below is provisional and will be revisited after the design session.

## Provisional stack
TypeScript, Vite, Canvas 2D rendering, Vitest. No framework for the sim core.

## Architecture rules
- The simulation (`src/sim/`) is pure TypeScript: no DOM, no rendering imports, no `Math.random` or `Date.now`. It runs in the browser and headless in Node.
- All randomness goes through a seeded RNG so runs are reproducible.
- Fixed-timestep ticks. Rendering interpolates and never mutates sim state.
- Economic rules (goods, recipes, jobs, policies) are data-driven in `src/data/`, so changing a rule does not mean rewriting code.
- Goods are conserved: produced, consumed, decayed, or traded, never created from nothing. Tests should assert this.
- Design for extension: new goods, policies and agent behaviours should be additions, not rewrites. See `docs/design.md` for the planned extension points.

## Development workflow
- **Branching:** trunk-based. `main` is always working. Do all work on short-lived branches named `type/short-description` (`feat/`, `fix/`, `refactor/`, `docs/`, `chore/`, `test/`). Never commit directly to `main` after the initial commit.
- **Commits:** Conventional Commits (`feat: add hunger need`, `fix(sim): ...`). Small, focused, frequent commits. Explain why in the body when it is not obvious.
- **Pull requests:** open a PR per branch with `gh pr create`, keep it small, squash-merge to `main`, delete the branch. The user approves in chat (based on a summary of changes or a playtest), never on GitHub: present the summary, wait for chat approval, then merge.
- **Before every commit:** lint, typecheck and tests must pass (once tooling exists). Do not commit failing code or skip hooks.
- **Style:** the formatter and linter config are the source of truth (Prettier + ESLint with TypeScript strict mode, once installed). Prefer small pure functions, explicit types at module boundaries, and no dead code or speculative abstractions. Match surrounding code.
- **Testing:** every sim rule gets unit tests. Determinism (same seed gives same result) and conservation tests are required for economy changes. Headless experiment runs live in `scripts/`.
- **Docs:** record design choices in `docs/decisions.md` (date, decision, why, alternatives). Update `docs/roadmap.md` after each playtest.

## Commands
Not yet defined. Fill in once the project is scaffolded (dev, build, test, lint, headless run).

## Skills (in `.claude/skills/`)
- `playtest-feedback`: turn playtest impressions into roadmap changes
- `run-experiment`: run the headless sim with a policy and seed, summarize metrics
- `add-policy`: checklist for adding an economic rule end to end
- `roadmap-update`: revise the roadmap and record why
