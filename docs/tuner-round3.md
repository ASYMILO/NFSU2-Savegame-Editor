# Tuner, round 3: one simple screen

Branch `feat/tuner-r3` of the fork (off `feat/hand-input` 03c85ef). Own editor only, no PR to the author.
Rounds 1 and 2: `docs/hand-input-core.md`, `docs/hand-input-round2.md`.

Owner's feedback (2026-11-06): no race type choice, say how URL works, merge what is the same, "Protect launch" unclear,
too much information. Wanted flow: load a save or pick the car and parts, press Optimize, get what to set for every race type,
optional preferences.

## 1. Where the screen sits (variants)

| | Variant | Verdict |
|---|---|---|
| 1 | `tuner.html` with its own controller | Rejected. "Write to save" needs the save: load, nfsu2-web ZIP profiles, checksums, download. All of it lives in the closure of `EditorController` (`src/controller/editor-controller.ts` l.60-70: `data`, `backup`, `game`) and would be copied. |
| 2 | Move the editor's state into an Angular service, two controllers | Rejected. Refactors the author's whole controller (1,349 lines) for one screen. |
| 3 | **A first view in `index.html`, logic in its own file** | **Chosen.** `index.html`: a nav "Tuner / Save editor" and a `<main ng-show="view === 'tuner'">` before the author's `<main>`, which only gets `ng-show="view === 'editor'"`. Logic: `src/controller/tuner-controller.ts` (`attachTuner`) and `src/model/tuner.ts`. The author's controller gets 17 lines: keep the game file bytes, call `tunerSync()` in `refresh`, `rejectFile` and `applyGameData`, and hand the tuner four functions (`save`, `game`, `gameBytes`, `apply`). |

The author's path save -> Car slots -> Tuning… -> tabs is unchanged and one click away ("Save editor"). Checked in the browser:
the save loads there, slot 2 opens Tuning, DYNO shows the 3000GT (`img/r3-6-save-editor.png`, `img/r3-7-author-dyno.png`).

## 2. Flow

1. **Your car.** "From my save" (load a save or a backup ZIP, then the car from its filled slots; traffic cars are left out) or
   "Pick a car" (car + part levels, no save; the same in-memory save as round 1, `buildVirtualSave`). GLOBALB.BUN loads by itself
   when the server offers `./game/GLOBALB.BUN`, else a "Load game data" button.
2. **Optimize.** One button. All five tabs are computed at once, in web workers (`src/tuner-worker.ts`, up to 5 at a time).
   One tab takes about 20 s alone; all five took 16-41 s in the browser runs below. Without workers the page runs them one after another.
   **Preferences** (folded): one choice, each mapped to an objective that already exists (`legalOptions` in `src/model/tuner.ts`, no new numbers):

   | Choice | What it does |
   |---|---|
   | Best for each race (default) | Each tab its own goal (Circuit, Drag, Drift, Street X, URL weights of `legal-opt.ts`) |
   | Keep a strong start | Same goals, 3 lowest ECU bars at least 90 % of stock. The page says it is our rule of thumb, not a game fact. This replaces the "Protect launch" checkbox. |
   | Acceleration first | Street X goal for every tab |
   | Top speed first | URL goal for every tab |

3. **Set it in the game.** A row of the game's tabs (Circuit, Drag, Drift, Street X, URL: the order of the game's Performance Tuning
   screen, `docs/dyno-check-3000gt.md` l.57 of the tuner repo). One card at a time:
   - which races use the tab (from `docs/setup-bytes.md` l.89-103, career URL = Circuit tab confirmed in game l.166-174):
     Circuit = career Circuit, Sprint and URL, Quick Race Circuit and Sprint, free roam; URL = only Quick Race URL;
   - mode A on top (0-60, 0-100, top speed, power), then one line "Writing to the save would give … (by hand minus save: …)";
   - the steps in the game's menu order (Suspension, Drivetrain, Aerodynamics, Tires & Brakes, ECU, Turbo, Nitrous:
     `docs/native-menu-map.md` l.167-170): sliders as "C, then RIGHT ×22 → shows 4.16"; ECU and Turbo as the DYNO chart with the
     presses under the bars;
   - Drag card: "In Drag races you shift by hand. The dyno shifts by itself.";
   - "Write exact setup to save" only with a loaded save; it writes mode B into that tab, then "Download edited save / ZIP" shows;
   - folded "Details": A / B / difference table, key count, the full key sheet and the optimizer sheet.
   Tabs with the same start, keys and result share one card ("Circuit + URL tabs", "Same plan for these tabs"). None of the runs
   below had two equal tabs, so merging is checked by the unit test only.

