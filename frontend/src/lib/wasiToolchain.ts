/**
 * Vendored C toolchain for the browser preview (real clang 8 + wasm-ld +
 * WASI sysroot, all compiled to WebAssembly).
 *
 * Provenance: extracted from the `@runno/sandbox` npm package's vendored
 * `dist/langs/` files (MIT-licensed Runno project; the clang build itself is
 * binji's wasm-clang, Apache 2.0). The files live in `public/toolchain/` at
 * dev/build time but are NEVER committed — `scripts/fetch-toolchain.sh`
 * derives them from the npm package. Served as static immutable assets.
 *
 * Loaded once per page lifetime and shared by every preview run: ~52MB on
 * first use (then HTTP-cached), a few hundred ms to inflate the sysroot.
 */
import { inflate } from 'pako';
import type { WASIFS } from '@runno/wasi';

export interface Toolchain {
  clangWasm: Uint8Array<ArrayBuffer>;
  linkerWasm: Uint8Array<ArrayBuffer>;
  /** Extracted sysroot (`/sys/...`), as virtual-FS entries. */
  sysroot: WASIFS;
}

export interface ToolchainProgress {
  phase: 'fetch' | 'extract';
  loadedBytes: number;
  totalBytes: number;
}

function timestamps() {
  const now = new Date();
  return { access: now, modification: now, change: now };
}

/**
 * Minimal ustar reader: regular files only, GNU longname (`L`) aware.
 * Exported for the Node regression battery (same extractor, same bytes).
 */
export function extractUstar(tarBytes: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const text = new TextDecoder('ascii');
  let offset = 0;
  let pendingLongName: string | null = null;

  const readString = (start: number, length: number): string => {
    let end = start;
    while (end < start + length && tarBytes[end] !== 0) end += 1;
    return text.decode(tarBytes.slice(start, end));
  };

  while (offset + 512 <= tarBytes.length) {
    const name = readString(offset, 100);
    const prefix = readString(offset + 345, 155);
    const sizeField = readString(offset + 124, 12).trim();
    const typeflag = String.fromCharCode(tarBytes[offset + 156] ?? 0);
    if (name.length === 0 && sizeField.length === 0) break; // end-of-archive zeros

    const size = sizeField.length > 0 ? Number.parseInt(sizeField, 8) : 0;
    const dataStart = offset + 512;
    const fullName = pendingLongName ?? (prefix.length > 0 ? `${prefix}/${name}` : name);
    pendingLongName = null;

    if (typeflag === 'L') {
      pendingLongName = text.decode(tarBytes.slice(dataStart, dataStart + (Number.isFinite(size) ? size : 0))).replace(/\0.*$/, '');
    } else if ((typeflag === '0' || typeflag === '\0') && fullName.length > 0 && Number.isFinite(size)) {
      files.push({ name: fullName, data: tarBytes.slice(dataStart, dataStart + size) });
    }
    offset = dataStart + Math.ceil((Number.isFinite(size) ? size : 0) / 512) * 512;
  }
  return files;
}

async function fetchBytes(url: string, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${url} (HTTP ${response.status}). Check your connection and retry.`);
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const merged = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.byteLength;
  }
  return merged;
}

let cached: Promise<Toolchain> | null = null;

/**
 * Fetch + prepare the toolchain (cached: first preview pays, the rest ride).
 * `basePath` is where `clang.wasm` etc. are served from (`/toolchain`).
 */
export function ensureToolchain(
  basePath: string,
  onProgress?: (progress: ToolchainProgress) => void,
): Promise<Toolchain> {
  if (!cached) {
    cached = (async (): Promise<Toolchain> => {
      const report = (phase: ToolchainProgress['phase']) => (loaded: number, total: number) =>
        onProgress?.({ phase, loadedBytes: loaded, totalBytes: total });
      const [clangWasm, linkerWasm, sysrootGz] = await Promise.all([
        fetchBytes(`${basePath}/clang.wasm`, report('fetch')),
        fetchBytes(`${basePath}/wasm-ld.wasm`, report('fetch')),
        fetchBytes(`${basePath}/clang-fs.tar.gz`, report('fetch')),
      ]);
      onProgress?.({ phase: 'extract', loadedBytes: 0, totalBytes: sysrootGz.byteLength });
      // Some servers (Vite dev included) serve `.tar.gz` with
      // `Content-Encoding: gzip`, which makes fetch transparently inflate it:
      // sniff the magic and only inflate when still compressed.
      const tarBytes = sysrootGz.length >= 2 && sysrootGz[0] === 0x1f && sysrootGz[1] === 0x8b
        ? inflate(sysrootGz)
        : sysrootGz;
      const entries = extractUstar(tarBytes);
      const sysroot: WASIFS = {};
      for (const entry of entries) {
        // The archive already carries `sys/...` paths; anchor them at root.
        const virtualPath = entry.name.startsWith('/') ? entry.name : `/${entry.name}`;
        sysroot[virtualPath] = {
          path: virtualPath,
          mode: 'binary',
          content: entry.data,
          timestamps: timestamps(),
        };
      }
      onProgress?.({ phase: 'extract', loadedBytes: sysrootGz.byteLength, totalBytes: sysrootGz.byteLength });
      return { clangWasm, linkerWasm, sysroot };
    })();
    // A failed load must not poison later attempts.
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** Test hook: forget the cached toolchain. */
export function resetToolchainForTests(): void {
  cached = null;
}
