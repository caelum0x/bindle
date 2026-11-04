import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { useAuthStore } from '../lib/auth/authStore';
import { PremiumProvider } from '../premium/premium-context';

export default function RootLayout() {
  const restore = useAuthStore((s) => s.restore);
  const scheme = useColorScheme();

  useEffect(() => {
    restore();
  }, [restore]);

  return (
    <SafeAreaProvider>
      <PremiumProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="connect" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="entry/[id]"
            options={{ presentation: 'card', headerShown: false }}
          />
          <Stack.Screen name="tags" options={{ presentation: 'card', headerShown: false }} />
          <Stack.Screen name="search" options={{ presentation: 'card', headerShown: false }} />
          <Stack.Screen name="account" options={{ presentation: 'card', headerShown: false }} />
          <Stack.Screen name="import" options={{ presentation: 'card', headerShown: false }} />
          <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false }} />
        </Stack>
      </PremiumProvider>
    </SafeAreaProvider>
  );
}
