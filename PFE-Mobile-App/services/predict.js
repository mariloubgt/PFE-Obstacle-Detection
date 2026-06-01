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
 * @param {{
 *   useGemini?: boolean,
 *   useGroq?: boolean,
 *   groqMode?: 'describe' | 'navigate',
 *   detailed?: boolean,
 *   hfovDeg?: number,
 *   depthScale?: number,
 *   yoloProfile?: 'auto' | 'indoor' | 'outdoor' | 'dual',
 *   skipYolo?: boolean,
 *   detectionsJson?: string,
 * }} [options]
 */
export async function predictImage(apiBase, imageUri, options = {}) {
  const {
    useGemini = false,
    useGroq = true,
    groqMode = 'describe',
    detailed = false,
    hfovDeg,
    depthScale,
    yoloProfile = 'auto',
    skipYolo = false,
    detectionsJson,
  } = options;
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
  form.append('use_groq', useGroq ? 'true' : 'false');
  form.append('groq_mode', groqMode === 'navigate' ? 'navigate' : 'describe');
  form.append('detailed', detailed ? 'true' : 'false');
  if (hfovDeg != null && Number.isFinite(Number(hfovDeg))) {
    form.append('hfov_deg', String(Number(hfovDeg)));
  }
  if (depthScale != null && Number.isFinite(Number(depthScale))) {
    form.append('depth_scale', String(Number(depthScale)));
  }
  const prof = String(yoloProfile || 'auto').toLowerCase();
  if (['auto', 'indoor', 'outdoor', 'dual'].includes(prof)) {
    form.append('yolo_profile', prof);
  }
  if (skipYolo) {
    form.append('skip_yolo', 'true');
    if (detectionsJson) {
      form.append('detections_json', detectionsJson);
    }
  }

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

/** Fast path: YOLO only (boxes + danger), no Groq wait. */
export async function predictNavigationYolo(apiBase, imageUri, options = {}) {
  const { hfovDeg, depthScale, yoloProfile } = options;
  return predictImage(apiBase, imageUri, {
    hfovDeg,
    depthScale,
    yoloProfile: yoloProfile || 'auto',
    useGemini: false,
    useGroq: false,
    groqMode: 'navigate',
    detailed: false,
  });
}

/** Groq guidance only (reuse detections from predictNavigationYolo). */
export async function predictNavigationGroq(apiBase, imageUri, detections, options = {}) {
  const { hfovDeg, depthScale } = options;
  return predictImage(apiBase, imageUri, {
    hfovDeg,
    depthScale,
    useGemini: false,
    useGroq: true,
    groqMode: 'navigate',
    detailed: false,
    skipYolo: true,
    detectionsJson: JSON.stringify(detections || []),
  });
}

/**
 * Full navigation (YOLO + Groq in one request). Prefer staged YOLO + Groq in the app loop.
 */
export async function predictNavigationFrame(apiBase, imageUri, options = {}) {
  const { hfovDeg, depthScale, yoloProfile, useGroq = true } = options;
  return predictImage(apiBase, imageUri, {
    hfovDeg,
    depthScale,
    yoloProfile: yoloProfile || 'auto',
    useGemini: false,
    useGroq: useGroq !== false,
    groqMode: 'navigate',
    detailed: false,
  });
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
