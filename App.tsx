import React from 'react';
import { SafeAreaView, StatusBar } from 'react-native';
import CameraScreen from './src/screens/CameraScreen';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" />
      <CameraScreen />
    </SafeAreaView>
  );
}
