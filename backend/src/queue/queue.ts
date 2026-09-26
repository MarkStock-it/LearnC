/**
 * Queue abstraction. Bull/Redis is the production driver (plan §2.2); the inline
 * driver runs the same worker function in-process so the platform works with no
 * external services during development and tests.
 */
export interface SubmissionQueue {
  readonly driver: 'inline' | 'bull';
  enqueue(submissionId: number): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  stats(): { pending: number; active: number };
  /** Test/dev helper: resolves once the queue has nothing left to do. */
  awaitIdle?(timeoutMs?: number): Promise<void>;
}
