# Handling design r3l: "the rear steps out" (proposal, no UI code yet)

Owner (2026-11-08): "moje auto w trakcie wyścigu ucieka tyłem i nie znalazłem w naszym tunerze opcji za to odpowiedzialnej ... User powinien bez technicznej
i fizycznej wiedzy dostać jak najlepszy tune pod jego potrzeby i potem robić swoje adjustments na podstawie własnych odczuć".
Evidence: tools repo `docs/game-check-r3l.md` (sections 0-3) and `docs/game-check-r3l-table.md`; earlier rounds r3h C, r3i C.

## What is wrong today
- Optimize changes only gears, final drive, ECU, turbo. Suspension, brakes and aero stay as the save has them (r3l section 0).
- Earlier tests (r3f-r3i) measured steady side g and straight braking. There the suspension rows were <= 2 % and were dropped.
- The new transient tests show the rear stepping out (nose-in slip) is **steered by the sway bars, front springs and brake bias**: -24 % to +41 %.
  The owner's Circuit tab has the rear sway bar near its loose end (96 of 21..120).

## Proposal: 3 controls in player words, plus a per-tab default from Optimize
| Control (Polish label) | Ends | Rows it moves | Measured effect (each row alone, 3000GT, 150 km/h full stick) |
|---|---|---|---|
| **"Tył w zakręcie: trzyma <-> ucieka"** (new) | stable .. loose | rear sway bar (6) down, front sway bar (2) up, front springs (0) up; reverse for loose | rear bar -24 % / +6 %, front bar -13 % / +17 %, front springs -8 % / +6 % slip; costs 2-5 % turn rate, <= 1.3 % side g, 0 top speed |
| **"Hamowanie w zakręt: stabilne <-> skręca"** (the existing Braking slider, new text) | front .. rear brake share | brake bias (18) | brake + turn slip -18 % / +35 %; straight stop -10 % / +20 % at 100 km/h (r3i C) |
| **"Skręt"** (existing Steering slider) | slow .. quick | steering ratio (8) | stick 0.4: -7 % / +19 % turn at 100 km/h (r3i C); slip -2 % / +4 % |

Why three: only these rows change how the car drives by more than ~5 % (r3l section 2, r3h C, r3i C). The rest stay fixed by Optimize:
- Rear downforce and rear grip: **always the top** (lowering = +41 % / +25 % rear slip). Front downforce / front grip: always the top (lowering calms the rear only by losing front grip; the car cannot hold 200 km/h, r3h C).
  These can only be lowered on this car (part boxes), so a slider would only make things worse.
- Shocks and ride heights: <= 3-8 % in every test: hidden.
- Rear springs: mixed (-10 % in a turn, +15 % when braking into a turn): hidden, kept as saved or mid.

Per-tab default (what Optimize writes, the user then moves the 3 controls):
- Circuit / URL / Street X / Drag: "Tył w zakręcie" at stable, Braking toward the front, top downforce and grip.
- Drift: "Tył w zakręcie" at loose, Braking toward the rear, rear grip as the player chooses (the saved Drift tab has 61).
- Card text per control: the measured % at the two ends, as the Steering and Braking cards do now.

## Open before UI code (must measure, not guess)
1. The **combined** stable set (rear bar lo + front bar hi + front springs hi + brake lo) in one game: do the effects add up? Is the turn rate cost still <= 5 %?
2. Pass b of the sweep (repeat).
3. The middle positions (not only the two ends), and 100 / 200 km/h for the hold test.
4. Drift, Street X and Drag presets are not in free roam: a Quick Race check per tab, or keep their defaults as "not measured" on the card.
5. A second car (the RX-8 runs of r3k are unfinished).

## 3m. Answer to the owner: "ile to jest <5%? dużo czy mało? daje REALNE korzyści?" (measured 2026-11-09, 3000GT, setup 0, 100 game runs, all valid except one test)
Evidence: tools repo `docs/game-check-r3m.md` section 2, `docs/game-check-r3m-table.md`. New in r3m: slip measured at the **rear axle** (not the car centre), a slalom,
hold at 100 / 150 / 200 km/h, brake + turn, power-on exit, and the **combined** stable set in one game. Every number was measured twice (pass a, pass b): the same to 0.05 deg in 630 of 650 cells.

**How big is 5 %?** The car's rear slides about 11 degrees at 150 km/h in a full-stick turn (baseline). 5 % of that is **about half a degree**, and 5 % of the turn rate (57 deg/s) is **3 deg/s**.
We did not measure lap time, so "5 % = x seconds" is not known. We can only say how much the car moves.

**Owner's question: do the small rows matter?** Answer: **shocks and ride heights, no. The rest, yes.**
| Part | Biggest change we saw | Where | Verdict |
|---|---|---|---|
| Front shocks, rear shocks | 1 % and 1.3 % | any turn | Too small to feel. You are not wrong that they change *something*, but about a hundredth of a degree to a tenth. |
| Front ride height, rear ride height | 3 % and 3.4 % | any turn | Under 5 % in every test. About 0.3 degrees. Not worth a slider. |
| Steering ratio | 8.8 % rear slip, 13 % swing growth | fast left-right turns | Over 5 %. Already a slider. |
| Front springs | 12 % | steady turn at 100 km/h | Over 5 %. Same direction as the sway bars, smaller. |
| Rear springs | 14 % less slip in a steady turn, but 9 % more when braking into the turn | | Over 5 %, mixed. Keep hidden. |
| Brake bias | 16 % (2 degrees) | **only** braking into a turn; 0 % everywhere else | Over 5 %, but only in that one situation. |
| Front sway bar | 28 % (2.5 degrees) | steady turn | Over 5 %. |
| Rear sway bar | 24 % (2 degrees) | exit, steady turn | Over 5 %. The biggest knob that is not tires or aero. |
| Tires and downforce | 25-65 % | any fast turn | Over 5 %. Keep at the top (as r3l). |

So "below 5 %" is **small**: shocks and ride heights stay under 5 % in every test we ran. The rows above 5 % are above it in several tests, not by luck.
The crest test (jump + turn) looked big for shocks (+43 %) but did not follow the setting (middle +43 %, top -1.6 %), so we do not count it.

**Do the changes add up?** Rear slip: the 4 main rows together (stable set) give **-31 to -36 %** in steady turns, about 70-85 % of the sum of the four alone. They mostly add.
Braking into a turn: -20 % together, better than the sum (the three suspension rows alone make it worse; brake bias fixes it).
**Cost:** the car turns less. Steady turn: **-6 % to -11 %** turn rate (50 km/h faster = bigger loss); braking into a turn: **-15 %** turn rate, -5.6 % turned angle. The loose set is the reverse: +33 to +46 % slip, +4 to +8 % turn rate.
This is a trade, not free grip: the stable set holds the rear but the nose turns in less. Earlier text in this file said "costs 2-5 % turn rate": that holds for single rows, **not** for the combined set.

**What this means for the 3 controls above:** "Tył w zakręcie" (rear bar + front bar + front springs) and Braking are justified (many tests > 5 %, combined set confirmed). Steering stays. Shocks and ride heights stay hidden.
Card text for "Tył w zakręcie" should show the pair: slip -35 % **and** turn rate -9 % at the stable end (hold 150).
Not measured: lap time, a second car, Drift / Street X / Drag presets, stick below full (the half-stick crest test is not usable).
