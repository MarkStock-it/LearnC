import { createHash } from 'node:crypto';
import { config } from '../config.js';

/**
 * Free-tier Gemini token budget (default 20k tokens/min).
 *
 * Students bring their own key, and every quiz problem used to fire a full
 * generation call back-to-back with no pacing — a 5-problem quiz blows past
 * the free limit, earns a 429 storm, and then *escalated* to the more
 * expensive multi-call flow. This module paces calls against a per-key token
 * bucket instead: a call reserves `prompt estimate + planned output` before
 * it is allowed to fire, waits briefly for budget to refill, and gives up
 * (returning null) when the wait would stall the request — the caller then
 * falls back to the server provider or the offline bank instead of burning
 * quota it does not have.
 *
 * The bucket lives in process memory and the raw key never does: callers
 * pass the key once, everything after that is keyed by its SHA-256
 * fingerprint.
 */

/** Rough token estimate: ~4 characters per token for English prose and C. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** A Gemini failure caused by rate limits / quota, not by a bad request. */
export class GeminiQuotaError extends Error {
  /** How long the API asked us to wait, 0 when it did not say. */
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs = 0) {
    super(message);
    this.name = 'GeminiQuotaError';
    this.retryAfterMs = Math.max(0, retryAfterMs);
  }
}

export function isQuotaError(error: unknown): boolean {
  if (error instanceof GeminiQuotaError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|quota|tokens per minute|RESOURCE_EXHAUSTED/i.test(message);
}

interface RetryAfterSource {
  get(name: string): string | null;
}

/**
 * Read how long to back off from a 429: the `Retry-After` header first, then
 * Gemini's `error.details[]` `RetryInfo.retryDelay` (`"12s"` / `"12.5s"`).
 */
export function parseRetryAfterMs(payload: unknown, headers?: RetryAfterSource | null): number {
  const fromHeader = headers?.get('retry-after');
  if (fromHeader) {
    const seconds = Number.parseFloat(fromHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120_000);
  }
  const details = (payload as { error?: { details?: unknown } } | null)?.error?.details;
  if (Array.isArray(details)) {
    for (const entry of details) {
      const delay = (entry as { retryDelay?: unknown } | null)?.retryDelay;
      if (typeof delay === 'string') {
        const seconds = Number.parseFloat(delay);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120_000);
      }
    }
  }
  return 0;
}

export function fingerprintApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  blockedUntil: number;
  /** Promise chain so concurrent reservations for one key serialize. */
  tail: Promise<void>;
}

const buckets = new Map<string, Bucket>();

function refill(bucket: Bucket, now: number, capacity: number): void {
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updatedAt) * capacity) / 60_000);
  bucket.updatedAt = now;
}

export interface BudgetReservation {
  fingerprint: string;
  waitedMs: number;
}

/**
 * Reserve `estimatedTotalTokens` against the key's per-minute budget.
 * Returns null when the wait would exceed `maxWaitMs` (default
 * `GEMINI_BUDGET_WAIT_MS`) — the caller should fall back, not fire.
 */
export async function reserveGeminiBudget(
  apiKey: string,
  estimatedTotalTokens: number,
  opts?: { maxWaitMs?: number },
): Promise<BudgetReservation | null> {
  const fingerprint = fingerprintApiKey(apiKey);
  const capacity = Math.max(1_000, config.ai.geminiTpmLimit);
  const maxWaitMs = opts?.maxWaitMs ?? config.ai.geminiBudgetWaitMs;
  const estimated = Math.min(Math.max(1, Math.ceil(estimatedTotalTokens)), capacity);

  let bucket = buckets.get(fingerprint);
  if (!bucket) {
    bucket = { tokens: capacity, updatedAt: Date.now(), blockedUntil: 0, tail: Promise.resolve() };
    buckets.set(fingerprint, bucket);
  }
  const current = bucket;

  const run = current.tail.then(async (): Promise<BudgetReservation | null> => {
    const start = Date.now();
    refill(current, start, capacity);
    const readyAt = Math.max(start, current.blockedUntil);
    let waitMs = Math.max(0, readyAt - start);
    if (current.tokens < estimated) {
      waitMs = Math.max(waitMs, Math.ceil(((estimated - current.tokens) / capacity) * 60_000));
    }
    if (waitMs > maxWaitMs) return null;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const now = Date.now();
    refill(current, now, capacity);
    current.tokens = Math.max(0, current.tokens - estimated);
    return { fingerprint, waitedMs: now - start };
  });
  current.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Reconcile an estimate with the real `usageMetadata.totalTokenCount`. */
export function reconcileGeminiUsage(fingerprint: string, estimated: number, actualTotal: number): void {
  const bucket = buckets.get(fingerprint);
  if (!bucket) return;
  const capacity = Math.max(1_000, config.ai.geminiTpmLimit);
  bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, estimated - actualTotal));
}

/** Remember a server-ordered backoff so the next reservation waits it out. */
export function noteGeminiRetryAfter(fingerprint: string, retryAfterMs: number): void {
  const bucket = buckets.get(fingerprint);
  if (!bucket || retryAfterMs <= 0) return;
  bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + Math.min(retryAfterMs, 120_000));
}

/** Test hook: drop every bucket. */
export function resetGeminiBudgetsForTests(): void {
  buckets.clear();
}
