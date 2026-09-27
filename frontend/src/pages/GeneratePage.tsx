import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api, isLoggedIn, type GenerateResponse, type MeResponse } from '../services/api';

const TOPIC_SUGGESTIONS = ['loops', 'arrays', 'strings', 'pointers', 'functions', 'recursion', 'matrices', 'file I/O'];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash-lite', label: 'Flash-Lite — cheapest, best for your free quota' },
  { id: 'gemini-2.5-flash', label: 'Flash — smarter, uses more quota' },
  { id: 'gemini-2.0-flash', label: '2.0 Flash — legacy free tier' },
];

/**
 * Student-facing AI practice-quiz builder. Everything is customisable: how many
 * problems, what to focus on, what to avoid, and which Gemini model spends its
 * tokens. Generation is compact (one call per problem) to go easy on the
 * free-tier rate limits; the backend verifies every problem in the sandbox.
 */
export function GeneratePage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [topics, setTopics] = useState<string[]>(['loops']);
  const [topicInput, setTopicInput] = useState('');
  const [problemCount, setProblemCount] = useState(1);
  const [instructions, setInstructions] = useState('');
  const [quizTitle, setQuizTitle] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash-lite');
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
      const response = await api.generateProblem({
        difficulty,
        topics,
        problemCount,
        instructions: instructions.trim() || undefined,
        quizTitle: quizTitle.trim() || undefined,
        geminiModel,
      });
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
        <h1 className="type-display">Sign in to generate quizzes</h1>
        <p className="type-lede measure mx-auto text-[var(--color-muted)]">
          AI-generated practice quizzes belong to your account. Sign in, add your own Gemini API key (a free one from
          Google AI Studio works), and shape the quiz however you like.
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

  const usingOwnKey = me?.ai.aiProvider === 'gemini' && me.ai.hasGeminiKey;

  return (
    <section className="flex flex-col gap-[var(--space-lg)]">
      <header className="flex flex-col gap-1">
        <h1 className="type-display">Build a practice quiz</h1>
        <p className="type-lede measure text-[var(--color-muted)]">
          {usingOwnKey
            ? `Generating with your Gemini key (${geminiModel.replace('gemini-', '')}). One compact call per problem keeps the ~10 requests/minute free limit comfortable.`
            : "Add your Gemini API key on the account page to generate quizzes — the server's own model is offline by default to save resources."}
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
              className="field w-36"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="count" className="type-small text-[var(--color-muted)]">
              Problems (each is one API call)
            </label>
            <select
              id="count"
              value={problemCount}
              onChange={(event) => setProblemCount(Number(event.target.value))}
              className="field w-36"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} problem{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>
          {usingOwnKey && (
            <div className="flex flex-col gap-1">
              <label htmlFor="model" className="type-small text-[var(--color-muted)]">
                Gemini model
              </label>
              <select
                id="model"
                value={geminiModel}
                onChange={(event) => setGeminiModel(event.target.value)}
                className="field w-72"
              >
                {GEMINI_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          )}
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
          <div className="mt-2 flex flex-wrap gap-2">
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
          {topics.length < 6 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {TOPIC_SUGGESTIONS.filter((topic) => !topics.includes(topic)).map((topic) => (
                <button key={topic} type="button" className="btn btn-quiet" onClick={() => addTopic(topic)}>
                  + {topic}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="instructions" className="type-small text-[var(--color-muted)]">
            How do you want it done? (optional)
          </label>
          <textarea
            id="instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={2}
            maxLength={400}
            placeholder="e.g. focus on nested loops with 2D arrays; avoid scanf validation; make one problem about prime numbers"
            className="field"
          />
          <span className="type-small text-[var(--color-muted)]">{instructions.length}/400</span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="quizTitle" className="type-small text-[var(--color-muted)]">
            Quiz name (optional — problems group under this)
          </label>
          <input
            id="quizTitle"
            value={quizTitle}
            onChange={(event) => setQuizTitle(event.target.value)}
            maxLength={120}
            placeholder="Week 5 recursion drills"
            className="field w-96 max-w-full"
          />
        </div>

        {error && (
          <p role="alert" className="type-small text-[var(--color-danger, #b3261e)]">
            {error}
          </p>
        )}

        <button type="button" className="btn self-start" disabled={busy || topics.length === 0} onClick={() => void generate()}>
          {busy ? `Generating ${problemCount} problem${problemCount > 1 ? 's' : ''}…` : 'Generate quiz'}
        </button>
      </div>

      {result && (
        <div className="card flex flex-col gap-3">
          <h2 className="type-title">
            {result.count > 0 ? `${result.count} problem${result.count > 1 ? 's' : ''} ready` : 'Nothing generated'}
          </h2>
          {result.geminiError && (
            <p className="type-small text-[var(--color-muted)]">Gemini note: {result.geminiError}</p>
          )}
          {result.notes.map((note) => (
            <p key={note} className="type-small text-[var(--color-muted)]">
              {note}
            </p>
          ))}
          <ul className="flex flex-col gap-2">
            {result.problems.map((problem) => (
              <li key={problem.problemId} className="flex flex-wrap items-center gap-2">
                <Link to={`/problems/${problem.problemId}`} className="link">
                  {problem.title}
                </Link>
                <span className="type-small text-[var(--color-muted)]">
                  {problem.difficulty} · verified {problem.verificationPassed ? '✓' : '✗'}
                </span>
              </li>
            ))}
          </ul>
          {result.problemSetId && (
            <Link to={`/sets/${result.problemSetId}`} className="btn btn-quiet self-start">
              Open the quiz set
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
