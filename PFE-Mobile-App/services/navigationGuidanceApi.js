/**
 * POST JPEG to Phase 3 /navigation-guidance (YOLO + guidance instruction).
 */

function explainNetworkFailure(base, err) {
  const msg = (err && err.message) || String(err);
  if (
    msg.includes('Network request failed') ||
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError')
  ) {
    return `Cannot reach the server at ${base}. Same Wi‑Fi? Server running on port 8787?`;
  }
  return msg;
}

/**
 * @param {string} apiBase
 * @param {string} imageUri
 * @param {{ hfovDeg?: number, depthScale?: number }} [opts]
 */
export async function postNavigationGuidance(apiBase, imageUri, opts = {}) {
  const base = (apiBase || '').replace(/\/$/, '');
  if (!base.startsWith('http')) {
    throw new Error('Invalid API URL. Set it in Settings (Phase 3 server).');
  }

  const { hfovDeg, depthScale } = opts;

  const form = new FormData();
  form.append('file', {
    uri: imageUri,
    name: 'frame.jpg',
    type: 'image/jpeg',
  });
  if (hfovDeg != null && Number.isFinite(Number(hfovDeg))) {
    form.append('hfov_deg', String(Number(hfovDeg)));
  }
  if (depthScale != null && Number.isFinite(Number(depthScale))) {
    form.append('depth_scale', String(Number(depthScale)));
  }

  const url = `${base}/navigation-guidance`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: form });
  } catch (e) {
    throw new Error(explainNetworkFailure(base, e));
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON from navigation-guidance');
  }
}
