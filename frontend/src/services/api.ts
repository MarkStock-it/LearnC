/**
 * Single place that talks to the backend. The API is same-origin thanks to the Vite
 * proxy, so paths stay relative and no base URL configuration is required.
 *
 * Identity uses the MVP stub from the backend: a student name is sent as
 * `Authorization: Bearer <name>` and created on first use. Swapping in real JWT/CAS
 * auth later touches only this module.
 */

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
  }>;
  problemSetId: number | null;
  geminiError: string | null;
  notes: string[];
}

export interface ProblemSetSummary {
  id: number;
  title: string;
  description: string | null;
  examYear: number | null;
  examSemester: string | null;
  difficulty: Difficulty;
  problemCount: number;
  createdAt: string;
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
  return getToken().length > 0;
}

export function signOut(): void {
  setToken('');
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const student = getStudentName();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : student ? { Authorization: `Bearer ${student}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
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
  health: () => http<HealthResponse>('/health'),

  problemSets: () => http<{ count: number; problemSets: ProblemSetSummary[] }>('/problem-sets'),

  problems: (params: { problemSetId?: number; difficulty?: Difficulty; tag?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.problemSetId !== undefined) query.set('problemSetId', String(params.problemSetId));
    if (params.difficulty) query.set('difficulty', params.difficulty);
    if (params.tag) query.set('tag', params.tag);
    const suffix = query.toString();
    return http<{ count: number; problems: ProblemListItem[] }>(`/problems${suffix ? `?${suffix}` : ''}`);
  },

  problem: (id: number) => http<ProblemResponse>(`/problems/${id}`),

  submit: (problemId: number, code: string) =>
    http<{ submissionId: number; status: SubmissionStatus; pollIntervalMs: number }>('/submissions', {
      method: 'POST',
      body: JSON.stringify({ problemId, code }),
    }),

  submission: (id: number) => http<SubmissionResponse>(`/submissions/${id}`),

  submissions: (params: { mine?: boolean; problemId?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    query.set('mine', String(params.mine ?? true));
    if (params.problemId !== undefined) query.set('problemId', String(params.problemId));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    return http<{ count: number; submissions: SubmissionSummary[] }>(`/submissions?${query.toString()}`);
  },

  dashboard: () => http<DashboardResponse>('/dashboard/stats'),

  // --- auth ---
  register: (username: string, password: string) =>
    http<{ token: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  login: (username: string, password: string) =>
    http<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => http<void>('/auth/logout', { method: 'POST' }),

  me: () => http<MeResponse>('/auth/me'),

  saveAiSettings: (provider: 'server' | 'gemini', geminiApiKey?: string) =>
    http<{ ai: AiSettings }>('/auth/ai-settings', {
      method: 'PUT',
      body: JSON.stringify({ provider, geminiApiKey }),
    }),

  clearGeminiKey: () => http<{ ai: AiSettings }>('/auth/ai-settings/gemini-key', { method: 'DELETE' }),

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
        testCaseCount: params.testCaseCount ?? 5,
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
