import type { DiffLine } from '../../services/api';

/**
 * Line-by-line differences, computed server-side.
 *
 * This is a **table**, and it stays one. An earlier pass rendered it as a div tree with
 * the listing's numbered rail, which looked right and read badly: the two output columns
 * were labelled only by a sentence above the tree, so a screen-reader user moving through
 * rows could not tell which column they were in, and there was no row header for the line
 * number. A diff is a matrix of expected-against-actual, and the markup now says so —
 * `<th scope="row">` for the line, `<th scope="col">` for the two outputs.
 *
 * The rail is kept as a visual treatment on the first column rather than as structure, so
 * the concept survives the semantics instead of replacing them.
 *
 * The trailing-space annotation is kept: a diff that hides an invisible whitespace
 * difference is a diff that lies.
 */
export function DiffView({ diff }: { diff: DiffLine[] }) {
  if (diff.length === 0) return null;

  return (
    <div className="flex flex-col gap-[var(--space-xs)]">
      <p className="type-micro">
        <span className="text-[var(--color-pass)]">expected</span>
        {' · '}
        <span className="text-[var(--color-fail)]">your output</span>
        {' · line numbers are the numbering of your own output'}
      </p>

      <table className="data-table">
        <caption className="sr-only">
          Differences between the expected output and the output your program produced. Each row is one line
          of your output: its line number, the expected text, and what you produced.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="num text-end">
              line
            </th>
            <th scope="col">expected</th>
            <th scope="col">your output</th>
          </tr>
        </thead>
        <tbody>
          {diff.map((entry) => {
            const expectedTrailing = entry.expected !== entry.expected.replace(/[ \t]+$/, '');
            const actualTrailing = entry.actual !== entry.actual.replace(/[ \t]+$/, '');

            return (
              <tr key={entry.line}>
                <th scope="row" className="num text-end align-top font-normal text-[var(--color-faint)]">
                  {entry.line}
                </th>
                <td className="align-top">
                  <span className="mono whitespace-pre text-[var(--color-pass)]">{entry.expected}</span>
                  {expectedTrailing ? <span className="type-micro ms-2">trailing space</span> : null}
                </td>
                <td className="align-top">
                  <span className="mono whitespace-pre text-[var(--color-fail)]">{entry.actual}</span>
                  {actualTrailing ? <span className="type-micro ms-2">trailing space</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
