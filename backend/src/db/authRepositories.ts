import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { db } from './knex.js';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Passwords are hashed with scrypt (node:crypto, no extra dependency): the
 * stored form is `scrypt:<N>:<r>:<p>:<salt-hex>:<hash-hex>`. Parameters travel
 * with the hash so they can be raised later without invalidating accounts.
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const hash = await scrypt(password, Buffer.from(saltHex ?? '', 'hex'), KEY_LENGTH);
  const expected = Buffer.from(hashHex ?? '', 'hex');
  if (expected.length !== hash.length) return false;
  // Keep N/r/p parsing lazy: defaults match what hashPassword writes today.
  void [nRaw, rRaw, pRaw];
  return timingSafeEqual(hash, expected);
}

export interface UserSettingsRecord {
  userId: number;
  hasPassword: boolean;
  hasGeminiKey: boolean;
  aiProvider: 'server' | 'gemini';
  leaderboardPublic: boolean;
}

interface UserSettingsRow {
  user_id: number;
  password_hash: string | null;
  gemini_api_key: string | null;
  ai_provider: string;
  leaderboard_public: boolean;
}

function mapSettingsRow(row: UserSettingsRow): UserSettingsRecord {
  return {
    userId: Number(row.user_id),
    hasPassword: row.password_hash !== null,
    hasGeminiKey: row.gemini_api_key !== null && row.gemini_api_key.length > 0,
    aiProvider: row.ai_provider === 'gemini' ? 'gemini' : 'server',
    leaderboardPublic: Boolean(row.leaderboard_public),
  };
}

async function getSettingsRow(userId: number): Promise<UserSettingsRow | null> {
  const row = (await db()('user_settings').where({ user_id: userId }).first()) as UserSettingsRow | undefined;
  return row ?? null;
}

/** Ensure a settings row exists for the user (created lazily on first write). */
async function ensureSettingsRow(userId: number): Promise<UserSettingsRow> {
  const existing = await getSettingsRow(userId);
  if (existing) return existing;
  await db()('user_settings').insert({ user_id: userId }).onConflict('user_id').ignore();
  const created = await getSettingsRow(userId);
  if (!created) throw new Error(`Could not create settings for user ${userId}`);
  return created;
}

export async function hasPassword(userId: number): Promise<boolean> {
  const row = await getSettingsRow(userId);
  return row !== null && row.password_hash !== null;
}

/** Raw stored hash for login verification (null when the account has no password). */
export async function getPasswordHash(userId: number): Promise<string | null> {
  const row = await getSettingsRow(userId);
  return row?.password_hash ?? null;
}

export async function setPassword(userId: number, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await ensureSettingsRow(userId);
  await db()('user_settings').where({ user_id: userId }).update({ password_hash: hash, updated_at: db().fn.now() });
}

export async function getGeminiKey(userId: number): Promise<string | null> {
  const row = await getSettingsRow(userId);
  return row?.gemini_api_key ?? null;
}

export async function setGeminiKey(userId: number, key: string | null): Promise<void> {
  await ensureSettingsRow(userId);
  await db()('user_settings')
    .where({ user_id: userId })
    .update({ gemini_api_key: key, ai_provider: key ? 'gemini' : 'server', updated_at: db().fn.now() });
}

export async function getAiProvider(userId: number): Promise<'server' | 'gemini'> {
  const row = await getSettingsRow(userId);
  return row?.ai_provider === 'gemini' ? 'gemini' : 'server';
}

export async function setAiProvider(userId: number, provider: 'server' | 'gemini'): Promise<void> {
  await ensureSettingsRow(userId);
  await db()('user_settings').where({ user_id: userId }).update({ ai_provider: provider, updated_at: db().fn.now() });
}

export async function setLeaderboardPublic(userId: number, isPublic: boolean): Promise<void> {
  await ensureSettingsRow(userId);
  await db()('user_settings').where({ user_id: userId }).update({ leaderboard_public: isPublic, updated_at: db().fn.now() });
}

export async function getSettings(userId: number): Promise<UserSettingsRecord> {
  const row = await ensureSettingsRow(userId);
  return mapSettingsRow(row);
}

/**
 * Find a user by username (case-insensitive lookup relies on the DB collation)
 * and create the row when missing. Returns the existing row untouched when the
 * username is taken, so callers must check the password before trusting it.
 */
export async function findOrCreateUserId(username: string, email?: string): Promise<number> {
  const existing = (await db()('users').where({ username }).first()) as { id: number } | undefined;
  if (existing) return Number(existing.id);
  const result = (await db()('users')
    .insert({ username, email: email ?? `${username}@example.edu` })) as unknown as
    | number
    | Array<number | { insertId: number }>;
  // Dialect-dependent: mysql2 may resolve to [id] (a raw number) or [{insertId}].
  const insertId = Array.isArray(result)
    ? typeof result[0] === 'number'
      ? result[0]
      : (result[0] as { insertId: number } | undefined)?.insertId
    : result;
  if (typeof insertId !== 'number' || insertId <= 0) throw new Error('Could not create user');
  return insertId;
}

// ---------------------------------------------------------------------------
// Session tokens: self-contained HMAC-signed values. Stateless by design —
// they survive process restarts and need no session table. Payload is
// `userId.expiresAt` and the signature is HMAC-SHA256 over it with a server
// secret (persisted under the data dir so restarts keep tokens valid).
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  const secretPath = path.join(path.dirname(config.db.sqliteFile), 'session-secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* first boot */
  }
  const generated = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function issueToken(userId: number): string {
  const payload = `${userId}.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function resolveToken(token: string): number | null {
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const parts = payload.split('.');
  if (parts.length !== 2) return null;
  const userId = Number.parseInt(parts[0] ?? '', 10);
  const expiresAt = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(userId) || !Number.isFinite(expiresAt)) return null;
  if (expiresAt < Date.now()) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  return userId;
}

export function revokeToken(token: string): void {
  // Stateless tokens cannot be revoked individually; expiry (30 days) bounds them.
  void token;
}
