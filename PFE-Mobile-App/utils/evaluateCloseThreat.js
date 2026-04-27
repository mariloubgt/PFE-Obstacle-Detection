/**
 * Decide if any detection is dangerously close. Supports future API fields:
 * `distance_m` or `depth_m` (meters) on each detection.
 * If missing, estimates distance from normalized bounding-box area (larger box → closer).
 */

const DANGER_WITHIN_DEFAULT_M = 1.15;
const MIN_CONFIDENCE = 0.32;
const MIN_BOX_AREA = 0.012;

function estimateMetersFromBbox(d) {
  const w = (d.x2 || 0) - (d.x1 || 0);
  const h = (d.y2 || 0) - (d.y1 || 0);
  const area = w * h;
  if (area < MIN_BOX_AREA) return null;
  // Calibrated: bigger area → smaller distance (object fills more of the frame)
  return Math.min(12, 0.15 / Math.sqrt(Math.max(area, 0.0001)));
}

function effectiveDistanceMeters(d) {
  if (typeof d.distance_m === 'number' && d.distance_m > 0) {
    return d.distance_m;
  }
  if (typeof d.depth_m === 'number' && d.depth_m > 0) {
    return d.depth_m;
  }
  return estimateMetersFromBbox(d);
}

function classKey(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '_');
}

/**
 * @param {object} [options]
 * @param {number} [options.dangerWithinMeters] — max distance (m) to treat as danger, default 1.15
 * @returns {null | { id: string, displayLabel: string, distanceM: number, arMessage: string, className: string }}
 */
export function pickCloseThreat(detections, options = {}) {
  const cap =
    typeof options.dangerWithinMeters === 'number' && options.dangerWithinMeters > 0
      ? options.dangerWithinMeters
      : DANGER_WITHIN_DEFAULT_M;

  if (!Array.isArray(detections) || detections.length === 0) {
    return null;
  }

  let best = null;

  for (let i = 0; i < detections.length; i += 1) {
    const d = detections[i];
    if ((d.confidence || 0) < MIN_CONFIDENCE) continue;
    const dist = effectiveDistanceMeters(d);
    if (dist == null || dist > cap) continue;

    const className = classKey(d.name);
    if (!best || dist < best.distanceM) {
      const isPerson = className === 'person' || className.includes('person');
      const displayLabel = isPerson
        ? 'PERSON'
        : (d.name || 'OBSTACLE')
            .replace(/_/g, ' ')
            .toUpperCase()
            .slice(0, 18);
      const arMessage = isPerson
        ? 'شخص قدامك — وقف وانتبه'
        : 'عائق قدامك — وقف وانتبه';
      best = {
        id: `${className}-${i}`,
        displayLabel,
        distanceM: dist,
        arMessage,
        className: d.name || 'object',
      };
    }
  }

  return best;
}
