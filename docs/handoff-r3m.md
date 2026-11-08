# Handoff r3m (2026-11-09)

Branches `feat/tuner-r3m` in both repos (tools: last commit with section 2 of `docs/game-check-r3m.md`; fork: from `feat/tuner-r3l`). No PR. No UI code changed.
Done:
- Sweep inventory: pass a 50/50, pass b 50/50 jobs finished (7 tests each); only the crest test is invalid (25 windows, game reset after the landing). No game was run in this finish.
- Results: tools `docs/game-check-r3m.md` section 2, `docs/game-check-r3m-table.md`; owner-facing text: `docs/handling-design-r3l.md` section 3m.
- `tools/native/r3m/table.py` now compares sizes for right turns (signed heading made "turned deg" look wrong); `--pct` "largest" skips crest and settle time.
Findings: shocks and ride heights < 5 % everywhere (<= 3.4 %); every other row > 5 % in at least one test; stable set -31..-36 % rear slip in steady turns (mostly additive) but turn rate -6..-11 % (-15 % when braking into a turn).
Not done / next:
- UI: the "Tył w zakręcie" control (design in `handling-design-r3l.md`), card text with slip AND turn-rate cost; Optimize default per tab.
- Second car and presets (Drift, Street X, Drag) are stage 3n; lap time is not measured; crest test unusable (landing too sensitive); per-wheel slip not read (rear-axle centre used).
- Untracked r3k files in the tools repo (`tools/native/r3k/`, edits to `tools/native/r3g/roam.py`, `roam_probe.txt`) are not committed by r3m.
