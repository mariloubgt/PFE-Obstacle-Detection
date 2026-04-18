import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

function FeatureCard({ iconName, iconColor, iconBg, title, subtitle }) {
  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
        <MaterialCommunityIcons name={iconName} size={26} color={iconColor} />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

export default function WelcomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Text style={styles.topBrand}>VisionAid</Text>

        <Text style={styles.logoPlaceholder} accessibilityLabel="App logo placeholder">
          LOGO
        </Text>
        <Text style={styles.appTitle}>VisionAid</Text>

        <Text style={styles.taglineEn}>
          Assistive Navigation System for Visually Impaired People
        </Text>
        <Text style={styles.taglineAr} accessibilityLabel="Arabic tagline">
          نظام التنقل الذكي بالدارجة
        </Text>

        <View style={styles.cardsBlock}>
          <FeatureCard
            iconName="eye"
            iconColor="#4ADE80"
            iconBg="#14532D"
            title="Real-time obstacle detection"
            subtitle="YOLO + depth awareness"
          />
          <FeatureCard
            iconName="microphone"
            iconColor="#C084FC"
            iconBg="#4C1D95"
            title="Daridja voice interaction"
            subtitle="Powered by Gemini AI"
          />
          <FeatureCard
            iconName="lightning-bolt"
            iconColor="#FB923C"
            iconBg="#7C2D12"
            title="No extra hardware needed"
            subtitle="Smartphone only"
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={() => navigation.navigate('Permissions')}
          accessibilityRole="button"
          accessibilityLabel="Set up VisionAid"
        >
          <Text style={styles.primaryBtnText}>Set Up VisionAid</Text>
          <MaterialCommunityIcons name="arrow-right" size={22} color={COLORS.btnText} />
        </Pressable>

        <Pressable
          onPress={() => navigation.replace('Main')}
          style={styles.secondaryWrap}
          accessibilityRole="button"
          accessibilityLabel="Set this up later"
        >
          <Text style={styles.secondaryLink}>Set this up later</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 28,
  },
  topBrand: {
    textAlign: 'center',
    color: COLORS.teal,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
    marginBottom: 20,
  },
  logoPlaceholder: {
    textAlign: 'center',
    color: COLORS.teal,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 4,
    marginBottom: 8,
  },
  appTitle: {
    textAlign: 'center',
    color: COLORS.white,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  taglineEn: {
    textAlign: 'center',
    color: COLORS.tealBright,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  taglineAr: {
    textAlign: 'center',
    color: COLORS.tealBright,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 28,
    writingDirection: 'rtl',
  },
  cardsBlock: {
    gap: 12,
    marginBottom: 28,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgElevated,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 14,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: COLORS.tealBright,
    fontSize: 13,
    fontWeight: '500',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.teal,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  pressed: { opacity: 0.92 },
  primaryBtnText: {
    color: COLORS.btnText,
    fontSize: 17,
    fontWeight: '800',
  },
  secondaryWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  secondaryLink: {
    color: COLORS.teal,
    fontSize: 15,
    fontWeight: '600',
  },
});
