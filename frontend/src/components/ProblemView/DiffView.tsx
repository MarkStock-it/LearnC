import type { DiffLine } from '../../services/api';

/** Line-by-line differences, computed server-side (§9.1) and rendered as a plain table. */
export function DiffView({ diff }: { diff: DiffLine[] }) {
  if (diff.length === 0) return null;

  return (
    <table className="data-table">
      <caption className="sr-only">Differences between expected and actual output</caption>
      <thead>
        <tr>
          <th scope="col" className="w-10">
            Line
          </th>
          <th scope="col">Expected</th>
          <th scope="col">Your output</th>
        </tr>
      </thead>
      <tbody>
        {diff.map((entry) => {
          const expectedTrailing = entry.expected !== entry.expected.replace(/[ \t]+$/, '');
          const actualTrailing = entry.actual !== entry.actual.replace(/[ \t]+$/, '');

          return (
            <tr key={entry.line}>
              <td className="num type-micro">{entry.line}</td>
              <td className="mono text-[var(--color-pass)]">
                <span className="whitespace-pre">{entry.expected}</span>
                {expectedTrailing ? <span className="type-micro ms-2">trailing space</span> : null}
              </td>
              <td className="mono text-[var(--color-fail)]">
                <span className="whitespace-pre">{entry.actual}</span>
                {actualTrailing ? <span className="type-micro ms-2">trailing space</span> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
