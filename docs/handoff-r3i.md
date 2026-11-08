# Handoff: Tuner round 3i (state 2026-11-08: all 4 steps DONE)

Repos (both on `feat/tuner-r3i`, from `feat/tuner-r3h`):
- Editor fork: `/Users/asymilo/.kiro/crew/workspace-member-nfsu2/worktrees/nfsu2/NFSU2-Savegame-Editor-20735999` (push: `git push fork feat/tuner-r3i`; `origin` = the AUTHOR, never)
- Tuner tools: `/Users/asymilo/.kiro/crew/workspace-member-nfsu2/worktrees/nfsu2/nfsu2-tuner-ca22a9cd` (push: `git push origin feat/tuner-r3i`; read `AGENTS.md`)

## Result
1. Real drive, 3000GT, free roam, collision off, standing start, full throttle, road 1013 (straight about 700 m; 1000 m does not exist): every Tuner
   mode A setup is quicker than factory in every column (400 m -0.09 to -0.20 s, speed at 400 m +2.0 to +3.3 km/h, 0-200 km/h -0.36 to -0.60 s); two passes agree to <= 0.012 s.
   Table: tuner repo `docs/game-check-r3i.md` A; fork `docs/tuner-round3.md` 3i.
2. So no optimizer change. The gain on the road is smaller than the dyno's (0.11-0.65 of it), same direction. For Drag the dyno's pick is 0.016 s behind the Drift setup on the road.
3. Steering/Braking card text now = measured effect at 100/150/200 km/h (`src/model/feel.ts`, test in `feel.test.ts`), no "weaker at 200" warning. Speeds are not mapped to tabs (a guess).
4. `npm test` 153 pass, 0 skipped (with NFSU2_GLOBALB); `save.test.ts` (70) unchanged.

## Open for the owner
- Do they want the three speeds mapped to race tabs (needs a measure of typical speed per race; none exists)?
- A real Drag race (manual shifting, launch) was not driven; free roam is automatic gearbox, setup 0.
- Pushed: `feat/tuner-r3i` to `fork` (editor) and `origin` (tuner repo). No PR, nothing to dev/main.

## Tools (tuner repo `tools/native/r3i/`)
`gen_driveA.mjs` (factory + A_k profiles), `body_straight.py` + `straight_sweep.sh` + `straight_metrics.py` + `straight_table.py` (standing-start runs),
`dyno_numbers.mjs`, `circle_summary.py` (r3h `circle_sweep.sh` now takes `CIRCLE_TESTS`). Set `NFSU2_TUNER=<tuner repo>` before `roam.py`.
Runs (gitignored): `native/runs/r3i_*`, `r3h_d1_*`, `r3h_d2_*`, `r3h_d3_*`.
