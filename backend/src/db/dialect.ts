import { config } from '../config.js';

/**
 * Format a timestamp for the active SQL dialect.
 *
 * MySQL/MariaDB (strict mode) rejects ISO-8601 strings with a `Z` suffix in
 * datetime columns ("Incorrect datetime value") — it wants `YYYY-MM-DD
 * HH:MM:SS[.fff]` interpreted in the session time zone. Postgres and SQLite
 * accept ISO strings as-is, so only the MySQL branch converts.
 */
export function sqlTimestamp(value: Date = new Date()): string {
  if (config.db.client !== 'mysql') return value.toISOString();

  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.` +
    `${pad(value.getMilliseconds(), 3)}`
  );
}
