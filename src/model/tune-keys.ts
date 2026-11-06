/**
 * The ECU and Turbo graph screens of the game, key by key (port of SPEED2.EXE, float32 like the game).
 *
 * Screen handler FUN_005654d0 -> graph key FUN_00522f10: LEFT/RIGHT pick a column, UP/DOWN call FUN_005101e0 /
 * FUN_00510240 on that column's slider (value +- step, clamped to the slider box), then FUN_00522500 -> FUN_005b4670
 * writes it: the byte of the column (FUN_005b3ee0 -> FUN_0059af80), then the other columns follow
 * (FUN_005b3fa0 -> FUN_005b2c00, weights at 0x7FC674) and all nine bytes are written again from the new torque.
 * Key C (PAD_BUTTON1, FUN_0059afe0) sets the nine bytes to 100 and rebuilds the car.
 * Facts from the game code, checked against the emulator (tools/emu/press_cases.py) in tune-keys.test.ts:
 *  - the value a press starts from is read back from the column's BYTE (FUN_005b3e40), but the redistribution works
 *    on the stored torque, which keeps what the bytes lost (so "UP then DOWN" does not return to the start);
 *  - step = one tenth of the column's box, taken when the screen opens (FUN_00550580), display units (N·m);
 *  - nothing is written when a press changes nothing (box end).
 */
import { CURVE_POINTS, ECU_OFF, TURBO_OFF, encodeGearByte, type CurveKind, type DynoModel } from './dyno.js';

/** Setup byte of the final drive. */
const FD_BYTE = 9;

const f = Math.fround;
/** 0x7A0354, 1e-7 as float32: redistribution stops below it. */
const EPS = f(1e-7);
/** 0x7FC674: neighbour weights (the ninth float is the integer 3, a denormal); later neighbours take what is left. */
const WEIGHTS = [0.25, 0.25, -0.25, -0.25, -0.25, -0.25, -0.25, -0.25, 4.203895392974451e-45].map(f);
/** The loop stops after this many neighbours (0x7FC6C3). */
const MAX_NEIGHBOURS = 20;
const clamp32 = (v: number, lo: number, hi: number): number => (v <= lo ? lo : hi < v ? hi : v);

interface Column { min: number; max: number; def: number; absMin: number; absMax: number }
/** FUN_00401790: value clamped to its scale, then mapped linearly to another scale (float32 steps). */
const lerp = (v: number, a1: number, b1: number, a2: number, b2: number): number =>
  f(f(f(b2 - a2) * f(f(clamp32(v, a1, b1) - a1) / f(b1 - a1))) + a2);
/** FUN_005b2800: kN·m on the column's absolute scale <-> N·m on the screen (metric: x1000, FUN_005b09a0). */
const toScreen = (c: Column, v: number): number => lerp(v, c.absMin, c.absMax, f(c.absMin * 1000), f(c.absMax * 1000));
const fromScreen = (c: Column, v: number): number => lerp(v, f(c.absMin * 1000), f(c.absMax * 1000), c.absMin, c.absMax);

/**
 * Range of every column of a curve in float32, in the order of FUN_005aca50 (absolute scale), the caps of FUN_005b2980
 * and the record type (min/max box). DynoModel.range is the same in float64; this one is for exact key steps.
 * @param defs Installed default of each column (kN·m).
 */
