# Narada: the whole Tuner as it is now, with the planned "Cornering" slider (2026-11-16)

Review only. No `src/` file, no handling number and no dose was changed. Branch `feat/tuner-3o`, read at ded1e65.
Page judged from the pictures of the built page `docs/img/r3q-*.png` (headless Brave, 2335f33); `src/` differs from that build by one text line (f37b646), so no new build was made. The Cornering slider is judged from `docs/narada-handling-ui.md` and its mock, not from a built page.

Owner, verbatim: "spoko - czy to jedyny suwak/opcje jakie potrzebujemy jeśli chodzi o feeling/jazdę/problemy potencjalne z prowadzeniem? jakieś preferencje itp?"; about "Pozycje: dowolne -> 5, tylko te zmierzone w grze": "a jednolity suwak lub więcej pozycji nie da bardziej granularnej możliwości dopasowania? możemy przewidywać co się dzieje pomiędzy naszymi setupami (chyba że to nie ma znaczenia)"; "narada nad całym tunerem w aktualnej formie (z cornering)".
Owner rules, verbatim: "pamiętaj że my nie tunujemy mojego samochodu tylko tworzymy tuner dla całej społeczności graczy"; "nie chodzi o 'najlepiej wyglądające wyniki' tylko o faktyczną jazdę w grze".
All cars are test cars. "laps" = the laps repo `docs/laps.md`.

**Decision in one sentence:** is the Tuner, with one Cornering slider, complete and right enough to build next, and what must change first?

## 1. Verdict

- **Votes:** 3 for, 0 against, 3 conditional (Sceptic, User, Domain expert).
- **Verdict: change it (poprawić), then build.** One Cornering slider is right and no other handling slider is missing. Three things in the plan are wrong and one card hides its own goal (below).
- **Roles that weigh most:** the Sceptic (found errors in the Cornering design itself) and the User (the page is long and two texts name the wrong cause).
- **Condition:** nothing is called "measured" or "not measured" on the page unless the laps docs say so for that exact car side and stop. The Cornering design breaks this in three cells today (section 3.1).

Short answers:

| # | Question | Answer |
|---|---|---|
| 1 | Are the feel controls complete? | **Yes for sliders.** Every game row with a measured effect over 5 % already has a control. Missing are not sliders but three honest lines: a grip / downforce check, "not measured" for bumps, Drift and Street X feel, and the fact that Sprint and career URL also use the Circuit tab |
| 2 | Continuous, 5 stops, or more points? | **9 stops (steps of 25 %), not continuous, not 5.** The setup between two stops is exact, not a guess: the rows move in a straight line. What cannot be predicted is the lap and the limit. "Tuner's pick" sits only on a driven stop. The 5-stop rule rested on a wrong fact |
| 3 | Whole flow and page | Flow order is right (save editor first, Tuner from a car slot). Top problems: the first screen says the handling rows move "on Circuit and URL" (Circuit only); the Drag card does not show the quarter mile it optimizes; two screens say "From your sliders below" for rows the Tuner moved itself; the first key sits about 1100 px under the result (the page is about 4100 px, the Circuit card about 2750 px; section 5) |

## 2. The six roles

