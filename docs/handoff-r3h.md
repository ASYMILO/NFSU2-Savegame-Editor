# Handoff: Tuner round 3h (state 2026-11-08 ~14:30: stage "mph, save-as-keys check, speed, roll" DONE)

Done this stage: mph toggle committed (`1d9d29b`, 152 tests pass); mode A into save = game dyno 5/5 (tuner repo `docs/game-check-r3h.md` A); downforce/grip vs speed: code + 60 collision-off runs (B, C); body roll measured, no slider (D). Section 3h of `docs/tuner-round3.md` written. Nothing left from the 4 steps. Open: owner decides whether Steering/Braking text mentions "weaker at 200 km/h". Push of `feat/tuner-r3h` to origin was blocked by the permission classifier: needs the owner/user to allow it.

(Older state below.)

Previous worker: chat-185-1794086838, last turn 2026-11-08 00:23 (stopped: Kiro credits ran out). Now on Claude Code (Claude Pro, 5 h limit).

## Repos (both on branch `feat/tuner-r3h`, from r3g)
- Editor fork: `/Users/asymilo/.kiro/crew/workspace-member-nfsu2/worktrees/nfsu2/NFSU2-Savegame-Editor-20735999`
- Tuner tools: `/Users/asymilo/.kiro/crew/workspace-member-nfsu2/worktrees/nfsu2/nfsu2-tuner-ca22a9cd` (read its `AGENTS.md` first)

## Done (committed in the fork)
- `7927d46` fair-play wording, best vs keys in numbers, Download also for "same as the keys" (+test, 5 tabs 3000GT), author's cheat limits / older auto-tune say they are outside the game's limits.
- `c394883` each game screen is its own framed block with its sliders inside; empty screens = one line "Nothing to change" + why.

## Uncommitted in the fork (check, test, commit)
- mph/km/h toggle: `index.html`, `browser-store.ts` (prefs.units), `legal-opt.ts` (`topMph`, FUN_0054a970 cite), `tuner.ts` (`gapWords(diff, unit)`), `tuner-controller.ts`, `editor-scope.ts`, `app.css`, `tuner.test.ts`.

## Started, not finished (nfsu2-tuner, untracked `tools/native/r3h/`)
- `body_circle.py`, `circle_metrics.py`, `circle_sweep.sh`: driving rows with the car's collision body off (car+0x3C, +0x17; roam_game.c l.977-984), tests: steer at 100/150/200 km/h, brake from 200.
- `probe_nocol.txt`: probe for collision-off. Result unknown: no output found.
- `gen_saveA.mjs`: save written "as the keys" for the in-game check. Not run yet as far as known.

## Still to do (owner's words were sent verbatim to the old worker; summary)
1. Commit the mph toggle after `npm test` (0 failures; `save.test.ts` 70 unchanged). Check mph value against the game if cheap.
2. In-game check: save "same as the keys" (mode A into save), 5 setups of 3000GT, game dyno = mode A.
3. Speed question (owner): "w tej grze osiąga się czasem znacznie wyższe prędkości więc pytanie czy ma to znaczenie i wpływ na testy/wyniki/tuner". Find in game code whether downforce/grip grow with speed; if yes, measure sliders at 150 and 200+ km/h with collision detection from game code / collision off.
4. Body roll: measure from memory; no measurement = no slider.
5. Dropped by owner: Safari, Firefox, phone size.

## Rules
- Memory is tight on the Mac (~3 GB free): at most 2-3 game copies at a time.
- Write results to `docs/` as you go. No PR to hackch, no push to dev/main. Push only `feat/tuner-r3h` to the fork (origin).
