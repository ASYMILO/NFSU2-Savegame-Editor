/**
 * Handling of the Tuner (round 3o): the car's drivetrain from the game data, the four rows that steer how the rear and the
 * front hold (front springs, front sway bar, rear sway bar, brake bias), the default Optimize writes for them, one two-sided
 * "Cornering" slider with nine stops (steps of 25 %), what was measured at each stop, and the advanced list of every row.
 *
 * Why these rows and these ends: laps repo docs/laps.md Steps 14-17 (lap tests on five test cars, see {@link FINDINGS}) and
 * docs/handling-design-r3l.md section 3m of this repo (bench tests). Nothing here is a model of the game: every number shown
 * to a player is a measurement quoted with its source, or "nie zmierzone" (not measured).
 */
import type { DynoModel } from './dyno.js';
import { toward } from './feel.js';
import { ROW_LABELS, ROW_ORDER, shownText } from './hand-input.js';
import { NitroScreen, rowInfo, rowScale, rowShown, setRowShown } from './tune-keys.js';

// ---- drivetrain ------------------------------------------------------------------------------------------------------

export type Drivetrain = 'fwd' | 'awd' | 'rwd';
export const DRIVE_WORDS: Record<Drivetrain, string> = { fwd: 'Front-wheel drive', awd: 'All-wheel drive', rwd: 'Rear-wheel drive' };

/**
 * The car's rear-drive share, physics value p[0x1C0] (GLOBALB.BUN car block, physics at +0x110; a transmission part may replace
 * it, DynoModel.build): 0 = all front, 1 = all rear. Read from the game data, never guessed from the car's name.
 */
export const driveShare = (model: DynoModel): number => model.base.f[0x1c0 >> 2];

/**
 * FWD below 0.2, RWD above 0.8, AWD between: the game's own split (FUN_005a7530 for the race-type preset, FUN_0059b5c0 for the
 * wheel radius; laps repo docs/laps.md Step 14.2). float32 compare as the game does. Read for every car: 3000GT 0.5, RX-8 1.0,
 * Peugeot 106 0.0.
 */
export function drivetrainOf(share: number): Drivetrain {
  const b = Math.fround(share);
  return b < Math.fround(0.2) ? 'fwd' : b > Math.fround(0.8) ? 'rwd' : 'awd';
}

// ---- the four rows ---------------------------------------------------------------------------------------------------

/**
 * Rows that move how the rear and the front hold in a corner (bench r3l / r3m: each over 5 % in at least one test; shocks and
 * ride heights stay under 5 % everywhere and are not here). `stable` = which end of the row calms the rear: +1 the high end of
 * the box (stiffer front springs, stiffer front bar), -1 the low end (softer rear bar, brake bias toward the front). The
 * opposite ends are the "anti-push" ends (laps repo Step 15.3: soft front springs and bar, stiff rear bar, brake to the rear).
 */
export const HANDLING_ROWS: { param: number; stable: 1 | -1 }[] = [
  { param: 0, stable: 1 }, { param: 2, stable: 1 }, { param: 6, stable: -1 }, { param: 18, stable: -1 },
];

/**
 * THE dose: how far Optimize moves the four rows from where they are toward the anti-push ends on a front-wheel-drive car
 * (0.5 = halfway; 1 = to the ends of the car's own box). Measured: Peugeot 106 at 50 % -0.23..-0.28 s on Freemont (laps repo
 * Step 17.5), at 100 % -0.70 / -0.97 s; the Civic Si at 100 % gains 2-3 times what 50 % gains at the same speed, but at its limit
 * loses 2.9 s on one short-circuit layout and gains 0.4 s on the other; 50 % never lost more than 0.5 s (laps repo Step 18.5). The
 * dose is relative to each car's own box, so the same 50 % moves each car's bytes by a different amount (audit Question 2).
 */
export const ANTI_PUSH_DOSE = 0.5;

/**
 * The tab that gets the default dose: Circuit, the closed-circuit lap tests drove it. URL was driven in the fix round (laps repo
 * Step 20.3, Civic Si, track 4701, 50 %): no gain at the same speed (laps 1-2 -0.08 s, five laps +0.18 s, one lap +0.25 s slower),
 * so URL is out: the default is written only where a measurement shows a gain. Drag (straight line), Drift and Street X were not driven.
 */
