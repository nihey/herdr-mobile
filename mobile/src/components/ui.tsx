import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const c = {
  bg: '#101713',
  panel: '#19221C',
  elevated: '#232E26',
  line: '#303D32',
  text: '#F1F1E7',
  muted: '#A2ADA0',
  accent: '#B8E6B3',
  ink: '#172314',
  amber: '#EFBE78',
  red: '#F0A69A',
};
export const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  page: { padding: 22, gap: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: c.text,
    fontSize: 36,
    fontWeight: '600',
    letterSpacing: -1.4,
  },
  heading: {
    color: c.text,
    fontSize: 21,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  body: { color: c.text, fontSize: 15, lineHeight: 22 },
  muted: { color: c.muted, fontSize: 13, lineHeight: 20 },
  eyebrow: { color: c.muted, fontSize: 11, letterSpacing: 2, fontFamily: mono },
  card: {
    padding: 18,
    backgroundColor: c.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.line,
    gap: 12,
  },
  divider: { height: 1, backgroundColor: c.line },
});
export function Screen({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <SafeAreaView style={[s.screen, style]} edges={['top', 'bottom']}>
      {children}
    </SafeAreaView>
  );
}
export function Button({
  title,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  busy = false,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const fg =
    variant === 'primary' ? c.ink : variant === 'danger' ? c.red : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 48,
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
          backgroundColor:
            variant === 'primary'
              ? c.accent
              : variant === 'ghost'
                ? 'transparent'
                : c.elevated,
          opacity: disabled || busy ? 0.45 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon}
      <Text style={{ color: fg, fontSize: 14, fontWeight: '600' }}>
        {title}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 14,
        backgroundColor: pressed ? c.line : c.panel,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      {children}
    </Pressable>
  );
}
export function Field({
  label,
  ...props
}: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {label && <Text style={s.muted}>{label}</Text>}
      <TextInput
        placeholderTextColor={c.muted}
        selectionColor={c.accent}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label ?? props.placeholder}
        {...props}
        style={[
          {
            color: c.text,
            backgroundColor: c.panel,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 12,
            minHeight: 52,
            paddingHorizontal: 15,
            paddingVertical: 13,
            fontSize: 15,
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Status({ status }: { status: string }) {
  const color =
    status === 'working'
      ? c.accent
      : status === 'blocked'
        ? c.amber
        : status === 'done'
          ? '#A9CDEE'
          : c.muted;
  const label =
    status === 'blocked'
      ? 'Needs input'
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}
    >
      <View
        style={{ width: 6, height: 6, backgroundColor: color, borderRadius: 3 }}
      />
      <Text style={{ color, fontSize: 12, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}
export function Notice({
  message,
  danger = false,
}: {
  message: string;
  danger?: boolean;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: 14,
        borderRadius: 12,
        backgroundColor: c.elevated,
        borderLeftColor: danger ? c.red : c.amber,
        borderLeftWidth: 3,
      }}
    >
      <Text
        style={{
          color: danger ? c.red : c.amber,
          fontSize: 13,
          lineHeight: 20,
        }}
      >
        {message}
      </Text>
    </View>
  );
}
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: '#00000099',
          justifyContent: 'flex-end',
        }}
      >
        <SafeAreaView
          edges={['bottom']}
          style={{
            backgroundColor: c.panel,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: '90%',
          }}
        >
          <View style={[s.between, { padding: 20 }]}>
            <Text style={s.heading}>{title}</Text>
            <IconButton label="Close dialog" onPress={onClose}>
              <X color={c.text} size={20} />
            </IconButton>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingBottom: 24,
              gap: 18,
            }}
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
export function ErrorSheet({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet title="Action needs attention" visible={!!message} onClose={onClose}>
      <Notice message={message ?? ''} danger />
      <Button title="Got it" onPress={onClose} />
    </Sheet>
  );
}
export function Loading({
  label = 'Connecting to your agents…',
}: {
  label?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 18,
      }}
    >
      <ActivityIndicator color={c.accent} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}
