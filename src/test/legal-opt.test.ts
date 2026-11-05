import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, findCar, parseGameData, type CurveKind } from '../model/dyno.js';
import {
  curveLegality, defaultSetup, neighbours, optimize, replayEdits, runLegal, shiftRetentionFloor, worstRetention, type LegalRun,
} from '../model/legal-opt.js';

// Cases come from the dyno-exactness fixture (car, installed parts, setup bytes; numbers only). The reference bytes were
// recorded from runLegal, whose output equals the pre-port CLI (checked on a full profile via relay/baseline-circuit.txt).
// The test needs the game's GLOBALB.BUN, like the other game-data tests.
const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';

interface Case { hash: number; installed: number[]; uniques: number[]; setup: number[] }
interface Ref { caseIndex: number; car: string; plain: number[]; launch: number[]; plainDyno: unknown; launchDyno: unknown }

const exact = JSON.parse(readFileSync(new URL('../../src/test/fixtures/dyno-exactness.json', import.meta.url), 'utf8')) as { cases: Case[] };
const refs = (JSON.parse(readFileSync(new URL('../../src/test/fixtures/legal-opt-reference.json', import.meta.url), 'utf8')) as { cases: Ref[] }).cases;

function open(game: ReturnType<typeof parseGameData>, c: Case): { model: DynoModel; car: string } {
  const car = findCar(game, c.hash >>> 0);
  assert.ok(car, `unknown car ${c.hash}`);
  return { model: new DynoModel(game, car, c.installed.map((b) => b !== 0), c.uniques), car: car.name };
}

function checkLegal(model: DynoModel, report: LegalRun['plain']): void {
  assert.equal(report.legality.legal, true, 'overall legal');
  for (const kind of ['ecu', 'turbo'] as CurveKind[]) {
    const c = curveLegality(model, Uint8Array.from(report.setupBytes), kind);
    if (!c) continue;
    assert.ok(c.inBox, `${kind}: every bar inside its min-max box`);
    assert.ok(c.sumOk, `${kind}: bar sum equals the reset-to-default sum (deviation ${c.dev}, tolerance ${c.tol})`);
  }
}

/** Replays the printed entry order from the reset-to-default state and compares the bars with the searched result. */
function checkEntryOrder(model: DynoModel, report: LegalRun['plain']): void {
  const eo = report.entryOrder;
  assert.equal(eo.converged, true, 'entry order converged');
  const edits = [
    ...eo.ecu.map((e) => ({ kind: 'ecu', index: e.index, nm: e.nm })),
    ...eo.turbo.map((e) => ({ kind: 'turbo', index: e.index, nm: e.nm })),
    ...eo.gears.map((g) => ({ kind: 'gear', param: g.param, ratio: g.ratio })),
  ];
  const target = Uint8Array.from(report.setupBytes);
  const replayed = replayEdits(model, defaultSetup(target), edits);
  for (const kind of ['ecu', 'turbo'] as CurveKind[]) {
    const want = model.curve(target, kind), got = model.curve(replayed, kind);
    if (!want || !got) continue;
    const worst = Math.max(...want.map((p, i) => Math.abs(p.value - got[i].value)));
    assert.ok(worst <= 2.01, `${kind}: replayed bars within 2 N*m of the result (worst ${worst})`);
  }
}

test('legal optimizer reproduces the recorded result, stays legal and its entry order replays', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  assert.ok(refs.length >= 3, 'reference fixture has cases');
  for (const ref of refs) {
    const c = exact.cases[ref.caseIndex];
    const { model, car } = open(game, c);
    const res = runLegal(model, car, c.setup, 0, { launchMin: 0.9 });
    assert.deepEqual(res.plain.setupBytes, ref.plain, `${ref.car}: plain bytes`);
    assert.deepEqual(res.launch!.setupBytes, ref.launch, `${ref.car}: launch-protected bytes`);
    assert.deepEqual(res.plain.dyno, ref.plainDyno, `${ref.car}: plain dyno numbers`);
    assert.deepEqual(res.launch!.dyno, ref.launchDyno, `${ref.car}: launch dyno numbers`);
    checkLegal(model, res.plain);
    checkLegal(model, res.launch!);
    checkEntryOrder(model, res.plain);
    checkEntryOrder(model, res.launch!);
    // Launch protection: the three lowest ECU points keep at least 90 % of stock.
    assert.equal(res.launch!.launch!.points.length, 3);
    for (const p of res.launch!.launch!.points) assert.ok(p.pctOfStock >= 89.9, `${ref.car}: ${p.rpm} rpm at ${p.pctOfStock} % of stock`);
  }
});

test('legal optimizer is deterministic for a given seed', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const ref = refs[0], c = exact.cases[ref.caseIndex];
  const { model, car } = open(game, c);
  const a = runLegal(model, car, c.setup, 0, { seed: 7 });
  const b = runLegal(model, car, c.setup, 0, { seed: 7 });
  assert.deepEqual(a.plain.setupBytes, b.plain.setupBytes);
  assert.deepEqual(a.plain.entryOrder, b.plain.entryOrder);
});

test('gear moves never open a shift hole below the reset-to-default retention floor', { skip: SKIP }, () => {
  // Peugeot 106 with every non-visual performance package (six-speed unlocks all forward gears), no uniques.
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const installed = [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,0,1,0,0,1,0,0,1,0,0,1,0];
  const { model } = open(game, { hash: 0x4b10070a, installed, uniques: new Array<number>(9).fill(0), setup: [] });
  const start = defaultSetup(new Uint8Array(41).fill(100));
  assert.equal(model.gearing(start)!.rows.length, 7, 'six gears and final drive unlocked');
  const floor = shiftRetentionFloor(model, start);
  assert.ok(floor > 0 && floor < 1, `floor ${floor}`);
  const gearMoves = neighbours(model, start).filter((m) => m.desc.kind === 'gear' && m.desc.param !== 9);
  assert.ok(gearMoves.length > 0, 'some gear moves remain');
  for (const m of gearMoves) assert.ok(worstRetention(model, m.bytes) >= floor - 1e-6, `gear ${m.desc.param} -> ${m.desc.ratio}`);
  const res = optimize(model, start, 'circuit', { nRandom: 0, maxIter: 40 });
  assert.ok(worstRetention(model, res.bytes) >= floor - 1e-6, 'optimized gearbox keeps the floor');
});
