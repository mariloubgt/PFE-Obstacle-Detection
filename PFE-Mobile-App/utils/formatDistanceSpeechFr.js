/**
 * French TTS phrasing for distance — centimeter precision (no coarse 0.5 m steps).
 * @param {number} distM distance in meters
 */
export function formatDistanceSpeechFr(distM) {
  const m = Math.max(0, Number(distM) || 0);
  const totalCm = Math.round(m * 100);

  if (totalCm < 100) {
    const cm = totalCm;
    return cm <= 1 ? `${cm} centimètre` : `${cm} centimètres`;
  }

  const wholeM = Math.floor(totalCm / 100);
  const cmRem = totalCm % 100;

  if (cmRem === 0) {
    return wholeM === 1 ? '1 mètre' : `${wholeM} mètres`;
  }

  const mStr = wholeM === 1 ? '1 mètre' : `${wholeM} mètres`;
  const cStr = cmRem === 1 ? '1 centimètre' : `${cmRem} centimètres`;
  return `${mStr} et ${cStr}`;
}
