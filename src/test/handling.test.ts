import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, parseGameData, type GameData } from '../model/dyno.js';
import { planTab, startAfterC } from '../model/tuner.js';
import { rowInfo, rowScale, setRowShown } from '../model/tune-keys.js';
import { installedForLevels, withAero } from '../model/virtual-save.js';
import { withFeel } from '../model/feel.js';
import {
  advancedRows, ANTI_PUSH_DOSE, DOSE_TABS, driveShare, drivetrainOf, FINDINGS, findingsFor, handlingControl, handlingDefault, handlingNote, handlingOf,
  HANDLING_KEY, HANDLING_ROWS, isDriven, NOT_MEASURED, OWNER_WORDS, stopLine, withHandling, type Drivetrain,
} from '../model/handling.js';

const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';
const LEVELS = { EC: 3, TU: 3, TR: 3, NO: 3, SU: 3, BR: 3, TI: 3, AEF: 3, AES: 3 };
const ROWS = HANDLING_ROWS.map((r) => r.param);

let game: GameData | null = null;
function modelOf(name: string, levels: Record<string, number> = LEVELS): DynoModel {
  game ??= parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const car = game.cars.find((c) => c.name === name)!;
  return new DynoModel(game, car, withAero(installedForLevels(levels), levels), new Array(9).fill(0));
}
/** The byte a row gets at the low / high end of this car's own box (what the game's slider reaches). */
function end(model: DynoModel, start: Uint8Array, param: number, which: 'min' | 'max'): number {
  return setRowShown(model, start, param, rowScale(rowInfo(model, start, param)!)[which])![param];
}

test('drivetrain: split at 0.2 and 0.8 like the game (FUN_005a7530), float32 compare', () => {
  const at = (v: number): Drivetrain => drivetrainOf(v);
  assert.deepEqual([0, 0.19, 0.2].map(at), ['fwd', 'fwd', 'awd']);
  assert.deepEqual([0.5, 0.575, 0.8].map(at), ['awd', 'awd', 'awd']);
  assert.deepEqual([0.81, 0.95, 1].map(at), ['rwd', 'rwd', 'rwd']);
});

test('drivetrain read from the game data for the test cars (laps repo Step 14.2)', { skip: SKIP }, () => {
  const want: Record<string, Drivetrain> = { '3000GT': 'awd', RX8: 'rwd', PEUGOT106: 'fwd', CIVIC: 'fwd', '350Z': 'rwd', SKYLINE: 'awd', MIATA: 'rwd', GOLF: 'fwd' };
  for (const [name, d] of Object.entries(want)) {
    const m = modelOf(name);
    assert.equal(drivetrainOf(driveShare(m)), d, `${name}: share ${driveShare(m)}`);
  }
});

test('default dose: none on rear-drive and all-wheel-drive, ANTI_PUSH_DOSE on the lap tabs of a front-wheel-drive car, from one constant', () => {
  for (const d of ['rwd', 'awd'] as Drivetrain[]) for (let tab = 0; tab < 5; tab++) assert.deepEqual(handlingDefault(d, tab), { stable: 0, push: 0 }, `${d} tab ${tab}`);
  for (let tab = 0; tab < 5; tab++) {
    assert.deepEqual(handlingDefault('fwd', tab), { stable: 0, push: DOSE_TABS.includes(tab) ? Math.round(ANTI_PUSH_DOSE * 100) : 0 }, `fwd tab ${tab}`);
  }
  assert.deepEqual(DOSE_TABS, [0], 'Circuit only: URL was driven in the fix round and showed no gain (laps repo Step 20.3)');
  assert.ok(ANTI_PUSH_DOSE > 0 && ANTI_PUSH_DOSE <= 1);
});

test('slider record: missing = the default, an explicit 0 beats the default, values clamp and snap to the nine stops', () => {
  assert.deepEqual(handlingOf({}, 'fwd', 0), { stable: 0, push: 50 });
  assert.deepEqual(handlingOf({ [HANDLING_KEY]: 0 }, 'fwd', 0), { stable: 0, push: 0 });
  assert.deepEqual(handlingOf({}, 'rwd', 0), { stable: 0, push: 0 });
  assert.deepEqual(handlingOf({ [HANDLING_KEY]: 75 }, 'fwd', 0), { stable: 75, push: 0 });
  assert.deepEqual(handlingOf({ [HANDLING_KEY]: -75 }, 'awd', 0), { stable: 0, push: 75 });
  assert.deepEqual(handlingOf({ [HANDLING_KEY]: -900 }, 'awd', 0), { stable: 0, push: 100 });
  assert.deepEqual(handlingOf({ [HANDLING_KEY]: 30 }, 'awd', 0), { stable: 25, push: 0 });
});

