import { useSyncExternalStore } from 'react';

/**
 * The three editor preferences from the workbench concept, in one place.
 *
 * The gear in the toolbar writes; the practice page reads. Both sides subscribe to
 * the same store, so flipping a checkbox updates the page instantly without prop
 * threading or context. Values persist in localStorage under one key.
 */
export interface Preferences {
  /** Flag missing semicolons and unbalanced brackets as the student types. */
  liveCheck: boolean;
  /** Show the Execution stack panel (crash explanation) next to the test results. */
  executionStack: boolean;
  /** Show the Memory button that opens the stack · heap · pointers view. */
  memoryViz: boolean;
}

export const defaultPreferences: Preferences = {
  liveCheck: true,
  executionStack: true,
  memoryViz: true,
};

const STORAGE_KEY = 'c-practice.prefs';

function read(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPreferences;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...defaultPreferences, ...parsed };
  } catch {
    return defaultPreferences;
  }
}

let current: Preferences = defaultPreferences;
const listeners = new Set<() => void>();

// Seed synchronously once at module load: every consumer reads the same snapshot.
if (typeof window !== 'undefined') {
  current = read();
}

export function savePreferences(patch: Partial<Preferences>): void {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* private mode: prefs just do not persist */
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

/** React binding: re-renders whenever any preference changes. */
export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [prefs, savePreferences];
}
