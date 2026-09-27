import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, getToken, isLoggedIn, setStudentName, setToken } from '../services/api';

/**
 * Account page: register, sign in, sign out, and choose who generates your
 * problems — the server's own Ollama model or your personal Gemini key.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>(getToken() ? 'login' : 'register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) return;
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
      setToken(result.token);
      setStudentName(result.user.username);
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (provider: 'server' | 'gemini') => {
    setSettingsSaved(null);
    try {
      await api.saveAiSettings(provider, provider === 'gemini' ? geminiKey : undefined);
      setSettingsSaved(provider === 'gemini' ? 'Gemini key saved — your problems will use your key.' : 'Using the server model.');
      setGeminiKey('');
      setMe(await api.me());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save AI settings.');
    }
  };

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    setToken('');
    window.location.assign('/');
  };

  // ----- signed-in view -----
  if (me) {
    return (
      <section className="flex flex-col gap-[var(--space-lg)]">
        <header className="flex flex-col gap-1">
          <h1 className="type-display">Signed in as {me.user.username}</h1>
          <p className="type-lede measure text-[var(--color-muted)]">
            Your problems and progress stay tied to this account.
          </p>
        </header>

        <div className="card flex flex-col gap-3">
          <h2 className="type-title">AI problem generator</h2>
          <p className="type-small text-[var(--color-muted)]">
            Current choice:{' '}
            <strong>{me.ai.aiProvider === 'gemini' ? 'your Gemini key' : "the server's own model"}</strong>
            {' · '}
            {me.ai.hasGeminiKey ? 'a Gemini key is stored' : 'no Gemini key stored'}
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="gemini" className="type-small text-[var(--color-muted)]">
                Gemini API key (optional)
              </label>
              <input
                id="gemini"
                type="password"
                value={geminiKey}
                onChange={(event) => setGeminiKey(event.target.value)}
                placeholder="AIza…"
                autoComplete="off"
                className="field w-80"
              />
            </div>
            <button type="button" className="btn" disabled={geminiKey.trim().length < 10} onClick={() => void saveSettings('gemini')}>
              Use my Gemini key
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void saveSettings('server')}>
              Use the server model
            </button>
            {me.ai.hasGeminiKey && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={async () => {
                  await api.clearGeminiKey();
                  setMe(await api.me());
                  setSettingsSaved('Stored key removed.');
                }}
              >
                Remove stored key
              </button>
            )}
          </div>

          {settingsSaved && (
            <p role="status" className="type-small text-[var(--color-ink)]">
              {settingsSaved}
            </p>
          )}
          <p className="type-small text-[var(--color-muted)]">
            Keys are stored server-side and never shown again. If Gemini fails, generation falls back to the server
            model, then to the built-in problem bank.
          </p>
        </div>

        <div className="flex gap-2">
          <button type="button" className="btn" onClick={() => navigate('/generate')}>
            Create a problem with AI
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </section>
    );
  }

  // ----- signed-out view -----
  return (
    <section className="mx-auto flex w-full max-w-[440px] flex-col gap-[var(--space-lg)]">
      <header className="flex flex-col gap-1">
        <h1 className="type-display">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="type-lede text-[var(--color-muted)]">
          An account keeps your submissions, progress and AI-generated problems together.
        </p>
      </header>

      <form onSubmit={submit} className="card flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="username" className="type-small text-[var(--color-muted)]">
            Username
          </label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            minLength={3}
            className="field"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="type-small text-[var(--color-muted)]">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            className="field"
          />
        </div>

        {error && (
          <p role="alert" className="type-small text-[var(--color-danger, #b3261e)]">
            {error}
          </p>
        )}

        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <p className="type-small text-[var(--color-muted)]">
          {mode === 'login' ? 'No account yet? ' : 'Already registered? '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Create one' : 'Sign in instead'}
          </button>
        </p>
      </form>
    </section>
  );
}
