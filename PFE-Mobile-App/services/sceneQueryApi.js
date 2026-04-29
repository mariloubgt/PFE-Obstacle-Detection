import { loadInferenceApiUrl } from '../utils/inferenceApiUrl';

export async function querySceneFromAudioAsync(imageUri, audioUri) {
  const baseUrl = await loadInferenceApiUrl();
  if (!baseUrl) throw new Error('No API URL configured');

  const formData = new FormData();
  formData.append('image', {
    uri: imageUri,
    name: 'frame.jpg',
    type: 'image/jpeg',
  });
  formData.append('audio', {
    uri: audioUri,
    name: 'query.m4a',
    type: 'audio/m4a',
  });

  const resp = await fetch(`${baseUrl}/voice-query`, {
    method: 'POST',
    body: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
  const data = await resp.json();
  return {
    text: data.answer || 'No answer',
    userSaid: data.user_said,
  };
}

export async function transcribeRecordingAsync(_audioUri) {
  return { text: 'Transcribing...', language: 'en' };
}

export async function querySceneFromTextAsync(userText) {
  return { text: 'Querying...', language: 'en' };
}
