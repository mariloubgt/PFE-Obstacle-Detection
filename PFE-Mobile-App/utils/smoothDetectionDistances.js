/**
 * Stabilise distance_m quand la scène est fixe (réduit le bruit bbox YOLO).
 *
 * - Clé = classe + rang par distance (0 = le plus proche). Plus de bucket horizontal
 *   qui sautait dès que la bbox bougeait d’un pixel.
 * - Médiane sur 5 frames + EMA.
 * - Sortie : si la variation est < 3 cm vs l’affichage précédent, on garde la même valeur.
 */

const MEDIAN_LEN = 5;
const EMA_ALPHA = 0.22;
const OUTPUT_DEADBAND_M = 0.03;

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {Array} detections — from /predict
 * @param {{ current: { history?: object, ema?: object, lastOut?: object } }} stateRef
 */
export function smoothDetectionDistances(detections, stateRef) {
  if (!Array.isArray(detections) || detections.length === 0) {
    return detections;
  }

  const state = stateRef.current;
  if (!state.history) state.history = Object.create(null);
  if (!state.ema) state.ema = Object.create(null);
  if (!state.lastOut) state.lastOut = Object.create(null);

  const indexed = detections.map((d, i) => ({
    d,
    i,
    raw:
      typeof d.distance_m === 'number' && Number.isFinite(d.distance_m) && d.distance_m > 0
        ? d.distance_m
        : null,
  }));

  const valid = indexed.filter((x) => x.raw != null);
  valid.sort((a, b) => a.raw - b.raw);

  const seen = new Set();
  /** @type {Record<number, number>} */
  const distByIndex = {};

  for (let slot = 0; slot < valid.length; slot += 1) {
    const { d, i, raw } = valid[slot];
    const cls = String(d.name || 'obstacle').toLowerCase();
    const key = `${cls}#${slot}`;
    seen.add(key);

    let hist = state.history[key];
    if (!hist) hist = [];
    hist = [...hist.slice(-(MEDIAN_LEN - 1)), raw];
    state.history[key] = hist;

    const med = median(hist);
    if (med == null) {
      distByIndex[i] = Math.round(raw * 100) / 100;
      continue;
    }

    let prev = state.ema[key];
    if (prev == null || !Number.isFinite(prev)) prev = med;
    const ema = prev + EMA_ALPHA * (med - prev);
    state.ema[key] = ema;
    let rounded = Math.round(ema * 100) / 100;

    const lastO = state.lastOut[key];
    if (lastO != null && Math.abs(rounded - lastO) < OUTPUT_DEADBAND_M) {
      rounded = lastO;
    } else {
      state.lastOut[key] = rounded;
    }

    distByIndex[i] = rounded;
  }

  for (const k of Object.keys(state.history)) {
    if (!seen.has(k)) {
      delete state.history[k];
      delete state.ema[k];
      delete state.lastOut[k];
    }
  }

  return detections.map((d, i) => {
    if (distByIndex[i] !== undefined) {
      return { ...d, distance_m: distByIndex[i] };
    }
    return { ...d };
  });
}
