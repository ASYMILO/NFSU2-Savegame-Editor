/**
 * The Tuner screen (first screen of the page): car from the loaded save or from lists, one Optimize for all five game tabs,
 * a card per tab with what to set in the game (mode A) and one line for mode B. The save editor's own state stays in
 * EditorController; this file reaches it only through {@link TunerApi}.
 */
import { DynoModel, findCar, readSlotDyno, setSetupTuning, type GameData } from '../model/dyno.js';
import { getCarTypeHash, slotState } from '../model/slots.js';
import { slotCount } from '../model/layout.js';
import { TRAFFIC_CARS } from '../data/traffic-cars.js';
import { AERO_PARTS, buildVirtualSave, installedForLevels, PART_LEVEL_CATEGORIES, withAero } from '../model/virtual-save.js';
import { gameNumbers } from '../model/legal-opt.js';
import {
  categoryScreens, groupTabs, optimizeTab, planTab, PREFERENCES, screenPlans, SETUP_COUNT, startAfterC, TAB_NAMES, TAB_USES,
  tunerSteps, type Preference, type TabResult,
} from '../model/tuner.js';
import { curveChart } from './editor-controller.js';
import type { CurveChart, EditorScope, HandRow, TunerCardView } from './editor-scope.js';

export interface TunerApi {
  /** The loaded save (null without one, or in the editor's own no-save mode). */
  save(): Uint8Array | null;
  game(): GameData | null;
  gameBytes(): Uint8Array | null;
  /** Replaces the save bytes (the editor recomputes everything that depends on them). */
  apply(next: Uint8Array, message: string): void;
}

interface Source { model: DynoModel; carName: string; hash: number; installed: boolean[]; uniques: number[]; starts: Uint8Array[]; fromC: boolean }

const WORKERS = Math.max(1, Math.min(SETUP_COUNT, (navigator.hardwareConcurrency || 2) - 1));

