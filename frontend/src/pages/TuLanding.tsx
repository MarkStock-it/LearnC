import { useEffect, useRef, useState } from 'react';
import { ApiError, api, signOut as clearSession } from '../services/api';
import { setGuestMode } from '../lib/guestMode';
import '../styles/tu-landing.css';

/**
 * First-visit sign-in, rebuilt as a C translation unit.
 *
 * The concept: this page is the file `learnc.c`. The sign-in form is the body of
 * `int main(void)` — the only function that runs. Credentials are declared the
 * way C declares them (`char pass[64]`), the primary action is the `sign_in`
 * call itself, and a rejected sign-in is reported the way a compiler reports a
 * mistake: `learnc.c:13:11: error: …` on the failing line.
 *
 * The file is monochrome. There is no syntax highlighting, because the only
 * colour on a printed listing is the ink of whoever marked it up — and here that
 * ink is vermilion, spent on exactly two things: a diagnostic, and the one
 * button that runs the program.
 *
 * Auth, guest entry and the transition into the app keep the same contract as
 * the previous landing page, so this drops in without touching App or the API.
 */

type Mode = 'sign_in' | 'register';
type BuildState = 'idle' | 'compiling' | 'ok' | 'error';
type Field = 'user' | 'pass';

interface LogLine {
  kind: 'prompt' | 'out' | 'fail';
  text: string;
}

/** The declaration each field is written as, and where its name starts. */
const DECLS: Record<Field, { source: string; name: string; line: number }> = {
  user: { source: '    char  user[32]', name: 'user', line: 12 },
  pass: { source: '    char  pass[64]', name: 'pass', line: 13 },
};

const OPENING_LOG: LogLine[] = [
  { kind: 'prompt', text: '$ gcc -std=c99 -Wall -Wextra reverse.c -o reverse' },
  { kind: 'prompt', text: '$ ./reverse < hidden/07.txt' },
  { kind: 'fail', text: '  case 08/12  expected  1 4 9 16 25' },
  { kind: 'fail', text: '               got      0 0 0 0 0' },
  { kind: 'prompt', text: '$ ./reverse < hidden/07.txt' },
  { kind: 'out', text: '  case 12/12  exit 0' },
];