export const DOSE_TABS = [0];

/** Positions of the four rows, 0..100 each; they use the same rows in opposite directions, so only one is above 0. */
export interface Handling { stable: number; push: number }
/** The one page slider: -100 (front bites, `push`) .. 0 (as it is) .. +100 (rear holds, `stable`), steps of {@link STOP_STEP}. */
export const HANDLING_KEY = 'handlingBalance';
export const STOP_STEP = 25;

/** The slider value of a position pair, and back. */
export const balanceOf = (h: Handling): number => h.stable - h.push;
export const handlingFromBalance = (b: number): Handling => (b > 0 ? { stable: b, push: 0 } : { stable: 0, push: Math.abs(b) });

/**
 * What Optimize writes for the four rows, as slider positions. RWD and AWD: nothing (three cars, three of three lost time on the
 * short circuit with the stable ends, laps repo Step 17.5). FWD: {@link ANTI_PUSH_DOSE} toward the anti-push ends on {@link DOSE_TABS}.
 */
export function handlingDefault(drive: Drivetrain, setup: number): Handling {
  return { stable: 0, push: drive === 'fwd' && DOSE_TABS.includes(setup) ? Math.round(ANTI_PUSH_DOSE * 100) : 0 };
}

/** Position from a tab's slider record (missing = the default of the car's drivetrain on that tab), on the grid of stops. */
export function handlingOf(feel: Record<string, number>, drive: Drivetrain, setup: number): Handling {
  const v = feel[HANDLING_KEY];
  if (typeof v !== 'number' || !Number.isFinite(v)) return handlingDefault(drive, setup);
  return handlingFromBalance(Math.round(Math.max(-100, Math.min(100, v)) / STOP_STEP) * STOP_STEP);
}

/** Is there room for a row to move toward the stable (+1) or the anti-push (-1) end? (a row already at, or within half a step of, that end cannot) */
function room(model: DynoModel, setup: ArrayLike<number>, row: { param: number; stable: 1 | -1 }, dir: 1 | -1): boolean {
  const info = rowInfo(model, setup, row.param);
  if (!info) return false;
  // a row within half a key step of its end has no room: the byte grid may not reach the end exactly (Peugeot 106 front springs
  // after a full move show 0.04 against a box end of 0; one more push gives the same byte)
  const { min, max, step } = rowScale(info), now = rowShown(info, setup[row.param]), eps = Math.max(1e-6, step / 2);
  return row.stable * dir > 0 ? now < max - eps : now > min + eps;
}

/**
 * `base` (Optimize's rows and the driving sliders) with the four rows moved from their value in `base` toward the stable ends
 * (`h.stable`) or the anti-push ends (`h.push`), each toward the end of THAT car's own box (rowScale = the parts' range, the
 * same range the game's slider has). A row the parts do not open stays; a row already at its end stays.
 */
export function withHandling(model: DynoModel, base: ArrayLike<number>, h: Handling): Uint8Array {
  let out: Uint8Array = Uint8Array.from(base);
  const axis = (h.stable - h.push) / 100;
  if (!axis) return out;
  for (const row of HANDLING_ROWS) {
    const info = rowInfo(model, out, row.param);
    if (!info) continue;
    const { min, max } = rowScale(info);
    // the shown number grows with the physical value on these rows (springs, bars, rear brake share), as in feel.ts withFeel
    const next = setRowShown(model, out, row.param, toward(rowShown(info, out[row.param]), min, max, axis * row.stable));
    if (next) out = next;
  }
  return out;
}

// ---- what was measured -----------------------------------------------------------------------------------------------

export type FindingKind = 'drive' | 'lap';
export interface Finding { car: string; dose: string; kind: FindingKind; text: string; source: string }

const R3M = 'handling-design-r3l.md 3m (tools repo docs/game-check-r3m.md)';
const L = (step: string): string => `laps repo docs/laps.md ${step}`;

/**
 * Every number the handling cards show. Copied from the docs named in `source` (kept here, NOT shown in the UI); test cars only
 * (3000GT, RX-8, 350Z, Peugeot 106, Civic Si). `dose` is the share of the way from the car's base set to the ends of its own box.
 * "rear slide" = peak rear slip in degrees (or % against the base); "turns" = turn rate. "kind: lap" is lap time against the same
 * car's base at the same speed targets (negative = faster). Texts are plain words for a player: short, key numbers only.
 */
