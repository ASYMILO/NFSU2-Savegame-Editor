import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, parseGameData } from '../model/dyno.js';
import { BRAKE_STOP_M, DRIVE_SPEEDS, FEEL_SLIDERS, STEERING_TURN_PCT, feelSliders, withFeel } from '../model/feel.js';
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
  const target = withFeel(model, start, start, { steering: 50, brakes: -50 });
  const plan = planTab(model, 0, start, target, 'race').plan;
  for (const p of [8, 18]) assert.ok(Math.abs(plan.setup[p] - target[p]) <= 1, `row ${p}: ${plan.setup[p]} vs ${target[p]}`);
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

test('feel sliders: only rows measured in the game (round 3g), and a side opens only where the row has room', { skip: SKIP }, () => {
  assert.deepEqual(FEEL_SLIDERS.map((s) => s.params), [[8], [18], [16]]);
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const car = game.cars.find((c) => c.name === '3000GT')!;
  const levels = { EC: 2, TU: 2, TR: 2, SU: 3, BR: 3, TI: 3 };
  const model = new DynoModel(game, car, withAero(installedForLevels(levels), levels), new Array(9).fill(0));
  const start = startAfterC(model);
  const steer = feelSliders(model, start, [0]).find((s) => s.key === 'steering')!;
  assert.deepEqual([steer.min, steer.max], [-100, 100]);
  // at the top of the box the right side closes and says why
  const top = Uint8Array.from(start); top[8] = 200;
  const atTop = feelSliders(model, top, [0]).find((s) => s.key === 'steering')!;
  assert.deepEqual([atTop.min, atTop.max], [-100, 0]);
  assert.match(atTop.limit, /Only to the left/);
});

test('driving sliders: the card words are the game measurements at 100, 150 and 200 km/h (round 3i), nothing else', () => {
  // raw readings, tuner repo docs/game-check-r3i.md C: stick 0.4 side g [lowest byte, baseline, highest byte]; full-brake stop m [lowest, baseline, highest]
  const side = [[0.702, 0.7525, 0.893], [0.687, 0.698, 0.852], [0.543, 0.561, 0.566]];
  const stop = [[20.81, 23.04, 27.75], [45.67, 48.18, 56.7], [80.16, 82.73, 92.6]];
  assert.deepEqual(DRIVE_SPEEDS, [100, 150, 200]);
  assert.deepEqual(side.map(([lo, b, hi]) => [Math.round((lo / b - 1) * 100), Math.round((hi / b - 1) * 100)]), STEERING_TURN_PCT);
  assert.deepEqual(stop.map((r) => r.map(Math.round)), BRAKE_STOP_M);
  const steering = FEEL_SLIDERS.find((s) => s.key === 'steering')!.when, braking = FEEL_SLIDERS.find((s) => s.key === 'brakes')!.when;
  assert.match(steering, /at 100 km\/h 7 % less \/ 19 % more, at 150 km\/h 2 % less \/ 22 % more, at 200 km\/h 3 % less \/ 1 % more/);
  assert.match(braking, /from 100 km\/h 21 \/ 23 \/ 28 m, from 150 km\/h 46 \/ 48 \/ 57 m, from 200 km\/h 80 \/ 83 \/ 93 m/);
  for (const w of [steering, braking]) assert.ok(!/weaker|jargon|ratio|bias/i.test(w), w);
});
