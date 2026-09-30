import { usePreferences } from './preferences';

/** Compatibility hook for components whose library theme is selected in JavaScript. */
export function usePreferredScheme(): 'light' | 'dark' {
  const [preferences] = usePreferences();
  return preferences.theme;
}
