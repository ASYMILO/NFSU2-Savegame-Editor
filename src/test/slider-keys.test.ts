import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, findCar, parseGameData } from '../model/dyno.js';
import { NitroScreen, openRow, pressRowState, resetRow, rowInfo, type RowState } from '../model/tune-keys.js';

// Reference bytes come from SPEED2.EXE's own slider code in the emulator (tools/emu/slider_cases.py, make_slider_fixture.py):
// numbers only. Needs GLOBALB.BUN like the other game-data tests.
const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';

interface Case {
  hash: number; installed: number[]; uniques: number[]; setup: number[]; param: number; ops: (1 | -1 | 'C')[];
  watch: number[]; start: number[]; bytes: number[][]; note: string;
}
interface Raw { in: number; param: number; ops: string; watch: number[]; start: number[]; bytes: string; note: string }
const raw = JSON.parse(readFileSync(new URL('../../src/test/fixtures/slider-reference.json', import.meta.url), 'utf8')) as
  { inputs: Pick<Case, 'hash' | 'installed' | 'uniques' | 'setup'>[]; cases: Raw[] };
const fixture = {
  cases: raw.cases.map((r): Case => ({
    ...raw.inputs[r.in], param: r.param, watch: r.watch, start: r.start, note: r.note,
    ops: Array.from(r.ops, (o) => (o === 'C' ? 'C' : o === '+' ? 1 : -1)),
    // two hex digits per byte, len(watch) bytes per key
    bytes: Array.from({ length: r.ops.length }, (_, k) => r.watch.map((_w, i) => parseInt(r.bytes.substr((k * r.watch.length + i) * 2, 2), 16))),
  })),
};

/** Replays one case with the editor's key code; returns the watched bytes after every key. */
export function replay(game: ReturnType<typeof parseGameData>, c: Case): number[][] {
  const car = findCar(game, c.hash >>> 0);
  assert.ok(car, `unknown car ${c.hash}`);
  const model = new DynoModel(game, car, c.installed.map((b) => b !== 0), c.uniques);
  // the game normalises the bytes when it builds the car (a byte outside its box is pulled in): start from what it holds
  let setup: Uint8Array = Uint8Array.from(c.setup);
  c.watch.forEach((i, k) => { setup[i] = c.start[k]; });
  const watch = (): number[] => c.watch.map((i) => setup[i]);
  const out: number[][] = [];
  if (c.param === 16) {
    let screen = NitroScreen.open(model, setup);
    assert.ok(screen, 'nitrous slider');
    for (const op of c.ops) {
      assert.notEqual(op, 'C', 'nitrous reset is not modelled');
      screen = screen.press(op as 1 | -1) ?? screen;
      setup = screen.setupBytes();
      out.push(watch());
    }
    return out;
  }
  let st: RowState = { setup, ratios: null };
  for (const op of c.ops) {
    if (op === 'C') st = resetRow(model, st.setup, c.param);
    else {
      const info = rowInfo(model, st.setup, c.param);
      assert.ok(info, `row ${c.param}`);
      st = pressRowState(model, info, st, op) ?? st;
    }
    setup = st.setup;
    out.push(watch());
  }
  return out;
}

test('number sliders: every key of the emulator sequences writes the bytes the game writes', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const bad: string[] = [], gearOff: string[] = [];
  const perParam = new Map<number, number>();
  let steps = 0, sequences = 0;
  for (const c of fixture.cases) {
    const got = replay(game, c);
    perParam.set(c.param, (perParam.get(c.param) ?? 0) + 1);
    sequences++;
    for (let k = 0; k < got.length; k++) {
      steps++;
      if (got[k].join() === c.bytes[k].join()) continue;
      const msg = `param ${c.param} ${c.note} key ${k} (${String(c.ops[k])}): got ${got[k]} want ${c.bytes[k]}`;
      // known limit: a gear key into the end of its box can leave one untouched gear one byte away (shown value and box end
      // are floats of the game's own speed formula; ours differs in the last bit). Everything else must be exact.
      const near = c.param >= 10 && c.param <= 15 && c.ops[k] !== 'C' && got[k].every((b, i) => Math.abs(b - c.bytes[k][i]) <= 1);
      (near ? gearOff : bad).push(msg);
      break;
    }
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} sequences differ of ${sequences}`);
  assert.ok(gearOff.length <= 8, `${gearOff.length} gear sequences one byte off:\n${gearOff.join('\n')}`);
  assert.ok(steps > 20000, `only ${steps} keys`);
  for (const p of [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 15, 16, 18, 19, 20, 21, 22]) assert.ok((perParam.get(p) ?? 0) > 5, `param ${p} has few sequences`);
});
