/**
 * The "Tuner" screen: one Optimize for all five dyno tabs of the game. Pure functions on top of the optimizer (legal-opt.ts,
 * mode B) and the key planner (hand-input.ts, mode A); neither is changed here. The page runs {@link optimizeTab} in web
 * workers (src/tuner-worker.ts) because one tab takes about 20 s.
 */
import { SETUP_COUNT, SETUP_NAMES, SETUP_SIZE, type DynoModel } from './dyno.js';
import { formatSheet, OBJ_BY_SETUP, runLegal } from './legal-opt.js';
import { formatHandPlan, planHandInput, ROW_ORDER, shownText, type HandInputPlan, type SliderPlan } from './hand-input.js';
import { resetRow, rowInfo } from './tune-keys.js';

/** What the owner cares about most. Each choice maps to an objective that already exists in legal-opt.ts; no new weights. */
export type Preference = 'race' | 'launch' | 'accel' | 'top';
export const PREFERENCES: { key: Preference; label: string; text: string }[] = [
  { key: 'race', label: 'Best for each race', text: 'Each tab gets the goal of its own race type. This is the default.' },
  { key: 'launch', label: 'Keep a strong start', text: 'Same goals, but the 3 lowest ECU bars keep at least 90 % of stock torque. This is our rule of thumb for the launch. The game does not confirm it.' },
  { key: 'accel', label: 'Acceleration first', text: 'Every tab aims at short 0-60 and 0-100 times (the Street X goal).' },
  { key: 'top', label: 'Top speed first', text: 'Every tab counts top speed most (the URL goal).' },
];

/** Objective and launch rule of a tab for a preference (`launchMin` is the editor's old "Protect launch" value). */
export function legalOptions(pref: Preference, setup: number): { objective: string; launchMin: number | null } {
  if (pref === 'accel') return { objective: 'streetx', launchMin: null };
  if (pref === 'top') return { objective: 'url', launchMin: null };
  return { objective: OBJ_BY_SETUP[setup], launchMin: pref === 'launch' ? 0.9 : null };
}

/**
 * Which races load which tab. Source: docs/setup-bytes.md l.89-103 of the tuner repo (game code) and its in-game check
 * l.166-174 (career URL loads the Circuit tab).
 */
export const TAB_USES = [
  'Career Circuit, Sprint and URL. Quick Race Circuit and Sprint. Free roam.',
  'Drag, in the career and in Quick Race.',
  'Drift, in the career and in Quick Race.',
  'Street X, in the career and in Quick Race.',
  'Only Quick Race URL. Career URL races use the Circuit tab.',
];

/** Order of the screens in the game's Performance Tuning menu (docs/native-menu-map.md l.167-170, item index 0..6). */
export const SCREEN_ORDER = ['Suspension', 'Drivetrain', 'Aerodynamics', 'Tires & Brakes', 'ECU', 'Turbo', 'Nitrous'];

/** The slow part (about 20 s): the exact optimum of one tab, as "Optimize (game rules)" computes it. */
export function optimizeTab(model: DynoModel, carName: string, start: ArrayLike<number>, setup: number, pref: Preference): { bytes: number[]; sheet: string } {
  const o = legalOptions(pref, setup);
  const res = runLegal(model, carName, start, setup, o);
  const chosen = res.launch ?? res.plain;
  return { bytes: Array.from(chosen.setupBytes), sheet: formatSheet(`${carName}, ${SETUP_NAMES[setup]} setup, event ${o.objective}`, res) };
}

/**
 * Without a save the game's sliders stand where the owner left them, so every screen the plan uses starts with key C.
 * This is the setup after key C on every row (byte 100, or the box end where the parts leave no room for the default).
 */
export function startAfterC(model: DynoModel): Uint8Array {
  let s: Uint8Array = new Uint8Array(SETUP_SIZE).fill(100);
  for (const param of ROW_ORDER) if (param !== 16 && rowInfo(model, s, param)) s = Uint8Array.from(resetRow(model, s, param).setup);
  return s;
}

/** One tab's result: mode B (`optimum`) and mode A (`plan`). */
export interface TabResult {
  setup: number;
  start: Uint8Array;
  optimum: Uint8Array;
  plan: HandInputPlan;
  legalSheet: string;
  handSheet: string;
}

