import { useMemo } from 'react';
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
import { LAYOUT } from '../constants/theme';
import { FONTS } from '../constants/typography';
import { useThemeColors } from '../contexts/ThemeContext';

function FeatureCard({ styles, iconName, iconColor, iconBg, title, subtitle }) {
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
  const colors = useThemeColors();
  const styles = useMemo(() => createWelcomeStyles(colors), [colors]);

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
        <View style={styles.logoFrame}>
          <Image
            source={require('../assets/branding/logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="VisionAid — assistive navigation app logo"
          />
        </View>

        <Text style={styles.appName} accessibilityRole="header">
          VisionAid
        </Text>

        <Text style={styles.taglineEn}>
          Assistive Navigation System for Visually Impaired People
        </Text>

        <View style={styles.cardsBlock}>
          <FeatureCard
            styles={styles}
            iconName="eye"
            iconColor="#4ADE80"
            iconBg="#14532D"
            title="Real-time obstacle detection"
            subtitle="YOLO + depth awareness"
          />
          <FeatureCard
            styles={styles}
            iconName="microphone"
            iconColor="#C084FC"
            iconBg="#4C1D95"
            title="Voice interaction"
            subtitle="Powered by Gemini AI"
          />
          <FeatureCard
            styles={styles}
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

function createWelcomeStyles(colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    scrollContent: {
      paddingHorizontal: LAYOUT.screenPaddingH,
      paddingTop: 4,
      paddingBottom: 28,
    },
    logoFrame: {
      alignSelf: 'center',
      width: 112,
      height: 112,
      marginTop: 8,
      marginBottom: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoImage: {
      width: '100%',
      height: '100%',
    },
    appName: {
      textAlign: 'center',
      color: colors.white,
      fontSize: 28,
      letterSpacing: 0.5,
      marginBottom: 8,
      fontFamily: FONTS.en.extrabold,
    },
    taglineEn: {
      textAlign: 'center',
      color: colors.tealBright,
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
      color: colors.white,
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
      alignItems: 'center',
      paddingVertical: 8,
    },
    secondaryLink: {
      color: colors.teal,
      fontSize: 15,
      fontFamily: FONTS.en.semibold,
    },
  });
}
