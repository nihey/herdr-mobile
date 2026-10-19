import { Pressable, Text, View } from 'react-native';
import { Mic, Square } from 'lucide-react-native';
import { languageInfo, nextLanguage, type Language } from '@/lib/dictation';
import { Button, c, mono, Notice, Sheet } from './ui';

/** Language chip and mic button joined into one control beside the composer. */
export function DictationControl({
  language,
  listening,
  disabled,
  onToggle,
  onSwitchLanguage,
}: {
  language: Language;
  listening: boolean;
  disabled: boolean;
  onToggle: () => void;
  onSwitchLanguage: () => void;
}) {
  const info = languageInfo(language);
  const next = languageInfo(nextLanguage(language));
  return (
    <View
      style={{
        flexDirection: 'row',
        height: 42,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: listening ? '#3A2420' : c.elevated,
        opacity: disabled && !listening ? 0.45 : 1,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Dictation language: ${info.name}. Switch to ${next.name}`}
        disabled={listening || disabled}
        onPress={onSwitchLanguage}
        hitSlop={{ top: 6, bottom: 6, left: 6 }}
        style={({ pressed }) => ({
          width: 34,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          style={{
            color: listening ? c.red : c.text,
            fontFamily: mono,
            fontSize: 11,
            fontWeight: '700',
          }}
        >
          {info.short}
        </Text>
      </Pressable>
      <View style={{ width: 1, marginVertical: 9, backgroundColor: c.line }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          listening ? 'Stop dictation' : `Dictate in ${info.name}`
        }
        accessibilityState={{ disabled: disabled && !listening }}
        disabled={disabled && !listening}
        onPress={onToggle}
        hitSlop={{ top: 6, bottom: 6, right: 6 }}
        style={({ pressed }) => ({
          width: 40,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {listening ? (
          <Square size={15} color={c.red} fill={c.red} />
        ) : (
          <Mic size={18} color={c.accent} />
        )}
      </Pressable>
    </View>
  );
}

/** Offers Android's one-time offline model download for a language. */
export function SpeechModelSheet({
  language,
  onDownload,
  onClose,
}: {
  language: Language | null;
  onDownload: () => void;
  onClose: () => void;
}) {
  const name = language ? languageInfo(language).name : '';
  return (
    <Sheet
      title={`Offline ${name} speech`}
      visible={!!language}
      onClose={onClose}
    >
      <Notice
        message={`This phone has not downloaded Android's offline ${name} speech model yet. Dictation only runs on the phone, so it needs this one-time download.`}
      />
      <Button title={`Download ${name}`} onPress={onDownload} />
      <Button title="Not now" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}
