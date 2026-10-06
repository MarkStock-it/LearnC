/**
 * Single place that talks to the backend. The API is same-origin thanks to the Vite
 * proxy, so paths stay relative and no base URL configuration is required.
 *
 * Identity uses the MVP stub from the backend: a student name is sent as
 * `Authorization: Bearer <name>` and created on first use. Swapping in real JWT/CAS
 * auth later touches only this module.
 */

import { getGuestIdentity, isGuestMode, setGuestMode } from '../lib/guestMode';

const USER_STORAGE_KEY = 'c-practice.student';
const TOKEN_STORAGE_KEY = 'c-practice.token';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
}

export interface AiSettings {
  userId: number;
  hasPassword: boolean;
  hasGeminiKey: boolean;
  aiProvider: 'server' | 'gemini';
  leaderboardPublic: boolean;
}

export interface MeResponse {
  user: AuthUser;
  ai: AiSettings;
}

export interface GenerateResponse {
  count: number;
  problems: Array<{
    problemId: number;
    title: string;
    difficulty: Difficulty;
    verificationPassed: boolean;
    verificationDetail: string;
    warnings: string[];
    providerUsed?: 'gemini' | 'server' | 'offline';
  }>;
  problemSetId: number | null;
  geminiError: string | null;
  notes: string[];
}

export interface ProblemSetSummary {
  id: number;
  userId?: number | null;
  title: string;
  description: string | null;
  examYear: number | null;
  examSemester: string | null;
  difficulty: Difficulty;
  problemCount: number;
  createdAt: string;
  isPublic?: boolean;
  publishedAt?: string | null;
  creatorName?: string | null;
  firstProblemId?: number | null;
}

export interface PublicBundleDetail {
  problemSet: ProblemSetSummary;
  problems: Array<{ id: number; title: string; difficulty: Difficulty; tags: string[]; description: string }>;
  totalProblems: number;
  limit: number;
  offset: number;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  solvedProblems: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  limit: number;
  offset: number;
}

export type Difficulty = 'easy' | 'medium' | 'hard';
export type SubmissionStatus = 'QUEUED' | 'COMPILING' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
export type ErrorType = 'PASS' | 'WRONG_ANSWER' | 'TIMEOUT' | 'RUNTIME_ERROR' | 'COMPILATION_ERROR';

export interface ProblemListItem {
  id: number;
  problemSetId: number;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  testCaseCount: number;
  publicTestCaseCount: number;
  createdAt: string;
}

export interface PublicTestCase {
  id: number;
  inputData: string;
  expectedOutput: string;
  description: string | null;
}

export interface ProblemDetail {
  id: number;
  problemSetId: number;
  title: string;
  description: string;
  constraints: {
    time_limit_seconds: number;
    memory_limit_mb: number;
    input_format: string;
    output_format: string;
    sample_input: string;
    sample_output: string;
  };
  sampleInput: string | null;
  sampleOutput: string | null;
  difficulty: Difficulty;
  tags: string[];
  aiGenerated: boolean;
  testCaseCount: number;
  publicTestCaseCount: number;
  publicTestCases: PublicTestCase[];
}

export interface ProblemProgress {
  attempts: number;
  solved: boolean;
  bestPassedCount: number;
  lastSubmittedAt: string | null;
}

export interface ProblemResponse {
  problem: ProblemDetail;
  progress: ProblemProgress;
}

export interface DiffLine {
  line: number;
  expected: string;
  actual: string;
}

export interface TestCaseResult {
  testCaseId: number | null;
  label: string | null;
  description: string | null;
  isPublic: boolean;
  passed: boolean;
  errorType: ErrorType;
  message: string;
  runtimeMs: number | null;
  memoryUsedMb: number | null;
  stderr: string | null;
  inputData?: string | null;
  expectedOutput?: string | null;
  actualOutput?: string | null;
  diff?: DiffLine[];
}

export interface SubmissionDetail {
  id: number;
  problemId: number;
  problemTitle: string | null;
  status: SubmissionStatus;
  compilationError: string | null;
  executor: string | null;
  errorMessage: string | null;
  passedCount: number;
  totalCount: number;
  createdAt: string;
  completedAt: string | null;
  code: string;
  isFinished: boolean;
}

export interface SubmissionResponse {
  submission: SubmissionDetail;
  results: TestCaseResult[];
  solved: boolean;
  limits: { timeLimitSeconds: number | null; memoryLimitMb: number };
}

export interface SubmissionSummary {
  id: number;
  problemId: number;
  problemTitle: string;
  status: SubmissionStatus;
  passedCount: number;
  totalCount: number;
  executor: string | null;
  createdAt: string;
  completedAt: string | null;
  tags: string[];
}

