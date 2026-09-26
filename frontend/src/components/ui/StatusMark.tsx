/**
 * Hand-built marks (Tier B — SVG, no icon library, no emoji).
 *
 * A verdict is carried by three signals at once: the mark's *shape*, its colour token,
 * and the written verdict beside it. Colour is never the only carrier — red/green alone
 * fails for the ~8% of men with red-green colour deficiency and reads as sloppy.
 */
export type MarkKind = 'pass' | 'wrong' | 'timeout' | 'crash' | 'pending';

const PATHS: Record<MarkKind, string> = {
  // Distinct silhouettes, not one shape recoloured.
  pass: 'M3.5 8.5l3 3 6-7',
  wrong: 'M4 4l8 8M12 4l-8 8',
  timeout: 'M8 3.5v4.8l3.2 2',
  crash: 'M8 3.5v5.2M8 12.2v.1',
  pending: 'M3.5 8h9',
};

const CIRCLE: MarkKind[] = ['timeout'];

export function StatusMark({ kind, className = '' }: { kind: MarkKind; className?: string }) {
  const needsCircle = CIRCLE.includes(kind);

  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {needsCircle && <circle cx="8" cy="8" r="5.75" strokeWidth="1.5" />}
      <path d={PATHS[kind]} />
    </svg>
  );
}
