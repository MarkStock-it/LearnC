import type { Knex } from 'knex';
import { db, parseJsonColumn } from './knex.js';
import { config } from '../config.js';
import { truncate } from '../utils/text.js';
import type {
  Difficulty,
  ErrorType,
  SubmissionStatus,
  TestCase,
} from '../domain/types.js';
import { DEFAULT_CONSTRAINTS, type ProblemConstraints } from '../domain/problem.js';

/**
 * Every query here goes through Knex bindings, never string interpolation, so user
 * input cannot reach the SQL parser (plan §6.1). Columns are explicit rather than
 * `select *` where the shape matters.
 */

/**
 * Dialect-normalised insert. Postgres returns `[{id}]`, SQLite `[id]`, and MySQL2
 * has no RETURNING at all — it reports the generated id on the insert result.
 */
async function insertReturningId(
  conn: Knex,
  table: string,
  row: Record<string, unknown>,
): Promise<number> {
  const result = (await conn(table).insert(row)) as
    | Array<number | { id: number }>
    | [{ insertId: number }]
    | number;

  // MySQL2 shape: [OkPacket-ish] with insertId (knex wraps it as [{insertId}]).
  if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null && 'insertId' in (result[0] as Record<string, unknown>)) {
    const id = (result[0] as { insertId: number }).insertId;
    if (typeof id === 'number' && id > 0) return id;
  }

  const first = (Array.isArray(result) ? result[0] : result) as number | { id: number } | undefined;
  if (first === undefined) throw new Error(`Insert into ${table} returned no id`);
  return typeof first === 'number' ? first : first.id;
}

export interface UserRecord {
  id: number;
  username: string;
  email: string;
}

export async function ensureUser(username: string, email?: string): Promise<UserRecord> {
  const conn = db();
  const existing = await conn<UserRecord>('users').select('id', 'username', 'email').where({ username }).first();
  if (existing) return existing;
  const id = await insertReturningId(conn, 'users', {
    username,
    email: email ?? `${username}@example.edu`,
  });
  return { id, username, email: email ?? `${username}@example.edu` };
}

export async function findUser(id: number): Promise<UserRecord | null> {
  const row = await db()<UserRecord>('users').select('id', 'username', 'email').where({ id }).first();
  return row ?? null;
}

export interface ProblemSetSummary {
  id: number;
  userId: number | null;
  title: string;
  description: string | null;
  examYear: number | null;
  examSemester: string | null;
  difficulty: Difficulty;
  problemCount: number;
  createdAt: string;
  isPublic: boolean;
  publishedAt: string | null;
  creatorName: string | null;
  firstProblemId: number | null;
}

function mapProblemSetRow(row: Record<string, unknown>): ProblemSetSummary {
  return {
    id: Number(row.id),
    userId: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    examYear: row.exam_year === null ? null : Number(row.exam_year),
    examSemester: (row.exam_semester as string | null) ?? null,
    difficulty: (row.difficulty as Difficulty) ?? 'medium',
    problemCount: Number(row.problemCount ?? 0),
    createdAt: String(row.created_at),
    isPublic: Boolean(row.is_public),
    publishedAt: (row.published_at as string | null) ?? null,
    creatorName: (row.creator_name as string | null) ?? null,
    firstProblemId: row.first_problem_id === null || row.first_problem_id === undefined ? null : Number(row.first_problem_id),
  };
}

const problemSetSelect = [
  'ps.id', 'ps.user_id', 'ps.title', 'ps.description', 'ps.exam_year',
  'ps.exam_semester', 'ps.difficulty', 'ps.created_at', 'ps.is_public',
  'ps.published_at', 'u.username as creator_name',
] as const;
const publicProblemSetSelect = [
  'ps.id', db().raw('NULL as user_id'), 'ps.title', 'ps.description', 'ps.exam_year',
  'ps.exam_semester', 'ps.difficulty', 'ps.created_at', 'ps.is_public',
  'ps.published_at', 'u.username as creator_name',
] as const;

/** A private-library query: explicitly requires the verified requester's owner ID. */
type ProblemSetListFilters = {
  search?: string;
  difficulty?: Difficulty;
  tag?: string;
  limit?: number;
  offset?: number;
};

