import type { Knex } from 'knex';

/** Ownership and opt-in public visibility for problem-set bundles. */
export const name = '003_bundle_ownership';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('problem_sets', (t) => {
    // Nullable only for audited legacy orphans. New writes always require a user id.
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.boolean('is_public').notNullable().defaultTo(false);
    t.timestamp('published_at').nullable();
    t.integer('published_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.boolean('orphaned').notNullable().defaultTo(true);
    t.index(['user_id'], 'idx_problem_sets_user_id');
    t.index(['is_public', 'orphaned'], 'idx_problem_sets_public_orphaned');
  });

  // Existing `created_by` is the only reliable ownership signal. Rows without it
  // remain explicitly orphaned and are excluded from every user-facing query.
  await knex('problem_sets')
    .whereNotNull('created_by')
    .update({ user_id: knex.ref('created_by'), orphaned: false });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('problem_sets', (t) => {
    t.dropIndex(['user_id'], 'idx_problem_sets_user_id');
    t.dropIndex(['is_public', 'orphaned'], 'idx_problem_sets_public_orphaned');
    t.dropColumn('published_by');
    t.dropColumn('published_at');
    t.dropColumn('is_public');
    t.dropColumn('orphaned');
    t.dropColumn('user_id');
  });
}
