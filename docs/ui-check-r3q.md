# UI check r3q (2026-11-16, after audit fixes f7ebb77 / 580522e / 55944ea)

Page built from `feat/tuner-3o` (`npm run build`), served on 127.0.0.1, driven in headless Brave over the debug port
(driver: laps repo `tools/ui/cdp.mjs`). Save: laps `owner-test/A.zip` (10 cars, parts at the top level, all setups factory),
game file: laps `data/game/GLOBALB.BUN`. Cars are test cars (Honda Civic FWD slot 2, Toyota Supra RWD slot 1, Vauxhall Corsa FWD slot 5).

| Check | Result |
|---|---|
| "50-120 mph pull" row, Circuit card, "Best (save only)" mode (Now / Best) | present: Civic 6.50 s now, 6.08 s best (`r3q-civic-fwd-circuit-best.png`) |
| same row, "Setup you can make with keys" mode (Now / With keys / Best) | present: Civic 6.50 / 6.12 / 6.08 (`r3q-civic-fwd-circuit-keys.png`); Supra 7.50 / 6.60 / 6.28 (`r3q-supra-rwd-circuit-keys.png`) |
| same row, URL Race card | present, same numbers (`r3q-civic-fwd-url-keys.png`) |
| row absent on Drag / Drift / Street X | absent (text of all three cards checked; `r3q-civic-fwd-drag-keys.png`) |
| gap line wording | "50-120 mph pull 0.04 s quicker, 0-100 0.02 s slower (a launch figure, not what a lap race counts)": equals 6.12 - 6.08 in the table |
| FWD dose on Circuit | Civic: "Optimize moved the four rows 50 %", front slider "Now at 50 %", rear slider "Now at 0 %" |
| FWD dose on URL | none: note "on URL Optimize leaves the four rows as they are", both sliders "Now at 0 %"; same on Drag / Drift / Street X |
| RWD car (Supra) | no default: "Optimize leaves the four rows as they are ... no default", both sliders 0 % on every tab |
| Sliders | Corsa (FWD): rear slider to max -> rear 100 %, front switches to 0 %; no page error |
| Page errors | none (all runs) |

Display bugs found: none, nothing changed in `src/`.
Listed, not fixed (text, not display): the evidence line under the sliders says "Two front-drive test cars tried it"; the Golf (Step 20.3) is a third FWD car on the short track for the front-bites move.
Not checked: other browsers, narrow screens, Windows. AngularJS comes from a CDN; on a first load it sometimes booted before `main.js` (modulerr) and the driver reloads once; not seen in a normal tab.
