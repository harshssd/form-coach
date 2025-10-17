import React, { memo } from 'react';
import Svg, { Line, Circle } from 'react-native-svg';

type KP = { name: string; x: number; y: number; c: number };

type SkeletonOverlayProps = {
  width: number;
  height: number;
  kps: KP[];
  mirror?: boolean;
  confMin?: number;
};

const LINKS: [string, string][] = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  ['nose', 'leftEye'],
  ['nose', 'rightEye'],
];

const mapX = (x: number, width: number, mirror: boolean) =>
  mirror ? width - x : x;

export const SkeletonOverlay = memo(
  ({
    width,
    height,
    kps,
    mirror = false,
    confMin = 0.6,
  }: SkeletonOverlayProps) => {
    const byName = new Map(kps.map((kp) => [kp.name, kp]));

    const pick = (name: string) => {
      const kp = byName.get(name);
      return kp && (kp.c ?? 1) >= confMin ? kp : undefined;
    };

    return (
      <Svg
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        {LINKS.map(([a, b], index) => {
          const p = pick(a);
          const q = pick(b);
          if (!p || !q) {
            return null;
          }
          return (
            <Line
              key={`link-${index}`}
              x1={mapX(p.x, width, mirror)}
              y1={p.y}
              x2={mapX(q.x, width, mirror)}
              y2={q.y}
              stroke="white"
              strokeWidth={2}
              strokeOpacity={0.8}
            />
          );
        })}
        {kps.map((p, index) => {
          if ((p.c ?? 1) < confMin) {
            return null;
          }
          return (
            <Circle
              key={`${p.name}-${index}`}
              cx={mapX(p.x, width, mirror)}
              cy={p.y}
              r={3}
              fill="deepskyblue"
              fillOpacity={0.9}
            />
          );
        })}
      </Svg>
    );
  },
);
