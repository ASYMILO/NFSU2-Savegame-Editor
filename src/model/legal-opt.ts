// Game-legal dyno optimizer — pure-TS core (no Node.js APIs).
// Ported from tools/opt/legal_opt.mjs.  All game-rule edits are made via
// DynoModel.withCurvePoint / withGearRatio so every result can be entered with
// the in-game ECU / turbo / gear sliders.

import { DynoModel, ECU_OFF, SETUP_NAMES, TURBO_OFF, type CurveKind, type Phys, type TuningRecord } from './dyno.js';

// ---- constants ---------------------------------------------------------------------------------

/** Heuristic objective definitions (weights on dyno metrics). */
export const OBJECTIVES: Record<string, { setup: number; name: string; w: Record<string, number> }> = {
  drag:    { setup: 1, name: 'Drag',    w: { quarter: 1.0, t100: 0.05,  t60: 0.05,  power: -0.0005 } },
  circuit: { setup: 0, name: 'Circuit', w: { t60: 0.5,    t100: 0.5,   top: -0.15, power: -0.0005 } },
  streetx: { setup: 3, name: 'Street X',w: { t60: 1.0,    t100: 1.0,   quarter: 0.3, power: -0.0005 } },
  drift:   { setup: 2, name: 'Drift',   w: { t60: 0.5,    band: -0.01, power: -0.0002 } },
  url:     { setup: 4, name: 'URL',     w: { t60: 0.3,    t100: 0.3,   top: -0.4,  power: -0.0005 } },
};

/** Default objective name for each setup index (0=circuit,1=drag,2=drift,3=streetx,4=url). */
export const OBJ_BY_SETUP = ['circuit', 'drag', 'drift', 'streetx', 'url'];

const MPH_PER_MS = 2.237;
const BIG = 99;
const CURVE_PCTS = [1, 2, 3, 5, 8, 12, 20, 35];
const GEAR_PCTS  = [1, 2, 3, 5, 10, 25];
const LAUNCH_POINTS = 3;
const LAUNCH_PENALTY = 1000;
const LAUNCH_T60_EXTRA = 0.3;
const REALISE_TOL = 2;
const REALISE_MAX_EDITS = 40;

// ---- tiny helpers ------------------------------------------------------------------------------

const keyOf  = (b: Uint8Array): string => String.fromCharCode(...b);
const fin    = (x: number, d = BIG): number => (Number.isFinite(x) ? x : d);
const r1     = (x: number): number => Math.round(x * 10) / 10;
const clampv = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Returns a fresh Uint8Array<ArrayBuffer> copy. */
const u8 = (src: ArrayLike<number>): Uint8Array => new Uint8Array(Array.from(src));

export function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- partsInfo ---------------------------------------------------------------------------------

export interface PartLevelInfo { level: number; part: number }
export interface PartsInfo {
  ecu: PartLevelInfo | null;
  turbo: PartLevelInfo | null;
  transmission: PartLevelInfo | null;
  gearsUnlocked: string[];
}

/** Installed tuning-relevant parts: level and part index of the records that unlock ECU, turbo and gearing. */
export function partsInfo(model: DynoModel): PartsInfo {
  const rec = (p: number): TuningRecord | undefined => model.tuningRecords.get(p);
  const lv  = (r: TuningRecord | undefined): PartLevelInfo | null => (r ? { level: r.level, part: r.item } : null);
  const gears = ([9, 10, 11, 12, 13, 14, 15] as number[]).map(rec).filter((r): r is TuningRecord => r !== undefined);
  const tr = gears.length ? gears.reduce((a, b) => (b.level > a.level ? b : a)) : undefined;
  return {
    ecu: lv(rec(23)),
    turbo: lv(rec(24)),
    transmission: lv(tr),
    gearsUnlocked: model.gearingParameters.map((p) => (p === 9 ? 'final drive' : `gear ${p - 9}`)),
  };
}

// ---- Evaluator ---------------------------------------------------------------------------------

interface EvalCache {
  r: ReturnType<DynoModel['evaluate']>;
  met: Record<string, number>;
  cost: number;
  launchDeficit: number;
}

export class Evaluator {
  readonly model: DynoModel;
  readonly w: Record<string, number>;
  readonly launch: { min: number } | null;
  private readonly cache = new Map<string, EvalCache>();
  evals = 0;

  constructor(model: DynoModel, objective: string, launch: { min: number } | null = null) {
    this.model  = model;
    this.w      = { ...OBJECTIVES[objective].w };
    this.launch = launch;
    if (launch) this.w['t60'] = (this.w['t60'] ?? 0) + LAUNCH_T60_EXTRA;
  }

