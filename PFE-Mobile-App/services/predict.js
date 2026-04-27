/**
 * POST a JPEG frame to the Phase 3 FastAPI server (multipart).
 * @param {string} apiBase e.g. http://192.168.1.20:8787
 * @param {string} imageUri local file uri from takePictureAsync
 */

function explainNetworkFailure(base, err) {
  const msg = (err && err.message) || String(err);
  if (
    msg.includes('Network request failed') ||
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError')
  ) {
    return [
      'Cannot reach the server at:',
      base,
      '',
      'Check:',
      '• Use your PC Wi‑Fi IPv4, NOT localhost (e.g. http://192.168.1.20:8787)',
      '• Same Wi‑Fi on phone and PC (not mobile data)',
      '• Server: python api/inference_server.py',
      '• Windows Firewall: allow port 8787 or Python on Private network',
      '• Test in phone browser: ' + base + '/health',
    ].join('\n');
  }
  return msg;
}

/**
 * @param {string} imageUri
 * @param {{ useGemini?: boolean }} [options] — if useGemini is false, server may skip Gemini (when supported)
 */
export async function predictImage(apiBase, imageUri, options = {}) {
  const { useGemini = true } = options;
  const base = (apiBase || '').replace(/\/$/, '');
  if (!base.startsWith('http')) {
    throw new Error('Invalid API URL. Set it in Settings (Phase 3 server).');
  }

  const url = `${base}/predict`;
  const form = new FormData();
  form.append('file', {
    uri: imageUri,
    name: 'frame.jpg',
    type: 'image/jpeg',
  });
  form.append('use_gemini', useGemini ? 'true' : 'false');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      body: form,
    });
  } catch (e) {
    throw new Error(explainNetworkFailure(base, e));
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON from server');
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

export async function fetchHealth(apiBase) {
  const base = (apiBase || '').replace(/\/$/, '');
  if (!base.startsWith('http')) {
    throw new Error('Invalid URL');
  }

  const url = `${base}/health`;
  let res;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (e) {
    throw new Error(explainNetworkFailure(base, e));
  }

  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 200));
  return JSON.parse(text);
}
