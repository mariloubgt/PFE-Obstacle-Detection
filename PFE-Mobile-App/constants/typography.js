import { useFonts } from 'expo-font';
import {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
} from '@expo-google-fonts/cairo';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';

/** Pass this map into `useAppFonts` / `useFonts` — keys match `FONTS` string values. */
export const fontAssets = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
};

/** Inter for English & French; Cairo for Arabic (دارجة). */
export const FONTS = {
  en: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
    extrabold: 'Inter_800ExtraBold',
  },
  ar: {
    regular: 'Cairo_400Regular',
    semibold: 'Cairo_600SemiBold',
    bold: 'Cairo_700Bold',
  },
};

export function useAppFonts() {
  return useFonts(fontAssets);
}
