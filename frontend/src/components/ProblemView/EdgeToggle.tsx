/**
 * The small centred arrow on a panel's outer edge (the concept's grey chevrons).
 * Points outward when the panel is open (click = slide away), inward when collapsed
 * (click = bring it back).
 */
export function EdgeToggle({
  side,
  open,
  onClick,
}: {
  side: 'left' | 'right';
  open: boolean;
  onClick: () => void;
}) {
  // Left panel open → arrow points left (slide out to the left).
  const direction = side === 'left' ? (open ? 'left' : 'right') : open ? 'right' : 'left';
  const rotation = direction === 'left' ? 'rotate(180deg)' : 'rotate(0deg)';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? `Collapse ${side} panel` : `Expand ${side} panel`}
      aria-expanded={open}
      title={open ? 'Collapse panel' : 'Expand panel'}
      className={`group absolute top-1/2 z-[calc(var(--z-raised)+1)] flex size-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-hairline)] hover:text-[var(--color-ink)] ${
        side === 'left' ? '-left-3' : '-right-3'
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: rotation, transition: 'transform var(--dur-short) var(--ease-out)' }}
        aria-hidden
      >
        <path d="M6 3.5 10.5 8 6 12.5" />
      </svg>
    </button>
  );
}
