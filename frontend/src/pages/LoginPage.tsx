import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, isLoggedIn, signOut as clearSession } from '../services/api';
import { setGuestMode } from '../lib/guestMode';
import { TuLanding } from './TuLanding';

/**
 * The `/` , `/login` and `/account` route component.
 *
 * Two very different surfaces live here, so the split is explicit:
 *
 *   signed out  →  the listing front door (TuLanding). It owns the whole viewport and
 *                  plays its own compile-out sequence before handing over to the app.
 *   signed in   →  account settings, which is an ordinary page inside the reading
 *                  column: which model generates your problems, and whether you appear
 *                  on the leaderboard.
 *
 * Keeping them on one route is deliberate — the account page has always been reachable
 * at `/login` for a signed-in user, and splitting the route would have changed that URL
 * for every bookmark and every link the navbar renders.
 */
export function LoginPage({ onEnterApp }: { onEnterApp?: () => void }) {
  const navigate = useNavigate();

  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [settingsSaved, setSettingsSaved] = useState<string | null>(null);
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) return;
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

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
    setGeminiKey('');
  };

  // ----- signed out: the translation unit -----
  if (!me) return <TuLanding onEnterApp={onEnterApp} />;

  // ----- signed in: account settings -----
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
        {settingsSaved && <p role="status" className="type-small a-toast">{settingsSaved}</p>}
        {error && <p role="alert" className="type-small text-[var(--color-fail)] a-diag">{error}</p>}
        <p className="type-small text-[var(--color-muted)]">Keys are stored server-side and never shown again. If Gemini fails, generation falls back to the server model, then to the built-in problem bank.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => navigate('/generate')}>Create a problem with AI</button>
        <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>Sign out</button>
      </div>
    </section>
  );
}
