import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { FONTS } from '../constants/typography';

function modelTag(model) {
  const m = String(model || '').toLowerCase();
  if (m === 'indoor') return 'IN';
  if (m === 'outdoor') return 'OUT';
  return '?';
}

function modelColors(model, colors) {
  const m = String(model || '').toLowerCase();
  if (m === 'indoor') {
    return { border: '#A78BFA', fill: 'rgba(167,139,250,0.18)', labelBg: 'rgba(76,29,149,0.92)' };
  }
  if (m === 'outdoor') {
    return { border: colors.teal, fill: colors.detectionBoxFill, labelBg: colors.detectionLabelBg };
  }
  return { border: colors.grey, fill: colors.detectionBoxFill, labelBg: colors.detectionLabelBg };
}

/**
 * Normalized boxes (0–1) from /predict, laid over the camera preview.
 */
export default function DetectionOverlay({ detections = [] }) {
  const colors = useThemeColors();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        layer: {
          ...StyleSheet.absoluteFillObject,
        },
        box: {
          position: 'absolute',
          borderWidth: 2,
          borderRadius: 4,
        },
        label: {
          position: 'absolute',
          top: -20,
          left: -2,
          color: colors.tealBright,
          fontSize: 10,
          fontFamily: FONTS.en.bold,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          overflow: 'hidden',
        },
      }),
    [colors]
  );

  if (!detections.length) return null;

  return (
    <View style={styles.layer} pointerEvents="none">
      {detections.map((d, i) => {
        const w = (d.x2 - d.x1) * 100;
        const h = (d.y2 - d.y1) * 100;
        if (w <= 0 || h <= 0) return null;
        const mc = modelColors(d.model, colors);
        return (
          <View
            key={`${i}-${d.name}-${d.model || 'x'}`}
            style={[
              styles.box,
              {
                left: `${d.x1 * 100}%`,
                top: `${d.y1 * 100}%`,
                width: `${w}%`,
                height: `${h}%`,
                borderColor: mc.border,
                backgroundColor: mc.fill,
              },
            ]}
          >
            <Text
              style={[styles.label, { backgroundColor: mc.labelBg }]}
              numberOfLines={1}
            >
              {modelTag(d.model)} · {(d.name || '').replace(/_/g, ' ')}
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