  /** Dyno result plus objective metrics for a setup (cached). */
  full(setup: Uint8Array): EvalCache {
    const k = keyOf(setup);
    let e = this.cache.get(k);
    if (e) return e;
    const m = this.model;
    const r = m.evaluate(setup);
    const p: Phys = m.tuned(setup);
    const idle = p.f[0x1f0 >> 2], red = p.f[0x1f8 >> 2];
    const tq = Array.from({ length: 9 }, (_v, i) => p.f[(0x200 + 4 * i) >> 2] * 1000);
    const at = (rpm: number): number => {
      const t = (rpm - idle) / ((red - idle) / 8);
      if (t <= 0) return tq[0];
      const i = Math.floor(t);
      return i >= 8 ? tq[8] : tq[i] * (1 - (t - i)) + tq[i + 1] * (t - i);
    };
    const a = idle + 0.45 * (red - idle), b = idle + 0.9 * (red - idle);
    let band = 0;
    for (let j = 0; j <= 20; j++) band += at(a + (b - a) * j / 20);
    band /= 21;
    const met: Record<string, number> = {
      t60: fin(r.t60), t100: fin(r.t100),
      quarter: fin(r.quarterMile) + 0.001 * fin(r.quarterExact ?? r.quarterMile),
      top: fin(r.topSpeed, 0) / MPH_PER_MS,
      power: fin(r.peakPower, 0),
      band,
    };
    let cost = 0;
    for (const [kk, ww] of Object.entries(this.w)) cost += ww * met[kk];
    let launchDeficit = 0;
    if (this.launch) launchDeficit = this.launchDeficit(setup);
    cost += LAUNCH_PENALTY * launchDeficit;
    this.evals++;
    e = { r, met, cost, launchDeficit };
    this.cache.set(k, e);
    return e;
  }

  cost(setup: Uint8Array): number { return this.full(setup).cost; }

  /** Sum over the protected ECU points of the fractional shortfall below launch.min × stock. */
  launchDeficit(setup: Uint8Array): number {
    const ecu = this.model.curve(setup, 'ecu');
    if (!ecu) return 0;
    let d = 0;
    for (let i = 0; i < LAUNCH_POINTS; i++) {
      const pt = ecu[i];
      const stock = Math.min(Math.max(pt.stock, pt.min), pt.max);
      d += Math.max(0, this.launch!.min * stock - pt.value) / stock;
    }
    return d;
  }
}

// ---- realise -----------------------------------------------------------------------------------

export interface RealiseResult { bytes: Uint8Array; edits: { kind: CurveKind; index: number; nm: number }[]; ok: boolean }

/**
 * Realises target values T (N*m bar heights) with game edits: repeatedly sets the column furthest from
 * its target (withCurvePoint) until every column is within tolerance.
 */
export function realise(
  model: DynoModel,
  s: ArrayLike<number>,
  kind: CurveKind,
  T: number[],
  { tol = REALISE_TOL, maxEdits = REALISE_MAX_EDITS }: { tol?: number; maxEdits?: number } = {},
): RealiseResult {
  let cur = u8(s);
  const edits: { kind: CurveKind; index: number; nm: number }[] = [];
  for (;;) {
    const pts = model.curve(cur, kind);
    if (!pts) return { bytes: cur, edits, ok: edits.length === 0 };
    let wi = -1, we = 0;
    pts.forEach((p, i) => {
      const e = Math.abs(T[i] - p.value) - (tol === 0 ? 0.05 : Math.max(tol, (p.max - p.min) / 100));
      if (e > we) { we = e; wi = i; }
    });
    if (wi < 0) return { bytes: cur, edits, ok: true };
    if (edits.length >= maxEdits) return { bytes: cur, edits, ok: false };
    const nm = r1(clampv(T[wi], pts[wi].min, pts[wi].max));
    const b = model.withCurvePoint(cur, kind, wi, nm);
    if (keyOf(b) === keyOf(cur)) return { bytes: cur, edits, ok: false };
    edits.push({ kind, index: wi, nm });
    cur = b;
  }
}

// ---- curveLegality -----------------------------------------------------------------------------

export interface CurveLegalityResult {
  inBox: boolean; sum: number; ref: number; dev: number; tol: number; sumOk: boolean;
}

/** Per-curve legality numbers: in-box flag, reference sum, quantisation tolerance. */
export function curveLegality(model: DynoModel, setup: Uint8Array, kind: CurveKind): CurveLegalityResult | null {
  const pts = model.curve(setup, kind);
  if (!pts) return null;
  const neutral = u8(setup);
  for (let i = 0; i < 9; i++) neutral[(kind === 'ecu' ? ECU_OFF : TURBO_OFF) + i] = 100;
  const ref = model.curve(neutral, kind)!.reduce((t, p) => t + p.value, 0);
  const sum = pts.reduce((t, p) => t + p.value, 0);
  const tol = Math.max(...pts.map((p) => (p.max - p.min) / 100));
  const inBox = pts.every((p) => p.value >= p.min - 1e-6 && p.value <= p.max + 1e-6);
  return { inBox, sum, ref, dev: sum - ref, tol, sumOk: Math.abs(sum - ref) <= tol + 1e-6 };
}

