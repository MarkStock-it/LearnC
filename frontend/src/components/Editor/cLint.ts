import { linter, type Diagnostic } from '@codemirror/lint';
import { lintC } from '../../lib/cLinter';

/**
 * Bridge between the project's own C linter and CodeMirror's lint panel machinery:
 * our diagnostics land as wavy underlines + gutter marks on the exact line, which is
 * gcc's underline feel from the workbench concept without re-theming anything.
 */
export const cLintExtension = linter((view) => {
  const source = view.state.doc.toString();
  return lintC(source).map<Diagnostic>((problem) => ({
    from: 0,
    to: Math.min(view.state.doc.line(problem.line).to, view.state.doc.length),
    severity: 'error',
    message: `${problem.message} — ${problem.fix}`,
  }));
});
