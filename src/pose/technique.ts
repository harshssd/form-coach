import type { KP } from './utils';
import { byName } from './utils';

const dist = (a: KP, b: KP) => Math.hypot(a.x - b.x, a.y - b.y);

export type ValgusState = {
  ema: number;
  badFrames: number;
  repTag: number;
};

export const makeValgusState = (): ValgusState => ({
  ema: 0,
  badFrames: 0,
  repTag: -1,
});

export function computeValgusIndex(kps: KP[]): number | null {
  const m = byName(kps);
  const lh = m['leftHip'];
  const rh = m['rightHip'];
  const lk = m['leftKnee'];
  const rk = m['rightKnee'];
  const la = m['leftAnkle'];
  const ra = m['rightAnkle'];

  if (!lh || !rh || !lk || !rk || !la || !ra) {
    return null;
  }

  const pts = [lh, rh, lk, rk, la, ra];
  if (pts.some((p) => p.score != null && p.score < 0.55)) {
    return null;
  }

  const leftInward = Math.max(0, la.x - lk.x);
  const rightInward = Math.max(0, rk.x - ra.x);

  const pelvis = dist(lh, rh);
  if (!pelvis || pelvis < 0.05) {
    return null;
  }

  const raw = (leftInward + rightInward) / (2 * pelvis);
  return Math.max(0, Math.min(1, raw));
}

export function shouldCueKneesOut(
  st: ValgusState,
  index: number | null,
  isInCriticalPhase: boolean,
  repId: number,
  {
    emaAlpha = 0.25,
    badThreshold = 0.18,
    minBadFrames = 8,
  }: {
    emaAlpha?: number;
    badThreshold?: number;
    minBadFrames?: number;
  } = {},
): { next: ValgusState; fire: boolean } {
  let { ema, badFrames, repTag } = st;

  if (index == null || !isInCriticalPhase) {
    ema = ema * (1 - emaAlpha);
    badFrames = Math.max(0, badFrames - 1);
    return { next: { ema, badFrames, repTag }, fire: false };
  }

  ema = (1 - emaAlpha) * ema + emaAlpha * index;

  if (ema > badThreshold) {
    badFrames += 1;
  } else {
    badFrames = Math.max(0, badFrames - 1);
  }

  const canFire = badFrames >= minBadFrames && repId !== repTag;
  if (canFire) {
    repTag = repId;
    badFrames = Math.floor(minBadFrames / 2);
    return { next: { ema, badFrames, repTag }, fire: true };
  }

  return { next: { ema, badFrames, repTag }, fire: false };
}
