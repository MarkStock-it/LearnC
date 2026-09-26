/** Dates read as data, not as a locale dump. Compact and tabular-friendly. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';

  const date = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '—';

  const day = date.getDate();
  const month = date.toLocaleString('en', { month: 'short' });
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  return `${day} ${month}, ${time}`;
}

/** "7 of 7" reads better than "7/7" in prose; keep the fraction for dense cells. */
export function formatRatio(passed: number, total: number): string {
  return total === 0 ? `${passed}` : `${passed}/${total}`;
}
