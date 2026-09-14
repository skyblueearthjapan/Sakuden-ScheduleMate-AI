// お弁当の要否と音声の利用時間を JSON ファイルに置く（DB は持たない）。
// 予定の正本はダッシュボードなので、ここに残るのはダッシュボードに無い 2 つだけ。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

mkdirSync(config.dataDir, { recursive: true });
const FILE = join(config.dataDir, 'state.json');

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return { lunch: {}, usage: {} };
  }
}
function save(state) {
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

/** lunch: { "2026-09-15": { needed: false, answered_at: "2026-09-14T09:03:00+09:00", note: "" } } */
export function lunchFor(from, to) {
  const { lunch } = load();
  const out = {};
  for (const [date, v] of Object.entries(lunch)) if (date >= from && date <= to) out[date] = v;
  return out;
}

export function setLunch(date, needed, note = '') {
  const state = load();
  state.lunch[date] = { needed: Boolean(needed), answered_at: new Date().toISOString(), note };
  save(state);
  return state.lunch[date];
}

/** 音声の利用秒数（日ごと）。予算の判定に使う。 */
export function usageSecondsOn(date) {
  return load().usage[date] ?? 0;
}
export function addUsage(date, seconds) {
  const state = load();
  state.usage[date] = (state.usage[date] ?? 0) + Math.max(0, Math.round(seconds));
  save(state);
  return state.usage[date];
}
