import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SubmissionResponse, type SubmissionStatus } from '../services/api';

export type SubmissionPhase = 'idle' | 'running' | 'done' | 'error';

export interface UseCodeSubmission {
  phase: SubmissionPhase;
  detail: SubmissionResponse | null;
  /** Live status while polling: QUEUED → COMPILING → EXECUTING → COMPLETED. */
  liveStatus: SubmissionStatus | null;
  error: string | null;
  elapsedMs: number;
  submit: (code: string) => Promise<void>;
  reset: () => void;
}

const MAX_POLLS = 240;

/**
 * Submit code and poll for the verdict (plan §Phase 4, task 5).
 *
 * Polling backs off gently instead of hammering the API, and every wait is
 * cancellable so navigating away mid-run leaves no dangling timers.
 */
export function useCodeSubmission(problemId: number): UseCodeSubmission {
  const [phase, setPhase] = useState<SubmissionPhase>('idle');
  const [detail, setDetail] = useState<SubmissionResponse | null>(null);
  const [liveStatus, setLiveStatus] = useState<SubmissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      cancelled.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const reset = useCallback(() => {
    cancelled.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setPhase('idle');
    setDetail(null);
    setLiveStatus(null);
    setError(null);
    setElapsedMs(0);
  }, []);

  const submit = useCallback(
    async (code: string) => {
      cancelled.current = false;
      setPhase('running');
      setError(null);
      setDetail(null);
      setLiveStatus('QUEUED');
      const startedAt = performance.now();

      try {
        const created = await api.submit(problemId, code);
        let delay = created.pollIntervalMs ?? 700;
        setLiveStatus(created.status);

        for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
          if (cancelled.current) return;

          const response = await api.submission(created.submissionId);
          if (cancelled.current) return;

          setLiveStatus(response.submission.status);
          setElapsedMs(Math.round(performance.now() - startedAt));

          if (response.submission.isFinished) {
            setDetail(response);
            setPhase('done');
            return;
          }

          await new Promise<void>((resolve) => {
            timer.current = window.setTimeout(resolve, delay);
          });
          delay = Math.min(delay + 120, 1_500);
        }

        throw new Error('The grader took too long to respond. Please try again.');
      } catch (caught) {
        if (cancelled.current) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setPhase('error');
      }
    },
    [problemId],
  );

  return { phase, detail, liveStatus, error, elapsedMs, submit, reset };
}
