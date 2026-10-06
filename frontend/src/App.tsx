import { Suspense, lazy, useEffect, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from './components/Layout/Navbar';
import { DashboardPage } from './pages/DashboardPage';
import { BundleWorkspace } from './pages/BundleWorkspace';
import { SetPage } from './pages/SetPage';
import { api, isLoggedIn, onSessionLost } from './services/api';
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
  /**
   * A stored credential is a claim, not a fact.
   *
   * `appReady` used to start `true` whenever a token merely existed in localStorage, so a
   * stale — or hand-written — token rendered the entire signed-in workspace: the real
   * username slot, the navigation, a Sign out button. Every request that shell made then
   * returned 401, so problem sets and history rendered as *empty lists*, which a student
   * cannot tell apart from "my work is gone". The shell now waits for the server to accept
   * the token, and a rejection becomes a signed-out state rather than an empty one.
   */
  const [appReady, setAppReady] = useState(() => isGuestMode());
  const [sessionChecked, setSessionChecked] = useState(() => !isLoggedIn());

  useEffect(() => {
    if (!isLoggedIn()) {
      setSessionChecked(true);
      return;
    }
    let cancelled = false;
    // The cheapest endpoint that requires a valid session. A 401 also clears the stored
    // credential, in the API layer, so one place owns that decision.
    api
      .me()
      .then(() => {
        if (!cancelled) setAppReady(true);
      })
      .catch(() => {
        if (!cancelled) setAppReady(false);
      })
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A credential rejected mid-session has to leave the workspace, not sit inside it.
  useEffect(
    () =>
      onSessionLost(() => {
        setAppReady(false);
        navigate('/', { replace: true });
      }),
    [navigate],
  );

  const inApp = appReady || isGuestMode();
  const fullScreenWorkspace = inApp && isPostLoginArea;
  /**
   * The signed-out front door is a full-bleed listing: it owns the entire viewport, its
   * own gutter rail and its own status bar. It must therefore NOT inherit the reading
   * column the rest of the site is measured against, or the rail would start 40px in
   * from the edge and the page would stop being a page.
   */
  const landingRoute = !inApp && (location.pathname === '/' || location.pathname === '/login');

  /**
   * The landing page plays its own exit sequence (`compiling… linked · exit 0`) and then
   * hands over. The globe transition that used to cover this moment is gone: the one
   * thing the student is told on the way in is now the thing that actually happened.
   */
  const enterApp = () => {
    setAppReady(true);
    navigate('/');
  };

  const leaveApp = () => {
    setAppReady(false);
    navigate('/', { replace: true });
  };

  if (!sessionChecked) {
    /*
     * One round-trip while the stored session is verified. Rendering the landing here would
     * flash the sign-in page at every signed-in reload; rendering the workspace would show
     * data the server has not yet agreed to.
     */
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="type-small text-[var(--color-muted)]">Checking your session…</p>
      </div>
    );
  }

  return (
    <div className={`flex min-h-dvh flex-col ${workbenchRoute || fullScreenWorkspace ? 'h-dvh overflow-hidden' : ''}`}>
      <a
        href="#main"
        className="btn btn-quiet sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[var(--z-tooltip)]"
      >
        Skip to content
      </a>

      {!(inApp && isPostLoginArea) && !landingRoute ? <Navbar /> : null}

      <main
        id="main"
        className={workbenchRoute
          ? 'min-h-0 w-full flex-1 overflow-hidden p-0'
          : inApp && isPostLoginArea
            ? 'relative flex min-h-0 w-full flex-1 flex-col p-0'
            : landingRoute
              ? 'flex min-h-dvh w-full flex-1 flex-col p-0'
              : 'mx-auto w-full max-w-[1180px] flex-1 px-5 py-[var(--space-xl)] md:px-8'}
      >
        <Suspense fallback={inApp && isPostLoginArea || landingRoute ? null : <p className="type-small text-[var(--color-muted)]">Loading…</p>}>
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
                  /* No container of its own: `main` already supplies the reading column for
                     every route that is not the full-bleed listing. */
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
    </div>
  );
}