/** @returns `sync`, which the editor calls after the save or the game data changed. */
export function attachTuner($scope: EditorScope, api: TunerApi): () => void {
  $scope.view = 'tuner';
  $scope.tuner = {
    source: 'save', slots: [], slot: null, cars: [], carHash: 0,
    levels: [
      ...PART_LEVEL_CATEGORIES.map((c) => ({
        code: c.code, label: c.label, value: 0, hint: '',
        options: [{ value: 0, label: 'None' }, ...[1, 2, 3].filter((l) => l <= c.maxLevel).map((l) => ({ value: l, label: ['Street', 'Pro', 'Extreme'][l - 1] }))],
      })),
      ...AERO_PARTS.map((a) => ({
        code: a.code, label: a.label, value: 0, hint: '',
        options: [{ value: 0, label: 'None' }, ...[1, 2, 3].map((l) => ({ value: l, label: `Level ${l}` }))],
      })),
    ],
    pref: 'race', prefs: PREFERENCES, busy: false, progress: '', error: '', stale: false, carName: '', fromC: true,
    canWrite: false, written: false, cards: [], tabs: [], card: 0,
  };
  const t = $scope.tuner;
  let results: TabResult[] = [];
  let runToken = 0;
  /** The save bytes the cards were made from or written to; another change of the save makes the cards stale. */
  let resultSave: Uint8Array | null = null;
  let pool: Worker[] | null = null;
  let poolGame: Uint8Array | null = null;

  function refreshLists(): void {
    const game = api.game(), save = api.save();
    if (game) for (const level of t.levels) level.hint = partHint(game, level.code);
    t.cars = game ? game.cars.filter((c) => !TRAFFIC_CARS.some((x) => x.hash === c.hash)).map((c) => ({ hash: c.hash, name: c.name })) : [];
    if (!t.cars.some((c) => c.hash === t.carHash)) t.carHash = (t.cars.find((c) => c.name === '3000GT') ?? t.cars[0])?.hash ?? 0;
    t.slots = [];
    if (save) {
      for (let i = 0; i < slotCount(save); i++) {
        if (slotState(save, i) !== 'filled') continue;
        const hash = getCarTypeHash(save, i);
        if (TRAFFIC_CARS.some((x) => x.hash === hash)) continue;
        const car = game ? findCar(game, hash) : null;
        t.slots.push({ index: i, name: `Slot ${i + 1}: ${car ? car.name : 'unknown car'}` });
      }
    }
    if (!t.slots.some((s) => s.index === t.slot)) t.slot = t.slots[0]?.index ?? null;
  }

  let seen = '';
  /** Called by the editor whenever the save or the game data changes. */
  function sync(): void {
    // a new save, profile or game data: lists follow, the source switches to the save when there is one
    const now = `${api.save() ? 1 : 0}|${$scope.fileName}|${$scope.backup?.current ?? ''}|${$scope.tuning.dyno.gameName}`;
    refreshLists();
    if (now !== seen) {
      if (now.startsWith('1')) t.source = t.slots.length ? 'save' : 'list';
      seen = now;
      clear();
    } else if (t.cards.length && api.save() !== resultSave) t.stale = true;
  }

  function clear(): void {
    runToken++;
    results = [];
    t.cards = []; t.tabs = []; t.card = 0; t.busy = false; t.progress = ''; t.error = ''; t.stale = false; t.written = false;
  }

  $scope.tunerChanged = function (): void {
    if (t.busy) clear();
    else if (t.cards.length) t.stale = true;
  };

  function source(): Source | string {
    const game = api.game();
    if (!game) return 'Load the game data first (GLOBAL\\GLOBALB.BUN).';
    let sd: ReturnType<typeof readSlotDyno>, fromC: boolean;
    const save = api.save();
    if (t.source === 'save') {
      if (!save || t.slot === null) return 'Load a save and pick a car.';
      sd = readSlotDyno(save, t.slot);
      fromC = false;
    } else {
      if (!t.carHash) return 'Pick a car.';
      const levels = Object.fromEntries(t.levels.map((l) => [l.code, l.value]));
      sd = readSlotDyno(buildVirtualSave(t.carHash, withAero(installedForLevels(levels), levels)), 0);
      fromC = true;
    }
    const car = findCar(game, sd.hash);
    if (!car) return 'This car is not in the loaded game data.';
    const model = new DynoModel(game, car, sd.installed, sd.uniques);
    if (!model.ecuTunable && !model.turboTunable && !model.gearingParameters.length) {
      return `${car.name}: no ECU, Turbo or Transmission part installed, so there is nothing to tune.`;
    }
    const starts = fromC ? Array.from({ length: SETUP_COUNT }, () => startAfterC(model)) : sd.setups;
    return { model, carName: car.name, hash: sd.hash, installed: sd.installed, uniques: sd.uniques, starts, fromC };
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

  $scope.tunerOptimize = function (): void {
    if (t.busy) return;
    const src = source();
    clear();
    if (typeof src === 'string') { t.error = src; return; }
    const token = runToken, pref = t.pref as Preference;
    const save = api.save();
    t.busy = true;
    t.carName = src.carName;
    t.fromC = src.fromC;
    t.canWrite = t.source === 'save';
    let done = 0;
    t.progress = `Working on 5 tabs… 0 of 5 done. About 20 s per tab.`;
    const finish = (setup: number, out: { bytes: number[]; sheet: string } | { error: string }): void => {
      if (token !== runToken) return;
      if ('error' in out) { t.error = `${TAB_NAMES[setup]}: ${out.error}`; t.busy = false; runToken++; return; }
      results[setup] = planTab(src.model, setup, src.starts[setup], Uint8Array.from(out.bytes), pref, out.sheet);
      done++;
      t.progress = `Working on 5 tabs… ${done} of 5 done.`;
      if (done === SETUP_COUNT) {
        t.busy = false;
        t.progress = '';
        resultSave = save;
        t.cards = cards(src, results);
        // the game's five tabs in its order; tabs with the same plan open the same card
        t.tabs = TAB_NAMES.map((name, setup) => ({ name, short: TAB_USES[setup].short, card: t.cards.findIndex((c) => c.setups.includes(setup)) }));
      }
    };
    const job = (setup: number) => ({
      type: 'job', id: token * 10 + setup, hash: src.hash, installed: src.installed, uniques: src.uniques,
      start: Array.from(src.starts[setup]), setup, pref,
    });
    const onMain = (queue: number[]): void => {
      // no workers (or one failed): one tab after another on the page's thread
      const next = queue.shift();
      if (next === undefined || token !== runToken) return;
      setTimeout(() => {
        $scope.$apply(() => {
          try { finish(next, optimizeTab(src.model, src.carName, src.starts[next], next, pref)); } catch (err) { finish(next, { error: String(err) }); }
        });
        onMain(queue);
      }, 30);
    };
    const pw = workers();
    if (!pw) { onMain([0, 1, 2, 3, 4]); return; }
    const queue = [0, 1, 2, 3, 4];
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

  $scope.tunerWrite = function (card: TunerCardView): void {
    const save = api.save();
    if (!save || t.slot === null || t.source !== 'save' || t.stale) return;
    let next = save;
    for (const setup of card.setups) next = setSetupTuning(next, t.slot, setup, results[setup].optimum, true, true);
    resultSave = next;
    api.apply(next, `${card.title}: exact setup written to slot ${t.slot + 1}. Download the save to keep it.`);
    card.written = true;
    t.written = true;
  };

  /** Car record name of the chosen car (for its logo, ./game/logos/<name>.png), or '' when none. */
  $scope.tunerLogo = function (): string {
    const game = api.game(), save = api.save();
    if (!game) return '';
    const hash = t.source === 'save' ? (save && t.slot !== null ? getCarTypeHash(save, t.slot) : 0) : t.carHash;
    return (hash && findCar(game, hash)?.name) || '';
  };

  sync();
  return sync;
}

/** What a part category opens in the game, from the game's tuning records. */
function partHint(game: GameData, code: string): string {
  const aero = AERO_PARTS.find((a) => a.code === code);
  if (aero) return `Opens Aerodynamics (${code === 'AEF' ? 'front' : 'rear'} downforce) in the game.`;
  const screens = categoryScreens(game, code);
  if (!screens.length) return 'Counts on the dyno. Opens no tuning screen in the game.';
  // gears 10-15 have a record only for the 6-speed transmission (L3), final drive for every level
  const extra = code === 'TR' ? ' Gears only with Extreme (6-speed); Street and Pro: final drive.' : '';
  return `Opens ${screens.join(', ')} in the game.${extra}`;
}

const BADGES = { set: 'Change', ok: 'Leave as is', keep: 'Leave as is', locked: 'Locked' } as const;

/** The chart's presses in words ("UP 3", "DOWN 1", "–") and its rows as rounds. Order as planHandInput: bar 1 to 9, round by round. */
function pressWords(chart: CurveChart): CurveChart {
  const word = (p: string): string => (p.startsWith('▲') ? `UP ${p.slice(1)}` : p.startsWith('▼') ? `DOWN ${p.slice(1)}` : '–');
  return {
    ...chart,
    columns: chart.columns.map((c) => ({ ...c, presses: c.presses.map(word) })),
    passLabels: chart.passLabels.map((_, k) => ['1st', '2nd', '3rd'][k] ?? `${k + 1}th`),
  };
}

function cards(src: Source, results: TabResult[]): TunerCardView[] {
  const sec = (v: number | null): string => (v === null ? '–' : `${v.toFixed(2)} s`);
  const sign = (v: number | null, unit: string, digits: number): string => (v === null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(digits)} ${unit}`);
  return groupTabs(results).map((group): TunerCardView => {
    const r = group[0], { a, b, diff } = r.plan;
    const names = group.map((x) => TAB_NAMES[x.setup]);
    const now = gameNumbers(src.model.evaluate(r.start));
    const kmh = (v: number): string => `${v.toFixed(1)} km/h`, bhp = (v: number): string => `${v.toFixed(1)} bhp`;
    const steps = tunerSteps(src.model, r, src.fromC).map((s) => (s.curve && s.passes?.length
      ? { ...s, chart: pressWords(curveChart(src.model.curve(r.plan.setup, s.curve)!, 0, s.passes)) } : s));
    const table: HandRow[] = [
      { label: '0–60 mph', a: sec(a.t60), b: sec(b.t60), diff: sign(diff.t60, 's', 2), zero: diff.t60 === null || Math.abs(diff.t60) < 0.005 },
      { label: '0–100 mph', a: sec(a.t100), b: sec(b.t100), diff: sign(diff.t100, 's', 2), zero: diff.t100 === null || Math.abs(diff.t100) < 0.005 },
      { label: 'Top speed', a: `${a.topKmh.toFixed(1)} km/h`, b: `${b.topKmh.toFixed(1)} km/h`, diff: sign(diff.topKmh, 'km/h', 1), zero: Math.abs(diff.topKmh) < 0.05 },
      { label: 'Power', a: `${a.powerBhp.toFixed(1)} bhp`, b: `${b.powerBhp.toFixed(1)} bhp`, diff: sign(diff.powerBhp, 'bhp', 1), zero: Math.abs(diff.powerBhp) < 0.05 },
    ];
    const same = table.every((row) => row.zero);
    return {
      setups: group.map((x) => x.setup),
      title: names.join(' + '),
      uses: group.map((x) => ({ tab: TAB_NAMES[x.setup], career: TAB_USES[x.setup].career, quick: TAB_USES[x.setup].quick })),
      nowLabel: src.fromC ? 'After reset' : 'Now (save)',
      compare: [
        { label: '0–60 mph', now: sec(now.t60), after: sec(a.t60) },
        { label: '0–100 mph', now: sec(now.t100), after: sec(a.t100) },
        { label: 'Top speed', now: kmh(now.topKmh), after: kmh(a.topKmh) },
        { label: 'Power', now: bhp(now.powerBhp), after: bhp(a.powerBhp) },
      ],
      bLine: same ? 'Writing to the save gives the same numbers.'
        : `Writing to the save would give ${table.map((row) => row.b).join(' · ')} (by hand minus save: ${table.map((row) => row.diff).join(' · ')}).`,
      presses: r.plan.presses,
      screens: screenPlans(src.model, group.map((x) => x.setup), steps).map((x) => ({ ...x, badge: BADGES[x.state] })),
      note: group.some((x) => x.setup === 1) ? 'In Drag races you shift by hand. The dyno shifts by itself.' : '',
      table,
      sheet: `${r.handSheet}\n\n${r.legalSheet}`,
      written: false,
    };
  });
}
