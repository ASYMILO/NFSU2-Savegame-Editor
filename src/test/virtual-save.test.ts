import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DynoModel, findCar, parseGameData, readSlotDyno } from '../model/dyno.js';
import { checkSave, verifyChecksums } from '../model/save-file.js';
import { isSlotUsed } from '../model/slots.js';
import { buildVirtualSave, installedForLevels, PART_LEVEL_CATEGORIES } from '../model/virtual-save.js';

const GAME_BUN = process.env.NFSU2_GLOBALB ?? 'C:/Program Files (x86)/EA GAMES/Need for Speed Underground 2/GLOBAL/GLOBALB.BUN';
const SKIP = !existsSync(GAME_BUN) && 'GLOBALB.BUN (set NFSU2_GLOBALB) missing';

test('a virtual save passes the editor checks and holds the car, parts and neutral setups', () => {
  const installed = installedForLevels({ EC: 3, TU: 2 });
  const save = buildVirtualSave(0x2d7c9b5d, installed);
  assert.deepEqual(checkSave(save), { ok: true });
  assert.ok(Object.values(verifyChecksums(save)).every(Boolean));
  assert.equal(isSlotUsed(save, 0), true);
  const sd = readSlotDyno(save, 0);
  assert.equal(sd.hash, 0x2d7c9b5d);
  assert.deepEqual(sd.installed, installed);
  assert.ok(sd.setups.every((s) => s.every((b) => b === 100)));
});

test('part levels: a higher level keeps the lower parts except those it replaces', () => {
  const none = installedForLevels({});
  assert.ok(none.every((on) => !on));
  const l1 = installedForLevels({ EN: 1 }), l3 = installedForLevels({ EN: 3 });
  assert.ok(l1.filter(Boolean).length > 0 && l3.filter(Boolean).length > l1.filter(Boolean).length);
  // headers: part 17 (level 1) is replaced by part 25 (level 3)
  assert.equal(l1[17], true);
  assert.equal(l3[17], false);
  assert.equal(l3[25], true);
  assert.deepEqual(PART_LEVEL_CATEGORIES.slice(0, 3).map((c) => c.code), ['EC', 'TU', 'TR']);
});

test('with the ECU, turbo and transmission levels of the lists the dyno has curves and a final drive', { skip: SKIP }, () => {
  const game = parseGameData(new Uint8Array(readFileSync(GAME_BUN)));
  const car = game.cars.find((c) => c.name === '3000GT')!;
  const save = buildVirtualSave(car.hash, installedForLevels({ EC: 3, TU: 2, TR: 2 }));
  const sd = readSlotDyno(save, 0);
  const model = new DynoModel(game, findCar(game, sd.hash)!, sd.installed, sd.uniques);
  assert.ok(model.ecuTunable && model.turboTunable);
  assert.ok(model.gearingParameters.includes(9));
  assert.ok(Number.isFinite(model.evaluate(sd.setups[0]).t60));
});
