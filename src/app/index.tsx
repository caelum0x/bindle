import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../lib/auth/authStore';
import { useTheme } from '../lib/useTheme';

const SEEN_KEY = 'bindle.onboarding.seen.v1';

export default function Gate() {
  const status = useAuthStore((s) => s.status);
  const { c } = useTheme();

  useEffect(() => {
    if (status === 'signedIn') {
      router.replace('/(tabs)/entries');
      return;
    }
    if (status === 'signedOut') {
      SecureStore.getItemAsync(SEEN_KEY).then((seen) => {
        router.replace(seen ? '/connect' : '/onboarding');
      });
    }
  }, [status]);

  return (
    <View
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background }}
    >
      <ActivityIndicator color={c.text} />
    </View>
  );
}
