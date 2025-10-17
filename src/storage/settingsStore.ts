import { MMKV } from 'react-native-mmkv';

export type ExerciseSettings = {
  name: 'squat' | 'pushup';
  depthThreshold: number;
  enableVoice: boolean;
  enableTechniqueCues: boolean;
};

const storage = new MMKV({ id: 'formcoach-settings' });

const defaults: Record<'squat' | 'pushup', ExerciseSettings> = {
  squat: {
    name: 'squat',
    depthThreshold: 85,
    enableVoice: true,
    enableTechniqueCues: true,
  },
  pushup: {
    name: 'pushup',
    depthThreshold: 70,
    enableVoice: true,
    enableTechniqueCues: true,
  },
};

export function loadSettings(exercise: 'squat' | 'pushup'): ExerciseSettings {
  const raw = storage.getString(`settings:${exercise}`);
  if (!raw) {
    return defaults[exercise];
  }
  try {
    const parsed = JSON.parse(raw) as ExerciseSettings;
    return {
      ...defaults[exercise],
      ...parsed,
      name: exercise,
    };
  } catch (e) {
    console.warn('[settingsStore] failed to parse settings', e);
    return defaults[exercise];
  }
}

export function saveSettings(settings: ExerciseSettings) {
  storage.set(
    `settings:${settings.name}`,
    JSON.stringify(settings),
  );
}
