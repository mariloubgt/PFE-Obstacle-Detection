/**
 * One announcement at a time — avoids "chair 1.5m / chair 2.2m" overlap.
 */

const DEFAULT_MIN_GAP_MS = 5500;
const EMERGENCY_GAP_MS = 4000;
const GROQ_MIN_GAP_MS = 6000;
const DIST_BUCKET_M = 0.5;

function bucketDist(m) {
  if (m == null || !Number.isFinite(m)) return null;
  return Math.round(m / DIST_BUCKET_M) * DIST_BUCKET_M;
}

function normClass(name) {
  return String(name || 'object').toLowerCase().trim();
}

/**
 * @param {{ current: { lastAt: number, lastKey: string, lastGroq: string } }} ref
 */
export function shouldSpeakEmergency(className, distanceM, ref, now = Date.now()) {
  const distB = bucketDist(distanceM);
  const key = `stop|${normClass(className)}|${distB}`;
  const state = ref.current;
  if (state.lastKey === key && now - state.lastAt < EMERGENCY_GAP_MS) {
    return false;
  }
  state.lastAt = now;
  state.lastKey = key;
  return true;
}

/**
 * Groq navigation line (not emergency).
 */
export function shouldSpeakGroq(guidance, risk, ref, now = Date.now()) {
  const g = String(guidance || '').trim();
  if (!g) return false;
  if (risk === 'ok' && /continue forward\.?$/i.test(g)) {
    return false;
  }
  const key = `${risk}|${g.slice(0, 80)}`;
  const state = ref.current;
  if (state.lastGroq === key && now - state.lastAt < GROQ_MIN_GAP_MS) {
    return false;
  }
  state.lastAt = now;
  state.lastGroq = key;
  state.lastKey = key;
  return true;
}

/**
 * YOLO-only fallback when Groq is off (rare).
 */
export function shouldSpeakYolo(className, distanceM, ref, now = Date.now()) {
  const distB = bucketDist(distanceM);
  const key = `yolo|${normClass(className)}|${distB}`;
  const state = ref.current;
  if (state.lastKey === key && now - state.lastAt < DEFAULT_MIN_GAP_MS) {
    return false;
  }
  state.lastAt = now;
  state.lastKey = key;
  return true;
}

export function resetSpeechGate(ref) {
  ref.current = { lastAt: 0, lastKey: '', lastGroq: '' };
}

export function formatSpeechDistance(m) {
  const b = bucketDist(m);
  if (b == null) return null;
  return b === 1 ? 1 : Math.max(0.5, b);
}
