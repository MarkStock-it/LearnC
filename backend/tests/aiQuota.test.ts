import { beforeEach, describe, expect, it } from 'vitest';
import {
  estimateTokens,
  fingerprintApiKey,
  GeminiQuotaError,
  isQuotaError,
  noteGeminiRetryAfter,
  parseRetryAfterMs,
  reconcileGeminiUsage,
  reserveGeminiBudget,
  resetGeminiBudgetsForTests,
} from '../src/services/aiQuota.js';

beforeEach(() => resetGeminiBudgetsForTests());

describe('estimateTokens', () => {
  it('estimates roughly four characters per token with a floor of one', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });
});

describe('fingerprintApiKey', () => {
  it('is deterministic, hex, and separates keys without storing them', () => {
    const a = fingerprintApiKey('AIza-first-key');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintApiKey('AIza-first-key')).toBe(a);
    expect(fingerprintApiKey('AIza-second-key')).not.toBe(a);
  });
});

describe('isQuotaError', () => {
  it('recognises quota failures and ignores ordinary errors', () => {
    expect(isQuotaError(new GeminiQuotaError('over budget'))).toBe(true);
    expect(isQuotaError(new Error('Gemini API returned 429: quota exceeded'))).toBe(true);
    expect(isQuotaError(new Error('rate limit hit, retry later'))).toBe(true);
    expect(isQuotaError(new Error('RESOURCE_EXHAUSTED: tokens per minute'))).toBe(true);
    expect(isQuotaError(new Error('Gemini returned an empty response'))).toBe(false);
    expect(isQuotaError(new Error('boom'))).toBe(false);
  });
});

describe('parseRetryAfterMs', () => {
  it('prefers the Retry-After header and caps absurd values', () => {
    const headers = { get: (name: string) => (name === 'retry-after' ? '5' : null) };
    expect(parseRetryAfterMs({}, headers)).toBe(5000);
    expect(parseRetryAfterMs({}, { get: () => '9999' })).toBe(120_000);
  });

  it('falls back to Gemini RetryInfo.retryDelay, else zero', () => {
    const payload = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12.5s' }] } };
    expect(parseRetryAfterMs(payload, null)).toBe(12_500);
    expect(parseRetryAfterMs({ error: { message: 'slow down' } }, null)).toBe(0);
    expect(parseRetryAfterMs({}, null)).toBe(0);
  });
});

describe('reserveGeminiBudget', () => {
  it('grants reservations while budget remains and refuses when the wait is too long', async () => {
    // Default test capacity is the 20k free-tier budget: drain it, then the
    // next call must fail fast instead of stalling the request.
    const first = await reserveGeminiBudget('AIza-quota-key', 20_000, { maxWaitMs: 0 });
    expect(first).not.toBeNull();
    const second = await reserveGeminiBudget('AIza-quota-key', 20_000, { maxWaitMs: 0 });
    expect(second).toBeNull();
  });

  it('serialises concurrent reservations on one key instead of double-spending', async () => {
    const [a, b] = await Promise.all([
      reserveGeminiBudget('AIza-race-key', 15_000, { maxWaitMs: 0 }),
      reserveGeminiBudget('AIza-race-key', 15_000, { maxWaitMs: 0 }),
    ]);
    // Only one 15k slice fits in a fresh 20k bucket.
    expect([a, b].filter((reservation) => reservation !== null)).toHaveLength(1);
  });

  it('reconciles estimates with real usage so honest calls get budget back', async () => {
    const key = 'AIza-reconcile-key';
    const reservation = await reserveGeminiBudget(key, 5000, { maxWaitMs: 0 });
    expect(reservation).not.toBeNull();
    // The call only spent 1000 of the estimated 5000: 19k is free again.
    reconcileGeminiUsage(reservation!.fingerprint, 5000, 1000);
    const again = await reserveGeminiBudget(key, 19_000, { maxWaitMs: 0 });
    expect(again).not.toBeNull();
  });

  it('honours a server-ordered backoff from a 429', async () => {
    const key = 'AIza-backoff-key';
    const reservation = await reserveGeminiBudget(key, 100, { maxWaitMs: 0 });
    expect(reservation).not.toBeNull();
    noteGeminiRetryAfter(reservation!.fingerprint, 60_000);
    expect(await reserveGeminiBudget(key, 100, { maxWaitMs: 0 })).toBeNull();
  });
});

describe('GeminiQuotaError', () => {
  it('carries a non-negative backoff hint', () => {
    expect(new GeminiQuotaError('slow down', 7000).retryAfterMs).toBe(7000);
    expect(new GeminiQuotaError('slow down').retryAfterMs).toBe(0);
    expect(new GeminiQuotaError('slow down', -5).retryAfterMs).toBe(0);
  });
});
