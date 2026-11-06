import type { Donor } from '../model/cars.js';
import type { ChecksumStatus } from '../model/save-file.js';
import type { SlotState } from '../model/slots.js';
import type { PerfPart, UniquePerfPart } from '../data/perf-parts.js';
import type { CurveKind, DynoEvent, ScalarCategory, ScalarRow } from '../model/dyno.js';
import type { ColorPalette } from '../model/visual.js';

/** Result of a donor-list or file-load problem, shown in the status line. */
export interface Status {
  type: '' | 'success' | 'error';
  text: string;
}

/** Summary of one car slot, as the view renders it. */
export interface SlotView {
  index: number;
  used: boolean;
  locked: boolean;
  bought: boolean;
  state: SlotState;
  key: string;
  car: Donor | null;
  trafficName: string;
  perfCount: number;
  uniqueCount: number;
  unlocked: number;
}

/** One performance part row in the tuning dialog. */
export interface PartView extends PerfPart {
  on: boolean;
  offset: string;
  relativeOffset: string;
  packageLabel: string;
  purchased: boolean;
  purchaseOffset: string;
  purchaseMask: string;
}

export interface UniquePartView extends UniquePerfPart {
  on: boolean;
  value: number;
  hexValue: string;
  offset: string;
  relativeOffset: string;
}

/** One performance category in the tuning dialog. */
export interface CategoryView {
  code: string;
  label: string;
  parts: PartView[];
  onCount: number;
  activeCount: number;
  unique: UniquePartView | null;
}

/** One dyno value in metric and imperial units; `imperial` is empty for unit-free values. */
export interface DynoCell {
  metric: string;
  imperial: string;
  rpm: string;
}

/** One row of the dyno result table. */
export interface DynoRow {
  label: string;
  /** Metric equivalent of the label, e.g. `0–97 km/h`. */
  sub: string;
  before: DynoCell;
  after: DynoCell | null;
  better: boolean;
}

/** One RPM column of the ECU/turbo graph, in SVG units. */
export interface CurveColumn {
  index: number;
  x: number;
  width: number;
  /** Top and height of the allowed min–max range. */
  rangeY: number;
  rangeH: number;
  stockY: number;
  valueY: number;
  valueH: number;
  /** Value after the load's sum restore; differs from valueY only for independently set points. */
  effY: number;
  rpmLabel: string;
  /** Mode A: key presses under the bar, one entry per pass (+n UP, -n DOWN, empty = none). */
  presses: string[];
}

/** ECU or turbo graph in the dyno tab. */
export interface CurveChart {
  /** Mode A: names of the pass rows under the bars; empty without a plan. */
  passLabels: string[];
  width: number;
  height: number;
  /** Plot area. */
  left: number;
  top: number;
  bottom: number;
  /** Value in N·m at the top of the plot area. */
  yMax: number;
  ticks: { y: number; label: string }[];
  columns: CurveColumn[];
  /** Selected column details, formatted. */
  selected: {
    rpm: string; value: string; stock: string; range: string; change: string; canDown: boolean; canUp: boolean;
    /** Value in game after the sum restore, or empty when it equals the set value. */
    effective: string;
    /** The effective value lies outside the game's range. */
    beyond: boolean;
  };
}

/** Graph tab of the dyno editor: an ECU/turbo curve or the drivetrain screen. */
export type DynoTab = CurveKind | 'drive' | ScalarCategory;

/** One drivetrain row; positions are percentages of the bar width. */
export interface GearBar {
  param: number;
  label: string;
  value: string;
  sub: string;
  final: boolean;
  /** Allowed range. */
  lo: number;
  hi: number;
  at: number;
  stock: number;
}

/** Drivetrain screen in the dyno tab. */
export interface GearChart {
  rows: GearBar[];
  /** Speed scale of the gear bars, km/h. */
  ticks: { at: number; label: string }[];
  selected: { label: string; value: string; stock: string; range: string; downLabel: string; upLabel: string; canDown: boolean; canUp: boolean };
}

