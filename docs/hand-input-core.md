# Hand input core: no-save mode, game key code, mode A / B

Branch `feat/hand-input` (off `feat/legal-optimizer`). Own editor only, no PR to the author.

## 1. Where "without a save" plugs in (decision)

The editor is a separate tool whose dyno part works on a loaded save. The existing path
(line numbers on `feat/legal-optimizer`):

1. `loadFile` (`src/controller/editor-controller.ts` l.437) -> `showLoaded` (l.368) puts the bytes in `data` and calls `refresh`.
2. The car slot list (`index.html` "Car slots", button "Tuning…") -> `openTuning(slot)` (l.517).
3. DYNO tab -> `rebuildDyno` (l.308) -> `dynoModel` (l.235): `readSlotDyno(data, slot)` gives car hash, installed part flags and the five
   setups, `findCar` + `new DynoModel(game, car, installed, uniques)`. Everything after that (drafts, Optimize, Apply, charts) works on those bytes.

Variants considered:

| | Idea | Verdict |
|---|---|---|
| 1 | `dynoModel()` gets a second source (car + flags in a scope object) when `data` is null | Rejected. About 25 places start with `if (!data) return` (drafts, apply, visual, slots). Each would need a second branch. |
| 2 | A second, separate dyno panel for the no-save mode | Rejected. Duplicates the chart, drafts, Apply and tests. |
| 3 | **Build a save in memory** (`src/model/virtual-save.ts`: valid header and checksums, one bought car in slot 1, 68 part flags, five neutral setups) and send it through `showLoaded` | **Chosen.** Steps 1-3 above stay untouched: the author's code never learns that there is no file. The only changes in the shared path: a `virtual.on` flag that hides Profile, Car slots and Download, and the car / part lists that rebuild the in-memory save. |

Lists: car (all GLOBALB cars except traffic) and a level (None, Street, Pro, Extreme) per part category, in the order ECU, Turbo,
Transmission, Engine, Nitrous, Suspension, Brakes, Tires, Weight. A level installs every part of the category up to it; of two parts that
exclude each other the higher level wins (`installedForLevels`). Loading a real save or ZIP turns the flag off, and the save path is as before.

GLOBALB.BUN: the page asks `./game/GLOBALB.BUN` once (`fetch` in `editor-controller.ts`, `applyGameData`). `tools/serve_editor.py`
(used by `serve_editors.sh` for port 8771) answers it from `data/game/GLOBALB.BUN`, bound to 127.0.0.1. A published site has no such file
(404), then the file picker works as before. The EA file is not copied into `dist` and not committed.

## 2. The game's key code (`src/model/tune-keys.ts`)

Port of SPEED2.EXE, in float32 like the game:

- ECU and Turbo graph: `CurveScreen.press(column, +1|-1)` and `reset()` (key C). Chain: slider step (one tenth of the column box, fixed when the
  screen opens, FUN_00550580), value read back from the byte (FUN_005b3e40), write with neighbour redistribution (FUN_005b4670 ->
  FUN_005b2c00, weights at 0x7FC674), bytes rewritten from the new torque. Details that the old `withCurvePoint` approximation misses:
  the redistribution runs on the stored torque (with the unique parts taken out and put back, FUN_00599d90 / FUN_005997e0), the byte is
  `trunc(frac*100+100.5)`, a press at the end of the box writes nothing.
- Final drive: `pressFinalDrive(model, setup, +1|-1)`: step range/30, value clamped to the range ends, so the reachable grid shifts at the ends.
- `withCurvePoint` is unchanged: the optimizer (mode B and its tests) and the chart's "set this bar" use it, and replacing it would change
  the recorded optimizer results. Mode A does not use it.

Reference: `tools/emu/press_cases.py` runs the game's own press functions in the emulator (branch `feat/hand-input-tools` of the tuner repo,
with `make_press_fixture.py`); result in `src/test/fixtures/press-reference.json` (numbers only).

## 3. Mode A / B (`src/model/hand-input.ts`, UI in the DYNO tab)