export interface ProblemListResponse {
  count: number;
  total: number;
  limit: number;
  offset: number;
  problems: ProblemListItem[];
}

export interface DashboardResponse {
  user: { id: number; username: string };
  stats: {
    userId: number;
    totalSubmissions: number;
    completedSubmissions: number;
    solvedProblems: number;
    attemptedProblems: number;
    solvedProblemIds: number[];
    successRate: number;
  };
  recentSubmissions: Array<{
    id: number;
    problemId: number;
    problemTitle: string;
    status: SubmissionStatus;
    passedCount: number;
    totalCount: number;
    createdAt: string;
  }>;
}

export interface MemoryTraceVariable {
  id: string;
  name: string;
  type: string;
  value: string;
  pointer: boolean;
  heap: boolean;
  depth: number;
}

export interface MemoryTraceStep {
  line: number;
  sequence: number;
  variables: MemoryTraceVariable[];
  heap: Array<{ address: string; type: string; freed: boolean }>;
}

export interface MemoryTraceResponse {
  steps: MemoryTraceStep[];
  traceable: boolean;
  message: string | null;
  stderr: string;
}

export interface RunCodeResponse {
  status: 'completed' | 'timeout' | 'runtime_error' | 'compilation_error';
  compilationError: string | null;
  compilerOutput: string;
  stdout: string;
  stderr: string;
  runtimeMs: number | null;
  executor: 'docker' | 'local';
}

export interface HealthResponse {
  status: string;
  env: string;
  database: { client: string; status: string };
  queue: { driver: string; pending: number; active: number };
  sandbox: { kind: string; available: boolean; detail: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getStudentName(): string {
  if (isGuestMode()) return getGuestIdentity();
  return window.localStorage.getItem(USER_STORAGE_KEY) ?? '';
}

export function setStudentName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) window.localStorage.removeItem(USER_STORAGE_KEY);
  else window.localStorage.setItem(USER_STORAGE_KEY, trimmed);
}

export function getToken(): string {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
}