export const FINDINGS: Record<'stable' | 'push', Finding[]> = {
  stable: [
    { car: '3000GT (AWD)', dose: '100 %', kind: 'drive', source: R3M,
      text: 'rear slides 31-36 % less in steady turns, 20 % less braking into a turn; but it turns 6-11 % less (15 % less braking into a turn)' },
    { car: '3000GT (AWD)', dose: '50 %', kind: 'lap', source: L('14.4, 16.2'),
      text: 'Freemont: no change (-0.03 s, inside the noise; rear slide 21.5-23.2° → 20.2°). Short circuit, same speed: +0.23 s over 2 laps (slower), the same on both layouts (the first one repeated to the frame)' },
    { car: '3000GT (AWD)', dose: '75 %', kind: 'lap', source: L('14.3 round 3, 14.4'),
      text: 'Freemont: -0.05 s (37.40 against 37.45 s, timed lap at each set\'s own limits; rear slide 19.5°)' },
    { car: '3000GT (AWD)', dose: '100 %', kind: 'lap', source: L('14.3 round 3, 14.4'),
      text: 'Freemont: no change (37.43 against 37.45 s, timed lap at each set\'s own limits; rear slide 21.5-23.2° → 18.9°)' },
    { car: 'RX-8 (RWD)', dose: '25 %', kind: 'lap', source: L('14.3 round 3, 14.4'),
      text: 'Freemont: 36.62 against 36.65 s, no change (one base run; rear slide 12.1°)' },
    { car: 'RX-8 (RWD)', dose: '100 %', kind: 'lap', source: L('14.3, 14.4'),
      text: 'Freemont: no gain (36.70 against 36.65 s, half: 36.55; one base run). The wall-corner limit one step lower (32 against 35). Rear slide 12.3° → 11.4°' },
    { car: 'Peugeot 106 (FWD)', dose: '100 %', kind: 'lap', source: L('15.4'),
      text: 'Freemont: +0.27 s over 2 laps at the same speed (slower). The limit in one corner one step lower (29 against 32). Rear slide 8.9° → 7.2°' },
    { car: 'RX-8 (RWD)', dose: '50 %', kind: 'drive', source: L('14.4'), text: 'Freemont: rear slide 12.3° → 11.7°' },
    { car: 'RX-8 (RWD)', dose: '50 %', kind: 'lap', source: L('14.4, 16.2'), text: 'Freemont: no change (-0.10 s, one run each). Short circuit, same speed: -0.05 s over 2 laps on one layout and 0.00 s on the other (each a wall touch for one lap); no loss anywhere' },
    { car: '350Z (RWD)', dose: '50 %', kind: 'drive', source: L('17.5'),
      text: 'short circuit, moderate speed: rear slide 20.2° → 15.9° and 17.8° → 13.7°. At the car\'s limit no change (28.0° → 28.2°)' },
    { car: '350Z (RWD)', dose: '50 %', kind: 'lap', source: L('17.4'), text: 'Freemont: -0.40 / -0.32 s over 2 laps (the factory set touches the wall at that speed, this one does not). Short circuit, same speed: -0.10 s over 2 laps, but this set touches the wall in the last corner at a speed the factory set passes' },
    { car: 'Civic Si (FWD)', dose: '50 %', kind: 'drive', source: L('17.2'), text: 'Freemont: rear slide 10.7 / 11.1° → 9.9 / 9.6°' },
    { car: 'Peugeot 106 (FWD)', dose: '50 %', kind: 'lap', source: L('17.4'), text: 'Freemont +0.05 s, short circuit +0.05 s over 2 laps at the same speed (slower)' },
    { car: 'Civic Si (FWD)', dose: '50 %', kind: 'lap', source: L('17.2'), text: 'Freemont: +0.22 s (slower)' },
  ],
  push: [
    { car: 'Peugeot 106 (FWD)', dose: '100 %', kind: 'drive', source: L('15.3, 17.5'),
      text: 'rear slide 9.7° → 15-20°. Each change alone: turns 3.8 % more (front springs), 3.3 % more (front bar), 27 % more after braking into a turn (brake balance)' },
    { car: 'Civic Si (FWD)', dose: '100 %', kind: 'drive', source: L('17.2, 17.3'),
      text: 'Freemont: rear slide 10.7 / 11.1° → 15.6 / 16.4°. Short circuit: wall hits at a lower test speed (23, before 26), a spin at 26' },
    { car: 'Peugeot 106 (FWD)', dose: '50 %', kind: 'lap', source: L('17.5, 18.3'), text: 'Freemont: -0.23 to -0.28 s. Short circuit: -0.95 s over 3 laps at the same speed' },
    { car: 'Peugeot 106 (FWD)', dose: '100 %', kind: 'lap', source: L('17.4'), text: 'Freemont: -0.70 s over 2 laps. Short circuit: -0.97 s over 2 laps at the same speed' },
    { car: 'Civic Si (FWD)', dose: '50 %', kind: 'lap', source: L('18.3, 18.5'),
      text: 'Short circuit, same speed: -1.25 s over 3 laps on one layout; on the other -0.53 s over 2 laps (a wall touch in lap 2 made lap 3 run one zone slower, and it was still 0.38 s faster). Freemont: no change. At its limit never more than 0.5 s slower' },
    { car: 'Civic Si (FWD)', dose: '100 %', kind: 'lap', source: L('17.4, 17.3, 18.3, 18.5'),
      text: 'Short circuit, same speed: -1.42 s over 2 laps on one layout, -2.42 s over 3 laps on the other. At its limit slower on one layout (53.9 s a lap against 51.0 s, 2.9 s lost) and faster on the other (about 0.4 s). Freemont: no change' },
    { car: 'Civic Si (FWD)', dose: '50 %', kind: 'lap', source: L('20.3'),
      text: 'URL track (speedway): no gain at the same speed (-0.08 s over 2 laps, +0.18 s over 5 laps, one lap 0.25 s slower; rear slide 5.6-5.8° → 5.5-5.6° at moderate speed, peak 10.5° → 14.0° at its limit)' },
    { car: 'Golf (FWD)', dose: '50 %', kind: 'lap', source: L('20.3'),
      text: 'Short circuit (one layout), same speed: -1.53 s over 3 laps and -0.67 s in the 4th (-2.2 s over 4 laps); at its limit about 0.7 s a lap faster' },
    { car: '350Z (RWD)', dose: '50 %', kind: 'drive', source: L('17.2'), text: 'Freemont: rear slide 16.0 / 15.5° → 24.6 / 22.1°' },
    { car: '350Z (RWD)', dose: '50 %', kind: 'lap', source: L('17.4'), text: 'Freemont: +0.83 s (slower)' },
  ],
};

