# Narada: the "How the car drives in corners" block (2026-11-16)

Design review only. No handling number, no dose and no `src/` file was changed. Branch `feat/tuner-3o`, read at f37b646.
Mockup: `docs/img/narada-handling-fwd-circuit.png`, `docs/img/narada-handling-rwd-circuit.png` (static HTML mock `docs/img/narada-handling-mock.html`, headless Brave; not the built page).

Owner, verbatim: "opcja how the car drives in corners - jakoś mi to nie brzmi, i 2 suwaki które z tego co rozumiem korygują nad/pod sterowność - to nie powinien być jeden suwak czy się mylę? no ale jakieś te opcje są dziwne nie wiem... - może niech się fable wypowie o tym albo zrobi naradę".
Owner rules, verbatim: "pamiętaj że my nie tunujemy mojego samochodu tylko tworzymy tuner dla całej społeczności graczy"; "nie chodzi o 'najlepiej wyglądające wyniki' tylko o faktyczną jazdę w grze".

**Decision in one sentence:** should the block become one two-sided slider, and with what words, default mark, evidence and place on the card?

## 1. Verdict

- **Votes:** 4 for, 0 against, 2 conditional (Sceptic, Cost).
- **Verdict: change it (poprawić).** The owner is right: it is one control. The code already treats it as one axis (`withHandling`: `axis = (h.stable - h.push) / 100`, the same four rows in opposite directions; the page switches one slider off when the other moves). Two sliders show two cures that do not exist.
- **Roles that weigh most:** the User (the block must read in driving words at first sight) and the Sceptic (every stop of the slider must have a measurement or say that it has none).
- **Condition:** the slider stops only where something was measured: 5 stops (full / half / as it is / half / full), not 9. The 25 % and 75 % stops were never driven on any car (laps `docs/laps.md` Step 20.3 "Not driven", `docs/handoff-post-audit.md` Open 2).

Answers to the five questions:

| # | Question | Answer |
|---|---|---|
| 1 | One slider or two | **One**, two-sided, "as it is" in the middle. Same shape as Steering, Braking and Nitrous (all -100..100, `feel.ts`) |
| 2 | Heading and labels | Heading **"Cornering"**. Ends say what you get and what it costs: **"Front bites more** (rear slides more)" and **"Rear holds more** (turns in less)". The owner's symptom words stay as the one help line |
| 3 | Default per drivetrain | Unchanged numbers. FWD on Circuit: the thumb starts at "half, front bites", with a mark **"Tuner's pick"** under that stop. Everything else: thumb in the middle, no mark |
| 4 | Intro and evidence | Intro: one or two short sentences, no numbers. One evidence line that follows the thumb. All numbers folded under "What was measured" |
| 5 | Place on the card | Stays above the game screens (it changes keys on two screens), but looks like the other three sliders. One line names the two screens. Hidden on Drag only after the game code is checked (section 5) |

## 2. The six roles

