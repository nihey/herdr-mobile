import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

// Keep Android system Back consistent with these screens' explicit home action.
export function useHomeBack() {
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          router.replace('/');
          return true;
        },
      );
      return () => subscription.remove();
    }, []),
  );
}
