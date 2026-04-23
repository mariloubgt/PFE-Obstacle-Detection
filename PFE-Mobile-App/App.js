import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppFonts } from './constants/typography';
import WelcomeScreen from './screens/WelcomeScreen';
import PermissionsScreen from './screens/PermissionsScreen';
import LanguageVoiceScreen from './screens/LanguageVoiceScreen';
import MainNavigationScreen from './screens/MainNavigationScreen';
import SceneQueryScreen from './screens/SceneQueryScreen';
import SettingsScreen from './screens/SettingsScreen';

SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();

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
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Welcome"
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: '#0D1117' },
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
    </SafeAreaProvider>
  );
}
