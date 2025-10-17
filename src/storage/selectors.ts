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

const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

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

export function todayTotals(list: SessionRecord[]) {
  const start = dayStart(Date.now());
  let reps = 0;
  let sessions = 0;
  const perExercise: Record<string, number> = {};

  for (const session of list) {
    if (dayStart(session.endedAt) !== start) continue;
    reps += session.reps;
    sessions += 1;
    perExercise[session.exercise] =
      (perExercise[session.exercise] ?? 0) + session.reps;
  }

  return { reps, sessions, perExercise };
}

export function weekTotals(list: SessionRecord[]) {
  const end = dayStart(Date.now());
  const start = end - 6 * DAY_MS;
  let reps = 0;
  let sessions = 0;
  const perDay: Record<string, number> = {};

  for (const session of list) {
    const ds = dayStart(session.endedAt);
    if (ds < start || ds > end) continue;
    reps += session.reps;
    sessions += 1;
    const key = new Date(ds).toISOString().slice(0, 10);
    perDay[key] = (perDay[key] ?? 0) + session.reps;
  }

  return { reps, sessions, perDay };
}

export function currentStreak(list: SessionRecord[]): number {
  if (!list.length) return 0;
  const daysWithActivity = new Set<number>();
  for (const session of list) {
    daysWithActivity.add(dayStart(session.endedAt));
  }

  let streak = 0;
  let cursor = dayStart(Date.now());
  while (daysWithActivity.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}
