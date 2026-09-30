import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, isLoggedIn, signOut as clearSession } from '../services/api';
import { setGuestMode } from '../lib/guestMode';
import { AnimatedGlobe } from '../components/ui/AnimatedGlobe';

/**
 * First-visit sign-in/landing. Auth and account settings still use the same API
 * contract; successful account and guest entry both hand off to the shared globe
 * transition managed by App.
 */
export function LoginPage({ onEnterApp }: { onEnterApp?: () => void }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [globePulse, setGlobePulse] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) return;
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const failFeedback = (message: string) => {
    setError(message);
    setShaking(true);
    setGlobePulse(true);
    window.setTimeout(() => setShaking(false), 350);
    window.setTimeout(() => setGlobePulse(false), 550);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await api.login(username, password);
      else await api.register(username, password);
      setMe(null);
      setLeaving(true);
      window.setTimeout(() => onEnterApp?.(), 180);
    } catch (err) {
      failFeedback(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  const continueAsGuest = () => {
    if (busy) return;
    setError(null);
    clearSession();
    setGuestMode(true);
    setBusy(true);
    setLeaving(true);
    window.setTimeout(() => onEnterApp?.(), 180);
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
    clearSession();
    setMe(null);
    setGuestMode(false);
    setUsername('');
    setPassword('');
  };

  // ----- signed-in account settings (same functionality; only account visits) -----
  if (me) {
    return (
      <section className="mx-auto flex w-full max-w-[760px] flex-col gap-[var(--space-lg)]">
        <header className="flex flex-col gap-1">
          <h1 className="type-display">Signed in as {me.user.username}</h1>
          <p className="type-lede measure text-[var(--color-muted)]">Your problems and progress stay tied to this account.</p>
        </header>

        <div className="sheet flex flex-col gap-3 p-[var(--space-lg)] md:p-[var(--space-xl)]">
          <h2 className="type-title">AI problem generator</h2>
          <p className="type-small text-[var(--color-muted)]">
            Current choice: <strong>{me.ai.aiProvider === 'gemini' ? 'your Gemini key' : "the server's own model"}</strong>
            {' · '}{me.ai.hasGeminiKey ? 'a Gemini key is stored' : 'no Gemini key stored'}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="gemini" className="type-small text-[var(--color-muted)]">Gemini API key (optional)</label>
              <input id="gemini" type="password" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} placeholder="AIza…" autoComplete="off" className="field w-80" />
            </div>
            <button type="button" className="btn" disabled={geminiKey.trim().length < 10} onClick={() => void saveSettings('gemini')}>Use my Gemini key</button>
            <button type="button" className="btn btn-quiet" onClick={() => void saveSettings('server')}>Use the server model</button>
            {me.ai.hasGeminiKey && <button type="button" className="btn btn-quiet" onClick={async () => { await api.clearGeminiKey(); setMe(await api.me()); setSettingsSaved('Stored key removed.'); }}>Remove stored key</button>}
          </div>
          <div className="flex flex-col gap-2 border-t border-[var(--color-rule)] pt-3">
            <h3 className="type-small font-medium">Public leaderboard</h3>
            <p className="type-micro text-[var(--color-muted)]">Only your username and distinct solved-problem count will be shown. This is off unless you opt in.</p>
            <label className="flex items-center gap-2 type-small">
              <input type="checkbox" checked={me.ai.leaderboardPublic} disabled={leaderboardBusy} onChange={async (event) => {
                const isPublic = event.target.checked;
                setLeaderboardBusy(true);
                setError(null);
                try {
                  const result = await api.saveLeaderboardSettings(isPublic);
                  setMe((current) => current ? { ...current, ai: result.ai } : current);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Could not update leaderboard privacy.');
                } finally {
                  setLeaderboardBusy(false);
                }
              }} />
              Show me on the public bundles leaderboard
            </label>
          </div>
          {settingsSaved && <p role="status" className="type-small">{settingsSaved}</p>}
          {error && <p role="alert" className="type-small text-[var(--color-fail)]">{error}</p>}
          <p className="type-small text-[var(--color-muted)]">Keys are stored server-side and never shown again. If Gemini fails, generation falls back to the server model, then to the built-in problem bank.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/generate')}>Create a problem with AI</button>
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>Sign out</button>
        </div>
      </section>
    );
  }

  return (
    <section className={`landing-frame ${leaving ? 'landing-leaving' : ''}`} aria-label="C Practice sign in">
      <div className="landing-panel">
        <div className={`landing-form-side ${shaking ? 'login-shake' : ''}`}>
          <div className="landing-brand" aria-label="C Practice">
            <span className="landing-mark">C</span>
            <span>Practice</span>
          </div>
          <p className="type-micro mb-2 uppercase tracking-[0.14em]">A quiet place to think in C</p>
          <h1 className="landing-heading">Make the next idea compile.</h1>
          <p className="landing-copy">Practice exam problems, run your code against real test cases, and build confidence one submission at a time.</p>

          <form onSubmit={submit} className="landing-auth-form" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
            <input
              aria-label="Username"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              autoComplete="username"
              required
              minLength={3}
              className="field landing-input"
            />
            <input
              aria-label="Password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              className="field landing-input"
            />
            {error ? <p className="landing-error" role="alert">{error}</p> : null}
            <button type="submit" className="btn btn-primary landing-submit" disabled={busy}>
              {busy ? <><span className="landing-spinner" aria-hidden />Signing in…</> : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="landing-divider"><span /> <small>or</small> <span /></div>
          <button type="button" className="btn btn-quiet landing-guest" onClick={continueAsGuest} disabled={busy}>
            Continue as guest
          </button>
          <p className="landing-signup type-small">
            {mode === 'login' ? 'New to C Practice? ' : 'Already have an account? '}
            <button
              type="button"
              className="link"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in instead'}
            </button>
          </p>
          <p className="landing-footnote type-micro">Your work saves as you go. No account needed to start.</p>
        </div>

        <div className={`landing-globe-side ${globePulse ? 'globe-pulse' : ''}`} aria-hidden="true">
          <div className="globe-caption">
            <span className="globe-caption-rule" />
            <span>One problem at a time</span>
          </div>
          <AnimatedGlobe className="landing-globe" />
          <div className="globe-footline"><span className="globe-status-dot" /> Sandbox ready <span className="globe-foot-divider">·</span> C99</div>
        </div>
      </div>
    </section>
  );
}
