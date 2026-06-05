/**
 * Pick the best obstacle for voice / UI — deprioritize false "person" hits.
 */

const PERSON_MIN_CONF = 0.55;
const CHAIR_MIN_CONF = 0.48;
const PERSON_CONFIRM_FRAMES = 2;
const CHAIR_CONFIRM_FRAMES = 2;

export function normNavClass(name) {
  return String(name || 'object').toLowerCase().trim();
}

/**
 * @param {Array} sortedByDistance — ascending distance_m
 * @param {(d: object) => boolean} isValid
 */
export function rankNavDetections(sortedByDistance, isValid) {
  if (!Array.isArray(sortedByDistance)) return [];
  return sortedByDistance.filter((d) => {
    if (!isValid(d)) return false;
    const cls = normNavClass(d.name);
    if (cls === 'person' && (d.confidence || 0) < PERSON_MIN_CONF) {
      return false;
    }
    if (cls === 'chair' && (d.confidence || 0) < CHAIR_MIN_CONF) {
      return false;
    }
    return true;
  });
}

/**
 * @param {Array} ranked — from rankNavDetections
 * @param {{ current: { key: string } | null }} lockRef
 */
export function pickNavPrimary(ranked, lockRef, hysteresisM = 0.55) {
  if (!ranked.length) {
    lockRef.current = null;
    return null;
  }
  const cand = ranked[0];
  const lock = lockRef.current;
  if (!lock) {
    lockRef.current = { key: normNavClass(cand.name) };
    return cand;
  }
  const lockedDet = ranked.find((d) => normNavClass(d.name) === lock.key);
  if (!lockedDet) {
    lockRef.current = { key: normNavClass(cand.name) };
    return cand;
  }
  if (normNavClass(cand.name) === lock.key) {
    return cand;
  }
  const cd = cand.distance_m ?? 99;
  const ld = lockedDet.distance_m ?? 99;
  if (cd < ld - hysteresisM) {
    lockRef.current = { key: normNavClass(cand.name) };
    return cand;
  }
  return lockedDet;
}

/**
 * Person danger needs 2 consecutive frames; other classes alert immediately.
 * @param {null | object} threat — pickCloseThreat result
 * @param {{ current: { key: string, n: number } | null }} confirmRef
 */
function _confirmFrames(threat, confirmRef, className, framesNeeded) {
  if (!threat) {
    confirmRef.current = null;
    return null;
  }
  const key = `${className}|${Math.round((threat.distanceM || 0) * 2)}`;
  const prev = confirmRef.current;
  if (!prev || prev.key !== key) {
    confirmRef.current = { key, n: 1 };
    return null;
  }
  const n = prev.n + 1;
  confirmRef.current = { key, n };
  return n >= framesNeeded ? threat : null;
}

export function confirmPersonThreat(threat, confirmRef) {
  if (!threat) {
    confirmRef.current = null;
    return null;
  }
  const isPerson =
    normNavClass(threat.className) === 'person' ||
    String(threat.displayLabel || '').toUpperCase() === 'PERSON';
  if (!isPerson) {
    confirmRef.current = null;
    return threat;
  }
  return _confirmFrames(threat, confirmRef, 'person', PERSON_CONFIRM_FRAMES);
}

export function confirmChairThreat(threat, confirmRef) {
  if (!threat) {
    confirmRef.current = null;
    return null;
  }
  const isChair = normNavClass(threat.className) === 'chair';
  if (!isChair) {
    confirmRef.current = null;
    return threat;
  }
  return _confirmFrames(threat, confirmRef, 'chair', CHAIR_CONFIRM_FRAMES);
}