- 🔧 **Builder (Wykonawca): for.** The model is one axis already; `Handling { stable, push }` can stay inside and one page value -100..100 maps onto it (left = `push`, right = `stable`). What breaks: `handlingSliders` returns two entries and the tests count on that; `tunerFeel` has the switch-off branch; the evidence line must be picked per stop. About 80-120 lines in `handling.ts`, `tuner-controller.ts`, `index.html`, plus tests. Not a "small" change, so not in this round.
- ⚠️ **Sceptic: conditional.** Three holes. (a) Step 25 offers 25 % and 75 %, which nobody drove; a slider that looks smooth claims a smooth effect. (b) Several stops have no measurement on a drivetrain (table in section 4): all-wheel drive has none on the "front bites" side at all. One slider makes those stops look as proven as the others unless the line under it says "not measured". (c) The plain line for FWD says "never slower", but the Golf at parts level 1 lost 0.15 s on lap 1 and gained it back (sum of laps 1-3: 0.00 s, laps Step 21.2). The text must say "faster or the same over the same laps". I challenge the User's wish for "one simple slider": simple must not hide that the rear side is a comfort choice with no lap gain on any test car.
- 🚀 **Visionary: for.** One axis with five named stops is a shape that takes new measurements without a redesign: a new car or dose only fills a cell of the per-stop table. In six months the same cell table can hold Drift or Street X results, and the per-tab default becomes one more mark on the same track.
- 👤 **User (the owner's words): for.** "to nie powinien być jeden suwak" - yes. A player does not think "which of two problems do I have"; they feel the car push wide or the tail go, and they move away from it. Against the Sceptic: "not measured" on a stop is fine, a wall of numbers is not. The intro today is 60 words with eight numbers; nobody reads it. The heading "How the car drives in corners" is a sentence; the other blocks are one word (Steering, Braking, Nitrous boost).
- 💰 **Cost: conditional.** Design doc and mock: this round, done. The code change is an estimate of 2-3 hours with tests and a browser check (estimate, not measured). No game time is needed: no number changes. Condition: do it as one change with the texts below, not in steps, so the screenshots are redone once.
- 🎓 **Domain expert (game handling): for.** The measurements show one trade, not two knobs. Toward the "front bites" ends the car turns more and the rear slides more (Peugeot 106, full move: rear slide 9.7° to 15-20°; Civic Si 10.7 / 11.1° to 15.6 / 16.4°, laps Steps 15.3, 17.2). Toward the "rear holds" ends the rear slides less and the car turns less (3000GT, full move: rear slides 31-36 % less, turns 6-11 % less, `handling-design-r3l.md` 3m). So each end must carry its cost in the label. The effect differs by drivetrain, so the evidence line must be the car's own drivetrain, as today.

Clash: the Sceptic against the User on how much to show. Settled as: one line per stop in plain words (User), and that line is "Not measured on ..." where there is no lap (Sceptic).

## 3. The design

### 3.1 The control

```
Cornering   [Tuner's pick]                                   (badge: "Tuner's pick" on FWD Circuit while the thumb is on it, else "Optional")
<intro, one or two sentences>

Front pushes wide? Move it left.  Rear steps out? Move it right.

 Front bites more   |-----●-----|-----|-----|   Rear holds more
 (rear slides more) full  half  as it  half  full   (turns in less)
                          ▲     is
                     Tuner's pick                              (the mark: FWD on Circuit only)

<one evidence line for the stop the thumb is on>
▸ What was measured        ▸ What it changes
Changes keys on two screens below: Suspension and Tires & Brakes.   [Back to the Tuner's pick]
```

| Part | Value |
|---|---|
| Range | -100..100, **step 50**: 5 stops. Left = `push` (anti-push ends), right = `stable`. Middle = the four rows as they are in the save (or after key C without a save) |
| Stop names (under the track) | full · half · as it is · half · full |
| Left end label | **Front bites more** / small: rear slides more |
| Right end label | **Rear holds more** / small: turns in less |
| Help line | Front pushes wide? Move it left. Rear steps out? Move it right. |
| Mark | a small "▲ Tuner's pick" under the stop Optimize chose; drawn only where a default exists (FWD, Circuit: left half) |
| Reset | link "Back to the Tuner's pick" (FWD Circuit) or "Back to as it is" (all others), shown only when the thumb is elsewhere |
| A side with no room | if no row can move toward one side (`room()`), that half is not offered: the slider runs from the middle to the other end only, and one line says "This car's parts leave no room to the left / right." |
| Not kept | as today: the position is not stored between visits (audit m9). Text in 3.4 |

Why the ends name the result and not the symptom: the other sliders do (Slower / Quicker, Stops shorter / Stops longer). An end called "rear steps out" could mean "make it step out" or "cure it". The symptom words live in the help line, which says which way to move.

Why left = front: the front of the car first, the rear second, in the order a player reads; and the FWD default then sits left of the middle, where the "Tuner's pick" mark is easy to see against the middle "as it is".

### 3.2 Default per drivetrain and tab (numbers unchanged: `ANTI_PUSH_DOSE` 0.5, `DOSE_TABS` [0])

| Drivetrain | Tab | Thumb starts | Mark | Badge |
|---|---|---|---|---|
| Front-wheel drive | Circuit | left half (-50) | "Tuner's pick" at -50 | Tuner's pick |
| Front-wheel drive | URL, Drift, Street X | middle | none | Optional |
| Rear-wheel drive, all-wheel drive | every tab | middle | none | Optional |
| any | Drag | see section 5 | | |

### 3.3 Intro text (final wording; replaces `handlingNote`, numbers move to the fold)

| Case | Text |
|---|---|
| FWD, Circuit | Front-wheel drive: the Tuner already moved this halfway to "Front bites more". The front-drive test cars lapped faster or the same on short circuits with it. |
| FWD, URL | Front-wheel drive: on URL the Tuner leaves this in the middle. One test car drove a URL track with the half move and gained nothing. |
| FWD, other tabs | Front-wheel drive: on this race type the Tuner leaves this in the middle. Nobody drove this race type with it moved. |
| RWD, AWD | The Tuner leaves this in the middle. On the rear-drive and all-wheel-drive test cars neither side made laps faster. Move it only if the car bothers you. |

Cut from the intro: "the four rows", every lap number, "the full move gains 2 to 3 times more ... lost 2.9 s" (kept as the evidence line of the "full" stop, where it belongs).

### 3.4 The line under the slider, per stop (final wording; replaces `PLAIN_LINES`)

One line, for the stop the thumb is on and the car's drivetrain. Sources are the existing `FINDINGS` entries; no new number.

| Stop | Front-wheel drive | All-wheel drive | Rear-wheel drive |
|---|---|---|---|
| Front bites, full | Two front-drive test cars: faster at the same speed, but at the limit one lost 2.9 s a lap on one track, hit walls sooner and spun. | Not measured on an all-wheel-drive car. | Not measured on a rear-drive car. Half was already slower. |
| Front bites, half | Three front-drive test cars: faster or the same over the same laps on short circuits. On Freemont faster for one, no change for another. | Not measured on an all-wheel-drive car. | One rear-drive test car: the rear slid much more and the lap was slower. |
| As it is | Nothing is moved here: the car corners as your setup has it. | same | same |
| Rear holds, half | Two front-drive test cars: the rear slid a little less, laps a little slower. | One all-wheel-drive test car: a little slower on the short circuit, no change on Freemont. | Two rear-drive test cars: the rear slid less at moderate speed, no lap gained or lost; one touched a wall at a speed the standard setup passes. |
| Rear holds, full | Not measured on a front-drive car. | One all-wheel-drive test car on the test bench: the rear slid about a third less and the car turned less. No lap was driven. | Not measured on a rear-drive car. |

Evidence for each cell (all already in `FINDINGS`, `src/model/handling.ts`):

| Stop | Measured (test cars; negative = faster) | Source |
|---|---|---|
| Front bites, full, FWD | Peugeot 106: Freemont -0.70 s / 2 laps, short circuit -0.97 s / 2 laps, rear slide 9.7° to 15-20°. Civic Si: -1.42 s / 2 laps and -2.42 s / 3 laps at the same speed; at its limit 53.9 against 51.0 s a lap on one layout (2.9 s lost), about 0.4 s faster on the other; wall hits at a lower test speed, a spin | laps Steps 15.3, 17.2-17.5, 18.3, 18.5 |
| Front bites, half, FWD | Peugeot 106: Freemont -0.23 to -0.28 s, short circuit -0.95 s / 3 laps. Civic Si: -1.25 s / 3 laps, -0.53 s / 2 laps, Freemont no change, at its limit never more than 0.5 s slower; URL track no gain (-0.08 s / 2 laps, +0.18 s / 5 laps). Golf, parts level 3: -1.53 s / 3 laps; parts level 1: 0.00 s / 3 laps (+0.15 / -0.10 / -0.05), -0.23 / -0.28 s on the two faster same-target laps | laps Steps 17.5, 18.3, 18.5, 20.3, 21.2 |
| Front bites, half, RWD | 350Z: Freemont rear slide 16.0 / 15.5° to 24.6 / 22.1°, +0.83 s | laps Steps 17.2, 17.4 |
| Rear holds, half, FWD | Peugeot 106: +0.05 s Freemont, +0.05 s / 2 laps short circuit. Civic Si: Freemont +0.22 s, rear slide 10.7 / 11.1° to 9.9 / 9.6° | laps Steps 17.2, 17.4 |
| Rear holds, half, AWD | 3000GT: Freemont -0.03 s (inside the noise), short circuit +0.23 s / 2 laps on both layouts | laps Steps 14.4, 16.2 |
| Rear holds, half, RWD | RX-8: Freemont -0.10 s (one run each), short circuit -0.05 and 0.00 s / 2 laps. 350Z: rear slide 20.2° to 15.9° and 17.8° to 13.7° at moderate speed, no change at its limit; Freemont -0.40 / -0.32 s (the factory set touches the wall there), short circuit -0.10 s / 2 laps with a wall touch in the last corner | laps Steps 14.4, 16.2, 17.4, 17.5 |
| Rear holds, full, AWD | 3000GT bench: rear slides 31-36 % less in steady turns, turns 6-11 % less; no lap driven | `handling-design-r3l.md` 3m |
| every other cell | nie zmierzone (not measured) | |

Folds, unchanged in content:
- **What was measured**: the `findingsFor` list of the car's drivetrain, now one list for the whole slider, grouped by stop.
- **What it changes**: "Moves Front Springs, Front Sway Bar, Rear Sway Bar and Brake Bias, each toward the end of this car's own range. Left: springs and front bar softer, rear bar stiffer, brakes toward the rear. Right: the opposite. Measured in the game with test cars, not computed. Test cars only; nobody measured every car."

Small lines under the block (replace the 50-word footnote):
- "Changes keys on two screens below: Suspension and Tires & Brakes. Brake Bias is also moved by the Braking slider."
- "Not kept: next time the Tuner's pick for your car comes back." (FWD on Circuit) / "Not kept: next time it is back in the middle." (all others)

Cut: "Moves (↑ higher number, ↓ lower number): Front Springs ↑ ..." and "Now at 50 % of the way to the ends of this car's own ranges" (both go into "What it changes"; the stop name under the thumb already says "half"); "Both sliders use the same four rows in opposite directions, so only one can be on" (no longer needed); the Polish words in the labels ("tył ucieka", "przód nie skręca / pcha"): the page is English, the words were notes for the owner.

## 4. What the panel did not settle

| Item | State |
|---|---|
| Stops with no measurement (5 of 12 cells) | Offered, with the line "Not measured on ...". The other choice is to cut the "front bites" side on all-wheel drive, where no stop was driven. Kept because the four rows move the same way on every car (`withHandling`), and the line says what is not known |
| Step 50 instead of 25 | A UI choice, not a handling number: the dose stays 0.5. A player loses the 25 % and 75 % stops that have no measurement |
| "faster or the same" wording for the FWD half stop | Golf level 1 lost 0.15 s on one lap and the sum of three laps was 0.00 s. "Never slower" in today's `PLAIN_LINES.push.fwd` is too strong for a single lap; the new line says "over the same laps" |

## 5. Place on the card, next to Steering, Braking, Nitrous

| Slider | Where it sits today | Moves rows on |
|---|---|---|
| Cornering | own box above the game screens | Suspension (3 rows) and Tires & Brakes (1 row) |
| Steering | inside the Suspension screen | Suspension |
| Braking | inside the Tires & Brakes screen | Tires & Brakes |
| Nitrous boost | inside the Nitrous screen | Nitrous |

- Keep that order. The other three sit next to the keys they change; Cornering changes keys on two screens, so it sits above both and names them.
- Make it look like the other three: same slider row, same "What it changes" fold, a one-word heading, the green left border kept so the Tuner's own default stands out.
- Braking and Cornering both move Brake Bias (audit m3). One line under each says so (text in 3.4).
- **Drag:** a straight line has no corner, so the block should not show there. Not proven from the game code in this round (no file and line for "Drag ignores these four rows"), so it is listed, not decided. Check first, then hide.

## 6. For the next round (code, not done here)

1. `handling.ts`: `handlingSliders` returns one slider (`key` `handlingBalance`, -100..100, `start` -50 on FWD Circuit); `PLAIN_LINES` becomes the per-stop table of 3.4; `handlingNote` gets the texts of 3.3. `Handling`, `withHandling`, `handlingDefault`, `ANTI_PUSH_DOSE`, `DOSE_TABS`, `FINDINGS` stay as they are.
2. `tuner-controller.ts`: one value in `t.feel`, mapped to `{ stable, push }`; the switch-off branch in `tunerFeel` goes.
3. `index.html`: one slider row with `step="50"`, a `datalist` or five labels for the stops, the mark, the reset link.
4. Tests: default per drivetrain and tab maps to the same bytes as today (same `withHandling` result for FWD Circuit at -50), each stop picks its line, a side with no room is not offered.
5. Screenshots `r3q-*` redone once.