/**
 * The words a player may or may not get in the owner's language, kept in one place: the owner has not yet said whether Polish
 * words stay on the English page (narada-tuner-whole.md item 16). Swap or empty these three; nothing else holds Polish text.
 */
export const OWNER_WORDS = { frontPushes: ' (przód nie skręca / pcha)', rearSteps: ' (tył ucieka)' } as const;

/** The words for something nobody measured. Never a guess. (Owner's word, see {@link OWNER_WORDS}.) */
export const NOT_MEASURED = 'nie zmierzone';

/** Two or three sentences above the Cornering slider: what Optimize did on this drivetrain and tab (final wording of narada-handling-ui.md 3.3). */
export function handlingNote(drive: Drivetrain, tab: number): string {
  if (drive === 'fwd' && DOSE_TABS.includes(tab)) {
    return 'Front-wheel drive: the Tuner already moved this halfway to "Front bites more". The front-drive test cars lapped faster or the same on short circuits with it.';
  }
  if (drive === 'fwd' && tab === 4) {
    return 'Front-wheel drive: on URL the Tuner leaves this in the middle. One test car drove a URL track with the half move and gained nothing.';
  }
  if (drive === 'fwd') return `Front-wheel drive: on this race type the Tuner leaves this in the middle. Nobody drove this race type with it moved (${NOT_MEASURED}).`;
  return 'The Tuner leaves this in the middle. On the rear-drive and all-wheel-drive test cars no step gave a clear lap gain. Move it only if the car bothers you.';
}

const KIND_WORDS: Record<FindingKind, string> = { drive: 'How it drives', lap: 'Lap time' };
const DRIVE_OF_CAR: Record<Drivetrain, string> = { fwd: 'FWD', awd: 'AWD', rwd: 'RWD' };

