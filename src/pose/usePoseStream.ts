import { useCallback, useRef, useState } from 'react';
import type { KP } from './utils';
import {
  filterAndSmooth,
  toArray,
  type Smoothed,
} from './smoothing';

type RawPoint = {
  name?: string;
  x: number;
  y: number;
  score?: number;
};

export type PoseFramePayload = {
  width: number;
  height: number;
  orientation: number;
  isMirrored: boolean;
  points: RawPoint[];
};

type PoseStreamOptions = {
  viewWidth: number;
  viewHeight: number;
  displayMirrored: boolean;
};

export function usePoseStream({
  viewWidth,
  viewHeight,
  displayMirrored,
}: PoseStreamOptions) {
  const smoothRef = useRef<Smoothed | null>(null);
  const [keypoints, setKeypoints] = useState<KP[]>([]);
  const [debug, setDebug] = useState<string | null>(null);

  const reset = useCallback(() => {
    smoothRef.current = null;
    setKeypoints([]);
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
        smoothRef.current = null;
        setKeypoints([]);
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

      smoothRef.current = filterAndSmooth(smoothRef.current, normalized);
      const smoothArr = toArray(smoothRef.current ?? {});
      setKeypoints(smoothArr);
      setDebug(
        `pts:${smoothArr.length} w:${payload.width} h:${payload.height} orient:${payload.orientation} mirrored:${payload.isMirrored}`,
      );
    },
    [viewWidth, viewHeight, displayMirrored],
  );

  return {
    keypoints,
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
): KP[] {
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

  const result: KP[] = [];
  for (const point of points) {
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
        score: point.score,
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
): { x: number; y: number } {
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
