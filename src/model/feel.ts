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
 * What the two driving sliders do at the speeds a player drives, measured in the game (tuner repo docs/game-check-r3i.md C: 3000GT,
 * free roam, collision body off, flat road, setup 0 with only the one row moved to the lowest / highest byte of its box; two passes,
 * identical to 0.01 g / 0.15 m, except the 100 km/h baseline turn, 0.750 or 0.755 g from game to game: its mean is used). Rounded to whole numbers; the text of the cards is built from these and nothing else.
 */
export const DRIVE_SPEEDS = [100, 150, 200];
/** Steering ratio, stick held at 0.4: change in the car's side g (how sharply it turns) at the left / right end, in %, per speed. */
export const STEERING_TURN_PCT: [number, number][] = [[-7, 19], [-2, 22], [-3, 1]];
/** Brake bias, full brake: stopping distance in m at the left end / as set / right end, per speed. */
export const BRAKE_STOP_M: [number, number, number][] = [[21, 23, 28], [46, 48, 57], [80, 83, 93]];

const pct = (n: number): string => (n < 0 ? `${-n} % less` : `${n} % more`);
const steeringWords = (): string => DRIVE_SPEEDS.map((v, i) => `at ${v} km/h ${pct(STEERING_TURN_PCT[i][0])} / ${pct(STEERING_TURN_PCT[i][1])}`).join(', ');
const brakingWords = (): string => DRIVE_SPEEDS.map((v, i) => `from ${v} km/h ${BRAKE_STOP_M[i].join(' / ')} m`).join(', ');

/**
 * Only rows with a measured effect in the game get a slider, and the words say only what was measured (round 3g, tuner
 * repo docs/game-check-r3g.md D and round 3i, docs/game-check-r3i.md C: 3000GT, setup 0, free roam, every row at both ends of its box, each run
 * twice with the same input; numbers that differed between the two runs are not used). Rows dropped there moved stopping
 * distance and side grip by 4 % or less: springs, shocks, sway bars, ride height, tire grip, downforce.
 */
export const FEEL_SLIDERS: FeelSlider[] = [
  // byte 8 ("Steering Ratio" on the Suspension screen; physics R+0x270, setup-bytes.md). Measured (r3i C): same stick 0.4, side g of
  // the path 0.702 / 0.750-0.755 / 0.892-0.894 at 100 km/h (the baseline game gives 0.750 or 0.755: mean used), 0.687 / 0.698 / 0.852 at 150 km/h, 0.543 / 0.561 / 0.566 at 200 km/h (lowest / saved /
  // highest byte); full stick: no change (<= 0.4 % at the three speeds, r3h C); stopping distance unchanged.
  { key: 'steering', screen: 'Suspension', label: 'Steering', low: 'Slower', high: 'Quicker', params: [8],
    basis: 'Moves Steering Ratio. The numbers are measured in the game with a 3000GT (how sharply the car turns, wheel held at 0.4 of full, '
      + 'flat road, two runs gave the same). With the wheel turned fully it changes nothing at 100, 150 and 200 km/h.',
    when: `Same small turn of the wheel, how much the car turns (left end / right end): ${steeringWords()}. A full turn of the wheel: no change.` },
  // brakes FUN_005a4d80: front = 2·pedal·(1−B), rear = 2·pedal·B, B = this row (setup-bytes.md l.120-121). Measured (r3i C): full brake
  // from 100 / 150 / 200 km/h 20.81 / 23.04 / 27.75 m, 45.67 / 48.18 / 56.70 m, 80.16 / 82.73 / 92.60 m (lowest / saved / highest byte);
  // the car stopped within 1.6 degrees of straight every time; turning was not changed (r3h C).
  { key: 'brakes', screen: 'Tires & Brakes', label: 'Braking', low: 'Stops shorter', high: 'Stops longer', params: [18],
    basis: 'Moves Brake Bias: to the right, more brake force goes to the rear wheels. The numbers are measured in the game with a 3000GT '
      + '(full brake to a stop, flat road, two runs gave the same). The car stopped within 2 degrees of straight every time.',
    when: `Full brake, the car stops in (left end / as set / right end): ${brakingWords()}. It stopped straight every time.` },
  // nitrous: one slider, longer = weaker (FUN_005b3100, l.58); seen in the game 2026-11-04 (setup-bytes.md "Confirmed in game":
  // a long and a very short setting were clearly visible in play)
  { key: 'nitrous', screen: 'Nitrous', label: 'Nitrous boost', low: 'Long, gentle', high: 'Short, strong', params: [16],
    basis: 'Moves the Nitrous slider. The game ties both: a shorter shot is a stronger one (seen in the game).',
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
    const { left, right } = sides(model, start, s);
    if (!left && !right) continue;
    const v: FeelView = { ...s, min: left ? -100 : 0, max: right ? 100 : 0, limit: '' };
    if (!right) v.limit = 'Only to the left: your parts do not allow more.';
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
