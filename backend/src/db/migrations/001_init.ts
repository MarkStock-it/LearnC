import type { Knex } from 'knex';

/**
 * Initial schema (plan §3.1).
 *
 * Portability note: the plan targets PostgreSQL, and `jsonb`/`ENUM` are used there.
 * SQLite has neither, so this migration sticks to constructs Knex maps cleanly on
 * both dialects — JSON payloads via `jsonb` (becomes `json` on SQLite) and status
 * columns as `varchar` validated by Zod in the API layer instead of native ENUMs.
 *
 * MySQL/MariaDB: every FK integer column is `.unsigned()` — `increments()` creates
 * an INT UNSIGNED primary key and InnoDB rejects the FK when the sign differs
 * (errno 150). Sign is meaningless on Postgres/SQLite, so this stays portable.
 */
export const name = '001_init';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 255).notNullable().unique();
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('problem_sets', (t) => {
    t.increments('id').primary();
    t.string('title', 255).notNullable();
    t.text('description').nullable();
    t.integer('exam_year').nullable();
    t.string('exam_semester', 10).nullable();
    t.string('difficulty', 10).notNullable().defaultTo('medium');
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['exam_year', 'exam_semester'], 'idx_problem_sets_exam');
  });

  await knex.schema.createTable('problems', (t) => {
    t.increments('id').primary();
    t.integer('problem_set_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('problem_sets')
      .onDelete('CASCADE');
    t.string('title', 255).notNullable();
    t.text('description').notNullable();
    t.jsonb('constraints').nullable();
    t.text('sample_input').nullable();
    t.text('sample_output').nullable();
    t.string('difficulty_estimate', 20).nullable();
    t.jsonb('tags').nullable();
    t.boolean('ai_generated').notNullable().defaultTo(true);
    t.jsonb('ai_prompt_params').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['problem_set_id'], 'idx_problems_problem_set_id');
  });

  await knex.schema.createTable('test_cases', (t) => {
    t.increments('id').primary();
    t.integer('problem_id').unsigned().notNullable().references('id').inTable('problems').onDelete('CASCADE');
    t.text('input_data').notNullable();
    t.text('expected_output').notNullable();
    t.boolean('is_public').notNullable().defaultTo(false);
    t.string('description', 255).nullable();
    t.integer('weight').notNullable().defaultTo(1);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['problem_id'], 'idx_test_cases_problem_id');
  });

  await knex.schema.createTable('submissions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.integer('problem_id').unsigned().notNullable().references('id').inTable('problems').onDelete('CASCADE');
    t.text('code').notNullable();
    t.string('status', 20).notNullable().defaultTo('QUEUED');
    t.text('compilation_error').nullable();
    t.string('executor', 20).nullable();
    t.integer('passed_count').notNullable().defaultTo(0);
    t.integer('total_count').notNullable().defaultTo(0);
    t.string('error_message', 500).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('completed_at').nullable();
    t.index(['user_id'], 'idx_submissions_user_id');
    t.index(['problem_id'], 'idx_submissions_problem_id');
  });

  await knex.schema.createTable('submission_results', (t) => {
    t.increments('id').primary();
    t.integer('submission_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('submissions')
      .onDelete('CASCADE');
    t.integer('test_case_id').unsigned().nullable().references('id').inTable('test_cases').onDelete('SET NULL');
    t.boolean('passed').notNullable().defaultTo(false);
    t.text('actual_output').nullable();
    t.text('stderr').nullable();
    t.integer('runtime_ms').nullable();
    t.integer('memory_used_mb').nullable();
    t.string('error_type', 20).notNullable().defaultTo('PASS');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['submission_id'], 'idx_submission_results_submission_id');
  });

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('submission_results');
  await knex.schema.dropTableIfExists('submissions');
  await knex.schema.dropTableIfExists('test_cases');
  await knex.schema.dropTableIfExists('problems');
  await knex.schema.dropTableIfExists('problem_sets');
  await knex.schema.dropTableIfExists('users');
}
