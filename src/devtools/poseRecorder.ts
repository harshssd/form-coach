import * as FileSystem from 'expo-file-system/legacy';
import { PosePacket, PoseRun } from '../types/recording';

class PoseRecorder {
  private run: PoseRun | null = null;
  private t0 = 0;
  private dirCache: string | null = null;

  private async ensureDir(): Promise<string> {
    if (this.dirCache) {
      return this.dirCache;
    }

    const baseDir =
      FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? null;
    if (!baseDir) {
      throw new Error('[poseRecorder] storage directory unavailable');
    }

    const dir = `${baseDir}pose_runs/`;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    this.dirCache = dir;
    return dir;
  }

  async start(id: string, exercise: 'squat' | 'pushup') {
    await this.ensureDir();
    this.t0 = Date.now();
    this.run = {
      id,
      startedAt: this.t0,
      exercise,
      packets: [],
    };
  }

  get isRecording() {
    return this.run != null;
  }

  push(packet: Omit<PosePacket, 't'>) {
    if (!this.run) {
      return;
    }
    const t = Date.now() - this.t0;
    this.run.packets.push({ t, ...packet });
  }

  async stopAndSave(): Promise<{ jsonPath: string } | null> {
    if (!this.run) {
      return null;
    }

    const dir = await this.ensureDir();
    const jsonPath = `${dir}${this.run.id}.json`;
    const payload = JSON.stringify(this.run);
    await FileSystem.writeAsStringAsync(jsonPath, payload, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    this.run = null;
    return { jsonPath };
  }

  async listRuns(): Promise<{ id: string; path: string }[]> {
    const dir = await this.ensureDir();
    const entries = await FileSystem.readDirectoryAsync(dir);
    return entries
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({
        id: file.replace(/\.json$/, ''),
        path: `${dir}${file}`,
      }));
  }
}

export const poseRecorder = new PoseRecorder();

