import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Rect, Text as SvgText } from 'react-native-svg';
import { useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { PoseCamera } from '../camera/PoseCamera';
import { useCameraSelection } from '../camera/useCameraSelection';
import { poseRecorder } from '../devtools/poseRecorder';
import {
  usePoseStream,
  type PoseFramePayload,
} from '../pose/usePoseStream';
import { KP } from '../pose/utils';
import {
  useExerciseSession,
  type Exercise,
} from '../reps/useExerciseSession';
import {
  currentStreak,
  last7DaysSummary,
  todayTotals,
  weekTotals,
  type DayBucket,
} from '../storage/selectors';
import {
  addSession,
  listSessions,
  type SessionRecord,
} from '../storage/sessionStore';
import {
  loadSettings,
  saveSettings,
  type ExerciseSettings,
} from '../storage/settingsStore';
import type { PosePacket } from '../types/recording';
import { say } from '../voice/tts';

type RawPoint = {
  x: number;
  y: number;
  score?: number;
  name?: string;
  c?: number;
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
    signals,
    baseline,
    debug,
    handleFrame,
    reset: resetPoseStream,
    setCalibrationActive,
    resetCalibration,
    calibrationWindowMs,
    frameMeta,
  } = usePoseStream({
    viewWidth,
    viewHeight,
    displayMirrored,
  });

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [weekly, setWeekly] = useState<DayBucket[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [dash, setDash] = useState<{
    today: ReturnType<typeof todayTotals>;
    week: ReturnType<typeof weekTotals>;
    streak: number;
  } | null>(null);

  const [exercise, setExercise] = useState<Exercise>('squat');
  const [settings, setSettings] = useState<ExerciseSettings>(() =>
    loadSettings('squat'),
  );
  const [recording, setRecording] = useState(false);
  const [lastRecordingPath, setLastRecordingPath] = useState<string | null>(
    null,
  );
  const [runsOpen, setRunsOpen] = useState(false);
  const [runs, setRuns] = useState<{ id: string; path: string }[]>([]);

  const {
    session,
    rep,
    elapsed,
    start: startSession,
    pause: pauseSession,
    resume: resumeSession,
    reset: resetSession,
    getSummary,
    calibrating,
    calibrationProgress,
  } = useExerciseSession(keypoints, baseline, {
    exercise,
    settings,
    onResetPoseStream: resetPoseStream,
    setCalibrationActive,
    resetCalibration,
    calibrationWindowMs,
  });

  useEffect(() => {
    const list = listSessions();
    setHistory(list);
    setWeekly(last7DaysSummary(list));
  }, []);

  useEffect(() => {
    setSettings(loadSettings(exercise));
  }, [exercise]);

  const exercises: Exercise[] = ['squat', 'pushup'];

  const toggleRecording = useCallback(async () => {
    try {
      if (!recording) {
        const id = `run-${new Date()
          .toISOString()
          .replace(/[:.]/g, '-')}`;
        await poseRecorder.start(id, exercise);
        setLastRecordingPath(null);
        setRecording(true);
        console.log('[PoseRecorder] Recording started', id);
      } else {
        const saved = await poseRecorder.stopAndSave();
        setRecording(false);
        if (saved?.jsonPath) {
          setLastRecordingPath(saved.jsonPath);
          console.log('[PoseRecorder] Saved run', saved.jsonPath);
        }
      }
    } catch (error) {
      console.warn('[PoseRecorder] toggle failed', error);
      setRecording(false);
    }
  }, [exercise, recording]);

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
      `exercise=${exercise}`,
    );
  }, [hasPermission, device, keypoints.length, session, exercise]);

  const openRuns = useCallback(async () => {
    try {
      const list = await poseRecorder.listRuns();
      setRuns(list.slice().reverse());
      setRunsOpen(true);
    } catch (error) {
      console.warn('[PoseRecorder] listRuns failed', error);
    }
  }, []);

  const closeRuns = useCallback(() => {
    setRunsOpen(false);
  }, []);

  useEffect(() => {
    if (!recording) {
      return;
    }
    if (keypoints.length === 0) {
      return;
    }

    const recordedKps = keypoints
      .filter((kp): kp is KP & { name: string } => Boolean(kp.name))
      .map((kp) => ({
        name: kp.name as string,
        x: kp.x,
        y: kp.y,
        c: kp.score ?? 1,
      }));

    if (recordedKps.length === 0) {
      return;
    }

    const sig: PosePacket['sig'] = {};
    const assign = <K extends keyof PosePacket['sig']>(
      key: K,
      value: number,
    ) => {
      if (Number.isFinite(value)) {
        sig[key] = value;
      }
    };

    assign('squatDepth', signals.squatDepth);
    assign('kneeFlex', signals.kneeFlex);
    assign('valgus', signals.valgus);
    assign('elbowFlex', signals.elbowFlex);
    assign('plankStraight', signals.plankStraight);

    poseRecorder.push({
      exercise,
      camera: {
        front: cameraPosition === 'front',
        mirror: frameMeta.mirror,
        orientation: frameMeta.orientation,
      },
      kps: recordedKps,
      sig,
      fsm: {
        state: (rep as typeof rep & { state?: string }).state ?? session,
        repCount: rep.count ?? 0,
      },
    });
  }, [
    cameraPosition,
    exercise,
    frameMeta.mirror,
    frameMeta.orientation,
    keypoints,
    recording,
    rep,
    session,
    signals.elbowFlex,
    signals.kneeFlex,
    signals.plankStraight,
    signals.squatDepth,
    signals.valgus,
  ]);

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
          c: value.score,
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
  const calibrationProgressClamped = Math.max(
    0,
    Math.min(1, calibrationProgress),
  );
  const calibrationPercent = Math.round(calibrationProgressClamped * 100);
  const baselineReady = baseline.ready || baseline.hipWidth > 0.05;
  const baselineHipText =
    baseline.hipWidth > 0 ? baseline.hipWidth.toFixed(3) : '0.000';
  const baselineKneeNorm =
    baseline.hipWidth > 0 && baseline.kneeWidth > 0
      ? (baseline.kneeWidth / baseline.hipWidth).toFixed(2)
      : '--';
  const baselineTiltText = Number.isFinite(baseline.torsoTilt)
    ? baseline.torsoTilt.toFixed(1)
    : '0.0';

  const endAndSave = useCallback(() => {
    if (session !== 'PAUSED') {
      return;
    }
    const summary = getSummary();
    const record: SessionRecord = {
      id: `${summary.endedAt}`,
      exercise,
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
    if (settings.enableVoice) {
      say('session saved');
    }
    resetSession({ speak: false });
  }, [session, getSummary, resetSession, exercise, settings.enableVoice]);

  const openHistory = useCallback(() => {
    const list = listSessions();
    setHistory(list);
    setWeekly(last7DaysSummary(list));
    setHistoryOpen(true);
  }, []);

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  const openDashboard = useCallback(() => {
    const list = listSessions();
    setDash({
      today: todayTotals(list),
      week: weekTotals(list),
      streak: currentStreak(list),
    });
    setDashOpen(true);
  }, []);

  const closeDashboard = useCallback(() => {
    setDashOpen(false);
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
            keypoints={
              session === 'ACTIVE' || session === 'CALIBRATING'
                ? keypoints
                : []
            }
          />
        </PoseCamera>

        {calibrating ? (
          <View style={styles.calibrationOverlay}>
            <Text style={styles.calibrationTitle}>
              Hold still to calibrate stance…
            </Text>
            <View style={styles.calibrationBar}>
              <View
                style={[
                  styles.calibrationBarFill,
                  { width: `${calibrationPercent}%` },
                ]}
              />
            </View>
            <Text style={styles.calibrationProgressText}>
              {calibrationPercent}%
            </Text>
          </View>
        ) : null}

      <View style={styles.overlay}>
        <Text style={styles.overlayText}>POSE: {keypoints.length} pts</Text>
        <Text style={styles.overlayMeta}>
          CAL: {baselineReady ? 'ready' : `${calibrationPercent}%`} • hip {baselineHipText} • knee/hip {baselineKneeNorm} • tilt {baselineTiltText}°
        </Text>
        {recording ? <Text style={styles.overlayRec}>REC</Text> : null}
        {lastRecordingPath ? (
          <Text style={styles.overlayPath}>
            last: {lastRecordingPath.split('/').pop()}
          </Text>
        ) : null}
        {debug ? <Text style={styles.debugText}>{debug}</Text> : null}
      </View>

      <View style={styles.controlsSection}>
        <View style={styles.hudStrip}>
          <View style={styles.hudBlock}>
            <Text style={styles.hudExercise}>{exercise.toUpperCase()}</Text>
            <Text style={styles.hudLabel}>REPS</Text>
            <Text style={styles.hudCount}>{rep.count}</Text>
          </View>
          <View style={styles.hudBlock}>
            <Text style={styles.hudLabel}>Form</Text>
            <Text style={styles.hudCountSmall}>{rep.score}</Text>
            <Text style={styles.hudState}>
              {session} • {(elapsed / 1000).toFixed(1)}s
            </Text>
          </View>
          <View style={styles.hudBlockWide}>
            <Text style={styles.signalText}>
              depth {signals.squatDepth.toFixed(2)} • knee° {Math.round(signals.kneeFlex)} • valgus {signals.valgus.toFixed(2)}
            </Text>
            <Text style={styles.signalText}>
              elbow° {Math.round(signals.elbowFlex)} • plank {signals.plankStraight.toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={styles.controlRow}>
          {session === 'IDLE' && (
            <View style={styles.controlCell}>
              <Btn label="Start" onPress={startSession} />
              </View>
            )}
            {session === 'ACTIVE' && (
              <View style={styles.controlCell}>
                <Btn label="Pause" onPress={pauseSession} />
              </View>
            )}
            {session === 'PAUSED' && (
              <View style={styles.controlCell}>
                <Btn label="Resume" onPress={resumeSession} />
              </View>
            )}
            {(session === 'ACTIVE' || session === 'PAUSED') && (
              <View style={styles.controlCell}>
                <Btn label="Reset" onPress={() => resetSession()} />
              </View>
            )}
            {session === 'PAUSED' && (
              <View style={styles.controlCell}>
                <Btn label="End & Save" onPress={endAndSave} />
              </View>
            )}
            <View style={styles.controlCell}>
              <Btn
                label={cameraPosition === 'back' ? 'Front' : 'Back'}
                onPress={() =>
                  canSwitchCamera && setCameraPosition(nextCameraPosition)
                }
                disabled={!canSwitchCamera}
              />
            </View>
          </View>

          <View style={[styles.controlRow, styles.controlRowSecondary]}>
            <View style={styles.controlCell}>
              <Btn
                label={recording ? 'Stop Rec' : 'Start Rec'}
                onPress={toggleRecording}
              />
            </View>
            <View style={styles.controlCell}>
              <Btn label="Recordings" onPress={openRuns} />
            </View>
            <View style={styles.controlCell}>
              <Btn label="History" onPress={openHistory} />
            </View>
            <View style={styles.controlCell}>
              <Btn label="Dashboard" onPress={openDashboard} />
            </View>
            <View style={styles.controlCell}>
              <Btn
                label="Exercise"
                onPress={() => setPickerOpen(true)}
                disabled={session !== 'IDLE'}
              />
            </View>
            <View style={styles.controlCell}>
              <Btn
                label="Settings"
                onPress={() => {
                  setSettings(loadSettings(exercise));
                  setSettingsOpen(true);
                }}
              />
            </View>
          </View>
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
            {weekly.length > 0 && (
              <>
                <WeeklyChart data={weekly} />
                <View style={styles.legendRow}>
                  <Text style={styles.legendText}>Bars: Reps</Text>
                  <Text style={styles.legendText}>Tick: Avg form</Text>
                </View>
              </>
            )}
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

      <Modal
        visible={runsOpen}
        transparent
        animationType="slide"
        onRequestClose={closeRuns}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Recordings</Text>
              <Pressable style={styles.modalClose} onPress={closeRuns}>
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>
            {runs.length === 0 ? (
              <Text style={styles.historyEmpty}>No recordings saved yet.</Text>
            ) : (
              <FlatList
                data={runs}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={styles.runRow}>
                    <Text style={styles.runTitle}>{item.id}</Text>
                    <Text style={styles.runPath}>{item.path}</Text>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={settingsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{exercise.toUpperCase()} Settings</Text>
              <Pressable
                style={styles.modalClose}
                onPress={() => setSettingsOpen(false)}
              >
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            <View style={{ marginVertical: 10 }}>
              <Text style={styles.settingLabel}>Depth threshold (°)</Text>
              <View style={styles.settingStepper}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() =>
                    setSettings((s) => ({
                      ...s,
                      depthThreshold: Math.max(40, s.depthThreshold - 5),
                    }))
                  }
                >
                  <Text style={styles.btnText}>−</Text>
                </Pressable>
                <Text style={styles.stepValue}>{settings.depthThreshold}</Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() =>
                    setSettings((s) => ({
                      ...s,
                      depthThreshold: Math.min(170, s.depthThreshold + 5),
                    }))
                  }
                >
                  <Text style={styles.btnText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ marginVertical: 10 }}>
              <Pressable
                style={styles.toggleRow}
                onPress={() =>
                  setSettings((s) => ({
                    ...s,
                    enableVoice: !s.enableVoice,
                  }))
                }
              >
                <Text style={styles.toggleText}>Voice cues</Text>
                <Text style={styles.toggleText}>
                  {settings.enableVoice ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.toggleRow}
                onPress={() =>
                  setSettings((s) => ({
                    ...s,
                    enableTechniqueCues: !s.enableTechniqueCues,
                  }))
                }
              >
                <Text style={styles.toggleText}>Technique cues</Text>
                <Text style={styles.toggleText}>
                  {settings.enableTechniqueCues ? 'ON' : 'OFF'}
                </Text>
              </Pressable>
            </View>

            <Pressable
              style={[styles.modalClose, { alignSelf: 'center', marginTop: 20 }]}
              onPress={() => {
                const payload: ExerciseSettings = {
                  ...settings,
                  name: exercise,
                };
                saveSettings(payload);
                if (settings.enableVoice) {
                  say('settings saved');
                }
                setSettings(payload);
                setSettingsOpen(false);
              }}
            >
              <Text style={styles.btnText}>Save Settings</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={[styles.modalCard, { paddingBottom: 24 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Exercise</Text>
              <Pressable
                style={styles.modalClose}
                onPress={() => setPickerOpen(false)}
              >
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            {exercises.map((item) => {
              const active = item === exercise;
              return (
                <Pressable
                  key={item}
                  style={[styles.pickerRow, active && styles.pickerRowActive]}
                  onPress={() => {
                    setExercise(item);
                    setSettings(loadSettings(item));
                    setPickerOpen(false);
                  }}
                >
                  <Text style={styles.pickerText}>{item.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal
        visible={dashOpen}
        transparent
        animationType="slide"
        onRequestClose={closeDashboard}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Dashboard</Text>
              <Pressable
                style={styles.modalClose}
                onPress={closeDashboard}
              >
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            {dash && (
              <View>
                <View style={styles.dashboardRow}>
                  <View style={styles.card}>
                    <Text style={styles.cardH}>Today</Text>
                    <Text style={styles.cardBig}>{dash.today.reps}</Text>
                    <Text style={styles.cardS}>
                      {dash.today.sessions} session
                      {dash.today.sessions === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.cardH}>7-Day</Text>
                    <Text style={styles.cardBig}>{dash.week.reps}</Text>
                    <Text style={styles.cardS}>
                      {dash.week.sessions} session
                      {dash.week.sessions === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.cardH}>Streak</Text>
                    <Text style={styles.cardBig}>{dash.streak}d</Text>
                    <Text style={styles.cardS}>consecutive days</Text>
                  </View>
                </View>

                <View style={{ marginTop: 16 }}>
                  <Text style={styles.modalTitle}>Today</Text>
                  {Object.keys(dash.today.perExercise).length === 0 ? (
                    <Text style={styles.historyEmpty}>
                      No work logged today.
                    </Text>
                  ) : (
                    Object.entries(dash.today.perExercise).map(([key, value]) => (
                      <View key={key} style={styles.row}>
                        <Text style={styles.rowT}>{key.toUpperCase()}</Text>
                        <Text style={styles.rowS}>{value} reps</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
            )}
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
  overlayMeta: { color: '#ffffffcc', fontSize: 12, marginTop: 2 },
  overlayRec: {
    color: '#FF4D4F',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  overlayPath: {
    color: '#ffffff88',
    fontSize: 10,
    marginTop: 2,
  },
  debugText: { color: '#ffffff', marginTop: 4, fontSize: 12 },
  calibrationOverlay: {
    position: 'absolute',
    top: 120,
    left: 20,
    right: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: '#000000cc',
    borderRadius: 14,
    alignItems: 'center',
    gap: 12,
  },
  calibrationTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  calibrationBar: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff26',
    overflow: 'hidden',
  },
  calibrationBarFill: {
    height: '100%',
    backgroundColor: '#3FA9F5',
  },
  calibrationProgressText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  hudExercise: {
    color: '#ffffff',
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  hudLabel: { color: '#ffffff', fontWeight: '600', letterSpacing: 1 },
  hudCount: { color: '#ffffff', fontSize: 48, fontWeight: '800', lineHeight: 50 },
  hudState: { color: '#ffffff', marginTop: 4, fontSize: 14 },
  signalText: { color: '#ffffff', fontSize: 12, marginBottom: 2 },
  controlsSection: {
    position: 'absolute',
    bottom: 24,
    width: '100%',
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 12,
  },
  hudStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  hudBlock: {
    backgroundColor: '#000000aa',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 110,
  },
  hudBlockWide: {
    flex: 1,
    backgroundColor: '#000000aa',
    padding: 12,
    borderRadius: 12,
  },
  hudCountSmall: { color: '#ffffff', fontSize: 36, fontWeight: '700' },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  controlRowSecondary: {
    marginTop: 4,
  },
  controlCell: {
    minWidth: 90,
    marginHorizontal: 6,
    marginVertical: 2,
    flexBasis: '22%',
    flexGrow: 1,
  },
  btn: {
    backgroundColor: '#1f1f1f',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    alignItems: 'center',
    justifyContent: 'center',
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
  runRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
  },
  runTitle: { color: '#ffffff', fontWeight: '700' },
  runPath: { color: '#ffffff88', marginTop: 4, fontSize: 12 },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 8,
  },
  legendText: { color: '#ffffff', opacity: 0.75, fontSize: 12 },
  settingLabel: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  settingStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 12,
  },
  stepBtn: {
    backgroundColor: '#222',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  stepValue: { color: '#ffffff', width: 50, textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 8,
  },
  toggleText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  pickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 10,
    backgroundColor: '#1a1a1a',
  },
  pickerRowActive: {
    borderColor: '#3FA9F5',
    backgroundColor: '#1f2a36',
  },
  pickerText: { color: '#ffffff', fontWeight: '700', textAlign: 'center' },
  dashboardRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  card: {
    flex: 1,
    backgroundColor: '#181818',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#262626',
  },
  cardH: { color: '#aaaaaa', fontSize: 12, marginBottom: 6 },
  cardBig: { color: '#ffffff', fontSize: 24, fontWeight: '800' },
  cardS: { color: '#cccccc', fontSize: 12, marginTop: 2 },
});
