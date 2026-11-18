# Handoff r3r: items 1-10 of `narada-tuner-whole.md` section 6 (2026-11-18/19)

Branch `feat/tuner-3o` of the editor worktree, pushed to remote `fork` only (never `origin` = the author). No handling number, dose (`ANTI_PUSH_DOSE`, `DOSE_TABS`) or objective was changed.

Tests: `NFSU2_GLOBALB=<laps>/data/game/GLOBALB.BUN npm test` = **171 tests, 171 pass, 0 fail, 0 skipped** (baseline before this round: 165). `src/test/save.test.ts`: no diff against `origin/main`.

## Items

| # | Item | State | Commit |
|---|---|---|---|
| 1 | "Circuit and URL" text fixed (Circuit tab, also Sprint and career URL); steps name their cause ("From the Cornering setting above" / "your sliders below" / both, `stepCause`); Braking slider is "below" | done | 0ca5eba |
| 2 | Evidence corrected: "rear holds" full / 75 % / 25 % lines for FWD, RWD, AWD in `FINDINGS` (dose words quarter / half / three-quarter / full); `narada-handling-ui.md` cells and the "never driven" sentence fixed | done | a52e747 |
| 3 | Drag card: "Quarter mile" row (Now / With keys / Best); the gap line and `largestGap` lead with it | done | bbd23c6 |
| 4 | Cornering: one two-sided slider, 9 stops (steps of 25 %), one line per stop; "Tuner's pick" only on a driven stop; FWD "three quarters, front bites" carries the full stop's warning; a side with no room is not offered | done | a8dfdf9 |
| 5 | Cornering block folded to one summary line ("Cornering: half, front bites (Tuner's pick). Change"); stays open while the slider moves | done | 84418d0 |
| 6 | FWD Circuit note: tab also used by Sprint and career URL; Sprint never driven, one URL test no gain | done | ae5407e |
| 7 | Steering and Braking visible line starts "Test car 3000GT." | done | 4748f12 |
| 8 | Grip / downforce check line on Circuit and URL cards | done, **with a deviation** (below) | 387a01c |
| 9 | Drift and Street X cards: "Engine only. Handling is not measured for this race, and the race changes grip itself." (`cardNote`) | done | 65e0c7a |
| 10 | Cornering position kept per car and tab in this browser (`corners` in prefs, key `carHash:tab`, only when it differs from the Tuner's start, max 100 entries) | done | e04b0f6 |

(The display fix to the summary line, a stray space before the colon, is in the last commit with this file.)

## Deviations and findings

- **Item 8 reference is the factory value, not the top of the range.** On the 3000GT with level-3 parts the factory downforce (5.36 / 4.96) is below the top (6.36): "below the top" would warn every player at the factory setting. The line fires when a row is below what key C gives, says "Put it back to <factory> or higher", and keeps the evidence (downforce not in the drag term, `FUN_0059e620`; dyno does not use grip or downforce; 3000GT bench: low front grip / downforce could not hold 200 km/h, game-check-r3h B and C). Owner may prefer the literal "top" rule: one comparison in `gripChecks` (`src/model/handling.ts`).
- **`room()` fix (inside item 4).** A row within half a key step of its end now counts as "no room". Before, Peugeot front springs after a full move (0.04 against box end 0) still counted as having room, so the "no room to the left" side was never closed.
- **Item 10 reset bug found in the browser check and fixed:** a card shared by Circuit and URL wrote the Circuit position to URL too. Reset now deletes the record, so each tab gets its own default.
- The brief names `tools/native/laps/cdp.mjs`; the driver is `tools/ui/cdp.mjs` in the laps worktree. Headless Brave needs `--no-sandbox` inside the tool sandbox.
- Item 16 (Polish words): existing words kept exactly, no new Polish text. They now live in one place, `OWNER_WORDS` and `NOT_MEASURED` in `src/model/handling.ts` (the help line "Front pushes wide (przód nie skręca / pcha)? ... Rear steps out (tył ucieka)?"). Swap or empty them when the owner answers. The "nie zmierzone" lines in the "What was measured" fold stay.
- The slider track is filled green from the left end up to the thumb (browser default, same as Steering and Braking). On a two-sided slider this can read as "full front bites is filled". Not changed: cosmetic, the stop labels and the line below are unambiguous.

## Screenshots (headless Brave, fresh build, save `laps/owner-test/A.zip`, game file `laps/data/game/GLOBALB.BUN`; test cars)

`docs/img/r3r-civic-fwd-circuit-keys.png` (Civic, FWD, Circuit, block folded), `r3r-civic-fwd-circuit-corner-open.png` (same, block open), `r3r-civic-fwd-drag-keys.png` (Drag tab: Quarter mile row 10.90 / 10.22 / 10.22 s), `r3r-supra-rwd-circuit-keys.png`, `r3r-supra-rwd-circuit-corner-open.png` (Supra, RWD, thumb in the middle, no mark). Looked at all of them: no page error; the one display bug (space before the colon in the summary line) was fixed and re-shot.

Browser check of item 10 (not a unit test): Civic moved to "as it is" -> kept; same car again -> 0; other car (Supra) unaffected; reset -> back to -50 and the record is gone.

## Open

- Items 11-15 (game runs, owner laps, trim "Higher top speed") not in this round. Item 16: owner question above.
- Not checked: narrow screens of the new slider (CSS stacks it under 560 px, not looked at), other browsers, Windows; the item 8 line was not seen on a built page (no test save has a lowered grip row; unit-tested only).
