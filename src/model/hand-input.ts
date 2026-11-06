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
import { CurveScreen, pressFinalDrive } from './tune-keys.js';
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
}

export type SliderPlanner = (model: DynoModel, current: Uint8Array, target: Uint8Array, objective: string) => SliderPlan | null;

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
const finalDrivePlanner: SliderPlanner = (model, current, target, objective) => {
  if (!model.gearing(current)?.rows.some((r) => r.param === 9)) return null;
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

/** The screens a plan covers, in the order the owner works through the game's menu. */
export const SLIDER_PLANNERS: SliderPlanner[] = [curvePlanner('ecu'), curvePlanner('turbo'), finalDrivePlanner];

/**
 * Mode A for an optimum.
 * @param saved Setup bytes in the save (what the screens start from, except where key C is used).
 * @param optimum Mode B: the exact optimum from runLegal.
 */
export function planHandInput(model: DynoModel, saved: Uint8Array, optimum: Uint8Array, setupIndex: number, objective?: string): HandInputPlan {
  const obj = objective ?? OBJ_BY_SETUP[setupIndex];
  let setup: Uint8Array = Uint8Array.from(saved);
  const plans: SliderPlan[] = [];
  for (const planner of SLIDER_PLANNERS) {
    const plan = planner(model, setup, optimum, obj);
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
