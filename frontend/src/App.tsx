import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Navbar } from './components/Layout/Navbar';
import { DashboardPage } from './pages/DashboardPage';

/**
 * The dashboard is the entry point for most visits and needs none of the heavy
 * dependencies, so the editor and Markdown renderer are code-split away from it
 * (plan §6.2). The skipped chunk is the one that carries CodeMirror.
 */
const SetPage = lazy(() => import('./pages/SetPage').then((module) => ({ default: module.SetPage })));
const PracticePage = lazy(() => import('./pages/PracticePage').then((module) => ({ default: module.PracticePage })));

export function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="btn btn-quiet sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[var(--z-tooltip)]"
      >
        Skip to content
      </a>

      <Navbar />

      <main id="main" className="mx-auto w-full max-w-[1180px] flex-1 px-5 py-[var(--space-xl)] md:px-8">
        <Suspense fallback={<p className="type-small text-[var(--color-muted)]">Loading…</p>}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/sets/:setId" element={<SetPage />} />
            <Route path="/problems/:problemId" element={<PracticePage />} />
            <Route
              path="*"
              element={
                <div className="flex flex-col gap-[var(--space-sm)]">
                  <h1 className="type-display">This page does not exist</h1>
                  <p className="type-lede measure">
                    The address you followed is not part of the app. The problem sets index is one link away.
                  </p>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
