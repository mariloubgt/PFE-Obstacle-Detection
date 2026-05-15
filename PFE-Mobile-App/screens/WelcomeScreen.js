import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';

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
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Image
          source={require('../assets/branding/logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="VisionAid — assistive navigation app logo"
        />

        <Text style={styles.appName} accessibilityRole="header">
          VisionAid
        </Text>

        <Text style={styles.taglineEn}>
          Assistive Navigation System for Visually Impaired People
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
            title="Voice interaction"
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
          accessibilityLabel="Continue to app setup"
        >
          <Text style={styles.primaryBtnText}>Set up the app</Text>
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
    paddingHorizontal: LAYOUT.screenPaddingH,
    paddingTop: 4,
    paddingBottom: 28,
  },
  logoImage: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: LAYOUT.logoBoxMaxWidth,
    height: LAYOUT.logoBoxHeight,
    marginBottom: 16,
    borderRadius: LAYOUT.cardRadius,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  appName: {
    textAlign: 'center',
    color: COLORS.white,
    fontSize: 28,
    letterSpacing: 0.5,
    marginBottom: 8,
    fontFamily: FONTS.en.extrabold,
  },
  taglineEn: {
    textAlign: 'center',
    color: COLORS.tealBright,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 4,
    marginBottom: 10,
    fontFamily: FONTS.en.medium,
  },
  cardsBlock: {
    gap: 12,
    marginBottom: 28,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    borderRadius: LAYOUT.cardRadius,
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
    fontFamily: FONTS.en.bold,
    marginBottom: 4,
  },
  cardSubtitle: {
    color: COLORS.tealBright,
    fontSize: 13,
    fontFamily: FONTS.en.medium,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.teal,
    borderRadius: LAYOUT.buttonRadius,
    paddingVertical: 16,
    paddingHorizontal: 24,
    minHeight: 56,
    marginBottom: 16,
  },
  pressed: { opacity: 0.92 },
  primaryBtnText: {
    color: COLORS.btnText,
    fontSize: 17,
    fontFamily: FONTS.en.extrabold,
  },
  secondaryWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  secondaryLink: {
    color: COLORS.teal,
    fontSize: 15,
    fontFamily: FONTS.en.semibold,
  },
});
