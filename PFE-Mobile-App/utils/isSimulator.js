import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** True when running in iOS Simulator / Android emulator (no real camera). */
export function isSimulatorDevice() {
  if (Platform.OS === 'web') return false;
  return Constants.isDevice === false;
}
