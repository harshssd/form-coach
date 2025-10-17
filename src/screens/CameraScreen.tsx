import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  LayoutChangeEvent,
  Pressable,
  Modal,
  FlatList,
} from 'react-native';
import { useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import Svg, { Circle, Rect, Text as SvgText } from 'react-native-svg';
import { KP } from '../pose/utils';
import { PoseCamera } from '../camera/PoseCamera';
import { useCameraSelection } from '../camera/useCameraSelection';
import {
  usePoseStream,
  type PoseFramePayload,
} from '../pose/usePoseStream';
import { useSquatSession } from '../reps/useSquatSession';
import {
  addSession,
  listSessions,
  type SessionRecord,
} from '../storage/sessionStore';
import { last7DaysSummary, type DayBucket } from '../storage/selectors';
import { say } from '../voice/tts';

type RawPoint = {
  x: number;
  y: number;
  score?: number;
  name?: string;
};

export default function CameraScreen() {
  const {
    hasPermission,
    device,
    displayMirrored,
    cameraPosition,
    setCameraPosition,
    availablePositions,
    statusMessage,
  } = useCameraSelection('back');

  const [viewWidth, setViewWidth] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);

  const {
    keypoints,
    debug,
    handleFrame,
    reset: resetPoseStream,
  } = usePoseStream({
    viewWidth,
    viewHeight,
    displayMirrored,
  });

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [weekly, setWeekly] = useState<DayBucket[]>([]);

  const {
    session,
    rep,
    elapsed,
    start: startSession,
    pause: pauseSession,
    resume: resumeSession,
    reset: resetSession,
    getSummary,
  } = useSquatSession(keypoints, { onResetPoseStream: resetPoseStream });

  useEffect(() => {
    const list = listSessions();
    setHistory(list);
    setWeekly(last7DaysSummary(list));
  }, []);

  const pushFrame = useRunOnJS(
    (payload: PoseFramePayload | null) => {
      handleFrame(payload);
    },
    [handleFrame],
  );

  useEffect(() => {
    console.log(
      '[CameraScreen]',
      `hasPermission=${hasPermission}`,
      `device=${device?.name ?? 'none'}`,
      `keypoints=${keypoints.length}`,
      `session=${session}`,
    );
  }, [hasPermission, device, keypoints.length, session]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewWidth(width);
    setViewHeight(height);
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!(globalThis as any)._posePlugin) {
      (globalThis as any)._posePlugin = VisionCameraProxy.initFrameProcessorPlugin(
        'detectPose',
        {},
      );
    }
    const plugin = (globalThis as any)._posePlugin;
    if (plugin == null) {
      console.warn('[CameraScreen] Pose detection plugin not available');
      return;
    }

    const output = plugin.call(frame, {
      mode: 'stream',
      performanceMode: 'max',
    }) as Record<string, { x: number; y: number; score?: number }> | null;

    const width = frame.width ?? 0;
    const height = frame.height ?? 0;
    const orientation = Number(frame.orientation ?? 0);
    const isMirrored = Boolean(frame.isMirrored);

    const rawPoints: RawPoint[] = [];
    if (output) {
      for (const name in output) {
        const value = output[name];
        if (!value) continue;
        rawPoints.push({
          name,
          x: value.x,
          y: value.y,
          score: value.score,
        });
      }
    }

    if (rawPoints.length === 0) {
      pushFrame(null);
    } else {
      const payload: PoseFramePayload = {
        width,
        height,
        orientation,
        isMirrored,
        points: rawPoints,
      };
      pushFrame(payload);
    }
  }, [pushFrame]);

  if (!hasPermission) {
    return <Centered label="Requesting camera permission…" />;
  }

  const nextCameraPosition = cameraPosition === 'back' ? 'front' : 'back';
  const canSwitchCamera = availablePositions[nextCameraPosition];

  const endAndSave = useCallback(() => {
    if (session !== 'PAUSED') {
      return;
    }
    const summary = getSummary();
    const record: SessionRecord = {
      id: `${summary.endedAt}`,
      exercise: 'squat',
      reps: summary.reps,
      avgForm: summary.avgForm,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      durationMs: summary.durationMs,
    };
    addSession(record);
    const list = listSessions();
    setHistory(list);
    setWeekly(last7DaysSummary(list));
    say('session saved');
    resetSession({ speak: false });
  }, [session, getSummary, resetSession]);

  const openHistory = useCallback(() => {
    const list = listSessions();
    setHistory(list);
    setWeekly(last7DaysSummary(list));
    setHistoryOpen(true);
  }, []);

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  if (!device) {
    return (
      <Centered
        label={statusMessage ?? 'No camera device found'}
      />
    );
  }

  return (
    <>
      <View style={styles.container} onLayout={onLayout}>
        <PoseCamera
          device={device}
          displayMirrored={displayMirrored}
          frameProcessor={frameProcessor}
          isActive
        pixelFormat="yuv"
      >
        <PoseOverlay
          width={viewWidth}
          height={viewHeight}
          keypoints={session === 'ACTIVE' ? keypoints : []}
        />
      </PoseCamera>

      <View style={styles.overlay}>
        <Text style={styles.overlayText}>POSE: {keypoints.length} pts</Text>
        {debug ? <Text style={styles.debugText}>{debug}</Text> : null}
      </View>

      <View style={styles.hud}>
        <Text style={styles.hudLabel}>SQUATS</Text>
        <Text style={styles.hudCount}>{rep.count}</Text>
        <Text style={styles.hudLabel}>Form: {rep.score}</Text>
        <Text style={styles.hudState}>
          {session} • {(elapsed / 1000).toFixed(1)}s
        </Text>
      </View>

        <View style={styles.controls}>
          {session === 'IDLE' && <Btn label="Start" onPress={startSession} />}
          {session === 'ACTIVE' && <Btn label="Pause" onPress={pauseSession} />}
          {session === 'PAUSED' && <Btn label="Resume" onPress={resumeSession} />}
          {(session === 'ACTIVE' || session === 'PAUSED') && (
            <Btn label="Reset" onPress={() => resetSession()} />
          )}
          {session === 'PAUSED' && (
            <Btn label="End & Save" onPress={endAndSave} />
          )}
          <Btn label="History" onPress={openHistory} />
          <Btn
            label={cameraPosition === 'back' ? 'Front' : 'Back'}
            onPress={() => canSwitchCamera && setCameraPosition(nextCameraPosition)}
            disabled={!canSwitchCamera}
          />
        </View>
      </View>

      <Modal
        visible={historyOpen}
        transparent
        animationType="slide"
        onRequestClose={closeHistory}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>History</Text>
              <Pressable style={styles.modalClose} onPress={closeHistory}>
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>
            {weekly.length > 0 && <WeeklyChart data={weekly} />}
            <View style={styles.legendRow}>
              <Text style={styles.legendText}>Bars: Reps</Text>
              <Text style={styles.legendText}>Tick: Avg form</Text>
            </View>
            <FlatList
              data={history}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.historyRow}>
                  <Text style={styles.historyTime}>
                    {new Date(item.endedAt).toLocaleString()}
                  </Text>
                  <Text style={styles.historySummary}>
                    {item.exercise.toUpperCase()} • {item.reps} reps • {item.avgForm}% • {fmtDuration(item.durationMs)}
                  </Text>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.historyEmpty}>No sessions yet.</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function fmtDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function WeeklyChart({ data }: { data: DayBucket[] }) {
  if (!data.length) {
    return null;
  }

  const width = 320;
  const height = 150;
  const padding = 14;
  const barGap = 8;
  const barWidth = Math.max(8, Math.floor((width - padding * 2 - (data.length - 1) * barGap) / data.length));
  const maxReps = Math.max(1, ...data.map((d) => d.reps));

  return (
    <Svg
      width={width}
      height={height}
      style={{ alignSelf: 'center', marginVertical: 8 }}
    >
      <SvgText
        x={padding}
        y={12}
        fontSize={10}
        fill="white"
        opacity={0.7}
      >
        Last 7 days
      </SvgText>
      <SvgText
        x={width - padding}
        y={12}
        fontSize={10}
        fill="white"
        opacity={0.7}
        textAnchor="end"
      >
        reps / avg form
      </SvgText>

      {data.map((day, idx) => {
        const x = padding + idx * (barWidth + barGap);
        const chartHeight = height - 40;
        const barHeight = Math.round((chartHeight * day.reps) / maxReps);
        const y = height - 28 - barHeight;
        const tickWidth = Math.max(2, Math.round((barWidth * day.avgForm) / 100));

        return (
          <React.Fragment key={day.dateKey}>
            <Rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={4}
              fill="#3FA9F5"
              opacity={day.reps === 0 ? 0.25 : 0.9}
            />
            <Rect
              x={x}
              y={height - 30}
              width={barWidth}
              height={2}
              fill="#ffffff33"
            />
            <Rect
              x={x}
              y={height - 30}
              width={tickWidth}
              height={2}
              fill="#FFD166"
            />
            <SvgText
              x={x + barWidth / 2}
              y={height - 8}
              fontSize={10}
              fill="white"
              textAnchor="middle"
              opacity={0.85}
            >
              {day.label}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

function PoseOverlay({
  width,
  height,
  keypoints,
}: {
  width: number;
  height: number;
  keypoints: KP[];
}) {
  if (!width || !height) {
    return null;
  }

  return (
    <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFill}>
      {keypoints.map((kp, index) => (
        <Circle
          key={`${kp.name ?? 'kp'}-${index}`}
          cx={kp.x * width}
          cy={kp.y * height}
          r={4}
          fill="#ffffff"
          opacity={kp.score != null ? Math.max(0.2, Math.min(1, kp.score)) : 0.9}
        />
      ))}
    </Svg>
  );
}

function Centered({ label }: { label: string }) {
  return (
    <View style={[styles.container, styles.center]}>
      <Text style={styles.centerText}>{label}</Text>
    </View>
  );
}

function Btn({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.btn, disabled && styles.btnDisabled]}
    >
      <Text style={[styles.btnText, disabled && styles.btnTextDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  centerText: { color: '#ffffff', fontSize: 16, fontWeight: '500' },
  overlay: {
    position: 'absolute',
    top: 40,
    left: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#00000080',
    borderRadius: 8,
  },
  overlayText: { color: '#ffffff', fontWeight: '600', letterSpacing: 1 },
  debugText: { color: '#ffffff', marginTop: 4, fontSize: 12 },
  hud: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    padding: 12,
    backgroundColor: '#000000b0',
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 160,
  },
  hudLabel: { color: '#ffffff', fontWeight: '600', letterSpacing: 1 },
  hudCount: { color: '#ffffff', fontSize: 48, fontWeight: '800', lineHeight: 50 },
  hudState: { color: '#ffffff', marginTop: 4, fontSize: 14 },
  controls: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    flexDirection: 'row',
    columnGap: 10,
  },
  btn: {
    backgroundColor: '#1f1f1f',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  btnDisabled: {
    backgroundColor: '#1f1f1f80',
    borderColor: '#3a3a3a80',
  },
  btnText: { color: '#ffffff', fontWeight: '700' },
  btnTextDisabled: { color: '#ffffff60' },
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#111',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  modalClose: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#222',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  historyRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
  },
  historyTime: { color: '#ffffff', fontWeight: '700' },
  historySummary: { color: '#ffffff', opacity: 0.85, marginTop: 4 },
  historyEmpty: {
    color: '#ffffff',
    opacity: 0.6,
    textAlign: 'center',
    paddingVertical: 16,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    columnGap: 16,
    marginBottom: 8,
  },
  legendText: { color: '#ffffff', opacity: 0.75, fontSize: 12 },
});
