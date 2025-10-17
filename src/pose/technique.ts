import type { KP } from './utils';
import { angleDeg, byName } from './utils';

const dist = (a: KP, b: KP) => Math.hypot(a.x - b.x, a.y - b.y);
const MIN_CONFIDENCE = 0.5;

export const DEFAULT_MIN_STANCE_WIDTH = 0.06;
export const DEFAULT_CALIBRATION_MS = 2000;

export type StanceBaseline = {
  leftMedial: number;
  rightMedial: number;
  stanceWidth: number;
};

export type StanceCalib = {
  startedAt: number;
  durationMs: number;
  totalSamples: number;
  goodSamples: number;
  sumLeftMedial: number;
  sumRightMedial: number;
  sumStanceWidth: number;
};

export type ValgusSnapshot = {
  relLeft: number;
  relRight: number;
  flexLeft: number;
  flexRight: number;
  stanceWidth: number;
  rawLeft: number;
  rawRight: number;
};

type LegMeasurements = {
  leftMedial: number;
  rightMedial: number;
  stanceWidth: number;
  leftFlex: number;
  rightFlex: number;
};

export function startStanceCalib(
  durationMs = DEFAULT_CALIBRATION_MS,
  now = Date.now(),
): StanceCalib {
  return {
    startedAt: now,
    durationMs,
    totalSamples: 0,
    goodSamples: 0,
    sumLeftMedial: 0,
    sumRightMedial: 0,
    sumStanceWidth: 0,
  };
}

export function updateStanceCalib(
  calib: StanceCalib,
  keypoints: KP[],
): StanceCalib {
  const next = {
    ...calib,
    totalSamples: calib.totalSamples + 1,
  };

  const measurements = measureLegs(keypoints);
  if (!measurements) {
    return next;
  }

  return {
    ...next,
    goodSamples: next.goodSamples + 1,
    sumLeftMedial: next.sumLeftMedial + measurements.leftMedial,
    sumRightMedial: next.sumRightMedial + measurements.rightMedial,
    sumStanceWidth: next.sumStanceWidth + measurements.stanceWidth,
  };
}

export function finalizeStanceCalib(
  calib: StanceCalib,
  {
    minGoodSamples = 20,
    minStanceWidth = DEFAULT_MIN_STANCE_WIDTH,
  }: { minGoodSamples?: number; minStanceWidth?: number } = {},
): StanceBaseline | null {
  if (calib.goodSamples < minGoodSamples) {
    return null;
  }

  const leftMedial = calib.sumLeftMedial / calib.goodSamples;
  const rightMedial = calib.sumRightMedial / calib.goodSamples;
  const stanceWidth = calib.sumStanceWidth / calib.goodSamples;

  if (
    !Number.isFinite(leftMedial) ||
    !Number.isFinite(rightMedial) ||
    !Number.isFinite(stanceWidth) ||
    stanceWidth < minStanceWidth
  ) {
    return null;
  }

  return {
    leftMedial,
    rightMedial,
    stanceWidth,
  };
}

export function computeValgus(
  keypoints: KP[],
  baseline: StanceBaseline | null,
  {
    minStanceWidth = DEFAULT_MIN_STANCE_WIDTH,
  }: { minStanceWidth?: number } = {},
): ValgusSnapshot | null {
  if (!baseline) {
    return null;
  }

  const measurements = measureLegs(keypoints);
  if (!measurements) {
    return null;
  }

  if (
    baseline.stanceWidth < minStanceWidth ||
    measurements.stanceWidth < minStanceWidth * 0.65
  ) {
    return null;
  }

  const relLeft = Math.max(0, measurements.leftMedial - baseline.leftMedial);
  const relRight = Math.max(0, measurements.rightMedial - baseline.rightMedial);

  return {
    relLeft,
    relRight,
    flexLeft: measurements.leftFlex,
    flexRight: measurements.rightFlex,
    stanceWidth: measurements.stanceWidth,
    rawLeft: measurements.leftMedial,
    rawRight: measurements.rightMedial,
  };
}

function measureLegs(keypoints: KP[]): LegMeasurements | null {
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

  const pts = [lh, rh, lk, rk, la, ra];
  if (pts.some((p) => p.score != null && p.score < MIN_CONFIDENCE)) {
    return null;
  }

  const pelvis = dist(lh, rh);
  if (!pelvis || pelvis < 1e-3) {
    return null;
  }

  const axisX = (rh.x - lh.x) / pelvis;
  const axisY = (rh.y - lh.y) / pelvis;

  const project = (dx: number, dy: number) => dx * axisX + dy * axisY;

  const leftMedial = Math.max(
    0,
    project(lk.x - la.x, lk.y - la.y) / pelvis,
  );
  const rightMedial = Math.max(
    0,
    project(ra.x - rk.x, ra.y - rk.y) / pelvis,
  );

  const stanceWidth =
    Math.abs(project(ra.x - la.x, ra.y - la.y)) / pelvis;

  const leftFlex = Math.max(0, 180 - angleDeg(lh, lk, la));
  const rightFlex = Math.max(0, 180 - angleDeg(rh, rk, ra));

  return {
    leftMedial,
    rightMedial,
    stanceWidth,
    leftFlex,
    rightFlex,
  };
}