export function TuLanding({ onEnterApp }: { onEnterApp?: () => void }) {
  const [mode, setMode] = useState<Mode>('sign_in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [build, setBuild] = useState<BuildState>('idle');
  const [diagnostic, setDiagnostic] = useState<{ line: number; message: string } | null>(null);
  const [field, setField] = useState<Field>('user');
  const [log, setLog] = useState<LogLine[]>(OPENING_LOG);

  const logRef = useRef<HTMLParagraphElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const leavingRef = useRef(false);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  // The build log is a terminal pane: it stays pinned to the newest output.
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log]);

  /** Whichever line the writer's position sits on: the mistake, or the cursor. */
  const activeLine = diagnostic?.line ?? DECLS[field].line;
  const call = mode === 'sign_in' ? 'sign_in' : 'register';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setBuild('compiling');
    setDiagnostic(null);
    setLog((lines) => [...lines, { kind: 'prompt', text: `$ ./learnc --student=${username || '…'}` }]);

    try {
      if (mode === 'sign_in') await api.login(username, password);
      else await api.register(username, password);

      setBuild('ok');
      setLog((lines) => [...lines, { kind: 'out', text: `  linked  ·  signed in as ${username}` }]);
      leavingRef.current = true;
      timerRef.current = window.setTimeout(() => onEnterApp?.(), 620);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
      // A compiler points at the token it could not accept. Usernames are the
      // token when one is rejected outright; otherwise it is the password.
      const blamed: Field = /user|name|taken|exist/i.test(message) ? 'user' : 'pass';
      const decl = DECLS[blamed];

      setField(blamed);
      setBuild('error');
      setDiagnostic({ line: decl.line, message });
      setLog((lines) => [
        ...lines,
        { kind: 'fail', text: `  ${decl.source} = ${blamed === 'pass' ? '········' : `"${username}"`};` },
        { kind: 'fail', text: `  ${' '.repeat(decl.source.indexOf(decl.name))}${'^'.repeat(decl.name.length)}` },
        { kind: 'fail', text: `learnc.c:${decl.line}:${decl.source.indexOf(decl.name) + 1}: error: ${message}` },
      ]);
      setBusy(false);
    }
  };

  const continueAsGuest = () => {
    if (busy) return;
    clearSession();
    setGuestMode(true);
    setBusy(true);
    setBuild('ok');
    setLog((lines) => [...lines, { kind: 'out', text: '  guest session  ·  no account, work still saves' }]);
    leavingRef.current = true;
    timerRef.current = window.setTimeout(() => onEnterApp?.(), 500);
  };

  const switchMode = () => {
    if (busy) return;
    setMode((current) => (current === 'sign_in' ? 'register' : 'sign_in'));
    setDiagnostic(null);
    setBuild('idle');
  };

  const stateText = (() => {
    if (build === 'compiling') return { text: 'compiling…', state: 'run' as const };
    if (build === 'ok') return { text: 'linked · exit 0', state: 'ok' as const };
    if (build === 'error') return { text: 'exit 1 · 1 diagnostic', state: 'error' as const };
    return { text: `Ln ${activeLine} · awaiting input`, state: 'idle' as const };
  })();

  const row = (ln: number, body: React.ReactNode) => (
    <div className="tu-row" data-ln={ln} data-active={ln === activeLine}>
      <span className="tu-ln">{ln}</span>
      <div className="tu-body">{body}</div>
    </div>
  );

  return (
    <div className="tu">
      <section className="tu-file" aria-label="Sign in to LearnC">
        <form className="tu-code" onSubmit={submit}>
          {row(1, <span className="tu-code-text"><span className="tu-cmt">/* </span>learnc.c<span className="tu-cmt"> — where the C actually gets written</span></span>)}
          {row(2, <h1 className="tu-h1">You will segfault.</h1>)}
          {row(3, <p className="tu-h1">Then you will not.</p>)}
          <div className="tu-row tu-empty" data-ln={4}>
            <span className="tu-ln">4</span>
            <div className="tu-body" />
          </div>
          {row(5, <span className="tu-code-text tu-cmt">   47 exam-style problems · C99 · graded one test case at a time</span>)}
          {row(6, <span className="tu-code-text tu-cmt">*/</span>)}
          <div className="tu-row tu-empty" data-ln={7}>
            <span className="tu-ln">7</span>
            <div className="tu-body" />
          </div>
          {row(8, <span className="tu-code-text tu-cmt">#include &lt;stdio.h&gt;</span>)}
          {row(9, <span className="tu-code-text tu-cmt">#include &lt;learnc.h&gt;</span>)}
          <div className="tu-row tu-empty" data-ln={10}>
            <span className="tu-ln">10</span>
            <div className="tu-body" />
          </div>
          {row(11, <span className="tu-code-text">int main(void) {'{'}</span>)}

          {row(
            12,
            <>
              <label className="tu-decl" htmlFor="tu-user">
                {'    char  user[32] ='}
              </label>
              <span className="tu-value">
                <input
                  id="tu-user"
                  className="tu-input"
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  onFocus={() => setField('user')}
                  placeholder="your username"
                  aria-label="Username"
                  aria-invalid={diagnostic?.line === 12}
                  autoComplete="username"
                  required
                  minLength={3}
                />
                <span className="tu-code-text">;</span>
                <span className="tu-caret" hidden={field !== 'user'} aria-hidden="true" />
              </span>
            </>,
          )}

          {row(
            13,
            <>
              <label className="tu-decl" htmlFor="tu-pass">
                {'    char  pass[64] ='}
              </label>
              <span className="tu-value">
                <input
                  id="tu-pass"
                  className="tu-input"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onFocus={() => setField('pass')}
                  placeholder="your password"
                  aria-label="Password"
                  aria-invalid={diagnostic?.line === 13}
                  autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
                  required
                  minLength={8}
                />
                <span className="tu-code-text">;</span>
                <span className="tu-caret" hidden={field !== 'pass'} aria-hidden="true" />
              </span>
            </>,
          )}

          {row(
            14,
            <>
              <span className="tu-code-text tu-term">
                {'    if ('}
                <strong>{call}</strong>
                {'(user, pass) != 0)'}
              </span>
              <span className="tu-tail">
                <button type="submit" className="tu-run" disabled={busy}>
                  {busy ? 'running…' : mode === 'sign_in' ? 'sign in' : 'register'}
                </button>
              </span>
            </>,
          )}

          {row(
            15,
            <>
              <span className="tu-code-text tu-term">{'        return 1;'}</span>
              <span className="tu-tail">
                {diagnostic ? (
                  <span className="tu-diag" role="alert">
                    {`learnc.c:${diagnostic.line}:11: error: ${diagnostic.message}`}
                  </span>
                ) : (
                  <span className="tu-code-text tu-cmt">{'/* nothing to report */'}</span>
                )}
              </span>
            </>,
          )}

          {row(
            16,
            <>
              <span className="tu-code-text tu-term">{'    return enter_workbench();'}</span>
              <span className="tu-tail">
                <button type="button" className="tu-quiet" onClick={continueAsGuest} disabled={busy}>
                  or run as guest
                </button>
              </span>
            </>,
          )}

          {row(17, <span className="tu-code-text">{'}'}</span>)}

          {/* The status bar is visual; this carries the same state to screen readers. */}
          <p className="tu-sr" role="status">
            {build === 'compiling' ? 'Running.' : ''}
            {build === 'ok' ? 'Linked, exit 0. Entering the workbench.' : ''}
            {build === 'error' ? 'Exit 1. One diagnostic, shown above.' : ''}
          </p>
        </form>
      </section>

      <aside className="tu-margin">
        <p className="tu-note">
          Graded the way the exam grades: one test case at a time, in the compiler's own words.
        </p>

        <div className="tu-log">
          <div className="tu-log-head">/* build log */</div>
          <p className="tu-log-body" ref={logRef}>
            {log.map((line, index) => (
              <span key={index} className="tu-log-line" data-kind={line.kind}>
                {line.text}
              </span>
            ))}
          </p>
        </div>

        <div className="tu-log-backlog">
          <p className="tu-log-question">
            {mode === 'sign_in' ? '/* first time here? */' : '/* already have one? */'}
          </p>
          <button type="button" className="tu-link" onClick={switchMode} disabled={busy}>
            {mode === 'sign_in' ? 'create an account' : 'sign in instead'}
          </button>
        </div>
      </aside>

      <div className="tu-status">
        <span className="tu-status-item" data-strength="strong">learnc.c</span>
        <span className="tu-status-item tu-hide-narrow">C99</span>
        <span className="tu-status-item tu-hide-narrow">-Wall -Wextra</span>
        <span className="tu-status-spacer" />
        <span className="tu-status-item tu-hide-narrow">sandbox: unshare</span>
        <span className="tu-status-state" data-state={stateText.state}>{stateText.text}</span>
      </div>
    </div>
  );
}
