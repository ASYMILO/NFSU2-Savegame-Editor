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
