import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { editorExtensions } from './editorTheme';
import { usePreferredScheme } from '../../lib/usePreferredScheme';

interface Props {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

/**
 * Monaco is the original plan's first choice; CodeMirror 6 gives the same C syntax
 * highlighting with no Vite worker plumbing and no second theme to keep in sync —
 * it reads this project's own tokens (see editorTheme.ts).
 *
 * `theme="none"` is load-bearing, not cosmetic. @uiw/react-codemirror defaults `theme`
 * to 'light' and pushes its own `defaultLightThemeOption` — a hard-coded white
 * background on .cm-editor — in front of the extensions below. On a dark palette that
 * painted near-white text on white, and it also stamped `cm-theme-light` on the wrapper
 * (which is what a screen reader or a scrollbar reads its colour scheme from). 'none'
 * is the library's supported opt-out: it contributes no theme, so every colour comes
 * from tokens.css. Passing 'dark' instead would swap one built-in theme (oneDark) for
 * another and reopen the same drift.
 */
export function CodeEditor({ value, onChange, readOnly = false, height = '100%' }: Props) {
  const scheme = usePreferredScheme();
  const extensions = useMemo(() => [cpp(), ...editorExtensions(scheme === 'dark')], [scheme]);

  return (
    <CodeMirror
      value={value}
      height={height}
      readOnly={readOnly}
      theme="none"
      /* The component wraps the editor in its own div and hangs `.cm-editor` off that
       * wrapper at `height: 100%`. Left at content height, the wrapper collapses to the
       * number of lines, so a short program floats a ~230px band of bare sheet under the
       * code well. `h-full` lets the editor own its whole pane. */
      className="h-full"
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        foldGutter: false,
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: true,
        tabSize: 4,
      }}
    />
  );
}