// ---- neighbours --------------------------------------------------------------------------------

export interface Move { desc: { kind: string; i?: number; j?: number; d?: number; param?: number; ratio?: number }; bytes: Uint8Array }

// The moves depend only on the model and the bytes, and the climbs (5 starts, plain + launch) walk through the same
// setups again and again; building them is ~80 % of a search. Callers must not change the returned arrays.
const moveCache = new WeakMap<DynoModel, Map<string, Move[]>>();

/** Candidate moves from a setup: pairwise transfers (+d at i, -d at j, realised by game edits) and gear moves. */
export function neighbours(model: DynoModel, s: Uint8Array): Move[] {
  let cache = moveCache.get(model);
  if (!cache) moveCache.set(model, cache = new Map());
  const key = keyOf(s);
  let moves = cache.get(key);
  if (!moves) cache.set(key, moves = buildNeighbours(model, s));
  return moves;
}

function buildNeighbours(model: DynoModel, s: Uint8Array): Move[] {
  const out: Move[] = [];
  const seen = new Set([keyOf(s)]);
  const push = (desc: Move['desc'], bytes: Uint8Array): void => {
    const k = keyOf(bytes);
    if (!seen.has(k)) { seen.add(k); out.push({ desc, bytes }); }
  };
  for (const kind of ['ecu', 'turbo'] as CurveKind[]) {
    const pts = model.curve(s, kind);
    if (!pts) continue;
    const v = pts.map((p) => p.value);
    const cl = curveLegality(model, s, kind)!;
    const allowed = Math.max(cl.tol, Math.abs(cl.dev));
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        if (i === j) continue;
        const span = Math.min(pts[i].max - pts[i].min, pts[j].max - pts[j].min);
        if (span <= 0) continue;
        for (const pc of CURVE_PCTS) {
          const d = span * pc / 100;
          if (v[i] + d > pts[i].max + 1e-9 || v[j] - d < pts[j].min - 1e-9) continue;
          const T = v.slice();
          T[i] += d; T[j] -= d;
          const res = realise(model, s, kind, T);
          if (!res.ok) continue;
          const nsum = model.curve(res.bytes, kind)!.reduce((t, p) => t + p.value, 0);
          if (Math.abs(nsum - cl.ref) <= allowed + 1e-6) push({ kind, i, j, d }, res.bytes);
        }
      }
    }
  }
  const gr = model.gearing(s);
  if (gr) {
    const floor = shiftRetentionFloor(model, s);
    const curWorst = worstRetention(model, s);
    for (const row of gr.rows) {
      const span = row.max - row.min;
      if (span <= 0) continue;
      const targets = [row.min, row.max];
      for (const pc of GEAR_PCTS) targets.push(row.ratio + span * pc / 100, row.ratio - span * pc / 100);
      for (const t of targets) {
        const bytes = model.withGearRatio(s, row.param, t);
        // Forward-gear moves must not open a shift hole (see shiftRetentionFloor); final drive keeps every retention.
        if (row.param !== 9) {
          const w = worstRetention(model, bytes);
          if (w < floor - 1e-6 && w < curWorst - 1e-6) continue;
        }
        push({ kind: 'gear', param: row.param, ratio: t }, bytes);
      }
    }
  }
  return out;
}

/** Smallest rpm retention (next ratio / current ratio) over all forward shifts; 1 without shifts. */
export function worstRetention(model: DynoModel, s: ArrayLike<number>): number {
  const w = model.gearPowerWindows(s);
  return w.length ? Math.min(...w.map((x) => x.retention)) : 1;
}

const retentionFloors = new WeakMap<DynoModel, number>();

/**
 * Editor policy, not a game rule (same as the Auto-tune gearing constraint in technical.md): every shift must keep
 * at least min(worst, geometric mean) of the reset-to-default gearbox's rpm retention. Without it the dyno score
 * favours gearboxes with a huge 1st-2nd drop, which only work on the straight-line dyno.
 */
export function shiftRetentionFloor(model: DynoModel, s: ArrayLike<number>): number {
  let f = retentionFloors.get(model);
  if (f === undefined) {
    const neutral = u8(s);
    for (let p = 9; p <= 15; p++) neutral[p] = 100;
    const w = model.gearPowerWindows(neutral).map((x) => x.retention);
    f = w.length ? Math.min(Math.min(...w), Math.exp(w.reduce((t, r) => t + Math.log(r), 0) / w.length)) : 0;
    retentionFloors.set(model, f);
  }
  return f;
}

// ---- climb (private) ---------------------------------------------------------------------------

function climb(ev: Evaluator, start: Uint8Array, maxIter: number): { bytes: Uint8Array; cost: number; iters: number } {
  let cur = u8(start), cc = ev.cost(cur), iters = 0;
  while (iters < maxIter) {
    let best: Uint8Array | null = null, bc = cc - 1e-9;
    for (const n of neighbours(ev.model, cur)) {
      const c = ev.cost(n.bytes);
      if (c < bc) { bc = c; best = n.bytes; }
    }
    if (!best) break;
    cur = best; cc = bc; iters++;
  }
  return { bytes: cur, cost: cc, iters };
}