test('handling rows: stable ends = stiff front springs / front bar, soft rear bar, brake to the front; anti-push the reverse; each to the car\'s own box', { skip: SKIP }, () => {
  const ends = new Map<string, number[]>();
  for (const name of ['3000GT', 'RX8', 'PEUGOT106']) {
    const m = modelOf(name), start = startAfterC(m);
    assert.deepEqual(m.base === undefined, false);
    const stable = withHandling(m, start, { stable: 100, push: 0 }), push = withHandling(m, start, { stable: 0, push: 100 });
    for (const { param, stable: dir } of HANDLING_ROWS) {
      const lo = end(m, start, param, 'min'), hi = end(m, start, param, 'max');
      assert.ok(lo < hi, `${name} row ${param}: ${lo} < ${hi}`);
      assert.equal(stable[param], dir > 0 ? hi : lo, `${name} stable row ${param}`);
      assert.equal(push[param], dir > 0 ? lo : hi, `${name} anti-push row ${param}`);
    }
    for (let i = 0; i < start.length; i++) if (!ROWS.includes(i)) assert.equal(stable[i], start[i], `${name}: byte ${i} untouched`);
    assert.deepEqual(withHandling(m, start, { stable: 0, push: 0 }), start);
    ends.set(name, ROWS.map((p) => stable[p]));
  }
  // every car has its own boxes (laps repo Step 17.1: RX-8 vs Peugeot rear bar 54..154 vs 21..121)
  assert.notDeepEqual(ends.get('RX8'), ends.get('PEUGOT106'));
});

test('the dose: 50 % lands halfway between the saved value and the car\'s anti-push end (within a byte)', { skip: SKIP }, () => {
  const m = modelOf('PEUGOT106'), start = startAfterC(m);
  const half = withHandling(m, start, { stable: 0, push: Math.round(ANTI_PUSH_DOSE * 100) });
  const full = withHandling(m, start, { stable: 0, push: 100 });
  for (const p of ROWS) {
    assert.ok(Math.abs(half[p] - (start[p] + full[p]) / 2) <= 1.5, `row ${p}: ${start[p]} -> ${half[p]} -> ${full[p]}`);
    assert.notEqual(half[p], start[p], `row ${p} moves`);
  }
  // from a value that is not the default the dose is a share of THAT distance (a row already at the end stays)
  const moved = withHandling(m, start, { stable: 0, push: 100 });
  assert.deepEqual(withHandling(m, moved, { stable: 0, push: 100 }), moved, 'rows at their ends stay');
});

test('Cornering: one slider, nine stops, offered with room, closed without the parts, no hidden default on rear-drive', { skip: SKIP }, () => {
  const awd = modelOf('3000GT'), s = startAfterC(awd);
  const c = handlingControl(awd, s, 'awd', 0)!;
  assert.equal(c.key, HANDLING_KEY);
  assert.deepEqual(c.stops.map((x) => x.value), [-100, -75, -50, -25, 0, 25, 50, 75, 100]);
  assert.ok(c.start === 0 && c.pick === null && c.min === -100 && c.max === 100 && c.noRoom === '' && c.stops.every((x) => x.offered));
  assert.ok(c.basis.includes('Brake Bias'));
  const fwd = modelOf('PEUGOT106'), f = startAfterC(fwd);
  const fc = handlingControl(fwd, f, 'fwd', 0)!;
  assert.deepEqual([fc.start, fc.pick], [-50, -50], 'Circuit: the Tuner\'s pick sits on a driven stop');
  assert.deepEqual(handlingControl(fwd, f, 'fwd', 1)!.start, 0, 'Drag: no default');
  assert.equal(handlingControl(fwd, f, 'fwd', 1)!.pick, null);
  // a side with no room is not offered: the slider runs from the middle to the other end, and a line says so
  const stable = withHandling(fwd, f, { stable: 100, push: 0 });
  const right = handlingControl(fwd, stable, 'fwd', 0)!;
  assert.deepEqual([right.min, right.max, right.start, right.pick], [-100, 0, -50, -50]);
  assert.equal(right.noRoom, "This car's parts leave no room to the right.");
  assert.deepEqual(right.stops.filter((x) => x.offered).map((x) => x.value), [-100, -75, -50, -25, 0]);
  const pushed = withHandling(fwd, f, { stable: 0, push: 100 });
  const left = handlingControl(fwd, pushed, 'fwd', 0)!;
  assert.deepEqual([left.min, left.max, left.start, left.pick], [0, 100, 0, null], 'the default cannot go where there is no room');
  assert.equal(left.noRoom, "This car's parts leave no room to the left.");
  // no suspension or brake parts: nothing to move
  const bare = modelOf('3000GT', { EC: 2, TU: 2, TR: 2 }), b = startAfterC(bare);
  assert.equal(handlingControl(bare, b, 'awd', 0), null);
  assert.deepEqual(withHandling(bare, b, { stable: 100, push: 0 }), b);
});

