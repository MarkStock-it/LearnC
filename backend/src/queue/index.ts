import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { BullSubmissionQueue } from './bullQueue.js';
import { InlineSubmissionQueue } from './inlineQueue.js';
import type { SubmissionQueue } from './queue.js';

let queue: SubmissionQueue | null = null;

export function createQueue(): SubmissionQueue {
  return config.queue.driver === 'bull' ? new BullSubmissionQueue() : new InlineSubmissionQueue();
}

/** Lazily created singleton shared by the API and the worker entrypoint. */
export function getQueue(): SubmissionQueue {
  if (!queue) {
    queue = createQueue();
    logger.debug({ driver: queue.driver }, 'submission queue initialised');
  }
  return queue;
}

export async function startQueue(): Promise<SubmissionQueue> {
  const active = getQueue();
  await active.start();
  return active;
}

export async function stopQueue(): Promise<void> {
  if (!queue) return;
  await queue.stop();
  queue = null;
}

export async function enqueueSubmission(submissionId: number): Promise<void> {
  await getQueue().enqueue(submissionId);
}

export type { SubmissionQueue } from './queue.js';
