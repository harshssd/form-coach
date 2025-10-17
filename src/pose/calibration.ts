export type PointSample = {
  x: number;
  y: number;
  c: number;
};

export type Baseline = {
  hipWidth: number;
  kneeWidth: number;
  torsoTilt: number;
  ready: boolean;
};

export type CalibrationSample = {
  ts: number;
  leftHip: PointSample;
  rightHip: PointSample;
  leftKnee: PointSample;
  rightKnee: PointSample;
  leftShoulder: PointSample;
  rightShoulder: PointSample;
};

const DEFAULT_BASELINE: Baseline = {
  hipWidth: 0,
  kneeWidth: 0,
  torsoTilt: 0,
  ready: false,
};

export function makeCalibrator(windowMs = 2000) {
  let sumHip = 0;
  let sumKnee = 0;
  let sumTilt = 0;
  let sampleCount = 0;
  let startTs: number | null = null;
  let lastBaseline: Baseline = { ...DEFAULT_BASELINE };

  const reset = () => {
    sumHip = 0;
    sumKnee = 0;
    sumTilt = 0;
    sampleCount = 0;
    startTs = null;
    lastBaseline = { ...DEFAULT_BASELINE };
  };

  const step = (sample: CalibrationSample): Baseline => {
    const {
      ts,
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      leftShoulder,
      rightShoulder,
    } = sample;

    const minConf = 0.5;
    if (
      [
        leftHip,
        rightHip,
        leftKnee,
        rightKnee,
        leftShoulder,
        rightShoulder,
      ].some((p) => p.c == null || p.c < minConf)
    ) {
      return lastBaseline;
    }

    if (startTs == null) {
      startTs = ts;
    }

    const hipWidth = Math.hypot(leftHip.x - rightHip.x, leftHip.y - rightHip.y);
    const kneeWidth = Math.hypot(
      leftKnee.x - rightKnee.x,
      leftKnee.y - rightKnee.y,
    );

    const shoulderMid = {
      x: 0.5 * (leftShoulder.x + rightShoulder.x),
      y: 0.5 * (leftShoulder.y + rightShoulder.y),
    };
    const hipMid = {
      x: 0.5 * (leftHip.x + rightHip.x),
      y: 0.5 * (leftHip.y + rightHip.y),
    };

    const vx = shoulderMid.x - hipMid.x;
    const vy = shoulderMid.y - hipMid.y;
    const tiltDeg = Math.abs((Math.atan2(vx, vy) * 180) / Math.PI);

    sumHip += hipWidth;
    sumKnee += kneeWidth;
    sumTilt += tiltDeg;
    sampleCount += 1;

    const elapsed = startTs != null ? ts - startTs : 0;
    const ready = elapsed >= windowMs && sampleCount >= 8;

    const invSamples = sampleCount ? 1 / sampleCount : 0;

    const next: Baseline = {
      hipWidth: sumHip * invSamples,
      kneeWidth: sumKnee * invSamples,
      torsoTilt: sumTilt * invSamples,
      ready,
    };

    lastBaseline = next;
    return next;
  };

  return {
    reset,
    step,
    windowMs,
  };
}

export const EMPTY_BASELINE = { ...DEFAULT_BASELINE };