test('every stop has one line: driven stops say what was driven, the others say "not driven itself" with their nearest driven stop (narada 3o items 2 and 4)', () => {
  const driven = (d: Drivetrain): number[] => [-100, -75, -50, -25, 0, 25, 50, 75, 100].filter((v) => isDriven(d, v));
  // the corrected evidence table: 25 / 75 % were driven on the rear side (3000GT 75 %, RX-8 25 %); never on the front side
  assert.deepEqual(driven('fwd'), [-100, -50, 0, 50, 100]);
  assert.deepEqual(driven('awd'), [0, 50, 75, 100]);
  assert.deepEqual(driven('rwd'), [-50, 0, 25, 50, 100]);
  for (const d of ['fwd', 'awd', 'rwd'] as Drivetrain[]) for (let v = -100; v <= 100; v += 25) {
    const line = stopLine(d, v);
    assert.ok(line.length > 10 && !/undefined|NaN/.test(line), `${d} ${v}`);
    assert.equal(/^(Between two driven setups; )?[Nn]ot driven itself/.test(line), !isDriven(d, v), `${d} ${v}: ${line}`);
  }
  // "three quarters, front bites" on a front-drive car sits between two driven setups and carries the full stop's warning
  assert.match(stopLine('fwd', -75), /^Between two driven setups; not driven itself\. Nearest driven \(full, front bites\): .*spun/);
  assert.match(stopLine('fwd', -25), /^Between two driven setups.*\(half, front bites\)/);
  assert.match(stopLine('awd', -50), /No step on this side was driven on a all-wheel-drive car|No step on this side was driven on an? /);
  assert.match(stopLine('rwd', -100), /^Not driven itself\. Nearest driven \(half, front bites\)/);
  assert.match(stopLine('rwd', 75), /^Between two driven setups.*\(full, rear holds\)/);
});

test('the owner\'s Polish words stay in one place (OWNER_WORDS, NOT_MEASURED) until the owner answers (narada-tuner-whole.md item 16)', { skip: SKIP }, () => {
  const m = modelOf('3000GT'), c = handlingControl(m, startAfterC(m), 'awd', 0)!;
  assert.equal(c.help, `Front pushes wide${OWNER_WORDS.frontPushes}? Move it left. Rear steps out${OWNER_WORDS.rearSteps}? Move it right.`);
  assert.deepEqual([OWNER_WORDS.frontPushes, OWNER_WORDS.rearSteps, NOT_MEASURED], [' (przód nie skręca / pcha)', ' (tył ucieka)', 'nie zmierzone']);
});

test('measured words: every number has a source, a drivetrain with no test says "nie zmierzone", nothing is filled in', () => {
  for (const key of ['stable', 'push'] as const) {
    for (const f of FINDINGS[key]) {
      assert.ok(f.source && /laps\.md|handling-design/.test(f.source), `${f.car}: source`);
      assert.ok(/\d/.test(f.text) && f.dose, `${f.car}: a number and a dose`);
    }
  }
  const lines = (k: 'stable' | 'push', d: Drivetrain) => findingsFor(k, d);
  for (const k of ['stable', 'push'] as const) for (const d of ['fwd', 'awd', 'rwd'] as Drivetrain[]) {
    assert.deepEqual([...new Set(lines(k, d).map((l) => l.kind))], ['How it drives', 'Lap time'], `${k} ${d}: both kinds present`);
  }
  // all-wheel drive was never driven with the anti-push ends; its stable ends have bench and lap numbers
  assert.deepEqual(lines('push', 'awd').map((l) => l.text), [NOT_MEASURED, NOT_MEASURED]);
  assert.ok(lines('stable', 'awd').every((l) => l.text !== NOT_MEASURED && /3000GT/.test(l.text)));
  // rear-drive: no bench for the anti-push direction other than the 350Z; FWD stable has no bench except the Civic
  assert.ok(lines('push', 'rwd').some((l) => /350Z/.test(l.text) && /\+0\.83/.test(l.text)));
  assert.ok(lines('push', 'fwd').some((l) => /-1\.42/.test(l.text)), 'the Civic\'s 4013 gain comes with its limit');
  assert.ok(lines('push', 'fwd').some((l) => /53\.9 s a lap against 51\.0 s/.test(l.text)));
  // "rear holds, full" was driven on all three drivetrains on Freemont (laps Steps 14.3, 14.4, 15.4; narada-tuner-whole.md 3.1)
  assert.ok(lines('stable', 'fwd').some((l) => /full move/.test(l.text) && /\+0\.27 s/.test(l.text) && /29 against 32/.test(l.text)));
  assert.ok(lines('stable', 'rwd').some((l) => /full move/.test(l.text) && /36\.70 against 36\.65/.test(l.text)));
  assert.ok(lines('stable', 'awd').some((l) => /full move/.test(l.text) && /37\.43 against 37\.45/.test(l.text)));
  assert.ok(lines('stable', 'awd').some((l) => /three-quarter move/.test(l.text) && /37\.40/.test(l.text)));
  assert.ok(lines('stable', 'rwd').some((l) => /quarter move/.test(l.text) && /36\.62/.test(l.text)));
  assert.match(handlingNote('awd', 0), /leaves this in the middle/);
  assert.match(handlingNote('fwd', 0), /halfway/);
  // item 6: the Circuit tab is also loaded by Sprint and career URL races (TAB_USES); say what was driven
  assert.match(handlingNote('fwd', 0), /Sprint and career URL races: Sprint was never driven with it, and one URL track test showed no gain/);
  assert.match(handlingNote('fwd', 1), new RegExp(NOT_MEASURED));
});

