import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getQueryIdentity, getStudentName, isLoggedIn, type GenerateResponse, type MeResponse } from '../services/api';
import { revealDelay } from '../lib/reveal';

const TOPIC_SUGGESTIONS = ['loops', 'arrays', 'strings', 'pointers', 'functions', 'recursion', 'matrices', 'file I/O'];

const DRAFT_PREFIX = 'c-practice.quiz-draft.';

type QuizDraft = {
  difficulty: 'easy' | 'medium' | 'hard';
  topics: string[];
  problemCount: number;
  instructions: string;
  quizTitle: string;
  geminiModel: string;
};

function draftKey(): string {
  try {
    const identity = getStudentName() || 'account';
    return `${DRAFT_PREFIX}${encodeURIComponent(identity)}`;
  } catch {
    return `${DRAFT_PREFIX}account`;
  }
}

function readQuizDraft(key: string): Partial<QuizDraft> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const draft = JSON.parse(raw) as Partial<QuizDraft>;
    return {
      difficulty: draft.difficulty === 'medium' || draft.difficulty === 'hard' ? draft.difficulty : 'easy',
      topics: Array.isArray(draft.topics)
        ? [...new Set(draft.topics.filter((topic): topic is string => typeof topic === 'string').map((topic) => topic.trim().toLowerCase()).filter(Boolean))].slice(0, 6)
        : ['loops'],
      problemCount: [1, 2, 3, 4, 5].includes(Number(draft.problemCount)) ? Number(draft.problemCount) : 1,
      instructions: typeof draft.instructions === 'string' ? draft.instructions.slice(0, 400) : '',
      quizTitle: typeof draft.quizTitle === 'string' ? draft.quizTitle.slice(0, 60) : '',
      geminiModel: typeof draft.geminiModel === 'string' && GEMINI_MODELS.some((model) => model.id === draft.geminiModel)
        ? draft.geminiModel
        : 'gemini-3.8-flash',
    };
  } catch {
    return {};
  }
}

