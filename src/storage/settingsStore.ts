import { MMKV } from 'react-native-mmkv';
import { DEFAULT_VALGUS_RULE } from '../pose/technique';

export type ValgusSettings = typeof DEFAULT_VALGUS_RULE;

export type ExerciseSettings = {
  name: 'squat' | 'pushup';
  depthThreshold: number;
  enableVoice: boolean;
  enableTechniqueCues: boolean;
  valgus: ValgusSettings;
};

const storage = new MMKV({ id: 'formcoach-settings' });

const defaults: Record<'squat' | 'pushup', ExerciseSettings> = {
  squat: {
    name: 'squat',
    depthThreshold: 85,
    enableVoice: true,
    enableTechniqueCues: true,
    valgus: { ...DEFAULT_VALGUS_RULE },
  },
  pushup: {
    name: 'pushup',
    depthThreshold: 70,
    enableVoice: true,
    enableTechniqueCues: true,
    valgus: { ...DEFAULT_VALGUS_RULE },
  },
};

export function loadSettings(exercise: 'squat' | 'pushup'): ExerciseSettings {
  const raw = storage.getString(`settings:${exercise}`);
  if (!raw) {
    return defaults[exercise];
  }
  try {
    const parsed = JSON.parse(raw) as ExerciseSettings;
    const mergedValgus = {
      ...defaults[exercise].valgus,
      ...(parsed.valgus ?? {}),
    };
    return {
      ...defaults[exercise],
      ...parsed,
      name: exercise,
      valgus: mergedValgus,
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