function applyPrivateProblemSetFilters(query: Knex.QueryBuilder, filters: ProblemSetListFilters): void {
  if (filters.search) query.where((builder) => builder.where('ps.title', 'like', `%${filters.search}%`).orWhere('ps.description', 'like', `%${filters.search}%`));
  if (filters.difficulty) query.where('ps.difficulty', filters.difficulty);
  if (filters.tag) {
    if (config.db.client === 'mysql') {
      query.whereExists(db()('problems as tag_problem').select(db().raw('1')).whereRaw('tag_problem.problem_set_id = ps.id').whereRaw('JSON_CONTAINS(tag_problem.tags, ?, ?)', [JSON.stringify(filters.tag), '$']));
    } else if (config.db.client === 'pg') {
      query.whereExists(db()('problems as tag_problem').select(db().raw('1')).whereRaw('tag_problem.problem_set_id = ps.id').whereRaw('jsonb_exists(tag_problem.tags::jsonb, ?)', [filters.tag]));
    } else {
      query.whereExists(db()('problems as tag_problem').select(db().raw('1')).whereRaw('tag_problem.problem_set_id = ps.id').whereRaw('exists (select 1 from json_each(tag_problem.tags) as tag_value where tag_value.value = ?)', [filters.tag]));
    }
  }
}

export async function listProblemSets(userId: number | null, page?: ProblemSetListFilters): Promise<ProblemSetSummary[]> {
  const query = db()('problem_sets as ps')
    .leftJoin('problems as p', 'p.problem_set_id', 'ps.id')
    .leftJoin('users as u', 'u.id', 'ps.user_id')
    .where('ps.orphaned', false);
  if (userId === null) query.whereRaw('1 = 0');
  else query.where('ps.user_id', userId);
  if (page) applyPrivateProblemSetFilters(query, page);
  query
    .groupBy('ps.id', 'ps.user_id', 'ps.title', 'ps.description', 'ps.exam_year', 'ps.exam_semester', 'ps.difficulty', 'ps.created_at', 'ps.is_public', 'ps.published_at', 'u.username')
    .select(...problemSetSelect)
    .count({ problemCount: 'p.id' })
    .min({ first_problem_id: 'p.id' })
    .orderBy('ps.created_at', 'desc')
    .orderBy('ps.id', 'desc');
  if (page?.limit !== undefined) query.limit(page.limit);
  if (page?.offset !== undefined) query.offset(page.offset);
  const rows = await query;
  return rows.map((row: Record<string, unknown>) => mapProblemSetRow(row));
}

export async function countProblemSets(userId: number | null, filters: ProblemSetListFilters = {}): Promise<number> {
  if (userId === null) return 0;
  const query = db()('problem_sets as ps').where({ 'ps.user_id': userId, 'ps.orphaned': false });
  applyPrivateProblemSetFilters(query, filters);
  const row = await query.countDistinct({ total: 'ps.id' }).first() as { total: number | string } | undefined;
  return Number(row?.total ?? 0);
}

/** Add visibility-safe public bundle filters using JSON predicates supported by each DB. */
function applyPublicProblemSetFilters(query: Knex.QueryBuilder, filters: {
  search?: string; difficulty?: Difficulty; tag?: string;
}): void {
  query.where({ 'ps.is_public': true, 'ps.orphaned': false });
  if (filters.search) query.where((builder) => builder.where('ps.title', 'like', `%${filters.search}%`).orWhere('ps.description', 'like', `%${filters.search}%`));
  if (filters.difficulty) query.where('ps.difficulty', filters.difficulty);
  if (filters.tag) {
    if (config.db.client === 'mysql') {
      query.whereExists(db()('problems as tag_problem').select(db().raw('1')).whereRaw('tag_problem.problem_set_id = ps.id').whereRaw('JSON_CONTAINS(tag_problem.tags, ?, ?)', [JSON.stringify(filters.tag), '$']));
    } else if (config.db.client === 'pg') {
      query.whereExists(db()('problems as tag_problem').select(db().raw('1')).whereRaw('tag_problem.problem_set_id = ps.id').whereRaw('jsonb_exists(tag_problem.tags::jsonb, ?)', [filters.tag]));
    } else {
      query.whereExists(
        db()('problems as tag_problem')
          .select(db().raw('1'))
          .whereRaw('tag_problem.problem_set_id = ps.id')
          .whereRaw('exists (select 1 from json_each(tag_problem.tags) as tag_value where tag_value.value = ?)', [filters.tag]),
      );
    }
  }
}

