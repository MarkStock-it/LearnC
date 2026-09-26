import { config } from '../config.js';
import * as repo from '../db/repositories.js';
import { logger } from '../utils/logger.js';
import { processSubmission } from '../services/submissionProcessor.js';
import type { SubmissionQueue } from './queue.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-process FIFO queue. Same retry semantics as the Bull driver: up to
 * `QUEUE_MAX_ATTEMPTS` attempts with exponential backoff, then the submission is
 * marked FAILED with the infrastructure error (plan §Phase 3, task 3).
 */
export class InlineSubmissionQueue implements SubmissionQueue {
  readonly driver = 'inline' as const;
  private readonly pending: number[] = [];
  private active = 0;
  private draining = false;
  private stopped = false;
  private readonly idleWaiters: Array<() => void> = [];

  constructor(
    private readonly concurrency: number = config.queue.concurrency,
    private readonly maxAttempts: number = config.queue.maxAttempts,
    private readonly backoffMs: number = config.queue.backoffMs,
    private readonly processor: (submissionId: number) => Promise<void> = processSubmission,
  ) {}

  enqueue(submissionId: number): Promise<void> {
    this.pending.push(submissionId);
    this.scheduleDrain();
    return Promise.resolve();
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.scheduleDrain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.awaitIdle().catch(() => undefined);
  }

  stats(): { pending: number; active: number } {
    return { pending: this.pending.length, active: this.active };
  }

  async awaitIdle(timeoutMs = 30_000): Promise<void> {
    if (this.pending.length === 0 && this.active === 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for the inline queue to drain')), timeoutMs);
      this.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    while (!this.stopped && this.active < this.concurrency && this.pending.length > 0) {
      const submissionId = this.pending.shift();
      if (submissionId === undefined) break;
      this.active += 1;
      void this.runWithRetries(submissionId).finally(() => {
        this.active -= 1;
        if (this.pending.length === 0 && this.active === 0) {
          const waiters = this.idleWaiters.splice(0);
          for (const waiter of waiters) waiter();
        } else {
          this.scheduleDrain();
        }
      });
    }
  }

  private async runWithRetries(submissionId: number): Promise<void> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.processor(submissionId);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isLastAttempt = attempt === this.maxAttempts;
        logger.error(
          { submissionId, attempt, maxAttempts: this.maxAttempts, err: message, retrying: !isLastAttempt },
          'submission processing failed',
        );
        if (isLastAttempt) {
          await repo
            .updateSubmission(submissionId, {
              status: 'FAILED',
              errorMessage: message.slice(0, 500),
              completedAt: new Date().toISOString(),
            })
            .catch((updateError: unknown) => {
              logger.error({ submissionId, err: String(updateError) }, 'could not mark submission as failed');
            });
          return;
        }
        await sleep(this.backoffMs * 2 ** (attempt - 1));
      }
    }
  }
}