No save: the sliders in the game stand anywhere, so every step starts with C, and rows Optimize may change but the plan leaves
alone get a plain "C" (`tunerSteps(…, fromC)`). The plan starts from the state after C on every row (`startAfterC`).

What did not change: the optimizer (`runLegal`, same options) and the key planner (`planHandInput`). The tuner only calls them.

## 3. Results (browser, headless Brave, own 127.0.0.1 server with GLOBALB.BUN)

Owner's 3000GT, profile ASYMILO slot 2, default preference, 41 s for all five tabs:

| Tab | Keys | A: 0-60 / 0-100 / top / power | B (write to save) | Steps |
|---|---|---|---|---|
| Circuit | 29 | 4.22 / 10.35 / 323.5 / 433.8 | 4.22 / 10.33 / 323.5 / 435.6 | Final drive C → 3.96; ECU; Turbo |
| Drag | 79 | 4.10 / 10.14 / 318.6 / 433.8 | 4.10 / 10.12 / 318.6 / 434.9 | Final drive RIGHT ×21 → 4.17; ECU; Turbo |
| Drift | 48 | 4.22 / 10.22 / 318.6 / 432.0 | 4.18 / 10.22 / 318.6 / 431.8 | ECU; Turbo |
| Street X | 69 | 4.10 / 10.12 / 309.0 / 435.1 | 4.10 / 10.12 / 309.0 / 434.9 | Final drive C, RIGHT ×22 → 4.16; ECU; Turbo |
| URL | 41 | 4.20 / 10.33 / 323.5 / 434.2 | 4.20 / 10.31 / 323.5 / 434.9 | Final drive C → 3.96; ECU; Turbo |

Every number and key count equals the round 2 table (`hand-input-round2.md`, "Five setups"), whose A column matched the game's code.

Other runs: no save, 3000GT with ECU / Turbo / Transmission Pro (16 s; every step starts with C; Drift and Street X: A costs 4.8 km/h
top speed against B, shown on the card); preference "Keep a strong start" (80 s); "Write exact setup to save" on the Circuit card
(status "Circuit tab: exact setup written to slot 2. Download the save to keep it.", Download button shown). No page errors in any run.

