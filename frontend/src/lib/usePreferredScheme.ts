import { useEffect, useState } from 'react';

export type Scheme = 'light' | 'dark';

/**
 * The CSS layer follows `prefers-color-scheme` on its own. This hook exists for the
 * parts CSS cannot reach — CodeMirror's theme is a JS object, so it needs to know when
 * the user flips their system appearance at runtime.
 */
export function usePreferredScheme(): Scheme {
  const [scheme, setScheme] = useState<Scheme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setScheme(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return scheme;
}
