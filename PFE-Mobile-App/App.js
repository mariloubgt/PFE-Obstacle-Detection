import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppFonts } from './constants/typography';
import { ThemeProvider, useAppTheme } from './contexts/ThemeContext';
import WelcomeScreen from './screens/WelcomeScreen';
import PermissionsScreen from './screens/PermissionsScreen';
import LanguageVoiceScreen from './screens/LanguageVoiceScreen';
import MainNavigationScreen from './screens/MainNavigationScreen';
import SceneQueryScreen from './screens/SceneQueryScreen';
import SettingsScreen from './screens/SettingsScreen';
import { APPEARANCE } from './constants/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();

function NavigationRoot() {
  const { colors, appearance } = useAppTheme();

  return (
    <NavigationContainer
      theme={{
        dark: appearance === APPEARANCE.night_shift,
        colors: {
          primary: colors.teal,
          background: colors.bg,
          card: colors.bgElevated,
          text: colors.text,
          border: colors.borderMuted,
          notification: colors.danger,
        },
      }}
    >
      <Stack.Navigator
        initialRouteName="Welcome"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Permissions" component={PermissionsScreen} />
        <Stack.Screen name="LanguageVoice" component={LanguageVoiceScreen} />
        <Stack.Screen name="Main" component={MainNavigationScreen} />
        <Stack.Screen name="SceneQuery" component={SceneQueryScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useAppFonts();

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <NavigationRoot />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
