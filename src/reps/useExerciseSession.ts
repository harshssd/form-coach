import { useCallback, useEffect, useRef, useState } from 'react';
import type { KP } from '../pose/utils';
import {
  initialRep as squatInitial,
  updateSquatFSM,
  type RepState as SquatRepState,
  type RepUpdate as SquatRepUpdate,
} from '../pose/squatCounter';
import {
  initialRep as pushInitial,
  updatePushupFSM,
  type RepUpdate as PushupRepUpdate,
} from './pushupCounter';
import {
  computeValgusIndex,
  makeValgusState,
  shouldCueKneesOut,
} from '../pose/technique';
import type { ExerciseSettings } from '../storage/settingsStore';
import { say } from '../voice/tts';

export type Exercise = 'squat' | 'pushup';
export type SessionState = 'IDLE' | 'ACTIVE' | 'PAUSED';

export type SessionSummary = {
  reps: number;
  avgForm: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

type AnyRepUpdate = SquatRepUpdate | PushupRepUpdate;

type Options = {
  exercise: Exercise;
  settings: ExerciseSettings;
  onResetPoseStream?: () => void;
  cueCooldownMs?: number;
};

const cloneInitial = (exercise: Exercise): AnyRepUpdate =>
  exercise === 'squat' ? { ...squatInitial } : { ...pushInitial };

export function useExerciseSession(
  keypoints: KP[],
  { exercise, settings, onResetPoseStream, cueCooldownMs = 4000 }: Options,
) {
  const [session, setSession] = useState<SessionState>('IDLE');
  const [rep, setRep] = useState<AnyRepUpdate>(cloneInitial(exercise));
  const [elapsed, setElapsed] = useState(0);

  const sessionStartRef = useRef<number | null>(null);
  const sessionBeginRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastRepStateRef = useRef<SquatRepState>('TOP');
  const lastRepCountRef = useRef(0);
  const lastTechniqueCueAt = useRef(0);
  const valgusRef = useRef(makeValgusState());
  const formSumRef = useRef(0);
  const formSamplesRef = useRef(0);
  const repRef = useRef<AnyRepUpdate>(cloneInitial(exercise));
  const exerciseRef = useRef<Exercise>(exercise);

  const speak = useCallback(
    (text: string, cooldown = 700) => {
      if (!settings.enableVoice) {
        return;
      }
      say(text, cooldown);
    },
    [settings.enableVoice],
  );

  useEffect(() => {
    if (exerciseRef.current !== exercise) {
      exerciseRef.current = exercise;
      resetInternal(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (session === 'ACTIVE') {
      timerRef.current = setInterval(() => {
        if (sessionStartRef.current != null) {
          setElapsed(Date.now() - sessionStartRef.current);
        }
      }, 200);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [session]);

  useEffect(() => {
    if (session !== 'ACTIVE') {
      return;
    }

    setRep((prev) => {
      const next =
        exerciseRef.current === 'squat'
          ? updateSquatFSM(prev as SquatRepUpdate, keypoints, settings.depthThreshold)
          : updatePushupFSM(prev as PushupRepUpdate, keypoints, settings.depthThreshold);

      repRef.current = next;

      if (keypoints.length > 0) {
        formSumRef.current += next.score;
        formSamplesRef.current += 1;
      }

      if (next.state !== lastRepStateRef.current) {
        if (next.state === 'BOTTOM') {
          speak('down', 400);
        }
        if (
          next.state === 'TOP' &&
          next.count > lastRepCountRef.current
        ) {
          speak('up', 400);
        }
        lastRepStateRef.current = next.state;
      }

      if (next.count !== lastRepCountRef.current) {
        if (next.score >= 90) {
          speak('nice rep', 800);
        }
        lastRepCountRef.current = next.count;
      }

      const now = Date.now();
      const inCritical =
        next.state === 'DESCENDING' || next.state === 'BOTTOM';

      if (
        settings.enableTechniqueCues &&
        exerciseRef.current === 'squat'
      ) {
        const valgusIndex = computeValgusIndex(keypoints);
        const { next: nextValgus, fire } = shouldCueKneesOut(
          valgusRef.current,
          valgusIndex,
          inCritical,
          next.count,
          {
            emaAlpha: 0.25,
            badThreshold: 0.2,
            minBadFrames: 10,
          },
        );
        valgusRef.current = nextValgus;
        if (fire && now - lastTechniqueCueAt.current > cueCooldownMs) {
          speak('knees out', 1200);
          lastTechniqueCueAt.current = now;
        }
      } else if (
        settings.enableTechniqueCues &&
        exerciseRef.current === 'pushup' &&
        inCritical &&
        next.score < 65 &&
        now - lastTechniqueCueAt.current > cueCooldownMs
      ) {
        speak('keep your body straight', 1200);
        lastTechniqueCueAt.current = now;
      }

      return next;
    });
  }, [keypoints, session, cueCooldownMs, settings.depthThreshold, settings.enableTechniqueCues, settings.enableVoice, speak]);

  const resetInternal = useCallback(
    (speakOut = true) => {
      setSession('IDLE');
      setElapsed(0);
      sessionStartRef.current = null;
      sessionBeginRef.current = null;
      valgusRef.current = makeValgusState();
      lastRepStateRef.current = 'TOP';
      lastRepCountRef.current = 0;
      lastTechniqueCueAt.current = 0;
      formSumRef.current = 0;
      formSamplesRef.current = 0;
      const init = cloneInitial(exerciseRef.current);
      repRef.current = init;
      setRep(init);
      onResetPoseStream?.();
      if (speakOut) {
        speak('reset');
      }
    },
    [onResetPoseStream, speak],
  );

  const start = useCallback(() => {
    const now = Date.now();
    const init = cloneInitial(exerciseRef.current);
    setRep(init);
    repRef.current = init;
    lastRepStateRef.current = init.state as SquatRepState;
    lastRepCountRef.current = init.count;
    valgusRef.current = makeValgusState();
    sessionStartRef.current = now;
    sessionBeginRef.current = now;
    formSumRef.current = 0;
    formSamplesRef.current = 0;
    lastTechniqueCueAt.current = 0;
    setElapsed(0);
    onResetPoseStream?.();
    setSession('ACTIVE');
    speak('session started');
  }, [onResetPoseStream, speak]);

  const pause = useCallback(() => {
    if (sessionStartRef.current != null) {
      setElapsed(Date.now() - sessionStartRef.current);
    }
    setSession('PAUSED');
    speak('paused');
  }, [speak]);

  const resume = useCallback(() => {
    sessionStartRef.current = Date.now() - elapsed;
    setSession('ACTIVE');
    speak('resumed');
  }, [elapsed, speak]);

  const reset = useCallback(
    (options: { speak?: boolean } = {}) => {
      resetInternal(options.speak !== false && settings.enableVoice);
    },
    [resetInternal, settings.enableVoice],
  );

  const getSummary = useCallback((): SessionSummary => {
    const endedAt = Date.now();
    const startedAt = sessionBeginRef.current ?? endedAt;
    const durationMs = Math.max(0, endedAt - startedAt);
    const avgForm = formSamplesRef.current
      ? Math.round(formSumRef.current / formSamplesRef.current)
      : 0;
    return {
      reps: repRef.current.count,
      avgForm,
      startedAt,
      endedAt,
      durationMs,
    };
  }, []);

  return {
    session,
    rep,
    elapsed,
    start,
    pause,
    resume,
    reset,
    getSummary,
  };
}
