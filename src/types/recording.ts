export type KP = { name: string; x: number; y: number; c: number };

export type PosePacket = {
  t: number;
  exercise: 'squat' | 'pushup';
  camera: {
    front: boolean;
    mirror: boolean;
    orientation: 'portrait' | 'landscape';
  };
  kps: KP[];
  sig: {
    squatDepth?: number;
    kneeFlex?: number;
    valgus?: number;
    elbowFlex?: number;
    plankStraight?: number;
  };
  fsm: { state: string; repCount: number };
  lat?: { tIn?: number; tPose?: number; tCue?: number };
};

export type PoseRun = {
  id: string;
  startedAt: number;
  exercise: 'squat' | 'pushup';
  fpsApprox?: number;
  packets: PosePacket[];
};
