/**
 * Real C compilation in the browser (clang 8 → wasm32-wasi → wasm-ld),
 * replacing the interpreter for the instant preview.
 *
 * This is a genuine compiler, so the whole language works: structs, unions,
 * enums, dynamic allocation, linked lists, function pointers, `long double`
 * I/O — anything the WASI libc provides. Flags mirror the server sandbox
 * (`-std=c99 -Wall -Wextra -O2`) minus `-Werror`: warnings stay advisory,
 * exactly like the grader.
 *
 * Toolchain provenance: vendored from `@runno/sandbox`'s MIT-licensed
 * `dist/langs/` (the clang build is binji's wasm-clang, Apache 2.0).
 * Execution: `@runno/wasi` (MIT) inside the preview Web Worker, so a hung
 * program dies with the worker and can never freeze the page.
 */
import { WASI, type WASIFS, type WASIExecutionResult } from '@runno/wasi';
import { ensureToolchain, type Toolchain, type ToolchainProgress } from './wasiToolchain';

function timestamps() {
  const now = new Date();
  return { access: now, modification: now, change: now };
}

/** Server-parity flags: C99 with warnings advisory (never `-Werror`). */
const CLANG_ARGS = [
  'clang',
  '-cc1',
  '-triple', 'wasm32-unknown-wasi',
  '-isysroot', '/sys',
  '-internal-isystem', '/sys/include',
  '-internal-isystem', '/sys/lib/clang/8.0.1/include',
  '-ferror-limit', '5',
  '-O2',
  '-std=c99',
  '-Wall',
  '-Wextra',
  '-emit-obj',
  '-o', '/program.o',
  '/program.c',
];

const LINK_ARGS = [
  'wasm-ld',
  '--no-threads',
  '--export-dynamic',
  '-z', 'stack-size=1048576',
  '-L/sys/lib/wasm32-wasi',
  '/sys/lib/wasm32-wasi/crt1.o',
  '/program.o',
  '-lc',
  '-o', '/program.wasm',
];

function stringStdin(source: string): (maxByteLength: number) => string | null {
  let remaining = source;
  return (maxByteLength: number) => {
    if (remaining.length === 0) return null; // EOF, like a closed pipe
    const chunk = remaining.slice(0, Math.max(1, maxByteLength));
    remaining = remaining.slice(chunk.length);
    return chunk;
  };
}

interface WasiRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  fs: WASIFS;
}

async function runWasi(
  wasmBytes: Uint8Array<ArrayBuffer>,
  binaryName: string,
  args: string[],
  fs: WASIFS,
  stdinText: string,
): Promise<WasiRun> {
  let stdout = '';
  let stderr = '';
  // Instantiate from bytes directly (never through a Response), so a server
  // that serves `.wasm` with the wrong MIME type cannot break the preview.
  const wasi = new WASI({
    args: [binaryName, ...args],
    env: {},
    fs,
    stdin: stringStdin(stdinText),
    stdout: (out) => {
      stdout += out;
    },
    stderr: (err) => {
      stderr += err;
    },
  });
  const module = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
  const result: WASIExecutionResult = wasi.start({ instance, module });
  return { exitCode: result.exitCode, stdout, stderr, fs: result.fs };
}

function binaryOf(fs: WASIFS, path: string): Uint8Array<ArrayBuffer> | null {
  const entry = fs[path];
  if (!entry || entry.mode !== 'binary') return null;
  // Normalise to a plain ArrayBuffer view: dependency typings hand out the
  // wide `ArrayBufferLike` generic, which WebAssembly.* does not accept.
  if (entry.content.buffer instanceof ArrayBuffer) return entry.content as Uint8Array<ArrayBuffer>;
  const copy = new Uint8Array(entry.content.byteLength);
  copy.set(entry.content);
  return copy;
}

export type ClangCompileResult =
  | { ok: true; programWasm: Uint8Array<ArrayBuffer>; warnings: string }
  | { ok: false; diagnostics: string };

/**
 * Compile C source to a WASI executable (bytes). One compile serves every
 * test case of the preview run.
 */
export async function compileC(
  toolchain: Toolchain,
  source: string,
): Promise<ClangCompileResult> {
  const fs: WASIFS = {
    ...toolchain.sysroot,
    '/program.c': { path: '/program.c', mode: 'string', content: source, timestamps: timestamps() },
  };
  let compiled: WasiRun;
  try {
    compiled = await runWasi(toolchain.clangWasm, 'clang', CLANG_ARGS.slice(1), fs, '');
  } catch (error) {
    return { ok: false, diagnostics: `The compiler crashed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (compiled.exitCode !== 0) {
    const diagnostics = (compiled.stderr.trim() || compiled.stdout.trim() || `clang exited with code ${compiled.exitCode}`).slice(0, 2000);
    return { ok: false, diagnostics };
  }
  const objectFile = binaryOf(compiled.fs, '/program.o');
  if (!objectFile) return { ok: false, diagnostics: 'Compilation produced no object file.' };

  const linkFs: WASIFS = { ...toolchain.sysroot, '/program.o': { path: '/program.o', mode: 'binary', content: objectFile, timestamps: timestamps() } };
  let linked: WasiRun;
  try {
    linked = await runWasi(toolchain.linkerWasm, 'wasm-ld', LINK_ARGS.slice(1), linkFs, '');
  } catch (error) {
    return { ok: false, diagnostics: `The linker crashed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (linked.exitCode !== 0) {
    const diagnostics = (linked.stderr.trim() || linked.stdout.trim() || `wasm-ld exited with code ${linked.exitCode}`).slice(0, 2000);
    return { ok: false, diagnostics };
  }
  const programWasm = binaryOf(linked.fs, '/program.wasm');
  if (!programWasm) return { ok: false, diagnostics: 'Linking produced no executable.' };
  return { ok: true, programWasm, warnings: compiled.stderr.trim().slice(0, 2000) };
}

export interface ClangRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Execute one compiled program against one stdin (fresh instance per case). */
export async function runCompiledProgram(
  programWasm: Uint8Array<ArrayBuffer>,
  stdinText: string,
): Promise<ClangRunResult> {
  const ran = await runWasi(programWasm, 'program', [], {}, stdinText);
  return { stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode };
}

export { ensureToolchain, type Toolchain, type ToolchainProgress };