const DOSE_WORDS: Record<string, string> = { '25 %': 'quarter move', '50 %': 'half move', '75 %': 'three-quarter move', '100 %': 'full move' };

/** The measured lines of one slider for a drivetrain: by kind; "nie zmierzone" when the drivetrain has none of that kind. */
export function findingsFor(key: 'stable' | 'push', drive: Drivetrain): { kind: string; text: string; source: string }[] {
  const out: { kind: string; text: string; source: string }[] = [];
  for (const kind of ['drive', 'lap'] as FindingKind[]) {
    const own = FINDINGS[key].filter((f) => f.kind === kind && f.car.includes(`(${DRIVE_OF_CAR[drive]})`));
    if (!own.length) out.push({ kind: KIND_WORDS[kind], text: NOT_MEASURED, source: '' });
    for (const f of own) out.push({ kind: KIND_WORDS[kind], text: `${f.car}, ${DOSE_WORDS[f.dose] ?? f.dose}: ${f.text}.`, source: f.source });
  }
  return out;
}

// ---- the Cornering slider ---------------------------------------------------------------------------------------------

/** One stop of the slider: where the thumb sits, its name, and the one line shown under the slider while the thumb is on it. */
export interface CornerStop {
  value: number;
  /** Short name under the track. */
  label: string;
  /** Long name inside the lines ("half, front bites"). */
  name: string;
  /** Was a lap or a bench test run at exactly this stop on this kind of car? */
  driven: boolean;
  /** Share of the track (0..100) where the thumb sits, for the label row of the stops that are offered. */
  at: number;
  /** Offered: inside the range this car's parts leave room for. */
  offered: boolean;
  line: string;
}

export interface HandlingControl {
  key: string;
  intro: string;
  /** The help line with the player's two symptoms and the way to move. */
  help: string;
  leftEnd: string; leftNote: string; rightEnd: string; rightNote: string;
  /** All nine stops, -100..100. */
  stops: CornerStop[];
  /** The range this car's parts leave room for (-100..100 if both sides have room). */
  min: number; max: number;
  /** Where Optimize starts the thumb for this car and tab, and the stop that carries the "Tuner's pick" mark (null = none). */
  start: number;
  pick: number | null;
  /** "This car's parts leave no room to the left / right." or ''. */
  noRoom: string;
  /** What was measured, by side. */
  measured: { title: string; findings: { kind: string; text: string; source: string }[] }[];
  /** What it changes (folded). */
  basis: string;
}

const CAR_WORDS: Record<Drivetrain, string> = { fwd: 'front-drive', awd: 'all-wheel-drive', rwd: 'rear-drive' };
const STOP_LABELS: Record<number, string> = { 0: 'as it is', 25: '¼', 50: 'half', 75: '¾', 100: 'full' };
const STOP_WORDS: Record<number, string> = { 25: 'a quarter', 50: 'half', 75: 'three quarters', 100: 'full' };

/** The stop's name in a sentence: "half, front bites", "as it is". */
export function stopName(value: number): string {
  return value === 0 ? 'as it is' : `${STOP_WORDS[Math.abs(value)]}, ${value < 0 ? 'front bites' : 'rear holds'}`;
}

/**
 * The stops that were driven (laps or bench) on each drivetrain, with what was measured there, in plain words (numbers are in
 * {@link FINDINGS}, folded under "What was measured"). Everything else is "not driven itself". Evidence per cell: laps repo
 * docs/laps.md Steps 14.3, 14.4 (3000GT, RX-8), 15.4 (Peugeot 106), 17.2-17.5 (Civic Si, 350Z), 18.3, 20.3, 21.2 (Golf), and
 * handling-design-r3l.md 3m (bench). Corrected 2026-11-18, narada-tuner-whole.md 3.1: 25 % and 75 % were driven on the rear side.
 * Front-wheel drive: front bites 50 / 100 %, rear holds 50 / 100 %. All-wheel drive (3000GT): rear holds 50 / 75 / 100 %. Rear-wheel
 * drive (RX-8, 350Z): front bites 50 %, rear holds 25 / 50 / 100 %. The 3000GT at 25 % was driven only before the judging fix (Step 13).
 */
