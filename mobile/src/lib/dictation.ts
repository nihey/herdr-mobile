export const languages = [
  { code: 'en-US', short: 'EN', name: 'English' },
  { code: 'pt-BR', short: 'PT', name: 'Portuguese (Brazil)' },
] as const;
export type Language = (typeof languages)[number]['code'];

export function parseLanguage(value: string | null): Language {
  return languages.find((item) => item.code === value)?.code ?? 'en-US';
}

export function nextLanguage(current: Language): Language {
  const index = languages.findIndex((item) => item.code === current);
  return languages[(index + 1) % languages.length].code;
}

export function languageInfo(code: Language) {
  return languages.find((item) => item.code === code) ?? languages[0];
}

const normalize = (locale: string) => locale.replace('_', '-').toLowerCase();

export function hasLocale(installed: string[], code: Language): boolean {
  return installed.some((locale) => normalize(locale) === normalize(code));
}

/**
 * Android's continuous recognizer reports speech as a series of final
 * segments followed by the phrase it is still hearing.
 */
export function spokenText(finals: string[], interim: string): string {
  return [...finals, interim]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

export function joinDictation(base: string, spoken: string): string {
  if (!spoken) return base;
  if (!base || /\s$/.test(base)) return base + spoken;
  return `${base} ${spoken}`;
}
