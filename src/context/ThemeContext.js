import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Palettes ─────────────────────────────────────────────────────────────────

export const LIGHT = {
  isDark:      false,
  BG:          '#F0EDE8',
  CARD_BG:     '#EAE6DF',
  ELEVATED:    '#FFFFFF',
  TEXT:        '#1C1A18',
  TEXT_SUB:    '#555555',
  TEXT_MUTED:  '#999999',
  TEXT_FAINT:  '#BBBBBB',
  ORANGE:      '#E8602C',
  DARK_ORANGE: '#C04E1E',
  DIVIDER:     '#D9D0C7',
  INPUT_BG:    '#FFFFFF',
  BAR_ACTIVE:  '#D9C9B4',
  BAR_EMPTY:   '#E8E3DC',
  ICON_BG:     '#FFFFFF',
};

// Warm dark — earthy charcoal, not cold gray.
// Orange pops cleanly; background reads as midnight campfire, not a server room.
export const DARK = {
  isDark:      true,
  BG:          '#161412',
  CARD_BG:     '#201D1A',
  ELEVATED:    '#2C2825',
  TEXT:        '#EDE9E3',
  TEXT_SUB:    '#B0A498',
  TEXT_MUTED:  '#9A8E84',
  TEXT_FAINT:  '#5A5048',
  ORANGE:      '#E8602C',
  DARK_ORANGE: '#F4875A',
  DIVIDER:     '#2E2A26',
  INPUT_BG:    '#2C2825',
  BAR_ACTIVE:  '#4A3F36',
  BAR_EMPTY:   '#252220',
  ICON_BG:     '#2C2825',
};

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext({
  colors:      LIGHT,
  isDark:      false,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('@lauver_theme')
      .then(v => { if (v === 'dark') setIsDark(true); })
      .catch(() => {});
  }, []);

  const toggleTheme = () =>
    setIsDark(prev => {
      const next = !prev;
      AsyncStorage.setItem('@lauver_theme', next ? 'dark' : 'light').catch(() => {});
      return next;
    });

  const value = useMemo(
    () => ({ colors: isDark ? DARK : LIGHT, isDark, toggleTheme }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