/** Public bundles are an explicit, separate query and never leak private set data. */
export async function listPublicProblemSets(filters: {
  search?: string;
  difficulty?: Difficulty;
  tag?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ProblemSetSummary[]> {
  const query = db()('problem_sets as ps')
    .leftJoin('problems as p', 'p.problem_set_id', 'ps.id')
    .leftJoin('users as u', 'u.id', 'ps.published_by')
    .modify((builder) => applyPublicProblemSetFilters(builder, filters))
    .groupBy('ps.id', 'ps.title', 'ps.description', 'ps.exam_year', 'ps.exam_semester', 'ps.difficulty', 'ps.created_at', 'ps.is_public', 'ps.published_at', 'u.username')
    .select(...publicProblemSetSelect)
    .count({ problemCount: 'p.id' })
    .min({ first_problem_id: 'p.id' })
    .orderBy('ps.published_at', 'desc')
    .orderBy('ps.id', 'desc')
    .limit(filters.limit ?? 20)
    .offset(filters.offset ?? 0);
  const rows = (await query) as Array<Record<string, unknown>>;
  return rows.map(mapProblemSetRow);
}

export async function countPublicProblemSets(filters: {
  search?: string; difficulty?: Difficulty; tag?: string;
} = {}): Promise<number> {
  const query = db()('problem_sets as ps');
  applyPublicProblemSetFilters(query, filters);
  const row = await query.countDistinct({ total: 'ps.id' }).first() as { total: number | string } | undefined;
  return Number(row?.total ?? 0);
}

export async function findProblemSet(id: number): Promise<ProblemSetSummary | null> {
  const row = await db()('problem_sets as ps').leftJoin('users as u', 'u.id', 'ps.user_id')
    .leftJoin('problems as p', 'p.problem_set_id', 'ps.id').where('ps.id', id)
    .groupBy('ps.id', 'ps.user_id', 'ps.title', 'ps.description', 'ps.exam_year', 'ps.exam_semester', 'ps.difficulty', 'ps.created_at', 'ps.is_public', 'ps.published_at', 'u.username')
    .select(...problemSetSelect).count({ problemCount: 'p.id' }).min({ first_problem_id: 'p.id' }).first() as Record<string, unknown> | undefined;
  return row ? mapProblemSetRow(row) : null;
}

/** Public projection deliberately omits the creator's internal user ID. */
export async function findPublicProblemSet(id: number): Promise<ProblemSetSummary | null> {
  const row = await db()('problem_sets as ps').leftJoin('users as u', 'u.id', 'ps.published_by')
    .leftJoin('problems as p', 'p.problem_set_id', 'ps.id')
    .where({ 'ps.id': id, 'ps.is_public': true, 'ps.orphaned': false })
    .groupBy('ps.id', 'ps.title', 'ps.description', 'ps.exam_year', 'ps.exam_semester', 'ps.difficulty', 'ps.created_at', 'ps.is_public', 'ps.published_at', 'u.username')
    .select(...publicProblemSetSelect).count({ problemCount: 'p.id' }).min({ first_problem_id: 'p.id' }).first() as Record<string, unknown> | undefined;
  return row ? mapProblemSetRow(row) : null;
}

export async function setProblemSetPublic(id: number, userId: number, isPublic: boolean): Promise<'updated' | 'not-found' | 'forbidden'> {
  const conn = db();
  const owned = await conn('problem_sets').where({ id, user_id: userId, orphaned: false }).first('id');
  if (!owned) return (await conn('problem_sets').where({ id }).first('id')) ? 'forbidden' : 'not-found';
  await conn('problem_sets').where({ id, user_id: userId }).update({
    is_public: isPublic,
    published_by: isPublic ? userId : null,
    published_at: isPublic ? conn.fn.now() : null,
  });
  return 'updated';
}

export async function deleteOwnedProblemSet(id: number, userId: number): Promise<'deleted' | 'not-found' | 'forbidden'> {
  const conn = db();
  const owner = await conn('problem_sets').where({ id, user_id: userId, orphaned: false }).first('id');
  if (!owner) return (await conn('problem_sets').where({ id }).first('id')) ? 'forbidden' : 'not-found';
  await conn('problem_sets').where({ id, user_id: userId }).delete();
  return 'deleted';
}

export async function createProblemSet(input: {
  title: string;
  description?: string | null;
  examYear?: number | null;
  examSemester?: string | null;
  difficulty?: Difficulty;
  userId: number;
}): Promise<number> {
  return insertReturningId(db(), 'problem_sets', {
    title: input.title,
    description: input.description ?? null,
    exam_year: input.examYear ?? null,
    exam_semester: input.examSemester ?? null,
    difficulty: input.difficulty ?? 'medium',
    user_id: input.userId,
    created_by: input.userId,
    orphaned: false,
  });
}

/** Delete a set and everything under it (FK cascades handle problems/test cases/submissions). */
export async function deleteProblemSet(id: number): Promise<number> {
  return db()('problem_sets').where({ id }).delete();
}

export async function deleteProblemsBySet(problemSetId: number): Promise<number> {
  return db()('problems').where({ problem_set_id: problemSetId }).delete();
}

export interface ProblemRecord {
  id: number;
  problemSetId: number;
  title: string;
  description: string;
  constraints: ProblemConstraints;
  sampleInput: string | null;
  sampleOutput: string | null;
  difficulty: Difficulty;
  tags: string[];
  aiGenerated: boolean;
  aiPromptParams: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProblemListItem extends ProblemRecord {
  testCaseCount: number;
  publicTestCaseCount: number;
  solved: boolean;
}

function mapProblemRow(row: Record<string, unknown>): ProblemRecord {
  return {
    id: Number(row.id),
    problemSetId: Number(row.problem_set_id),
    title: String(row.title),
    description: String(row.description),
    constraints: parseJsonColumn<ProblemConstraints>(row.constraints, DEFAULT_CONSTRAINTS),
    sampleInput: (row.sample_input as string | null) ?? null,
    sampleOutput: (row.sample_output as string | null) ?? null,
    difficulty: (row.difficulty_estimate as Difficulty) ?? 'medium',
    tags: parseJsonColumn<string[]>(row.tags, []),
    aiGenerated: Boolean(row.ai_generated),
    aiPromptParams: parseJsonColumn<Record<string, unknown> | null>(row.ai_prompt_params, null),
    createdAt: String(row.created_at),
  };
}

export async function listPublicProblemsInSet(problemSetId: number, page?: { limit: number; offset: number }): Promise<ProblemRecord[]> {
  const query = db()('problems as p').join('problem_sets as ps', 'ps.id', 'p.problem_set_id')
    .where({ 'ps.id': problemSetId, 'ps.is_public': true, 'ps.orphaned': false })
    .select('p.*').orderBy('p.id', 'asc');
  if (page) query.limit(page.limit).offset(page.offset);
  const rows = await query as Array<Record<string, unknown>>;
  return rows.map(mapProblemRow);
}

export async function countPublicProblemsInSet(problemSetId: number): Promise<number> {
  const row = await db()('problems as p').join('problem_sets as ps', 'ps.id', 'p.problem_set_id')
    .where({ 'ps.id': problemSetId, 'ps.is_public': true, 'ps.orphaned': false }).count({ total: 'p.id' }).first() as { total: number | string } | undefined;
  return Number(row?.total ?? 0);
}

export async function createProblem(input: {
  problemSetId: number;
  title: string;
  description: string;
  constraints: ProblemConstraints;
  sampleInput: string;
  sampleOutput: string;
  difficulty: Difficulty;
  tags: string[];
  aiGenerated: boolean;
  aiPromptParams?: Record<string, unknown> | null;
}): Promise<number> {
  return insertReturningId(db(), 'problems', {
    problem_set_id: input.problemSetId,
    title: input.title,
    description: input.description,
    constraints: JSON.stringify(input.constraints),
    sample_input: input.sampleInput,
    sample_output: input.sampleOutput,
    difficulty_estimate: input.difficulty,
    tags: JSON.stringify(input.tags),
    ai_generated: input.aiGenerated,
    ai_prompt_params: input.aiPromptParams ? JSON.stringify(input.aiPromptParams) : null,
  });
}

export async function findProblem(id: number): Promise<ProblemRecord | null> {
  const row = await db()('problems').select('*').where({ id }).first();
  return row ? mapProblemRow(row) : null;
}

/** A student can open only their own private problem or an explicitly public one. */
export async function findAccessibleProblem(id: number, userId: number | null): Promise<ProblemRecord | null> {
  const query = db()('problems as p').join('problem_sets as ps', 'ps.id', 'p.problem_set_id')
    .where('p.id', id).andWhere('ps.orphaned', false)
    .andWhere((builder) => {
      builder.where('ps.is_public', true);
      if (userId !== null) builder.orWhere('ps.user_id', userId);
    })
    .select('p.*').first();
  const row = await query as Record<string, unknown> | undefined;
  return row ? mapProblemRow(row) : null;
}

export async function problemAccess(id: number, userId: number | null): Promise<'accessible' | 'forbidden' | 'not-found'> {
  const row = await db()('problems as p').join('problem_sets as ps', 'ps.id', 'p.problem_set_id')
    .where('p.id', id).first('ps.user_id', 'ps.is_public', 'ps.orphaned') as { user_id: number | null; is_public: boolean; orphaned: boolean } | undefined;
  if (!row || row.orphaned) return 'not-found';
  if (row.is_public || (userId !== null && Number(row.user_id) === userId)) return 'accessible';
  return 'forbidden';
}

export async function problemSetAccess(id: number, userId: number | null): Promise<'owned' | 'public' | 'forbidden' | 'not-found'> {
  const row = await db()('problem_sets').where({ id }).first('user_id', 'is_public', 'orphaned') as { user_id: number | null; is_public: boolean; orphaned: boolean } | undefined;
  if (!row || row.orphaned) return 'not-found';
  if (row.is_public) return 'public';
  if (userId !== null && Number(row.user_id) === userId) return 'owned';
  return 'forbidden';
}

type ProblemListFilters = {
  userId: number | null;
  problemSetId?: number;
  difficulty?: Difficulty;
  tag?: string;
  search?: string;
  limit?: number;
  offset?: number;
  isPublicSet?: boolean;
};

function buildProblemsQuery(filters: ProblemListFilters): Knex.QueryBuilder {
  const query = db()('problems')
    .join('problem_sets as ps', 'ps.id', 'problems.problem_set_id')
    .where('ps.orphaned', false)
    .andWhere((builder) => {
      if (filters.problemSetId !== undefined && filters.isPublicSet) {
        builder.where('ps.is_public', true);
      } else if (filters.problemSetId !== undefined) {
        if (filters.userId !== null) builder.where({ 'ps.user_id': filters.userId, 'ps.is_public': false });
        else builder.whereRaw('1 = 0');
      } else if (filters.userId !== null) {
        builder.where((access) => access.where('ps.user_id', filters.userId!).orWhere('ps.is_public', true));
      } else {
        builder.where('ps.is_public', true);
      }
    });

  if (filters.problemSetId !== undefined) query.where('problems.problem_set_id', filters.problemSetId);
  if (filters.difficulty) query.where('problems.difficulty_estimate', filters.difficulty);
  if (filters.search) query.where('problems.title', 'like', `%${filters.search}%`);
  if (filters.tag) {
    if (config.db.client === 'mysql') query.whereRaw('JSON_CONTAINS(??, ?, ?)', ['problems.tags', JSON.stringify(filters.tag), '$']);
    else if (config.db.client === 'pg') query.whereRaw('jsonb_exists(??::jsonb, ?)', ['problems.tags', filters.tag]);
    else query.whereExists(db().select(db().raw('1')).from(db().raw('json_each(problems.tags) AS tag_value')).whereRaw('tag_value.value = ?', [filters.tag]));
  }
  return query;
}

export async function listProblems(filters: ProblemListFilters): Promise<ProblemListItem[]> {
  const query = buildProblemsQuery(filters)
    .select(
      'problems.*',
      db().raw('(select count(*) from test_cases where test_cases.problem_id = problems.id) as test_case_count'),
      db().raw('(select count(*) from test_cases where test_cases.problem_id = problems.id and test_cases.is_public) as public_test_case_count'),
      filters.userId === null
        ? db().raw('0 as solved')
        : db().raw('case when exists (select 1 from submissions ss where ss.user_id = ? and ss.problem_id = problems.id and ss.status = ? and ss.passed_count > 0 and ss.passed_count = ss.total_count) then 1 else 0 end as solved', [filters.userId, 'COMPLETED']),
    )
    .orderBy('problems.id', 'asc');
  if (filters.limit !== undefined) query.limit(filters.limit);
  if (filters.offset !== undefined) query.offset(filters.offset);
  const rows = await query as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...mapProblemRow(row),
    testCaseCount: Number(row.test_case_count ?? 0),
    publicTestCaseCount: Number(row.public_test_case_count ?? 0),
    solved: Boolean(row.solved),
  }));
}

