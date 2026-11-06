import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, findCar, parseGameData, type CurveKind } from '../model/dyno.js';
import { defaultSetup } from '../model/legal-opt.js';
import type { SliderPlan } from '../model/hand-input.js';
import { CurveScreen, NitroScreen, openRow, pressFinalDrive, pressRowState, resetRow, rowInfo } from '../model/tune-keys.js';
import {
  categoryScreens, curveKeys, groupTabs, legalOptions, menuOrder, planTab, RESET, SCREEN_ORDER, screenPlans, startAfterC, tunerSteps, unlockParts, type TabResult,
} from '../model/tuner.js';
import { PERF_PARTS } from '../data/perf-parts.js';
import { installedForLevels, withAero } from '../model/virtual-save.js';

const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';
interface Case { hash: number; installed: number[]; uniques: number[]; setup: number[] }
const cases = (JSON.parse(readFileSync(new URL('../../src/test/fixtures/dyno-exactness.json', import.meta.url), 'utf8')) as { cases: Case[] }).cases;

test('preferences map to the existing objectives; the launch rule only with "strong start"', () => {
  assert.deepEqual(legalOptions('race', 0), { objective: 'circuit', launchMin: null });
  assert.deepEqual(legalOptions('race', 4), { objective: 'url', launchMin: null });
  assert.deepEqual(legalOptions('launch', 1), { objective: 'drag', launchMin: 0.9 });
  assert.deepEqual(legalOptions('accel', 0), { objective: 'streetx', launchMin: null });
  assert.deepEqual(legalOptions('top', 2), { objective: 'url', launchMin: null });
});

test('tabs with the same start, keys and result share a card', () => {
  const fake = (setup: number, a: number, b: number): TabResult => ({
    setup, start: Uint8Array.of(1), optimum: Uint8Array.of(b), legalSheet: '', handSheet: '',
    plan: { setup: Uint8Array.of(a), plans: [], presses: 0, a: null!, b: null!, diff: null! },
  });
  const groups = groupTabs([fake(0, 5, 6), fake(1, 5, 7), fake(2, 5, 6), fake(3, 4, 6), fake(4, 5, 6)]);
  assert.deepEqual(groups.map((g) => g.map((r) => r.setup)), [[0, 2, 4], [1], [3]]);
});

/** A reachable-by-bars target with a final drive change (as in hand-input.test.ts). */
function target(model: DynoModel, saved: Uint8Array): Uint8Array {
  let t = defaultSetup(saved);
  for (const kind of ['ecu', 'turbo'] as CurveKind[]) {
    const pts = model.curve(t, kind);
    if (!pts) continue;
    for (const i of [1, 4, 7]) t = model.withCurvePoint(t, kind, i, pts[i].min + 0.8 * (pts[i].max - pts[i].min));
  }
  if (model.gearingParameters.includes(9)) t[9] = 120;
  return t;
}

/** Plays a plan's presses with the game's key code, screen by screen in the given order. */
function replay(model: DynoModel, start: Uint8Array, plans: SliderPlan[]): Uint8Array {
  let setup: Uint8Array = Uint8Array.from(start);
  for (const p of plans) {
    const runs = p.passes.map((r) => r[0]).filter(Boolean);
    if (p.id === 'ecu' || p.id === 'turbo') {
      const s = new CurveScreen(model, setup, p.id);
      s.reset();
      for (const row of p.passes) row.forEach((n, col) => { for (let k = 0; k < Math.abs(n); k++) s.press(col, n > 0 ? 1 : -1); });
      setup = s.setupBytes();
    } else if (p.row?.param === 16) {
      let n = NitroScreen.open(model, setup)!;
      for (const run of runs) for (let k = 0; k < Math.abs(run); k++) n = n.press(run > 0 ? 1 : -1)!;
      setup = n.setupBytes();
    } else if (p.row) {
      const info = rowInfo(model, setup, p.row.param)!;
      let st = p.start === 'C' ? resetRow(model, setup, p.row.param) : openRow(model, setup);
      for (const run of runs) for (let k = 0; k < Math.abs(run); k++) st = pressRowState(model, info, st, run > 0 ? 1 : -1)!;
      setup = Uint8Array.from(st.setup);
    } else {
      let b = p.start === 'C' ? Uint8Array.from(setup, (v, i) => (i === 9 ? 100 : v)) : setup;
      for (const run of runs) for (let k = 0; k < Math.abs(run); k++) b = pressFinalDrive(model, b, run > 0 ? 1 : -1)!;
      setup = Uint8Array.from(b);
    }
  }
  return setup;
}

