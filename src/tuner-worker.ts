/**
 * Web worker of the Tuner screen: runs {@link optimizeTab} (about 20 s per tab) off the page's thread, so five tabs can run
 * side by side. Messages: `{ type: 'game', bytes }` once, then `{ type: 'job', id, hash, installed, uniques, start, setup, pref }`;
 * the answer is `{ id, bytes, sheet }` or `{ id, error }`.
 */
import { DynoModel, findCar, parseGameData, type GameData } from './model/dyno.js';
import { optimizeTab, type Preference } from './model/tuner.js';

interface Job { type: 'job'; id: number; hash: number; installed: boolean[]; uniques: number[]; start: number[]; setup: number; pref: Preference }

let game: GameData | null = null;

self.onmessage = (event: MessageEvent<{ type: 'game'; bytes: Uint8Array } | Job>): void => {
  const msg = event.data;
  if (msg.type === 'game') { game = parseGameData(msg.bytes); return; }
  try {
    if (!game) throw new Error('no game data');
    const car = findCar(game, msg.hash);
    if (!car) throw new Error('car not in the game data');
    const model = new DynoModel(game, car, msg.installed, msg.uniques);
    self.postMessage({ id: msg.id, ...optimizeTab(model, car.name, msg.start, msg.setup, msg.pref) });
  } catch (err) {
    self.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