- B: the exact optimum of "Optimize (game rules)", written with Apply (as before).
- A (default): the same optimum fitted to what the keys reach. Per screen, a planner (`SLIDER_PLANNERS`): ECU and Turbo = press C, then the
  bars left to right, for each bar the number of UP / DOWN presses (at most 12) that brings the nine bars nearest the optimum; up to three
  passes (the neighbours move). Final drive = breadth-first search over RIGHT / LEFT from the saved byte (or from C), every reachable byte
  tried on the dyno, best cost wins. The UI shows A, B and A minus B for 0-60, 0-100, Top speed, Power, and under each bar of the existing DYNO chart the
  press counts (rows: C then, again 2, again 3). The draft is A (mode A) or B (mode B); switching is instant.
- The Drivetrain "Reset to default" step is gone from the sheet text and from A (it costs 9.7 km/h on the 3000GT FD, final drive byte 103).
- Hook for later: add a function to `SLIDER_PLANNERS` (signature `SliderPlanner`: model, setup so far, optimum, objective -> `SliderPlan`).
  Suspension, aero, tires, brakes and nitrous plug in there; their key facts are in `docs/native-menu-map.md` (range/30 per press).
  Per-slider shortest paths (`docs/game-input-rules.md`) replace `curvePlanner` / `finalDrivePlanner` in the same slot.

## 4. Run

```
cd port-editor && npm test                       # NFSU2_GLOBALB=<abs path to GLOBALB.BUN> to run the game-data tests
./serve_editors.sh                               # tuner repo, branch feat/hand-input-tools; http://127.0.0.1:8771/
# from another checkout of the editor build: EDITOR_DIST=<path>/dist ./serve_editors.sh
relay/check.sh                                   # build, tests, optimizer parity (baseline updated for the new step-0 text)
```

## 5. Results

`npm test` (GLOBALB.BUN from `data/game`): 114 tests, 93 pass, 0 fail, 21 skipped (the author's private `treav0r` fixture), same skips as before.

Inputs tested against the emulator (byte for byte):
- Measured in the running game: ECU column 0 UP, UP, DOWN from `66 76 100 131 136 134 99 127 36` gives `76 79 96 128 133 131 95 124 39`;
  Turbo column 3 UP, UP, DOWN from `101 100 93 108 136 128 100 100 0` gives `107 107 86 118 134 125 96 96 2`.
- 107 sequences (ECU and Turbo, 40 car / part sets of `dyno-exactness.json`, 3 to 25 keys, 4 % key C), 1,370 key steps: all equal.
- Final drive: 30 sequences of 120 keys (3,600 steps) from the saved byte, from 100 and from 167, across both range ends. Sequences whose start byte lies outside the box are skipped.
- Plans (`hand-input.test.ts`): the presses replayed on a fresh screen give the planned bytes for 40 part sets, bars get closer to the optimum.
- ASYMILO 3000GT slot 1, Circuit (ECU 2 / Turbo 2 / transmission 2): A needs 29 key presses, 0-60 4.22 s, 0-100 10.35 s (B 10.33 s), top 323.5 km/h, power
  433.8 bhp (B 435.6). In the UI with ECU Extreme / Turbo Pro / Transmission Pro / Engine Pro (no save): 49 presses, A 4.30 / 10.54 / 333.1 km/h,
  B 4.32 / 10.54 / 333.1 km/h.

Screenshots (`docs/img/`): `no-save-page.png` (new section, game data loaded by itself), `ecu-presses.png` (A vs B table, keys sheet, presses
under the bars), `mode-b.png` (mode B).

## 6. Skipped / limits

- Nitrous, suspension, aero, tires, brakes, 6-speed gears: no planner yet (hook above). A keeps those values as they are.
- The graph keys are checked in metric display units (the emulator's setting). In imperial the screen steps in lb-ft; the byte results may differ by one byte at a rounding edge. Not checked.
- The start tables of the car (ECU / Turbo torque) are rebuilt in float32 for the keys; the dyno model itself still builds in float64 (turning
  it to float32 broke two existing dyno tests).
- Checked in the game: only the two sequences above. Everything else is the game's code in the emulator, not a screen.
- Checked in a browser: the no-save flow, Optimize, A / B switch (Brave, headless). Not clicked in a browser: loading a real save (covered by `save.test.ts`).
- Mode A's ECU / Turbo fit minimises the bar distance, not the lap objective; the dyno numbers show what it costs (A minus B).