- 🔧 **Builder (Wykonawca): for.** Everything in the ranked list is page text, one table row, or the `step` of one slider. The Drag row has a model one call away (`gameNumbers(...).quarter`, used in `hand-input.ts` l.286), the same way the "50-120 mph pull" row was added (580522e). Where it breaks: 9 stops need a line for 27 cells (3 drivetrains x 9 stops), and most of them say "not driven".
- ⚠️ **Sceptic: conditional.** Five holes. (a) `narada-handling-ui.md` says the 25 % and 75 % stops "were never driven on any car" and marks three "Rear holds, full" cells as not measured. All four statements are false (section 3.1): the 5-stop decision rests on a wrong fact. (b) Career URL and Sprint load the Circuit tab (`TAB_USES` in `tuner.ts`; tools repo `docs/setup-bytes.md` B, career URL confirmed in the game 2026-11-04). So a front-drive player gets the half move in career URL races, where the one URL test showed no gain (Civic Si, track 4701: -0.08 s over 2 laps, +0.18 s over 5, laps Step 20.3), and in Sprint, which nobody drove. `DOSE_TABS = [0]` took the dose off the Quick Race URL tab only. (c) The Drag card repeats audit M6: the goal is "the shortest quarter mile" and the card has no quarter-mile row. (d) Steering and Braking show one car's numbers (3000GT, tools repo `docs/game-check-r3i.md` C) to every car; our own rule says one car makes no rule. (e) No person ever drove a lap behind any of this (audit M3, open). I challenge the Domain expert: "feel changes smoothly between stops" is true for the rear slide at moderate speed, and false at the limit (section 4).
- 🚀 **Visionary: for.** A table of cells (drivetrain x stop x race type) takes every later lap without a redesign. With 9 stops the 25 % and 75 % runs fill cells that already exist on the page. The same table is where Drift and Street X results would go.
- 👤 **User (the owner's words): conditional.** "czy to jedyny suwak" - for corners, yes, and that is good: one thing to move. "więcej pozycji" - yes, if a stop between two driven ones says so in one short line. Condition: the page gets shorter, not longer. Today the first key to press on the Circuit card is about 1100 px below the result table, after an optional block. Against the Sceptic: 27 lines of "not driven" must stay one line under the thumb, never a table on the page.
- 💰 **Cost: for.** Items 1-10 of the list (section 6) need no game time: about 8.5-10.5 hours of page work together (estimate); items 1-3 about 3 hours. The one lap round worth its time is the front side at 25 % and 75 % on front-drive cars: about 12 runs, 1.5-2 hours at two games at once (estimate, section 4.3). Measuring every stop on every car is 8-12 hours (estimate) and would mostly show "no change".
- 🎓 **Domain expert (game handling): conditional.** One axis is right: the four rows are one trade on every measured car. High speed, bumps and Drift have no row that a slider could honestly offer today (section 3). Condition: the Drift and Street X cards must say that the race itself changes grip (`FUN_005b4dc0` presets, `docs/setup-bytes.md` B), so nothing measured in free roam or on a circuit carries over.

Clash 1: Sceptic against the earlier design (Builder and Expert wrote it): 5 stops "only where measured" was applied to a wrong evidence table. Settled: 9 stops, each with its own line, the pick only on a driven stop.
Clash 2: User against Sceptic on the front-drive stop "three quarters, front bites". It lies between half (holds on one track layout) and full (spins on both). Settled: offered, with the warning line of the full stop, until it is driven (ranked item 4).

## 3. Question 1: are the feel controls complete?

Today: Cornering (planned; rows 0, 2, 6, 18), Steering (row 8), Braking (row 18), Nitrous (rows 16-17), and the goal per tab (lap / acceleration / top speed; rows 9-15, 23-40).

### 3.1 First, three wrong cells in the Cornering design (my own doc)

`docs/narada-handling-ui.md` section 3.4 against the laps docs:

| Cell or sentence | The design says | The laps docs say |
|---|---|---|
| "The 25 % and 75 % stops were never driven on any car" | never driven | **Driven on the "rear holds" side, Freemont:** 3000GT 75 % (timed lap 37.40 s against 37.45 base, rear slide 19.5°); RX-8 25 % (36.62 against 36.65, slide 12.1°) (laps Step 14.3 round 3, 14.4). 3000GT 25 % only before the judging fix (Step 13), not usable. Never driven: the "front bites" side at 25 / 75 % on any car |
| Rear holds, full, front-wheel drive | "Not measured on a front-drive car" | Peugeot 106, Freemont: **+0.27 s over 2 same-speed laps (slower)**, wall-corner limit one step lower (29 against 32), rear slide 8.9° to 7.2° (Step 15.4) |
| Rear holds, full, rear-wheel drive | "Not measured on a rear-drive car" | RX-8, Freemont: timed lap 36.70 against 36.65 base (half: 36.55), wall-corner limit one step lower (32 against 35), rear slide 12.3° to 11.4° (Steps 14.3, 14.4; one base run) |
| Rear holds, full, all-wheel drive | "on the test bench ... No lap was driven" | 3000GT, Freemont: timed lap 37.43 against 37.45 base (no change), rear slide 21.5-23.2° to 18.9° (Steps 14.3 round 3, 14.4) |

Limits of those runs: Freemont only; timed laps at each set's own limits, not same-speed laps; gains of 0.02-0.10 s, at or under the noise (0.02 s for the 3000GT, the RX-8 base is one run). The audit already ruled that Step 14.4 gives no rule. So the cells become "driven on one track: no lap gained; the rear slides a little less; one car lost a step in the wall corner", not "not measured". The same lines are missing in `FINDINGS` (`src/model/handling.ts`), so the built page has the same gap.

### 3.2 Complaint by complaint

"Row" = the game's tuning row (byte) from tools repo `docs/setup-bytes.md` A. "Bench" = free roam, flat road, collision off.

| What a player says | Control today | Game row and proof | Verdict |
|---|---|---|---|
| Front pushes wide / rear steps out in corners | Cornering | rows 0, 2, 6, 18. Laps on 6 test cars (Steps 14-21); bench r3l, r3m | **Covered** |
| Car turns too little or too much for a small move of the stick | Steering | row 8. Bench, 3000GT only: -7 % / +19 % at 100 km/h, no change at full stick (`game-check-r3i.md` C) | **Covered**, but one car: say "test car" in the visible line (item 7) |
| Stops too long; car turns or not when braking into a corner | Braking | row 18 = rear brake share, code `FUN_005a4d80`. Bench, 3000GT: stop from 100 km/h 21 / 23 / 28 m. Braking into a turn: 3000GT 16 % of rear slide (r3m); Peugeot 106 +27 % turn after braking; Civic unclear (both ends +16 %, laps Step 18.1) | **Covered.** Shares row 18 with Cornering (audit m3): one line says so |
| Nitrous too short / too weak | Nitrous | rows 16-17, one slider in the game (`FUN_005b3100`). Off in Drift and Street X (the race zeroes it, `FUN_005b4dc0`) | **Covered** |
| Gears too short / too long, top speed | Goal per tab | rows 9-15, 23-40: Optimize sets them for the goal. Circuit and URL goal proven on laps (Steps 15, 16.3) | **Covered.** No extra control. Trim: "Higher top speed" is offered on Drag and Drift, where nobody showed it fits |
| **Unstable at high speed** | none | rows 21, 22 (downforce), 19, 20 (tire grip). Code: downforce grows with speed and is not in the drag term (`FUN_0059e620`; `game-check-r3h.md` B), so lowering it buys no top speed. Bench, 3000GT: front downforce or front grip at the low end = the car cannot hold 200 km/h; rear downforce low = rear slide 5.6° to 7.3° at 200 km/h (r3h C). Parts: grip can only be lowered, downforce only lowered below level 3 (`setup-bytes.md` A.5) | **No slider** (it could only make the car worse). **Worth adding: a check line** on Circuit and URL when one of these rows is below the top of its range, with "put it back to the top". The "no top speed gained" part is game code, true for every car; the size is one test car |
| **Bumps, kerbs, jumps upset the car** | none | rows 1, 5 (shocks), 3, 7 (ride height), 0, 4 (springs); code `FUN_005a3700`. Bench: shocks 1-1.3 %, ride height 3-3.4 % in every flat test. The one jump test did not follow the setting (middle +43 %, top -1.6 %): not usable (`handling-design-r3l.md` 3m) | **No control. Must be measured first**, and the first test failed. Say nothing on the page. Low value |
| **Drift: car will not hold a slide / score** | none (engine goal only) | candidates: Cornering left side, rear grip row 20 (bench, 3000GT: lowering it = +25 % rear slide, r3l). But the Drift race changes grip itself (preset `FUN_005b4dc0` mode 3) and no drift score was ever read from the game. The Drift goal weights are our own idea (audit M7) | **Must be measured first.** Needs a drift score from the game's memory. Until then the Drift card says plainly: engine only, handling not measured for Drift |
| Street X: tight corners | Cornering shown, no default | Street X preset raises grip (`setup-bytes.md` B). A/B of the engine goal: not clear, the autopilot's path differs each lap (SD 0.2-0.7 s, laps Step 21.3). Cornering there: not driven | **Must be measured first** (needs a fixed-line driver on a Street X track) |
| Wheelspin off the line | none | no row: drive split is not tunable, grip only goes down. The old "strong pull from a stop" choice moved the test car 0.06 s and was dropped (`tuner.ts` l.15) | **No control, none possible** |
| Lower car, body roll | none | ride height under 3.4 %; body roll changes by 0.2° of 1.6° (r3h) | **No control.** Looks, not driving |

### 3.3 Preferences

| Preference | Today | Verdict |
|---|---|---|
| km/h or mph, keys or save, goal per tab, Steering / Braking / Nitrous | kept in the browser | fine |
| Cornering position | not kept (audit m9) | **Keep it per car** (car hash + tab). A front-drive player who moved it back to the middle gets the Tuner's pick again on every visit |
| "Safe or fast" driving style | none | not needed: that is the Cornering slider itself (half is safer at the limit, full is faster at the same speed, laps Step 18.5) |

## 4. Question 2: continuous slider, 5 stops, or more measured points?

### 4.1 What is known between and around the stops

Rear slide at the same speed, by stop (degrees; laps Steps 14.3, 14.4, 15.4, 17.2, 18.3):

| Car, track | as it is | 25 % | half | 75 % | full |
|---|---|---|---|---|---|
| Rear holds: 3000GT (AWD), Freemont | 21.5-23.2 | - | 20.2 | 19.5 | 18.9 |
| Rear holds: RX-8 (RWD), Freemont | 12.3 | 12.1 | 11.7 | - | 11.4 |
| Rear holds: Peugeot 106 (FWD), Freemont | 8.9 | - | 8.2 | - | 7.2 |
| Front bites: Civic Si (FWD), Freemont, laps 1 / 2 | 10.7 / 11.1 | - | 12.6 / 12.4 | - | 15.6 / 16.4 |

Lap gain at the same speed, front bites, front-drive cars (seconds over 2 laps, negative = faster; Step 20.1 table, Step 15.4):

| Car, track | half | full | full / half |
|---|---|---|---|
| Civic Si, short circuit layout b | -0.53 | -1.42 | 2.7 |
| Civic Si, short circuit layout c | -0.62 | -1.30 | 2.1 |
| Peugeot 106, short circuit layout b | -0.58 | -0.97 | 1.7 |
| Peugeot 106, Freemont | -0.23 to -0.28 | -0.70 | 2.5-3.0 |

At the car's limit, Civic Si, front bites (laps Step 18.3):

| Layout | | as it is | half | full |
|---|---|---|---|---|
| b | best lap (s) | 51.02 | 51.50-51.63 | 53.92-53.95 |
| b | rear slide at test speed 26 | 27.6° (holds) | **58.6° (spin)** | 63.4° (spin) |
| c | best lap (s) | 51.00-51.23 | **50.40-50.75** | 50.65-50.73 |
| c | rear slide at test speed 26 | 13.7° (holds) | 19.7° (holds, one fail) | **63.6° (spin)** |

Correction to the brief: half holds at test speed 26 on layout c only. On layout b half spins too (Step 18.3: "50 % does not avoid the lap-4 spin on 4013b").

### 4.2 What interpolation is safe

| Claim about a stop between two driven ones | Safe? | Why |
|---|---|---|
| The setup itself (the bytes) | **Yes, exact** | `withHandling` moves each row in a straight line toward the end of the car's own range. Nothing is predicted |
| "More of the same, a little less": how much the rear slides at moderate speed | **Yes, as a direction** | It rises or falls in order on every car and side driven (first table). No number is promised |
| Lap gain at the same speed, front-drive, front bites | **Only as a bracket** | Full gains 1.7 to 3.0 times half: not a straight line. "Between the half and the full result" assumes no dip between; two points cannot prove that |
| The limit: spin, wall, best lap | **No** | The spin starts somewhere between two stops, and where depends on the track layout (third table). The best stop is half on one layout and "as it is" on the other |

Does finer than 25 % matter? No, for two reasons. (1) One 25 % step changes the rear slide by 0.2-0.7° on the rear-holds side, where the same setup run twice differed by 1.7° (3000GT base, 21.5-23.2°), and by 1-2° on the front side. (2) With keys, the game moves a row by 1/30 of its range per press (`tune-keys.ts` l.359, `FUN_00522560`). The half move on the Civic is 15 / 14 / 6 / 7 presses (picture `r3q-civic-fwd-circuit-keys.png`), so one press of the smallest row is about 8 % of the slider. On the Golf at parts level 1 the half move is 27 / 24 / 6 / 6 bytes (laps Step 21.2), about 8 / 7 / 2 / 2 presses (computed, 3.3 bytes a press): one press there is 25 % of the slider. A continuous slider would show positions the keys cannot make.

### 4.3 The answer, and what measuring the gaps costs

- **Take 9 stops (steps of 25 %), which is the step the built page has today.** Not continuous. Not 5: that rule came from a wrong fact (section 3.1), and it takes away a milder choice that is exact in bytes and ordered in feel.
- Each between-stop gets one line: "Between two driven setups; not driven itself." plus the neighbour's result. On front-wheel drive the "three quarters, front bites" stop carries the warning of the full stop (spin, wall) until it is driven.
- "Tuner's pick" stays at a driven stop (front-wheel drive, Circuit: half).

Cost to measure (estimates; base: one ladder run is about 15-17 min, laps Step 13 and audit Question 2; two games at once, `handoff-post-audit.md`):

| Round | Runs | Game time (estimate) | Worth it? |
|---|---|---|---|
| A. Front bites at 25 % and 75 %, 3 front-drive cars (Civic Si, Peugeot 106, Golf), short circuit layout c, full ladder. The Civic and Peugeot base / half / full must be re-run on the port with the Step 20 ladder fix | 6 new + 6 re-runs | **1.5-2 hours** | **Yes.** It shows where the spin starts and whether the gain has a dip. Repeats on this track are frame-exact, so one run each |
| B. Every car, both sides, 25 % and 75 %, two tracks | about 48 + new bases; Freemont needs repeats (noise 0.10-0.12 s a lap) | 8-12 hours | No. Rear-drive and all-wheel-drive cars show no lap change at half, so 25 % cannot show one |
| C. A real continuous prediction | a model of the car at its limit, checked on laps | not known | No. We have no such model and the limit jumps |

## 5. Question 3: the whole flow and page

Judged from `docs/img/r3q-civic-fwd-circuit-keys.png` (Civic, front-wheel drive, Circuit, "with keys"; 1280 x 4131 px), the other `r3q-*` pictures and the code at cab30a0.

**Correction to the short answer in section 1:** 4100 px is the height of the whole Tuner page, not of one card. The Circuit card alone is about 2750 px (measured on the picture: from the card title to "All keys as a list"). The point stands: the first key to press is about 1100 px under the result table (the "50-120 mph pull" row to the first "Front Springs" box, measured on the same picture), and an optional block fills that gap.

### 5.1 The flow

| Step | Today | Verdict |
|---|---|---|
| Save editor first, Tuner from a car slot | "Back to the save editor" on top; car picked from the save | **Right.** Matches the owner's order (save -> car -> tuning) |
| Car, then "Find best setup", then one card per race type | one button for all 5 tabs, 20-50 s, progress bar | **Right** |
| Save-only or keys | two boxes, "Fair play" line above | **Right** |
| Card: goal -> result table -> download -> Cornering -> Advanced -> game screens in menu order | as listed | **Order wrong in one place:** the optional Cornering block sits between the result and the first key. A player who only wants the keys scrolls past two sliders, their evidence and a long note |

### 5.2 Problems on the page, ranked

| # | Problem | Proof | Harm | Fix | Cost (estimate) |
|---|---|---|---|---|---|
| P1 | The text under "Find best setup" says the four handling rows move "on Circuit and URL". They move on Circuit only | `index.html` l.126 against `DOSE_TABS = [0]` (`src/model/handling.ts` l.62); laps Step 21.1: URL card "both sliders 0 %" | A false sentence on the first screen a player reads | Say "on the Circuit tab (also used by Sprint and career URL races)" | 10 min |
| P2 | Suspension and Tires & Brakes say "From your sliders below." when the steps come from Optimize's own handling move (front-wheel drive, Circuit) and no slider was touched | `src/model/tuner.ts` l.358: every screen not in `TUNED` gets that text when it has steps; picture: Steering and Braking sliders in the middle, yet 3 Suspension steps and Brake Bias 7 presses | The player is told they caused it; the cause (the Cornering pick) is 1000 px above | Pass the cause into `screenPlans`: "From the corner setting above" / "From your sliders below" / both | 30-45 min + one test |
| P3 | The Drag card does not show the quarter mile it optimizes. Its goal line says "the shortest quarter mile"; the table shows 0-60, 0-100, top, power | `GOAL_WORDS.drag` (`tuner.ts` l.38), `OBJECTIVES.drag` quarter weight 1.0 (`legal-opt.ts` l.12); `cards()` adds only the pull row (`tuner-controller.ts` l.508-510); `gameNumbers().quarter` exists (`legal-opt.ts` l.524, used `hand-input.ts` l.286). Same defect as audit M6, which was fixed for Circuit and URL only | "Best" can look no better on every visible row | Add a "Quarter mile" row on the Drag card (Now / With keys / Best) and use it first in the gap line, as for the pull. Keep the card's existing note that the dyno shifts by itself and a Drag race does not (audit M7) | 1 h + one test |
| P4 | The optional Cornering block (about 1100 px) sits between the result and the first key | picture, see above; `index.html` l.176-192 | Long scroll; the user role's condition ("shorter, not longer") fails today | Fold it to one line that shows where it stands ("Corners: front bites, half (Tuner's pick). Change") and opens on click | 1 h + a screenshot check |
| P5 | "Brake Bias is also moved by the Braking slider above." The Braking slider is below (Tires & Brakes block) | `index.html` l.191; picture | Small, but a wrong pointer | "below" | 2 min |
| P6 | The picture shows "Two front-drive test cars tried it" under "front bites" (open item 3 in `handoff-post-audit.md`: the Golf is a third) | `PLAIN_LINES.push.fwd` (`handling.ts` l.226) now says "Three front-drive test cars"; the picture predates it. "Two" under "rear holds" (l.221) is right: the Golf drove only "front bites" | None in `src/` | **No change.** Close open item 3 | 0 |
| P7 | "nie zmierzone" (Polish) appears on the English page | `NOT_MEASURED` (`handling.ts` l.179), shown in `index.html` l.183-187 and in `handlingNote` l.173 | Mixed language for non-Polish players | Ask the owner: the word came from the audit fix (M7) in the owner's language | 0 (a question) |
| P8 | The ECU and Turbo charts are about 600 px each | picture | Long, but they are the steps themselves | **Keep.** No shorter form shows 9 bars of presses | 0 |

