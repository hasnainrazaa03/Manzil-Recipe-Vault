import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';
type Preference = Theme | 'system';

const STORAGE_KEY = 'manzil-theme';

interface ThemeContextValue {
  /** The theme actually applied right now. */
  theme: Theme;
  /** What the user chose — `system` follows the OS. */
  preference: Preference;
  setPreference: (preference: Preference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): Preference {
  if (typeof localStorage === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function systemTheme(): Theme {
  if (typeof matchMedia === 'undefined') return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<Preference>(readStoredPreference);
  const [systemPreference, setSystemPreference] = useState<Theme>(systemTheme);

  // Follow the OS while the user is on `system`, including live changes.
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemPreference(event.matches ? 'dark' : 'light');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = preference === 'system' ? systemPreference : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Lets the browser paint form controls and scrollbars to match.
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        if (next === 'system') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, next);
      },
      toggle: () => {
        const next: Theme = theme === 'dark' ? 'light' : 'dark';
        setPreferenceState(next);
        localStorage.setItem(STORAGE_KEY, next);
      },
    }),
    [theme, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
