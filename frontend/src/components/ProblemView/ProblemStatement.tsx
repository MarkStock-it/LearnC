import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ProblemDetail } from '../../services/api';
import { revealDelay } from '../../lib/reveal';

/**
 * Statement typography is handled by the `.prose` rules in the component layer rather
 * than per-element renderers: one place to reason about measure, rhythm and code
 * framing. Code blocks get a typographic frame (top and bottom rule), never a faked
 * window with traffic-light dots.
 *
 * `.prose` is also the one block in the app that opts out of the monospace face: this is
 * the longest thing a student reads and it was written by a person, so it is set in the
 * face a person writes in. The sample input/output wells below stay monospace, because
 * those are program output.
 */
export function ProblemStatement({ problem }: { problem: ProblemDetail }) {
  const hiddenCases = Math.max(problem.testCaseCount - problem.publicTestCaseCount, 0);

  return (
    <article className="flex flex-col gap-[var(--space-lg)]">
      <header className="a-compile flex flex-col gap-[var(--space-sm)]">
        <h1 className="type-display">{problem.title}</h1>

        {/* Difficulty and provenance stack under the title. A label sharing the
         * heading's row is the section-head tell (gate 54). */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="mono type-micro">{problem.difficulty}</span>
          {problem.aiGenerated ? <span className="mono type-micro">generated</span> : null}
        </div>

        {problem.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {problem.tags.map((tag) => (
              <li key={tag} className="tag">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-y border-[var(--color-rule)] py-[var(--space-sm)]">
          <div className="flex items-baseline gap-1.5">
            <dt className="type-micro">Limit</dt>
            <dd className="num type-small">{problem.constraints.time_limit_seconds}s per case</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="type-micro">Memory</dt>
            <dd className="num type-small">{problem.constraints.memory_limit_mb} MB</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="type-micro">Test cases</dt>
            <dd className="num type-small">
              {problem.testCaseCount}
              {hiddenCases > 0 ? `, of which ${hiddenCases} hidden` : ''}
            </dd>
          </div>
        </dl>
      </header>

      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{problem.description}</ReactMarkdown>
      </div>

      {problem.publicTestCases.length > 0 ? (
        <section aria-labelledby="samples-heading" className="flex flex-col gap-[var(--space-sm)]">
          <h2 id="samples-heading" className="type-title">
            Visible samples
          </h2>
          <p className="type-small text-[var(--color-muted)]">
            These run on every submission.
            {hiddenCases > 0 ? ` The other ${hiddenCases} cases are hidden and cover the boundary conditions.` : ''}
          </p>

          {problem.publicTestCases.map((testCase, index) => (
            <figure key={testCase.id} className="a-row flex flex-col gap-[var(--space-xs)]" style={revealDelay(index)}>
              <figcaption className="type-micro">
                Sample {index + 1}
                {testCase.description ? `, ${testCase.description.toLowerCase()}` : ''}
              </figcaption>
              <div className="grid gap-[var(--space-xs)] md:grid-cols-2">
                <div className="well p-[var(--space-sm)]">
                  <p className="type-micro mb-1">Input</p>
                  <pre className="mono max-h-32 overflow-auto text-[var(--text-small)] whitespace-pre-wrap">
                    {testCase.inputData}
                  </pre>
                </div>
                <div className="well p-[var(--space-sm)]">
                  <p className="type-micro mb-1">Expected output</p>
                  <pre className="mono max-h-32 overflow-auto text-[var(--text-small)] whitespace-pre-wrap">
                    {testCase.expectedOutput}
                  </pre>
                </div>
              </div>
            </figure>
          ))}
        </section>
      ) : null}
    </article>
  );
}
