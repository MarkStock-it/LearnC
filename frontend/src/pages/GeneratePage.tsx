import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api, isLoggedIn, type GenerateResponse, type MeResponse } from '../services/api';

const TOPIC_SUGGESTIONS = ['loops', 'arrays', 'strings', 'pointers', 'functions', 'recursion', 'matrices', 'file I/O'];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash-lite', label: 'Flash-Lite', hint: 'cheapest' },
  { id: 'gemini-2.5-flash', label: 'Flash', hint: 'smarter, more quota' },
  { id: 'gemini-2.0-flash', label: '2.0 Flash', hint: 'legacy tier' },
];

/**
 * Student-facing AI practice-quiz builder. Everything is customisable: how many
 * problems, what to focus on, what to avoid, and which Gemini model spends its
 * tokens. Generation is compact (one call per problem) to go easy on the
 * free-tier rate limits; the backend verifies every problem in the sandbox.
 *
 * Layout: a narrow order summary sits beside the form and restates the quiz
 * being built as it changes — the one place the page spends personality. The
 * form itself is grouped into three questions a student naturally answers:
 * what, how much, how done.
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
        <p className="type-lede measure mx-auto">
          AI-generated practice quizzes belong to your account. Sign in, add your own Gemini API key (a free one from
          Google AI Studio works), and shape the quiz however you like.
        </p>
        <div className="flex justify-center gap-2">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>
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
        <p className="type-lede measure">
          {usingOwnKey ? (
            <>Generating with your Gemini key ({GEMINI_MODELS.find((m) => m.id === geminiModel)?.label ?? geminiModel}). One call per problem keeps the free rate limit comfortable.</>
          ) : (
            <>
              Quizzes are generated with your own Gemini API key — a free one from Google AI Studio works.{' '}
              <Link to="/account" className="link">
                Add a key on the account page
              </Link>{' '}
              to start.
            </>
          )}
        </p>
      </header>

      <div className="grid gap-[var(--space-lg)] lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* ——— the form: three questions, each a group with its own head ——— */}
        <form
          className="sheet flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && topics.length > 0) void generate();
          }}
        >
          {/* 1 — what should it test */}
          <fieldset className="flex flex-col gap-3 border-0 p-0 pb-[var(--space-md)] pl-[var(--space-md)] pr-[var(--space-md)] pt-[var(--space-md)] [border-bottom:1px_solid_var(--color-rule)]">
            <legend className="sr-only">What should the quiz test?</legend>
            <div className="flex flex-col gap-1">
              <label htmlFor="topic" className="type-small font-[var(--weight-medium)]">
                Topics
              </label>
              <p className="type-micro">What the problems should test — up to six.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {topics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  className="mono flex items-center gap-1 rounded-[var(--radius-micro)] border border-[var(--color-hairline)] bg-[var(--color-accent-quiet)] px-2 py-1 text-[var(--text-micro)] text-[var(--color-ink)]"
                  onClick={() => setTopics(topics.filter((t) => t !== topic))}
                  aria-label={`Remove topic ${topic}`}
                >
                  {topic}
                  <span aria-hidden="true" className="text-[var(--color-faint)]">
                    ✕
                  </span>
                </button>
              ))}
              {topics.length < 6 && (
                <input
                  id="topic"
                  aria-label="Add a topic"
                  value={topicInput}
                  onChange={(event) => setTopicInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTopic(topicInput);
                      setTopicInput('');
                    }
                  }}
                  onBlur={() => {
                    if (topicInput.trim()) {
                      addTopic(topicInput);
                      setTopicInput('');
                    }
                  }}
                  placeholder="add a topic…"
                  className="field h-8 min-h-0 w-40"
                />
              )}
            </div>
            {topics.length < 6 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="type-micro">Common:</span>
                {TOPIC_SUGGESTIONS.filter((topic) => !topics.includes(topic)).map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className="type-small text-[var(--color-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--color-ink)]"
                    onClick={() => addTopic(topic)}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {/* 2 — how much, and at what level */}
          <fieldset className="flex flex-wrap items-start gap-x-6 gap-y-3 border-0 p-0 pb-[var(--space-md)] pl-[var(--space-md)] pr-[var(--space-md)] pt-[var(--space-md)] [border-bottom:1px_solid_var(--color-rule)]">
            <legend className="sr-only">How much, and at what level?</legend>
            <div className="flex flex-col gap-1">
              <label htmlFor="count" className="type-small font-[var(--weight-medium)]">
                Problems
              </label>
              <select
                id="count"
                value={problemCount}
                onChange={(event) => setProblemCount(Number(event.target.value))}
                className="field w-28"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} problem{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="difficulty" className="type-small font-[var(--weight-medium)]">
                Difficulty
              </label>
              <select
                id="difficulty"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
                className="field w-28"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            {usingOwnKey && (
              <div className="flex flex-col gap-1">
                <label htmlFor="model" className="type-small font-[var(--weight-medium)]">
                  Gemini model
                </label>
                <select
                  id="model"
                  value={geminiModel}
                  onChange={(event) => setGeminiModel(event.target.value)}
                  className="field w-64"
                >
                  {GEMINI_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label} — {model.hint}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          {/* 3 — how do you want it done */}
          <fieldset className="flex flex-col gap-3 border-0 p-0 pb-[var(--space-md)] pl-[var(--space-md)] pr-[var(--space-md)] pt-[var(--space-md)]">
            <legend className="sr-only">How do you want it done?</legend>
            <div className="flex flex-col gap-1">
              <label htmlFor="instructions" className="type-small font-[var(--weight-medium)]">
                Requests <span className="font-normal text-[var(--color-faint)]">— optional</span>
              </label>
              <p className="type-micro">
                Direct the generator: focus on, avoid, style. It takes these literally.
              </p>
            </div>
            <textarea
              id="instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={2}
              maxLength={400}
              placeholder="e.g. one nested-loop problem; no scanf validation; keep starter code short"
              className="field resize-y"
            />
            <span className="num type-micro self-end">{instructions.length}/400</span>
            <div className="flex flex-col gap-1">
              <label htmlFor="quizTitle" className="type-small font-[var(--weight-medium)]">
                Quiz name <span className="font-normal text-[var(--color-faint)]">— optional</span>
              </label>
              <input
                id="quizTitle"
                value={quizTitle}
                onChange={(event) => setQuizTitle(event.target.value)}
                maxLength={120}
                placeholder="Week 5 recursion drills"
                className="field w-72 max-w-full"
              />
            </div>
          </fieldset>
        </form>

        {/* ——— the order summary: the page's one bold move ——— */}
        <aside className="flex flex-col gap-3 lg:sticky lg:top-[var(--space-lg)] lg:self-start" aria-label="Quiz summary">
          <div className="type-micro">Your quiz so far</div>
          <div className="well flex flex-col gap-2 p-[var(--space-md)]">
            <p className="type-title">{quizTitle.trim() || 'Untitled quiz'}</p>
            <p className="type-small text-[var(--color-muted)]">
              {problemCount} {difficulty} problem{problemCount > 1 ? 's' : ''}
              {topics.length > 0 && (
                <>
                  {' '}
                  on{' '}
                  {topics.length === 1 ? (
                    <span className="mono">{topics[0]}</span>
                  ) : topics.length === 2 ? (
                    <>
                      <span className="mono">{topics[0]}</span> and <span className="mono">{topics[1]}</span>
                    </>
                    ) : (
                    <>
                      <span className="mono">{topics.slice(0, -1).join(', ')}</span> and{' '}
                      <span className="mono">{topics[topics.length - 1]}</span>
                    </>
                  )}
                </>
              )}
              .
            </p>
            {instructions.trim() && (
              <p className="type-micro [border-left:2px_solid_var(--color-rule)] pl-2 italic">
                “{instructions.trim()}”
              </p>
            )}
            <div className="rule flex items-center justify-between pt-2">
              <span className="type-micro">
                {usingOwnKey ? 'Your Gemini key' : 'Gemini key needed'} · {problemCount}{' '}
                {problemCount === 1 ? 'call' : 'calls'}
              </span>
              {usingOwnKey && <span className="num type-micro">{problemCount}/10 rpm</span>}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || topics.length === 0}
            onClick={() => void generate()}
          >
            {busy
              ? `Generating ${problemCount} problem${problemCount > 1 ? 's' : ''}…`
              : `Generate ${problemCount} problem${problemCount > 1 ? 's' : ''}`}
          </button>
          {error && (
            <p role="alert" className="type-small text-[var(--color-fail)]">
              {error}
            </p>
          )}
        </aside>
      </div>

      {result && (
        <div className="surface flex flex-col gap-3 p-[var(--space-md)]">
          <h2 className="type-title">
            {result.count > 0 ? `${result.count} problem${result.count > 1 ? 's' : ''} ready` : 'Nothing generated'}
          </h2>
          {result.geminiError && <p className="type-small text-[var(--color-muted)]">Gemini note: {result.geminiError}</p>}
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
                <span className="num type-small text-[var(--color-muted)]">
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