const DRIVEN: Record<Drivetrain, Record<number, string>> = {
  fwd: {
    [-100]: 'Two front-drive test cars: faster at the same speed, but at the limit one lost 2.9 s a lap on one track, hit walls sooner and spun.',
    [-50]: 'Three front-drive test cars: faster or the same over the same laps on short circuits. On Freemont faster for one, no change for another.',
    50: 'Two front-drive test cars: the rear slid a little less, laps a little slower.',
    100: 'One front-drive test car (Freemont): slower at the same speed, one corner limit a step lower; the rear slid a little less.',
  },
  awd: {
    50: 'One all-wheel-drive test car: a little slower on the short circuit, no change on Freemont.',
    75: 'One all-wheel-drive test car (Freemont only): a lap 0.05 s faster, the rear slid less.',
    100: 'One all-wheel-drive test car: no lap change on Freemont; the rear slid less (on the test bench about a third less, and the car turned less).',
  },
  rwd: {
    [-50]: 'One rear-drive test car: the rear slid much more and the lap was slower.',
    25: 'One rear-drive test car (Freemont): no lap change; the rear slid a little less.',
    50: 'Two rear-drive test cars: the rear slid less at moderate speed, no lap gained or lost; one touched a wall at a speed the standard setup passes.',
    100: 'One rear-drive test car (Freemont): no lap gained, one corner limit a step lower; the rear slid a little less.',
  },
};

/** Was this stop driven on this drivetrain? ("as it is" always is: nothing moves.) */
export const isDriven = (drive: Drivetrain, value: number): boolean => value === 0 || value in DRIVEN[drive];

/**
 * The one line under the slider for a stop and drivetrain: its own result if it was driven, else "not driven itself" with the
 * nearest driven stop on that side (the farther-out one when two are equally near, so a stop next to a risky one carries its
 * warning), and "between two driven setups" when both neighbours were driven. Never a number that was not measured.
 */
export function stopLine(drive: Drivetrain, value: number): string {
  if (value === 0) return 'Nothing is moved here: the car corners as your setup has it.';
  const own = DRIVEN[drive][value];
  if (own) return own;
  const side = Math.sign(value), driven = (v: number): boolean => Math.abs(v) <= 100 && isDriven(drive, v);
  const between = driven(value - STOP_STEP) && driven(value + STOP_STEP);
  let near: number | null = null;
  for (let d = STOP_STEP; d <= 100 && near === null; d += STOP_STEP) {
    for (const v of [value + side * d, value - side * d].sort((x, y) => Math.abs(y) - Math.abs(x))) {
      if (Math.sign(v) === side && Math.abs(v) <= 100 && v in DRIVEN[drive]) { near = v; break; }
    }
  }
  const head = between ? 'Between two driven setups; not driven itself.' : 'Not driven itself.';
  return near === null ? `${head} No step on this side was driven on a ${CAR_WORDS[drive]} car.` : `${head} Nearest driven (${stopName(near)}): ${DRIVEN[drive][near]}`;
}

const NO_ROOM = (side: string): string => `This car's parts leave no room to the ${side}.`;

// Code behind the rows (kept out of the UI): springs FUN_005a3700, brakes FUN_005a4d80; the anti-roll (sway bar) term of the game was not found.
const BASIS = 'Moves Front Springs, Front Sway Bar, Rear Sway Bar and Brake Bias, each toward the end of this car\'s own range. '
  + 'Left: springs and front bar softer, rear bar stiffer, brakes toward the rear. Right: the opposite. '
  + 'Measured in the game with test cars (lap tests and bench tests), not computed; the sway bars\' effect rests on those measurements alone. Test cars only; nobody measured every car.';

/**
 * The Cornering slider a car and tab can use, or null when the parts open none of the four rows. One side is not offered when no
 * row can move toward it (`room`): the slider then runs from the middle to the other end only. The position is not a number
 * of ours: every stop names what was driven and what was not.
 */
