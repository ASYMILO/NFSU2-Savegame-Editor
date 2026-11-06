/**
 * "Without a save": a career save with one car and the chosen part levels, built in memory so the editor's normal path
 * (loaded save -> car slot -> Tuning -> DYNO) works unchanged. It is never offered for download.
 */
import { PERF_PARTS, TUNING_PERF_CATEGORIES } from '../data/perf-parts.js';
import { recalculateChecksums } from './save-file.js';
import { CAR_TYPE_HASH_REL, HEADER_SIZE, MAGIC, PERF_OFF, PROFILE_SIZE, SLOT_BOUGHT_REL, dataView, slotBase } from './layout.js';
import { SETUP_COUNT, SETUP_SIZE, TUNING_OFF } from './dyno.js';

/** Performance categories the user picks a level for (0 = none installed, 1..3 = Street, Pro, Extreme). */
const LIST_ORDER = ['EC', 'TU', 'TR', 'EN', 'NO', 'SU', 'BR', 'TI', 'WT'];
export const PART_LEVEL_CATEGORIES = [...TUNING_PERF_CATEGORIES]
  .sort((a, b) => LIST_ORDER.indexOf(a.code) - LIST_ORDER.indexOf(b.code)).map((c) => ({
  code: c.code,
  label: ({ EC: 'ECU (engine control & fuel)', TR: 'Transmission (final drive, gears)', TU: 'Turbo', EN: 'Engine', NO: 'Nitrous',
    SU: 'Suspension', BR: 'Brakes', TI: 'Tires', WT: 'Weight reduction' } as Record<string, string>)[c.code] ?? c.label,
  maxLevel: Math.max(0, ...c.indices.map((i) => PERF_PARTS[i].level ?? 0)),
}));

/**
 * The 68 installed flags for a level per category: every active part of the category up to that level, where of two parts
 * that exclude each other the higher level wins.
 */
export function installedForLevels(levels: Record<string, number>): boolean[] {
  const on = new Array<boolean>(PERF_PARTS.length).fill(false);
  for (const cat of TUNING_PERF_CATEGORIES) {
    const level = levels[cat.code] ?? 0;
    const parts = cat.indices.map((i) => PERF_PARTS[i]).filter((p) => p.active && p.level !== null && p.level <= level)
      .sort((a, b) => (a.level as number) - (b.level as number));
    for (const p of parts) {
      for (const other of p.conflicts) if ((PERF_PARTS[other].level ?? 0) < (p.level as number)) on[other] = false;
      on[p.index] = true;
    }
  }
  return on.slice(0, 68);
}

/**
 * Aero parts (not in the shop categories above): the game opens Aerodynamics with a front bumper (front downforce) or a
 * spoiler (rear downforce), levels 1..3 (docs/setup-bytes.md l.38-39 of the tuner repo). Their flags exclude each other.
 */
export const AERO_PARTS = [
  { code: 'AEF', label: 'Front bumper (aero)', key: 'AE_FRONT_BUMPER_L' },
  { code: 'AES', label: 'Spoiler (aero)', key: 'AE_SPOILER_L' },
];

/** `installed` with the aero flag of each chosen level (0 = none) set. */
export function withAero(installed: boolean[], levels: Record<string, number>): boolean[] {
  const on = installed.slice();
  for (const a of AERO_PARTS) {
    for (let l = 1; l <= 3; l++) {
      const i = PERF_PARTS.findIndex((p) => p.key === `${a.key}${l}`);
      if (i >= 0 && i < on.length) on[i] = (levels[a.code] ?? 0) === l;
    }
  }
  return on;
}

/** A 54,966-byte career save, valid for the editor's checks, with one bought car in slot 1 and neutral dyno setups. */
export function buildVirtualSave(carHash: number, installed: boolean[]): Uint8Array {
  const data = new Uint8Array(PROFILE_SIZE);
  data.set(MAGIC);
  const view = dataView(data), lenA = 0x4000;
  view.setUint16(4, PROFILE_SIZE & 0xffff, true);
  view.setUint32(8, lenA, true);
  view.setUint32(0xc, PROFILE_SIZE - HEADER_SIZE - lenA, true);
  const base = slotBase(0);
  data[base + SLOT_BOUGHT_REL] = 1;
  view.setUint32(base + CAR_TYPE_HASH_REL, carHash >>> 0, true);
  installed.forEach((on, i) => { data[base + PERF_OFF + i] = on ? 1 : 0; });
  data.fill(100, base + TUNING_OFF, base + TUNING_OFF + SETUP_COUNT * SETUP_SIZE);
  return recalculateChecksums(data);
}
