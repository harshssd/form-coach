import type { Baseline } from './calibration';
import type { KP } from './utils';
import { angleDeg, byName } from './utils';

export type ValgusRule = {
  kneeSepMin: number;
  kneeSepClear: number;
  persistMs: number;
  minFlexDeg: number;
  maxFlexDeg: number;
  minConf: number;
};

export const DEFAULT_VALGUS_RULE: ValgusRule = {
  kneeSepMin: 0.85,
  kneeSepClear: 0.88,
  persistMs: 300,
  minFlexDeg: 20,
  maxFlexDeg: 110,
  minConf: 0.6,
};

export type ValgusSample = {
  kneeSep: number;
  hipWidth: number;
  kneeSepNorm: number;
  flexLeft: number;
  flexRight: number;
  confident: boolean;
};

export function evaluateValgus(
  keypoints: KP[],
  baseline: Baseline | null,
  rule: ValgusRule = DEFAULT_VALGUS_RULE,
): ValgusSample | null {
  if (!baseline || !baseline.ready || baseline.hipWidth <= 0) {
    return null;
  }

  const map = byName(keypoints);
  const lh = map['leftHip'];
  const rh = map['rightHip'];
  const lk = map['leftKnee'];
  const rk = map['rightKnee'];
  const la = map['leftAnkle'];
  const ra = map['rightAnkle'];

  if (!lh || !rh || !lk || !rk || !la || !ra) {
    return null;
  }

  const confidences = [lh, rh, lk, rk, la, ra].map((kp) =>
    kp.score != null ? kp.score : 1,
  );
  const confident = confidences.every((c) => c >= rule.minConf);

  const hipWidth = Math.hypot(lh.x - rh.x, lh.y - rh.y);
  const kneeWidth = Math.hypot(lk.x - rk.x, lk.y - rk.y);

  if (!hipWidth || !Number.isFinite(kneeWidth)) {
    return null;
  }

  const leftFlex = Math.max(0, 180 - angleDeg(lh, lk, la));
  const rightFlex = Math.max(0, 180 - angleDeg(rh, rk, ra));

  return {
    kneeSep: kneeWidth,
    hipWidth,
    kneeSepNorm: kneeWidth / Math.max(baseline.hipWidth, 1e-4),
    flexLeft: leftFlex,
    flexRight: rightFlex,
    confident,
  };
}
