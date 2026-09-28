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
      className={`group absolute top-1/2 z-[calc(var(--z-raised)+1)] flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] shadow-[0_2px_10px_oklch(20%_0.02_250_/_0.25)] transition-transform duration-300 hover:scale-110 ${
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
        style={{ transform: rotation, transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        aria-hidden
      >
        <path d="M6 3.5 10.5 8 6 12.5" />
      </svg>
    </button>
  );
}
