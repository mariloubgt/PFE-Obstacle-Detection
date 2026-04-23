import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { FONTS } from '../constants/typography';

/**
 * Barre de navigation avec retour (pour enchaîner les écrans du setup).
 */
export default function ScreenHeader({ title, onBack, showBack = true }) {
  return (
    <View style={styles.row}>
      {showBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={COLORS.teal} />
        </Pressable>
      ) : (
        <View style={styles.backPlaceholder} />
      )}
      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
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
  backPlaceholder: {
    width: 44,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: COLORS.white,
    fontSize: 17,
    fontFamily: FONTS.en.semibold,
  },
});