export async function countProblems(filters: ProblemListFilters): Promise<number> {
  const row = await buildProblemsQuery(filters)
    .countDistinct({ total: 'problems.id' }).first() as { total: number | string } | undefined;
  return Number(row?.total ?? 0);
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  solvedProblems: number;
}

export async function listLeaderboard(page: { limit: number; offset: number }): Promise<LeaderboardEntry[]> {
  const rows = await db()('user_settings as settings')
    .join('users as u', 'u.id', 'settings.user_id')
    .where('settings.leaderboard_public', true)
    .select(
      'u.username',
      db().raw(`(
        select count(distinct solved.problem_id)
        from submissions as solved
        where solved.user_id = u.id
          and solved.status = ?
          and solved.passed_count > 0
          and solved.passed_count = solved.total_count
      ) as solvedProblems`, ['COMPLETED']),
    )
    .orderBy('solvedProblems', 'desc')
    .orderBy('u.username', 'asc')
    .limit(page.limit)
    .offset(page.offset) as Array<{ username: string; solvedProblems: number | string }>;
  return rows.map((row, index) => ({ rank: page.offset + index + 1, username: row.username, solvedProblems: Number(row.solvedProblems) }));
}

export async function countLeaderboardEntries(): Promise<number> {
  const row = await db()('user_settings as settings')
    .join('users as u', 'u.id', 'settings.user_id')
    .where('settings.leaderboard_public', true)
    .countDistinct({ total: 'u.id' }).first() as { total: number | string } | undefined;
  return Number(row?.total ?? 0);
}

