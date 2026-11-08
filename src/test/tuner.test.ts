import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, findCar, parseGameData, readSlotDyno, setSetupTuning, type CurveKind } from '../model/dyno.js';
import { defaultSetup } from '../model/legal-opt.js';
import type { SliderPlan } from '../model/hand-input.js';
import { CurveScreen, NitroScreen, openRow, pressFinalDrive, pressRowState, resetRow, rowInfo } from '../model/tune-keys.js';
import {
  categoryScreens, curveKeys, gapWords, goalChoices, groupTabs, legalOptions, menuOrder, planTab, RESET, saveWithTabs, SCREEN_ORDER, screenPlans, startAfterC, tunerSteps, unlockParts, type TabResult,
} from '../model/tuner.js';
import { PERF_PARTS } from '../data/perf-parts.js';
import { buildVirtualSave, installedForLevels, withAero } from '../model/virtual-save.js';
import { withFeel } from '../model/feel.js';
import { parsePrefs } from '../controller/browser-store.js';

const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';
interface Case { hash: number; installed: number[]; uniques: number[]; setup: number[] }
const cases = (JSON.parse(readFileSync(new URL('../../src/test/fixtures/dyno-exactness.json', import.meta.url), 'utf8')) as { cases: Case[] }).cases;

test('preferences map to the existing objectives; the launch rule only with "strong start"', () => {
  assert.deepEqual(legalOptions('race', 0), { objective: 'circuit', launchMin: null });
  assert.deepEqual(legalOptions('race', 4), { objective: 'url', launchMin: null });
  assert.deepEqual(legalOptions('accel', 0), { objective: 'streetx', launchMin: null });
  assert.deepEqual(legalOptions('top', 2), { objective: 'url', launchMin: null });
});

test('each tab offers its own goal first and no goal twice (Street X = acceleration, URL = top speed)', () => {
  assert.deepEqual(goalChoices(0).map((g) => g.key), ['race', 'accel', 'top']);
  assert.deepEqual(goalChoices(3).map((g) => g.key), ['race', 'top']);
  assert.deepEqual(goalChoices(4).map((g) => g.key), ['race', 'accel']);
  for (let setup = 0; setup < 5; setup++) assert.ok(goalChoices(setup).every((g) => g.text), `tab ${setup}: every goal has words`);
});

test('stored Tuner choices: malformed parts are dropped, slider positions clamped, no other keys kept', () => {
  assert.equal(parsePrefs('not json', ['race'], ['stiff']), null);
  const p = parsePrefs(JSON.stringify({ how: 'hand', goals: ['top', 'bogus'], feels: [{ stiff: 250, other: 5 }, null], save: [1, 2] }), ['race', 'top'], ['stiff'])!;
  assert.deepEqual(p, { how: 'hand', units: 'kmh', goals: ['top', 'race', 'race', 'race', 'race'], feels: [{ stiff: 100 }, {}, {}, {}, {}] });
  assert.equal(parsePrefs('{"how":"x"}', ['race'], [])!.how, 'save');
  assert.equal(parsePrefs('{"units":"mph"}', ['race'], [])!.units, 'mph');
  assert.equal(parsePrefs('{"units":"furlongs"}', ['race'], [])!.units, 'kmh');
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
    // Drivetrain: one first step puts every row back with C (a later C on a row a gear key pushed would undo the push);
    // its other steps are the plan's own keys. Every other step starts with C.
    const open = model.gearingParameters.filter((p) => rowInfo(model, start, p));
    const drive = steps.filter((s) => s.screen === 'Drivetrain');
    if (open.length) assert.equal(drive[0]?.row, 'Every row first', `${car.name}: reset step first`);
    if (open.length) assert.equal(drive[0].presses, open.length, `${car.name}: every open row gets its C`);
    for (const s of steps) if (s.screen !== 'Drivetrain' || s === drive[0]) assert.ok(s.keys.startsWith(RESET), `${car.name}: ${s.screen} ${s.row}`);
    const curves = (['ecu', 'turbo'] as const).filter((k) => model.curve(start, k)).length;
    assert.ok(steps.filter((s) => s.curve || s.row === 'Bars').length >= curves, `${car.name}: curves missing`);
  }
});

