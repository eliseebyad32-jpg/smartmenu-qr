import React, { createContext, useContext, useEffect, useState } from 'react';
import { UI_TRANSLATIONS } from '../i18n/translations';
import { Language, LocalizedText } from '../types/menu';

const STORAGE_KEY = 'smartmenu_qr_language';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (typeof UI_TRANSLATIONS)['fr'] | (typeof UI_TRANSLATIONS)['en'];
  pick: (text: LocalizedText) => string;
  formatFC: (price: number) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'fr';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') {
      return saved;
    }
  } catch {
    // Ignore storage read errors in restricted contexts
  }
  return 'fr';
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore storage write errors
    }
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const pick = (text: LocalizedText): string => text[language];

  const formatFC = (price: number): string => {
    const formatted = Math.round(price)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${formatted} FC`;
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t: UI_TRANSLATIONS[language],
        pick,
        formatFC,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return ctx;
}
