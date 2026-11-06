import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, findCar, parseGameData, readSlotDyno, type GameData } from '../model/dyno.js';
import { buildVirtualSave, installedForLevels } from '../model/virtual-save.js';
import { formatHandPlan, planHandInput, routeToByte } from '../model/hand-input.js';
import { NitroScreen, openRow, pressFinalDrive, pressRowState, resetRow, rowInfo, rowShown, setRowShown } from '../model/tune-keys.js';

const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';
const load = (): GameData => parseGameData(new Uint8Array(readFileSync(GAME_BUN)));

/** The owner's 3000GT with everything of the given level (transmission level 2 = diff only, 3 = six-speed). */
function gt(game: GameData, level: number): DynoModel {
  const car = game.cars.find((c) => c.name === '3000GT')!;
  const levels = Object.fromEntries(['EC', 'TU', 'TR', 'EN', 'NO', 'SU', 'BR', 'TI', 'WT'].map((c) => [c, level]));
  return new DynoModel(game, car, installedForLevels(levels), new Array(9).fill(0));
}
const neutral = (...edits: [number, number][]): Uint8Array => { const s = new Uint8Array(41).fill(100); for (const [i, b] of edits) s[i] = b; return s; };

test('final drive: byte 101 is 9 presses from 128 and 45 from key C (all four ways: LEFT, RIGHT, C, bounce off the ends)', { skip: SKIP }, () => {
  const model = gt(load(), 2);
  const from128 = routeToByte(model, neutral([9, 128]), 9, 101, 0, 'never')!;
  assert.equal(from128.presses, 9);
  assert.deepEqual(from128.runs, [-9]);
  const fromC = routeToByte(model, neutral([9, 128]), 9, 101, 0, 'only')!;
  assert.equal(fromC.presses - 1, 45, 'presses after C: up to the top end (167) and back down the shifted grid');
  assert.deepEqual(fromC.runs, [23, -22]);
  assert.equal(routeToByte(model, neutral([9, 128]), 9, 101, 0, 'auto')!.presses, 9);
});

test('shortest path equals a brute-force search on the final drive, for every reachable byte and both starts', { skip: SKIP }, () => {
  const model = gt(load(), 2);
  for (const start of [100, 128, 167, 67, 120]) {
    // independent search: plain relaxation over bytes with the final drive key (pressFinalDrive), no shared code with the route search
    const dist = new Map<number, number>([[start, 0]]);
    for (let round = 0; round < 120; round++) {
      let changed = false;
      for (const [b, d] of [...dist]) {
        for (const dir of [1, -1] as const) {
          const n = pressFinalDrive(model, neutral([9, b]), dir);
          if (n && (dist.get(n[9]) ?? Infinity) > d + 1) { dist.set(n[9], d + 1); changed = true; }
        }
      }
      if (!changed) break;
    }
    for (const [target, d] of dist) {
      const r = routeToByte(model, neutral([9, start]), 9, target, 0, 'never')!;
      assert.equal(r.presses, d, `start ${start} -> ${target}`);
      assert.equal(r.setup[9], target);
    }
  }
});

test('a slack of one byte takes the cheaper way; C is used when it is shorter', { skip: SKIP }, () => {
  const model = gt(load(), 2);
  const near = routeToByte(model, neutral([9, 128]), 9, 100, 1, 'auto')!;
  assert.deepEqual([near.useC, near.presses], [true, 1], 'key C lands on byte 100 in one press');
  const exact = routeToByte(model, neutral([9, 128]), 9, 100, 0, 'never')!;
  assert.ok(exact.presses > 5);
});

test('suspension row: plan replays to the planned byte and the shown number follows the key', { skip: SKIP }, () => {
  const model = gt(load(), 2);
  const saved = neutral();
  const info = rowInfo(model, saved, 0)!;
  assert.ok(info, 'front springs unlocked at suspension level 2');
  const want = setRowShown(model, saved, 0, 8.0)!;
  const plan = planHandInput(model, saved, want, 0, undefined, [0]);
  const p = plan.plans.find((x) => x.row?.param === 0)!;
  assert.ok(p, 'a plan for front springs');
  let st = p.start === 'C' ? resetRow(model, saved, 0) : openRow(model, saved);
  for (const run of p.passes.map((r) => r[0]).filter(Boolean)) {
    for (let k = 0; k < Math.abs(run); k++) st = pressRowState(model, info, st, run > 0 ? 1 : -1)!;
  }
  assert.equal(st.setup[0], plan.setup[0]);
  assert.ok(Math.abs(plan.setup[0] - want[0]) <= 1);
  assert.ok(Math.abs(rowShown(info, plan.setup[0]) - 8.0) < 0.25, 'within one key of the typed number');
  assert.match(formatHandPlan(plan, 0), /Suspension > Front Springs/);
});

