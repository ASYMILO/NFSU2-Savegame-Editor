import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, parseGameData } from '../model/dyno.js';
import { FEEL_SLIDERS, feelSliders, withFeel } from '../model/feel.js';
import { lockedWhatIf, planTab, startAfterC } from '../model/tuner.js';
import { installedForLevels, levelsOf, withAero } from '../model/virtual-save.js';

const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';

test('part levels read back from the installed flags', () => {
  const levels = { EC: 2, TU: 3, TR: 1, EN: 0, NO: 2, SU: 3, BR: 1, TI: 2, WT: 0, AEF: 3, AES: 1 };
  const got = levelsOf(withAero(installedForLevels(levels), levels));
  for (const [k, v] of Object.entries(levels)) assert.equal(got[k], v, k);
});

test('feel sliders: 0 changes nothing, each side moves its rows the named way, engine rows stay', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const car = game.cars.find((c) => c.name === '3000GT')!;
  const levels = { EC: 3, TU: 3, TR: 3, NO: 3, SU: 3, BR: 3, TI: 3, AEF: 3, AES: 3 };
  const model = new DynoModel(game, car, withAero(installedForLevels(levels), levels), new Array(9).fill(0));
  const start = startAfterC(model);
  assert.deepEqual(withFeel(model, start, start, {}), start);
  assert.deepEqual(feelSliders(model, start, [0]).map((s) => s.key), FEEL_SLIDERS.map((s) => s.key));
  assert.ok(!feelSliders(model, start, [2]).some((s) => s.key === 'nitrous'), 'Drift turns nitrous off');
  for (const s of FEEL_SLIDERS) {
    const up = withFeel(model, start, start, { [s.key]: 100 }), down = withFeel(model, start, start, { [s.key]: -100 });
    for (let i = 0x09; i <= 0x28; i++) if (i < 16 || i > 22) assert.equal(up[i], start[i], `${s.key} keeps engine byte ${i}`);
    for (const p of s.params) {
      // nitrous: right = shorter = duration byte down; the rest: right = the row's value up
      const sign = p === 16 ? -1 : 1;
      assert.ok(sign * (up[p] - start[p]) >= 0 && sign * (down[p] - start[p]) <= 0, `${s.key} byte ${p}: ${down[p]} ${start[p]} ${up[p]}`);
      assert.ok(up[p] !== down[p], `${s.key} byte ${p} moves`);
    }
  }
  // the keys reach a feel target within a byte, from the factory setting
  const target = withFeel(model, start, start, { stiff: 50, brakes: -50 });
  const plan = planTab(model, 0, start, target, 'race').plan;
  for (const p of [0, 4, 1, 5, 18]) assert.ok(Math.abs(plan.setup[p] - target[p]) <= 1, `row ${p}: ${plan.setup[p]} vs ${target[p]}`);
});

test('locked engine screen: what-if with the part that opens it', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const car = game.cars.find((c) => c.name === '3000GT')!;
  const model = new DynoModel(game, car, installedForLevels({ TR: 2 }), new Array(9).fill(0));
  const w = lockedWhatIf(model, model.installed, model.uniques, 'ECU');
  assert.ok(w && /\(Street\)$/.test(w.part), w?.part);
  assert.ok(Number.isFinite(w!.withPart.topKmh) && Number.isFinite(w!.now.topKmh));
  console.log(`what-if ECU on 3000GT (TR Pro): ${w!.part}`, JSON.stringify(w!.now), JSON.stringify(w!.withPart));
});

test('feel sliders open only the sides where every row has room (rear grip only down, Street/Pro downforce only down)', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const car = game.cars.find((c) => c.name === '3000GT')!;
  for (const level of [1, 2, 3]) {
    const levels = { EC: 2, TU: 2, TR: 2, SU: level, BR: level, TI: level, AEF: level, AES: level };
    const model = new DynoModel(game, car, withAero(installedForLevels(levels), levels), new Array(9).fill(0));
    const start = startAfterC(model);
    const by = Object.fromEntries(feelSliders(model, start, [0]).map((s) => [s.key, s]));
    // tire grip: the box ends at what the tires give (setup-bytes.md l.53), after C the row sits there
    assert.deepEqual([by.rearGrip.min, by.rearGrip.max], [-100, 0], `L${level} rear grip`);
    assert.equal(withFeel(model, start, start, { rearGrip: 100 })[20], start[20], `L${level} rear grip right does nothing`);
    // downforce L1/L2 only lowers (front sits at the top of the shared box), L3 has room both ways
    assert.deepEqual([by.downforce.min, by.downforce.max], level < 3 ? [-100, 0] : [-100, 100], `L${level} downforce`);
    const up = withFeel(model, start, start, { downforce: 100 });
    if (level < 3) assert.deepEqual([up[21], up[22]], [start[21], start[22]], `L${level}: no one-axle move`);
    else assert.ok(up[21] > start[21] && up[22] > start[22], 'L3: both axles up');
  }
});