export function handlingControl(model: DynoModel, setup: ArrayLike<number>, drive: Drivetrain, tab: number): HandlingControl | null {
  const rows = HANDLING_ROWS.filter((r) => rowInfo(model, setup, r.param));
  const left = rows.some((r) => room(model, setup, r, -1)), right = rows.some((r) => room(model, setup, r, 1));
  if (!left && !right) return null;
  const min = left ? -100 : 0, max = right ? 100 : 0;
  const dflt = balanceOf(handlingDefault(drive, tab)), start = Math.max(min, Math.min(max, dflt));
  const stops: CornerStop[] = [];
  for (let value = -100; value <= 100; value += STOP_STEP) {
    stops.push({
      value, label: STOP_LABELS[Math.abs(value)], name: stopName(value), driven: isDriven(drive, value), offered: value >= min && value <= max,
      at: (value - min) / (max - min) * 100, line: stopLine(drive, value),
    });
  }
  return {
    key: HANDLING_KEY, intro: handlingNote(drive, tab),
    help: `Front pushes wide${OWNER_WORDS.frontPushes}? Move it left. Rear steps out${OWNER_WORDS.rearSteps}? Move it right.`,
    leftEnd: 'Front bites more', leftNote: '(rear slides more)', rightEnd: 'Rear holds more', rightNote: '(turns in less)',
    stops, min, max, start,
    // the mark sits on the Tuner's own move, only if that stop was driven (nothing is called "the pick" without a lap behind it)
    pick: dflt !== 0 && start === dflt && isDriven(drive, dflt) ? dflt : null,
    noRoom: !left ? NO_ROOM('left') : !right ? NO_ROOM('right') : '',
    measured: [
      { title: 'Front bites more', findings: findingsFor('push', drive) },
      { title: 'Rear holds more', findings: findingsFor('stable', drive) },
    ],
    basis: BASIS,
  };
}

// ---- the advanced list -----------------------------------------------------------------------------------------------

export interface AdvancedRow {
  screen: string;
  row: string;
  /** In the save (or after key C without one). */
  now: string;
  /** In the result of this card. */
  after: string;
  /** The box this car's parts allow, low to high, in the shown numbers. */
  range: string;
  changed: boolean;
  /** Who moved it: Optimize, a driving slider, the handling control. */
  by: string;
}

/**
 * Every row of the game's tuning screens that this car has, with its value now, its value in the result, its range and who
 * changed it. `layers`: the setup after Optimize, after the driving sliders, and the result.
 */
export function advancedRows(model: DynoModel, start: ArrayLike<number>,
  layers: { base: ArrayLike<number>; felt: ArrayLike<number>; final: ArrayLike<number> }): AdvancedRow[] {
  const out: AdvancedRow[] = [];
  const who = (idx: number[]): string => {
    const step = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => idx.some((i) => a[i] !== b[i]);
    return [step(start, layers.base) ? 'Optimize' : '', step(layers.base, layers.felt) ? 'driving slider' : '', step(layers.felt, layers.final) ? 'handling control' : '']
      .filter(Boolean).join(' + ');
  };
  for (const param of ROW_ORDER) {
    const [screen, row] = ROW_LABELS[param];
    const idx = param === 16 ? [16, 17] : [param];
    let range: string;
    if (param === 16) {
      const n = NitroScreen.open(model, start);
      if (!n) continue;
      range = `${n.scale.min.toFixed(2)} to ${n.scale.max.toFixed(2)}`;
    } else {
      const info = rowInfo(model, start, param);
      if (!info) continue;
      const sc = rowScale(info), d = param >= 10 && param <= 15 ? 1 : 2;
      range = `${sc.min.toFixed(d)} to ${sc.max.toFixed(d)}`;
    }
    const by = who(idx);
    out.push({ screen, row, now: shownText(model, start, param), after: shownText(model, layers.final, param), range, changed: by !== '', by });
  }
  for (const [kind, name, screen] of [['ecu', 'ECU', 'ECU'], ['turbo', 'Turbo', 'Turbo']] as const) {
    const a = model.curve(start, kind), z = model.curve(layers.final, kind), b = model.curve(layers.base, kind);
    if (!a || !z || !b) continue;
    a.forEach((p, i) => {
      const moved = p.byte !== z[i].byte;
      out.push({
        screen, row: `${name} bar ${i + 1} (${(p.rpm / 1000).toFixed(1)}k rpm, N·m)`, now: Math.round(p.value).toString(), after: Math.round(z[i].value).toString(),
        range: `${Math.round(p.min)} to ${Math.round(p.max)}`, changed: moved, by: moved ? (b[i].byte !== p.byte ? 'Optimize' : 'driving slider') : '',
      });
    });
  }
  return out;
}
