# Medieval Economy Simulation

A web-based, top-down tile game (minimalist, clear graphics on a large board) for interactively experimenting with economic rules, policies and governance in a medieval setting, to see what produces growth, stability or collapse. Starts with simple Folk (foraging, hunting) and grows toward planning, groups, trade, markets, currency and governance.

Development is iterative: build a small slice, playtest with the user, record feedback, update the roadmap, repeat. Do not build ahead of the roadmap.

## Status
Phase 1 (interactive design session) is complete. Phase 2 (MVP) has six milestones; see `docs/roadmap.md`. See `docs/roadmap.md`, `docs/design.md`, `docs/decisions.md`.

## Stack
TypeScript on Node 22, as a monorepo with npm workspaces:
- `packages/sim`: pure simulation library (no I/O, seeded, deterministic)
- `packages/server`: Node process that runs the sim, writes run logs, and streams deltas to the browser over WebSocket
- `packages/cli`: headless runner and benchmarks (same sim package)
- `web/`: Vite client with PixiJS/WebGL; viewer and command sender only
- `data/`: actions, goods, world presets (data-driven)
- `scripts/`: Python analysis scripts
Tooling: ESLint, Prettier, Vitest, tinybench, GitHub Actions on PRs. Runs locally in WSL; browser on Windows reaches it via localhost.

## Architecture rules
- The sim is pure TypeScript: no DOM, no I/O, no `Math.random` or `Date.now`. All randomness goes through a seeded RNG. Avoid `Math.exp`/`Math.pow` and similar where cross-engine determinism matters.
- Data-oriented storage: tiles and Folk as typed-array columns (structure-of-arrays), not per-object graphs, so hot kernels stay small and portable (worker threads, WebGPU, or Rust/WASM later if profiling demands).
- Fixed-timestep ticks. The client renders state and never mutates the sim. The server streams deltas filtered by viewport.
- Economic rules (goods, actions, policies) are data-driven in `data/`.
- Goods are conserved: produced, consumed, decayed, or traded, never created from nothing. Tests assert this.
- Decision making is swappable behind `decide(senses, actions, blackboard) -> Intent`; every call is timed and logged. Design for stronger planners and group behaviour: decision cost is expected to dominate.
- Design for extension: new goods, policies and behaviours are additions, not rewrites.

## Development workflow
- **Branching:** trunk-based. `main` is protected and always working. Do all work on short-lived branches named `type/short-description` (`feat/`, `fix/`, `refactor/`, `docs/`, `chore/`, `test/`). Never commit directly to `main`.
- **Commits:** Conventional Commits (`feat: add hunger need`, `fix(sim): ...`). Small, focused, frequent. Explain why in the body when it is not obvious.
- **Pull requests:** open a PR per branch with `gh pr create`, keep it small, squash-merge to `main`, delete the branch. The user approves in chat (based on a summary of changes or a playtest), never on GitHub: present the summary, wait for chat approval, then merge.
- **Before every commit:** lint, typecheck and tests must pass (once tooling exists). Do not commit failing code or skip hooks.
- **Style:** the formatter and linter config are the source of truth (Prettier + ESLint, TypeScript strict mode). Small pure functions, explicit types at module boundaries, no dead code or speculative abstractions. Match surrounding code.
- **Testing:** every sim rule gets unit tests. Determinism (same seed gives same result) and conservation tests are required for economy changes.
- **Docs:** record design choices in `docs/decisions.md` (date, decision, why, alternatives). Update `docs/roadmap.md` after each playtest.

## Commands
Not yet defined. Fill in once the project is scaffolded (dev, build, test, lint, headless run, benchmark).

## Skills (in `.claude/skills/`)
- `playtest-feedback`: turn playtest impressions into roadmap changes
- `run-experiment`: run the headless sim with a policy and seed, summarize metrics
- `add-policy`: checklist for adding an economic rule end to end
- `roadmap-update`: revise the roadmap and record why
