# Handoff r3l (2026-11-08)

Branches `feat/tuner-r3l` in both repos (tools: from `feat/tuner-r3k` = r3i). No PR. No UI code changed.
Done:
- Steps 1-2: transient tests built and run (tools `tools/native/r3l/`), owner's Tuner result save (`gen_owner.mjs`), sweep pass a 30/30 valid.
  Results: tools `docs/game-check-r3l.md` sections 0-2, `docs/game-check-r3l-table.md`.
- Step 3: per-tab default proposal (section 3), player-practice links; only setup 0 physics measured.
- Step 4: this repo `docs/handling-design-r3l.md` (3 controls, one new: "Tył w zakręcie").
Not done / next:
- Pass b of the sweep was still running at handoff (`native/runs/r3l_sweep/b_*.json`); re-run `trans_table.py` and recommit the table when it is done.
  Command (tools root): `tools/native/r3l/trans_sweep.sh native/runs/rows_3000gt_s0.json native/runs/r3l_profiles/owner_tuned.bin native/runs/r3l_sweep` (skips finished runs).
- Combined stable set in one game; middle positions; 100/200 km/h hold; presets (Quick Race per tab); second car.
- Untracked r3k files in the tools repo (`tools/native/r3k/`, edits to `tools/native/r3g/roam.py` and `roam_probe.txt`) belong to the unfinished r3k run: not committed by r3l. r3l uses that roam.py (its PRE/POST are empty by default).
