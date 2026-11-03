import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
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
import { statusMark, type StatusTone } from '@/lib/status';

/** `#rrggbb` at an opacity, for tinted backgrounds and borders. */
export function tint(hex: string, alpha: number) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

// The user's terminal: GNOME Terminal's dark scheme under Herdr's catppuccin.
const accent = '#89B4FA';
export const c = {
  bg: '#171421',
  panel: '#1E1E2E',
  elevated: '#313244',
  line: '#313244',
  text: '#CDD6F4',
  muted: '#A6ADC8',
  dim: '#6C7086',
  accent,
  /** Text on accent backgrounds. */
  ink: '#171421',
  /** Working. */
  amber: '#F9E2AF',
  /** Needs input, danger. */
  red: '#F38BA8',
  /** Done, success. */
  green: '#A6E3A1',
  /** Terminal output text. */
  term: '#D0CFCC',
  /** Highlighted row, like Herdr's selected row. */
  select: tint(accent, 0.14),
  scrim: '#00000099',
};
export function toneColor(tone: StatusTone) {
  return tone === 'red'
    ? c.red
    : tone === 'amber'
      ? c.amber
      : tone === 'green'
        ? c.green
        : c.dim;
}
/** Noto Sans Mono (bundled, the user's terminal font); weights 400 and 700. */
export const mono = Platform.OS === 'android' ? 'NotoSansMono' : 'Menlo';
export const radius = 4;
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  page: { padding: 18, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: c.text,
    fontFamily: mono,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
  },
  heading: {
    color: c.text,
    fontFamily: mono,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  body: { color: c.text, fontFamily: mono, fontSize: 14, lineHeight: 20 },
  muted: { color: c.muted, fontFamily: mono, fontSize: 12, lineHeight: 18 },
  eyebrow: {
    color: c.dim,
    fontFamily: mono,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.5,
  },
  card: {
    padding: 14,
    backgroundColor: c.panel,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: c.line,
    gap: 10,
  },
  /** A list row; add `selected` for Herdr's highlighted row. */
  item: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
    borderRadius: 2,
    gap: 3,
  },
  selected: { backgroundColor: c.select, borderLeftColor: c.accent },
  divider: { height: 1, backgroundColor: c.line },
});
export function Pulse({
  color = c.accent,
  size = 6,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <Blink>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </Blink>
  );
}
export function LiveBadge({
  active,
  label = 'live',
  tone = 'live',
}: {
  active: boolean;
  label?: string;
  tone?: 'live' | 'paused';
}) {
  if (!active) return null;
  const color = tone === 'paused' ? c.amber : c.green;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: tint(color, 0.1),
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: tint(color, 0.3),
      }}
    >
      {tone === 'paused' ? (
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 1,
            backgroundColor: color,
          }}
        />
      ) : (
        <Pulse size={5} color={color} />
      )}
      <Text
        style={{
          color,
          fontFamily: mono,
          fontSize: 10,
          lineHeight: 13,
          fontWeight: '700',
        }}
      >
        {label}
      </Text>
    </View>
  );
}
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
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const fg =
    variant === 'primary' ? c.ink : variant === 'danger' ? c.red : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          borderRadius: radius,
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderWidth: variant === 'primary' || variant === 'ghost' ? 0 : 1,
          borderColor: variant === 'danger' ? tint(c.red, 0.35) : c.line,
          backgroundColor:
            variant === 'primary'
              ? c.accent
              : variant === 'ghost'
                ? 'transparent'
                : c.panel,
          opacity: disabled || busy ? 0.45 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon}
      <Text
        style={{
          color: fg,
          fontFamily: mono,
          fontSize: 13,
          lineHeight: 18,
          fontWeight: variant === 'primary' ? '700' : '400',
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  label,
  onPress,
  children,
  primary = false,
  disabled = false,
  busy = false,
  size = 44,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      hitSlop={6}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: primary ? c.accent : pressed ? c.line : c.panel,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled || busy ? 0.45 : primary && pressed ? 0.7 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={primary ? c.ink : c.accent} size="small" />
      ) : (
        children
      )}
    </Pressable>
  );
}
export function Field({
  label,
  ...props
}: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={s.muted}>{label}</Text>}
      <TextInput
        placeholderTextColor={c.dim}
        selectionColor={c.accent}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label ?? props.placeholder}
        {...props}
        style={[
          {
            color: c.text,
            fontFamily: mono,
            backgroundColor: c.panel,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: radius,
            minHeight: 48,
            paddingHorizontal: 12,
            paddingVertical: 11,
            fontSize: 14,
          },
          props.style,
        ]}
      />
    </View>
  );
}
/** Herdr's status mark and label: ● needs input, ◐ working, ✓ done, ○ idle. */
export function Status({
  status,
  pulse = false,
  label = true,
}: {
  status: string;
  pulse?: boolean;
  label?: boolean;
}) {
  const mark = statusMark(status);
  const color = toneColor(mark.tone);
  const glyph = (
    <Text style={{ color, fontFamily: mono, fontSize: 13, lineHeight: 18 }}>
      {mark.glyph}
    </Text>
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        flexShrink: 0,
      }}
    >
      {pulse && status === 'working' ? <Blink>{glyph}</Blink> : glyph}
      {label && (
        <Text style={{ color, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
          {mark.label}
        </Text>
      )}
    </View>
  );
}
function Blink({ children }: { children: ReactNode }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return <Animated.View style={{ opacity: anim }}>{children}</Animated.View>;
}
export function Notice({
  message,
  danger = false,
}: {
  message: string;
  danger?: boolean;
}) {
  const color = danger ? c.red : c.amber;
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: 12,
        borderRadius: radius,
        backgroundColor: tint(color, 0.08),
        borderLeftColor: color,
        borderLeftWidth: 2,
      }}
    >
      <Text style={{ color, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
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
      {/* Edge-to-edge Android does not resize for the keyboard; pad instead so
          fields and buttons in the sheet stay above it. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={{
          flex: 1,
          backgroundColor: c.scrim,
          justifyContent: 'flex-end',
        }}
      >
        <SafeAreaView
          edges={['bottom']}
          style={{
            backgroundColor: c.panel,
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            borderTopWidth: 1,
            borderColor: c.line,
            maxHeight: '90%',
          }}
        >
          <View style={[s.between, { padding: 16 }]}>
            <Text style={s.heading}>{title}</Text>
            <IconButton label="Close dialog" onPress={onClose} size={40}>
              <X color={c.text} size={18} />
            </IconButton>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 20,
              gap: 16,
            }}
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
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
    <Sheet title="needs attention" visible={!!message} onClose={onClose}>
      <Notice message={message ?? ''} danger />
      <Button title="got it" onPress={onClose} />
    </Sheet>
  );
}
export function Loading({
  label = 'connecting to your agents…',
}: {
  label?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <ActivityIndicator color={c.accent} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}