// ---- startPoints -------------------------------------------------------------------------------

export function startPoints(model: DynoModel, current: ArrayLike<number>, nRandom: number, seed: number): { label: string; bytes: Uint8Array }[] {
  const starts = [{ label: 'current', bytes: u8(current) }];
  const neutral = u8(current);
  for (let i = 9; i <= 15; i++) neutral[i] = 100;
  for (let i = ECU_OFF; i < TURBO_OFF + 9; i++) neutral[i] = 100;
  starts.push({ label: 'reset-to-default', bytes: neutral });
  const rng = mulberry32(seed);
  for (let k = 0; k < nRandom; k++) {
    let s = u8(current);
    for (let step = 0; step < 6; step++) {
      const nb = neighbours(model, s);
      if (!nb.length) break;
      s = nb[Math.floor(rng() * nb.length)].bytes;
    }
    starts.push({ label: `random${k + 1}`, bytes: s });
  }
  return starts;
}

// ---- optimize ----------------------------------------------------------------------------------

export interface OptimizeResult {
  ev: Evaluator;
  bytes: Uint8Array;
  cost: number;
  startCost: number;
  from: string;
  evals: number;
}

export function optimize(
  model: DynoModel,
  current: ArrayLike<number>,
  objective: string,
  { launch = null, nRandom = 3, seed = 1, maxIter = 300 }: { launch?: { min: number } | null; nRandom?: number; seed?: number; maxIter?: number } = {},
): OptimizeResult {
  const ev = new Evaluator(model, objective, launch);
  const startCur = u8(current);
  const startCost = ev.cost(startCur);
  const isLegal = (b: Uint8Array): boolean =>
    (['ecu', 'turbo'] as CurveKind[]).every((k) => { const c = curveLegality(model, b, k); return !c || (c.inBox && c.sumOk); });
  let best = { bytes: startCur, cost: startCost, label: 'current(unchanged)', iters: 0, legal: isLegal(startCur) };
  for (const st of startPoints(model, current, nRandom, seed)) {
    const res = climb(ev, st.bytes, maxIter);
    const cand = { ...res, label: st.label, legal: isLegal(res.bytes) };
    if ((cand.legal && !best.legal) || (cand.legal === best.legal && cand.cost < best.cost - 1e-9)) best = cand;
  }
  return { ev, bytes: best.bytes, cost: best.cost, startCost, from: best.label, evals: ev.evals };
}

// ---- defaultSetup / replayEdits ----------------------------------------------------------------

/** The game's reset-to-default state: curve, gear and final-drive bytes at neutral (100). */
export function defaultSetup(setup: ArrayLike<number>): Uint8Array {
  const n = u8(setup);
  for (let i = 9; i <= 15; i++) n[i] = 100;
  for (let i = ECU_OFF; i < TURBO_OFF + 9; i++) n[i] = 100;
  return n;
}

function applyEdit(model: DynoModel, s: Uint8Array, e: { kind: string; param?: number; ratio?: number; index?: number; nm?: number }): Uint8Array {
  if (e.kind === 'gear') return model.withGearRatio(s, e.param!, e.ratio!);
  return model.withCurvePoint(s, e.kind as CurveKind, e.index!, e.nm!);
}

export function replayEdits(model: DynoModel, start: ArrayLike<number>, edits: { kind: string; param?: number; ratio?: number; index?: number; nm?: number }[]): Uint8Array {
  let s = u8(start);
  for (const e of edits) s = applyEdit(model, s, e);
  return s;
}

// ---- beamEntry ---------------------------------------------------------------------------------

function curveDist(model: DynoModel, bytes: Uint8Array, kind: CurveKind, T: number[]): { mx: number; l1: number } {
  const pts = model.curve(bytes, kind)!;
  let mx = 0, l1 = 0;
  pts.forEach((p, i) => { const d = Math.abs(p.value - T[i]); mx = Math.max(mx, d); l1 += d; });
  return { mx, l1 };
}

