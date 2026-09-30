import { useSyncExternalStore } from 'react';

export type ColorTheme = 'light' | 'dark';

export interface Preferences {
  /** App appearance is set explicitly and does not follow the operating-system theme. */
  theme: ColorTheme;
  /** Flag missing semicolons and unbalanced brackets as the student types. */
  liveCheck: boolean;
  /** Show the Execution stack panel next to the test results. */
  executionStack: boolean;
  /** Show the Memory button that opens the stack · heap · pointers view. */
  memoryViz: boolean;
}

export const defaultPreferences: Preferences = {
  theme: 'light',
  liveCheck: true,
  executionStack: true,
  memoryViz: true,
};

const STORAGE_KEY = 'c-practice.prefs';
const listeners = new Set<() => void>();

function applyTheme(theme: ColorTheme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'dark' ? '#191b20' : '#f8f9fb';
}

function read(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPreferences;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      ...defaultPreferences,
      ...parsed,
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      liveCheck: parsed.liveCheck !== false,
      executionStack: parsed.executionStack !== false,
      memoryViz: parsed.memoryViz !== false,
    };
  } catch {
    return defaultPreferences;
  }
}

let current: Preferences = defaultPreferences;

if (typeof window !== 'undefined') {
  current = read();
  applyTheme(current.theme);
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = read();
    applyTheme(current.theme);
    listeners.forEach((notify) => notify());
  });
}

export function savePreferences(patch: Partial<Preferences>): void {
  current = {
    ...current,
    ...patch,
    theme: patch.theme === undefined ? current.theme : patch.theme === 'dark' ? 'dark' : 'light',
    liveCheck: patch.liveCheck === undefined ? current.liveCheck : patch.liveCheck === true,
    executionStack: patch.executionStack === undefined ? current.executionStack : patch.executionStack === true,
    memoryViz: patch.memoryViz === undefined ? current.memoryViz : patch.memoryViz === true,
  };
  applyTheme(current.theme);
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* Private mode: settings still work for this page session. */
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

function getSnapshot(): Preferences {
  return current;
}

export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [prefs, savePreferences];
}