/** State of the dyno tab. */
export interface DynoView {
  gameName: string;
  gameError: string;
  setup: DynoEvent;
  setupNames: string[];
  strategy: string;
  optimizeGearing: boolean;
  carName: string;
  /** Empty when the car can be tuned, else the reason it cannot. */
  blocked: string;
  busy: boolean;
  rows: DynoRow[];
  /** True when the draft differs from the saved setup. */
  hasProposal: boolean;
  /** Curves unlocked by the installed parts. */
  curveTabs: { kind: DynoTab; label: string }[];
  curve: DynoTab;
  /**
   * Save-only curve editing: points are set independently, which the game UI never does. Off follows the game's
   * tuning screen, where neighbours absorb a point's change.
   */
  cheat: boolean;
  point: number;
  chart: CurveChart | null;
  /** Selected drivetrain row. */
  gear: number;
  drive: GearChart | null;
  scalars: ScalarRow[];
  /** Objective key for "Optimize (game rules)"; empty follows the selected setup tab. */
  legalObjective: string;
  legalLaunch: boolean;
  legalSheet: string;
  legalCopied: boolean;
  legalChoices: { key: string; name: string }[];
  /** `hand`: mode A, set by hand in the game with the keys (default). `save`: mode B, exact optimum written to the save. */
  mode: 'hand' | 'save';
  /** Mode A sheet (what to press). */
  handSheet: string;
  /** Mode A against mode B on the dyno screen's numbers; empty before Optimize. */
  handTable: HandRow[];
  handPresses: number;
  /** Mode A key list. */
  handSteps: { screen: string; row: string; keys: string; result: string; presses: number }[];
  /** Number sliders of the game's menus for this car, grouped by screen. */
  sliderGroups: SliderGroup[];
  /** True when an owner-typed number is set on any slider of this setup. */
  hasTargets: boolean;
}

/** One number slider as the game shows it, with the owner's wanted number and both ways to get there. */
export interface SliderView {
  param: number;
  label: string;
  /** Number on the game screen now (saved setup). */
  saved: string;
  /** No-save mode: the number the owner says the game screen shows now (the start of the keys); editable. */
  now: number | null;
  /** Edge numbers of the slider and the size of one key press. */
  range: string;
  /** Wanted number typed by the owner (null = leave as is). */
  input: number | null;
  /** B: the number the exact byte stands for; A: what the keys reach, with the keys. */
  exact: string;
  byHand: string;
  keys: string;
  presses: number;
  changed: boolean;
}
export interface SliderGroup { screen: string; rows: SliderView[] }

/** One line of the A against B table. */
export interface HandRow { label: string; a: string; b: string; diff: string; zero: boolean }

/** "Without a save": car and part levels picked from lists. */
export interface VirtualView {
  on: boolean;
  cars: { hash: number; name: string }[];
  carHash: number;
  levels: { code: string; label: string; value: number; options: { value: number; label: string }[] }[];
}

/** One card of the Tuner screen: one game tab, or several with the same plan. */
export interface TunerCardView {
  setups: number[];
  /** The game's tab names, joined. */
  title: string;
  uses: { tab: string; career: string; quick: string }[];
  /** Dyno numbers before (save, or after the reset) and after mode A. */
  nowLabel: string;
  compare: { label: string; now: string; after: string }[];
  /** Mode B in one line, with A minus B. */
  bLine: string;
  presses: number;
  /** Every screen of the game's menu, in its order. */
  screens: {
    name: string; state: 'set' | 'ok' | 'keep' | 'locked'; badge: string; text: string;
    steps: { screen: string; row: string; keys: string; shows: string; from?: string; presses: number; chart?: CurveChart }[];
  }[];
  note: string;
  table: HandRow[];
  sheet: string;
}

/** "Your car now" (before Optimize): the car, its parts, and the dyno and slider values of the tabs as they are. */
export interface TunerNowView {
  carName: string;
  parts: { label: string; level: string }[];
  missing: string[];
  /** One row per tab (save), or one row "Factory setting" (no save). */
  dyno: { tab: string; t60: string; t100: string; top: string; power: string }[];
  /** Slider values per tab, as the game's screens show them. */
  columns: string[];
  settings: { screen: string; row: string; values: string[] }[];
  /** Empty when the car can be tuned; otherwise why Optimize has nothing to do. */
  problem: string;
}

/** One preference slider (the player's choice for a screen Optimize does not tune). */
export interface TunerFeelView { key: string; screen: string; label: string; low: string; high: string; basis: string }

