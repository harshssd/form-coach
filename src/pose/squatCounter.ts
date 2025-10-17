import { KP, byName, angleDeg } from './utils';

export type RepState = 'TOP' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

export type RepUpdate = {
  count: number;
  state: RepState;
  score: number;
  kneeAngle: number;
  bottomHold: number;
  topHold: number;
  lastCueAt: number;
};

export const initialRep: RepUpdate = {
  count: 0,
  state: 'TOP',
  score: 100,
  kneeAngle: 180,
  bottomHold: 0,
  topHold: 2,
  lastCueAt: 0,
};

const ENTER_BOTTOM_ANGLE = 85;
const EXIT_BOTTOM_ANGLE = 115;
const ENTER_TOP_ANGLE = 160;
const EXIT_TOP_ANGLE = 140;

const HOLD_FRAMES = 2;

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

  let { count, state, bottomHold, topHold } = prev;

  switch (state) {
    case 'TOP':
      if (knee < EXIT_TOP_ANGLE) {
        state = 'DESCENDING';
      }
      topHold = Math.min(HOLD_FRAMES, topHold + 1);
      bottomHold = 0;
      break;

    case 'DESCENDING':
      if (knee < ENTER_BOTTOM_ANGLE) {
        bottomHold += 1;
        if (bottomHold >= HOLD_FRAMES) {
          state = 'BOTTOM';
          bottomHold = HOLD_FRAMES;
        }
      } else {
        bottomHold = 0;
      }
      if (knee > ENTER_TOP_ANGLE) {
        state = 'TOP';
      }
      topHold = 0;
      break;

    case 'BOTTOM':
      if (knee > EXIT_BOTTOM_ANGLE) {
        state = 'ASCENDING';
      }
      bottomHold = Math.min(HOLD_FRAMES, bottomHold + 1);
      topHold = 0;
      break;

    case 'ASCENDING':
      if (knee > ENTER_TOP_ANGLE) {
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

  const valgusLeft = Math.max(0, la.x - lk.x);
  const valgusRight = Math.max(0, ra.x - rk.x);
  const kneeValgus = valgusLeft + valgusRight;
  const depth = Math.max(0, Math.min(1, (160 - Math.min(knee, 160)) / 85));

  let score = Math.round(
    100 - 40 * Math.max(0, 0.1 - kneeValgus) * 10 + 12 * depth,
  );
  score = Math.max(1, Math.min(100, score));

  return {
    count,
    state,
    score,
    kneeAngle: knee,
    bottomHold,
    topHold,
    lastCueAt: prev.lastCueAt,
  };
}
