import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, getStudentName, isLoggedIn, setStudentName, signOut } from '../../services/api';

/**
 * Translucent toolbar (apple-design §12): the material floats over the page and
 * content scrolls beneath it. With accounts, the right side shows the signed-in
 * username (or "Account") and links to the account page.
 */
export function Navbar() {
  const location = useLocation();
  const [name, setName] = useState(getStudentName());
  const [saved, setSaved] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);

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

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setStudentName(name);
    setSaved(true);
    // Identity changes are rare; a reload refetches everything under the new name
    // without threading the user through every query key.
    window.setTimeout(() => window.location.reload(), 250);
  };

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

        <form onSubmit={save} className="ms-auto flex items-center gap-2">
          <label htmlFor="student" className="type-small text-[var(--color-muted)]">
            Working as
          </label>
          <input
            id="student"
            name="student"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            placeholder="guest"
            autoComplete="off"
            className="field w-36"
          />
          <button type="submit" className="btn btn-quiet">
            {saved ? 'Switched' : 'Switch'}
          </button>
          {/* A button is not a live region, so the confirmation needs its own
           * status node to reach a screen reader at all. */}
          <span role="status" className="sr-only">
            {saved ? `Working as ${name}` : ''}
          </span>
        </form>

        <div className="flex items-center gap-2">
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
        </div>
      </div>
    </header>
  );
}
