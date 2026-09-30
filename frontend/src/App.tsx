import { Suspense, lazy, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from './components/Layout/Navbar';
import { GlobeTransition } from './components/ui/GlobeTransition';
import { DashboardPage } from './pages/DashboardPage';
import { BundleWorkspace } from './pages/BundleWorkspace';
import { SetPage } from './pages/SetPage';
import { isLoggedIn } from './services/api';
import { isGuestMode } from './lib/guestMode';

/** Editor and Markdown renderer stay code-split away from the entry experience. */
const PracticePage = lazy(() => import('./pages/PracticePage').then((module) => ({ default: module.PracticePage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const GeneratePage = lazy(() => import('./pages/GeneratePage').then((module) => ({ default: module.GeneratePage })));
const PublicBundlesPage = lazy(() => import('./components/Bundles/PublicBundlesPage').then((module) => ({ default: module.PublicBundlesPage })));

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const workbenchRoute = /^\/problems\/\d+$/.test(location.pathname);
  const isPostLoginArea = location.pathname === '/' || ['/bundles/your', '/bundles/public', '/bundles/create', '/generate', '/account'].includes(location.pathname) || /^\/sets\/\d+$/.test(location.pathname);
  const [appReady, setAppReady] = useState(() => isLoggedIn() || isGuestMode());
  const [globeActive, setGlobeActive] = useState(false);

  const enterApp = () => {
    setAppReady(true);
    setGlobeActive(true);
    window.setTimeout(() => {
      setGlobeActive(false);
      navigate('/');
    }, 1150);
  };

  const leaveApp = () => {
    setAppReady(false);
    navigate('/', { replace: true });
  };

  const inApp = appReady || isLoggedIn() || isGuestMode();
  const fullScreenWorkspace = inApp && isPostLoginArea;

  return (
    <div className={`flex min-h-dvh flex-col ${workbenchRoute || fullScreenWorkspace ? 'h-dvh overflow-hidden' : ''}`}>
      <a
        href="#main"
        className="btn btn-quiet sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[var(--z-tooltip)]"
      >
        Skip to content
      </a>

      {!(inApp && isPostLoginArea) ? <Navbar /> : null}

      <main
        id="main"
        className={workbenchRoute
          ? 'min-h-0 w-full flex-1 overflow-hidden p-0'
          : inApp && isPostLoginArea
            ? 'relative flex min-h-0 w-full flex-1 flex-col p-0'
            : 'mx-auto w-full max-w-[1180px] flex-1 px-5 py-[var(--space-xl)] md:px-8'}
      >
        <Suspense fallback={inApp && isPostLoginArea ? null : <p className="type-small text-[var(--color-muted)]">Loading…</p>}>
          {inApp && isPostLoginArea ? (
            <BundleWorkspace onSignedOut={leaveApp}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/sets/:setId" element={<SetPage />} />
                <Route path="/generate" element={<GeneratePage />} />
                <Route path="/bundles/your" element={<DashboardPage workspaceMode />} />
                <Route path="/bundles/public" element={<PublicBundlesPage />} />
                <Route path="/bundles/create" element={<GeneratePage />} />
                <Route path="/account" element={<LoginPage onEnterApp={enterApp} />} />
              </Routes>
            </BundleWorkspace>
          ) : (
            <Routes>
              <Route path="/" element={<LoginPage onEnterApp={enterApp} />} />
              <Route path="/problems/:problemId" element={<PracticePage />} />
              <Route path="/login" element={<LoginPage onEnterApp={enterApp} />} />
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
          )}
        </Suspense>
      </main>
      <GlobeTransition active={globeActive} />
    </div>
  );
}
