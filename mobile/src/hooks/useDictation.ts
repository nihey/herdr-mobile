import { useCallback, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  ExpoSpeechRecognitionModule,
  SpeechRecognizerErrorAndroid,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import {
  hasLocale,
  joinDictation,
  languageInfo,
  nextLanguage,
  parseLanguage,
  spokenText,
  type Language,
} from '@/lib/dictation';

const LANGUAGE_KEY = 'herdr.dictation.language';
const quiet = new Set(['aborted', 'no-speech', 'speech-timeout']);

/**
 * On-device dictation into a draft. Audio never leaves the phone: recognition
 * requires the offline model for the chosen language, and a missing model is
 * reported through `missing` so the screen can offer Android's download.
 */
export function useDictation({
  onText,
  onError,
}: {
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [language, setLanguage] = useState<Language>('en-US');
  const [listening, setListening] = useState(false);
  const [missing, setMissing] = useState<Language | null>(null);
  const [notice, setNotice] = useState('');
  // The draft before dictation started plus finished segments; null when idle.
  const session = useRef<{ base: string; finals: string[] } | null>(null);
  const starting = useRef(false);
  // Android may report a client error when asked to stop; the user meant to stop.
  const stopping = useRef(false);

  useEffect(() => {
    let disposed = false;
    SecureStore.getItemAsync(LANGUAGE_KEY)
      .then((value) => {
        if (!disposed) setLanguage(parseLanguage(value));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (session.current) {
        session.current = null;
        ExpoSpeechRecognitionModule.abort();
      }
    };
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    const current = session.current;
    if (!current) return;
    const transcript = event.results[0]?.transcript ?? '';
    if (event.isFinal) {
      if (transcript.trim()) current.finals.push(transcript);
      onText(joinDictation(current.base, spokenText(current.finals, '')));
    } else {
      onText(
        joinDictation(current.base, spokenText(current.finals, transcript)),
      );
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (quiet.has(event.error) || stopping.current) return;
    if (
      event.error === 'language-not-supported' &&
      event.code !== SpeechRecognizerErrorAndroid.ERROR_LANGUAGE_NOT_SUPPORTED
    ) {
      setMissing(language);
      return;
    }
    const name = languageInfo(language).name;
    onError(
      event.error === 'language-not-supported'
        ? `This phone's offline speech engine does not support ${name}.`
        : event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Herdr needs microphone access to dictate. Allow it in Android Settings › Apps › Herdr › Permissions.'
          : `Dictation stopped: ${event.message}`,
    );
  });

  useSpeechRecognitionEvent('end', () => {
    session.current = null;
    stopping.current = false;
    setListening(false);
  });

  const start = useCallback(
    async (base: string) => {
      if (session.current || starting.current) return;
      starting.current = true;
      setNotice('');
      try {
        const permission =
          await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
        if (!permission.granted) {
          onError(
            'Herdr needs microphone access to dictate. Allow it in Android Settings › Apps › Herdr › Permissions.',
          );
          return;
        }
        if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
          onError(
            'This phone does not offer offline speech recognition, so dictation is unavailable.',
          );
          return;
        }
        try {
          const support = await ExpoSpeechRecognitionModule.getSupportedLocales(
            {},
          );
          // An empty answer means the engine could not report; let start() decide.
          if (support.locales.length) {
            if (!hasLocale(support.locales, language)) {
              onError(
                `This phone's offline speech engine does not support ${languageInfo(language).name}.`,
              );
              return;
            }
            if (!hasLocale(support.installedLocales, language)) {
              setMissing(language);
              return;
            }
          }
        } catch {
          // start() reports a missing model through the error event.
        }
        session.current = { base, finals: [] };
        stopping.current = false;
        setListening(true);
        ExpoSpeechRecognitionModule.start({
          lang: language,
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: true,
          addsPunctuation: true,
          maxAlternatives: 1,
        });
      } catch (reason) {
        session.current = null;
        setListening(false);
        onError(
          `Dictation could not start: ${reason instanceof Error ? reason.message : 'unknown error'}`,
        );
      } finally {
        starting.current = false;
      }
    },
    [language, onError],
  );

  /** Stops listening and keeps the last phrase once Android finalizes it. */
  const stop = useCallback(() => {
    if (!session.current) return;
    stopping.current = true;
    ExpoSpeechRecognitionModule.stop();
  }, []);

  /** Stops immediately and ignores anything still being recognized. */
  const cancel = useCallback(() => {
    if (!session.current) return;
    session.current = null;
    setListening(false);
    ExpoSpeechRecognitionModule.abort();
  }, []);

  const switchLanguage = useCallback(() => {
    if (session.current) return;
    const next = nextLanguage(language);
    setLanguage(next);
    setNotice('');
    SecureStore.setItemAsync(LANGUAGE_KEY, next).catch(() => undefined);
  }, [language]);

  const download = useCallback(async () => {
    const code = missing;
    setMissing(null);
    if (!code) return;
    const name = languageInfo(code).name;
    try {
      const result =
        await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
          locale: code,
        });
      setNotice(
        result.status === 'download_success'
          ? `${name} is ready. Tap the mic to dictate.`
          : result.status === 'download_scheduled'
            ? `Android will download ${name} shortly. Tap the mic again once it finishes.`
            : `Confirm the ${name} download in Android's dialog, then tap the mic again.`,
      );
    } catch (reason) {
      onError(
        `Android could not download offline ${name}: ${reason instanceof Error ? reason.message : 'unknown error'}`,
      );
    }
  }, [missing, onError]);

  return {
    language,
    listening,
    missing,
    notice,
    start,
    stop,
    cancel,
    switchLanguage,
    download,
    dismissMissing: () => setMissing(null),
  };
}
