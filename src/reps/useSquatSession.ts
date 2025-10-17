import { useCallback, useEffect, useRef, useState } from 'react';
import type { KP } from '../pose/utils';
import {
  initialRep,
  updateSquatFSM,
  type RepState,
} from '../pose/squatCounter';
import {
  computeValgusIndex,
  makeValgusState,
  shouldCueKneesOut,
} from '../pose/technique';
import { say } from '../voice/tts';

export type SessionSummary = {
  reps: number;
  avgForm: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

export type SessionState = 'IDLE' | 'ACTIVE' | 'PAUSED';

type Options = {
  onResetPoseStream?: () => void;
  cueCooldownMs?: number;
};

export function useSquatSession(
  keypoints: KP[],
  { onResetPoseStream, cueCooldownMs = 4000 }: Options = {},
) {
  const [session, setSession] = useState<SessionState>('IDLE');
  const [rep, setRep] = useState(initialRep);
  const [elapsed, setElapsed] = useState(0);

  const sessionStartRef = useRef<number | null>(null);
  const sessionBeginRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastRepStateRef = useRef<RepState>(initialRep.state);
  const lastRepCountRef = useRef(initialRep.count);
  const lastTechniqueCueAt = useRef(0);
  const valgusRef = useRef(makeValgusState());
  const formSumRef = useRef(0);
  const formSamplesRef = useRef(0);
  const repRef = useRef(initialRep);

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
      const next = updateSquatFSM(prev, keypoints);
      repRef.current = next;

      if (keypoints.length > 0) {
        formSumRef.current += next.score;
        formSamplesRef.current += 1;
      }

      if (next.state !== lastRepStateRef.current) {
        if (next.state === 'BOTTOM') {
          say('down', 400);
        }
        if (next.state === 'TOP' && next.count > prev.count) {
          say('up', 400);
        }
        lastRepStateRef.current = next.state;
      }

      if (next.count !== lastRepCountRef.current) {
        if (next.score >= 90) {
          say('nice depth', 800);
        }
        lastRepCountRef.current = next.count;
      }

      const now = Date.now();
      const inCritical =
        next.state === 'DESCENDING' || next.state === 'BOTTOM';
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
        say('knees out', 1200);
        lastTechniqueCueAt.current = now;
      }

      return next;
    });
  }, [keypoints, session, cueCooldownMs]);

  const start = useCallback(() => {
    const now = Date.now();
    setRep(initialRep);
    repRef.current = initialRep;
    lastRepStateRef.current = initialRep.state;
    lastRepCountRef.current = initialRep.count;
    valgusRef.current = makeValgusState();
    sessionStartRef.current = now;
    sessionBeginRef.current = now;
    formSumRef.current = 0;
    formSamplesRef.current = 0;
    lastTechniqueCueAt.current = 0;
    setElapsed(0);
    onResetPoseStream?.();
    setSession('ACTIVE');
    say('session started');
  }, [onResetPoseStream]);

  const pause = useCallback(() => {
    if (sessionStartRef.current != null) {
      setElapsed(Date.now() - sessionStartRef.current);
    }
    setSession('PAUSED');
    say('paused');
  }, []);

  const resume = useCallback(() => {
    sessionStartRef.current = Date.now() - elapsed;
    setSession('ACTIVE');
    say('resumed');
  }, [elapsed]);

  const reset = useCallback(
    (options: { speak?: boolean } = {}) => {
      setSession('IDLE');
      setElapsed(0);
      sessionStartRef.current = null;
      sessionBeginRef.current = null;
      valgusRef.current = makeValgusState();
      lastRepStateRef.current = initialRep.state;
      lastRepCountRef.current = initialRep.count;
      lastTechniqueCueAt.current = 0;
      formSumRef.current = 0;
      formSamplesRef.current = 0;
      repRef.current = initialRep;
      onResetPoseStream?.();
      setRep(initialRep);
      if (options.speak !== false) {
        say('reset');
      }
    },
    [onResetPoseStream],
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
