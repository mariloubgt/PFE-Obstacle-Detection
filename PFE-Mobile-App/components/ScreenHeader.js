import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { FONTS } from '../constants/typography';

/**
 * Barre de navigation avec retour (pour enchaîner les écrans du setup).
 * @param {string} [subtitle] — e.g. app version, shown under the title
 * @param {boolean} [circularBack] — pill-style back control
 */
export default function ScreenHeader({ title, subtitle, onBack, showBack = true, circularBack = false }) {
  return (
    <View style={styles.row}>
      {showBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={[styles.backBtn, circularBack && styles.backBtnCircle]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={COLORS.teal} />
        </Pressable>
      ) : (
        <View style={styles.backPlaceholder} />
      )}
      {title || subtitle ? (
        <View style={styles.titleBlock}>
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.backPlaceholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  backBtn: {
    padding: 4,
    width: 44,
  },
  backBtnCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(102, 210, 177, 0.12)',
  },
  backPlaceholder: {
    width: 44,
  },
  titleBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
    color: COLORS.white,
    fontSize: 17,
    fontFamily: FONTS.en.semibold,
  },
  subtitle: {
    marginTop: 2,
    textAlign: 'center',
    color: COLORS.teal,
    fontSize: 13,
    fontFamily: FONTS.en.medium,
  },
});
