import React, { type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Camera,
  type CameraDevice,
  type FrameProcessor,
} from 'react-native-vision-camera';

type Props = PropsWithChildren<{
  device: CameraDevice;
  displayMirrored: boolean;
  frameProcessor: FrameProcessor;
  isActive?: boolean;
  pixelFormat?: 'yuv' | 'rgb';
}>;

export function PoseCamera({
  device,
  displayMirrored,
  frameProcessor,
  isActive = true,
  pixelFormat = 'yuv',
  children,
}: Props) {
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        displayMirrored && styles.mirrored,
      ]}
    >
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        frameProcessor={frameProcessor}
        pixelFormat={pixelFormat}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
});
