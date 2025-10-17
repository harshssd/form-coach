import type { KP } from './utils';

const MIN_SCORE = 0.45;
const ALPHA = 0.35;

export type Smoothed = Record<string, KP>;

export function filterAndSmooth(prev: Smoothed | null, raw: KP[]): Smoothed {
  const out: Smoothed = {};
  for (const kp of raw) {
    if (!kp?.name) continue;
    if (kp.score != null && kp.score < MIN_SCORE) continue;
    const last = prev?.[kp.name];
    if (!last) {
      out[kp.name] = { ...kp };
    } else {
      out[kp.name] = {
        name: kp.name,
        score: kp.score,
        x: last.x + ALPHA * (kp.x - last.x),
        y: last.y + ALPHA * (kp.y - last.y),
      };
    }
  }
  return out;
}

export function toArray(map: Smoothed): KP[] {
  return Object.values(map);
}
