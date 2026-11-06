import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, findCar, parseGameData, type CurveKind } from '../model/dyno.js';
import { defaultSetup } from '../model/legal-opt.js';
import { formatHandPlan, planHandInput } from '../model/hand-input.js';
import { CurveScreen, NitroScreen, openRow, pressFinalDrive, pressRowState, resetRow, rowInfo } from '../model/tune-keys.js';

const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';
interface Case { hash: number; installed: number[]; uniques: number[]; setup: number[] }
const cases = (JSON.parse(readFileSync(new URL('../../src/test/fixtures/dyno-exactness.json', import.meta.url), 'utf8')) as { cases: Case[] }).cases;

/** A reachable-by-bars target: the game's reset state with a few bar edits (what mode B hands over). */
function target(model: DynoModel, saved: Uint8Array): Uint8Array {
  let t = defaultSetup(saved);
  for (const kind of ['ecu', 'turbo'] as CurveKind[]) {
    const pts = model.curve(t, kind);
    if (!pts) continue;
    for (const i of [1, 4, 7]) t = model.withCurvePoint(t, kind, i, pts[i].min + 0.8 * (pts[i].max - pts[i].min));
  }
  return t;
}

test('mode A: the planned presses, replayed on a fresh screen, give the planned bytes and get closer to the optimum', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  let planned = 0;
  for (const c of cases) {
    const car = findCar(game, c.hash >>> 0)!;
    const model = new DynoModel(game, car, c.installed.map((b) => b !== 0), c.uniques);
    const saved = Uint8Array.from(c.setup), opt = target(model, saved);
    const plan = planHandInput(model, saved, opt, 0);
    let setup: Uint8Array = Uint8Array.from(saved);
    for (const p of plan.plans) {
      if (p.id === 'ecu' || p.id === 'turbo') {
        const s = new CurveScreen(model, setup, p.id as 'ecu' | 'turbo');
        const wanted = model.curve(opt, p.id as CurveKind)!.map((q) => q.value);
        s.reset();
        const before = wanted.reduce((e, w, i) => e + (s.value(i) - w) ** 2, 0);
        for (const row of p.passes) row.forEach((n, col) => { for (let k = 0; k < Math.abs(n); k++) assert.ok(s.press(col, n > 0 ? 1 : -1)); });
        assert.deepEqual(Array.from(s.bytes), Array.from(p.setup.subarray(p.id === 'ecu' ? 0x17 : 0x20, (p.id === 'ecu' ? 0x17 : 0x20) + 9)));
        const after = wanted.reduce((e, w, i) => e + (s.value(i) - w) ** 2, 0);
        assert.ok(after <= before, `${car.name} ${p.id}: ${after} > ${before}`);
        assert.equal(p.presses, p.passes.flat().reduce((n, x) => n + Math.abs(x), 0));
        planned++;
        setup = s.setupBytes();
      } else if (p.row) {
        // number sliders: the same keys on a fresh visit give the planned bytes
        const runs = p.passes.map((r) => r[0]).filter(Boolean);
        if (p.row.param === 16) {
          let n = NitroScreen.open(model, setup)!;
          for (const run of runs) for (let k = 0; k < Math.abs(run); k++) n = n.press(run > 0 ? 1 : -1)!;
          setup = n.setupBytes();
        } else {
          const info = rowInfo(model, setup, p.row.param)!;
          let st = p.start === 'C' ? resetRow(model, setup, p.row.param) : openRow(model, setup);
          for (const run of runs) for (let k = 0; k < Math.abs(run); k++) st = pressRowState(model, info, st, run > 0 ? 1 : -1)!;
          setup = st.setup;
        }
        assert.deepEqual(Array.from(setup), Array.from(p.setup), `${car.name}: row ${p.row.param}`);
        planned++;
      } else {
        let b = p.start === 'C' ? Uint8Array.from(setup, (v, i) => (i === 9 ? 100 : v)) : setup;
        for (const run of p.passes.map((r) => r[0]).filter(Boolean)) {
          for (let k = 0; k < Math.abs(run); k++) b = pressFinalDrive(model, b, run > 0 ? 1 : -1)!;
        }
        assert.equal(b[9], p.setup[9], `${car.name}: final drive bytes`);
        setup = Uint8Array.from(b);
      }
    }
    assert.deepEqual(Array.from(setup), Array.from(plan.setup), `${car.name}: whole setup`);
  }
  assert.ok(planned >= 20, `only ${planned} curve plans`);
});

test('mode A sheet names the keys and the A minus B line', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const c = cases.find((x) => findCar(game, x.hash >>> 0)?.name === '3000GT') ?? cases[0];
  const car = findCar(game, c.hash >>> 0)!;
  const model = new DynoModel(game, car, c.installed.map((b) => b !== 0), c.uniques);
  const saved = Uint8Array.from(c.setup);
  const text = formatHandPlan(planHandInput(model, saved, target(model, saved), 0), 0);
  assert.match(text, /press C \(Reset to default\) first/);
  assert.match(text, /A minus B/);
  assert.doesNotMatch(text, /Reset to default.*Drivetrain/);
});
