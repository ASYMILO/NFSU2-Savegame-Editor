/**
 * Handling of the Tuner (round 3o): the car's drivetrain from the game data, the four rows that steer how the rear and the
 * front hold (front springs, front sway bar, rear sway bar, brake bias), the default Optimize writes for them, two "symptom"
 * sliders, what was measured for each, and the advanced list of every row.
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
 * Step 17.5), at 100 % -0.70 / -1.20 s; the Civic Si at 100 % hits the wall earlier on the short circuit and at 50 % was never
 * driven. A parallel round (v11) measures 50 % against 100 %: change this one number when it answers.
 */
export const ANTI_PUSH_DOSE = 0.5;

/**
 * The tabs that get the default dose: the lap races (Circuit, and URL, whose tab was made from the same objective in
 * b0a1fa3). The tests drove the Circuit tab's set on closed tracks. Drag (straight line), Drift and Street X were not driven.
 */
export const DOSE_TABS = [0, 4];

/** Slider positions, 0..100 each; they use the same four rows in opposite directions, so only one is above 0. */
export interface Handling { stable: number; push: number }
export const HANDLING_KEYS = { stable: 'handlingStable', push: 'handlingPush' } as const;

/**
 * What Optimize writes for the four rows, as slider positions. RWD and AWD: nothing (three cars, three of three lost time on the
 * short circuit with the stable ends, laps repo Step 17.5). FWD: {@link ANTI_PUSH_DOSE} toward the anti-push ends on {@link DOSE_TABS}.
 */
export function handlingDefault(drive: Drivetrain, setup: number): Handling {
  return { stable: 0, push: drive === 'fwd' && DOSE_TABS.includes(setup) ? Math.round(ANTI_PUSH_DOSE * 100) : 0 };
}

/** Positions from a tab's slider record (missing = the default of the car's drivetrain on that tab). */
export function handlingOf(feel: Record<string, number>, drive: Drivetrain, setup: number): Handling {
  const d = handlingDefault(drive, setup);
  const pick = (v: number | undefined, dflt: number): number => (typeof v === 'number' ? Math.max(0, Math.min(100, v)) : dflt);
  const stable = pick(feel[HANDLING_KEYS.stable], d.stable), push = pick(feel[HANDLING_KEYS.push], d.push);
  // both above 0 cannot happen from the page (the second one resets the first); if stored so, the stable one wins
  return stable > 0 ? { stable, push: 0 } : { stable: 0, push };
}

