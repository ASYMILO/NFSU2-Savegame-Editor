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
- Port 8771 (`serve_editors.sh` on `dev`, plain `http.server`) does not offer `./game/GLOBALB.BUN`: there the page asks for the file once.
  `tools/serve_editor.py` (tuner branch `feat/hand-input-tools-r2`) loads it by itself.
- Merging of equal tabs: unit test only. Browsers other than Brave, phone widths: not tried.

## 7. Undo

`git checkout feat/hand-input && npm run build` in `port-editor` (the author's screen and round 2 come back as before), or delete the
branch: `git branch -D feat/tuner-r3` and `git push fork --delete feat/tuner-r3`.