Not a problem: the "50-120 mph pull" row and the gap line now agree (laps Step 21.1); car choice, km/h / mph, keys or save and goals are kept in the browser.

### 5.3 Roles on question 3

- 🔧 Builder: P1, P2, P3, P5 are page text or one table row; P4 is one `<details>` plus a summary line. No model change.
- ⚠️ Sceptic: P2 is worse than it looks: once the 9-stop slider ships, more players get steps they did not cause, and "your sliders" is then wrong on two screens for every front-drive Circuit card.
- 👤 User: P4 first in feel, P1 first in trust. A wrong sentence on the first screen costs more than a long scroll.
- 💰 Cost: P1-P5 together about 3-3.5 hours (estimate), no game time.

## 6. One ranked change list

Ranked by harm to a player first, then by cost. "Game runs" = needs laps or a game check before it can ship.

| # | What | Why | Evidence | Cost (estimate) | Game runs? |
|---|---|---|---|---|---|
| 1 | Fix the three false or misleading page texts: "Circuit and URL" (P1), "From your sliders below" for the Tuner's own move (P2), "slider above" (P5) | A player reads a wrong cause or a wrong race type | `index.html` l.126, l.191; `tuner.ts` l.358; `handling.ts` l.62 | 1 h | no |
| 2 | Correct the Cornering evidence: the three wrong cells and the "25 / 75 % never driven" sentence in `narada-handling-ui.md` 3.4; add the "rear holds, full" lines for FWD / RWD / AWD to `FINDINGS` | The 5-stop decision rested on them; the page has the same gap | section 3.1; laps Steps 14.3, 14.4, 15.4 | 1 h | no |
| 3 | Drag card: a "Quarter mile" row and the gap line on it (P3) | The card hides the one number it optimizes | `tuner.ts` l.38, `legal-opt.ts` l.12, l.524, `tuner-controller.ts` l.508-510; audit M6 | 1 h | no |
| 4 | Cornering: 9 stops (steps of 25 %), one line per stop ("driven" with its result, or "between two driven setups; not driven itself"); "Tuner's pick" only on a driven stop; front-wheel drive "three quarters, front bites" carries the warning of the full stop | Finer choice that is exact in bytes; nothing claimed that was not driven | section 4; laps Steps 14.3-20.3; `withHandling` straight-line rows | 2-3 h | no |
| 5 | Fold the Cornering block to one line with its current position (P4) | First key 1100 px under the result | picture `r3q-civic-fwd-circuit-keys.png` | 1 h | no |
| 6 | One line in the front-drive Circuit note: this tab is also loaded by Sprint and career URL races; Sprint was never driven, one URL test showed no gain | The dose reaches races nobody tested | `TAB_USES` (`tuner.ts`); laps Step 20.3 (-0.08 s / +0.18 s) | 15 min | no |
| 7 | Steering and Braking: "test car 3000GT" in the visible line, not only under "What it changes" | One car's numbers shown to every car | `feel.ts` l.58-66; `game-check-r3i.md` C | 15 min | no |
| 8 | Grip / downforce check line on Circuit and URL: when tire grip or downforce is below the top of its range, "put it back to the top: lower gives no top speed" | The only high-speed fix the code supports; a slider could only make it worse | `FUN_0059e620`, `game-check-r3h.md` B, C; `setup-bytes.md` A.5 | 1-2 h | no (the rule is game code; the size quoted is one test car) |
| 9 | Drift and Street X cards: "Engine only. Handling not measured for this race; the race changes grip itself" | Nothing measured on a circuit carries over | `FUN_005b4dc0` presets; `setup-bytes.md` B; audit M7 | 15 min | no |
| 10 | Keep the Cornering position per car and tab | A player who switched it off gets the pick back every visit | audit m9; `index.html` l.191 says it is not kept | 1 h | no |
| 11 | Laps round A: front bites at 25 % and 75 % on Civic Si, Peugeot 106, Golf, short circuit layout c; re-run their base / half / full on the Step 20 ladder | Where the spin starts; turns stops 3 and 7 on the front side from "not driven" into results | section 4.3 | 1.5-2 h game time | **yes** |
| 12 | One human lap per drivetrain: factory against the Tuner's set, 3 laps, same car, twice | No person ever drove behind any of this (audit M3) | `handoff-post-audit.md` open 5 | about 1 h of the owner's time | **yes** (owner) |
| 13 | Drag: a scripted redline-shift quarter mile, factory against the Drag tab set | The dyno shifts by itself; a Drag race does not (audit M7) | audit M7 fix | about 1 h (estimate) | **yes** |
| 14 | Street X fixed-line driver and a drift score read from memory | Without them the Street X and Drift goals stay our own idea | laps Step 21.3 (SD 0.2-0.7 s); audit M7 | not known, several hours | **yes** |
| 15 | Trim "Higher top speed" from the Drag and Drift goal choices, or say it was not tested there | Offered where nobody showed it fits | `goalChoices` (`tuner.ts` l.27-30) | 15 min | no |
| 16 | Ask the owner about "nie zmierzone" on the English page (P7) | Mixed language | `handling.ts` l.179 | 0 | no |

Not on the list, on purpose: a bumps / kerbs control (the one jump test failed, section 3.2), a "safe or fast" style switch (it is the Cornering slider), a continuous slider (section 4.2), shorter ECU / Turbo charts (P8).

Items 1-10 together: about 8.5-10.5 hours of page work (estimate), no game time. Item 11 is the one game round worth doing before the slider ships its 25 % and 75 % front stops as "driven".
