/**
 * Mode A, "set by hand in the game": the best setup that the game's own keys can reach, and the key presses to get there.
 * Mode B (write to the save) is the exact optimum from legal-opt.ts; this module fits that optimum to the screens' steps
 * (tune-keys.ts, the game's key code) and reports both so the cost of typing it by hand is visible.
 *
 * Each slider screen is one planner in {@link SLIDER_PLANNERS}: it gets the setup so far and the optimum, and returns
 * the presses and the setup they give. Suspension, aero, tires, brakes and nitrous plug in here later (their keys are in
 * docs/native-menu-map.md: range/30 per press, byte rounding as the final drive); the planners below are the template.
 */
import { SETUP_NAMES, type DynoModel } from './dyno.js';
import {
  CurveScreen, NitroScreen, openRow, pressFinalDrive, pressRowState, resetRow, rowInfo, rowScale, rowShown, type RowInfo, type RowState,
} from './tune-keys.js';
import { Evaluator, gameNumbers, OBJ_BY_SETUP, type GameNumbers } from './legal-opt.js';

/** One screen of the game's tuning menu and the presses it takes. */
export interface SliderPlan {
  id: string;
  /** Menu name, as the game shows it. */
  screen: string;
  /** What to do first on this screen. */
  start: 'C' | 'saved';
  /** Presses per column, one array per pass, left to right: +n = UP n times, -n = DOWN n times, 0 = skip. */
  passes: number[][];
  /** Column names (rpm) for `passes`, or the single row's name. */
  columns: string[];
  presses: number;
  /** Setup bytes after the presses (the whole setup). */
  setup: Uint8Array;
  /** Bar height in N*m the plan reaches per column, and the optimum's (curves only). */
  reached?: number[];
  wanted?: number[];
  /** Number sliders: what the screen shows, so the plan reads like the game (see {@link rowPlanner}). */
  row?: { param: number; label: string; saved: string; wanted: string; reached: string; again: boolean; ends?: boolean[] };
}

/** What a planner may know besides the setups: which rows the owner typed a number for (they are not the optimizer's). */
export interface PlanContext {
  manual: ReadonlySet<number>;
  /** Typed with more decimals than the screen shows: that exact byte is wanted, not any byte that reads the same. */
  exact: ReadonlySet<number>;
}

export type SliderPlanner = (model: DynoModel, current: Uint8Array, target: Uint8Array, objective: string, ctx: PlanContext) => SliderPlan | null;

export interface HandInputPlan {
  /** Bytes after all presses (what the game would hold). */
  setup: Uint8Array;
  plans: SliderPlan[];
  presses: number;
  /** Mode A (by hand) and mode B (exact optimum) in the dyno screen's format. */
  a: GameNumbers;
  b: GameNumbers;
  /** A minus B, in the dyno screen's units (s, s, km/h, bhp). */
  diff: { t60: number | null; t100: number | null; topKmh: number; powerBhp: number };
}

const MAX_PRESSES_PER_VISIT = 12;
const MAX_PASSES = 3;

/** Squared distance (N*m) of a screen's bars to the optimum's. */
function error(s: CurveScreen, want: number[]): number {
  let e = 0;
  for (let i = 0; i < want.length; i++) e += (s.value(i) - want[i]) ** 2;
  return e;
}

/**
 * Key C on the screen, then the bars from left to right: for each bar the number of UP or DOWN presses that brings the nine
 * bars nearest to the optimum (the bars next to it move with every press, so a second and third pass fix what moved).
 */
function curvePlanner(kind: 'ecu' | 'turbo'): SliderPlanner {
  return (model, current, target) => {
    const off = kind === 'ecu' ? 0x17 : 0x20;
    if (current.subarray(off, off + 9).every((b, i) => b === target[off + i])) return null;
    let screen: CurveScreen;
    try { screen = new CurveScreen(model, current, kind); } catch { return null; }
    const points = model.curve(target, kind);
    if (!points) return null;
    const want = points.map((p) => p.value);
    screen.reset();
    const passes: number[][] = [];
    let presses = 0;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const row = new Array<number>(want.length).fill(0);
      for (let col = 0; col < want.length; col++) {
        let best = { n: 0, e: error(screen, want) };
        for (const dir of [1, -1] as const) {
          const t = screen.clone();
          for (let n = 1; n <= MAX_PRESSES_PER_VISIT && t.press(col, dir); n++) {
            const e = error(t, want);
            if (e < best.e - 1e-6) best = { n: dir * n, e };
          }
        }
        for (let k = 0; k < Math.abs(best.n); k++) screen.press(col, best.n > 0 ? 1 : -1);
        row[col] = best.n;
      }
      const moved = row.reduce((a, n) => a + Math.abs(n), 0);
      if (!moved) break;
      passes.push(row);
      presses += moved;
    }
    return {
      id: kind, screen: kind === 'ecu' ? 'ECU' : 'Turbo', start: 'C', passes, presses,
      columns: points.map((p) => String(Math.round(p.rpm))), setup: screen.setupBytes(),
      reached: Array.from({ length: want.length }, (_, i) => screen.value(i)), wanted: want,
    };
  };
}

