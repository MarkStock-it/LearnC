import { useEffect, useRef, useState } from 'react';
import { usePreferences, type Preferences } from '../../lib/preferences';

const GEAR_PATH =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z';

interface PrefRow {
  key: Exclude<keyof Preferences, 'theme'>;
  label: string;
  desc: string;
}

const ROWS: PrefRow[] = [
  {
    key: 'liveCheck',
    label: 'Live syntax check',
    desc: 'Flag missing semicolons and unbalanced brackets as you type',
  },
  {
    key: 'executionStack',
    label: 'Execution stack',
    desc: 'Show the crash explanation next to the test results',
  },
  {
    key: 'memoryViz',
    label: 'Memory visualization',
    desc: 'Show the Memory button that opens the stack · heap · pointers view',
  },
];

/**
 * The workbench concept's gear, top right: a 32px icon button opening a small
 * preferences popover. Outside clicks and Escape dismiss it; state lives in the
 * shared preference store so the practice page reacts instantly.
 */
export function PreferencesMenu() {
  const [prefs, save] = usePreferences();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const firstThemeButton = rootRef.current?.querySelector<HTMLButtonElement>('[aria-pressed]');
    firstThemeButton?.focus();
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Preferences"
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-rule)] bg-transparent text-[var(--color-muted)] transition-colors hover:border-[var(--color-hairline)] hover:text-[var(--color-ink)]"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d={GEAR_PATH} />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Preferences"
          aria-modal="false"
          tabIndex={-1}
          className="a-toast absolute end-0 top-[calc(100%+8px)] z-[var(--z-dropdown)] w-[290px] rounded-[var(--radius-surface)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-stamp)]"
        >
          <h4 className="type-micro px-2.5 pb-1.5 pt-2 font-[var(--weight-strong)] ">
            Preferences
          </h4>
          <fieldset className="border-b border-[var(--color-rule)] px-2.5 pb-3 pt-1">
            <legend className="type-small font-[var(--weight-medium)]">Appearance</legend>
            {/* Two machine keys. The selected one is told apart by its edge and weight as
             * well as by `aria-pressed`, because a second block of colour in the chrome is
             * exactly what this design keeps out. */}
            <div className="mt-2 grid grid-cols-2 gap-1" role="group" aria-label="Color theme">
              {(['light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  aria-pressed={prefs.theme === theme}
                  onClick={() => save({ theme })}
                  className={`min-h-11 rounded-[var(--radius-control)] border px-2 text-[var(--text-small)] capitalize transition-colors ${
                    prefs.theme === theme
                      ? 'border-[var(--color-hairline)] font-[var(--weight-strong)] text-[var(--color-ink)]'
                      : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
            <p className="type-micro mt-1.5">Choose the appearance used across the app.</p>
          </fieldset>
          {ROWS.map((row) => (
            <label key={row.key} className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2">
              <input
                type="checkbox"
                className="mt-1 accent-[var(--color-accent)]"
                checked={prefs[row.key]}
                onChange={(event) => save({ [row.key]: event.target.checked })}
              />
              <span>
                <span className="block text-[13px] font-[var(--weight-medium)] text-[var(--color-ink)]">{row.label}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--color-muted)]">{row.desc}</span>
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
