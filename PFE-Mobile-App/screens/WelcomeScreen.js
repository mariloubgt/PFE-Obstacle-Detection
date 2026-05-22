import { useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
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
import { LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { useThemeColors } from '../contexts/ThemeContext';

export default function WelcomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: colors.bg,
        },
        scrollContent: {
          flexGrow: 1,
          alignItems: 'center',
          paddingHorizontal: LAYOUT.screenPaddingH,
          paddingTop: 20,
          paddingBottom: 28,
        },
        heroSection: {
          width: '100%',
          alignItems: 'center',
          marginBottom: 22,
        },
        logoGlow: {
          alignSelf: 'center',
          shadowColor: colors.teal,
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.28,
          shadowRadius: 22,
          elevation: 14,
          marginBottom: 22,
        },
        logoGradientRing: {
          padding: 3,
          borderRadius: 42,
        },
        logoInnerCard: {
          width: 192,
          height: 192,
          borderRadius: 39,
          overflow: 'hidden',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 18,
          paddingVertical: 18,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.borderMuted,
        },
        logoImage: {
          width: '100%',
          height: '100%',
          maxHeight: 168,
        },
        appName: {
          width: '100%',
          textAlign: 'center',
          color: colors.text,
          fontSize: 30,
          letterSpacing: 0.8,
          marginBottom: 10,
          fontFamily: FONTS.en.extrabold,
        },
        taglineEn: {
          width: '100%',
          maxWidth: 340,
          textAlign: 'center',
          alignSelf: 'center',
          color: colors.tealBright,
          fontSize: 15,
          lineHeight: 23,
          paddingHorizontal: 8,
          marginBottom: 4,
          fontFamily: FONTS.en.medium,
        },
        cardsBlock: {
          alignSelf: 'stretch',
          width: '100%',
          gap: 12,
          marginBottom: 28,
          marginTop: 6,
        },
        card: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.bgElevated,
          borderWidth: 1,
          borderColor: colors.borderMuted,
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
          color: colors.text,
          fontSize: 16,
          fontFamily: FONTS.en.bold,
          marginBottom: 4,
        },
        cardSubtitle: {
          color: colors.tealBright,
          fontSize: 13,
          fontFamily: FONTS.en.medium,
        },
        primaryBtn: {
          alignSelf: 'stretch',
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: colors.teal,
          borderRadius: LAYOUT.buttonRadius,
          paddingVertical: 16,
          paddingHorizontal: 24,
          minHeight: 56,
          marginBottom: 16,
        },
        pressed: { opacity: 0.92 },
        primaryBtnText: {
          color: colors.btnText,
          fontSize: 17,
          fontFamily: FONTS.en.extrabold,
        },
        secondaryWrap: {
          alignSelf: 'stretch',
          alignItems: 'center',
          paddingVertical: 8,
        },
        secondaryLink: {
          color: colors.teal,
          fontSize: 15,
          fontFamily: FONTS.en.semibold,
        },
      }),
    [colors]
  );

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
      <StatusBar style={colors.statusBarStyle} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.heroSection}>
          <View style={styles.logoGlow}>
            <LinearGradient
              colors={[colors.tealBright, colors.teal, colors.tealBright]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoGradientRing}
            >
              <View style={[styles.logoInnerCard, { backgroundColor: colors.bg }]}>
                <Image
                  source={require('../assets/branding/logo.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                  accessibilityRole="image"
                  accessibilityLabel="VisionAid — assistive navigation app logo"
                />
              </View>
            </LinearGradient>
          </View>

          <Text style={styles.appName} accessibilityRole="header">
            VisionAid
          </Text>

          <Text style={styles.taglineEn}>
            Assistive Navigation System for Visually Impaired People
          </Text>
        </View>

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
          <MaterialCommunityIcons name="arrow-right" size={22} color={colors.btnText} />
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
