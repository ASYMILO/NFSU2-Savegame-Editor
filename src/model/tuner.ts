/**
 * The "Tuner" screen: one Optimize for all five dyno tabs of the game. Pure functions on top of the optimizer (legal-opt.ts,
 * mode B) and the key planner (hand-input.ts, mode A); neither is changed here. The page runs {@link optimizeTab} in web
 * workers (src/tuner-worker.ts) because one tab takes about 20 s.
 */
import { DynoModel, SETUP_COUNT, SETUP_NAMES, SETUP_SIZE, setSetupTuning, type GameData } from './dyno.js';
import { PERF_PARTS } from '../data/perf-parts.js';
import { formatSheet, gameNumbers, OBJ_BY_SETUP, runLegal, type GameNumbers } from './legal-opt.js';
import { formatHandPlan, planHandInput, ROW_ORDER, shownText, type HandInputPlan, type SliderPlan } from './hand-input.js';
import { resetRow, rowInfo } from './tune-keys.js';

/**
 * The goal of one tab. Each choice maps to an objective that already exists in legal-opt.ts; no new weights. 'accel' is the
 * Street X goal and 'top' the URL goal, so on those two tabs one of them is the tab's own goal and is not offered twice.
 * (A former "strong pull from a stop" choice kept 90 % of the factory pull, a number of our own; it moved the 3000GT by
 * 0.06 s at most and was dropped in round 3g, port docs/tuner-round3.md 3g.)
 */
export type Preference = 'race' | 'accel' | 'top';
export const PREFERENCES: { key: Preference; label: string }[] = [
  { key: 'race', label: 'As this race needs' },
  { key: 'accel', label: 'Quicker acceleration' },
  { key: 'top', label: 'Higher top speed' },
];

/** The goals a tab offers: its own, then the others that give another objective. */
export function goalChoices(setup: number): { key: Preference; label: string; text: string }[] {
  const own = OBJ_BY_SETUP[setup];
  return PREFERENCES.filter((p) => p.key === 'race' || legalOptions(p.key, setup).objective !== own)
    .map((p) => ({ ...p, text: GOAL_WORDS[legalOptions(p.key, setup).objective] ?? '' }));
}

/**
 * What "best" means for each goal, in plain words. These are the optimizer's own weights (legal-opt.ts OBJECTIVES l.11-17):
 * our choice, not taken from the game; the game has no score for a setup. Power has a tiny weight there (only to break ties).
 */
export const GOAL_WORDS: Record<string, string> = {
  circuit: 'short 0-60 and 0-100 times, plus some top speed',
  drag: 'the shortest quarter mile',
  drift: 'quick 0-60 and strong pull in the middle revs',
  streetx: 'quick 0-60 and 0-100',
  url: 'top speed most, plus 0-60 and 0-100',
};

/** Objective and launch rule of a tab for a preference (`launchMin` is the editor's old "Protect launch" value). */
export function legalOptions(pref: Preference, setup: number): { objective: string; launchMin: number | null } {
  if (pref === 'accel') return { objective: 'streetx', launchMin: null };
  if (pref === 'top') return { objective: 'url', launchMin: null };
  return { objective: OBJ_BY_SETUP[setup], launchMin: null };
}

/**
 * The tabs' captions on the game's Performance Tuning screen, left to right = setup 0..4 (seen in game:
 * native/runs/dyno_check_20261106/s4/*_setting_N.png of the tuner repo; RIGHT x N opens setup N, docs/dyno-check-3000gt.md l.57).
 */
export const TAB_NAMES = ['Circuit', 'Drag', 'Drift', 'Street X', 'URL Race'];

/**
 * Which races load which tab. Source: docs/setup-bytes.md l.89-103 of the tuner repo (game code) and its in-game check
 * l.166-174 (career URL loads the Circuit tab). `short` goes under the tab's name.
 */
export const TAB_USES: { short: string; career: string; quick: string }[] = [
  { short: 'Circuit, Sprint, career URL', career: 'Circuit, Sprint, URL', quick: 'Circuit, Sprint (also free roam)' },
  { short: 'career and Quick Race', career: 'Drag', quick: 'Drag' },
  { short: 'career and Quick Race', career: 'Drift', quick: 'Drift' },
  { short: 'career and Quick Race', career: 'Street X', quick: 'Street X' },
  { short: 'Quick Race URL only', career: 'not used (career URL races use the Circuit tab)', quick: 'URL' },
];

/**
 * The screens of the game's Performance Tuning menu in its order (code: item index 0..6, docs/native-menu-map.md
 * l.164-170; seen in game: native/runs/tune_screens_20261106/*_master_*.png) and the tuning params each one shows
 * (docs/setup-bytes.md l.17-40; ECU = 23, Turbo = 24).
 */