export function beamEntry(
  model: DynoModel,
  start: Uint8Array,
  T: number[],
  kind: CurveKind,
  { maxLen = 14, beam = 150 }: { maxLen?: number; beam?: number } = {},
): { edits: { kind: CurveKind; index: number; nm: number }[]; ok: boolean } {
  const off = kind === 'ecu' ? ECU_OFF : TURBO_OFF;
  const target = u8(start);
  model.curve(start, kind)!.forEach((p, i) => { target[off + i] = DynoModel.curveByte(p, T[i]); });
  const exact = (b: Uint8Array): boolean => { for (let i = 0; i < 9; i++) if (b[off + i] !== target[off + i]) return false; return true; };
  const OFFS = [0, 2, -2, 5, -5, 10, -10, 20, -20, 40, -40];
  let level: { bytes: Uint8Array; edits: { kind: CurveKind; index: number; nm: number }[] }[] = [{ bytes: u8(start), edits: [] }];
  let best: { bytes: Uint8Array; edits: { kind: CurveKind; index: number; nm: number }[]; mx: number; l1: number } | null = null;
  if (exact(start)) return { edits: [], ok: true };
  for (let depth = 1; depth <= maxLen; depth++) {
    const next = new Map<string, { bytes: Uint8Array; edits: { kind: CurveKind; index: number; nm: number }[] }>();
    for (const st of level) {
      const pts = model.curve(st.bytes, kind)!;
      for (let i = 0; i < 9; i++) {
        for (const o of OFFS) {
          const nm = r1(clampv(T[i] + o, pts[i].min, pts[i].max));
          if (Math.abs(nm - pts[i].value) < 0.05) continue;
          const b = model.withCurvePoint(st.bytes, kind, i, nm);
          const k = keyOf(b);
          if (!next.has(k)) next.set(k, { bytes: b, edits: [...st.edits, { kind, index: i, nm }] });
        }
      }
    }
    const scored = [...next.values()].map((st) => ({ ...st, ...curveDist(model, st.bytes, kind, T) }));
    scored.sort((a, b) => (a.mx * 5 + a.l1) - (b.mx * 5 + b.l1));
    for (const st of scored) {
      if (exact(st.bytes)) return { edits: st.edits, ok: true };
      if (st.mx <= 1.0 && (!best || st.mx < best.mx)) best = st;
    }
    level = scored.slice(0, beam);
    if (!level.length) break;
  }
  return best ? { edits: best.edits, ok: true } : { edits: [], ok: false };
}

// ---- solveCurveEntry / solveGearEntry (private) -----------------------------------------------

function solveCurveEntry(
  model: DynoModel, start: Uint8Array, final: Uint8Array, kind: CurveKind, tol = REALISE_TOL, beamFallback = false,
): { edits: { kind: CurveKind; index: number; nm: number }[]; ok: boolean } {
  const fp = model.curve(final, kind);
  if (!fp) return { edits: [], ok: true };
  const T = fp.map((p) => p.value);
  const res = realise(model, start, kind, T, { tol });
  if (res.ok || !beamFallback) return { edits: res.edits as { kind: CurveKind; index: number; nm: number }[], ok: res.ok };
  return beamEntry(model, start, T, kind);
}

function solveGearEntry(
  model: DynoModel, start: Uint8Array, final: Uint8Array,
): { edits: { kind: string; param: number; ratio: number }[]; ok: boolean } {
  const edits: { kind: string; param: number; ratio: number }[] = [];
  let s = u8(start);
  const rows = model.gearing(final)?.rows ?? [];
  for (const row of rows) {
    if (s[row.param] === final[row.param]) continue;
    const e = { kind: 'gear', param: row.param, ratio: Math.round(row.ratio * 1000) / 1000 };
    edits.push(e);
    s = applyEdit(model, s, e);
  }
  let ok = true;
  for (const row of rows) if (s[row.param] !== final[row.param]) ok = false;
  return { edits, ok };
}

// ---- gameNumbers -------------------------------------------------------------------------------

export interface GameNumbers {
  t60: number | null;
  t100: number | null;
  topKmh: number;
  torqueNm: number;
  torqueRpm: number;
  powerBhp: number;
  /** Peak power as the game's metric dyno screen shows it (kW; tuner repo docs/dyno-check-3000gt.md). */
  powerKw: number;
  powerRpm: number;
  quarter: number | null;
}

/** Dyno screen numbers in the game's metric format (0-60/0-100 truncated to hundredths; km/h, N*m, bhp 1 decimal). */
export function gameNumbers(r: ReturnType<DynoModel['evaluate']>): GameNumbers {
  const trunc2 = (t: number): number | null => (Number.isFinite(t) && t > 0 ? Math.floor(t * 100 + 1e-6) / 100 : null);
  return {
    t60:      trunc2(r.t60),
    t100:     trunc2(r.t100),
    topKmh:   r1(r.topSpeed / MPH_PER_MS * 3.6),
    torqueNm: Number((Math.fround(Math.fround(r.peakTorque / 1000) * 1000) + 1e-9).toFixed(1)),
    torqueRpm: r.peakTorqueRpm,
    powerBhp: Number((Math.fround(r.peakPower * Math.fround(1.34102209)) + 1e-9).toFixed(1)),
    powerKw:  Number((Math.fround(r.peakPower) + 1e-9).toFixed(1)),
    powerRpm: r.peakPowerRpm,
    quarter:  Number.isFinite(r.quarterMile) ? Math.round(r.quarterMile * 100) / 100 : null,
  };
}

