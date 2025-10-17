import { MMKV } from 'react-native-mmkv';

export type SessionRecord = {
  id: string;
  exercise: 'squat' | 'pushup';
  reps: number;
  avgForm: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

const storage = new MMKV({ id: 'formcoach' });
const KEY = 'sessions:v1';

function readAll(): SessionRecord[] {
  const raw = storage.getString(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SessionRecord[];
  } catch (e) {
    console.warn('[sessionStore] failed to parse session list', e);
    return [];
  }
}

function writeAll(list: SessionRecord[]) {
  storage.set(KEY, JSON.stringify(list));
}

export function addSession(record: SessionRecord) {
  const list = readAll();
  list.unshift(record);
  writeAll(list);
}

export function listSessions(): SessionRecord[] {
  return readAll();
}

export function clearSessions() {
  writeAll([]);
}
