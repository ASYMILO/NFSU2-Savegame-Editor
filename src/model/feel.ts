/**
 * "Feel" sliders of the Tuner: the player's own choice for the screens Optimize does not tune (the dyno measures speed,
 * not grip or handling, and the game has no other measure of handling). A slider moves the game's rows from where they
 * are now (0 = as now) toward one end of the box the installed parts allow; nothing here claims a best value.
 * What each row does in the race is from the game's code (tuner repo docs/setup-bytes.md section C, line numbers below).
 */
import type { DynoModel } from './dyno.js';
import { NitroScreen, rowInfo, rowScale, rowShown, setRowShown } from './tune-keys.js';

export interface FeelSlider {
  key: string;
  /** Game screen the rows are on. */
  screen: string;
  /** In driving words: what the player feels. */
  label: string;
  /** Words at the left (-100) and right (+100) end, in driving words. */
  low: string;
  high: string;
  params: number[];
  /** What it changes in the game, in the game's words (shown folded). */
  basis: string;
}

/**
 * Every slider names the game code that uses its rows, and the direction (setup-bytes.md of the tuner repo, section C).
 * The driving words come from textbook car handling; that the game feels that way is not checked in the game.
 */
export const FEEL_SLIDERS: FeelSlider[] = [
  // springs and shocks: FUN_005a3700, F = spring·0.9·compression + 0.9·shock·speed (setup-bytes.md l.115-117). Sway bars are
  // left out: their force code was not found (l.118), so no proof they do anything.
  { key: 'stiff', screen: 'Suspension', label: 'Ride', low: 'Soft, soaks bumps', high: 'Firm, quick to react', params: [0, 4, 1, 5],
    basis: 'Moves Front and Rear Springs and Shocks together (up = stiffer). Sway bars and lowering stay: their effect in the game is not known.' },
  // aero FUN_0059e620: downforce ∝ coefficient × speed term (l.125-126); Street and Pro parts can only lower it (l.53)
  { key: 'downforce', screen: 'Aerodynamics', label: 'Grip at high speed', low: 'Less', high: 'More', params: [21, 22],
    basis: 'Moves Front and Rear Downforce together. Downforce presses the car down more the faster it goes. Street and Pro body parts can only lower it.' },
  // brakes FUN_005a4d80: front = 2·pedal·(1−B), rear = 2·pedal·B, B = this row (l.120-121)
  { key: 'brakes', screen: 'Tires & Brakes', label: 'Braking', low: 'Stable, straight', high: 'Turns in more', params: [18],
    basis: 'Moves Brake Bias: to the right, more brake force goes to the rear wheels.' },
  // tire friction FUN_005a8280: force = grip × load (l.122-125); the row can only lower grip (l.53)
  { key: 'rearGrip', screen: 'Tires & Brakes', label: 'Rear end', low: 'Slides more (drift)', high: 'Grips', params: [20],
    basis: 'Moves Rear Grip. It can only go down from what your tires give.' },
  // nitrous: one slider, longer = weaker (FUN_005b3100, l.58); extra torque = torque × intensity (FUN_00594300, l.127)
  { key: 'nitrous', screen: 'Nitrous', label: 'Nitrous boost', low: 'Long, gentle', high: 'Short, strong', params: [16],
    basis: 'Moves the Nitrous slider. The game ties both: a shorter shot is a stronger one.' },
];

/** Slider positions, -100..100 per key (missing = 0 = as now). */
export type Feel = Record<string, number>;

/** The sliders a car and tab can use: at least one row unlocked; nitrous not in Drift and Street X (the race turns it off). */
export function feelSliders(model: DynoModel, start: ArrayLike<number>, setups: number[]): FeelSlider[] {
  return FEEL_SLIDERS.filter((s) => {
    if (s.key === 'nitrous') return !setups.every((k) => k === 2 || k === 3) && NitroScreen.open(model, start) !== null;
    return s.params.some((p) => rowInfo(model, start, p) !== null);
  });
}

/** `pos` (-1..1) of the way from `now` to `lo` (negative) or `hi` (positive). */
const toward = (now: number, lo: number, hi: number, pos: number): number => (pos >= 0 ? now + pos * (hi - now) : now + pos * (now - lo));

/**
 * The setup `base` with the feel rows set from `start` (the rows as they are now) by the slider positions.
 * Rows with no part stay as they are. Engine rows (Optimize's) are not touched.
 */
export function withFeel(model: DynoModel, start: ArrayLike<number>, base: ArrayLike<number>, feel: Feel): Uint8Array {
  let out: Uint8Array = Uint8Array.from(base);
  for (const s of FEEL_SLIDERS) {
    const pos = Math.max(-100, Math.min(100, feel[s.key] ?? 0)) / 100;
    if (!pos) continue;
    for (const param of s.params) {
      if (param === 16) {
        const n = NitroScreen.open(model, start);
        if (!n) continue;
        const { min, max } = n.scale;
        // right = shorter: the duration goes down
        const next = n.to(toward(n.secondsOf(start[16]), min, max, -pos)).setupBytes();
        out[16] = next[16]; out[17] = next[17];
        continue;
      }
      const info = rowInfo(model, start, param);
      if (!info) continue;
      const { min, max } = rowScale(info);
      // the shown number grows with the physical value on these rows (springs, bars, downforce, grip, rear brake share)
      const next = setRowShown(model, out, param, toward(rowShown(info, start[param]), min, max, pos));
      if (next) out = next;
    }
  }
  return out;
}
