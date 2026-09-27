import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api, isLoggedIn, type GenerateResponse, type MeResponse } from '../services/api';

const TOPIC_SUGGESTIONS = ['loops', 'arrays', 'strings', 'pointers', 'functions', 'recursion', 'matrices', 'file I/O'];

/**
 * Student-facing AI problem generator. The backend picks the provider:
 * the user's Gemini key when they saved one, else the server's model, else the
 * offline bank — and verifies every generated expectation in the sandbox.
 */
export function GeneratePage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [topics, setTopics] = useState<string[]>(['loops']);
  const [topicInput, setTopicInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);

  useEffect(() => {
    if (isLoggedIn()) {
      api
        .me()
        .then(setMe)
        .catch(() => setMe(null));
    }
  }, []);

  const addTopic = (topic: string) => {
    const clean = topic.trim().toLowerCase();
    if (clean.length === 0 || topics.includes(clean) || topics.length >= 6) return;
    setTopics([...topics, clean]);
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.generateProblem({ difficulty, topics, persist: true });
      setResult(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Generation failed. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  if (!isLoggedIn()) {
    return (
      <section className="mx-auto flex w-full max-w-[560px] flex-col gap-[var(--space-lg)] text-center">
        <h1 className="type-display">Sign in to generate problems</h1>
        <p className="type-lede measure mx-auto text-[var(--color-muted)]">
          AI-generated problems belong to your account. Sign in — or create an account in under a minute — then come
          back here to create problems with the server model or your own Gemini key.
        </p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn" onClick={() => navigate('/login')}>
            Sign in / Register
          </button>
          <Link to="/" className="btn btn-quiet">
            Back to problem sets
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-[var(--space-lg)]">
      <header className="flex flex-col gap-1">
        <h1 className="type-display">Create a problem with AI</h1>
        <p className="type-lede measure text-[var(--color-muted)]">
          {me
            ? me.ai.aiProvider === 'gemini'
              ? 'Generating with your Gemini key (falls back to the server model if it fails).'
              : "Generating with the server's own model. Add a Gemini key on the account page to use yours instead."
            : 'Loading your AI settings…'}
        </p>
      </header>

      <div className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="difficulty" className="type-small text-[var(--color-muted)]">
              Difficulty
            </label>
            <select
              id="difficulty"
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
              className="field w-40"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="topic" className="type-small text-[var(--color-muted)]">
              Topics (up to 6)
            </label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addTopic(topicInput);
                setTopicInput('');
              }}
              className="flex gap-2"
            >
              <input
                id="topic"
                value={topicInput}
                onChange={(event) => setTopicInput(event.target.value)}
                placeholder="e.g. pointers"
                className="field w-48"
              />
              <button type="submit" className="btn btn-quiet">
                Add
              </button>
            </form>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {topics.map((topic) => (
            <button
              key={topic}
              type="button"
              className="btn btn-quiet"
              onClick={() => setTopics(topics.filter((t) => t !== topic))}
              aria-label={`Remove topic ${topic}`}
            >
              {topic} ✕
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {TOPIC_SUGGESTIONS.filter((topic) => !topics.includes(topic)).map((topic) => (
            <button key={topic} type="button" className="btn btn-quiet" onClick={() => addTopic(topic)}>
              + {topic}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="type-small text-[var(--color-danger, #b3261e)]">
            {error}
          </p>
        )}

        <button type="button" className="btn self-start" disabled={busy || topics.length === 0} onClick={() => void generate()}>
          {busy ? 'Generating — this can take up to a minute…' : 'Generate problem'}
        </button>
      </div>

      {result && (
        <div className="card flex flex-col gap-3">
          <h2 className="type-title">{result.problem.title}</h2>
          <p className="type-small text-[var(--color-muted)]">
            Generated with: <strong>{result.providerUsed === 'gemini' ? 'your Gemini key' : result.providerUsed === 'server' ? 'the server model' : 'the offline bank'}</strong>
            {' · '}
            Verification: <strong>{result.verification.passed ? 'passed' : 'failed'}</strong> — {result.verification.detail}
          </p>
          {result.geminiError && <p className="type-small text-[var(--color-muted)]">Gemini note: {result.geminiError}</p>}
          <div className="flex gap-2">
            {result.problemId && (
              <button type="button" className="btn" onClick={() => navigate(`/problems/${result.problemId}`)}>
                Open the problem
              </button>
            )}
            {result.problemSetId && (
              <Link to={`/sets/${result.problemSetId}`} className="btn btn-quiet">
                View your problem set
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