export async function insertTestCases(
  problemId: number,
  testCases: Array<{ input: string; expectedOutput: string; isPublic: boolean; description?: string | null; weight?: number }>,
): Promise<number[]> {
  const conn = db();
  const ids: number[] = [];
  await conn.transaction(async (trx) => {
    for (const testCase of testCases) {
      ids.push(
        await insertReturningId(trx, 'test_cases', {
          problem_id: problemId,
          input_data: testCase.input,
          expected_output: testCase.expectedOutput,
          is_public: testCase.isPublic,
          description: testCase.description ?? null,
          weight: testCase.weight ?? 1,
        }),
      );
    }
  });
  return ids;
}

function mapTestCaseRow(row: Record<string, unknown>): TestCase {
  return {
    id: Number(row.id),
    problemId: Number(row.problem_id),
    inputData: String(row.input_data),
    expectedOutput: String(row.expected_output),
    isPublic: Boolean(row.is_public),
    description: (row.description as string | null) ?? null,
    weight: Number(row.weight ?? 1),
  };
}

export async function listTestCases(problemId: number, options: { publicOnly?: boolean } = {}): Promise<TestCase[]> {
  const query = db()('test_cases').select('*').where({ problem_id: problemId }).orderBy('id', 'asc');
  if (options.publicOnly) query.where({ is_public: true });
  const rows = (await query) as Array<Record<string, unknown>>;
  return rows.map(mapTestCaseRow);
}