test('nitrous: duration keys move the pair apart (power goes the other way), 5 keys from the middle to each end', { skip: SKIP }, () => {
  const model = gt(load(), 3);
  let s = NitroScreen.open(model, neutral())!;
  assert.ok(s);
  const seen: number[][] = [];
  for (let k = 0; k < 5; k++) { s = s.press(1)!; seen.push([...s.bytes]); }
  assert.deepEqual(seen, [[110, 90], [120, 80], [130, 70], [140, 60], [150, 50]]);
  assert.equal(s.press(1), null, 'the end of the box');
  const plan = planHandInput(model, neutral(), neutral([16, 130], [17, 70]), 0);
  const p = plan.plans.find((x) => x.row?.param === 16)!;
  assert.deepEqual([p.passes, p.presses], [[[3]], 3]);
  assert.deepEqual([plan.setup[16], plan.setup[17]], [130, 70]);
});

test('six-speed: a typed gear speed is reached with keys; a pushed neighbour is fixed in a second round', { skip: SKIP }, () => {
  const model = gt(load(), 3);
  const saved = openRow(model, neutral()).setup;
  const info = rowInfo(model, saved, 12)!;
  assert.ok(info, '3rd gear exists with a six-speed gearbox');
  const wanted = rowShown(info, saved[12]) + 25;
  let want = setRowShown(model, saved, 12, wanted)!;
  want = setRowShown(model, want, 13, rowShown(rowInfo(model, want, 13)!, want[13]))!;
  const plan = planHandInput(model, saved, want, 0, undefined, [12]);
  const p = plan.plans.find((x) => x.row?.param === 12)!;
  assert.ok(p && p.presses >= 1 && p.presses <= 12, `3rd gear took ${p?.presses} keys`);
  assert.ok(Math.abs(plan.setup[12] - want[12]) <= 1);
  // the dyno reads the planned bytes: A is a real setup of this car
  assert.ok(plan.a.topKmh > 0);
});

test('no-save mode: the final drive starts where the owner says the screen stands (byte 128) and byte 101 is 9 presses away', { skip: SKIP }, () => {
  const game = load();
  const car = game.cars.find((c) => c.name === '3000GT')!;
  // the no-save path: an in-memory save with neutral setups (every row at what key C gives)
  const save = buildVirtualSave(car.hash, installedForLevels({ EC: 3, TU: 2, TR: 2 }));
  const sd = readSlotDyno(save, 0), model = new DynoModel(game, findCar(game, sd.hash)!, sd.installed, sd.uniques);
  const neutralSetup = sd.setups[1];
  assert.equal(neutralSetup[9], 100, 'default start = the value after C');
  // the owner types the number the final drive shows now (the one byte 128 stands for) and the number he wants (byte 101's)
  const info = rowInfo(model, neutralSetup, 9)!;
  const start = setRowShown(model, neutralSetup, 9, rowShown(info, 128))!;
  assert.equal(start[9], 128);
  const want = setRowShown(model, start, 9, rowShown(info, 101))!;
  assert.equal(want[9], 101);
  const plan = planHandInput(model, start, want, 1, undefined, [9], [9]); // 3 decimals typed: the byte, not just the number on the screen
  const fd = plan.plans.find((p) => p.row?.param === 9)!;
  assert.deepEqual([fd.start, fd.presses, fd.passes], ['saved', 9, [[-9]]]);
  assert.equal(plan.setup[9], 101);
  // the default start (nothing typed) is the value after C, byte 100. The number 3.97 is also what bytes 101..103 show, so
  // one RIGHT reaches it; the exact byte 101 takes 45 keys from there (23 RIGHT to the top end, 22 LEFT down the shifted grid).
  const fromC = planHandInput(model, neutralSetup, want, 1, undefined, [9]).plans.find((p) => p.row?.param === 9)!;
  assert.deepEqual([fromC.presses, fromC.row!.reached, fromC.setup[9]], [1, '3.97', 103]);
  assert.equal(routeToByte(model, neutralSetup, 9, 101, 0, 'never')!.presses, 45);
});

test('a number typed at the screen\'s precision counts when the screen shows it: fewer keys than the exact byte', { skip: SKIP }, () => {
  const model = gt(load(), 2);
  const info = rowInfo(model, neutral(), 9)!;
  const start = neutral([9, 128]);
  const want = setRowShown(model, start, 9, Number(rowShown(info, 101).toFixed(2)))!;
  const loose = planHandInput(model, start, want, 1, undefined, [9]).plans.find((p) => p.row?.param === 9)!;
  const exact = planHandInput(model, start, want, 1, undefined, [9], [9]).plans.find((p) => p.row?.param === 9)!;
  assert.equal(loose.row!.reached, loose.row!.wanted);
  assert.ok(loose.presses <= exact.presses);
});
