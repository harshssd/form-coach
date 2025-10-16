import { KP, byName, angleDeg } from './utils';

export type RepState = 'TOP' | 'BOTTOM';
export type RepUpdate = { count: number; state: RepState; score: number };

export const initialRep: RepUpdate = { count: 0, state: 'TOP', score: 100 };

export function updateSquatFSM(prev: RepUpdate, kps: KP[]): RepUpdate {
  const m = byName(kps);
  const lk = m['leftKnee'];
  const rk = m['rightKnee'];
  const lh = m['leftHip'];
  const rh = m['rightHip'];
  const la = m['leftAnkle'];
  const ra = m['rightAnkle'];

  if (!lk || !rk || !lh || !rh || !la || !ra) {
    return prev;
  }

  const lKnee = angleDeg(lh, lk, la);
  const rKnee = angleDeg(rh, rk, ra);
  const knee = Math.min(lKnee, rKnee);

  const AT_BOTTOM = knee < 75;
  const AT_TOP = knee > 160;

  let { count, state } = prev;
  if (state === 'TOP' && AT_BOTTOM) {
    state = 'BOTTOM';
  } else if (state === 'BOTTOM' && AT_TOP) {
    state = 'TOP';
    count += 1;
  }

  const kneeValgus =
    Math.abs((lk.x - la.x)) + Math.abs((rk.x - ra.x));
  const depth = Math.max(0, Math.min(1, (160 - Math.min(knee, 160)) / 85));
  let score = Math.round(
    100 -
      25 * Math.max(0, 0.15 - kneeValgus) * 10 +
      10 * depth,
  );
  score = Math.max(1, Math.min(100, score));

  return { count, state, score };
}
