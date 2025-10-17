import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { SkeletonOverlay } from '../ui/SkeletonOverlay';
import type { PosePacket, PoseRun } from '../types/recording';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round((SCREEN_WIDTH * 16) / 9);

type Props = {
  onClose?: () => void;
};

const RUN_DIR = (() => {
  const base =
    FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? null;
  return base ? `${base}pose_runs/` : null;
})();

export default function Replayer({ onClose }: Props) {
  const [runs, setRuns] = useState<{ id: string; path: string }[]>([]);
  const [run, setRun] = useState<PoseRun | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!RUN_DIR) {
      setError('Recording directory unavailable on this device.');
      return;
    }
    try {
      const info = await FileSystem.getInfoAsync(RUN_DIR);
      if (!info.exists) {
        setRuns([]);
        return;
      }
      const files = await FileSystem.readDirectoryAsync(RUN_DIR);
      const jsons = files
        .filter((file) => file.endsWith('.json'))
        .map((file) => ({
          id: file.replace(/\.json$/, ''),
          path: `${RUN_DIR}${file}`,
        }))
        .sort((a, b) => (a.id < b.id ? 1 : -1));
      setRuns(jsons);
    } catch (err) {
      console.warn('[Replayer] list error', err);
      setError('Failed to list recordings.');
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const loadRun = useCallback(
    async (path: string) => {
      try {
        const text = await FileSystem.readAsStringAsync(path);
        const parsed = JSON.parse(text) as PoseRun;
        setRun(parsed);
        setIndex(0);
      } catch (err) {
        console.warn('[Replayer] load error', err);
        setError('Failed to load recording.');
      }
    },
    [],
  );

  const packet: PosePacket | null = run?.packets[index] ?? null;

  const scaledKps = useMemo(() => {
    if (!packet) return [];
    return packet.kps.map((kp) => ({
      name: kp.name,
      x: kp.x * SCREEN_WIDTH,
      y: kp.y * PREVIEW_HEIGHT,
      c: kp.c,
    }));
  }, [packet]);

  const next = useCallback(() => {
    if (!run) return;
    setIndex((prev) => Math.min(prev + 1, run.packets.length - 1));
  }, [run]);

  const prev = useCallback(() => {
    if (!run) return;
    setIndex((prev) => Math.max(prev - 1, 0));
  }, [run]);

  const rewind = useCallback(() => setIndex(0), []);
  const fastForward = useCallback(() => {
    if (!run) return;
    setIndex(run.packets.length - 1);
  }, [run]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pose Replayer</Text>
        <View style={styles.headerButtons}>
          <Pressable style={styles.headerBtn} onPress={loadRuns}>
            <Text style={styles.headerBtnText}>Refresh</Text>
          </Pressable>
          {onClose ? (
            <Pressable style={styles.headerBtn} onPress={onClose}>
              <Text style={styles.headerBtnText}>Close</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!run ? (
        <View style={styles.listContainer}>
          <Text style={styles.subtitle}>Select a recording:</Text>
          {runs.length === 0 ? (
            <Text style={styles.emptyMsg}>No recordings found.</Text>
          ) : (
            <FlatList
              data={runs}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.runItem}
                  onPress={() => loadRun(item.path)}
                >
                  <Text style={styles.runId}>{item.id}</Text>
                  <Text style={styles.runPath}>{item.path}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      ) : (
        <View style={styles.viewer}>
          <View style={styles.metaRow}>
            <Pressable style={styles.metaBtn} onPress={() => setRun(null)}>
              <Text style={styles.metaBtnText}>Back to list</Text>
            </Pressable>
            <Text style={styles.metaText}>
              {run.exercise.toUpperCase()} • {index + 1}/{run.packets.length}{' '}
              frames • t={packet?.t ?? 0}ms
            </Text>
          </View>

          <View style={styles.preview}>
            {packet ? (
              <SkeletonOverlay
                width={SCREEN_WIDTH}
                height={PREVIEW_HEIGHT}
                kps={scaledKps}
                mirror={packet.camera?.mirror}
              />
            ) : null}
          </View>

          {packet ? (
            <View style={styles.details}>
              <Text style={styles.detailText}>
                FSM: {packet.fsm.state} • Reps: {packet.fsm.repCount}
              </Text>
              <Text style={styles.detailText}>
                depth: {packet.sig.squatDepth?.toFixed(2) ?? '—'} • kneeFlex:{' '}
                {packet.sig.kneeFlex?.toFixed(1) ?? '—'} • valgus:{' '}
                {packet.sig.valgus?.toFixed(2) ?? '—'}
              </Text>
            </View>
          ) : null}

          <View style={styles.controls}>
            <Pressable style={styles.controlBtn} onPress={rewind}>
              <Text style={styles.controlBtnText}>⏮</Text>
            </Pressable>
            <Pressable style={styles.controlBtn} onPress={prev}>
              <Text style={styles.controlBtnText}>◀︎</Text>
            </Pressable>
            <Pressable style={styles.controlBtn} onPress={next}>
              <Text style={styles.controlBtnText}>▶︎</Text>
            </Pressable>
            <Pressable style={styles.controlBtn} onPress={fastForward}>
              <Text style={styles.controlBtnText}>⏭</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerButtons: { flexDirection: 'row', gap: 10 },
  headerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1f1f1f',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  headerBtnText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  error: { color: '#ff6666', paddingHorizontal: 16, marginBottom: 8 },
  listContainer: { flex: 1, paddingHorizontal: 16 },
  subtitle: { color: '#fff', fontSize: 16, marginBottom: 8 },
  emptyMsg: { color: '#999' },
  runItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  runId: { color: '#fff', fontWeight: '700' },
  runPath: { color: '#bbbbbb', fontSize: 12, marginTop: 2 },
  viewer: { flex: 1 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  metaBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1f1f1f',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  metaBtnText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  metaText: { color: '#fff', fontSize: 14 },
  preview: {
    width: SCREEN_WIDTH,
    height: PREVIEW_HEIGHT,
    alignSelf: 'center',
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  details: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  detailText: { color: '#ddd', fontSize: 13 },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
  },
  controlBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1f1f1f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  controlBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
