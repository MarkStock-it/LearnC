import type { Knex } from 'knex';

/** Explicit opt-in before a student's solve count and username appear publicly. */
export const name = '004_leaderboard_opt_in';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_settings', (t) => {
    t.boolean('leaderboard_public').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_settings', (t) => {
    t.dropColumn('leaderboard_public');
  });
}