export interface SubmissionRecord {
  id: number;
  userId: number | null;
  problemId: number;
  code: string;
  status: SubmissionStatus;
  compilationError: string | null;
  executor: string | null;
  passedCount: number;
  totalCount: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

function mapSubmissionRow(row: Record<string, unknown>): SubmissionRecord {
  return {
    id: Number(row.id),
    userId: row.user_id === null ? null : Number(row.user_id),
    problemId: Number(row.problem_id),
    code: String(row.code),
    status: row.status as SubmissionStatus,
    compilationError: (row.compilation_error as string | null) ?? null,
    executor: (row.executor as string | null) ?? null,
    passedCount: Number(row.passed_count ?? 0),
    totalCount: Number(row.total_count ?? 0),
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: String(row.created_at),
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

export async function createSubmission(input: {
  userId: number | null;
  problemId: number;
  code: string;
}): Promise<number> {
  return insertReturningId(db(), 'submissions', {
    user_id: input.userId,
    problem_id: input.problemId,
    code: input.code,
    status: 'QUEUED',
  });
}

export async function findSubmission(id: number): Promise<SubmissionRecord | null> {
  const row = await db()('submissions').select('*').where({ id }).first();
  return row ? mapSubmissionRow(row) : null;
}

export async function updateSubmission(
  id: number,
  patch: {
    status?: SubmissionStatus;
    compilationError?: string | null;
    executor?: string | null;
    passedCount?: number;
    totalCount?: number;
    errorMessage?: string | null;
    completedAt?: string | null;
  },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.compilationError !== undefined) update.compilation_error = patch.compilationError;
  if (patch.executor !== undefined) update.executor = patch.executor;
  if (patch.passedCount !== undefined) update.passed_count = patch.passedCount;
  if (patch.totalCount !== undefined) update.total_count = patch.totalCount;
  if (patch.errorMessage !== undefined) update.error_message = patch.errorMessage;
  if (patch.completedAt !== undefined) update.completed_at = patch.completedAt;
  if (Object.keys(update).length === 0) return;
  await db()('submissions').where({ id }).update(update);
}

export interface SubmissionResultRecord {
  testCaseId: number | null;
  passed: boolean;
  actualOutput: string | null;
  stderr: string | null;
  runtimeMs: number | null;
  memoryUsedMb: number | null;
  errorType: ErrorType;
  isPublic: boolean;
  description: string | null;
  /** Joined from `test_cases`; only ever returned to the client for public cases. */
  inputData: string | null;
  expectedOutput: string | null;
}

export async function replaceSubmissionResults(
  submissionId: number,
  results: Array<{
    testCaseId: number;
    passed: boolean;
    actualOutput: string;
    stderr: string;
    runtimeMs: number;
    memoryUsedMb: number | null;
    errorType: ErrorType;
  }>,
): Promise<void> {
  const conn = db();
  await conn.transaction(async (trx) => {
    await trx('submission_results').where({ submission_id: submissionId }).delete();
    for (const result of results) {
      await insertReturningId(trx, 'submission_results', {
        submission_id: submissionId,
        test_case_id: result.testCaseId,
        passed: result.passed,
        actual_output: result.actualOutput,
        stderr: result.stderr,
        runtime_ms: result.runtimeMs,
        memory_used_mb: result.memoryUsedMb,
        error_type: result.errorType,
      });
    }
  });
}

export async function listSubmissionResults(submissionId: number): Promise<SubmissionResultRecord[]> {
  const rows = (await db()('submission_results as sr')
    .leftJoin('test_cases as tc', 'tc.id', 'sr.test_case_id')
    .select(
      'sr.test_case_id',
      'sr.passed',
      'sr.actual_output',
      'sr.stderr',
      'sr.runtime_ms',
      'sr.memory_used_mb',
      'sr.error_type',
      'tc.is_public',
      'tc.description',
      'tc.input_data',
      'tc.expected_output',
    )
    .where('sr.submission_id', submissionId)
    .orderBy('sr.id', 'asc')) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    testCaseId: row.test_case_id === null ? null : Number(row.test_case_id),
    passed: Boolean(row.passed),
    actualOutput: (row.actual_output as string | null) ?? null,
    stderr: (row.stderr as string | null) ?? null,
    runtimeMs: row.runtime_ms === null ? null : Number(row.runtime_ms),
    memoryUsedMb: row.memory_used_mb === null ? null : Number(row.memory_used_mb),
    errorType: (row.error_type as ErrorType) ?? 'PASS',
    isPublic: Boolean(row.is_public),
    description: (row.description as string | null) ?? null,
    inputData: (row.input_data as string | null) ?? null,
    expectedOutput: (row.expected_output as string | null) ?? null,
  }));
}

