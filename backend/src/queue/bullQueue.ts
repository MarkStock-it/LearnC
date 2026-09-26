import { config } from '../config.js';
import * as repo from '../db/repositories.js';
import { logger } from '../utils/logger.js';
import { processSubmission } from '../services/submissionProcessor.js';
import type { SubmissionQueue } from './queue.js';

interface BullJob {
  data: { submissionId: number };
  attemptsMade: number;
  opts: { attempts?: number };
}

interface BullQueueLike {
  add(data: { submissionId: number }, opts?: Record<string, unknown>): Promise<unknown>;
  process(concurrency: number, handler: (job: BullJob) => Promise<void>): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): Promise<void>;
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
}

/**
 * Production driver (plan §2.2): Bull backed by Redis, which gives durable jobs,
 * retries with exponential backoff and visibility across multiple worker processes.
 * `docker-compose.yml` provisions Redis; run workers with `npm run worker`.
 */
export class BullSubmissionQueue implements SubmissionQueue {
  readonly driver = 'bull' as const;
  private queue: BullQueueLike | null = null;

  private async connect(): Promise<BullQueueLike> {
    if (this.queue) return this.queue;
    const { default: Bull } = (await import('bull')) as unknown as {
      default: new (name: string, url: string, opts?: Record<string, unknown>) => BullQueueLike;
    };
    this.queue = new Bull(config.queue.name, config.queue.redisUrl, {
      defaultJobOptions: {
        attempts: config.queue.maxAttempts,
        backoff: { type: 'exponential', delay: config.queue.backoffMs },
        removeOnComplete: 200,
        removeOnFail: 1000,
      },
    });
    return this.queue;
  }

  async enqueue(submissionId: number): Promise<void> {
    const queue = await this.connect();
    await queue.add({ submissionId }, { jobId: undefined });
  }

  async start(): Promise<void> {
    const queue = await this.connect();

    queue.process(config.queue.concurrency, async (job: BullJob) => {
      await processSubmission(job.data.submissionId);
    });

    queue.on('failed', (...args: unknown[]) => {
      const [job, error] = args as [BullJob | undefined, Error | undefined];
      if (!job) return;
      const maxAttempts = job.opts.attempts ?? config.queue.maxAttempts;
      const exhausted = job.attemptsMade >= maxAttempts;
      logger.error(
        { submissionId: job.data.submissionId, attemptsMade: job.attemptsMade, maxAttempts, exhausted },
        'bull job failed',
      );
      if (exhausted) {
        void repo
          .updateSubmission(job.data.submissionId, {
            status: 'FAILED',
            errorMessage: (error?.message ?? 'unknown queue error').slice(0, 500),
            completedAt: new Date().toISOString(),
          })
          .catch((updateError: unknown) => {
            logger.error({ err: String(updateError) }, 'could not mark submission as failed');
          });
      }
    });

    queue.on('error', (...args: unknown[]) => {
      logger.error({ err: String((args as unknown[])[0]) }, 'bull queue error');
    });

    logger.info({ redis: config.queue.redisUrl, concurrency: config.queue.concurrency }, 'bull queue worker started');
  }

  async stop(): Promise<void> {
    await this.queue?.close();
    this.queue = null;
  }

  stats(): { pending: number; active: number } {
    return { pending: 0, active: 0 };
  }
}
