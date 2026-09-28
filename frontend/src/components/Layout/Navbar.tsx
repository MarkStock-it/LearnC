import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, isLoggedIn, signOut } from '../../services/api';
import { PreferencesMenu } from './PreferencesMenu';

/**
 * Translucent toolbar (apple-design §12): the material floats over the page and
 * content scrolls beneath it. The right side is the workbench concept's cluster:
 * the signed-in account, then the preferences gear.
 */
export function Navbar() {
  const location = useLocation();
  const [accountName, setAccountName] = useState<string | null>(null);

  // The workbench carries its own in-layout top bar (back button, breadcrumb,
  // preference circles), so the site navbar would be duplicate chrome there.
  const onWorkbench = /^\/problems\/\d+$/.test(location.pathname);
  if (onWorkbench) return null;

  useEffect(() => {
    if (!isLoggedIn()) {
      setAccountName(null);
      return;
    }
    let cancelled = false;
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

  const signOutAndReload = async () => {
    signOut();
    window.location.assign('/');
  };

  return (
    <header className="toolbar">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 md:px-8">
        <Link to="/" className="wordmark" aria-label="C Practice, home">
          C Practice
        </Link>

        <nav aria-label="Sections" className="flex items-center gap-4">
          <Link
            to="/"
            aria-current={onDashboard ? 'page' : undefined}
            className={`type-small ${onDashboard ? 'text-[var(--color-ink)]' : 'link'}`}
          >
            Problem sets
          </Link>
          <Link
            to="/generate"
            aria-current={location.pathname === '/generate' ? 'page' : undefined}
            className={`type-small ${location.pathname === '/generate' ? 'text-[var(--color-ink)]' : 'link'}`}
          >
            Create with AI
          </Link>
        </nav>

        <div className="ms-auto flex items-center gap-2">
          {accountName ? (
            <>
              <Link
                to="/login"
                aria-current={location.pathname === '/login' ? 'page' : undefined}
                className={`type-small ${location.pathname === '/login' ? 'text-[var(--color-ink)]' : 'link'}`}
              >
                {accountName}
              </Link>
              <button type="button" className="btn btn-quiet" onClick={() => void signOutAndReload()}>
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/login"
              aria-current={location.pathname === '/login' ? 'page' : undefined}
              className={`type-small ${location.pathname === '/login' ? 'text-[var(--color-ink)]' : 'link'}`}
            >
              Account
            </Link>
          )}
          <PreferencesMenu />
        </div>
      </div>
    </header>
  );
}