function columns32(model: DynoModel, kind: CurveKind, idle: number, red: number, defs: number[]): Column[] {
  const R = (o: number): number => model.car.view.getFloat32(o, true);
  const rec = model.tuningRecords.get(kind === 'ecu' ? 23 : 24);
  if (!rec) throw new RangeError('This curve is locked.');
  const vals: number[] = [];
  for (let j = 0; j < CURVE_POINTS; j++) {
    if (kind === 'ecu') { const a = R(0x200 + 4 * j); vals.push(a, f(f(a + R(0x420 + 4 * j)) + R(0x4e0 + 4 * j))); }
    else vals.push(R(0x224 + 4 * j), R(0x510 + 4 * j));
  }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const f8 = f(rec.f8), fC = f(rec.fC);
  if (rec.type === 2 || rec.type === 3) [lo, hi] = [f(f(f(hi - lo) * f8) + lo), f(f(f(hi - lo) * fC) + hi)];
  else if (rec.type === 0 || rec.type === 1) [lo, hi] = [f(lo + f8), f(hi + fC)];
  else if (rec.type === 4) [lo, hi] = [Math.min(lo, f8), Math.max(hi, fC)];
  const absMin = Math.max(lo, 0), absMax = Math.max(hi, 0);
  // power cap of FUN_005b2980: the default curve's peak power is the most a column may add up to
  const inv = f(8 / f(red - idle));
  const interp = (x: number): number => {
    const t = f(f(x - idle) * inv);
    if (t < 0) return defs[0];
    const k = Math.floor(t);
    if (k >= 8) return defs[8];
    const fr = f(t - k);
    return f(f(fr * defs[k + 1]) + f(f(1 - fr) * defs[k]));
  };
  let peak = 0;
  for (let rpm = idle; rpm < red; rpm = f(rpm + 50)) {
    const pw = f(f(f(interp(rpm) * 1000) * rpm) * f(1.0471204e-4));
    if (peak < pw) peak = pw;
  }
  return defs.map((d, i) => {
    let l = absMin, h = Math.min(absMax, Math.max(0, ...defs));
    const rpmI = f(f(f(f(red - idle) * i) * f(0.125)) + idle);
    const pw = f(f(f(h * 1000) * rpmI) * f(1.0471204e-4));
    if (peak < pw) h = Math.max(f(f(f(peak - pw) / f(rpmI * f(0.10471204))) + h), 0);
    l = Math.max(l, 0); h = Math.max(h, 0);
    let mn: number, mx: number;
    if (rec.type === 0) { mn = l; mx = Math.min(h, f(d + fC)); }
    else if (rec.type === 1) { mn = Math.max(l, f(d + f8)); mx = Math.min(h, f(d + fC)); }
    else if (rec.type === 2) { mn = l; mx = Math.min(h, f(d + f(f(h - l) * fC))); }
    else if (rec.type === 3) { mn = Math.max(l, f(d + f(f(h - l) * f8))); mx = Math.min(h, f(d + f(f(h - l) * fC))); }
    else { mn = f8; mx = fC; }
    if (mn === mx) mx = f(mx + 0.01);
    return { min: mn, max: mx, def: d, absMin, absMax };
  });
}

/** One visit to the ECU or Turbo graph screen. Mutable: every key changes the state. */
export class CurveScreen {
  /** The nine bytes of the curve now (setup bytes 0x17.. for ECU, 0x20.. for Turbo). */
  readonly bytes = new Uint8Array(CURVE_POINTS);
  private total = new Float32Array(CURVE_POINTS);
  private turbo = new Float32Array(CURVE_POINTS);
  private cols: Column[] = [];
  /** Per-column key step in N·m, fixed when the screen opened. */
  readonly steps: number[] = [];
  private setup: Uint8Array;
  private readonly off: number;

  /** @throws RangeError when the installed parts do not unlock this curve. */
  constructor(private readonly model: DynoModel, setup: ArrayLike<number>, readonly kind: CurveKind) {
    this.off = kind === 'ecu' ? ECU_OFF : TURBO_OFF;
    this.setup = Uint8Array.from(setup);
    this.bytes.set(this.setup.subarray(this.off, this.off + CURVE_POINTS));
    this.load();
    for (let i = 0; i < CURVE_POINTS; i++) {
      const [lo, hi] = this.box(i);
      this.steps.push(f(f(hi - lo) * f(0.1)));
    }
  }

  /** Full 41 setup bytes with this screen's curve. */
  setupBytes(): Uint8Array {
    const out = this.setup.slice();
    out.set(this.bytes, this.off);
    return out;
  }

  /** Sum of the package fractions of one category (FUN_005b06a0 sums them in float32), clamped to 0..1. */
  private fraction(cat: number): number {
    let sum = 0;
    for (const pkg of this.model.game.packages) {
      if (pkg.category !== cat || pkg.level < 1 || pkg.level > 3) continue;
      for (const sub of pkg.subs) {
        if (this.model.installed[sub.item] && sub.fractions[0] !== -1) sum = f(sum + f(sub.fractions[0]));
      }
    }
    return Math.min(Math.max(sum, 0), 1);
  }

