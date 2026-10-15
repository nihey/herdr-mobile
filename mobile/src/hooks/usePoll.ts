import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';

export function usePoll<T>(load: () => Promise<T>, interval: number) {
  const focused = useIsFocused();
  const loader = useRef(load);
  loader.current = load;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    if (!focused) return;
    let disposed = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (disposed || inFlight || AppState.currentState !== 'active') return;
      inFlight = true;
      try {
        const value = await loader.current();
        if (!disposed) {
          setData(value);
          setError(undefined);
          failures = 0;
        }
      } catch (reason) {
        if (!disposed) {
          setError(reason);
          failures++;
        }
      } finally {
        inFlight = false;
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(poll, Math.min(interval * 2 ** failures, 30000));
        }
      }
    };
    void poll();
    const listener = AppState.addEventListener('change', (state) => {
      if (timer) clearTimeout(timer);
      if (state === 'active') void poll();
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      listener.remove();
    };
  }, [focused, interval, revision, load]);
  return { data, error, loading, refresh };
}
