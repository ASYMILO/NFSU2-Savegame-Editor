/**
 * The Tuner screen (first screen of the page). Steps open one by one: game data, then the car (from the save or from lists),
 * then "Your car now", Optimize for all five game tabs, a card per tab with what to set in the game (mode A), preferences
 * after the result, and at the end the download of the changed save (mode B, only with a save). A loaded save is only read:
 * the download is a changed copy. The save editor's own state stays in EditorController; this file reaches it only
 * through {@link TunerApi}.
 */
import { DynoModel, findCar, readSlotDyno, type GameData } from '../model/dyno.js';
import { getCarTypeHash, slotState } from '../model/slots.js';
import { slotCount } from '../model/layout.js';
import { TRAFFIC_CARS } from '../data/traffic-cars.js';
import { carName } from '../data/car-names.js';
import { AERO_PARTS, buildVirtualSave, installedForLevels, levelsOf, PART_LEVEL_CATEGORIES, withAero } from '../model/virtual-save.js';
import { gameNumbers, type GameNumbers } from '../model/legal-opt.js';
import { ROW_LABELS, ROW_ORDER, shownText } from '../model/hand-input.js';
import { NitroScreen, rowInfo } from '../model/tune-keys.js';
import { FEEL_SLIDERS, feelSliders, withFeel, type Feel } from '../model/feel.js';
import { clearPrefs, loadPrefs, savePrefs } from './browser-store.js';
import {
  categoryScreens, gapWords, GOAL_WORDS, goalChoices, groupTabs, largestGap, legalOptions, lockedWhatIf, optimizeTab, planTab, PREFERENCES, saveWithTabs, SCREENS, screenPlans, SETUP_COUNT, startAfterC,
  TAB_NAMES, TAB_USES, TUNED, tunerSteps, type Preference, type TabResult,
} from '../model/tuner.js';
import { curveChart } from './editor-controller.js';
import type { CurveChart, EditorScope, HandRow, TunerCardView, TunerNowView } from './editor-scope.js';

export interface TunerApi {
  /** The loaded save (null without one, or in the editor's own no-save mode). */
  save(): Uint8Array | null;
  game(): GameData | null;
  gameBytes(): Uint8Array | null;
  /** Downloads these save bytes in place of the loaded one (the editor's own state is not changed). */
  download(next: Uint8Array): void;
}

interface Car { model: DynoModel; carName: string; hash: number; installed: boolean[]; uniques: number[]; saved: Uint8Array[] | null }
interface Source extends Car { starts: Uint8Array[]; fromC: boolean }

const WORKERS = Math.max(1, Math.min(SETUP_COUNT, (navigator.hardwareConcurrency || 2) - 1));
const LEVEL_WORDS = ['None', 'Street', 'Pro', 'Extreme'];

const sec = (v: number | null): string => (v === null ? '–' : `${v.toFixed(2)} s`);
const kmh = (v: number): string => `${v.toFixed(1)} km/h`;
// the game's dyno screen shows 0-60 / 0-100 without a unit, top speed in km/h and power in kW (tuner repo
// native/runs/dyno_check_20261106/results_A_all.png, docs/dyno-check-3000gt.md), so the Tuner shows the same; the 0-60 and
// 0-100 are mph (the dyno stops its clocks at 60 and 100 mph, FUN_005b06a0, dyno.ts dragSim `60 <= v * mph`), so the labels say so
const kw = (v: number): string => `${v.toFixed(1)} kW`;