  /**
   * Builds the car from the bytes (what the game does on entering the screen and after key C): the ECU and turbo tables
   * in float32, in the order of FUN_005b06a0 / FUN_005b4780. The model's own build (DynoModel.tuned) computes in float64,
   * which can land one byte away from the game on a byte boundary; ranges and defaults still come from it.
   */
  private load(): void {
    this.setup.set(this.bytes, this.off);
    const model = this.model, car = model.car.view, R = (o: number): number => car.getFloat32(o, true);
    const p = model.tuned(this.setup);
    const active = { ecu: !!model.curveColumn(p, 'ecu', 0), turbo: !!model.curveColumn(p, 'turbo', 0) };
    if (!active[this.kind]) throw new RangeError('This curve is locked.');
    const { total: tot, turbo: tur } = this;
    const f3 = this.fraction(3), f4 = this.fraction(4), f7 = this.fraction(7);
    for (let i = 0; i < CURVE_POINTS; i++) {
      tot[i] = R(0x200 + 4 * i);
      tur[i] = R(0x224 + 4 * i);
      if (f3) tot[i] = f(tot[i] + f(R(0x420 + 4 * i) * f3));
      const t = f(f(f(R(0x510 + 4 * i) - tur[i]) * f4) + tur[i]);
      tur[i] = t;
      tot[i] = f(tot[i] + t);
      if (f7) tot[i] = f(tot[i] + f(R(0x4e0 + 4 * i) * f7));
    }
    const sum = (): number => tot.reduce((a, b) => f(a + b), 0);
    const s0 = sum();
    const defs = { ecu: Array.from(tot, (v, i) => f(v - tur[i])), turbo: Array.from(tur) };
    const idle = f(p.f[0x1f0 >> 2]), red = f(p.f[0x1f8 >> 2]);
    const cols = {
      ecu: active.ecu ? columns32(model, 'ecu', idle, red, defs.ecu) : [],
      turbo: active.turbo ? columns32(model, 'turbo', idle, red, defs.turbo) : [],
    };
    this.cols = cols[this.kind];
    for (const kind of ['ecu', 'turbo'] as const) {
      const cs = cols[kind];
      if (!active[kind]) continue;
      const off = kind === 'ecu' ? ECU_OFF : TURBO_OFF;
      for (let i = 0; i < CURVE_POINTS; i++) {
        const c = cs[i], lo = c.min, hi = c.max, def = defs[kind][i];
        const b = kind === this.kind ? this.bytes[i] : this.setup[off + i];
        const t = Math.max(-1, Math.min(1, f(f(b - 100) * f(0.01))));
        const req = f(f(f(hi - lo) * f(t)) + def);
        const cur = kind === 'ecu' ? f(tot[i] - tur[i]) : tur[i];
        if (req === cur) continue;
        const v = clamp32(req, lo, hi);
        if (kind === 'ecu') tot[i] = f(v + tur[i]);
        else { tot[i] = f(tot[i] + f(v - tur[i])); tur[i] = v; }
      }
    }
    const s1 = sum();
    if (!(Math.abs(s0 - s1) < 0.001)) {
      const d = f(f(s0 - s1) / 9);
      for (let i = 0; i < CURVE_POINTS; i++) tot[i] = f(tot[i] + d);
    }
    for (let i = 0; i < CURVE_POINTS; i++) {
      const [a3, a7, a4] = model.uniqueTorque(i).map(f);
      tot[i] = f(f(f(a3 + tot[i]) + a7) + a4);
      tur[i] = f(a4 + tur[i]);
    }
  }

  /** Torque of a column as the screen's slider shows it, N·m, read from the byte (FUN_005b3e40). */
  value(i: number): number {
    const c = this.cols[i];
    const t = Math.max(-1, Math.min(1, f(f(this.bytes[i]) - 100) * f(0.01)));
    return toScreen(c, f(f(f(f(c.max) - f(c.min)) * f(t)) + f(c.def)));
  }

  /** Box of a column in N·m. */
  box(i: number): [number, number] {
    return [toScreen(this.cols[i], f(this.cols[i].min)), toScreen(this.cols[i], f(this.cols[i].max))];
  }

  /**
   * FUN_00599d90 .. FUN_005997e0 around a read or write of the curve (FUN_005a7da0, FUN_005b3fa0): the unique parts'
   * torque is taken out of all nine columns, `fn` works on the clean tables, then it is added back (float32 order of
   * the game, so every call leaves the same rounding the game leaves).
   */
  private clean<T>(fn: () => T): T {
    const add = Array.from({ length: CURVE_POINTS }, (_, i) => this.model.uniqueTorque(i).map(f));
    for (let i = 0; i < CURVE_POINTS; i++) {
      const [a3, a7, a4] = add[i];
      this.total[i] = f(f(f(this.total[i] - a3) - a7) - a4);
      this.turbo[i] = f(this.turbo[i] - a4);
    }
    const out = fn();
    for (let i = 0; i < CURVE_POINTS; i++) {
      const [a3, a7, a4] = add[i];
      this.total[i] = f(f(f(a3 + this.total[i]) + a7) + a4);
      this.turbo[i] = f(a4 + this.turbo[i]);
    }
    return out;
  }

  /** Torque of a column in the game's memory without uniques (kN·m); call inside {@link clean}. */
  private current(i: number): number {
    return this.kind === 'ecu' ? f(this.total[i] - this.turbo[i]) : this.turbo[i];
  }

  private write(i: number, v: number): void {
    const c = this.cols[i];
    this.bytes[i] = encodeGearByte(v, c.def, c.min, c.max);
  }