/**
 * Final drive: the row starts at the saved byte (key C would put it at 100, from where only bytes 67..167 with byte mod 3
 * = 1 or 2 are reachable and the way there is long, so C is only used when it is cheaper). Every byte reachable by
 * RIGHT / LEFT is tried on the dyno with the other sliders as planned; the best cost wins, fewer presses break ties.
 */
const finalDrivePlanner: SliderPlanner = (model, current, target, objective, ctx) => {
  if (ctx.manual.has(9) || current[9] === target[9] || !model.gearing(current)?.rows.some((r) => r.param === 9)) return null;
  const ev = new Evaluator(model, objective);
  type Node = { setup: Uint8Array; presses: number; start: 'C' | 'saved'; runs: number[] };
  const best = new Map<number, Node>();
  const consider = (setup: Uint8Array, presses: number, start: 'C' | 'saved', runs: number[]): void => {
    const old = best.get(setup[9]);
    if (!old || presses < old.presses) best.set(setup[9], { setup, presses, start, runs });
  };
  for (const [from, start, base] of [
    [current, 'saved', 0], [Uint8Array.from(current, (b, i) => (i === 9 ? 100 : b)), 'C', 1],
  ] as const) {
    // breadth-first over the key presses: the state is the byte
    let frontier: Node[] = [{ setup: from, presses: base, start, runs: [] }];
    consider(from, base, start, []);
    for (let depth = 0; depth < 90 && frontier.length; depth++) {
      const next: Node[] = [];
      for (const n of frontier) {
        for (const dir of [1, -1] as const) {
          const s = pressFinalDrive(model, n.setup, dir);
          if (!s || (best.get(s[9]) && best.get(s[9])!.presses <= n.presses + 1)) continue;
          const runs = n.runs.slice();
          if (runs.length && Math.sign(runs[runs.length - 1]) === dir) runs[runs.length - 1] += dir; else runs.push(dir);
          const node = { setup: s, presses: n.presses + 1, start, runs };
          consider(s, node.presses, start, runs);
          next.push(node);
        }
      }
      frontier = next;
    }
  }
  let pick: Node | null = null, pickCost = Infinity;
  for (const node of best.values()) {
    const cost = ev.cost(node.setup);
    if (cost < pickCost - 1e-12 || (Math.abs(cost - pickCost) <= 1e-12 && pick && node.presses < pick.presses)) { pick = node; pickCost = cost; }
  }
  if (!pick) return null;
  return {
    id: 'finalDrive', screen: 'Drivetrain', start: pick.start, columns: ['Final drive'],
    passes: pick.runs.length ? pick.runs.map((n) => [n]) : [[0]],
    presses: pick.presses - (pick.start === 'C' ? 1 : 0), setup: pick.setup,
  };
};

// ---- number sliders: shortest key path to a number -------------------------------------------------------------------

/** Names and screens of the number sliders as the game's menus show them (docs/game-input-rules.md). */
export const ROW_LABELS: Record<number, [screen: string, label: string]> = {
  3: ['Suspension', 'Front Lowering (cm)'], 7: ['Suspension', 'Rear Lowering (cm)'], 0: ['Suspension', 'Front Springs'],
  4: ['Suspension', 'Rear Springs'], 1: ['Suspension', 'Front Shocks'], 5: ['Suspension', 'Rear Shocks'],
  2: ['Suspension', 'Front Sway Bar'], 6: ['Suspension', 'Rear Sway Bar'], 8: ['Suspension', 'Steering Ratio'],
  10: ['Drivetrain', '1st Gear (km/h)'], 11: ['Drivetrain', '2nd Gear (km/h)'], 12: ['Drivetrain', '3rd Gear (km/h)'],
  13: ['Drivetrain', '4th Gear (km/h)'], 14: ['Drivetrain', '5th Gear (km/h)'], 15: ['Drivetrain', '6th Gear (km/h)'],
  9: ['Drivetrain', 'Final Drive Ratio'], 21: ['Aerodynamics', 'Front Downforce'], 22: ['Aerodynamics', 'Rear Downforce'],
  19: ['Tires & Brakes', 'Front Grip'], 20: ['Tires & Brakes', 'Rear Grip'], 18: ['Tires & Brakes', 'Brake Bias'],
  16: ['Nitrous', 'Nitrous duration (s)'],
};
/** The rows in the order of the game's menus; nitrous has its own screen. */
export const ROW_ORDER = [3, 7, 0, 4, 1, 5, 2, 6, 8, 10, 11, 12, 13, 14, 15, 9, 21, 22, 19, 20, 18, 16];