test('Drivetrain steps read like the screen: 1st..6th Gear, then Final Drive Ratio', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  let checked = 0;
  for (const c of cases) {
    const car = findCar(game, c.hash >>> 0)!;
    const model = new DynoModel(game, car, c.installed.map((b) => b !== 0), c.uniques);
    if (!model.gearingParameters.includes(10)) continue;
    for (const start of [Uint8Array.from(c.setup), startAfterC(model)]) {
      const t = target(model, start);
      for (const p of [10, 12, 14]) if (rowInfo(model, t, p)) t[p] = Math.max(0, t[p] - 25);
      const rows = menuOrder(planTab(model, 0, start, t, 'race').plan.plans).filter((p) => p.screen === 'Drivetrain')
        .map((p) => p.row?.param ?? 9);
      const fd = rows.indexOf(9);
      if (fd >= 0) assert.equal(fd, rows.length - 1, `${car.name}: final drive last (${rows})`);
      // top to bottom once, and at most a second round (a gear key pushed a neighbour)
      const gears = rows.filter((p) => p !== 9);
      assert.ok(gears.filter((p, i) => i > 0 && p <= gears[i - 1]).length <= 1, `${car.name}: gears in order (${rows})`);
      checked++;
    }
  }
  assert.ok(checked >= 2, `only ${checked} 6-speed plans`);
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

test('best against keys in numbers: plus = the best is quicker; below the dyno screen\'s digits = the same', () => {
  assert.equal(gapWords({ t60: 0.02, t100: 0, topKmh: -1.2, powerBhp: 0 }), '0-60 0.02 s quicker, top speed 1.2 km/h higher');
  assert.equal(gapWords({ t60: 0.004, t100: null, topKmh: 0.04, powerBhp: 3 }), 'the same');
  assert.equal(gapWords({ t60: -0.01, t100: 0.03, topKmh: 0, powerBhp: 0 }), '0-60 0.01 s slower, 0-100 0.03 s quicker');
});

test('download "same as the keys": the save holds, on all 5 tabs of the 3000GT, the bytes the card\'s keys give', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const c = cases.find((x) => x.hash >>> 0 === 0x2d7c9b5d)!;
  const car = findCar(game, 0x2d7c9b5d)!;
  const installed = c.installed.map((b) => b !== 0);
  const model = new DynoModel(game, car, installed, c.uniques);
  let save = buildVirtualSave(0x2d7c9b5d, installed);
  for (let k = 0; k < 5; k++) save = setSetupTuning(save, 0, k, Uint8Array.from(c.setup), true, true);
  const starts = readSlotDyno(save, 0).setups;
  // every tab another goal and driving sliders, so the rows of both kinds are in the keys
  const results = starts.map((start, k) => {
    const opt = withFeel(model, start, target(model, start), { steering: k % 2 ? -50 : 60, brakes: -40 + 20 * k, nitrous: 50 });
    return planTab(model, k, start, opt, 'race');
  });
  const keys = readSlotDyno(saveWithTabs(save, 0, results, 'keys'), 0).setups;
  const best = readSlotDyno(saveWithTabs(save, 0, results, 'best'), 0).setups;
  let differs = 0;
  results.forEach((r, k) => {
    const typed = replay(model, starts[k], menuOrder(r.plan.plans));
    assert.deepEqual(Array.from(keys[k]), Array.from(typed), `tab ${k}: save = keys`);
    assert.deepEqual(Array.from(best[k]), Array.from(r.optimum), `tab ${k}: save = best`);
    assert.ok(r.plan.plans.some((p) => p.row?.param === 8), `tab ${k}: steering keys`);
    if (Array.from(typed).some((b, i) => b !== r.optimum[i])) differs++;
  });
  assert.ok(differs > 0, 'keys and best are the same on every tab: the test proves nothing');
  // the loaded save is not changed
  assert.deepEqual(Array.from(readSlotDyno(save, 0).setups[0]), c.setup);
});
