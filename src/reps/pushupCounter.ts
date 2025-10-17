import { KP, byName, angleDeg } from '../pose/utils';

export type RepState = 'TOP' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

export type RepUpdate = {
  count: number;
  state: RepState;
  score: number;
  elbowAngle: number;
  bottomHold: number;
  topHold: number;
};

export const initialRep: RepUpdate = {
  count: 0,
  state: 'TOP',
  score: 100,
  elbowAngle: 180,
  bottomHold: 0,
  topHold: 2,
};

const ENTER_TOP_ANGLE = 160;
const EXIT_TOP_ANGLE = 140;
const HOLD_FRAMES = 2;

function bodyLinePenalty(map: Record<string, KP>): number {
  const shoulder = map['leftShoulder'] ?? map['rightShoulder'];
  const hip = map['leftHip'] ?? map['rightHip'];
  const ankle = map['leftAnkle'] ?? map['rightAnkle'];
  if (!shoulder || !hip || !ankle) {
    return 0;
  }
  const angle = angleDeg(shoulder, hip, ankle);
  return Math.max(0, (165 - Math.min(180, angle)) / 30);
}

export function updatePushupFSM(
  prev: RepUpdate,
  kps: KP[],
  depthThreshold = 70,
): RepUpdate {
  const map = byName(kps);
  const ls = map['leftShoulder'] ?? map['rightShoulder'];
  const rs = map['rightShoulder'] ?? map['leftShoulder'];
  const le = map['leftElbow'];
  const re = map['rightElbow'];
  const lw = map['leftWrist'];
  const rw = map['rightWrist'];

  if (!le || !re || !lw || !rw || !ls || !rs) {
    return prev;
  }

  const leftElbow = angleDeg(ls, le, lw);
  const rightElbow = angleDeg(rs, re, rw);
  const elbow = Math.min(leftElbow, rightElbow);

  let { count, state, bottomHold, topHold } = prev;

  const enterBottom = depthThreshold;
  const exitBottom = Math.min(depthThreshold + 25, 130);

  switch (state) {
    case 'TOP':
      if (elbow < EXIT_TOP_ANGLE) {
        state = 'DESCENDING';
      }
      topHold = Math.min(HOLD_FRAMES, topHold + 1);
      bottomHold = 0;
      break;

    case 'DESCENDING':
      if (elbow < enterBottom) {
        bottomHold += 1;
        if (bottomHold >= HOLD_FRAMES) {
          state = 'BOTTOM';
          bottomHold = HOLD_FRAMES;
        }
      } else {
        bottomHold = 0;
      }
      if (elbow > ENTER_TOP_ANGLE) {
        state = 'TOP';
      }
      topHold = 0;
      break;

    case 'BOTTOM':
      if (elbow > exitBottom) {
        state = 'ASCENDING';
      }
      bottomHold = Math.min(HOLD_FRAMES, bottomHold + 1);
      topHold = 0;
      break;

    case 'ASCENDING':
      if (elbow > ENTER_TOP_ANGLE) {
        topHold += 1;
        if (topHold >= HOLD_FRAMES) {
          state = 'TOP';
          count += 1;
          topHold = HOLD_FRAMES;
        }
      } else {
        topHold = 0;
      }
      bottomHold = 0;
      break;
  }

  const depth = Math.max(0, Math.min(1, (160 - Math.min(elbow, 160)) / 90));
  const linePenalty = bodyLinePenalty(map);
  let score = Math.round(90 * depth + 10) - Math.round(25 * linePenalty);
  score = Math.max(1, Math.min(100, score));

  return {
    count,
    state,
    score,
    elbowAngle: elbow,
    bottomHold,
    topHold,
  };
}