/** @returns `sync`, which the editor calls after the save or the game data changed. */
export function attachTuner($scope: EditorScope, api: TunerApi): () => void {
  // the author's save editor is the start page; the Tuner opens from a car slot (or, less visible, without a save)
  $scope.view = 'editor';
  $scope.tuner = {
    source: '', how: 'save', slots: [], slot: null, cars: [], carHash: 0,
    levels: [
      ...PART_LEVEL_CATEGORIES.map((c) => ({
        code: c.code, label: c.label, value: 0, hint: '',
        options: [{ value: 0, label: 'None' }, ...[1, 2, 3].filter((l) => l <= c.maxLevel).map((l) => ({ value: l, label: LEVEL_WORDS[l] }))],
      })),
      ...AERO_PARTS.map((a) => ({
        code: a.code, label: a.label, value: 0, hint: '',
        options: [{ value: 0, label: 'None' }, ...[1, 2, 3].map((l) => ({ value: l, label: `Level ${l}` }))],
      })),
    ],
    now: null, busy: false, progress: '', done: 0, seconds: 0, error: '', stale: false, carName: '', fromC: true,
    canDownload: false, gap: '', cards: [], tabs: [], card: 0, feel: {}, sliders: [],
  };
  const t = $scope.tuner;
  /** Optimize's result per tab (engine rows), the slider positions per tab, and the plans made from both. */
  let base: Uint8Array[] = [];
  // the choices kept in this browser (browser-store.ts): goal and slider positions per tab, and A or B
  const goalKeys = PREFERENCES.map((p) => p.key), feelKeys = FEEL_SLIDERS.map((f) => f.key);
  const kept = (): { how: 'save' | 'hand'; goals: Preference[]; feels: Feel[] } => {
    const p = loadPrefs(goalKeys, feelKeys);
    return { how: p?.how ?? 'save', goals: (p?.goals ?? new Array(SETUP_COUNT).fill('race')) as Preference[], feels: p?.feels ?? [] };
  };
  let goals = kept().goals;
  let feels: Feel[] = kept().feels;
  const keep = (): void => savePrefs({ how: t.source === 'save' ? t.how : kept().how, goals, feels: Array.from({ length: SETUP_COUNT }, (_, k) => feels[k] ?? {}) });
  let results: TabResult[] = [];
  let src: Source | null = null;
  let runToken = 0;
  /** The save bytes the cards were made from; another change of the save makes the cards stale. */
  let resultSave: Uint8Array | null = null;
  let pool: Worker[] | null = null;
  let poolGame: Uint8Array | null = null;
  /** Optimize's result per car, start, tab and goal: the same question again (e.g. a goal changed back) is instant. */
  const cache = new Map<string, { bytes: number[]; sheet: string }>();
  let clock: ReturnType<typeof setInterval> | null = null;

  function refreshLists(): void {
    const game = api.game(), save = api.save();
    if (game) for (const level of t.levels) level.hint = partHint(game, level.code);
    t.cars = game ? game.cars.filter((c) => !TRAFFIC_CARS.some((x) => x.hash === c.hash)).map((c) => ({ hash: c.hash, name: carName(c.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)) : [];
    // no default car: the list starts empty, the user picks
    if (!t.cars.some((c) => c.hash === t.carHash)) t.carHash = 0;
    t.slots = [];
    if (save) {
      for (let i = 0; i < slotCount(save); i++) {
        if (slotState(save, i) !== 'filled') continue;
        const hash = getCarTypeHash(save, i);
        if (TRAFFIC_CARS.some((x) => x.hash === hash)) continue;
        const car = game ? findCar(game, hash) : null;
        t.slots.push({ index: i, name: `Slot ${i + 1}: ${car ? carName(car.name) : 'unknown car'}` });
      }
    }
    // a save with one car: that car; with more: the user picks
    if (!t.slots.some((s) => s.index === t.slot)) t.slot = t.slots.length === 1 ? t.slots[0].index : null;
  }

  let seen = '';
  /** Called by the editor whenever the save or the game data changes. */
  function sync(): void {
    const now = `${api.save() ? 1 : 0}|${$scope.fileName}|${$scope.backup?.current ?? ''}|${$scope.tuning.dyno.gameName}`;
    refreshLists();
    if (now !== seen) {
      // a new save: the car comes from it; no save: pick from the lists (by hand is the default way, it needs no save)
      if (now.startsWith('1')) t.source = 'save';
      else if (!t.source) t.source = 'list';
      if (t.source === 'list') t.how = 'hand';
      seen = now;
      clear(true);
      refreshNow();
    } else if (t.cards.length && api.save() !== resultSave) t.stale = true;
  }

  function stopClock(): void {
    if (clock) clearInterval(clock);
    clock = null;
  }

  /** @param keepView keep the cards on show while Optimize runs again (a goal change): the page does not jump. */
  function clear(dropFeel: boolean, keepView = false): void {
    runToken++;
    stopClock();
    t.busy = false; t.progress = ''; t.error = ''; t.done = 0;
    if (keepView) return;
    results = [];
    base = [];
    if (dropFeel) feels = kept().feels;
    t.cards = []; t.tabs = []; t.card = 0; t.stale = false; t.sliders = []; t.feel = {}; t.gap = '';
  }

  /** The chosen car, or why there is none yet ('' = nothing chosen). */
  function car(): Car | string {
    const game = api.game();
    if (!game) return '';
    let sd: ReturnType<typeof readSlotDyno>, saved: Uint8Array[] | null;
    const save = api.save();
    if (t.source === 'save') {
      if (save && !t.slots.length) return $scope.backup ? 'This profile has no cars. Pick another profile above.' : 'This save has no cars.';
      if (!save || t.slot === null) return '';
      sd = readSlotDyno(save, t.slot);
      saved = sd.setups;
    } else if (t.source === 'list') {
      if (!t.carHash) return '';
      const levels = Object.fromEntries(t.levels.map((l) => [l.code, l.value]));
      sd = readSlotDyno(buildVirtualSave(t.carHash, withAero(installedForLevels(levels), levels)), 0);
      saved = null;
    } else return '';
    const record = findCar(game, sd.hash);
    if (!record) return 'This car is not in the loaded game data.';
    return { model: new DynoModel(game, record, sd.installed, sd.uniques), carName: carName(record.name), hash: sd.hash, installed: sd.installed, uniques: sd.uniques, saved };
  }

  /** "Your car now": parts, dyno and slider values as they are (save) or at the factory setting (no save). */
  function refreshNow(): void {
    const c = car();
    if (typeof c === 'string') { t.now = null; t.error = c; return; }
    t.error = '';
    const { model } = c;
    const levels = levelsOf(c.installed);
    const parts = t.levels.filter((l) => levels[l.code]).map((l) => ({ label: l.label, level: l.options.find((o) => o.value === levels[l.code])?.label ?? `Level ${levels[l.code]}` }));
    const setups = c.saved ?? [startAfterC(model)];
    const columns = c.saved ? TAB_NAMES : ['Factory setting'];
    const dyno = setups.map((s, k) => {
      const g = gameNumbers(model.evaluate(s));
      return { tab: columns[k], t60: sec(g.t60), t100: sec(g.t100), top: kmh(g.topKmh), power: kw(g.powerKw) };
    });
    const settings: TunerNowView['settings'] = [];
    for (const name of SCREENS.map((s) => s.name)) {
      for (const param of ROW_ORDER) {
        const [screen, row] = ROW_LABELS[param];
        if (screen !== name) continue;
        if (param === 16 ? !NitroScreen.open(model, setups[0]) : !rowInfo(model, setups[0], param)) continue;
        settings.push({ screen, row, values: setups.map((s) => shownText(model, s, param)) });
      }
    }
    const tunable = model.ecuTunable || model.turboTunable || model.gearingParameters.length > 0;
    t.now = {
      carName: c.carName, parts, missing: t.levels.filter((l) => !levels[l.code]).map((l) => l.label), dyno, columns, settings,
      problem: tunable ? '' : c.saved ? 'This car has no ECU, Turbo or Transmission part yet. Buy one in the game first: only those can be tuned for speed.'
        : 'Pick the parts your car has (below). At least an ECU, Turbo or Transmission part is needed: only those can be tuned for speed.',
    };
  }

  /** From a car slot of the save editor: the Tuner with that save and car. */
  $scope.openTuner = function (slot: number): void {
    t.source = 'save';
    t.how = kept().how;
    refreshLists();
    t.slot = t.slots.some((s) => s.index === slot) ? slot : null;
    $scope.view = 'tuner';
    $scope.tunerChanged();
  };

  /** The add-on: the Tuner with a car and parts from lists, no save; the result can only be set by hand. */
  $scope.tunerWithoutSave = function (): void {
    t.source = 'list';
    t.how = 'hand';
    $scope.view = 'tuner';
    $scope.tunerChanged();
  };

  $scope.tunerBack = function (): void {
    $scope.view = 'editor';
  };

  $scope.tunerChanged = function (): void {
    // another car or other parts: the old result does not fit any more
    clear(true);
    refreshNow();
  };

  function source(): Source | string {
    const c = car();
    if (typeof c === 'string') return c || 'Pick a car first.';
    if (t.now?.problem) return t.now.problem;
    const fromC = c.saved === null;
    const starts = fromC ? Array.from({ length: SETUP_COUNT }, () => startAfterC(c.model)) : c.saved!;
    return { ...c, starts, fromC };
  }

  function workers(): Worker[] | null {
    const bytes = api.gameBytes();
    if (typeof Worker === 'undefined' || !bytes) return null;
    if (pool && poolGame === bytes) return pool;
    pool?.forEach((w) => w.terminate());
    try {
      pool = Array.from({ length: WORKERS }, () => new Worker('./tuner-worker.js', { type: 'module' }));
    } catch {
      pool = null;
      return null;
    }
    poolGame = bytes;
    for (const w of pool) w.postMessage({ type: 'game', bytes });
    return pool;
  }

  /** Plan of one tab from Optimize's result and the tab's sliders (they change only rows Optimize leaves alone). */
  function plan(s: Source, setup: number, sheet: string): TabResult {
    const target = withFeel(s.model, s.starts[setup], base[setup], feels[setup] ?? {});
    return planTab(s.model, setup, s.starts[setup], target, goals[setup], sheet);
  }

  function show(keepCard: number): void {
    if (!src) return;
    t.cards = cards(src, results, goals);
    t.gap = largestGap(results);
    // the game's five tabs in its order; tabs with the same plan open the same card
    t.tabs = TAB_NAMES.map((name, setup) => ({ name, short: TAB_USES[setup].short, card: t.cards.findIndex((c) => c.setups.includes(setup)) }));
    $scope.tunerTab(Math.min(keepCard, t.cards.length - 1));
  }

  $scope.tunerTab = function (card: number): void {
    t.card = card;
    const view = t.cards[card];
    if (!view || !src) { t.sliders = []; t.feel = {}; return; }
    const first = view.setups[0];
    feels[first] = feels[first] ?? {};
    t.feel = feels[first];
    t.sliders = feelSliders(src.model, src.starts[first], view.setups)
      .map(({ key, screen, label, low, high, basis, when, min, max, limit }) => ({ key, screen, label, low, high, basis, when, min, max, limit }));
    // a range input with no value sits in the middle of its box; 0 (= as now) is the left or right end on a one-sided slider
    for (const sl of t.sliders) t.feel[sl.key] = t.feel[sl.key] ?? 0;
  };

  $scope.tunerFeel = function (): void {
    if (!src || !results.length || t.busy) return;
    const view = t.cards[t.card];
    if (!view) return;
    for (const setup of view.setups) {
      feels[setup] = { ...t.feel };
      results[setup] = plan(src, setup, results[setup].legalSheet);
    }
    keep();
    show(t.card);
  };

  $scope.tunerGoal = function (key: string): void {
    // another goal for this card's tabs: Optimize again (the other tabs come from the cache), the sliders stay, the cards
    // stay on show until the new ones are ready
    const view = t.cards[t.card];
    if (!view || t.busy || !goalKeys.includes(key as Preference)) return;
    for (const setup of view.setups) goals[setup] = key as Preference;
    keep();
    $scope.tunerOptimize(true);
  };

  $scope.tunerForgetPrefs = function (): void {
    clearPrefs();
    goals = new Array(SETUP_COUNT).fill('race');
    feels = [];
    if (t.source === 'save') t.how = 'save';
    if (t.cards.length && !t.busy) $scope.tunerOptimize(true);
  };

  $scope.tunerHow = function (): void { if (t.source === 'save') keep(); };

  $scope.tunerOptimize = function (keepView = false): void {
    const s = source();
    const keepCard = t.card;
    clear(false, keepView && t.cards.length > 0);
    if (typeof s === 'string') { t.error = s; return; }
    const token = runToken, pref = goals.slice();
    const save = api.save();
    const fresh: TabResult[] = [], nextBase: Uint8Array[] = [];
    const keyOf = (setup: number): string =>
      [s.hash, s.installed.map(Number).join(''), s.uniques.join(','), Array.from(s.starts[setup]).join(','), setup, pref[setup]].join('|');
    let done = 0;
    t.busy = true;
    t.seconds = 0;
    const t0 = Date.now();
    clock = setInterval(() => $scope.$evalAsync(() => { if (token === runToken) t.seconds = Math.round((Date.now() - t0) / 1000); }), 1000);
    const finish = (setup: number, out: { bytes: number[]; sheet: string } | { error: string }): void => {
      if (token !== runToken) return;
      if ('error' in out) { t.error = `${TAB_NAMES[setup]}: ${out.error}`; t.busy = false; stopClock(); runToken++; return; }
      cache.set(keyOf(setup), out);
      nextBase[setup] = Uint8Array.from(out.bytes);
      fresh[setup] = planTab(s.model, setup, s.starts[setup], withFeel(s.model, s.starts[setup], nextBase[setup], feels[setup] ?? {}), pref[setup], out.sheet);
      done++;
      t.done = done;
      if (done === SETUP_COUNT) {
        t.busy = false;
        stopClock();
        src = s;
        base = nextBase;
        results = fresh;
        t.carName = s.carName;
        t.fromC = s.fromC;
        t.canDownload = !s.fromC && save !== null;
        t.stale = false;
        resultSave = save;
        show(keepCard);
      }
    };
    // tabs already worked out for this car, start and goal need no new run
    const todo = [0, 1, 2, 3, 4].filter((setup) => {
      const hit = cache.get(keyOf(setup));
      if (hit) finish(setup, hit);
      return !hit;
    });
    if (!todo.length) return;
    const job = (setup: number) => ({
      type: 'job', id: token * 10 + setup, hash: s.hash, installed: s.installed, uniques: s.uniques,
      start: Array.from(s.starts[setup]), setup, pref: pref[setup],
    });
    const onMain = (queue: number[]): void => {
      // no workers (or one failed): one tab after another on the page's thread
      const next = queue.shift();
      if (next === undefined || token !== runToken) return;
      setTimeout(() => {
        $scope.$apply(() => {
          try { finish(next, optimizeTab(s.model, s.carName, s.starts[next], next, pref[next])); } catch (err) { finish(next, { error: String(err) }); }
        });
        onMain(queue);
      }, 30);
    };
    const pw = workers();
    if (!pw) { onMain(todo.slice()); return; }
    const queue = todo.slice();
    const failed: number[] = [];
    pw.forEach((w) => {
      const run = (): void => {
        const setup = queue.shift();
        if (setup === undefined) return;
        w.onmessage = (ev: MessageEvent<{ id: number; bytes: number[]; sheet: string } | { id: number; error: string }>) => {
          if (ev.data.id !== token * 10 + setup) return;
          $scope.$evalAsync(() => finish(setup, ev.data));
          run();
        };
        w.onerror = (ev) => {
          ev.preventDefault();
          failed.push(setup, ...queue.splice(0));
          $scope.$evalAsync(() => onMain(failed.splice(0)));
        };
        w.postMessage(job(setup));
      };
      run();
    });
  };

  /**
   * A copy of the save with all five tabs (sliders included): the best (mode B) or the same bytes as the card's keys (mode A).
   * The loaded save stays as it is.
   */
  $scope.tunerDownload = function (): void {
    const save = api.save();
    if (!save || t.slot === null || t.source !== 'save' || t.stale || results.length !== SETUP_COUNT) return;
    api.download(saveWithTabs(save, t.slot, results, t.how === 'hand' ? 'keys' : 'best'));
  };

  /** Car record name of the chosen car (for its logo, ./game/logos/<name>.png), or '' when none. */
  $scope.tunerLogo = function (): string {
    const game = api.game(), save = api.save();
    if (!game) return '';
    const hash = t.source === 'save' ? (save && t.slot !== null ? getCarTypeHash(save, t.slot) : 0) : t.source === 'list' ? t.carHash : 0;
    return (hash && findCar(game, hash)?.name) || '';
  };

  sync();
  return sync;
}

/** What a part category opens in the game, from the game's tuning records. */
function partHint(game: GameData, code: string): string {
  const aero = AERO_PARTS.find((a) => a.code === code);
  // game: a stock front bumper and spoiler lock Aerodynamics even with the save's aero flags set; rear bumper and side
  // skirts at level 2 do not open it (tuner repo native/runs/locked_20261106, docs/native-menu-map.md "Locked screens")
  if (aero) return `A body-shop ${code === 'AEF' ? 'front bumper' : 'spoiler'} opens Aerodynamics (${code === 'AEF' ? 'front' : 'rear'} downforce). A stock one does not.`;
  const screens = categoryScreens(game, code);
  if (!screens.length) return 'Counts on the dyno. Opens no tuning screen.';
  const tuned = screens.some((s) => TUNED.has(s)) ? 'The Tuner sets it.' : 'The Tuner does not set it.';
  // gears 10-15 have a record only for the 6-speed transmission (L3), final drive for every level
  const extra = code === 'TR' ? ' Gears only with Extreme (6-speed).' : '';
  return `Opens ${screens.join(', ')}. ${tuned}${extra} A higher level gives a wider range.`;
}

const BADGES = { set: 'To do', ok: 'Already right', feel: 'Your choice', keep: 'Leave as is', locked: 'Needs a part' } as const;

/** The chart's presses in words ("UP 3", "DOWN 1", "–") and its rows as rounds. Order as planHandInput: bar 1 to 9, round by round. */
function pressWords(chart: CurveChart): CurveChart {
  const word = (p: string): string => (p.startsWith('▲') ? `UP ${p.slice(1)}` : p.startsWith('▼') ? `DOWN ${p.slice(1)}` : '–');
  return {
    ...chart,
    columns: chart.columns.map((c) => ({ ...c, presses: c.presses.map(word) })),
    passLabels: chart.passLabels.map((_, k) => `${['1st', '2nd', '3rd'][k] ?? `${k + 1}th`} time`),
  };
}

/** "With FPR (Street): 0–60 4.10 s, top 300.0 km/h (now at factory setting: 4.30 s, 290.0 km/h)." for locked engine screens. */
function whatIfLines(src: Source): Record<string, string> {
  const out: Record<string, string> = {};
  for (const screen of TUNED) {
    if (SCREENS.find((s) => s.name === screen)!.params.some((p) => src.model.tuningRecords.has(p))) continue;
    const w = lockedWhatIf(src.model, src.installed, src.uniques, screen);
    if (!w) continue;
    const g = (n: GameNumbers): string => `0–60 ${sec(n.t60)}, top ${kmh(n.topKmh)}`;
    out[screen] = `With ${w.part}, before any tuning: ${g(w.withPart)} (now, factory setting: ${g(w.now)}).`;
  }
  return out;
}

function cards(src: Source, results: TabResult[], goals: Preference[]): TunerCardView[] {
  const sign = (v: number | null, unit: string, digits: number): string => (v === null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(digits)} ${unit}`);
  const whatIf = whatIfLines(src);
  return groupTabs(results).map((group): TunerCardView => {
    const r = group[0], { a, b, diff } = r.plan;
    const feelScreens = new Set(feelSliders(src.model, src.starts[r.setup], group.map((x) => x.setup)).map((f) => f.screen));
    const names = group.map((x) => TAB_NAMES[x.setup]);
    const now = gameNumbers(src.model.evaluate(r.start));
    const steps = tunerSteps(src.model, r, src.fromC).map((s) => (s.curve && s.passes?.length
      ? { ...s, chart: pressWords(curveChart(src.model.curve(r.plan.setup, s.curve)!, 0, s.passes)) } : s));
    // "gap" = by hand minus the save, so a minus time or a plus speed means "by hand is better"
    const dkw = a.powerKw - b.powerKw;
    const table: HandRow[] = [
      { label: '0-60 mph', a: sec(a.t60), b: sec(b.t60), diff: sign(diff.t60, 's', 2), zero: diff.t60 === null || Math.abs(diff.t60) < 0.005 },
      { label: '0-100 mph', a: sec(a.t100), b: sec(b.t100), diff: sign(diff.t100, 's', 2), zero: diff.t100 === null || Math.abs(diff.t100) < 0.005 },
      { label: 'Top speed', a: kmh(a.topKmh), b: kmh(b.topKmh), diff: sign(diff.topKmh, 'km/h', 1), zero: Math.abs(diff.topKmh) < 0.05 },
      { label: 'Power', a: kw(a.powerKw), b: kw(b.powerKw), diff: sign(Number(dkw.toFixed(1)), 'kW', 1), zero: Math.abs(dkw) < 0.05 },
    ];
    for (const row of table) if (row.zero) row.diff = 'same';
    return {
      setups: group.map((x) => x.setup),
      title: names.join(' + '),
      uses: group.map((x) => ({ tab: TAB_NAMES[x.setup], career: TAB_USES[x.setup].career, quick: TAB_USES[x.setup].quick })),
      nowLabel: src.fromC ? 'After reset' : 'Now (save)',
      compare: [
        { label: '0-60 mph', now: sec(now.t60), after: sec(a.t60) },
        { label: '0-100 mph', now: sec(now.t100), after: sec(a.t100) },
        { label: 'Top speed', now: kmh(now.topKmh), after: kmh(a.topKmh) },
        { label: 'Power', now: kw(now.powerKw), after: kw(a.powerKw) },
      ],
      goal: GOAL_WORDS[legalOptions(goals[r.setup], r.setup).objective] ?? '',
      goals: goalChoices(r.setup),
      goalKey: goals[r.setup],
      presses: steps.reduce((n, s) => n + s.presses, 0),
      screens: screenPlans(src.model, group.map((x) => x.setup), steps, whatIf, feelScreens).map((x) => ({ ...x, badge: BADGES[x.state], hasFeel: feelScreens.has(x.name) })),
      note: group.some((x) => x.setup === 1) ? 'In Drag races you shift by hand. The dyno shifts by itself.' : '',
      table,
      gap: gapWords(diff),
      // only the by-hand list: the optimizer's own sheet has its own entry rules ("do not reset the Drivetrain"), which
      // differ from the steps above
      sheet: r.handSheet,
    };
  });
}
