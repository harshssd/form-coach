import { useCallback, useRef, useState } from 'react';
import type { KP } from './utils';
import {
  KPSmoother,
  type SmoothedKeypoint,
  type RawKeypoint,
} from './smoothing';

export type PoseFramePayload = {
  width: number;
  height: number;
  orientation: number;
  isMirrored: boolean;
  points: RawKeypoint[];
};

type PoseStreamOptions = {
  viewWidth: number;
  viewHeight: number;
  displayMirrored: boolean;
};

export type CanonicalSignals = {
  squatDepth: number;
  kneeFlex: number;
  valgus: number;
  elbowFlex: number;
  plankStraight: number;
};

const ZERO_SIGNALS: CanonicalSignals = {
  squatDepth: 0,
  kneeFlex: 180,
  valgus: 0,
  elbowFlex: 180,
  plankStraight: 0,
};

export function usePoseStream({
  viewWidth,
  viewHeight,
  displayMirrored,
}: PoseStreamOptions) {
  const smootherRef = useRef(new KPSmoother());
  const [keypoints, setKeypoints] = useState<KP[]>([]);
  const [signals, setSignals] = useState<CanonicalSignals>(ZERO_SIGNALS);
  const [debug, setDebug] = useState<string | null>(null);

  const reset = useCallback(() => {
    smootherRef.current.reset();
    setKeypoints([]);
    setSignals(ZERO_SIGNALS);
    setDebug(null);
  }, []);

  const handleFrame = useCallback(
    (payload: PoseFramePayload | null) => {
      if (
        !payload ||
        payload.points.length === 0 ||
        viewWidth === 0 ||
        viewHeight === 0
      ) {
        smootherRef.current.reset();
        setKeypoints([]);
        setSignals(ZERO_SIGNALS);
        setDebug(
          payload
            ? `pts:0 w:${payload.width} h:${payload.height}`
            : null,
        );
        return;
      }

      const normalized = transformPosePoints(
        payload,
        viewWidth,
        viewHeight,
        displayMirrored,
      );

      const smoothed = smootherRef.current.step(normalized);
      const smoothKP: KP[] = smoothed.map((kp) => ({
        name: kp.name,
        x: kp.x,
        y: kp.y,
        score: kp.c,
      }));

      setKeypoints(smoothKP);
      setSignals(computeSignals(smoothed));
      setDebug(
        `pts:${smoothKP.length} w:${payload.width} h:${payload.height} orient:${payload.orientation} mirrored:${payload.isMirrored}`,
      );
    },
    [viewWidth, viewHeight, displayMirrored],
  );

  return {
    keypoints,
    signals,
    debug,
    handleFrame,
    reset,
  };
}

function transformPosePoints(
  payload: PoseFramePayload,
  viewWidth: number,
  viewHeight: number,
  displayMirrored: boolean,
): RawKeypoint[] {
  const { width, height, orientation, isMirrored, points } = payload;
  if (!width || !height || points.length === 0) {
    return [];
  }

  const normalizedOrientation = ((orientation % 360) + 360) % 360;
  const rotatedWidth = normalizedOrientation % 180 === 0 ? width : height;
  const rotatedHeight = normalizedOrientation % 180 === 0 ? height : width;

  const scale = Math.max(viewWidth / rotatedWidth, viewHeight / rotatedHeight);
  const scaledWidth = rotatedWidth * scale;
  const scaledHeight = rotatedHeight * scale;
  const offsetX = (scaledWidth - viewWidth) / 2;
  const offsetY = (scaledHeight - viewHeight) / 2;

  const result: RawKeypoint[] = [];
  for (const point of points) {
    if (!point.name) continue;

    let { x, y } = rotatePoint(
      point.x,
      point.y,
      width,
      height,
      normalizedOrientation,
    );
    const shouldMirror = displayMirrored ? !isMirrored : isMirrored;
    if (shouldMirror) {
      x = rotatedWidth - x;
    }

    const scaledX = x * scale - offsetX;
    const scaledY = y * scale - offsetY;

    const normX = scaledX / viewWidth;
    const normY = scaledY / viewHeight;

    if (Number.isFinite(normX) && Number.isFinite(normY)) {
      result.push({
        name: point.name,
        x: clamp01(normX),
        y: clamp01(normY),
        c: point.c ?? point.score,
      });
    }
  }

  return result;
}

