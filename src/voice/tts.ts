import * as Speech from 'expo-speech';

let lastUtter = 0;

export function say(text: string, cooldownMs = 700) {
  const now = Date.now();
  if (now - lastUtter < cooldownMs) {
    return;
  }
  lastUtter = now;
  Speech.speak(text, { rate: 1.0, pitch: 1.05 });
}
