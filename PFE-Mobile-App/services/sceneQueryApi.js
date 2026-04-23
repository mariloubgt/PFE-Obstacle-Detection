/**
 * Replace these with your real STT and scene / Gemini (or on-device) endpoints.
 * `transcribeRecordingAsync` should upload `audioUri` to your speech-to-text API.
 * `querySceneFromTextAsync` should send the user text (and optional image/context) to your model.
 */

export async function transcribeRecordingAsync(_audioUri) {
  await new Promise((r) => setTimeout(r, 500));
  // Demo transcript until STT is connected
  return {
    text: 'واش فيه قدامي؟',
    language: 'ar',
  };
}

export async function querySceneFromTextAsync(userText) {
  await new Promise((r) => setTimeout(r, 900));
  return {
    text:
      'قدامك ممر ضيق. فيه درج على بعد شوية وكرسي على اليسار. دير بالك من الدرج — خطر قريب! تحرك ببطء واسمع التنبيهات.',
    language: 'ar',
  };
}