/** A byte more or less on a slider is below what anyone feels (a key moves 3.3 bytes); the path may stop that close. */
export const SLACK_BYTES = 1;
const MAX_STATES = 600;

type Key = 1 | -1;
interface Node { st: RowState; keys: Key[] }

/** Every state reachable from `start` with RIGHT / LEFT (breadth first, so the first way found is the shortest). */
function walk(model: DynoModel, info: RowInfo, start: RowState): Map<string, Node> {
  const seen = new Map<string, Node>([[start.setup.join(), { st: start, keys: [] }]]);
  let frontier = [...seen.values()];
  while (frontier.length && seen.size < MAX_STATES) {
    const next: Node[] = [];
    for (const n of frontier) {
      for (const dir of [1, -1] as const) {
        const st = pressRowState(model, info, n.st, dir);
        if (!st || seen.has(st.setup.join())) continue;
        const node = { st, keys: [...n.keys, dir] };
        seen.set(st.setup.join(), node);
        next.push(node);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * How a path reads in the game: `C` first (or not), then runs of RIGHT (+n) and LEFT (-n). `ends[i]`: run i stops at the end
 * of the box (one more key that way changes nothing), so the next run starts from the end's grid (the grid shifts there).
 */
export interface Route { useC: boolean; runs: number[]; presses: number; setup: Uint8Array; ends?: boolean[] }

function runsOf(keys: Key[]): number[] {
  const runs: number[] = [];
  for (const k of keys) {
    if (runs.length && Math.sign(runs[runs.length - 1]) === k) runs[runs.length - 1] += k; else runs.push(k);
  }
  return runs;
}

/**
 * The shortest key path to a byte on one slider. All ways are searched: from the value you have, and after key C (which puts
 * the row at byte 100); RIGHT and LEFT, bouncing off both ends of the box (the reachable grid shifts at an end).
 * @param slack Bytes the result may be away from `targetByte`; among those the fewest presses win (C counts as one).
 * @param useC 'auto' tries both starts, 'never' only the value you have, 'only' only key C.
 * @param sameShown The target counts as reached by every byte whose number on the screen reads the same (the screen shows
 *   two decimals, gears one, so a few bytes show one number); among those the fewest presses win.
 * @returns null when the row is locked.
 */
export function routeToByte(model: DynoModel, setup: ArrayLike<number>, param: number, targetByte: number,
  slack = 0, useC: 'auto' | 'never' | 'only' = 'auto', sameShown = false): Route | null {
  const info = rowInfo(model, setup, param);
  if (!info) return null;
  const digits = param >= 10 && param <= 15 ? 1 : 2;
  const text = (b: number): string => rowShown(info, b).toFixed(digits);
  const wanted = text(targetByte);
  const starts: { st: RowState; c: boolean }[] = [];
  if (useC !== 'only') starts.push({ st: openRow(model, setup), c: false });
  if (useC !== 'never') starts.push({ st: resetRow(model, setup, param), c: true });
  let best: { route: Route; d: number; dd: number; from: RowState } | null = null;
  for (const { st, c } of starts) {
    for (const node of walk(model, info, st).values()) {
      const b = node.st.setup[param];
      const dd = Math.abs(b - targetByte), d = sameShown && text(b) === wanted ? 0 : dd;
      const route: Route = { useC: c, runs: runsOf(node.keys), presses: node.keys.length + (c ? 1 : 0), setup: node.st.setup };
      const off = (x: number): number => (x > slack ? x : 0);
      if (!best || off(d) < off(best.d) || (off(d) === off(best.d) && (route.presses < best.route.presses
        || (route.presses === best.route.presses && (dd < best.dd || (dd === best.dd && !route.useC && best.route.useC)))))) best = { route, d, dd, from: st };
    }
  }
  if (!best) return null;
  // which runs stop at an end of the box: replay them and try one key more
  let st: RowState | null = best.from;
  best.route.ends = best.route.runs.map((n) => {
    const dir = n > 0 ? 1 : -1;
    for (let k = 0; k < Math.abs(n) && st; k++) st = pressRowState(model, info, st, dir);
    if (!st) return false;
    // at the end a key changes no byte any more (the screen's float may still move a hair)
    const more = pressRowState(model, info, st, dir);
    return !more || more.setup.every((b, i) => b === st!.setup[i]);
  });
  return best.route;
}

/** At most this many presses more for a path in one direction than for the shortest path that turns back. */
const STRAIGHT_EXTRA = 2;

/**
 * A path in one direction (C or not, then only RIGHT or only LEFT) whose setup gives the same dyno numbers as `route`'s,
 * as the game's Dyno Results screen shows them (0-60, 0-100, quarter mile to 0.01 s, top speed to 0.1 km/h); null if none.
 */
function straightRoute(model: DynoModel, setup: ArrayLike<number>, param: number, route: Route): Route | null {
  const info = rowInfo(model, setup, param);
  if (!info) return null;
  const key = (s: Uint8Array): string => { const g = gameNumbers(model.evaluate(s)); return [g.t60, g.t100, g.quarter, g.topKmh.toFixed(1)].join('|'); };
  const want = key(route.setup);
  let best: Route | null = null;
  for (const c of [false, true]) {
    const from = c ? resetRow(model, setup, param) : openRow(model, setup);
    if (c && key(from.setup) === want) best = best && best.presses <= 1 ? best : { useC: true, runs: [], presses: 1, setup: from.setup, ends: [] };
    for (const dir of [1, -1] as const) {
      let st: RowState | null = from;
      for (let n = 1; st; n++) {
        const presses = n + (c ? 1 : 0);
        if (presses > route.presses + STRAIGHT_EXTRA || (best && presses >= best.presses)) break;
        st = pressRowState(model, info, st, dir);
        if (st && key(st.setup) === want) { best = { useC: c, runs: [dir * n], presses, setup: st.setup, ends: [false] }; break; }
      }
    }
  }
  return best;
}

/** The nitrous slider: one number, only RIGHT / LEFT from the value you have (key C is not modelled, see NitroScreen). */
function routeNitro(model: DynoModel, setup: ArrayLike<number>, targetByte: number, slack: number): Route | null {
  const start = NitroScreen.open(model, setup);
  if (!start) return null;
  const seen = new Map<string, { s: NitroScreen; keys: Key[] }>([[start.key, { s: start, keys: [] }]]);
  let frontier = [...seen.values()];
  while (frontier.length && seen.size < MAX_STATES) {
    const next: typeof frontier = [];
    for (const n of frontier) {
      for (const dir of [1, -1] as const) {
        const s = n.s.press(dir);
        if (!s || seen.has(s.key)) continue;
        const node = { s, keys: [...n.keys, dir] };
        seen.set(s.key, node);
        next.push(node);
      }
    }
    frontier = next;
  }
  let best: { n: { s: NitroScreen; keys: Key[] }; d: number } | null = null;
  for (const n of seen.values()) {
    const d = Math.abs(n.s.bytes[0] - targetByte), off = (x: number): number => (x > slack ? x : 0);
    if (!best || off(d) < off(best.d) || (off(d) === off(best.d) && (n.keys.length < best.n.keys.length || (n.keys.length === best.n.keys.length && d < best.d)))) best = { n, d };
  }
  return best ? { useC: false, runs: runsOf(best.n.keys), presses: best.n.keys.length, setup: best.n.s.setupBytes() } : null;
}

/** The number a screen shows, as text (gears show one decimal, the rest two). */
export function shownText(model: DynoModel, setup: ArrayLike<number>, param: number): string {
  if (param === 16) {
    const n = NitroScreen.open(model, setup);
    return n ? n.secondsOf(setup[16]).toFixed(2) : '-';
  }
  const info = rowInfo(model, setup, param);
  return info ? rowShown(info, setup[param]).toFixed(param >= 10 && param <= 15 ? 1 : 2) : '-';
}

/**
 * One planner per number slider: the shortest key path (or key C and then keys) from the value on the screen to the target
 * byte, within {@link SLACK_BYTES} (exact for numbers the owner typed). Gears get a second round (a gear key pushes its neighbours away from where they were set).
 * Rows nobody wants to change cost no key. The final drive is left to {@link finalDrivePlanner} unless the owner typed it.
 */
export function rowPlanner(param: number, again = false): SliderPlanner {
  return (model, current, target, _objective, ctx) => {
    if (param === 9 && !ctx.manual.has(9)) return null;
    const pair = param === 16 ? [16, 17] : [param];
    if (pair.every((i) => current[i] === target[i])) return null;
    // a number the owner typed is reached when the screen shows it (any byte that reads the same); the optimizer's own rows may stop a byte short
    const slack = ctx.manual.has(param) ? 0 : SLACK_BYTES;
    let route = param === 16 ? routeNitro(model, current, target[16], slack) : routeToByte(model, current, param, target[param], slack, 'auto', ctx.manual.has(param) && !ctx.exact.has(param));
    // a path that turns back ("LEFT 14, then RIGHT 3") reads oddly; one way only is taken when the dyno shows the same numbers
    // (gears only: the dyno does not see the driving rows, so for them "same numbers" says nothing)
    if (route && route.runs.length > 1 && param >= 10 && param <= 15 && !ctx.manual.has(param)) route = straightRoute(model, current, param, route) ?? route;
    if (!route || route.presses === 0) return null;
    // the key path of an unlocked row only; nothing to do when the best path ends where it started
    if (pair.every((i) => route.setup[i] === current[i]) && !route.useC) return null;
    const [screen, label] = ROW_LABELS[param];
    return {
      id: `row${param}${again ? 'b' : ''}`, screen, start: route.useC ? 'C' : 'saved', columns: [label],
      passes: route.runs.length ? route.runs.map((n) => [n]) : [[0]], presses: route.presses, setup: route.setup,
      row: {
        param, label, saved: shownText(model, current, param), wanted: shownText(model, target, param),
        reached: shownText(model, route.setup, param), again, ends: route.ends,
      },
    };
  };
}

const ROW_PLANNERS = ROW_ORDER.map((p) => rowPlanner(p));
const GEAR_AGAIN = [10, 11, 12, 13, 14, 15].map((p) => rowPlanner(p, true));

/**
 * The screens a plan covers. On the Drivetrain screen the game lists 1st..6th Gear, then Final Drive Ratio (tuner repo
 * docs/game-input-rules.md "Gearbox level 3 screen"), so the gears are planned first and the final drive last: the steps read
 * top to bottom like the screen, and the final drive is picked with the gears as set.
 */
export const SLIDER_PLANNERS: SliderPlanner[] = [curvePlanner('ecu'), curvePlanner('turbo'), ...ROW_PLANNERS, ...GEAR_AGAIN, finalDrivePlanner];

/**
 * Mode A for an optimum.
 * @param saved Setup bytes in the save (what the screens start from, except where key C is used).
 * @param optimum Mode B: the exact optimum from runLegal, plus the numbers the owner typed for sliders.
 * @param manual Sliders (params) whose target the owner typed: they get the nearest-number path, not the optimizer's choice.
 * @param exact Those among them typed with more decimals than the screen shows (a byte, not a number on the screen).
 */
export function planHandInput(model: DynoModel, saved: Uint8Array, optimum: Uint8Array, setupIndex: number, objective?: string,
  manual: Iterable<number> = [], exact: Iterable<number> = []): HandInputPlan {
  const obj = objective ?? OBJ_BY_SETUP[setupIndex], ctx: PlanContext = { manual: new Set(manual), exact: new Set(exact) };
  let setup: Uint8Array = Uint8Array.from(saved);
  const plans: SliderPlan[] = [];
  for (const planner of SLIDER_PLANNERS) {
    const plan = planner(model, setup, optimum, obj, ctx);
    if (!plan) continue;
    plans.push(plan);
    setup = plan.setup;
  }
  const a = gameNumbers(model.evaluate(setup)), b = gameNumbers(model.evaluate(optimum));
  const d = (x: number | null, y: number | null): number | null => (x === null || y === null ? null : Math.round((x - y) * 100) / 100);
  return {
    setup, plans, presses: plans.reduce((n, p) => n + p.presses, 0), a, b,
    diff: { t60: d(a.t60, b.t60), t100: d(a.t100, b.t100), topKmh: Math.round((a.topKmh - b.topKmh) * 10) / 10, powerBhp: Math.round((a.powerBhp - b.powerBhp) * 10) / 10 },
  };
}

/** Text for the sheet: what to press, screen by screen. */
export function formatHandPlan(plan: HandInputPlan, setupIndex: number): string {
  const L = [`=== Set by hand in the game (mode A), ${SETUP_NAMES[setupIndex]} setup ===`];
  for (const p of plan.plans) {
    if (p.row) {
      const runs = p.passes.map((r) => r[0]).filter(Boolean);
      L.push('', `${p.screen} > ${p.row.label}:${p.start === 'C' ? ' press C, then' : ''} ${runs.map((n) => `${n > 0 ? 'RIGHT' : 'LEFT'} x${Math.abs(n)}`).join(', then ') || 'no key'}`
        + ` -> shows ${p.row.reached} (wanted ${p.row.wanted}, was ${p.row.saved})${p.row.again ? ' [second round: a gear key moved a neighbour]' : ''}`);
      continue;
    }
    L.push('', `${p.screen}:${p.start === 'C' ? ' press C (Reset to default) first.' : ' start from the value you have.'}`);
    if (p.id === 'finalDrive') {
      const runs = p.passes.map((r) => r[0]).filter(Boolean);
      L.push(runs.length ? `  ${runs.map((n) => `${n > 0 ? 'RIGHT' : 'LEFT'} x${Math.abs(n)}`).join(', then ')}` : '  no further key needed');
      continue;
    }
    p.passes.forEach((row, k) => {
      const parts = row.map((n, i) => (n ? `${p.columns[i]} rpm ${n > 0 ? 'UP' : 'DOWN'} x${Math.abs(n)}` : '')).filter(Boolean);
      L.push(`  ${k === 0 ? 'bars left to right' : `then, again left to right (pass ${k + 1})`}: ${parts.join(', ') || 'nothing'}`);
    });
    if (p.reached) L.push(`  bars after the presses (N*m): ${p.reached.map((v) => v.toFixed(0)).join(' ')}; optimum: ${p.wanted!.map((v) => v.toFixed(0)).join(' ')}`);
  }
  const f = (g: typeof plan.a): string => `0-60 ${g.t60 ?? '-'} s | 0-100 ${g.t100 ?? '-'} s | top ${g.topKmh.toFixed(1)} km/h | power ${g.powerBhp.toFixed(1)} bhp`;
  L.push('', `${plan.presses} key presses in total.`, `By hand (A)   : ${f(plan.a)}`, `Exact (B)     : ${f(plan.b)}`,
    `A minus B     : 0-60 ${plan.diff.t60 ?? '-'} s | 0-100 ${plan.diff.t100 ?? '-'} s | top ${plan.diff.topKmh} km/h | power ${plan.diff.powerBhp} bhp`);
  return L.join('\n');
}

/** One line of the key list: what to do on which screen, and where it ends. */
export interface HandStep { screen: string; row: string; keys: string; result: string; presses: number }

const runText = (runs: number[]): string => runs.map((n) => `${n > 0 ? 'RIGHT' : 'LEFT'} ×${Math.abs(n)}`).join(', then ') || 'no key';
/** `C` first when the path starts with it, then the runs ("C" alone when key C already lands on the value). */
const keyText = (c: boolean, runs: number[]): string => (c ? ['C', ...(runs.length ? [runText(runs)] : [])].join(', then ') : runText(runs));

/** The plan as a short list (the long text for copying is {@link formatHandPlan}). */
export function handSteps(plan: HandInputPlan): HandStep[] {
  return plan.plans.map((p) => {
    if (p.row) {
      const runs = p.passes.map((r) => r[0]).filter(Boolean);
      return {
        screen: p.screen, row: p.row.label, presses: p.presses, result: `${p.row.reached}${p.row.again ? ' (second round)' : ''}`,
        keys: keyText(p.start === 'C', runs),
      };
    }
    if (p.id === 'finalDrive') {
      return { screen: p.screen, row: 'Final Drive Ratio', presses: p.presses, result: '', keys: keyText(p.start === 'C', p.passes.map((r) => r[0]).filter(Boolean)) };
    }
    return {
      screen: p.screen, row: 'bars, left to right', presses: p.presses, result: '',
      keys: `C, then the bars (counts are under the bars on the graph; ${p.passes.length} round${p.passes.length > 1 ? 's' : ''})`,
    };
  });
}
