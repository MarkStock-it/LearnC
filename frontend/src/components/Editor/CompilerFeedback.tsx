import { StatusMark } from '../ui/StatusMark';

interface Props {
  compilationError: string | null;
}

/**
 * A compile failure is a wall, not a nudge: it gets the failure tone, the mark and the
 * raw gcc output. The one line of guidance is real pedagogy — novices read cascading
 * errors top-down and fix the wrong one.
 *
 * `.a-diag` is the one entrance this app gives a diagnostic: three hard frames, no glide,
 * because a compiler does not ease into telling you that you were wrong. It clips from the
 * right rather than fading, so even mid-animation the text is legible where it has landed.
 */
export function CompilerFeedback({ compilationError }: Props) {
  if (!compilationError) return null;

  return (
    <section className="surface a-diag p-[var(--space-lg)]" aria-labelledby="compile-error-heading">
      <h3 id="compile-error-heading" className="type-title flex items-center gap-2">
        <span className="verdict-fail" aria-hidden>
          <StatusMark kind="wrong" />
        </span>
        Compilation failed
      </h3>

      <p className="type-small mt-1 text-[var(--color-muted)]">
        gcc stopped before the tests ran. Fix the first error in the list; the ones after it are usually knock-on
        effects.
      </p>

      <pre className="well mono mt-[var(--space-sm)] max-h-64 overflow-auto p-[var(--space-sm)] text-[var(--text-small)] whitespace-pre-wrap break-words border-s-2 border-s-[var(--color-accent)]">
        {compilationError}
      </pre>
    </section>
  );
}