// ---- curveRows / legality (private) -----------------------------------------------------------

function curveRows(model: DynoModel, setup: Uint8Array, kind: CurveKind): CurveRow[] | null {
  const pts = model.curve(setup, kind);
  if (!pts) return null;
  return pts.map((p) => ({
    rpm: Math.round(p.rpm), min: r1(p.min), max: r1(p.max), stock: r1(p.stock), value: r1(p.value),
    pctOfBox: p.max > p.min ? Math.round((p.value - p.min) / (p.max - p.min) * 1000) / 10 : 0,
    byte: p.byte, inGame: r1(p.effective),
  }));
}

function legality(
  model: DynoModel, setup: Uint8Array, startSetup: Uint8Array, editCount: number,
): LegalityReport {
  const rep: LegalityReport = {
    reachable: 'yes (built from game edits: withCurvePoint / withGearRatio)',
    curves: {},
    allPointsInBox: true,
    legal: true,
    editCount,
  };
  let ok = true, boxOk = true;
  for (const kind of ['ecu', 'turbo'] as CurveKind[]) {
    const c  = curveLegality(model, setup, kind);
    if (!c) continue;
    const c0 = curveLegality(model, startSetup, kind)!;
    rep.curves[kind] = {
      allPointsInBox: c.inBox, sum: r1(c.sum), referenceSum: r1(c.ref),
      deviation: r1(c.dev), tolerance: r1(c.tol), sumOk: c.sumOk, startDeviation: r1(c0.dev),
    };
    boxOk &&= c.inBox; ok &&= c.inBox && c.sumOk;
  }
  rep.allPointsInBox = boxOk;
  rep.legal = ok;
  return rep;
}

// ---- buildReport -------------------------------------------------------------------------------

export interface CurveRow { rpm: number; min: number; max: number; stock: number; value: number; pctOfBox: number; byte: number; inGame: number }
export interface GearRow  { param: number; label: string; ratio: number; min: number; max: number; stock: number; byte: number }
export interface LegalityReport {
  reachable: string;
  curves: Record<string, { allPointsInBox: boolean; sum: number; referenceSum: number; deviation: number; tolerance: number; sumOk: boolean; startDeviation: number }>;
  allPointsInBox: boolean;
  legal: boolean;
  editCount: number;
}
export interface EntryOrder {
  ecu: { kind: CurveKind; index: number; nm: number }[];
  turbo: { kind: CurveKind; index: number; nm: number }[];
  gears: { kind: string; param: number; ratio: number }[];
  converged: boolean;
  replay: { maxDiffNm: number; dyno: GameNumbers };
}
export interface BuildReportResult {
  setupBytes: number[];
  dyno: GameNumbers;
  ecu: CurveRow[] | null;
  turbo: CurveRow[] | null;
  gearing: GearRow[] | null;
  legality: LegalityReport;
  entryOrder: EntryOrder;
  cost: number;
  searchedCost: number;
  launch: { min: number; deficit: number; points: { rpm: number; pctOfStock: number }[] } | null;
  /** Filled by runLegal: where the search started from and how many evaluations it used. */
  search?: { from: string; evals: number; startCost: number };
}

