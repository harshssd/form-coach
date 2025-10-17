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
import { DEFAULT_VALGUS_RULE, evaluateValgus } from '../pose/technique';
import type { Baseline } from '../pose/calibration';
import type { ExerciseSettings } from '../storage/settingsStore';
import { say } from '../voice/tts';

export type Exercise = 'squat' | 'pushup';
export type SessionState = 'IDLE' | 'CALIBRATING' | 'ACTIVE' | 'PAUSED';

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
  setCalibrationActive?: (active: boolean) => void;
  resetCalibration?: () => void;
  calibrationWindowMs?: number;
};

const cloneInitial = (exercise: Exercise): AnyRepUpdate =>
  exercise === 'squat' ? { ...squatInitial } : { ...pushInitial };

export function useExerciseSession(
  keypoints: KP[],
  baseline: Baseline,
  {
    exercise,
    settings,
    onResetPoseStream,
    cueCooldownMs = 1200,
    setCalibrationActive,
    resetCalibration,
    calibrationWindowMs = 2000,
  }: Options,
) {
  const [session, setSession] = useState<SessionState>('IDLE');
  const [rep, setRep] = useState<AnyRepUpdate>(cloneInitial(exercise));
  const [elapsed, setElapsed] = useState(0);

  const sessionStartRef = useRef<number | null>(null);
  const sessionBeginRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRepStateRef = useRef<SquatRepState>('TOP');
  const lastRepCountRef = useRef(0);
  const lastTechniqueCueAt = useRef(0);
  const formSumRef = useRef(0);
  const formSamplesRef = useRef(0);
  const repRef = useRef<AnyRepUpdate>(cloneInitial(exercise));
  const exerciseRef = useRef<Exercise>(exercise);
  const repContextRef = useRef<{ kneesCueFired: boolean }>({
    kneesCueFired: false,
  });
  const valgusHoldRef = useRef<number | null>(null);
  const valgusBelowRef = useRef(false);
  const calibrationStartRef = useRef<number | null>(null);
  const calibrationTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const [calibrationProgress, setCalibrationProgress] = useState(0);

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

  const baselineHasShape =
    baseline.hipWidth != null && baseline.hipWidth > 0;
  const baselineReady =
    baseline.ready || (baseline.hipWidth != null && baseline.hipWidth > 0.05);

  useEffect(() => {
    if (session !== 'CALIBRATING' || exerciseRef.current !== 'squat') {
      return;
    }

    const calibrationDone =
      baselineReady || calibrationProgress >= 0.99;

    if (calibrationDone) {
      setCalibrationProgress(1);
      calibrationStartRef.current = null;
      if (calibrationTimerRef.current) {
        clearInterval(calibrationTimerRef.current);
        calibrationTimerRef.current = null;
      }
      setCalibrationActive?.(false);
      sessionStartRef.current = Date.now();
      setElapsed(0);
      setSession('ACTIVE');
      if (baselineReady) {
        speak('stance calibrated', 400);
      }
      speak('session started');
      return;
    }

    if (calibrationStartRef.current == null) {
      calibrationStartRef.current = Date.now();
    }

    if (!calibrationTimerRef.current) {
      calibrationTimerRef.current = setInterval(() => {
        if (calibrationStartRef.current == null) {
          return;
        }
        const progress = Math.max(
          0,
          Math.min(
            1,
            (Date.now() - calibrationStartRef.current) / calibrationWindowMs,
          ),
        );
        setCalibrationProgress(progress);
      }, 100);
    }

    return () => {
      if (calibrationTimerRef.current) {
        clearInterval(calibrationTimerRef.current);
        calibrationTimerRef.current = null;
      }
    };
  }, [
    baselineHasShape,
    baselineReady,
    calibrationProgress,
    calibrationWindowMs,
    session,
    setCalibrationActive,
    speak,
  ]);

  useEffect(() => {
    if (session !== 'ACTIVE') {
      return;
    }

    const valgusRule = settings.valgus ?? DEFAULT_VALGUS_RULE;

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
        if (next.state === 'TOP') {
          repContextRef.current.kneesCueFired = false;
          valgusHoldRef.current = null;
          valgusBelowRef.current = false;
          if (next.count > lastRepCountRef.current) {
            speak('up', 400);
          }
        }
        lastRepStateRef.current = next.state;
      }

      if (next.count !== lastRepCountRef.current) {
        if (next.score >= 90) {
          speak('nice rep', 800);
        }
        lastRepCountRef.current = next.count;
        repContextRef.current.kneesCueFired = false;
        valgusHoldRef.current = null;
        valgusBelowRef.current = false;
      }

      const now = Date.now();
      const inCritical =
        next.state === 'DESCENDING' || next.state === 'BOTTOM';

        if (
          settings.enableTechniqueCues &&
          exerciseRef.current === 'squat'
        ) {
        const sample = evaluateValgus(keypoints, baseline, valgusRule);
        const confident = sample?.confident ?? false;
        const minFlex =
          sample != null
            ? Math.min(sample.flexLeft, sample.flexRight)
            : null;
        const flexOk =
          minFlex != null &&
          minFlex >= valgusRule.minFlexDeg &&
          minFlex <= valgusRule.maxFlexDeg;
        const belowThreshold =
          sample != null &&
          sample.kneeSepNorm < valgusRule.kneeSepMin;
        const clearThreshold =
          sample != null &&
          sample.kneeSepNorm > valgusRule.kneeSepClear;

        if (
          baselineReady &&
          inCritical &&
          confident &&
          flexOk
        ) {
          if (belowThreshold) {
            if (!valgusHoldRef.current) {
              valgusHoldRef.current = now;
            }
            valgusBelowRef.current = true;
            const heldLongEnough =
              valgusHoldRef.current != null &&
              now - valgusHoldRef.current >= valgusRule.persistMs;
            if (
              heldLongEnough &&
              !repContextRef.current.kneesCueFired &&
              now - lastTechniqueCueAt.current > cueCooldownMs
            ) {
              speak('knees out', 1200);
              lastTechniqueCueAt.current = now;
              repContextRef.current.kneesCueFired = true;
            }
          } else if (clearThreshold) {
            valgusHoldRef.current = null;
            valgusBelowRef.current = false;
          } else if (!valgusBelowRef.current) {
            valgusHoldRef.current = null;
          }
        } else {
          valgusHoldRef.current = null;
          valgusBelowRef.current = false;
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
  }, [baseline, baselineReady, keypoints, session, cueCooldownMs, settings.depthThreshold, settings.enableTechniqueCues, settings.enableVoice, settings.valgus, speak]);

  const resetInternal = useCallback(
    (speakOut = true) => {
      setSession('IDLE');
      setElapsed(0);
      sessionStartRef.current = null;
      sessionBeginRef.current = null;
      lastRepStateRef.current = 'TOP';
      lastRepCountRef.current = 0;
      lastTechniqueCueAt.current = 0;
      repContextRef.current = { kneesCueFired: false };
      valgusHoldRef.current = null;
      valgusBelowRef.current = false;
      calibrationStartRef.current = null;
      if (calibrationTimerRef.current) {
        clearInterval(calibrationTimerRef.current);
        calibrationTimerRef.current = null;
      }
      resetCalibration?.();
      setCalibrationActive?.(false);
      setCalibrationProgress(0);
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
    [onResetPoseStream, resetCalibration, setCalibrationActive, speak],
  );

  const start = useCallback(() => {
    const now = Date.now();
    const init = cloneInitial(exerciseRef.current);
    setRep(init);
    repRef.current = init;
    lastRepStateRef.current = init.state as SquatRepState;
    lastRepCountRef.current = init.count;
    sessionBeginRef.current = now;
    formSumRef.current = 0;
    formSamplesRef.current = 0;
    lastTechniqueCueAt.current = 0;
    repContextRef.current = { kneesCueFired: false };
    valgusHoldRef.current = null;
    valgusBelowRef.current = false;
    setCalibrationProgress(0);
    setElapsed(0);
    onResetPoseStream?.();
    sessionStartRef.current = null;
    if (exerciseRef.current === 'squat') {
      calibrationStartRef.current = now;
      if (calibrationTimerRef.current) {
        clearInterval(calibrationTimerRef.current);
        calibrationTimerRef.current = null;
      }
      resetCalibration?.();
      setCalibrationActive?.(true);
      setCalibrationProgress(0);
      setSession('CALIBRATING');
      speak('hold still to calibrate stance');
    } else {
      setCalibrationActive?.(false);
      sessionStartRef.current = now;
      setSession('ACTIVE');
      speak('session started');
    }
  }, [onResetPoseStream, resetCalibration, setCalibrationActive, speak]);

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
    calibrating: session === 'CALIBRATING',
    calibrationProgress,
  };
}
