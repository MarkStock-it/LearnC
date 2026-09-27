import type { Knex } from 'knex';

/**
 * Login and per-user AI generation settings.
 *
 * - `password_hash` is a scrypt string (`scrypt:N:r:p:salt:hash`, node:crypto) —
 *   null until the user registers, so legacy bearer-username accounts keep working.
 * - `gemini_api_key` is stored only when a student plugs in their own key; it is
 *   never returned by the API (only a boolean `hasGeminiKey`).
 */
export const name = '002_user_settings';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_settings', (t) => {
    t.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE').primary();
    t.string('password_hash', 255).nullable();
    t.string('gemini_api_key', 255).nullable();
    t.string('ai_provider', 20).notNullable().defaultTo('server');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_settings');
}
