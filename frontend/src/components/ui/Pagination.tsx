export function Pagination({
  total,
  limit,
  offset,
  onPageChange,
  label = 'items',
}: {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (offset: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.floor(offset / limit) + 1);
  if (total <= limit) return null;

  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label={`${label} pagination`}>
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPageChange(Math.max(0, offset - limit))}>
        Previous
      </button>
      <span className="mono num type-micro" aria-live="polite">
        Page {page} of {pages} · {total} {label}
      </span>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => onPageChange(offset + limit)}>
        Next
      </button>
    </nav>
  );
}