function rotatePoint(
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: number,
) {
  switch (orientation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - y, y: x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: y, y: width - x };
    default:
      return { x, y };
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function computeSignals(points: SmoothedKeypoint[]): CanonicalSignals {
  if (!points.length) return ZERO_SIGNALS;

  const map: Record<string, SmoothedKeypoint> = {};
  for (const kp of points) {
    map[kp.name] = kp;
  }

  const pick = (...names: string[]) => {
    for (const n of names) {
      if (map[n]) return map[n];
    }
    return null;
  };

  const hip = pick('rightHip', 'leftHip');
  const ankle = pick('rightAnkle', 'leftAnkle');
  const hipR = map['rightHip'];
  const hipL = map['leftHip'];
  const kneeR = map['rightKnee'];
  const kneeL = map['leftKnee'];
  const ankleR = map['rightAnkle'];
  const ankleL = map['leftAnkle'];

  let kneeFlex = 180;
  if (hipR && kneeR && ankleR) {
    kneeFlex = Math.min(kneeFlex, angleDeg(hipR, kneeR, ankleR));
  }
  if (hipL && kneeL && ankleL) {
    kneeFlex = Math.min(kneeFlex, angleDeg(hipL, kneeL, ankleL));
  }

  let squatDepth = 0;
  if (hip && ankle) {
    const leg = Math.max(1e-6, dist(hip, ankle));
    const drop = Math.max(0, hip.y - Math.min(hip.y, ankle.y - 0.05));
    squatDepth = Math.max(0, Math.min(1, drop / (0.9 * leg)));
  }

  let valgus = 0;
  if (hipR && kneeR && ankleR) {
    const ux = ankleR.x - hipR.x;
    const uy = ankleR.y - hipR.y;
    const vx = kneeR.x - hipR.x;
    const vy = kneeR.y - hipR.y;
    const proj = (vx * ux + vy * uy) / Math.max(1e-6, ux * ux + uy * uy);
    const px = hipR.x + proj * ux;
    const py = hipR.y + proj * uy;
    const lateral = kneeR.x - px;
    const cross = ux * vy - uy * vx;
    valgus = -lateral * Math.sign(cross || 1);
  }

  const shoulder = pick('rightShoulder', 'leftShoulder');
  const elbow = pick('rightElbow', 'leftElbow');
  const wrist = pick('rightWrist', 'leftWrist');
  const hipP = pick('rightHip', 'leftHip');
  const ankleP = pick('rightAnkle', 'leftAnkle');

  let elbowFlex = 180;
  if (shoulder && elbow && wrist) {
    elbowFlex = angleDeg(shoulder, elbow, wrist);
  }

  let plankStraight = 0;
  if (shoulder && hipP && ankleP) {
    const straight = angleDeg(shoulder, hipP, ankleP);
    plankStraight = Math.max(0, Math.min(1, (straight - 150) / 30));
  }

  return {
    squatDepth,
    kneeFlex: Number.isFinite(kneeFlex) ? kneeFlex : 180,
    valgus,
    elbowFlex: Number.isFinite(elbowFlex) ? elbowFlex : 180,
    plankStraight,
  };
}

function dist(a: SmoothedKeypoint, b: SmoothedKeypoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(a: SmoothedKeypoint, b: SmoothedKeypoint, c: SmoothedKeypoint) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (!m1 || !m2) return 180;
  const cos = Math.min(1, Math.max(-1, dot / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}