const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', hint: 'recommended' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', hint: 'lower cost' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'legacy access may be restricted' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', hint: 'legacy access may be restricted' },
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
  const queryClient = useQueryClient();
  const identity = getQueryIdentity();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [draftStorageKey] = useState(draftKey);
  const [savedDraft] = useState(() => readQuizDraft(draftStorageKey));
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>(() => savedDraft.difficulty ?? 'easy');
  const [topics, setTopics] = useState<string[]>(() => savedDraft.topics ?? ['loops']);
  const [topicInput, setTopicInput] = useState('');
  const [topicMessage, setTopicMessage] = useState<string | null>(null);
  const [problemCount, setProblemCount] = useState(() => savedDraft.problemCount ?? 1);
  const [instructions, setInstructions] = useState(() => savedDraft.instructions ?? '');
  const [quizTitle, setQuizTitle] = useState(() => savedDraft.quizTitle ?? '');
  const [geminiModel, setGeminiModel] = useState(() => savedDraft.geminiModel ?? 'gemini-3.8-flash');
  const [draftStatus, setDraftStatus] = useState('Draft restored');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  /* Whether the last draft write failed. Tracked as state rather than sniffed from the
   * status string, because the announcement below depends on it being exact. */
  const [draftFailed, setDraftFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftStorageKey, JSON.stringify({ difficulty, topics, problemCount, instructions, quizTitle, geminiModel } satisfies QuizDraft));
        setDraftStatus('Draft saved');
        setDraftFailed(false);
      } catch {
        setDraftStatus('Draft could not be saved');
        setDraftFailed(true);
      }
    }, 250);
    setDraftStatus('Saving draft…');
    return () => window.clearTimeout(timer);
  }, [difficulty, topics, problemCount, instructions, quizTitle, geminiModel, draftStorageKey]);

  useEffect(() => {
    if (isLoggedIn()) {
      api
        .me()
        .then(setMe)
        .catch(() => setMe(null))
        .finally(() => setSettingsLoading(false));
    } else {
      setSettingsLoading(false);
    }
  }, []);

  const addTopic = (topic: string) => {
    const clean = topic.trim().toLowerCase();
    if (!clean) return;
    if (topics.includes(clean)) {
      setTopicMessage(`“${clean}” is already selected.`);
      return;
    }
    if (clean.length > 40) {
      setTopicMessage('Topics can be up to 40 characters.');
      return;
    }
    if (topics.length >= 6) {
      setTopicMessage('Choose up to six topics.');
      return;
    }
    setTopics((current) => [...current, clean]);
    setTopicMessage(null);
  };

  const appendIdea = (idea: string) => {
    setInstructions((current) => {
      if (current.includes(idea)) return current;
      const next = current.trim() ? `${current.trim()}, ${idea}` : idea;
      return next.length <= 400 ? next : current;
    });
  };

  const resetDraft = () => {
    setDifficulty('easy');
    setTopics(['loops']);
    setTopicInput('');
    setTopicMessage(null);
    setProblemCount(1);
    setInstructions('');
    setQuizTitle('');
    setGeminiModel('gemini-3.8-flash');
    setResult(null);
    setError(null);
    try {
      window.localStorage.removeItem(draftStorageKey);
      setDraftStatus('Default settings restored');
      setDraftFailed(false);
    } catch {
      setDraftStatus('Draft could not be cleared');
      setDraftFailed(true);
    }
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
        quizTitle: quizTitle.trim() || fallbackTitle,
        geminiModel,
      });
      setResult(response);
      void queryClient.invalidateQueries({ queryKey: ['problemSets', identity] });
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
  const canGenerate = Boolean(me && (usingOwnKey || me.ai.aiProvider === 'server'));

  const fallbackTitle = `${topics.length ? topics.map((topic) => topic.charAt(0).toUpperCase() + topic.slice(1)).join(', ') : 'Practice'} · ${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}`;
  const displayTitle = quizTitle.trim() || fallbackTitle;
  const estimatedMinutes = problemCount * ({ easy: 10, medium: 20, hard: 30 } as const)[difficulty];
  const titleInvalid = quizTitle.trim().length > 0 && quizTitle.trim().length < 3;

  /* The status bar reports what is actually true about this build: which engine will
   * run, what it was asked for, and where the request currently is. Nothing on this
   * line is decoration. */
  const buildState = busy ? 'run' : error ? 'error' : result ? 'ok' : 'idle';
  const buildText = busy
    ? `compiling ${problemCount} problem${problemCount === 1 ? '' : 's'}…`
    : error
      ? 'exit 1 · generation failed'
      : result
        ? `linked · ${result.count} problem${result.count === 1 ? '' : 's'}`
        : 'awaiting input';
  const providerLabel = settingsLoading
    ? 'checking provider'
    : usingOwnKey
      ? GEMINI_MODELS.find((model) => model.id === geminiModel)?.label ?? 'Gemini key'
      : canGenerate
        ? 'server model'
        : 'no provider';

  return (
    <section className="quiz-builder">
      <header className="quiz-builder-heading">
        <p className="bundle-eyebrow">{'/* practice setup */'}</p>
        <h1 className="type-display">New practice quiz</h1>
        <p className="type-lede measure">Pick what you want to practice. We’ll build a focused set of C problems.</p>
      </header>

      <div className="quiz-builder-layout">
        {/* ——— the form: three questions, each a group with its own head ——— */}
        <form
          id="quiz-builder-form"
          className="quiz-builder-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && canGenerate && !settingsLoading && topics.length > 0 && !titleInvalid) void generate();
          }}
        >
          <section className="quiz-form-section" aria-labelledby="quiz-name-label">
            <div className="quiz-field-heading">
              <label id="quiz-name-label" htmlFor="quizTitle" className="type-small font-[var(--weight-medium)]">Quiz name <span className="text-[var(--color-muted)]">Optional</span></label>
            </div>
            <input
              id="quizTitle"
              value={quizTitle}
              onChange={(event) => setQuizTitle(event.target.value)}
              maxLength={60}
              aria-invalid={titleInvalid}
              aria-describedby="quiz-title-message"
              placeholder="e.g. Week 5 recursion drills"
              className="field w-full"
            />
            <div className="quiz-field-heading" id="quiz-title-help">
              <span id="quiz-title-message" className={titleInvalid ? 'type-micro text-[var(--color-warn)]' : 'type-micro'}>{titleInvalid ? 'Use at least 3 characters, or leave the name blank.' : 'Leave blank to use an automatic name.'}</span>
              <span className="type-micro">{quizTitle.length}/60</span>
            </div>
          </section>

          <fieldset className="quiz-form-section">
            <legend className="sr-only">What should the quiz test?</legend>
            <div>
              <div className="quiz-field-heading"><span className="type-small font-[var(--weight-medium)]">Topics</span><span className="type-micro">{topics.length} of 6</span></div>
              <p className="type-micro">Choose at least one. Add up to six topics.</p>
            </div>
            <div className="quiz-topic-chips" role="group" aria-label="Selected topics">
              {topics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  className="quiz-topic-chip"
                  onClick={() => { setTopics((current) => current.filter((t) => t !== topic)); setTopicMessage(null); }}
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
                  maxLength={40}
                  value={topicInput}
                  onChange={(event) => { setTopicInput(event.target.value); setTopicMessage(null); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      addTopic(topicInput.replace(/,$/, ''));
                      setTopicInput('');
                    } else if (event.key === 'Backspace' && !topicInput && topics.length > 0) {
                      setTopics((current) => current.slice(0, -1));
                      setTopicMessage(null);
                    }
                  }}
                  onBlur={() => {
                    if (topicInput.trim()) {
                      addTopic(topicInput.replace(/,$/, ''));
                      setTopicInput('');
                    }
                  }}
                  placeholder="Add a topic · press Enter"
                  className="quiz-topic-input"
                />
              )}
            </div>
            {topicMessage ? <p role="status" className="type-small text-[var(--color-warn)]">{topicMessage}</p> : null}
            {topics.length < 6 ? (
              <div className="quiz-topic-suggestions" role="group" aria-label="Suggested topics">
                <span className="type-micro">Suggestions</span>
                {TOPIC_SUGGESTIONS.filter((topic) => !topics.includes(topic)).map((topic) => (
                  <button key={topic} type="button" className="quiz-suggestion" onClick={() => addTopic(topic)}>
                    <span aria-hidden="true">+</span> {topic}
                  </button>
                ))}
              </div>
            ) : <p className="type-micro">You’ve reached the six-topic limit.</p>}
          </fieldset>

          <fieldset className="quiz-form-section quiz-options-grid">
            <legend className="sr-only">How much, and at what level?</legend>
            <div className="flex flex-col gap-1">
              <label htmlFor="count" className="type-small font-[var(--weight-medium)]">
                Problems
              </label>
              <p className="type-micro">Choose how many to make.</p>
              <select
                id="count"
                value={problemCount}
                onChange={(event) => setProblemCount(Number(event.target.value))}
                className="field w-full"
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
              <p className="type-micro">Set the challenge level.</p>
              <select
                id="difficulty"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
                className="field w-full"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            {usingOwnKey && (
              <div className="quiz-model-field flex flex-col gap-1">
                <label htmlFor="model" className="type-small font-[var(--weight-medium)]">
                  Gemini model
                </label>
                <select
                  id="model"
                  value={geminiModel}
                  onChange={(event) => setGeminiModel(event.target.value)}
                  className="field w-full"
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

          <fieldset className="quiz-form-section">
            <legend className="sr-only">How do you want it done?</legend>
            <div className="flex flex-col gap-1">
              <label htmlFor="instructions" className="type-small font-[var(--weight-medium)]">
                Requests <span className="font-normal text-[var(--color-faint)]">— optional</span>
              </label>
              <p className="type-micro">
                Optional. Add a focus, constraint, or preferred problem style.
              </p>
            </div>
            <textarea
              id="instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={3}
              maxLength={400}
              placeholder="For example: use structs, avoid recursion, or use a real-world scenario."
              className="field w-full resize-y"
            />
            <div className="quiz-field-heading"><span className="type-micro">Suggestions</span>{/* No aria-live: this changes on every keystroke, so a polite region reads out
                "1/400", "2/400", "3/400" … for the whole sentence. The limit is still
                discoverable through the field's maxLength. */}
            <span className="num type-micro">{instructions.length}/400</span></div>
            <div className="quiz-request-ideas" role="group" aria-label="Request suggestions">
              {['Use a real-world scenario', 'Focus on edge cases', 'Avoid recursion', 'Add helpful hints'].map((idea) => (
                <button key={idea} type="button" className="quiz-suggestion" onClick={() => appendIdea(idea)} disabled={instructions.includes(idea) || instructions.length + idea.length + 2 > 400}>{idea}</button>
              ))}
            </div>
          </fieldset>
        </form>

        <aside className="quiz-builder-summary" aria-label="Quiz summary">
          <p className="type-micro">{'/* your quiz */'}</p>
          <h2 className={`quiz-summary-title ${quizTitle.trim() ? '' : 'quiz-summary-title--suggested'}`}>{displayTitle}</h2>
          <dl className="quiz-summary-meta">
            <div>
              <dt>Topics</dt>
              <dd>{topics.length ? topics.map((topic) => <span key={topic} className="quiz-summary-tag">{topic}</span>) : 'Choose a topic'}</dd>
            </div>
            <div><dt>Problems</dt><dd>{problemCount}</dd></div>
            <div><dt>Difficulty</dt><dd className="capitalize">{difficulty}</dd></div>
            <div><dt>Estimated time</dt><dd>About {estimatedMinutes} min</dd></div>
          </dl>
          {instructions.trim() ? <p className="quiz-summary-request">“{instructions.trim()}”</p> : null}
          <p className="quiz-provider-note" role="note">
            {settingsLoading ? 'Checking your generator…' : usingOwnKey
              ? `Using your ${GEMINI_MODELS.find((model) => model.id === geminiModel)?.label ?? 'Gemini'} key.`
              : me?.ai.aiProvider === 'server'
                ? <>Server provider when available, with curated exercises as a fallback. <Link to="/account" className="link">Add a Gemini key</Link>.</>
                : <>Choose a provider in <Link to="/account" className="link">account settings</Link> before generating.</>}
          </p>
          {/* The compile rail: while the request is in flight, a signal block sweeps it in
           * discrete steps. This is the machine working, so it is the stepped register. */}
          {busy ? <div className="a-scan my-2" aria-hidden="true" /> : null}
          <button
            type="submit"
            form="quiz-builder-form"
            className="btn btn-primary quiz-generate-button"
            disabled={busy || topics.length === 0 || !canGenerate || settingsLoading || titleInvalid}
          >
            {busy ? (
              // Four blocks lighting in sequence, not a rotating ring: a spinner is the most
              // diluted busy indicator there is and belongs to no particular product.
              <><span className="a-blocks" aria-hidden="true"><i /><i /><i /><i /></span>Generating {problemCount} problem{problemCount === 1 ? '' : 's'}…</>
            ) : !canGenerate ? 'Choose an AI provider' : `Generate ${problemCount} problem${problemCount === 1 ? '' : 's'}`}
          </button>
          {error ? (
            <div role="alert" className="quiz-generation-error a-diag">
              <p>{error}</p>
              <button type="button" className="link" disabled={!canGenerate || settingsLoading || busy || titleInvalid} onClick={() => void generate()}>Retry generation</button>
            </div>
          ) : null}
          {!topics.length ? <p className="type-micro text-[var(--color-warn)]">Add at least one topic to continue.</p> : null}
          {/* Announced only when a draft write actually failed. The routine pair —
           * "Saving draft…" then "Draft saved" — fires on every typing pause, so a live
           * region here reads the same two sentences out again and again for as long as
           * someone is writing. The routine state is visible text; only the failure is
           * worth interrupting for. */}
          <p className="quiz-draft-status a-toast" role={draftFailed ? 'status' : undefined}>
            <span className="quiz-draft-dot" aria-hidden="true" />
            {draftStatus}
          </p>
          <button type="button" className="quiz-reset-button" onClick={resetDraft}>Reset quiz settings</button>
        </aside>

        <p className="quiz-time-note">Time is a rough planning estimate; actual completion time varies by learner.</p>
      </div>

      {result && (
        <div className="surface a-compile flex flex-col gap-3 p-[var(--space-md)]" aria-live="polite">
          <h2 className="type-title">
            {result.count > 0 ? `${result.count} problem${result.count > 1 ? 's' : ''} ready` : 'Nothing generated'}
          </h2>
          {result.geminiError && <p role="status" className="type-small text-[var(--color-muted)]">Gemini fallback: {result.geminiError}</p>}
          {result.problems.some((problem) => !problem.verificationPassed) ? (
            <p role="status" className="type-small text-[var(--color-warn)]">One or more reference solutions did not pass automatic verification; review the exercises carefully before sharing them.</p>
          ) : null}
          {result.notes.map((note) => (
            <p key={note} className="type-small text-[var(--color-muted)]">
              {note}
            </p>
          ))}
          {/* The generated problems are a listing, so they get the listing's rail: numbered
           * rows, and a numbered row whose reference solution failed verification wears the
           * signal colour on its number, the way a compiler points at the line it rejected. */}
          <ul className="gutter">
            {result.problems.map((problem, index) => (
              <li
                key={problem.problemId}
                className="gutter-row a-line"
                data-flagged={!problem.verificationPassed}
                style={revealDelay(index)}
              >
                <span className="gutter-ln" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <div className="gutter-body flex flex-wrap items-center gap-2">
                  <Link to={`/problems/${problem.problemId}`} className="link">
                    {problem.title}
                  </Link>
                  <span className="num type-small text-[var(--color-muted)]">
                    {problem.difficulty}{problem.providerUsed ? ` · ${problem.providerUsed}` : ''}
                  </span>
                  <span className={problem.verificationPassed ? 'tag a-strike' : 'tag a-strike verdict-fail'}>
                    {problem.verificationPassed ? 'verified' : 'unverified'}
                  </span>
                </div>
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

      {/* What the builder knows, stated plainly along the bottom edge — the same register
       * as the gutter numbers above it. */}
      <div className="statusbar mt-[var(--space-xl)]">
        <span className="statusbar-item" data-strength="strong">generate.c</span>
        <span className="statusbar-item num">{problemCount} × {difficulty}</span>
        <span className="statusbar-item num hidden sm:inline">{topics.length} topic{topics.length === 1 ? '' : 's'}</span>
        <span className="statusbar-item hidden sm:inline">{providerLabel}</span>
        <span className="statusbar-spacer" />
        <span className="statusbar-state" data-state={buildState}>{buildText}</span>
      </div>
    </section>
  );
}