export interface UserProblemProgress {
  attempts: number;
  solved: boolean;
  bestPassedCount: number;
  lastSubmittedAt: string | null;
}

/** Per-problem progress for the current user, shown on the problem page. */
export async function getUserProblemProgress(
  userId: number,
  problemId: number,
): Promise<UserProblemProgress> {
  const row = (await db()('submissions')
    .where({ user_id: userId, problem_id: problemId })
    .select(
      db().raw('count(*) as attempts'),
      db().raw('max(passed_count) as best_passed'),
      db().raw('max(created_at) as last_submitted_at'),
    )
    .first()) as Record<string, unknown> | undefined;

  const bestPassedCount = Number(row?.best_passed ?? 0);
  const totalRow = (await db()('test_cases')
    .where({ problem_id: problemId })
    .count({ total: 'id' })
    .first()) as Record<string, unknown> | undefined;
  const total = Number(totalRow?.total ?? 0);

  return {
    attempts: Number(row?.attempts ?? 0),
    solved: total > 0 && bestPassedCount === total,
    bestPassedCount,
    lastSubmittedAt: (row?.last_submitted_at as string | null) ?? null,
  };
}

type SubmissionListFilters = {
  userId?: number;
  problemId?: number;
  status?: SubmissionStatus;
  limit?: number;
  offset?: number;
};