export function buildReport(
  model: DynoModel,
  ev: Evaluator,
  start: Uint8Array,
  searched: Uint8Array,
  launchInfo: { min: number } | null,
): BuildReportResult {
  let final = searched;
  const base = defaultSetup(searched);
  let entry: { ecu: { edits: { kind: CurveKind; index: number; nm: number }[]; ok: boolean }; turbo: { edits: { kind: CurveKind; index: number; nm: number }[]; ok: boolean }; gears: { edits: { kind: string; param: number; ratio: number }[]; ok: boolean } } | null = null;
  let edits: { kind: string; param?: number; ratio?: number; index?: number; nm?: number }[] = [];
  let replayed = u8(base);
  for (const tol of [2, 1, 0.5, 0]) {
    entry = {
      ecu:   solveCurveEntry(model, base, searched, 'ecu',   tol),
      turbo: solveCurveEntry(model, base, searched, 'turbo', tol),
      gears: solveGearEntry(model, base, searched),
    };
    edits = [...entry.ecu.edits, ...entry.turbo.edits, ...entry.gears.edits];
    replayed = replayEdits(model, base, edits);
    const sumsOk = (['ecu', 'turbo'] as CurveKind[]).every((k) => { const c = curveLegality(model, replayed, k); return !c || c.sumOk; });
    if (entry.ecu.ok && entry.turbo.ok && entry.gears.ok && sumsOk) break;
  }
  if (entry && !(entry.ecu.ok && entry.turbo.ok)) {
    entry = {
      ecu:   solveCurveEntry(model, base, searched, 'ecu',   0, true),
      turbo: solveCurveEntry(model, base, searched, 'turbo', 0, true),
      gears: solveGearEntry(model, base, searched),
    };
    edits = [...entry.ecu.edits, ...entry.turbo.edits, ...entry.gears.edits];
    replayed = replayEdits(model, base, edits);
  }
  if (entry && entry.ecu.ok && entry.turbo.ok && entry.gears.ok) final = replayed;
  let maxDiff = 0;
  for (const kind of ['ecu', 'turbo'] as CurveKind[]) {
    const a = model.curve(searched, kind), b = model.curve(replayed, kind);
    if (a && b) a.forEach((p, i) => { maxDiff = Math.max(maxDiff, Math.abs(p.value - b[i].value)); });
  }
  const rr = model.evaluate(replayed);
  const fr = model.evaluate(final);
  const gr = model.gearing(final);
  return {
    setupBytes: Array.from(final),
    dyno: gameNumbers(fr),
    ecu:   curveRows(model, final, 'ecu'),
    turbo: curveRows(model, final, 'turbo'),
    gearing: gr ? gr.rows.map((r) => ({
      param: r.param, label: r.label,
      ratio: Math.round(r.ratio * 1000) / 1000,
      min:   Math.round(r.min   * 1000) / 1000,
      max:   Math.round(r.max   * 1000) / 1000,
      stock: Math.round(r.stock * 1000) / 1000,
      byte:  r.byte,
    })) : null,
    legality: legality(model, final, base, edits.length),
    entryOrder: {
      ecu:       entry!.ecu.edits,
      turbo:     entry!.turbo.edits,
      gears:     entry!.gears.edits,
      converged: !!(entry && entry.ecu.ok && entry.turbo.ok && entry.gears.ok),
      replay: { maxDiffNm: r1(maxDiff), dyno: gameNumbers(rr) },
    },
    cost:         ev.cost(final),
    searchedCost: ev.cost(searched),
    launch: launchInfo ? {
      min: launchInfo.min,
      deficit: ev.launchDeficit(final),
      points: model.curve(final, 'ecu')?.slice(0, LAUNCH_POINTS).map((p) => ({
        rpm: Math.round(p.rpm),
        pctOfStock: Math.round(p.value / Math.min(Math.max(p.stock, p.min), p.max) * 1000) / 10,
      })) ?? [],
    } : null,
  };
}

// ---- formatSheet -------------------------------------------------------------------------------

function fmtDyno(d: GameNumbers): string {
  return `0-60 ${d.t60 ?? '-'} s | 0-100 ${d.t100 ?? '-'} s | top ${d.topKmh.toFixed(1)} km/h | torque ${d.torqueNm.toFixed(1)} Nm @${d.torqueRpm} | power ${d.powerBhp.toFixed(1)} bhp @${d.powerRpm}`;
}

function fmtCurve(title: string, rows: CurveRow[] | null): string[] {
  if (!rows) return [`${title}: locked by the installed parts`];
  const L = [`${title}  (N*m; SET = bar height to enter on the game's tuning screen)`,
    '   rpm |   min    max  stock |    SET  %box'];
  for (const r of rows) {
    L.push(`${String(r.rpm).padStart(6)} | ${r.min.toFixed(1).padStart(6)} ${r.max.toFixed(1).padStart(6)} ${r.stock.toFixed(1).padStart(6)} | ${r.value.toFixed(1).padStart(6)} ${r.pctOfBox.toFixed(0).padStart(4)}%`);
  }
  return L;
}

