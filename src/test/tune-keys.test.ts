import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, findCar, parseGameData } from '../model/dyno.js';
import { CurveScreen } from '../model/tune-keys.js';

// Reference bytes come from SPEED2.EXE's own press code in the emulator (tools/emu/press_cases.py): numbers only.
// The first cases are the sequences measured in the running game (docs/native-menu-map.md in the tuner repo).
// Needs GLOBALB.BUN like the other game-data tests.
const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';

type Op = [number, 1 | -1] | 'C';
interface Case {
  hash: number; installed: number[]; uniques: number[]; setup: number[]; screen: 'ecu' | 'turbo'; ops: Op[];
  measured: boolean; start: number[]; bytes: number[][];
}
const fixture = JSON.parse(readFileSync(new URL('../../src/test/fixtures/press-reference.json', import.meta.url), 'utf8')) as { cases: Case[] };

function open(game: ReturnType<typeof parseGameData>, c: Case): CurveScreen {
  const car = findCar(game, c.hash >>> 0);
  assert.ok(car, `unknown car ${c.hash}`);
  return new CurveScreen(new DynoModel(game, car, c.installed.map((b) => b !== 0), c.uniques), c.setup, c.screen);
}

test('ECU: UP, UP, DOWN on the idle column gives the bytes measured in the game', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const c = fixture.cases[0];
  assert.deepEqual(c.start, [66, 76, 100, 131, 136, 134, 99, 127, 36]);
  const s = open(game, c);
  const seen: number[][] = [];
  for (const op of c.ops) { s.run([op]); seen.push(Array.from(s.bytes)); }
  assert.deepEqual(seen[0], [76, 79, 100, 128, 134, 131, 95, 124, 36]);
  assert.deepEqual(seen[2], [76, 79, 96, 128, 133, 131, 95, 124, 39], 'measured in game: 66 76 100 131 .. -> 76 79 96 128 ..');
});

test('Turbo: UP, UP, DOWN on column 3 gives the bytes measured in the game', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const c = fixture.cases[1];
  assert.deepEqual(c.start, [101, 100, 93, 108, 136, 128, 100, 100, 0]);
  const s = open(game, c);
  s.run(c.ops);
  assert.deepEqual(Array.from(s.bytes), [107, 107, 86, 118, 134, 125, 96, 96, 2]);
});

test('every key of 107 sequences (40 part sets, ECU and Turbo, with Reset) writes the bytes the game writes', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  let steps = 0;
  fixture.cases.forEach((c, n) => {
    const s = open(game, c);
    c.ops.forEach((op, k) => {
      s.run([op]);
      steps++;
      assert.deepEqual(Array.from(s.bytes), c.bytes[k], `case ${n} (${c.screen}) step ${k} ${JSON.stringify(op)}`);
    });
  });
  assert.ok(steps > 1000, `only ${steps} steps`);
});

test('a press at the end of the box changes nothing; Reset gives 100 everywhere', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const s = open(game, fixture.cases[0]);
  for (let i = 0; i < 30; i++) s.press(2, 1);
  const top = Array.from(s.bytes);
  assert.equal(s.press(2, 1), false, 'column 2 sits at its box end (range 399.6..469.6, stock = max)');
  assert.deepEqual(Array.from(s.bytes), top);
  s.reset();
  assert.deepEqual(Array.from(s.bytes), new Array(9).fill(100));
});
