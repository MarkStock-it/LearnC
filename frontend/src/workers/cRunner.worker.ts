/**
 * In-browser C runner: a REAL compiler (clang 8 → wasm32-wasi → wasm-ld),
 * not an interpreter. The whole language works — structs, unions, enums,
 * dynamic allocation, linked lists, function pointers — anything the WASI
 * libc provides, compiled with server-parity flags (`-std=c99 -Wall -Wextra`,
 * warnings advisory).
 *
 * Lives on a Worker so a pathological program can never freeze the page: the
 * main thread holds watchdogs and terminates the whole worker on overrun.
 * The ~52MB toolchain downloads once (then HTTP-cached) and compiles each
 * preview's code a single time; every test case then runs the same binary
 * with different stdin.
 *
 * Protocol (main -> worker):
 *   { kind: 'compile', id, code }
 *   { kind: 'run', id, stdin }
 * Protocol (worker -> main):
 *   { kind: 'toolchain-progress', loadedBytes, totalBytes }
 *   { kind: 'compiled', id, ok, diagnostics?, warnings? }
 *   { kind: 'result', id, ok, stdout?, exitCode?, runtimeMs?, stderr?, message? }
 */
import { compileC, ensureToolchain, runCompiledProgram } from '../lib/wasiClang';

export type PreviewWorkerRequest =
  | { kind: 'compile'; id: number; code: string }
  | { kind: 'run'; id: number; stdin: string };

export type PreviewWorkerResult =
  | { kind: 'toolchain-progress'; loadedBytes: number; totalBytes: number }
  | { kind: 'compiled'; id: number; ok: true; warnings: string }
  | { kind: 'compiled'; id: number; ok: false; diagnostics: string }
  | {
      kind: 'result';
      id: number;
      ok: true;
      stdout: string;
      exitCode: number;
      runtimeMs: number;
      stderr: string;
    }
  | { kind: 'result'; id: number; ok: false; message: string };

/** Where the toolchain is served from, relative to the page origin. */
const TOOLCHAIN_BASE_PATH = '/toolchain';

let programWasm: Uint8Array<ArrayBuffer> | null = null;

self.onmessage = (event: MessageEvent<PreviewWorkerRequest>) => {
  const request = event.data;
  if (!request) return;
  void handle(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (request.kind === 'compile') {
      const response: PreviewWorkerResult = { kind: 'compiled', id: request.id, ok: false, diagnostics: message.slice(0, 1000) };
      self.postMessage(response);
    } else {
      const response: PreviewWorkerResult = { kind: 'result', id: request.id, ok: false, message: message.slice(0, 500) };
      self.postMessage(response);
    }
  });
};

async function handle(request: PreviewWorkerRequest): Promise<void> {
  if (request.kind === 'compile') {
    programWasm = null;
    const toolchain = await ensureToolchain(TOOLCHAIN_BASE_PATH, (progress) => {
      const response: PreviewWorkerResult = {
        kind: 'toolchain-progress',
        loadedBytes: progress.loadedBytes,
        totalBytes: progress.totalBytes,
      };
      self.postMessage(response);
    });
    const compiled = await compileC(toolchain, request.code);
    if (!compiled.ok) {
      const response: PreviewWorkerResult = {
        kind: 'compiled',
        id: request.id,
        ok: false,
        diagnostics: compiled.diagnostics,
      };
      self.postMessage(response);
      return;
    }
    programWasm = compiled.programWasm;
    const response: PreviewWorkerResult = {
      kind: 'compiled',
      id: request.id,
      ok: true,
      warnings: compiled.warnings,
    };
    self.postMessage(response);
    return;
  }

  if (!programWasm) {
    const response: PreviewWorkerResult = {
      kind: 'result',
      id: request.id,
      ok: false,
      message: 'Nothing compiled yet — compile before running cases.',
    };
    self.postMessage(response);
    return;
  }
  const startedAt = Date.now();
  const ran = await runCompiledProgram(programWasm, request.stdin);
  const response: PreviewWorkerResult = {
    kind: 'result',
    id: request.id,
    ok: true,
    stdout: ran.stdout.length > 256 * 1024 ? `${ran.stdout.slice(0, 256 * 1024)}\n… [output truncated]` : ran.stdout,
    exitCode: ran.exitCode,
    runtimeMs: Date.now() - startedAt,
    stderr: ran.stderr.slice(0, 4000),
  };
  self.postMessage(response);
}
