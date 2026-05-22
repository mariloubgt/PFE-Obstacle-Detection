import { fetchHealth } from './predict';

function base(url) {
  return (url || '').trim().replace(/\/$/, '');
}

export async function fetchLabConfig(apiUrl) {
  const b = base(apiUrl);
  if (!b.startsWith('http')) throw new Error('Invalid API URL');
  const res = await fetch(`${b}/lab/config`, { method: 'GET' });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  return JSON.parse(text);
}

export async function updateLabConfig(apiUrl, patch) {
  const b = base(apiUrl);
  if (!b.startsWith('http')) throw new Error('Invalid API URL');
  const res = await fetch(`${b}/lab/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  return JSON.parse(text);
}

export async function resetLabConfig(apiUrl) {
  const b = base(apiUrl);
  const res = await fetch(`${b}/lab/reset`, { method: 'POST' });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 200));
  return JSON.parse(text);
}

/** Health + lab URLs from server (LAN IP auto-detected on PC). */
export async function probeServer(apiUrl) {
  const h = await fetchHealth(apiUrl);
  let lab = h.lab || null;
  if (!lab) {
    try {
      lab = await fetchLabConfig(apiUrl);
    } catch {
      lab = null;
    }
  }
  return { health: h, lab };
}
