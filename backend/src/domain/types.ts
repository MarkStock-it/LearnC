/** Shared domain vocabulary — mirrors the DB schema in `db/migrations`. */

export const SUBMISSION_STATUSES = [
  'QUEUED',
  'COMPILING',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const ERROR_TYPES = [
  'PASS',
  'WRONG_ANSWER',
  'TIMEOUT',
  'RUNTIME_ERROR',
  'COMPILATION_ERROR',
] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface TestCase {
  id: number;
  problemId: number;
  inputData: string;
  expectedOutput: string;
  isPublic: boolean;
  description: string | null;
  weight: number;
}

export interface ExecutionLimits {
  timeLimitMs: number;
  memoryLimitMb: number;
  pidsLimit: number;
  maxOutputBytes: number;
}

/** One test case after the sandbox ran the student binary against it. */
export interface TestCaseRun {
  testCaseId: number;
  passed: boolean;
  errorType: ErrorType;
  actualOutput: string;
  stderr: string;
  runtimeMs: number;
  memoryUsedMb: number | null;
}

export interface ExecutionOutcome {
  compiled: boolean;
  /** gcc/clang diagnostics when `compiled` is false. */
  compilationError: string | null;
  /** Always present so the UI can show warnings even on success. */
  compilerOutput: string;
  runs: TestCaseRun[];
  /** Which sandbox produced this outcome — surfaced in the API for transparency. */
  executor: 'docker' | 'local';
}

export interface DiffLine {
  line: number;
  expected: string;
  actual: string;
}

export interface EvaluationResult {
  passed: boolean;
  errorType: ErrorType;
  diff: DiffLine[];
  normalizedActual: string;
  normalizedExpected: string;
}
