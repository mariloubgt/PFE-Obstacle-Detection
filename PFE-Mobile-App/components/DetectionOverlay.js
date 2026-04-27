import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { FONTS } from '../constants/typography';

/**
 * Normalized boxes (0–1) from /predict, laid over the camera preview.
 */
export default function DetectionOverlay({ detections = [] }) {
  if (!detections.length) return null;

  return (
    <View style={styles.layer} pointerEvents="none">
      {detections.map((d, i) => {
        const w = (d.x2 - d.x1) * 100;
        const h = (d.y2 - d.y1) * 100;
        if (w <= 0 || h <= 0) return null;
        return (
          <View
            key={`${i}-${d.name}`}
            style={[
              styles.box,
              {
                left: `${d.x1 * 100}%`,
                top: `${d.y1 * 100}%`,
                width: `${w}%`,
                height: `${h}%`,
              },
            ]}
          >
            <Text style={styles.label} numberOfLines={1}>
              {(d.name || '').replace(/_/g, ' ')}
              {d.distance_m != null && d.distance_m !== undefined
                ? ` ~${Number(d.distance_m).toFixed(2)}m`
                : ''}{' '}
              {Math.round((d.confidence || 0) * 100)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: COLORS.teal,
    borderRadius: 4,
    backgroundColor: 'rgba(102, 210, 177, 0.1)',
  },
  label: {
    position: 'absolute',
    top: -18,
    left: -2,
    backgroundColor: 'rgba(13, 17, 23, 0.92)',
    color: COLORS.tealBright,
    fontSize: 10,
    fontFamily: FONTS.en.bold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