Screens (`docs/img/`): ![save loaded](img/r3-1-save-loaded.png) ![pick a car](img/r3-2-list-before.png) ![working](img/r3-3-busy.png)
![Circuit card](img/r3-4-save-card.png) ![whole page](img/r3-4-save-result.png) ![written, details open](img/r3-5-written-details.png)
![save editor](img/r3-6-save-editor.png) ![author's DYNO](img/r3-7-author-dyno.png) ![no save](img/r3-8-list-result.png)
![strong start](img/r3-9-pref-launch-card.png)

## 4. Tests

`NFSU2_GLOBALB=… npm test`: **127 tests, 106 pass, 0 fail, 21 skipped** (round 2: 123 / 102 / 0 / 21; the skips are the author's private
`treav0r` fixture). New `src/test/tuner.test.ts`:

| Test | What it checks |
|---|---|
| preferences | each choice gives the existing objective; the 90 % rule only with "strong start" |
| shared cards | tabs with equal start, keys and result go into one card, others not |
| menu order | for the 40 part sets of `dyno-exactness.json`, from the saved setup and from the no-save start: the steps in menu order (Drivetrain before ECU and Turbo), replayed with the game's key code, give the planned bytes |
| no save | every step starts with C; C on the no-save start changes nothing; every curve and drivetrain row is listed |

## 5. Design critique (from the screenshots)

| Found | Done |
|---|---|
| First version showed all five cards with two charts each: a page 6,100 px long | One card at a time behind a row of the game's tab names |
| Old screen: setup tabs, A/B choice, Event menu, Protect launch, two optimizers, 22 sliders | Two steps and one button; preferences and details folded |
| "Protect launch" did not say what it does | Gone; "Keep a strong start" says the rule and that it is our estimate |
| URL rule hidden in docs | On the Circuit and URL cards |
| Optimize takes time with no sign of life | Button says "Working…" and "n of 5 done" (`img/r3-3-busy.png`) |
| Can a user without knowledge get through? | Save or car → Optimize → card works with no other choice. Still hard: the ECU / Turbo chart with ▲/▼ rows needs the one-line legend under it; the slider screens are named but not pictured. |

## 6. Not checked / limits

- No plan of this round was keyed in the running game. The numbers equal round 2, whose round 1 plans were checked in game (`docs/dyno-check-3000gt.md`).
- Menu order: the bytes are the same in the key code (test above), not tried in the game.
- No save: "press C first on every row" assumes C works per row as measured for suspension and final drive (`native-menu-map.md` l.172-173); not tried for 6-speed gears.
- The round 2 typed slider numbers (suspension, aero, tires, brakes, nitrous) are not on the Tuner screen. They stay in Save editor -> Tuning… -> DYNO.
- Port 8771 offers `./game/GLOBALB.BUN` from `data/game/` when started with `serve_editors.sh` from nfsu2-tuner branch
  `feat/hand-input-tools-r2` (it runs `tools/serve_editor.py`, 127.0.0.1 only, file read in place, never copied). Checked
  2026-11-06: `curl -sf http://127.0.0.1:8771/game/GLOBALB.BUN` = 200, 8,008,064 bytes, same as `data/game/GLOBALB.BUN`;
  the Tuner lists 67 cars under "Pick a car" with no file prompt (`docs/img/r3-10-8771.png`).
  The `serve_editors.sh` on `dev` is still the old one (plain `http.server`, page asks for the file) until that branch is merged.
- Merging of equal tabs: unit test only. Browsers other than Brave, phone widths: not tried.

## 3c. Owner's feedback, round 3c (branch `feat/tuner-r3c` off `feat/tuner-r3`)

Feedback: key C unclear, the ▲/▼ rows unclear, no before/after, Engine / Nitrous / Suspension / Brakes "None" with no
settings, "Circuit Tab" suffix not needed, career vs Quick Race must be clear, tabs and order as in the game, car thumbnails.

| Feedback | Done | Source |
|---|---|---|
| C = reset? | Every key C reads **Reset (key C)**. One box on top: it is the game's "Reset to default"; on a slider screen it resets only the selected row, on ECU and Turbo all 9 bars. | `docs/native-menu-map.md` l.174-181 (measured) |
| ▲/▼ rows | Under each bar: **Bar 1..9**, the rpm, then per round **UP 3 / DOWN 1 / –** in words; rows named 1st, 2nd, 3rd. Three numbered lines under the chart: Reset, UP/DOWN then RIGHT to the next bar, after bar 9 LEFT ×8 back to bar 1 for the next round (changed in 3c-2: RIGHT once). | Order = `curvePlanner` in `src/model/hand-input.ts` (C, then bars 0..8 per pass); the key list that passed the in-game check does exactly this: `native/runs/dyno_check_20261106/steps_a.mjs` l.24-27 (LEFT ×8 between rounds, RIGHT after each bar) |
| Before / after | Table "Dyno: Now (save) → After the steps" (0-60, 0-100, top speed, power). Without a save the first column is "After reset". Slider steps read "Final Drive Ratio: 4.05 → 3.96. Keys: Reset (key C)". | Numbers: `gameNumbers(model.evaluate(start))` and the plan's mode A; slider numbers: `shownText` on the start and on the plan, no new numbers |
| Parts "None" | **Every card lists all 7 screens of the game's menu.** A screen without a part: **Locked**, with the parts that open it. A screen Optimize does not tune: **Leave as is**, one line at the end: Optimize tunes only Drivetrain, ECU and Turbo, the dyno measures speed, not grip or handling (checked: on the owner's 3000GT Optimize changes only byte 9 and bytes 23-40). Drift and Street X: "This race type turns nitrous off anyway". | Locked / which part: the game's tuning records in GLOBALB.BUN (`unlockParts`, `categoryScreens` in `src/model/tuner.ts`; rule `docs/setup-bytes.md` l.42); nitrous: `docs/setup-bytes.md` l.103 |
| Parts list | Every part has a line under it: what it opens in the game. Engine and Weight reduction: "Counts on the dyno. Opens no tuning screen" (no tuning record for EN or WT in the game data, test). Transmission: gears only with Extreme (6-speed). **New: Front bumper (aero) and Spoiler (aero), level 1-3**; they open Aerodynamics (front / rear downforce). The Tuner had no field for them. | Records: `docs/setup-bytes.md` l.17-40 and the game data; aero flags `AE_FRONT_BUMPER_L1..3`, `AE_SPOILER_L1..3` (`withAero` in `src/model/virtual-save.ts`) |
| Tabs | Five buttons with the game's captions in its order: **Circuit, Drag, Drift, Street X, URL Race**, no "tab" suffix. Under each name: "Circuit, Sprint, career URL" / "career and Quick Race" / "Quick Race URL only". On the card a table **Career races / Quick Race**. Tabs with the same plan keep their own button and open one card ("Same plan for the tabs Circuit + URL Race"). | Captions and order seen in game: `native/runs/dyno_check_20261106/s4/*_setting_0..4.png` (tuner repo); which race loads which tab: `docs/setup-bytes.md` l.89-103, career URL = Circuit in game l.166-174 |
| Screen order on the card | Suspension, Drivetrain, Aerodynamics, Tires & Brakes, ECU, Turbo, Nitrous. | Code: item index 0..6, `FUN_0055ab80` (`docs/native-menu-map.md` l.164-170); seen: `native/runs/tune_screens_20261106/*_master_*.png`, e.g. the Aerodynamics icon left of Tires & Brakes |
| Thumbnails | The game's own car-select logo of the picked car (white logo, 256×64) next to the car choice. | Texture `SECONDARY_LOGO_<car>` in `FRONTEND/FrontB.lzc`, found for all 32 non-traffic cars by name hash |

