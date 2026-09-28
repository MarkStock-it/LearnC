import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Build harness for design review: renders GeneratePage (and only it) into one
 * self-contained HTML file that runs from anywhere. The API layer is stubbed so
 * both key states are viewable without a backend:
 *   ?key=1   — student has their own Gemini key (model select appears)
 *   ?key=0   — no key yet (account-page nudge appears)
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  define: {
    // Stubs the api module before the real one is parsed — GeneratePage sees a
    // fake `api.me()` and a logged-in session, so no backend is needed.
    'import.meta.env.VITE_REVIEW_STUB': JSON.stringify('1'),
  },
  build: {
    outDir: '../design/quiz-review',
    emptyOutDir: true,
    rollupOptions: {
      input: '/review.html',
    },
  },
});
