import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Build harness for the PracticePage (workbench) design review: renders the real
 * page into one self-contained HTML file. The API is stubbed at the fetch level by
 * the injected stub (see scripts/build-review-harnesses.sh).
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: '../design/workbench-review',
    emptyOutDir: true,
    rollupOptions: {
      input: '/review-workbench.html',
    },
  },
});
