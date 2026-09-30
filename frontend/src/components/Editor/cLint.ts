import { Decoration, type DecorationSet, ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { lintC } from '../../lib/cLinter';

function lintDecorations(view: EditorView): DecorationSet {
  const decorations = lintC(view.state.doc.toString()).map((problem) => {
    const line = view.state.doc.line(problem.line);
    const message = `${problem.message} — ${problem.fix}`;
    return Decoration.line({
      class: `cm-c-lint-${problem.severity}`,
      attributes: { title: message, 'aria-label': `${problem.severity}: ${message}` },
    }).range(line.from);
  });
  return Decoration.set(decorations, true);
}

/** Show concise, severity-colored line feedback without CodeMirror's squiggly markers. */
export const cLintExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = lintDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = lintDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
