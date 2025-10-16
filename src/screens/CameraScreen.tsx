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
import {
  Camera,
  type CameraDevice,
  useCameraDevices,
  useCameraPermission,
  useFrameProcessor,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import Svg, { Circle } from 'react-native-svg';
import { KP } from '../pose/utils';
import { initialRep, updateSquatFSM } from '../pose/squatCounter';
import { say } from '../voice/tts';

type RawPoint = {
  x: number;
  y: number;
  name?: string;
};

type PoseFrame = {
  width: number;
  height: number;
  orientation: number;
  isMirrored: boolean;
  points: RawPoint[];
};

type SessionState = 'IDLE' | 'ACTIVE' | 'PAUSED';

export default function CameraScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const devices = useCameraDevices();
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');

  const allDevices = useMemo(() => {
    const values = devices ? Object.values(devices) : [];
    return (values as (CameraDevice | undefined)[]).filter(
      (d): d is CameraDevice => d != null,
    );
  }, [devices]);

  const backDevice = useMemo(
    () =>
      allDevices.find((d) => d.position === 'back') ??
      allDevices.find((d) => d.position !== 'front'),
    [allDevices],
  );
  const frontDevice = useMemo(
    () =>
      allDevices.find((d) => d.position === 'front') ??
      backDevice ??
      allDevices[0],
    [allDevices, backDevice],
  );

  const device =
    cameraPosition === 'back'
      ? backDevice ?? frontDevice ?? null
      : frontDevice ?? backDevice ?? null;

  const [viewWidth, setViewWidth] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  const [poseFrame, setPoseFrame] = useState<PoseFrame | null>(null);
  const [debug, setDebug] = useState<string | null>(null);
  const [rep, setRep] = useState(initialRep);
  const [session, setSession] = useState<SessionState>('IDLE');
  const [elapsed, setElapsed] = useState(0);

  const sessionStartRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastStateRef = useRef(rep.state);
  const lastCountRef = useRef(rep.count);

  const setPoseFrameOnJS = useRunOnJS((data: PoseFrame | null) => {
    setPoseFrame(data);
  }, []);
  const setDebugOnJS = useRunOnJS((value: string) => {
    setDebug(value);
  }, []);

  useEffect(() => {
    (async () => {
      if (!hasPermission) {
        await requestPermission();
      }
    })();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (cameraPosition === 'back' && !backDevice && frontDevice) {
      setCameraPosition('front');
    } else if (cameraPosition === 'front' && !frontDevice && backDevice) {
      setCameraPosition('back');
    }
  }, [cameraPosition, backDevice, frontDevice]);

  useEffect(() => {
    console.log(
      '[CameraScreen]',
      `hasPermission=${hasPermission}`,
      `device=${device?.name ?? 'none'}`,
      `posePoints=${poseFrame?.points.length ?? 0}`,
      `orientation=${poseFrame?.orientation ?? 'n/a'}`,
      `session=${session}`,
    );
  }, [hasPermission, device, poseFrame, session]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (session === 'ACTIVE') {
      timerRef.current = setInterval(() => {
        if (sessionStartRef.current != null) {
          setElapsed(Date.now() - sessionStartRef.current);
        }
      }, 200);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [session]);

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
    }) as Record<string, { x: number; y: number }> | null | undefined;

    const width = frame.width ?? 0;
    const height = frame.height ?? 0;
    const orientation = Number(frame.orientation ?? 0);
    const isMirrored = Boolean(frame.isMirrored);

    const rawPoints: RawPoint[] = [];
    if (output) {
      for (const name in output) {
        const value = output[name];
        if (value && typeof value.x === 'number' && typeof value.y === 'number') {
          rawPoints.push({ name, x: value.x, y: value.y });
        }
      }
    }

    if (rawPoints.length === 0) {
      setPoseFrameOnJS(null);
    } else {
      setPoseFrameOnJS({
        width,
        height,
        orientation,
        isMirrored,
        points: rawPoints,
      });
    }

    if (output) {
      setDebugOnJS(
        `pts:${rawPoints.length} w:${width} h:${height} orient:${orientation} mirrored:${isMirrored}`,
      );
    }
  }, [setPoseFrameOnJS, setDebugOnJS]);

  const actualPosition = device?.position === 'front' ? 'front' : 'back';
  const displayMirrored = actualPosition === 'front';

  const keypoints = useMemo(() => {
    if (!poseFrame || !viewWidth || !viewHeight) {
      return [] as KP[];
    }
    return transformPosePoints(poseFrame, viewWidth, viewHeight, displayMirrored);
  }, [poseFrame, viewWidth, viewHeight, displayMirrored]);

  useEffect(() => {
    if (session !== 'ACTIVE') {
      return;
    }
    setRep((prev) => {
      const next = updateSquatFSM(prev, keypoints);

      if (next.state !== lastStateRef.current) {
        if (next.state === 'BOTTOM') {
          say('down');
        } else if (next.state === 'TOP' && next.count > prev.count) {
          say('up');
        }
        lastStateRef.current = next.state;
      }

      if (next.count !== lastCountRef.current) {
        if (next.score >= 90) {
          say('nice depth', 500);
        }
        lastCountRef.current = next.count;
      }

      if (next.score < 70) {
        say('knees out');
      }

      return next;
    });
  }, [keypoints, session]);

  const start = useCallback(() => {
    setRep(initialRep);
    lastStateRef.current = initialRep.state;
    lastCountRef.current = initialRep.count;
    sessionStartRef.current = Date.now();
    setElapsed(0);
    setSession('ACTIVE');
    say('session started');
  }, []);

  const pause = useCallback(() => {
    if (sessionStartRef.current != null) {
      setElapsed(Date.now() - sessionStartRef.current);
    }
    setSession('PAUSED');
    say('paused');
  }, []);

  const resume = useCallback(() => {
    if (sessionStartRef.current != null) {
      sessionStartRef.current = Date.now() - elapsed;
    } else {
      sessionStartRef.current = Date.now() - elapsed;
    }
    setSession('ACTIVE');
    say('resumed');
  }, [elapsed]);

  const reset = useCallback(() => {
    setSession('IDLE');
    setElapsed(0);
    sessionStartRef.current = null;
    setRep(initialRep);
    lastStateRef.current = initialRep.state;
    lastCountRef.current = initialRep.count;
    say('reset');
  }, []);

  if (!hasPermission) {
    return <Centered label="Requesting camera permission…" />;
  }

  if (!device) {
    return (
      <Centered
        label={
          allDevices.length === 0 ? 'Loading camera devices…' : 'No camera device found'
        }
      />
    );
  }

  return (
    <View style={styles.container} onLayout={onLayout}>
      <View
        style={[
          StyleSheet.absoluteFill,
          displayMirrored && styles.mirrored,
        ]}
      >
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
        />
        <PoseOverlay
          width={viewWidth}
          height={viewHeight}
          keypoints={session === 'ACTIVE' ? keypoints : []}
        />
      </View>

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
        {session === 'IDLE' && <Btn label="Start" onPress={start} />}
        {session === 'ACTIVE' && <Btn label="Pause" onPress={pause} />}
        {session === 'PAUSED' && <Btn label="Resume" onPress={resume} />}
        {(session === 'ACTIVE' || session === 'PAUSED') && (
          <Btn label="Reset" onPress={reset} />
        )}
        <Btn
          label={cameraPosition === 'back' ? 'Front' : 'Back'}
          onPress={() =>
            setCameraPosition((pos) => (pos === 'back' ? 'front' : 'back'))
          }
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

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.btn}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  mirrored: { transform: [{ scaleX: -1 }] },
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
  btnText: { color: '#ffffff', fontWeight: '700' },
});