test('lap tabs carry the 50-120 mph pull (the number they optimize); Drag, Drift and Street X do not (audit M6)', { skip: SKIP }, () => {
  const m = modelOf('CIVIC'), start = startAfterC(m);
  const at = (k: number): ReturnType<typeof planTab> => planTab(m, k, start, start, 'race');
  for (const k of [0, 4]) assert.ok(at(k).plan.roll && at(k).plan.roll!.a! > 3 && at(k).plan.roll!.a === at(k).plan.roll!.b, `tab ${k}`);
  for (const k of [1, 2, 3]) assert.equal(at(k).plan.roll, null, `tab ${k}`);
  assert.equal(planTab(m, 4, start, start, 'top').plan.roll, null, 'the top-speed goal is not the pull');
});

test('the Drag tab carries the quarter mile (the number it optimizes); no other tab does (narada P3)', { skip: SKIP }, () => {
  const m = modelOf('CIVIC'), start = startAfterC(m);
  const at = (k: number): ReturnType<typeof planTab> => planTab(m, k, start, start, 'race');
  const q = at(1).plan.quarter;
  assert.ok(q && q.a! > 8 && q.a! < 30 && q.a === q.b && q.diff === 0, 'Drag');
  for (const k of [0, 2, 3, 4]) assert.equal(at(k).plan.quarter, null, `tab ${k}`);
});

test('advanced list: every row the car has, with who changed it; keys reach the handling target within a byte', { skip: SKIP }, () => {
  const m = modelOf('PEUGOT106'), start = startAfterC(m);
  const felt = withFeel(m, start, start, {});
  const final = withHandling(m, felt, handlingOf({}, 'fwd', 0));
  const rows = advancedRows(m, start, { base: start, felt, final });
  const changed = rows.filter((r) => r.changed);
  assert.deepEqual(changed.map((r) => r.row).sort(), ['Brake Bias', 'Front Springs', 'Front Sway Bar', 'Rear Sway Bar']);
  assert.ok(changed.every((r) => r.by === 'handling control' && r.now !== r.after && /^-?[\d.]+ to -?[\d.]+$/.test(r.range)));
  for (const need of ['Front Lowering (cm)', 'Steering Ratio', 'Final Drive Ratio', 'Front Grip', 'Rear Downforce']) assert.ok(rows.some((r) => r.row === need), need);
  assert.ok(rows.some((r) => /^ECU bar 1 /.test(r.row)) && rows.some((r) => /^Turbo bar 9 /.test(r.row)));
  // Optimize's own change is credited to Optimize
  const base = Uint8Array.from(start); base[9] = 120;
  assert.equal(advancedRows(m, start, { base, felt: base, final: base }).find((r) => r.row === 'Final Drive Ratio')!.by, 'Optimize');
  // mode A: the keys reach the dose within a byte from the factory setting
  const plan = planTab(m, 0, start, final, 'race').plan;
  for (const p of ROWS) assert.ok(Math.abs(plan.setup[p] - final[p]) <= 1, `row ${p}: keys ${plan.setup[p]} vs ${final[p]}`);
});