/** Is there room for a row to move toward the stable (+1) or the anti-push (-1) end? (a row already at that end cannot) */
function room(model: DynoModel, setup: ArrayLike<number>, row: { param: number; stable: 1 | -1 }, dir: 1 | -1): boolean {
  const info = rowInfo(model, setup, row.param);
  if (!info) return false;
  const { min, max } = rowScale(info), now = rowShown(info, setup[row.param]), eps = 1e-6;
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
 * Every number the handling cards show. Copied from the docs named in `source`; test cars only (3000GT, RX-8, 350Z, Peugeot 106,
 * Civic Si). `dose` is the share of the way from the car's base set to the ends of its own box. Slip = how far the rear slides
 * sideways (degrees, or % against the base); turn rate = how fast the car turns. "kind: lap" is lap time against the same car's
 * base at the same speed targets (negative = faster).
 */
export const FINDINGS: Record<'stable' | 'push', Finding[]> = {
  stable: [
    { car: '3000GT (AWD)', dose: '100 %', kind: 'drive', source: R3M,
      text: 'rear slip -31 to -36 % in steady turns and -20 % when braking into a turn; turn rate -6 to -11 % in steady turns and -15 % when braking into a turn' },
    { car: '3000GT (AWD)', dose: '50 %', kind: 'lap', source: L('14.4, 16.2'),
      text: 'Freemont: timed lap -0.03 s (37.42 against 37.45), peak rear slip 21.5-23.2 -> 20.2 deg; short circuit 4013b: +0.50 s over 3 laps' },
    { car: 'RX-8 (RWD)', dose: '50 %', kind: 'drive', source: L('14.4'), text: 'Freemont: peak rear slip 12.3 -> 11.7 deg' },
    { car: 'RX-8 (RWD)', dose: '50 %', kind: 'lap', source: L('14.4, 16.2'), text: 'Freemont: timed lap -0.10 s; short circuit 4013b: +0.25 / +0.30 s over 3 laps' },
    { car: '350Z (RWD)', dose: '50 %', kind: 'drive', source: L('17.5'),
      text: 'short circuit at moderate speed: peak rear slip 20.2 -> 15.9 and 17.8 -> 13.7 deg; at the car\'s limit no change (28.0 -> 28.2 deg)' },
    { car: '350Z (RWD)', dose: '50 %', kind: 'lap', source: L('17.4'),
      text: 'Freemont -0.40 / -0.32 s over 2 laps; short circuit 4013b +0.35 s over 3 laps (+0.52 s in the wall corner, -0.17 s elsewhere)' },
    { car: 'Civic Si (FWD)', dose: '50 %', kind: 'drive', source: L('17.2'), text: 'Freemont: peak rear slip 10.7 / 11.1 -> 9.9 / 9.6 deg' },
    { car: 'Peugeot 106 (FWD)', dose: '50 %', kind: 'lap', source: L('17.4'), text: 'Freemont +0.05 s, short circuit 4013b +0.08 s (slower)' },
    { car: 'Civic Si (FWD)', dose: '50 %', kind: 'lap', source: L('17.2'), text: 'Freemont +0.22 s (slower)' },
  ],
  push: [
    { car: 'Peugeot 106 (FWD)', dose: '100 %', kind: 'drive', source: L('15.3, 17.5'),
      text: 'peak rear slip 9.7 -> 15-20 deg; each row alone at its end: turn rate +3.8 % (front springs), +3.3 % (front bar), and +27 % after braking into a turn (brake bias)' },
    { car: 'Civic Si (FWD)', dose: '100 %', kind: 'drive', source: L('17.2, 17.3'),
      text: 'Freemont: peak rear slip 10.7 / 11.1 -> 15.6 / 16.4 deg; short circuit 4013b: wall hits from speed target 23 (base from 26), a spin at target 26' },
    { car: 'Peugeot 106 (FWD)', dose: '50 %', kind: 'lap', source: L('17.5'), text: 'Freemont -0.23 to -0.28 s' },
    { car: 'Peugeot 106 (FWD)', dose: '100 %', kind: 'lap', source: L('17.4'), text: 'Freemont -0.70 s over 2 laps; short circuit 4013b -1.20 s over 3 laps' },
    { car: 'Civic Si (FWD)', dose: '100 %', kind: 'lap', source: L('17.4, 17.3'),
      text: 'Freemont -0.03 s (noise); short circuit 4013b -1.42 s over 2 laps, but at its limit slower: full-ladder timed lap 53.9 s against 51.0 s' },
    { car: '350Z (RWD)', dose: '50 %', kind: 'drive', source: L('17.2'), text: 'Freemont: peak rear slip 16.0 / 15.5 -> 24.6 / 22.1 deg' },
    { car: '350Z (RWD)', dose: '50 %', kind: 'lap', source: L('17.4'), text: 'Freemont +0.83 s (slower)' },
  ],
};

/** One sentence above the sliders: what Optimize did with the four rows on this drivetrain and tab, and why. */
export function handlingNote(drive: Drivetrain, tab: number): string {
  if (drive === 'fwd' && DOSE_TABS.includes(tab)) {
    return `Front-wheel drive: Optimize moved the four rows ${Math.round(ANTI_PUSH_DOSE * 100)} % of the way toward the "front bites" ends, `
      + 'the direction that was faster in the lap tests on both front-wheel-drive cars (the Civic Si only at 100 %). The slider shows where it stands.';
  }
  if (drive === 'fwd') return `Front-wheel drive: on this race type Optimize leaves the four rows as they are. Nobody drove this race type with them moved (${NOT_MEASURED}).`;
  return 'Optimize leaves the four rows as they are. In the lap tests the "rear holds" ends won on one track and lost on the other for all three rear-drive and all-wheel-drive cars, '
    + 'so there is no default. Move the slider if the rear steps out.';
}

/** The words for something nobody measured. Never a guess. */
export const NOT_MEASURED = 'nie zmierzone';

const KIND_WORDS: Record<FindingKind, string> = { drive: 'How it drives', lap: 'Lap time' };
const DRIVE_OF_CAR: Record<Drivetrain, string> = { fwd: 'FWD', awd: 'AWD', rwd: 'RWD' };

/** The measured lines of one slider for a drivetrain: by kind; "nie zmierzone" when the drivetrain has none of that kind. */
export function findingsFor(key: 'stable' | 'push', drive: Drivetrain): { kind: string; text: string; source: string }[] {
  const out: { kind: string; text: string; source: string }[] = [];
  for (const kind of ['drive', 'lap'] as FindingKind[]) {
    const own = FINDINGS[key].filter((f) => f.kind === kind && f.car.includes(`(${DRIVE_OF_CAR[drive]})`));
    if (!own.length) out.push({ kind: KIND_WORDS[kind], text: NOT_MEASURED, source: '' });
    for (const f of own) out.push({ kind: KIND_WORDS[kind], text: `${f.car}, ${f.dose} of the way: ${f.text}.`, source: f.source });
  }
  return out;
}

// ---- the two sliders -------------------------------------------------------------------------------------------------

export interface HandlingSlider {
  key: string;
  which: 'stable' | 'push';
  /** Driving words, with the owner's wording in brackets. */
  label: string;
  low: string;
  high: string;
  /** What it moves, in the game's row names. */
  rows: string;
  findings: { kind: string; text: string; source: string }[];
  /** Where the evidence comes from, and what is not known (shown folded). */
  basis: string;
  /** The position Optimize starts it at for this car and tab. */
  start: number;
  /** The slider has room to move only if a row can go that way. */
  min: 0;
  max: 100;
}

const BASIS = 'Moves Front Springs, Front Sway Bar, Rear Sway Bar and Brake Bias, each toward the end of this car\'s own box. '
  + 'The effects are measured in the game (lap tests and bench tests with five test cars), not computed. Springs: game code FUN_005a3700; '
  + 'brakes: FUN_005a4d80; the sway bars\' code (anti-roll term) was not found, so their effect rests on the game measurements alone.';

/**
 * The symptom sliders a car and tab can use. A slider is offered when at least one of the four rows has room toward its ends;
 * none when the parts open none of the four rows. Slider positions are not kept between cars (they depend on the drivetrain).
 */
export function handlingSliders(model: DynoModel, setup: ArrayLike<number>, drive: Drivetrain, tab: number): HandlingSlider[] {
  const d = handlingDefault(drive, tab);
  const rows = HANDLING_ROWS.filter((r) => rowInfo(model, setup, r.param));
  if (!rows.length) return [];
  const names = (dir: 1 | -1): string => rows.map((r) => `${ROW_LABELS[r.param][1]} ${r.stable * dir > 0 ? '↑' : '↓'}`).join(', ');
  const out: HandlingSlider[] = [];
  if (rows.some((r) => room(model, setup, r, 1))) {
    out.push({
      key: HANDLING_KEYS.stable, which: 'stable', label: 'The rear steps out in corners (tył ucieka)', low: 'As it is', high: 'Rear holds more',
      rows: names(1), findings: findingsFor('stable', drive), basis: BASIS, start: d.stable, min: 0, max: 100,
    });
  }
  if (rows.some((r) => room(model, setup, r, -1))) {
    out.push({
      key: HANDLING_KEYS.push, which: 'push', label: 'The front does not turn in, it pushes wide (przód nie skręca / pcha)', low: 'As it is', high: 'Front bites more',
      rows: names(-1), findings: findingsFor('push', drive), basis: BASIS, start: d.push, min: 0, max: 100,
    });
  }
  return out;
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
