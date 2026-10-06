import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, isLoggedIn, signOut } from '../../services/api';
import { isGuestMode } from '../../lib/guestMode';
import { PreferencesMenu } from './PreferencesMenu';

/**
 * A nav destination. The inactive state is underlined with the hairline colour; the
 * active one steps its weight up and moves the underline to the signal colour. Weight
 * and the `aria-current` attribute both change, so the state never rests on hue alone.
 */
function navLinkClass(active: boolean): string {
  // `.link` already carries the resting underline and the hover transition; the active
  // state is the same shape with a heavier weight and the signal colour underneath.
  return active
    ? 'type-small font-[var(--weight-strong)] text-[var(--color-ink)] underline decoration-[var(--color-accent)] decoration-2 underline-offset-[7px]'
    : 'link type-small';
}

/**
 * The app's top chrome: one line of mono set flush on the paper, closed by a single
 * hairline. No pill, no rounded container, no floating material — the bar is part of the
 * page, the way a header rule is part of a printed document.
 *
 * The active route is carried by three things at once: `aria-current`, a weight step, and
 * a vermilion underline. Never by colour alone, and never by a filled background, which
 * would put a second block of colour in the chrome.
 */
export function Navbar() {
  const location = useLocation();
  const [accountName, setAccountName] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      setAccountName(null);
      return;
    }
    let cancelled = false;
    setAccountName(null);
    api
      .me()
      .then((me) => {
        if (!cancelled) setAccountName(me.user.username);
      })
      .catch(() => {
        if (!cancelled) setAccountName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const onDashboard = location.pathname === '/';
  const onWorkbench = /^\/problems\/\d+$/.test(location.pathname);
  const onSignedOutLanding = (location.pathname === '/' || location.pathname === '/login') && !isLoggedIn() && !isGuestMode();

  const signOutAndReload = async () => {
    await api.logout().catch(() => undefined);
    signOut();
    setAccountName(null);
    window.location.assign('/');
  };

  if (onWorkbench || onSignedOutLanding) return null;

  return (
    <header className="toolbar">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5 md:px-8">
        <Link to="/" className="wordmark" aria-label="C Practice, home">
          C Practice
        </Link>

        <nav aria-label="Sections" className="flex items-center gap-4">
          <Link to="/" aria-current={onDashboard ? 'page' : undefined} className={navLinkClass(onDashboard)}>
            Problem sets
          </Link>
          <Link
            to="/generate"
            aria-current={location.pathname === '/generate' ? 'page' : undefined}
            className={navLinkClass(location.pathname === '/generate')}
          >
            Create with AI
          </Link>
        </nav>

        <div className="ms-auto flex items-center gap-2">
          {isGuestMode() ? (
            <span className="guest-mode-pill">
              Guest mode
              <Link to="/login" className="link ms-1">Sign in</Link>
            </span>
          ) : accountName ? (
            <>
              <Link to="/login" aria-current={location.pathname === '/login' ? 'page' : undefined} className={navLinkClass(location.pathname === '/login')}>
                {accountName}
              </Link>
              <button type="button" className="btn btn-quiet min-h-8 px-2" onClick={() => void signOutAndReload()}>
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login" aria-current={location.pathname === '/login' ? 'page' : undefined} className={navLinkClass(location.pathname === '/login')}>
              Account
            </Link>
          )}
          <PreferencesMenu />
        </div>
      </div>
    </header>
  );
}
