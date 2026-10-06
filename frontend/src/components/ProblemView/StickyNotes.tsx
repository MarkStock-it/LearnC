import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Floating sticky notes, layered above every panel.
 *
 * Ctrl/Cmd + S + E summons one at a relaxed random position. Each note drags with
 * mouse or touch, minimizes to a small labelled dot, or deletes. Notes persist in
 * localStorage for the session-plus (surviving reloads was the cheap option, so it
 * was taken). Pointer events only on the note chrome itself — a note that is not
 * being touched never intercepts keys meant for the editor.
 *
 * A note is bone paper laid on the bone page, held apart by a hard offset shadow and the
 * slight rotation of something stuck down by hand. It deliberately keeps the rotation:
 * that tilt is the one gesture in the app that says a person put this here. Its text is the
 * only proportional type in the workbench, because a note is someone writing, not a
 * machine printing.
 */

interface StickyNote {
  id: string;
  text: string;
  x: number;
  y: number;
  rotation: number;
  minimized: boolean;
}

const STORAGE_KEY = 'c-practice.stickies';

function loadNotes(): StickyNote[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StickyNote[]) : [];
  } catch {
    return [];
  }
}

/** A relaxed spawn point: middle-ish of the viewport, never off the edges. */
function spawnPosition(): { x: number; y: number } {
  const pad = 80;
  return {
    x: pad + Math.random() * Math.max(window.innerWidth - pad * 2 - 220, 100),
    y: pad + Math.random() * Math.max(window.innerHeight - pad * 2 - 160, 100),
  };
}

function Note({
  note,
  onChange,
  onRemove,
}: {
  note: StickyNote;
  onChange: (patch: Partial<StickyNote>) => void;
  onRemove: () => void;
}) {
  const dragState = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const [hovered, setHovered] = useState(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if ((event.target as HTMLElement).closest('button, textarea')) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      dragState.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragState.current) return;
      onChange({
        x: Math.max(8, event.clientX - dragState.current.offsetX),
        y: Math.max(8, event.clientY - dragState.current.offsetY),
      });
    },
    [onChange],
  );

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  if (note.minimized) {
    return (
      <button
        type="button"
        aria-label="Expand note"
        onClick={() => onChange({ minimized: false })}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragState.current = { offsetX: 14, offsetY: 14 };
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="fixed z-[var(--z-toast)] size-7 rounded-[var(--radius-micro)] border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[var(--shadow-stamp)]"
        style={{ left: note.x, top: note.y, transform: `rotate(${note.rotation}deg)` }}
        title="Note"
      >
        <span className="sr-only">note</span>
      </button>
    );
  }

  return (
    <div
      role="note"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="fixed z-[var(--z-toast)] w-[220px] rounded-[var(--radius-surface)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-stamp)]"
      style={{ left: note.x, top: note.y, transform: `rotate(${note.rotation}deg)`, touchAction: 'none' }}
    >
      <div className={`mb-1 flex justify-end gap-1 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}>
        <button
          type="button"
          aria-label="Minimize note"
          onClick={() => onChange({ minimized: true })}
          className="type-micro flex min-h-6 items-center justify-center rounded-[var(--radius-micro)] border border-[var(--color-rule)] px-1.5 text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          title="Minimize"
        >
          hide
        </button>
        <button
          type="button"
          aria-label="Delete note"
          onClick={onRemove}
          className="type-micro flex min-h-6 items-center justify-center rounded-[var(--radius-micro)] border border-[var(--color-rule)] px-1.5 text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          title="Delete"
        >
          delete
        </button>
      </div>
      {/* The only proportional type in the workbench: a note is a person writing. */}
      <textarea
        value={note.text}
        onChange={(event) => onChange({ text: event.target.value })}
        placeholder="Type a note…"
        rows={4}
        className="font-prose w-full resize-none bg-transparent text-[13.5px] leading-snug text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
        spellCheck={false}
      />
    </div>
  );
}

export function StickyNotes() {
  const [notes, setNotes] = useState<StickyNote[]>(() => loadNotes());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {
      /* private mode */
    }
  }, [notes]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 'e') return;
      // Ctrl/Cmd+S+E: suppress the browser's save dialog that Ctrl+S would trigger.
      event.preventDefault();
      const pos = spawnPosition();
      setNotes((current) => [
        ...current,
        {
          id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text: '',
          x: pos.x,
          y: pos.y,
          rotation: Math.random() * 4 - 2,
          minimized: false,
        },
      ]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const patch = useCallback((id: string, updater: Partial<StickyNote>) => {
    setNotes((current) => current.map((n) => (n.id === id ? { ...n, ...updater } : n)));
  }, []);

  const remove = useCallback((id: string) => {
    setNotes((current) => current.filter((n) => n.id !== id));
  }, []);

  return createPortal(
    <>
      {notes.map((note) => (
        <Note key={note.id} note={note} onChange={(p) => patch(note.id, p)} onRemove={() => remove(note.id)} />
      ))}
    </>,
    document.body,
  );
}
