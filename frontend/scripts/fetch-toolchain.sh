#!/bin/sh
# Derives the browser C toolchain (clang.wasm, wasm-ld.wasm, clang-fs.tar.gz)
# from the @runno/sandbox npm package's vendored langs files.
#
# The files are ~52MB and are NEVER committed (see .gitignore). Run this
# before `npm run build` when public/toolchain/ is empty — including on the
# deploy machine. Requires: npm, tar.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST="$HERE/../public/toolchain"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

# Pinned to the exact package the preview was validated against. Bump only
# together with a full preview-battery re-run (clang version changes alter
# diagnostics and codegen). Deliberately NOT a devDependency: installing it
# would drag 122MB of unrelated runtimes into every node_modules.
VERSION="${RUNNO_SANDBOX_VERSION:-0.10.2}"

mkdir -p "$DEST"
if [ -f "$DEST/clang.wasm" ] && [ -f "$DEST/wasm-ld.wasm" ] && [ -f "$DEST/clang-fs.tar.gz" ]; then
  echo "fetch-toolchain: public/toolchain/ already complete, skipping"
  exit 0
fi

cd "$TMP"
npm pack "@runno/sandbox@$VERSION" >/dev/null 2>&1
tar -xzf runno-sandbox-*.tgz \
  package/dist/langs/clang.wasm \
  package/dist/langs/wasm-ld.wasm \
  package/dist/langs/clang-fs.tar.gz
cp package/dist/langs/clang.wasm package/dist/langs/wasm-ld.wasm package/dist/langs/clang-fs.tar.gz "$DEST/"
echo "fetch-toolchain: wrote $(du -sh "$DEST" | cut -f1) to public/toolchain/"
