import { useEffect, useMemo, useState } from 'react';
import {
  type CameraDevice,
  useCameraDevices,
  useCameraPermission,
} from 'react-native-vision-camera';

type CameraPosition = 'back' | 'front';

export type CameraSelection = {
  hasPermission: boolean;
  device: CameraDevice | null;
  displayMirrored: boolean;
  cameraPosition: CameraPosition;
  setCameraPosition: (position: CameraPosition) => void;
  availablePositions: Record<CameraPosition, boolean>;
  statusMessage: string | null;
};

export function useCameraSelection(
  defaultPosition: CameraPosition = 'back',
): CameraSelection {
  const { hasPermission, requestPermission } = useCameraPermission();
  const devices = useCameraDevices();
  const [cameraPosition, setCameraPosition] =
    useState<CameraPosition>(defaultPosition);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

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

  useEffect(() => {
    if (cameraPosition === 'back' && !backDevice && frontDevice) {
      setCameraPosition('front');
    } else if (cameraPosition === 'front' && !frontDevice && backDevice) {
      setCameraPosition('back');
    }
  }, [cameraPosition, backDevice, frontDevice]);

  const device =
    cameraPosition === 'back'
      ? backDevice ?? frontDevice ?? null
      : frontDevice ?? backDevice ?? null;

  const displayMirrored = device?.position === 'front';

  let statusMessage: string | null = null;
  if (!hasPermission) {
    statusMessage = 'Requesting camera permission…';
  } else if (allDevices.length === 0) {
    statusMessage = 'Loading camera devices…';
  } else if (!device) {
    statusMessage = 'No camera device found';
  }

  return {
    hasPermission,
    device,
    displayMirrored,
    cameraPosition,
    setCameraPosition,
    availablePositions: {
      back: Boolean(backDevice),
      front: Boolean(frontDevice),
    },
    statusMessage,
  };
}