test('the card order (game menu: Drivetrain before ECU and Turbo) gives the same bytes as the planned order', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  let moved = 0;
  for (const c of cases) {
    const car = findCar(game, c.hash >>> 0)!;
    const model = new DynoModel(game, car, c.installed.map((b) => b !== 0), c.uniques);
    for (const start of [Uint8Array.from(c.setup), startAfterC(model)]) {
      const r = planTab(model, 0, start, target(model, start), 'race');
      const ordered = menuOrder(r.plan.plans);
      const ranks = ordered.map((p) => SCREEN_ORDER.indexOf(p.screen));
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${car.name}: menu order`);
      if (ordered.some((p, i) => p !== r.plan.plans[i])) moved++;
      assert.deepEqual(Array.from(replay(model, start, ordered)), Array.from(r.plan.setup), `${car.name}: bytes in menu order`);
    }
  }
  assert.ok(moved >= 10, `only ${moved} plans were reordered`);
});

test('no save: every step starts with C, and every curve and drivetrain row Optimize may move is listed', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  for (const c of cases.slice(0, 12)) {
    const car = findCar(game, c.hash >>> 0)!;
    const model = new DynoModel(game, car, c.installed.map((b) => b !== 0), c.uniques);
    const start = startAfterC(model);
    // key C on a row of the start changes nothing: the start is the state after C
    for (const param of model.gearingParameters) assert.deepEqual(Array.from(resetRow(model, start, param).setup), Array.from(start), `${car.name}: row ${param}`);
    const steps = tunerSteps(model, planTab(model, 0, start, target(model, start), 'race'), true);
    for (const s of steps) assert.ok(s.keys.startsWith(RESET), `${car.name}: ${s.screen} ${s.row}`);
    const curves = (['ecu', 'turbo'] as const).filter((k) => model.curve(start, k)).length;
    assert.ok(steps.length >= curves + model.gearingParameters.filter((p) => rowInfo(model, start, p)).length, `${car.name}: rows missing`);
  }
});

test('which part opens which screen comes from the game\'s tuning records', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  assert.deepEqual(unlockParts(game, [0, 1, 2, 3, 4, 5, 6, 7, 8]), ['Sport Springs And Shocks (Street)', 'Strut Tower Bar (Street)', 'Camber Kit (Pro)']);
  assert.deepEqual(unlockParts(game, [21, 22]), ['a body-shop front bumper (not stock)', 'a body-shop spoiler (not stock)']);
  assert.deepEqual(categoryScreens(game, 'BR'), ['Tires & Brakes']);
  assert.deepEqual(categoryScreens(game, 'TR'), ['Drivetrain']);
  assert.deepEqual(categoryScreens(game, 'EN'), []);
  assert.deepEqual(categoryScreens(game, 'WT'), []);
});

test('a card lists every screen in menu order; screens without a part are locked', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const car = game.cars.find((c) => c.name === '3000GT')!;
  const model = new DynoModel(game, car, installedForLevels({ EC: 2 }), new Array(9).fill(0));
  const start = startAfterC(model);
  const plans = screenPlans(model, [2], tunerSteps(model, planTab(model, 2, start, target(model, start), 'race'), true));
  assert.deepEqual(plans.map((p) => p.name), SCREEN_ORDER);
  assert.equal(plans.find((p) => p.name === 'ECU')!.state, 'set');
  for (const name of ['Suspension', 'Drivetrain', 'Aerodynamics', 'Tires & Brakes', 'Turbo', 'Nitrous']) {
    assert.equal(plans.find((p) => p.name === name)!.state, 'locked', name);
  }
});

test('aero levels set one front bumper and one spoiler flag', () => {
  const on = withAero(new Array(68).fill(false), { AEF: 2, AES: 3 });
  assert.deepEqual(on.flatMap((b, i) => (b ? [PERF_PARTS[i].key] : [])), ['AE_FRONT_BUMPER_L2', 'AE_SPOILER_L3']);
  assert.ok(!withAero(on, { AEF: 0, AES: 0 }).some(Boolean));
});

test('graph keys: RIGHT after every bar, RIGHT on bar 9 wraps to bar 1, stop after the last bar with presses', () => {
  // two rounds; the 2nd ends on bar 3 (game: native/runs/wrap_20261106 of the tuner repo, ECU and Turbo)
  const keys = curveKeys([[2, 0, -1, 0, 0, 0, 0, 0, 1], [0, 0, 1, 0, 0, 0, 0, 0, 0]]);
  assert.deepEqual(keys, ['C', 'UP', 'UP', 'RIGHT', 'RIGHT', 'DOWN', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'UP', 'RIGHT',
    'RIGHT', 'RIGHT', 'UP']);
  assert.equal(keys.filter((k) => k === 'LEFT').length, 0);
  assert.deepEqual(curveKeys([]), ['C']);
});
