// Prints case inputs (car type hash, installed bytes, uniques, setup bytes: numbers only, no game data) for cars with the
// chosen part levels, in the format of src/test/fixtures/dyno-exactness.json. tools/emu/make_slider_fixture.py runs them through
// the game's own slider code. A level set is one level per category: ECU, Turbo, Transmission, Engine, Nitrous, Suspension, Brakes, Tires, Weight.
// Usage: npm run build && NFSU2_GLOBALB=<path> node scripts/fixture-levels.mjs [cars=24]
import { readFileSync } from 'node:fs';
import { parseGameData } from '../dist/model/dyno.js';
import { installedForLevels, PART_LEVEL_CATEGORIES } from '../dist/model/virtual-save.js';
import { TRAFFIC_CARS } from '../dist/data/traffic-cars.js';

const bunPath = process.env.NFSU2_GLOBALB;
if (!bunPath) throw new Error('Set NFSU2_GLOBALB to your GLOBALB.BUN.');
const game = parseGameData(new Uint8Array(readFileSync(bunPath)));
const count = Number(process.argv[2] ?? 24);
const cars = game.cars.filter((c) => !TRAFFIC_CARS.some((t) => t.hash === c.hash));
const pick = Array.from({ length: Math.min(count, cars.length) }, (_, i) => cars[Math.floor((i * cars.length) / count)]);
const sets = [{ name: 'level 3', level: 3 }, { name: 'level 2', level: 2 }, { name: 'level 1', level: 1 }];
const cases = [];
for (const car of pick) {
  for (const set of sets) {
    const levels = Object.fromEntries(PART_LEVEL_CATEGORIES.map((c) => [c.code, Math.min(set.level, c.maxLevel)]));
    cases.push({
      hash: car.hash >>> 0, installed: installedForLevels(levels).map((b) => (b ? 1 : 0)), uniques: new Array(9).fill(0),
      setup: new Array(41).fill(100), note: `${car.name} ${set.name}`,
    });
  }
}
console.log(JSON.stringify({ cases }));