  /**
   * UP (+1) or DOWN (-1) on a column.
   * @returns false when the key changes nothing (the slider is at the end of its box).
   */
  press(col: number, dir: 1 | -1): boolean {
    if (!Number.isInteger(col) || col < 0 || col >= CURVE_POINTS) throw new RangeError('Column must be 0 to 8.');
    const [lo, hi] = this.box(col), v = this.value(col);
    const moved = dir > 0 ? f(v + this.steps[col]) : f(v - this.steps[col]);
    const nv = dir > 0 ? Math.min(moved, hi) : Math.max(moved, lo);
    if (f(nv) === f(v)) return false;
    // FUN_005b4670: display -> physical, clamp, write the column's byte, then move the neighbours.
    const phys = clamp32(fromScreen(this.cols[col], nv), this.cols[col].min, this.cols[col].max);
    this.write(col, phys);
    this.clean(() => this.redistribute(col, phys));
    for (let i = 0; i < CURVE_POINTS; i++) {
      const c = this.cols[i];
      this.write(i, clamp32(this.clean(() => this.current(i)), c.min, c.max));
    }
    return true;
  }

  /** FUN_005b2c00. */
  private redistribute(col: number, target: number): void {
    const cur = Float32Array.from({ length: CURVE_POINTS }, (_, i) => this.current(i));
    const delta = f(target - cur[col]);
    cur[col] = clamp32(target, this.cols[col].min, this.cols[col].max);
    if (delta === 0) return;
    if (EPS < Math.abs(delta)) {
      let remaining = delta, k = 0, w = 0;
      do {
        if (w >= MAX_NEIGHBOURS) break;
        let amt = f(-remaining);
        if (w < WEIGHTS.length) {
          amt = f(delta * WEIGHTS[w]);
          if (remaining <= 0) { if (remaining > amt || amt === remaining) amt = remaining; } else if (remaining <= amt) amt = remaining;
        }
        k = -k;
        if (k >= 0 && ++k > 8) k = 1;
        const n = col + k;
        if (n >= 0 && n < CURVE_POINTS) {
          const nv = clamp32(f(amt + cur[n]), this.cols[n].min, this.cols[n].max);
          w++;
          remaining = f(f(nv - cur[n]) + remaining);
          cur[n] = nv;
        }
      } while (EPS < Math.abs(remaining));
    }
    for (let i = 0; i < CURVE_POINTS; i++) {
      if (this.kind === 'ecu') this.total[i] = f(cur[i] + this.turbo[i]);
      else { this.total[i] = f(f(this.total[i] - this.turbo[i]) + cur[i]); this.turbo[i] = cur[i]; }
    }
  }

  /** Key C: the nine bytes go to 100 and the car is rebuilt. */
  reset(): void {
    this.bytes.fill(100);
    this.load();
  }

  /** Runs a list of keys: `[column, +1|-1]` or `'C'`. */
  run(keys: ReadonlyArray<readonly [number, 1 | -1] | 'C'>): void {
    for (const k of keys) {
      if (k === 'C') this.reset(); else this.press(k[0], k[1]);
    }
  }
}

/**
 * RIGHT (+1, bigger ratio) or LEFT (-1) on the final drive row of the Drivetrain screen (handler 0x4FF590, then
 * FUN_00564f10): the value is read back from the byte, moved by range/30 (FUN_00522560, factor 0x786460 = 1/30 as
 * float32), clamped to the range ends and written as trunc(frac*100 + 100.5) (FUN_0059af80). At an end the step is cut
 * short, so the grid of reachable bytes shifts there (bytes 67 and 167 are the ends on the 3000GT).
 * shortcut: a start byte far outside the box (hand-edited save) is not checked against the game.
 * @returns the setup after the key, or null when the key changes nothing or the final drive is locked.
 */
export function pressFinalDrive(model: DynoModel, setup: ArrayLike<number>, dir: 1 | -1): Uint8Array | null {
  const row = model.gearing(setup)?.rows.find((r) => r.param === FD_BYTE);
  if (!row) return null;
  const min = f(row.min), max = f(row.max), def = f(row.stock);
  const t = Math.max(-1, Math.min(1, f(f(setup[FD_BYTE] - 100) * f(0.01))));
  // the screen shows the value on the absolute scale (FUN_00401790 clamps to it), a hair wider than the box
  const [absMin, absMax] = model.absoluteRange(setup, FD_BYTE).map(f);
  const v = clamp32(f(f(f(max - min) * f(t)) + def), absMin, absMax);
  const step = f(f(max - min) * f(1 / 30));
  const nv = dir > 0 ? Math.min(f(v + step), max) : Math.max(f(v - step), min);
  if (f(nv) === f(v)) return null;
  const out = Uint8Array.from(setup);
  out[FD_BYTE] = encodeGearByte(nv, def, min, max);
  return out;
}