export function formatSheet(
  title: string,
  res: {
    car: string;
    parts: PartsInfo;
    start: { dyno: GameNumbers };
    plain: BuildReportResult;
    launch: BuildReportResult | null;
    launchMin: number | null;
  },
): string {
  const pi = res.parts;
  const lvl = (x: PartLevelInfo | null): string => (x ? `level ${x.level}` : 'not installed');
  const L = [`=== ${title} ===`,
    `car ${res.car}; parts: ECU ${lvl(pi.ecu)}, Turbo ${lvl(pi.turbo)}, Transmission ${lvl(pi.transmission)} (unlocked: ${pi.gearsUnlocked.join(', ') || 'none'}). Ranges and defaults depend on these.`,
    `start (as saved) : ${fmtDyno(res.start.dyno)}`];
  const variants: [string, BuildReportResult][] = [['LEGAL RESULT' + (res.launch ? ' (plain, no launch protection)' : ''), res.plain]];
  if (res.launch) variants.push([`LEGAL RESULT with launch protection (>= ${Math.round((res.launchMin ?? 0.9) * 100)} % of stock on the ${LAUNCH_POINTS} lowest ECU points)`, res.launch]);
  for (const [name, v] of variants) {
    L.push('', `--- ${name} ---`, `result          : ${fmtDyno(v.dyno)}`);
    L.push(...fmtCurve('ECU', v.ecu), ...fmtCurve('Turbo', v.turbo));
    if (v.gearing) for (const g of v.gearing) L.push(`${g.label}: ${g.ratio.toFixed(3)}  (range ${g.min.toFixed(3)} .. ${g.max.toFixed(3)}, stock ${g.stock.toFixed(3)}, byte ${g.byte})`);
    const lg = v.legality;
    L.push('LEGALITY (per curve, on the set values):');
    for (const [kind, c] of Object.entries(lg.curves)) {
      L.push(`  ${kind === 'ecu' ? 'ECU  ' : 'Turbo'}: points inside box: ${c.allPointsInBox ? 'yes' : 'NO'}; sum ${c.sum} vs reset-to-default sum ${c.referenceSum} N*m (deviation ${c.deviation}, allowed +-${c.tolerance} = one byte step; default state deviates ${c.startDeviation}) -> ${c.sumOk ? 'ok' : 'OUTSIDE'}`);
    }
    L.push(`  reachable: ${lg.reachable}; overall legal: ${lg.legal ? 'yes' : 'NO'}`);
    if (v.launch) L.push(`  launch points (% of stock)         : ${v.launch.points.map((p) => `${p.rpm}rpm ${p.pctOfStock}%`).join(', ')}`);
    const eo = v.entryOrder;
    L.push('ENTRY ORDER (cheat limits OFF). Step 0: press "Reset to default" on the ECU screen and the Turbo screen. Do not reset the Drivetrain: its slider moves 3 bytes a press, so from the reset value some final drives cannot be reached (mode A plans it from your saved value). Then, in this order, set the bar of that column to the value:');
    let n = 0;
    for (const [lab, list] of [['ECU', eo.ecu], ['Turbo', eo.turbo]] as [string, { index: number; nm: number }[]][]) {
      const rows = lab === 'ECU' ? v.ecu : v.turbo;
      for (const e of list) L.push(`  ${String(++n).padStart(2)}. ${lab} column ${rows![e.index].rpm} rpm: set to ${e.nm.toFixed(1)} N*m`);
    }
    for (const e of eo.gears) L.push(`  ${String(++n).padStart(2)}. Drivetrain: set ${e.param === 9 ? 'final drive' : 'gear ' + (e.param - 9)} to ${e.ratio.toFixed(3)}`);
    if (!n) L.push('  (the default state is the result: only press Reset to default)');
    L.push(`  replay from the reset-to-default state: ${n} edits, converged: ${eo.converged ? 'yes' : 'NO'}, the searched curve differed by at most ${eo.replay.maxDiffNm} N*m (the sheet shows the replayed values)`);
    L.push(`  replay dyno: ${fmtDyno(eo.replay.dyno)}`);
  }
  return L.join('\n');
}


// ---- runLegal: the whole CLI pipeline for one setup, as one pure call ----------------------------

export interface LegalRunOptions {
  /** Key of OBJECTIVES; defaults to the setup's own event (OBJ_BY_SETUP). */
  objective?: string;
  /** Fraction of stock (0..1) the lowest ECU points must keep; null/undefined = no launch variant. */
  launchMin?: number | null;
  nRandom?: number;
  seed?: number;
  maxIter?: number;
}
export interface LegalRun {
  setup: number;
  setupName: string;
  objective: string;
  car: string;
  parts: PartsInfo;
  start: { setupBytes: number[]; dyno: GameNumbers; cost: number };
  plain: BuildReportResult;
  launch: BuildReportResult | null;
  launchMin: number | null;
}

/** Same work as tools/opt/legal_opt.mjs for one setup. Deterministic for a given seed. */
export function runLegal(model: DynoModel, car: string, start: ArrayLike<number>, setup: number, o: LegalRunOptions = {}): LegalRun {
  const objective = o.objective ?? OBJ_BY_SETUP[setup];
  if (!OBJECTIVES[objective]) throw new Error(`unknown objective ${objective}`);
  const startBytes = u8(start);
  const opts = { nRandom: o.nRandom ?? 3, seed: o.seed ?? 1, maxIter: o.maxIter ?? 300 };
  const plain = optimize(model, startBytes, objective, opts);
  const startEv = new Evaluator(model, objective);
  const plainReport = buildReport(model, plain.ev, startBytes, plain.bytes, null);
  plainReport.search = { from: plain.from, evals: plain.evals, startCost: plain.startCost };
  let launchReport: BuildReportResult | null = null;
  const launchMin = o.launchMin ?? null;
  if (launchMin !== null) {
    const lp = optimize(model, startBytes, objective, { ...opts, launch: { min: launchMin } });
    launchReport = buildReport(model, lp.ev, startBytes, lp.bytes, { min: launchMin });
    launchReport.search = { from: lp.from, evals: lp.evals, startCost: lp.startCost };
  }
  return {
    setup, setupName: SETUP_NAMES[setup], objective, car, parts: partsInfo(model),
    start: { setupBytes: Array.from(startBytes), dyno: gameNumbers(model.evaluate(startBytes)), cost: startEv.cost(startBytes) },
    plain: plainReport, launch: launchReport, launchMin,
  };
}