export function setToken(token: string): void {
  if (token.length === 0) window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  else window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/** True when the stored credential is a real session token (login flow). */
export function isLoggedIn(): boolean {
  return !isGuestMode() && getToken().length > 0;
}

/** Include user identity in React Query keys for any response scoped to a user. */
export function getQueryIdentity(): string {
  if (isGuestMode()) return `guest:${getGuestIdentity()}`;
  if (isLoggedIn()) return `account:${getToken()}`;
  return 'anonymous';
}

export function signOut(): void {
  setToken('');
  setStudentName('');
}

/**
 * Fired when the server rejects the credential we presented.
 *
 * `signOut()` clears what this app *stores*; this is the different, factual event that the
 * server no longer honours it. Something has to re-render when that happens, because until
 * it does the app keeps presenting a signed-in shell that every single request refuses.
 */
const sessionLostListeners = new Set<() => void>();

/** Subscribe to "the stored credential was rejected". Returns an unsubscribe function. */
export function onSessionLost(listener: () => void): () => void {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
}

function discardRejectedSession(): void {
  signOut();
  for (const listener of [...sessionLostListeners]) listener();
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const token = isGuestMode() ? '' : getToken();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    // A 401 is proof of a dead session only when a credential was actually presented, so
    // the check is on `token`, not on `isLoggedIn()`. A guest sends no credential at all,
    // and a failed sign-in attempt sends none either — neither can be signed out by this.
    if (response.status === 401 && token.length > 0) discardRejectedSession();

    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}

export const api = {
  isAuthenticated: () => isLoggedIn(),

  health: () => http<HealthResponse>('/health'),

  traceMemory: (problemId: number, code: string, stdin: string) =>
    http<MemoryTraceResponse>('/memory-trace', {
      method: 'POST',
      body: JSON.stringify({ problemId, code, stdin }),
    }),

  runCode: (problemId: number, code: string, stdin: string) =>
    http<RunCodeResponse>('/run-code', {
      method: 'POST',
      body: JSON.stringify({ problemId, code, stdin }),
    }),

  problemSets: (params: { search?: string; difficulty?: Difficulty; tag?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.difficulty) query.set('difficulty', params.difficulty);
    if (params.tag) query.set('tag', params.tag);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const suffix = query.toString();
    return http<{ count: number; total: number; limit: number; offset: number; problemSets: ProblemSetSummary[] }>(`/problem-sets${suffix ? `?${suffix}` : ''}`);
  },

  publicBundles: (params: { search?: string; difficulty?: Difficulty; tag?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.difficulty) query.set('difficulty', params.difficulty);
    if (params.tag) query.set('tag', params.tag);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const suffix = query.toString();
    return http<{ count: number; total: number; limit: number; offset: number; problemSets: ProblemSetSummary[] }>(`/public-bundles${suffix ? `?${suffix}` : ''}`);
  },

  publicBundle: (id: number, params: { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const suffix = query.toString();
    return http<PublicBundleDetail>(`/public-bundles/${id}${suffix ? `?${suffix}` : ''}`);
  },

  publishBundle: (id: number, isPublic: boolean) => http<{ problemSet: ProblemSetSummary }>(`/problem-sets/${id}/publish`, { method: 'POST', body: JSON.stringify({ isPublic }) }),

  deleteBundle: (id: number) => http<void>(`/problem-sets/${id}?confirm=true`, { method: 'DELETE' }),

  forkBundle: (id: number, title?: string) => http<{ problemSetId: number }>(`/problem-sets/${id}/fork`, { method: 'POST', body: JSON.stringify({ title }) }),

  problems: (params: { problemSetId?: number; difficulty?: Difficulty; tag?: string; search?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.problemSetId !== undefined) query.set('problemSetId', String(params.problemSetId));
    if (params.difficulty) query.set('difficulty', params.difficulty);
    if (params.tag) query.set('tag', params.tag);
    if (params.search) query.set('search', params.search);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const suffix = query.toString();
    return http<ProblemListResponse>(`/problems${suffix ? `?${suffix}` : ''}`);
  },

  problemSet: (id: number) => http<{ problemSet: ProblemSetSummary }>(`/problem-sets/${id}`),

  problem: (id: number) => http<ProblemResponse>(`/problems/${id}`),

  submit: (problemId: number, code: string) =>
    http<{ submissionId: number; status: SubmissionStatus; pollIntervalMs: number }>('/submissions', {
      method: 'POST',
      body: JSON.stringify({ problemId, code }),
    }),

  submission: (id: number) => http<SubmissionResponse>(`/submissions/${id}`),

  submissions: (params: { mine?: boolean; problemId?: number; status?: SubmissionStatus; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    query.set('mine', String(params.mine ?? true));
    if (params.problemId !== undefined) query.set('problemId', String(params.problemId));
    if (params.status) query.set('status', params.status);
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    return http<{ count: number; total: number; limit: number; offset: number; submissions: SubmissionSummary[] }>(`/submissions?${query.toString()}`);
  },

  dashboard: () => http<DashboardResponse>('/dashboard/stats'),

  leaderboard: (params: { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const suffix = query.toString();
    return http<LeaderboardResponse>(`/dashboard/leaderboard${suffix ? `?${suffix}` : ''}`);
  },

  // --- auth ---
  register: async (username: string, password: string) => {
    const result = await http<{ token: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setGuestMode(false);
    setToken(result.token);
    setStudentName(result.user.username);
    return result;
  },

  login: async (username: string, password: string) => {
    const result = await http<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setGuestMode(false);
    setToken(result.token);
    setStudentName(result.user.username);
    return result;
  },

  logout: () => http<void>('/auth/logout', { method: 'POST' }),

  me: () => http<MeResponse>('/auth/me'),

  saveAiSettings: (provider: 'server' | 'gemini', geminiApiKey?: string) =>
    http<{ ai: AiSettings }>('/auth/ai-settings', {
      method: 'PUT',
      body: JSON.stringify({ provider, geminiApiKey }),
    }),

  clearGeminiKey: () => http<{ ai: AiSettings }>('/auth/ai-settings/gemini-key', { method: 'DELETE' }),

  saveLeaderboardSettings: (isPublic: boolean) =>
    http<{ ai: AiSettings }>('/auth/leaderboard-settings', {
      method: 'PUT',
      body: JSON.stringify({ isPublic }),
    }),

  // --- per-user AI generation ---
  generateProblem: (params: {
    difficulty: Difficulty;
    topics: string[];
    testCaseCount?: number;
    publicTestCaseCount?: number;
    problemCount?: number;
    instructions?: string;
    quizTitle?: string;
    geminiModel?: string;
    compact?: boolean;
  }) =>
    http<GenerateResponse>('/ai/generate-problem', {
      method: 'POST',
      body: JSON.stringify({
        difficulty: params.difficulty,
        topics: params.topics,
        testCaseCount: params.testCaseCount ?? 6,
        publicTestCaseCount: params.publicTestCaseCount ?? 2,
        persist: true,
        geminiModel: params.geminiModel,
        compact: params.compact ?? true,
        quiz: {
          problemCount: params.problemCount ?? 1,
          instructions: params.instructions,
          quizTitle: params.quizTitle,
        },
      }),
    }),
};
