import { z } from 'zod';

export const sourceFilenameSchema = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/, 'Use a simple filename without directories');

export const sourceFileSchema = z.object({
  filename: sourceFilenameSchema,
  content: z.string().max(64 * 1024),
  autoInclude: z.boolean().optional(),
});

export const problemHelperFileSchema = sourceFileSchema.extend({
  language: z.enum(['c', 'h']).default('c'),
  purpose: z.string().max(240).default(''),
  autoInclude: z.boolean().default(true),
});

export type SourceFile = z.infer<typeof sourceFileSchema>;
export type ProblemHelperFile = z.infer<typeof problemHelperFileSchema>;

export interface PersistedFilesPayload {
  __cPracticeFiles: 1;
  entryFile: string;
  files: SourceFile[];
}

export function serializeFilesPayload(entryFile: string, files: SourceFile[]): string {
  const payload: PersistedFilesPayload = { __cPracticeFiles: 1, entryFile, files };
  return JSON.stringify(payload);
}

export function parseFilesPayload(code: string): PersistedFilesPayload | null {
  if (!code.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(code) as Partial<PersistedFilesPayload>;
    if (parsed.__cPracticeFiles !== 1 || typeof parsed.entryFile !== 'string' || !Array.isArray(parsed.files)) return null;
    const files = parsed.files.map((file) => sourceFileSchema.parse(file));
    if (!files.some((file) => file.filename === parsed.entryFile)) return null;
    return { __cPracticeFiles: 1, entryFile: parsed.entryFile, files };
  } catch {
    return null;
  }
}

export function validateFileSet(entryFile: string, files: SourceFile[]): void {
  if (files.length < 1 || files.length > 20) throw new Error('A file session must contain 1–20 files.');
  if (!files.some((file) => file.filename === entryFile)) throw new Error('The entry-point file is missing.');
  if (!entryFile.toLowerCase().endsWith('.c')) throw new Error('The entry-point file must be a .c file.');
  const names = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    sourceFilenameSchema.parse(file.filename);
    if (names.has(file.filename.toLowerCase())) throw new Error(`Duplicate filename: ${file.filename}`);
    names.add(file.filename.toLowerCase());
    if (!/\.(c|h)$/i.test(file.filename)) throw new Error(`Unsupported file type: ${file.filename}`);
    totalBytes += Buffer.byteLength(file.content, 'utf8');
  }
  if (totalBytes > 64 * 1024) throw new Error('Combined source files exceed the 64 KB limit.');
}
