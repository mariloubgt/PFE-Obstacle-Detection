import { NativeModules, Platform } from 'react-native';

const { VisionDescribeModule } = NativeModules;

/**
 * iOS on-device scene description via Apple Vision.
 * Returns:
 *   { description: string, labels: Array<{label: string, confidence: number}> } | null
 */
export async function describeSceneOnDevice(imageUri) {
  if (Platform.OS !== 'ios') return null;
  if (!VisionDescribeModule || typeof VisionDescribeModule.describeFromUri !== 'function') {
    return null;
  }
  try {
    const res = await VisionDescribeModule.describeFromUri(imageUri);
    if (!res || typeof res.description !== 'string') return null;
    return res;
  } catch {
    return null;
  }
}