/** The Tuner screen: steps revealed one by one, one Optimize, a card per game tab, preferences after the result. */
export interface TunerView {
  /** No default: the user picks. */
  source: '' | 'save' | 'list';
  slots: { index: number; name: string }[];
  slot: number | null;
  cars: { hash: number; name: string }[];
  carHash: number;
  /** Part levels; `hint` says which screen of the game the part opens. */
  levels: (VirtualView['levels'][number] & { hint: string })[];
  now: TunerNowView | null;
  pref: string;
  prefs: { key: string; label: string; text: string }[];
  busy: boolean;
  progress: string;
  error: string;
  /** The save changed after the last Optimize. */
  stale: boolean;
  carName: string;
  fromC: boolean;
  /** A save was loaded for the result: mode B can be downloaded. */
  canDownload: boolean;
  cards: TunerCardView[];
  /** The game's five tabs in its order and the card each one opens. */
  tabs: { name: string; short: string; card: number }[];
  /** The card on show (one game tab at a time). */
  card: number;
  /** Slider positions of the card on show (-100..100, 0 = as now), and the sliders it can use. */
  feel: Record<string, number>;
  sliders: TunerFeelView[];
}

/** Top-level tuning tab. */
export interface TuningTab {
  code: string;
  label: string;
}

/** Profile choice for an nfsu2-web backup ZIP. */
export interface BackupView {
  current: number;
  note: string;
  profiles: { index: number; label: string }[];
}

export interface VisualRow {
  id: number;
  label: string;
  value: number;
  color: string;
  colorPicker: boolean;
  selectedLabel: string;
  retained: boolean;
  palettes: ColorPalette[];
  options: { hash: number; label: string; group: string }[];
}

export interface VisualView {
  blocked: string;
  hasProposal: boolean;
  category: string;
  colorSlot: number;
  groups: { label: string; rows: VisualRow[] }[];
}

/** State and actions the editor template binds to. */
export interface EditorScope extends angular.IScope {
  loaded: boolean;
  fileName: string;
  fileSize: number;
  checks: ChecksumStatus | null;
  backup: BackupView | null;
  status: Status;
  form: { name: string; money: number };
  slots: SlotView[];
  perfTotal: number;
  uniqueTotal: number;
  unlockTotal: number;
  swapTarget: Record<number, number | string | undefined>;
  replaceTarget: Record<number, number | string | undefined>;
  donors: Donor[];
  replacementCars: { id: number | string; name: string; group: string; experimental: boolean }[];
  tuning: {
    open: boolean;
    slot: number;
    tabs: TuningTab[];
    tab: string;
    sub: string;
    categories: CategoryView[];
    dyno: DynoView;
    visual: VisualView;
  };

  loadFile(file: File | null): void;
  selectProfile(index: number): void;
  checksumText(): string;
  usedCount(): number;
  applyProfile(): void;
  openTuning(slot: number): void;
  selectTab(code: string): void;
  selectSub(code: string): void;
  activeTabLabel(): string;
  toggleUnlocks(slot: number): void;
  toggleLock(slot: number): void;
  closeTuning(): void;
  togglePart(part: PartView): void;
  toggleUnique(part: UniquePartView): void;
  maxOut(slot: number): void;
  swapSlots(slot: number): void;
  replaceCar(slot: number): void;
  loadGameData(file: File | null): void;
  /** Without a save: pick a car and part levels from lists (needs the game data). */
  virtual: VirtualView;
  startNoSave(): void;
  changeVirtual(): void;
  openVirtualTuning(): void;
  setMode(mode: 'hand' | 'save'): void;
  setHandTarget(): void;
  setHandStart(): void;
  clearHandTargets(): void;
  editVisual(row: VisualRow): void;
  applyVisual(): void;
  discardVisual(): void;
  editScalar(row: ScalarRow, byte: number): void;
  resetScalar(param: number): void;
  selectSetup(setup: DynoEvent): void;
  optimizeDyno(): void;
  optimizeLegal(): void;
  copyLegalSheet(): void;
  applyDyno(): void;
  discardDyno(): void;
  selectCurve(kind: DynoTab): void;
  selectGear(index: number): void;
  /** Positive is faster for a gear and towards Acceleration for final drive. */
  stepGear(delta: number): void;
  gearPointer(event: MouseEvent, index: number, start: boolean): void;
  gearKey(event: KeyboardEvent): void;
  selectPoint(index: number): void;
  stepPoint(delta: number): void;
  resetCurve(): void;
  curvePointer(event: MouseEvent, start: boolean): void;
  curveKey(event: KeyboardEvent): void;
  download(): void;
  /** First screen: `tuner` (our Tuner) or `editor` (the author's save editor). */
  view: 'tuner' | 'editor';
  tuner: TunerView;
  tunerChanged(): void;
  tunerOptimize(): void;
  tunerPref(): void;
  tunerFeel(): void;
  tunerTab(card: number): void;
  tunerDownload(): void;
  tunerLogo(): string;
}