export const SCREENS: { name: string; params: number[] }[] = [
  { name: 'Suspension', params: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  { name: 'Drivetrain', params: [9, 10, 11, 12, 13, 14, 15] },
  { name: 'Aerodynamics', params: [21, 22] },
  { name: 'Tires & Brakes', params: [18, 19, 20] },
  { name: 'ECU', params: [23] },
  { name: 'Turbo', params: [24] },
  { name: 'Nitrous', params: [16, 17] },
];
export const SCREEN_ORDER = SCREENS.map((s) => s.name);

const LEVEL_NAMES = ['', 'Street', 'Pro', 'Extreme'];

/**
 * The parts that open a screen in the game: a param is tunable when an installed part has a tuning record for it
 * (docs/setup-bytes.md l.42, `FUN_0059ae40`). Per param the lowest level, as "Part name (Street)".
 */
export function unlockParts(game: GameData, params: number[]): string[] {
  const out: string[] = [];
  for (const { item, level } of unlockItems(game, params)) {
    const p = PERF_PARTS[item];
    // aero: the game takes the body part's level, not a shop item (docs/native-menu-map.md "Locked screens", tuner repo)
    const text = p.category === 'AE' ? `a body-shop ${p.label.replace(/ L\d$/, '').toLowerCase()} (not stock)` : `${p.label} (${LEVEL_NAMES[level] ?? `level ${level}`})`;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/** The parts (PERF_PARTS index and level) that open these params, the lowest level per param. */
export function unlockItems(game: GameData, params: number[]): { item: number; level: number }[] {
  const out: { item: number; level: number }[] = [];
  for (const param of params) {
    const recs = game.tuning.filter((t) => t.param === param && PERF_PARTS[t.item]);
    if (!recs.length) continue;
    const low = Math.min(...recs.map((t) => t.level));
    for (const t of recs.filter((x) => x.level === low)) if (!out.some((o) => o.item === t.item)) out.push({ item: t.item, level: t.level });
  }
  return out;
}

/**
 * What-if for a locked engine screen (ECU, Turbo, Drivetrain): the dyno with the first part that opens it added, both cars at
 * the factory setting (after Reset), so the part's own effect shows, not a tune. Cheap: two dyno runs, no Optimize.
 * @returns null when no part opens the screen or the car with it cannot be built.
 */
export function lockedWhatIf(model: DynoModel, installed: boolean[], uniques: number[], screen: string):
  { part: string; now: GameNumbers; withPart: GameNumbers } | null {
  const params = SCREENS.find((s) => s.name === screen)?.params ?? [];
  const pick = unlockItems(model.game, params).find((x) => x.item < installed.length);
  if (!pick) return null;
  const on = installed.slice();
  for (const other of PERF_PARTS[pick.item].conflicts) if (other < on.length) on[other] = false;
  on[pick.item] = true;
  try {
    const other = new DynoModel(model.game, model.car, on, uniques);
    return {
      part: `${PERF_PARTS[pick.item].label} (${LEVEL_NAMES[pick.level] ?? `level ${pick.level}`})`,
      now: gameNumbers(model.evaluate(startAfterC(model))), withPart: gameNumbers(other.evaluate(startAfterC(other))),
    };
  } catch {
    return null;
  }
}

/** The screens that parts of one shop category open in the game (from the same tuning records). */
export function categoryScreens(game: GameData, category: string): string[] {
  const params = new Set(game.tuning.filter((t) => PERF_PARTS[t.item]?.category === category).map((t) => t.param));
  return SCREENS.filter((s) => s.params.some((p) => params.has(p))).map((s) => s.name);
}

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

/** What a download writes: `best` = the exact optimum (mode B); `keys` = the bytes the card's keys give in the game (mode A). */
export type SaveWhat = 'best' | 'keys';

/**
 * A copy of `save` with every tab's setup in `slot`: engine curves, gears, final drive and the driving rows (the sliders are
 * in both, `optimum` and the keys' target, see feel.ts withFeel). `keys` writes `plan.setup`, the bytes the game holds after
 * the card's presses (hand-input.ts planHandInput; the game agrees key by key, tuner repo docs/game-check-r3g.md A), so loading
 * it is the same as typing the keys. The loaded save is not changed.
 */
export function saveWithTabs(save: Uint8Array, slot: number, results: TabResult[], what: SaveWhat): Uint8Array {
  let next = save;
  for (const r of results) next = setSetupTuning(next, slot, r.setup, what === 'keys' ? r.plan.setup : r.optimum, true, true);
  return next;
}

/**
 * The best (save only) against the keys, in numbers: `diff` is keys minus best (hand-input.ts planHandInput), so a plus time
 * means the best is quicker. Below what the game's dyno screen shows (0.01 s, 0.1 km/h) counts as the same.
 */
export function gapWords(diff: HandInputPlan['diff']): string {
  const out: string[] = [];
  for (const [label, d] of [['0-60', diff.t60], ['0-100', diff.t100]] as const) {
    if (d !== null && Math.abs(d) >= 0.005) out.push(`${label} ${Math.abs(d).toFixed(2)} s ${d > 0 ? 'quicker' : 'slower'}`);
  }
  if (Math.abs(diff.topKmh) >= 0.05) out.push(`top speed ${Math.abs(diff.topKmh).toFixed(1)} km/h ${diff.topKmh < 0 ? 'higher' : 'lower'}`);
  return out.length ? out.join(', ') : 'the same';
}

/** Over all tabs: the largest time the best saves against the keys, as "0.03 s quicker (Drag, 0-100)", or '' when none. */
export function largestGap(results: TabResult[]): string {
  let best: { d: number; text: string } | null = null;
  for (const r of results) {
    for (const [label, d] of [['0-60', r.plan.diff.t60], ['0-100', r.plan.diff.t100]] as const) {
      if (d !== null && d >= 0.005 && (!best || d > best.d)) best = { d, text: `${d.toFixed(2)} s quicker (${TAB_NAMES[r.setup]}, ${label})` };
    }
  }
  return best?.text ?? '';
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
  /** Number on the screen after the keys (sliders), and before them (from the save, or after the reset). */
  shows: string;
  from?: string;
  presses: number;
  curve?: 'ecu' | 'turbo';
  passes?: number[][];
}

/** Key C on a tuning screen ("Reset to default"); it resets the selected row, or all 9 bars of a graph (native-menu-map.md l.174-181). */
export const RESET = 'C (back to default)';

/**
 * Every key on an ECU / Turbo graph for a plan's rounds: C, then bar 1 to 9 per round (UP / DOWN as planned, RIGHT to the
 * next bar). The bars are a ring: RIGHT on bar 9 picks bar 1 and LEFT on bar 1 picks bar 9 (code: FUN_00522eb0,
 * data/ghidra_decomp.c l.206897 of the tuner repo; game: native/runs/wrap_20261106, ECU and Turbo). Bar 1 is picked when
 * the screen opens and C does not move the pick (game: same runs and native/runs/locked_20261106). The keys stop after the
 * last bar with presses. Shortcut: LEFT back to a nearer bar would save at most 3 keys on the 3000GT plans; not used, so
 * the rule stays "always RIGHT".
 */
export function curveKeys(passes: number[][]): string[] {
  const keys = ['C'];
  const last = passes.length - 1;
  const end = last < 0 ? -1 : passes[last].reduce((e, n, i) => (n ? i : e), -1);
  passes.forEach((row, p) => row.forEach((n, col) => {
    for (let k = 0; k < Math.abs(n); k++) keys.push(n > 0 ? 'UP' : 'DOWN');
    if (p < last || col < end) keys.push('RIGHT');
  }));
  return keys;
}

/** "LEFT 14 times (to the end), then RIGHT 3 times": a run that stops at the end of the bar says so (the key path bounces there). */
export const runText = (runs: number[], ends: boolean[] = []): string => runs.map((n, i) =>
  `${n > 0 ? 'RIGHT' : 'LEFT'} ${Math.abs(n)} time${Math.abs(n) === 1 ? '' : 's'}${ends[i] && i < runs.length - 1 ? ' (to the end)' : ''}`).join(', then ');

/** Drivetrain rows in the screen's order: 1st..6th Gear, then Final Drive Ratio. */
const DRIVE_ROWS = [10, 11, 12, 13, 14, 15, 9];
const driveLabel = (param: number): string => (param === 9 ? 'Final Drive Ratio' : `${['1st', '2nd', '3rd', '4th', '5th', '6th'][param - 10]} Gear`);

/**
 * The steps of a plan, screen by screen in menu order.
 * @param fromC No save: every row starts with key C (the plan starts from {@link startAfterC}), and rows the optimizer may change
 *   but the plan leaves alone still get a C, so the game holds the planned value.
 */
export function tunerSteps(model: DynoModel, r: TabResult, fromC: boolean): TunerStep[] {
  const steps: TunerStep[] = [];
  const touched = new Set<string>();
  // no save: every Drivetrain row gets its C first, in one step (a gear key pushes its neighbours, and a later C on a pushed
  // row would undo that push; the plan starts from every row after C, startAfterC)
  const reset = fromC ? DRIVE_ROWS.filter((param) => model.gearingParameters.includes(param) && rowInfo(model, r.start, param)) : [];
  for (const p of menuOrder(r.plan.plans)) {
    if (p.id === 'ecu' || p.id === 'turbo') {
      touched.add(p.id);
      steps.push({ screen: p.screen, row: 'Bars', keys: `${RESET}, then the presses under each bar`, shows: '', presses: curveKeys(p.passes).length, curve: p.id, passes: p.passes });
      continue;
    }
    const param = p.row?.param ?? 9;
    touched.add(String(param));
    const runs = p.passes.map((x) => x[0]).filter(Boolean);
    const c = p.start === 'C' || (fromC && !reset.includes(param));
    const keys = [c ? RESET : '', runs.length ? runText(runs, p.row?.ends ?? p.ends) : ''].filter(Boolean).join(', then ') || 'no key';
    steps.push({
      screen: p.screen, row: p.row?.label ?? 'Final Drive Ratio', keys, shows: shownText(model, p.setup, param),
      from: shownText(model, r.start, param), presses: runs.reduce((a, n) => a + Math.abs(n), 0) + (c ? 1 : 0),
    });
  }
  if (fromC) {
    // Drivetrain rows and curves: a C makes the game hold the start the plan assumed
    const extra: TunerStep[] = [];
    if (reset.length) {
      const names = reset.map(driveLabel);
      extra.push({ screen: 'Drivetrain', row: 'Every row first', keys: `${RESET} on each row, top to bottom: ${names.join(', ')}`, shows: '', presses: reset.length });
    }
    for (const kind of ['ecu', 'turbo'] as const) {
      if (!touched.has(kind) && model.curve(r.start, kind)) extra.push({ screen: kind === 'ecu' ? 'ECU' : 'Turbo', row: 'Bars', keys: RESET, shows: '', presses: 1 });
    }
    // the plain C rows come first on their screen: the plan starts from every row after C
    const all = [...extra, ...steps];
    return all.map((s, i) => ({ s, i })).sort((a, b) => SCREEN_ORDER.indexOf(a.s.screen) - SCREEN_ORDER.indexOf(b.s.screen) || a.i - b.i)
      .map((x) => x.s);
  }
  return steps;
}

/** One screen of the game's menu on a card: what to do there, or why there is nothing to do. */
export interface ScreenPlan {
  name: string;
  /**
   * `set`: steps below; `ok`: Optimize tunes it, already right; `feel`: Optimize does not tune it, but driving sliders for it
   * are on this screen's block (moving one adds steps); `keep`: nothing changes it; `locked`: no part opens it.
   */
  state: 'set' | 'ok' | 'feel' | 'keep' | 'locked';
  text: string;
  steps: TunerStep[];
}

/**
 * Optimize changes these screens only: it searches ECU and Turbo bars, final drive and gears, and only the ones a part opens
 * (legal-opt.ts partsInfo l.62-74; dyno.ts tuningRecords). The other screens are left as they are.
 */
export const TUNED = new Set(['Drivetrain', 'ECU', 'Turbo']);

/**
 * Every screen of the menu in the game's order, with the steps of `steps` under their screen (`setups`: the card's tabs).
 * @param whatIf Extra line for a locked screen (the dyno with the part that opens it), by screen name.
 * @param feel Screens that have a driving slider for this card (feel.ts feelSliders); they are shown on the screen's block.
 */
export function screenPlans(model: DynoModel, setups: number[], steps: TunerStep[], whatIf: Record<string, string> = {},
  feel: ReadonlySet<string> = new Set()): ScreenPlan[] {
  return SCREENS.map(({ name, params }) => {
    const own = steps.filter((s) => s.screen === name);
    const tuned = TUNED.has(name);
    if (own.length) return { name, state: 'set', text: tuned ? '' : 'From your sliders below.', steps: own };
    if (!params.some((p) => model.tuningRecords.has(p))) {
      const then = tuned ? 'Then the Tuner sets it.' : 'The Tuner does not set it.';
      return { name, state: 'locked', text: `Buy ${unlockParts(model.game, params).join(' or ')} to open it. ${then}${whatIf[name] ? ` ${whatIf[name]}` : ''}`, steps: [] };
    }
    if (tuned) return { name, state: 'ok', text: 'The Tuner checked it: already right for this race.', steps: [] };
    // drift and Street X presets zero nitrous duration (docs/setup-bytes.md l.103, FUN_005b4dc0)
    if (name === 'Nitrous' && setups.every((k) => k === 2 || k === 3)) return { name, state: 'keep', text: 'This race turns nitrous off.', steps: [] };
    if (feel.has(name)) return { name, state: 'feel', text: 'Optional. Leave it, or move a slider if the car feels wrong.', steps: [] };
    return { name, state: 'keep', text: 'Leave it as it is.', steps: [] };
  });
}

export { SETUP_COUNT, SETUP_NAMES };
