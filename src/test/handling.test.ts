import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, parseGameData, type GameData } from '../model/dyno.js';
import { planTab, startAfterC } from '../model/tuner.js';
import { rowInfo, rowScale, setRowShown } from '../model/tune-keys.js';
import { installedForLevels, withAero } from '../model/virtual-save.js';
import { withFeel } from '../model/feel.js';
import {
  advancedRows, ANTI_PUSH_DOSE, DOSE_TABS, driveShare, drivetrainOf, FINDINGS, findingsFor, handlingDefault, handlingNote, handlingOf, handlingSliders,
  HANDLING_KEYS, HANDLING_ROWS, NOT_MEASURED, withHandling, type Drivetrain,
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
  assert.deepEqual(DOSE_TABS, [0, 4], 'Circuit and URL only: the tabs the lap tests drove');
  assert.ok(ANTI_PUSH_DOSE > 0 && ANTI_PUSH_DOSE <= 1);
});

test('slider record: missing = the default, an explicit 0 beats the default, both above 0 keeps the stable one, values clamp', () => {
  assert.deepEqual(handlingOf({}, 'fwd', 0), { stable: 0, push: 50 });
  assert.deepEqual(handlingOf({ [HANDLING_KEYS.push]: 0 }, 'fwd', 0), { stable: 0, push: 0 });
  assert.deepEqual(handlingOf({}, 'rwd', 0), { stable: 0, push: 0 });
  assert.deepEqual(handlingOf({ [HANDLING_KEYS.stable]: 75 }, 'fwd', 0), { stable: 75, push: 0 });
  assert.deepEqual(handlingOf({ [HANDLING_KEYS.stable]: 50, [HANDLING_KEYS.push]: 50 }, 'awd', 0), { stable: 50, push: 0 });
  assert.deepEqual(handlingOf({ [HANDLING_KEYS.push]: 900 }, 'awd', 0), { stable: 0, push: 100 });
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

test('sliders: offered with room, closed without the parts, no hidden default on rear-drive', { skip: SKIP }, () => {
  const awd = modelOf('3000GT'), s = startAfterC(awd);
  const sliders = handlingSliders(awd, s, 'awd', 0);
  assert.deepEqual(sliders.map((x) => x.key), [HANDLING_KEYS.stable, HANDLING_KEYS.push]);
  assert.ok(sliders.every((x) => x.start === 0 && x.rows.includes('Brake Bias')));
  const fwd = modelOf('PEUGOT106'), f = startAfterC(fwd);
  assert.deepEqual(handlingSliders(fwd, f, 'fwd', 0).map((x) => x.start), [0, 50]);
  assert.deepEqual(handlingSliders(fwd, f, 'fwd', 1).map((x) => x.start), [0, 0], 'Drag: no default');
  // the stable slider closes when every row is already at its stable end
  const stable = withHandling(fwd, f, { stable: 100, push: 0 });
  assert.deepEqual(handlingSliders(fwd, stable, 'fwd', 0).map((x) => x.which), ['push']);
  // no suspension or brake parts: nothing to move
  const bare = modelOf('3000GT', { EC: 2, TU: 2, TR: 2 }), b = startAfterC(bare);
  assert.deepEqual(handlingSliders(bare, b, 'awd', 0), []);
  assert.deepEqual(withHandling(bare, b, { stable: 100, push: 0 }), b);
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
  assert.ok(lines('push', 'fwd').some((l) => /53\.9 s against 51\.0 s/.test(l.text)));
  assert.match(handlingNote('awd', 0), /no default/);
  assert.match(handlingNote('fwd', 0), /50 %/);
  assert.match(handlingNote('fwd', 1), new RegExp(NOT_MEASURED));
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