export function planTab(model: DynoModel, setup: number, start: Uint8Array, optimum: Uint8Array, pref: Preference, legalSheet = ''): TabResult {
  const plan = planHandInput(model, start, optimum, setup, legalOptions(pref, setup).objective);
  return { setup, start, optimum, plan, legalSheet, handSheet: formatHandPlan(plan, setup) };
}

/** Tabs whose start, keys and result are the same share one card. */
export function groupTabs(results: TabResult[]): TabResult[][] {
  const groups = new Map<string, TabResult[]>();
  for (const r of results) {
    const key = [r.start, r.plan.setup, r.optimum].map((b) => Array.from(b).join(',')).join('|');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()];
}

/** Plans in the order of the game's menu. Inside one screen the planned order stays (a gear key pushes its neighbours). */
export function menuOrder(plans: SliderPlan[]): SliderPlan[] {
  const rank = (p: SliderPlan): number => SCREEN_ORDER.indexOf(p.screen);
  return plans.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

/** One thing to do in the game. Curves carry their presses per bar for the chart. */
export interface TunerStep {
  screen: string;
  row: string;
  keys: string;
  shows: string;
  presses: number;
  curve?: 'ecu' | 'turbo';
  passes?: number[][];
}

const runText = (runs: number[]): string => runs.map((n) => `${n > 0 ? 'RIGHT' : 'LEFT'} ×${Math.abs(n)}`).join(', then ');

/**
 * The steps of a plan, screen by screen in menu order.
 * @param fromC No save: every row starts with key C (the plan starts from {@link startAfterC}), and rows the optimizer may change
 *   but the plan leaves alone still get a C, so the game holds the planned value.
 */
export function tunerSteps(model: DynoModel, r: TabResult, fromC: boolean): TunerStep[] {
  const steps: TunerStep[] = [];
  const touched = new Set<string>();
  for (const p of menuOrder(r.plan.plans)) {
    if (p.id === 'ecu' || p.id === 'turbo') {
      touched.add(p.id);
      steps.push({ screen: p.screen, row: 'Bars', keys: 'C, then the presses under each bar, left to right', shows: '', presses: p.presses, curve: p.id, passes: p.passes });
      continue;
    }
    const param = p.row?.param ?? 9;
    touched.add(String(param));
    const runs = p.passes.map((x) => x[0]).filter(Boolean);
    const c = p.start === 'C' || fromC;
    const keys = [c ? 'C' : '', runs.length ? runText(runs) : ''].filter(Boolean).join(', then ') || 'no key';
    steps.push({ screen: p.screen, row: p.row?.label ?? 'Final Drive Ratio', keys, shows: shownText(model, p.setup, param), presses: p.presses + (c && p.start !== 'C' ? 1 : 0) });
  }
  if (fromC) {
    // rows Optimize can move (gears, final drive) and curves: a C makes the game hold the start the plan assumed
    const extra: TunerStep[] = [];
    for (const param of model.gearingParameters) {
      if (touched.has(String(param)) || !rowInfo(model, r.start, param)) continue;
      const label = param === 9 ? 'Final Drive Ratio' : `${['1st', '2nd', '3rd', '4th', '5th', '6th'][param - 10]} Gear (km/h)`;
      extra.push({ screen: 'Drivetrain', row: label, keys: 'C', shows: shownText(model, r.plan.setup, param), presses: 1 });
    }
    for (const kind of ['ecu', 'turbo'] as const) {
      if (!touched.has(kind) && model.curve(r.start, kind)) extra.push({ screen: kind === 'ecu' ? 'ECU' : 'Turbo', row: 'Bars', keys: 'C', shows: '', presses: 1 });
    }
    // the plain C rows come first on their screen: the plan starts from every row after C
    const all = [...extra, ...steps];
    return all.map((s, i) => ({ s, i })).sort((a, b) => SCREEN_ORDER.indexOf(a.s.screen) - SCREEN_ORDER.indexOf(b.s.screen) || a.i - b.i)
      .map((x) => x.s);
  }
  return steps;
}

export { SETUP_COUNT, SETUP_NAMES };
