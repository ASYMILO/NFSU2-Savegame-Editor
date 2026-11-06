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
  /** When a player would move it, in driving words (general car handling, not measured in the game). */
  when: string;
}

/** A slider for one car and tab: the side(s) it can move (-100..0..100) and why a side is closed. */
export interface FeelView extends FeelSlider {
  min: number;
  max: number;
  limit: string;
}

/**
 * Every slider names the game code that uses its rows, and the direction (setup-bytes.md of the tuner repo, section C).
 * The driving words come from textbook car handling; that the game feels that way is not checked in the game.
 */
export const FEEL_SLIDERS: FeelSlider[] = [
  // springs and shocks: FUN_005a3700, F = spring·0.9·compression + 0.9·shock·speed (setup-bytes.md l.115-117). Sway bars are
  // left out: their force code was not found (l.118), so no proof they do anything.
  { key: 'stiff', screen: 'Suspension', label: 'Ride', low: 'Soft, soaks bumps', high: 'Firm, quick to react', params: [0, 4, 1, 5],
    basis: 'Moves Front and Rear Springs and Shocks together (up = stiffer). Sway bars and lowering stay: their effect in the game is not known.',
    when: 'Firmer if the car leans and sways in turns. Softer if bumps throw it off line.' },
  // aero FUN_0059e620: downforce ∝ coefficient × speed term (l.125-126); Street and Pro parts can only lower it (l.53)
  { key: 'downforce', screen: 'Aerodynamics', label: 'Grip at high speed', low: 'Less', high: 'More', params: [21, 22],
    basis: 'Moves Front and Rear Downforce together. Downforce presses the car down more the faster it goes.',
    when: 'More if the car slides in fast turns.' },
  // brakes FUN_005a4d80: front = 2·pedal·(1−B), rear = 2·pedal·B, B = this row (l.120-121)
  { key: 'brakes', screen: 'Tires & Brakes', label: 'Braking', low: 'Stable, straight', high: 'Turns in more', params: [18],
    basis: 'Moves Brake Bias: to the right, more brake force goes to the rear wheels.',
    when: 'Left if the back steps out when you brake. Right if the car will not turn while braking.' },
  // tire friction FUN_005a8280: force = grip × load (l.122-125); the row can only lower grip (l.53)
  { key: 'rearGrip', screen: 'Tires & Brakes', label: 'Rear end', low: 'Slides more (drift)', high: 'Grips (as the tires give)', params: [20],
    basis: 'Moves Rear Grip. The game lets you only lower it from what your tires give.',
    when: 'Left if you want the back to slide, for example in Drift.' },
  // nitrous: one slider, longer = weaker (FUN_005b3100, l.58); extra torque = torque × intensity (FUN_00594300, l.127)
  { key: 'nitrous', screen: 'Nitrous', label: 'Nitrous boost', low: 'Long, gentle', high: 'Short, strong', params: [16],
    basis: 'Moves the Nitrous slider. The game ties both: a shorter shot is a stronger one.',
    when: 'Short and strong for a quick burst. Long and gentle to spread it over the race.' },
];

/** Slider positions, -100..100 per key (missing = 0 = as now). */
export type Feel = Record<string, number>;

/** The value of a row now and its box, in the screen's numbers; nitrous as seconds with right = shorter (sign -1). */
function rowRoom(model: DynoModel, start: ArrayLike<number>, param: number): { now: number; min: number; max: number; sign: 1 | -1 } | null {
  if (param === 16) {
    const n = NitroScreen.open(model, start);
    return n ? { now: n.secondsOf(start[16]), min: n.scale.min, max: n.scale.max, sign: -1 } : null;
  }
  const info = rowInfo(model, start, param);
  if (!info) return null;
  const { min, max } = rowScale(info);
  return { now: rowShown(info, start[param]), min, max, sign: 1 };
}

/**
 * The sides a slider can move: a side is open only when every open row of the slider has room that way, so the rows always
 * move together (one axle alone would change the balance instead: Street/Pro downforce sits at the top of its box at the
 * front only, and rear grip is always at the top, setup-bytes.md l.53).
 */
function sides(model: DynoModel, start: ArrayLike<number>, s: FeelSlider): { left: boolean; right: boolean; open: number[] } {
  const rooms = s.params.map((p) => ({ p, r: rowRoom(model, start, p) })).filter((x) => x.r !== null);
  const eps = 1e-6;
  // right = the row's value up (nitrous: duration down)
  const up = (r: NonNullable<ReturnType<typeof rowRoom>>): boolean => (r.sign > 0 ? r.now < r.max - eps : r.now > r.min + eps);
  const down = (r: NonNullable<ReturnType<typeof rowRoom>>): boolean => (r.sign > 0 ? r.now > r.min + eps : r.now < r.max - eps);
  return {
    left: rooms.length > 0 && rooms.every((x) => down(x.r!)),
    right: rooms.length > 0 && rooms.every((x) => up(x.r!)),
    open: rooms.map((x) => x.p),
  };
}

/** The sliders a car and tab can use: rows unlocked and room on a side; nitrous not in Drift and Street X (the race turns it off). */
export function feelSliders(model: DynoModel, start: ArrayLike<number>, setups: number[]): FeelView[] {
  const out: FeelView[] = [];
  for (const s of FEEL_SLIDERS) {
    if (s.key === 'nitrous' && setups.every((k) => k === 2 || k === 3)) continue;
    const { left, right, open } = sides(model, start, s);
    if (!left && !right) continue;
    let v: FeelView = { ...s, min: left ? -100 : 0, max: right ? 100 : 0, limit: '' };
    if (s.key === 'downforce' && open.length === 1) {
      // one body part only: one axle moves, so it shifts grip between front and rear (FUN_0059e620 applies each at its own point)
      const front = open[0] === 21;
      v = { ...v, label: `${front ? 'Front' : 'Rear'} grip at high speed`,
        basis: `Moves ${front ? 'Front' : 'Rear'} Downforce only (only a ${front ? 'front bumper' : 'spoiler'} opens it). One end only: it shifts grip between front and rear.` };
    }
    if (!right) v.limit = s.key === 'rearGrip' ? 'Only to the left: the game lets you only lower it.' : 'Only to the left: your parts do not allow more.';
    else if (!left) v.limit = 'Only to the right: your parts do not allow less.';
    out.push(v);
  }
  return out;
}

/** `pos` (-1..1) of the way from `now` to `lo` (negative) or `hi` (positive). */
const toward = (now: number, lo: number, hi: number, pos: number): number => (pos >= 0 ? now + pos * (hi - now) : now + pos * (now - lo));

/**
 * The setup `base` with the feel rows set from `start` (the rows as they are now) by the slider positions.
 * Rows with no part stay as they are. Engine rows (Optimize's) are not touched. A closed side (see {@link feelSliders}) does nothing.
 */
export function withFeel(model: DynoModel, start: ArrayLike<number>, base: ArrayLike<number>, feel: Feel): Uint8Array {
  let out: Uint8Array = Uint8Array.from(base);
  for (const s of FEEL_SLIDERS) {
    let pos = Math.max(-100, Math.min(100, feel[s.key] ?? 0)) / 100;
    if (!pos) continue;
    const side = sides(model, start, s);
    if ((pos > 0 && !side.right) || (pos < 0 && !side.left)) pos = 0;
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
