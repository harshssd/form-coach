import type { SessionRecord } from './sessionStore';

export type DayBucket = {
  dateKey: string;
  label: string;
  reps: number;
  avgForm: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dateKeyLocal = (ms: number) => {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const weekdayShort = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });

type BucketInternal = DayBucket & { formSum: number; durSum: number };

export function last7DaysSummary(sessions: SessionRecord[]): DayBucket[] {
  const now = Date.now();
  const buckets: Record<string, BucketInternal> = {};

  for (let i = 6; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS);
    day.setHours(0, 0, 0, 0);
    const key = dateKeyLocal(day.getTime());
    buckets[key] = {
      dateKey: key,
      label: weekdayShort(day.getTime()),
      reps: 0,
      avgForm: 0,
      formSum: 0,
      durSum: 0,
    };
  }

  for (const session of sessions) {
    const key = dateKeyLocal(session.endedAt);
    const bucket = buckets[key];
    if (!bucket) continue;

    bucket.reps += session.reps;
    const weight = Math.max(1, session.durationMs);
    bucket.formSum += session.avgForm * weight;
    bucket.durSum += weight;
  }

  return Object.values(buckets)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .map(({ formSum, durSum, ...rest }) => ({
      ...rest,
      avgForm: durSum ? Math.round(formSum / durSum) : 0,
    }));
}