export async function countSubmissions(filters: SubmissionListFilters): Promise<number> {
  const query = db()('submissions as s');
  if (filters.userId !== undefined) query.where('s.user_id', filters.userId);
  if (filters.problemId !== undefined) query.where('s.problem_id', filters.problemId);
  if (filters.status) query.where('s.status', filters.status);
  const row = await query.count({ total: 's.id' }).first() as { total: number | string } | undefined;
  return Number(row?.total ?? 0);
}

export async function listSubmissions(filters: SubmissionListFilters): Promise<Array<SubmissionRecord & { problemTitle: string }>> {
  const query = db()('submissions as s')
    .join('problems as p', 'p.id', 's.problem_id')
    .select('s.*', 'p.title as problem_title')
    .orderBy('s.id', 'desc')
    .limit(filters.limit ?? 25)
    .offset(filters.offset ?? 0);

  if (filters.userId !== undefined) query.where('s.user_id', filters.userId);
  if (filters.problemId !== undefined) query.where('s.problem_id', filters.problemId);
  if (filters.status) query.where('s.status', filters.status);

  const rows = (await query) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...mapSubmissionRow(row), problemTitle: String(row.problem_title) }));
}

export interface UserStats {
  userId: number;
  totalSubmissions: number;
  completedSubmissions: number;
  solvedProblems: number;
  attemptedProblems: number;
  solvedProblemIds: number[];
}

export async function getUserStats(userId: number): Promise<UserStats> {
  const conn = db();
  const totals = (await conn('submissions')
    .where({ user_id: userId })
    .select(
      conn.raw('count(*) as total'),
      conn.raw("sum(case when status = 'COMPLETED' then 1 else 0 end) as completed"),
    )
    .first()) as Record<string, unknown> | undefined;

  const attempted = (await conn('submissions').where({ user_id: userId }).distinct('problem_id')) as Array<{
    problem_id: number;
  }>;

  const solved = (await conn('submissions')
    .where({ user_id: userId, status: 'COMPLETED' })
    .whereRaw('passed_count > 0')
    .whereRaw('passed_count = total_count')
    .distinct('problem_id')) as Array<{ problem_id: number }>;

  return {
    userId,
    totalSubmissions: Number(totals?.total ?? 0),
    completedSubmissions: Number(totals?.completed ?? 0),
    solvedProblems: solved.length,
    attemptedProblems: attempted.length,
    solvedProblemIds: solved.map((row) => Number(row.problem_id)),
  };
}

/** Trim oversized code before it hits the DB (plan §6.1 input validation). */
export function sanitizeCode(code: string, maxBytes: number): string {
  return truncate(code, maxBytes);
}