Thumbnails, how: the game has no 2D car picture (car select shows the 3D model); it has a name logo per car.
`tools/extract_car_logos.py` (tuner repo, branch `feat/tuner-r3c`) decodes them (JDLZ + TPK reader from
`native/nfsu2-web/tools/texpacks.py`, DXT3 → PNG) into `data/game/logos/<car>.png` (gitignored, EA's files, personal use).
`tools/serve_editor.py` serves them at `/game/logos/<car>.png` (127.0.0.1 only; only plain names, `..` gives 404). Without the
files the page hides the logo box. Wiki photos were not used: NFS wiki images are EA screenshots (copyright EA, the wiki's
CC BY-SA covers its text, not those images), and the game's own logos did the job locally. No game image is committed:
`r3c-1` in git has the logo hidden; the copy with the logo is `data/out/r3c-1-pick-car-parts-with-logo.png` of the tuner repo (not in git).

Checks (headless Brave on http://127.0.0.1:8771/, served by `serve_editors.sh`): GLOBALB.BUN loads by itself, no file prompt;
logo shown; no save, 3000GT with only ECU Pro: Suspension, Drivetrain, Aerodynamics, Tires & Brakes, Turbo, Nitrous Locked, ECU Change,
Circuit and URL Race share one card (the first run where two tabs merged in a browser); owner's save slot 2: 5 cards, 26-29 s, Circuit
5.02 / 11.38 / 309.0 / 421.4 → 4.22 / 10.35 / 323.5 / 433.8 and the ECU / Turbo presses equal round 2 and `docs/dyno-check-3000gt.md`
row 0 (checked in game in round 1); Save editor still lists the slots; no page errors.

Screens: ![parts and hints](img/r3c-1-pick-car-parts.png) ![no save, locked screens, shared card](img/r3c-2-no-save-locked.png)
![save, Circuit card](img/r3c-3-save-circuit-card.png) ![ECU bars in words](img/r3c-4-ecu-bars.png) ![URL Race card](img/r3c-5-url-card.png)
![Drag card](img/r3c-6-drag-card.png)

Tests: `npm test` **130, 109 pass, 0 fail, 21 skipped** (author's `save.test.ts` unchanged). New in `src/test/tuner.test.ts`: which part opens
which screen (from the game data; Engine and Weight open none), every card lists the 7 screens in menu order with locked ones,
aero levels set one flag each.

Design critique after the first 3c screenshots, fixed: the "not tuned" sentence stood four times on a card (now one line at the end);
tab sub-lines "Drag / Drag" said nothing (now "career and Quick Race"); a merged card put URL Race first in the tab row (now five
buttons in game order); "Round 2" ran into bar 1's presses (now 1st / 2nd / 3rd); the logo sat under the part list (now next to the car
choice); slider steps read keys first, values last (now "4.05 → 3.96. Keys: …"). Still heavy: ECU and Turbo charts each take a screen
height; the red / yellow marks of the chart have no legend (author's chart).

Not checked (3c, first pass; see 3c-2 for what was checked later): nothing of 3c was tried in the running game. Not seen in game: how the game shows a locked screen (hidden or greyed),
and which body parts in the shop set the aero flags (the editor reads them as flags 56-67). "Reset (key C)" resets the selected row: measured
for suspension and final drive, from code for the others; not tried on 6-speed gears. Phone widths and other browsers not tried.

## 3c-2. Bar 9 wraps to bar 1; the open points checked in the game (2026-11-06)

Owner: "on the last bar RIGHT probably jumps to the start, check it, it makes the instruction simpler". Facts and runs are in
the tuner repo (`docs/native-menu-map.md` "Graph bars wrap" and "Locked screens", `docs/dyno-check-3000gt.md` "Round 3c").

| Question | Answer | Proof |
|---|---|---|
| RIGHT on bar 9 -> bar 1? LEFT on bar 1 -> bar 9? | **Yes on ECU and on Turbo** (both ways). Nitrous has no bars: RIGHT/LEFT stop at the ends. | Code `FUN_00522eb0` (ring; `data/ghidra_decomp.c` l.206895-206925), Nitrous `FUN_00523210` l.207087; game: `native/runs/wrap_20261106/bytes.txt` (T1, T2, T4, `nos_r6`, `nos_l11`) |
| Does Reset (C) pick bar 1? | **No.** C keeps the picked bar; bar 1 is picked when the screen opens. | game: `native/runs/locked_20261106/run_L1` T5 (RIGHT ×3, C, UP moves bar 4) |
| The 3c plan typed in the game, 5 tabs of the 3000GT | Game = mode A in all 5: Circuit 4.22 / 10.35 / 323.5, Drag 4.10 / 10.14 / 318.6, Drift 4.22 / 10.22 / 318.6, Street X 4.10 / 10.12 / 309.0, URL Race 4.20 / 10.33 / 323.5. All 41 bytes checked after every key. | `native/runs/tuner3c_20261106/` (`results_A_all.png`, `records.json`, `s*/log.txt`) |
| How the game shows a locked screen | The icon stays in the list with a **padlock**; Enter does nothing. | `native/runs/locked_20261106/L1_master_all.png`, `L2_master_all.png`; fng stays `UI_PerformanceTuning_Master.fng` |
| Which body parts open Aerodynamics | A **non-stock front bumper** (front downforce) and **spoiler** (rear). Stock front bumper + stock spoiler lock it even with the save's flags set; rear bumper and side skirts do not open it. Clearing the save's aero flags does nothing: the game rebuilds them from the body parts. | game: L1 / L2 runs above; code: `FUN_006399D0` (`technical.md` "Visual-derived group-9 flags"), records `docs/setup-bytes.md` l.35-36 |
| Reset on 6-speed gears | C resets only that gear; a neighbour it pushed before stays where it is. | game, every-part copy: `native/runs/gear_lvl3_20261106/log.txt` f=4168 / f=4210 (3rd gear 78 -> 100, 4th stays 98); `docs/game-input-rules.md` |
| Does C work on Nitrous | Yes: duration and intensity back to 100. | `native/runs/wrap_20261106/bytes.txt` `nos_C1`; `tune_screens_20261106/bytes.txt` l.80 |

Changes:
- `src/model/tuner.ts` `curveKeys`: the keys of a graph = C, then bar 1..9 per round, RIGHT after each bar, RIGHT on bar 9 back
  to bar 1, stop after the last bar with presses. The card's "key presses in all" now counts every key (C, UP/DOWN, RIGHT).
  Bar moves per graph on the 3000GT: 9-25 (was 24-40 with LEFT ×8). Going LEFT to a nearer bar would save at most 3 more; not
  used, so the rule stays "always RIGHT". Test in `src/test/tuner.test.ts`.
- How-to under the chart: "Open the screen. Bar 1 (left) is picked. Press Reset (key C) ..." / "... then RIGHT to the next bar" /
  "On bar 9, RIGHT takes you back to bar 1. Do the 2nd round the same way." / "Stop after the last bar with presses."
  (the old line said C picks bar 1; the game says it does not).
- Locked screens: "Locked in the game: its icon has a padlock and Enter does nothing." Aero parts read "a body-shop front bumper
  (not stock)" / "a body-shop spoiler (not stock)"; the part list's aero hint says rear bumper and side skirts open nothing.

Screen: ![ECU bars with the new how-to](img/r3c-7-bars-wrap.png) (headless Brave, http://127.0.0.1:8771/, no save, 3000GT with ECU /
Turbo / Transmission Pro; no page errors).

Tests: `npm test` **131, 110 pass, 0 fail, 21 skipped**; `src/test/save.test.ts` unchanged.

Not checked (3c-2): a stock front bumper with a body-shop spoiler (code says: only rear downforce); the Tuner's no-save mode
typed in the game; LEFT to a nearer bar (not used); imperial units; phone widths and other browsers.

## 7. Undo

Round 3c only: `git checkout feat/tuner-r3 && npm run build` in `port-editor`. All of round 3: `git checkout feat/hand-input && npm run build` in `port-editor` (the author's screen and round 2 come back as before), or delete the
branch: `git branch -D feat/tuner-r3` and `git push fork --delete feat/tuner-r3`.
