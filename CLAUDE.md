# Hunter-Gatherer Ecology Simulation (foundation for a medieval economy)

A web-based, top-down tile game (minimalist, clear graphics on a large board). The near-term project is a **hunter-gatherer ecology simulation**: individual Folk with a single calorie reserve, sparse patchy food, real movement, and memory of where food was seen. The long-term goal is unchanged: interactively experiment with economic rules, policies and governance in a medieval setting to see what produces growth, stability or collapse, built on top of this foundation (storage, groups, trade, markets, currency, governance).

Development is iterative: build a small slice, playtest with the user, record feedback, update the roadmap, repeat. Do not build ahead of the roadmap.

## Status

The MVP (six milestones) is complete. The project has pivoted to a hunter-gatherer foundation, planned in `docs/foundation.md` as milestones F1 to F5 (calories and configuration, movement and goals, patchy food, perception and memory, tuning). `docs/design.md` describes the MVP build as it is now; where it disagrees with `docs/foundation.md`, the foundation is the direction. See also `docs/roadmap.md` and `docs/decisions.md`.

## Stack

TypeScript on Node 22, as a monorepo with npm workspaces:

- `packages/sim`: pure simulation library (no I/O, seeded, deterministic)
- `packages/server`: Node process that runs the sim, writes run logs, and streams deltas to the browser over WebSocket
- `packages/runlog`: run logger (manifest, events, snapshots) used by both the server and the CLI
- `packages/cli`: headless runner and benchmarks (same sim package)
- `web/`: Vite client with PixiJS/WebGL; viewer and command sender only
- data tables (terrain, later species, goods, actions) live in `packages/sim/src/data/`; world presets may move to `data/`
- `scripts/` and `notebooks/`: Python analysis of run folders (`summarize_run.py`, `analyze_run.py`, `analyze_run.ipynb`)
  Tooling: ESLint, Prettier, Vitest, tinybench, GitHub Actions on PRs. Runs locally in WSL; browser on Windows reaches it via localhost.

## Architecture rules

- The sim is pure TypeScript: no DOM, no I/O, no `Math.random` or `Date.now`. Timing is opt-in through an injected `timer`, and never affects simulation results. All randomness goes through a seeded RNG. Avoid `Math.exp`/`Math.pow` and similar where cross-engine determinism matters.
- Data-oriented storage: tiles and Folk as typed-array columns (structure-of-arrays), not per-object graphs, so hot kernels stay small and portable (worker threads, WebGPU, or Rust/WASM later if profiling demands).
- Fixed-timestep ticks. The client renders state and never mutates the sim. The server streams deltas filtered by viewport.
- Economic rules and world content (terrain, species, goods, actions, policies) are data-driven tables, not hard-coded.
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

- `npm install`: install all workspaces (also installs git hooks)
- `npm run dev`: sim server (ws://localhost:8787) and web client (http://localhost:5173)
- `npm run sim -- --seed 1 --ticks 1000`: headless run that writes a log to `experiments/output/<run-id>/`; options `--folk N`, `--size N`, `--regrowth X` (plant regrowth scale), `--deciders rules,utility`, `--snapshot-interval N`, `--metrics-interval N`, `--moves` (log every step), `--no-log`
- `npm run bench -- --folk 20,100,500,2000 --deciders rules,utility,mixed --size 256 --ticks 300`: benchmark; prints ticks/s, ms per tick split into ecology and Folk, decisions per tick and decision-time percentiles, and saves JSON to `experiments/output/`
- `python3 scripts/summarize_run.py [run_dir]`: quick text summary of a run (standard library only; defaults to the newest)
- `python3 scripts/analyze_run.py [run_dir]`: pandas and matplotlib analysis; prints the key tables and writes plots to `<run>/analysis/`. `notebooks/analyze_run.ipynb` is the same analysis for Jupyter. Needs `pip install pandas matplotlib`.
- `PORT=8799 npm run start -w @folk/server` and `VITE_SERVER_PORT=8799 npx vite --port 5199` (in `web/`): run on other ports, e.g. beside a dev session. Stop test processes by PID, never by port, since the user may be running `npm run dev`.
- `npm test`: Vitest; `npm run test:watch` for watch mode
- `npm run lint`, `npm run format`, `npm run typecheck`
- `npm run check`: lint, format check, typecheck and tests (what CI runs)
- Git hooks: pre-commit runs lint-staged and typecheck; pre-push runs tests.

## Skills (in `.claude/skills/`)

- `playtest-feedback`: turn playtest impressions into roadmap changes
- `run-experiment`: run the headless sim with a policy and seed, summarize metrics
- `add-policy`: checklist for adding an economic rule end to end
- `roadmap-update`: revise the roadmap and record why
