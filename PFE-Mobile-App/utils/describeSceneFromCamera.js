import { predictImage } from '../services/predict';
import { getPredictOptionsForRequest } from './aiLabSettings';
import { loadAppPreferences } from './appSettings';
import { describeFromDetections } from './describeFromDetections';
import { loadInferenceApiUrl } from './inferenceApiUrl';

export function pickSceneDescriptionText(data) {
  const groq = data?.groq;
  const groqText =
    (typeof groq?.guidance_en === 'string' && groq.guidance_en.trim()) ||
    (typeof groq?.scene === 'string' && groq.scene.trim()) ||
    '';

  const visible = (data?.detections || []).filter(
    (d) => typeof d?.distance_m === 'number' && d.distance_m < 5
  );
  const yoloFallback = describeFromDetections(visible);
  const text = groqText || yoloFallback;
  const shouldSpeak = Boolean(text?.trim());
  return { text, shouldSpeak, groqText, yoloFallback };
}

/**
 * Capture one frame and run Groq describe (YOLO fallback). Stays on current screen.
 * @param {React.RefObject} cameraRef
 */
async function ensureCameraReadyForCapture(cameraRef) {
  try {
    cameraRef.current?.resumePreview?.();
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 400));
}

export async function captureAndDescribeScene(cameraRef) {
  if (!cameraRef?.current) {
    return { ok: false, error: 'Camera is not ready.', text: null, shouldSpeak: false };
  }

  await ensureCameraReadyForCapture(cameraRef);

  let photo;
  const captureOpts = { quality: 0.28, skipProcessing: true };
  try {
    photo = await cameraRef.current.takePictureAsync(captureOpts);
  } catch (firstErr) {
    await ensureCameraReadyForCapture(cameraRef);
    try {
      photo = await cameraRef.current.takePictureAsync(captureOpts);
    } catch (camErr) {
      return {
        ok: false,
        error:
          camErr instanceof Error
            ? `Could not capture a frame: ${camErr.message}`
            : 'Could not capture a camera frame.',
        text: null,
        shouldSpeak: false,
      };
    }
  }

  const api = await loadInferenceApiUrl();
  if (!api) {
    return {
      ok: false,
      error: 'Set the inference server address in Settings.',
      text: null,
      shouldSpeak: false,
    };
  }

  const prefs = await loadAppPreferences();
  const predictOpts = await getPredictOptionsForRequest(prefs);

  let data;
  try {
    data = await predictImage(api, photo.uri, {
      ...predictOpts,
      useGroq: true,
      groqMode: 'describe',
      useGemini: false,
    });
  } catch (netErr) {
    const msg = netErr instanceof Error ? netErr.message : String(netErr ?? 'Network error');
    return {
      ok: false,
      error: msg.length > 200 ? 'Could not reach the inference server.' : msg,
      text: null,
      shouldSpeak: false,
    };
  }

  const picked = pickSceneDescriptionText(data);
  return { ok: true, error: null, data, ...picked };
}
