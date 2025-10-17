import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  LayoutChangeEvent,
  Pressable,
} from 'react-native';
import { useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import Svg, { Circle } from 'react-native-svg';
import { KP } from '../pose/utils';
import { PoseCamera } from '../camera/PoseCamera';
import { useCameraSelection } from '../camera/useCameraSelection';
import {
  usePoseStream,
  type PoseFramePayload,
} from '../pose/usePoseStream';
import { useSquatSession } from '../reps/useSquatSession';

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

  const {
    session,
    rep,
    elapsed,
    start: startSession,
    pause: pauseSession,
    resume: resumeSession,
    reset: resetSession,
  } = useSquatSession(keypoints, { onResetPoseStream: resetPoseStream });

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

  if (!device) {
    return (
      <Centered
        label={statusMessage ?? 'No camera device found'}
      />
    );
  }

  return (
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
          <Btn label="Reset" onPress={resetSession} />
        )}
        <Btn
          label={cameraPosition === 'back' ? 'Front' : 'Back'}
          onPress={() => canSwitchCamera && setCameraPosition(nextCameraPosition)}
          disabled={!canSwitchCamera}
        />
      </View>
    </View>
  );
}

function transformPosePoints(
  data: PoseFrame,
  viewWidth: number,
  viewHeight: number,
  displayMirrored: boolean,
): KP[] {
  const { width, height, orientation, isMirrored, points } = data;
  if (!width || !height || points.length === 0) {
    return [];
  }

  const normalizedOrientation = ((orientation % 360) + 360) % 360;
  const rotatedWidth = normalizedOrientation % 180 === 0 ? width : height;
  const rotatedHeight = normalizedOrientation % 180 === 0 ? height : width;

  const scale = Math.max(viewWidth / rotatedWidth, viewHeight / rotatedHeight);
  const scaledWidth = rotatedWidth * scale;
  const scaledHeight = rotatedHeight * scale;
  const offsetX = (scaledWidth - viewWidth) / 2;
  const offsetY = (scaledHeight - viewHeight) / 2;

  const result: KP[] = [];
  for (const point of points) {
    let { x, y } = rotatePoint(point.x, point.y, width, height, normalizedOrientation);
    const shouldMirror = displayMirrored ? !isMirrored : isMirrored;
    if (shouldMirror) {
      x = rotatedWidth - x;
    }

    const scaledX = x * scale - offsetX;
    const scaledY = y * scale - offsetY;

    const normX = scaledX / viewWidth;
    const normY = scaledY / viewHeight;

    if (Number.isFinite(normX) && Number.isFinite(normY)) {
      result.push({
        name: point.name,
        x: clamp01(normX),
        y: clamp01(normY),
        score: point.score,
      });
    }
  }

  return result;
}

function rotatePoint(
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: number,
): { x: number; y: number } {
  switch (orientation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - y, y: x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: y, y: width - x };
    default:
      return { x, y };
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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
});
