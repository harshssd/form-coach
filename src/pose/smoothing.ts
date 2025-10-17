export type RawKeypoint = {
  name?: string;
  x: number;
  y: number;
  c?: number;
  score?: number;
};

export type SmoothedKeypoint = {
  name: string;
  x: number;
  y: number;
  c: number;
};

type InternalKP = {
  x: number;
  y: number;
  c: number;
  ready: boolean;
};

const MIN_CONFIDENCE = 0.3;
const ALPHA_BASE = 0.35;
const MAX_JUMP = 0.15;

export class KPSmoother {
  private map = new Map<string, InternalKP>();

  reset() {
    this.map.clear();
  }

  step(points: RawKeypoint[]): SmoothedKeypoint[] {
    const out: SmoothedKeypoint[] = [];

    for (const kp of points) {
      if (!kp.name) continue;
      const confidence = kp.c ?? 1;
      if (confidence < MIN_CONFIDENCE) continue;

      const stored = this.map.get(kp.name);
      if (!stored) {
        const entry: InternalKP = {
          x: kp.x,
          y: kp.y,
          c: confidence,
          ready: true,
        };
        this.map.set(kp.name, entry);
        out.push({ name: kp.name, x: kp.x, y: kp.y, c: confidence });
        continue;
      }

      const alpha = Math.min(
        0.95,
        Math.max(0.05, ALPHA_BASE * (1.2 - confidence)),
      );

      let nx = stored.x + alpha * (kp.x - stored.x);
      let ny = stored.y + alpha * (kp.y - stored.y);

      if (Math.abs(nx - stored.x) > MAX_JUMP) {
        nx = stored.x + Math.sign(nx - stored.x) * MAX_JUMP;
      }
      if (Math.abs(ny - stored.y) > MAX_JUMP) {
        ny = stored.y + Math.sign(ny - stored.y) * MAX_JUMP;
      }

      const nc = 0.5 * (stored.c + confidence);
      stored.x = nx;
      stored.y = ny;
      stored.c = nc;
      stored.ready = true;

      out.push({ name: kp.name, x: nx, y: ny, c: nc });
    }

    return out;
  }
}
