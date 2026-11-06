// Prints src/data/car-names.ts: the car names the game shows, by car record name.
// Name = maker (string in the car's GLOBALB.BUN record, 0x80 bytes after "CARS\<name>\GEOMETRY.BIN") + model
// (string CAR_NAME_<record name> of LANGUAGES\English.bin; key hash = bStringHash, h = h*33 + c from 0xFFFFFFFF).
// Usage: npm run build && node scripts/car-names.mjs <GLOBALB.BUN> <English.bin> > src/data/car-names.ts
import { readFileSync } from 'node:fs';
import { parseGameData } from '../dist/model/dyno.js';
import { TRAFFIC_CARS } from '../dist/data/traffic-cars.js';

const [bunPath, langPath] = process.argv.slice(2);
if (!bunPath || !langPath) throw new Error('Usage: node scripts/car-names.mjs <GLOBALB.BUN> <English.bin>');
const bun = readFileSync(bunPath);
const lang = readFileSync(langPath);
const hash = (s) => { let h = 0xffffffff; for (const c of Buffer.from(s)) h = (Math.imul(h, 33) + c) >>> 0; return h; };
const cstr = (buf, at) => buf.subarray(at, buf.indexOf(0, at)).toString('latin1');

// English.bin: chunk header (8), then count, table offset, string offset at +12; table = (hash, offset) pairs
const count = lang.readUInt32LE(12), table = lang.readUInt32LE(16), strings = lang.readUInt32LE(20);
const text = new Map();
for (let k = 0; k < count; k++) text.set(lang.readUInt32LE(8 + table + 8 * k), cstr(lang, 8 + strings + lang.readUInt32LE(8 + table + 8 * k + 4)));

const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const rows = [];
for (const car of parseGameData(new Uint8Array(bun)).cars) {
  if (TRAFFIC_CARS.some((t) => t.hash === car.hash)) continue;
  const at = bun.indexOf(Buffer.from(`CARS\\${car.name}\\GEOMETRY.BIN\0`, 'latin1'));
  const model = text.get(hash(`CAR_NAME_${car.name}`));
  if (at < 0 || !model) continue;
  const maker = title(cstr(bun, at + 0x80));
  // TIBURON: the game's model string is the maker ("Hyundai"), so the record name stands in for the model;
  // HUMMER: the model string already starts with the maker ("Hummer H2")
  const same = model.toLowerCase() === maker.toLowerCase();
  rows.push([car.name, same ? `${maker} ${title(car.name)}` : model.toLowerCase().startsWith(maker.toLowerCase()) ? model : `${maker} ${model}`]);
}
console.log(`/** Car names as the game shows them, by car record name. Made by scripts/car-names.mjs (GLOBALB.BUN + English.bin). */
export const CAR_NAMES: Record<string, string> = {
${rows.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
};

/** The game's name of a car record, or the record name when it has none. */
export const carName = (record: string): string => CAR_NAMES[record] ?? record;`);
