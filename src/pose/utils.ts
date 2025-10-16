export type KP = { x: number; y: number; score?: number; name?: string };
export type Pose = { keypoints: KP[] };

export function byName(keypoints: KP[]) {
  const map: Record<string, KP | undefined> = {};
  keypoints.forEach((kp) => {
    if (!kp?.name) {
      return;
    }
    const name = kp.name;
    map[name] = kp;
    const base = normalizeName(name);
    if (base && !map[base]) {
      map[base] = kp;
    }
  });
  return map;
}

function normalizeName(name: string) {
  if (!name) {
    return undefined;
  }
  // Drop common suffixes like "Position" or "Landmark"
  const withoutSuffix = name.replace(/(Position|Landmark)$/i, '');
  return withoutSuffix;
}

export function angleDeg(a: KP, b: KP, c: KP) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (!mag1 || !mag2) {
    return 180;
  }
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}
