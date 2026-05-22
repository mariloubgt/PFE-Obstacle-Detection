/**
 * Plain-English scene line from YOLO detections when Groq/Gemini are unavailable.
 * @param {Array<{ name?: string, distance_m?: number }>} detections
 */
export function describeFromDetections(detections) {
  if (!Array.isArray(detections) || detections.length === 0) {
    return 'No obstacles detected in the camera view.';
  }
  const parts = detections.slice(0, 6).map((d) => {
    const name = String(d.name || 'object').replace(/_/g, ' ');
    const dist = d.distance_m;
    if (typeof dist === 'number' && Number.isFinite(dist)) {
      return `${name} about ${dist.toFixed(1)} meters away`;
    }
    return name;
  });
  return `I see ${parts.join(', ')}.`;
}
