/**
 * What the Tuner keeps in this browser, and nothing else: the game file the user picked once (IndexedDB, it is 8 MB) and the
 * Tuner's choices (localStorage). No save data is stored. The game file cannot come from nfsu2.xyz's own browser storage:
 * that site keeps its game files in its own origin's private file system (nfsu2-web web/src/host/datacache.ts, OPFS
 * "cache/"), which no other site can read, and its server answers other sites with `cross-origin-resource-policy:
 * same-origin` and no CORS header (checked 2026-11-07 on /data/GLOBAL/GLOBALB.BUN), so the browser blocks a fetch from here.
 */

const DB = 'nfsu2-tuner', STORE = 'files', GAME_KEY = 'GLOBALB.BUN', PREFS_KEY = 'nfsu2-tuner-prefs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const req = act(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => { resolve(req.result as T); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  }));
}

/** Keeps the game file in this browser. */
export const rememberGame = (bytes: Uint8Array): Promise<void> => run<void>('readwrite', (s) => s.put(bytes, GAME_KEY)).then(() => undefined);
/** The kept game file, or null (none, or the browser has no IndexedDB, e.g. some private windows). */
export const recallGame = (): Promise<Uint8Array | null> =>
  run<unknown>('readonly', (s) => s.get(GAME_KEY)).then((v) => (v instanceof Uint8Array ? v : null), () => null);
export const forgetGame = (): Promise<void> => run<void>('readwrite', (s) => s.delete(GAME_KEY)).then(() => undefined);

/** The Tuner's choices kept between visits. */
export interface TunerPrefs {
  /** Mode B (write into the save) or A (by hand). */
  how: 'save' | 'hand';
  /** Goal per game tab, 0..4. */
  goals: string[];
  /** Driving slider positions per game tab, -100..100 per slider key. */
  feels: Record<string, number>[];
  /** Top speed in km/h or mph, as the game is set. */
  units: 'kmh' | 'mph';
}

/** Reads stored choices; anything malformed is dropped (the text comes from the browser, it may be old or edited). */
export function parsePrefs(text: string | null, goalKeys: readonly string[], feelKeys: readonly string[]): TunerPrefs | null {
  let raw: unknown;
  try { raw = JSON.parse(text ?? ''); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const goals = Array.isArray(o.goals) ? o.goals : [];
  const feels = Array.isArray(o.feels) ? o.feels : [];
  return {
    how: o.how === 'hand' ? 'hand' : 'save',
    units: o.units === 'mph' ? 'mph' : 'kmh',
    goals: Array.from({ length: 5 }, (_, k) => (typeof goals[k] === 'string' && goalKeys.includes(goals[k] as string) ? goals[k] as string : 'race')),
    feels: Array.from({ length: 5 }, (_, k) => {
      const f = feels[k] && typeof feels[k] === 'object' ? feels[k] as Record<string, unknown> : {};
      const out: Record<string, number> = {};
      for (const key of feelKeys) {
        const v = f[key];
        if (typeof v === 'number' && Number.isFinite(v) && v !== 0) out[key] = Math.max(-100, Math.min(100, Math.round(v)));
      }
      return out;
    }),
  };
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
export function loadPrefs(goalKeys: readonly string[], feelKeys: readonly string[]): TunerPrefs | null {
  try { return parsePrefs(storage()?.getItem(PREFS_KEY) ?? null, goalKeys, feelKeys); } catch { return null; }
}
export function savePrefs(p: TunerPrefs): void {
  try { storage()?.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage full or blocked: the choices just are not kept */ }
}
export function clearPrefs(): void {
  try { storage()?.removeItem(PREFS_KEY); } catch { /* blocked */ }
}
