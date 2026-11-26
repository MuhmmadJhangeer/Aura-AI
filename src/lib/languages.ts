export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "auto", name: "Auto-Detect", nativeName: "خودکار / Auto", flag: "🌐" },
  { code: "urdu", name: "Urdu", nativeName: "اردو", flag: "🇵🇰" },
  { code: "pashto", name: "Pashto / Pukhto", nativeName: "پشتو", flag: "🇵🇰" },
  { code: "punjabi", name: "Punjabi", nativeName: "پنجابی", flag: "🇵🇰" },
  { code: "sindhi", name: "Sindhi", nativeName: "سنڌي", flag: "🇵🇰" },
  { code: "balochi", name: "Balochi", nativeName: "بلوچی", flag: "🇵🇰" },
  { code: "saraiki", name: "Saraiki", nativeName: "سرائیکی", flag: "🇵🇰" },
  { code: "kashmiri", name: "Kashmiri", nativeName: "کشمیری", flag: "🇵🇰" },
  { code: "english", name: "English", nativeName: "English", flag: "🇬🇧" },
];

export function getLanguageByCode(code: string): LanguageOption {
  return (
    SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === code.toLowerCase()) ||
    SUPPORTED_LANGUAGES[0]
  );
}
