import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * The editor is part of the design system, not a separate product.
 *
 * Every value here is `var(--token)` rather than a resolved colour: CodeMirror writes
 * these into a stylesheet, so the variables resolve at paint time. That keeps one
 * source of truth (tokens.css), and the editor follows the user's explicit theme
 * preference — no JavaScript colour math, no drift.
 */
const UI_THEME = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--color-surface-2)',
    color: 'var(--color-ink)',
    fontSize: 'var(--text-small)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.65',
    letterSpacing: 'var(--tracking-mono)',
    /* Long lines scroll horizontally, so this scrollbar is part of the editor's look.
     * Without an explicit colour it keeps the embedding's default (light) chrome and
     * stands out badly against the dark well. */
    scrollbarColor: 'var(--color-hairline) transparent',
  },
  '.cm-content': { padding: 'var(--space-sm) 0', caretColor: 'var(--color-accent)' },
  '.cm-line': { padding: '0 var(--space-md)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--color-faint)',
    paddingInlineStart: 'var(--space-xs)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--color-accent-quiet) 55%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-muted)' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--color-accent-quiet)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--color-accent-quiet)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)', borderLeftWidth: '2px' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--color-accent-quiet)',
    outline: '1px solid var(--color-hairline)',
  },
  '.cm-line.cm-c-lint-error': {
    backgroundColor: 'color-mix(in oklab, var(--color-fail) 15%, transparent)',
    boxShadow: 'inset 3px 0 0 var(--color-fail)',
  },
  '.cm-line.cm-c-lint-warning': {
    backgroundColor: 'color-mix(in oklab, var(--color-warn) 14%, transparent)',
    boxShadow: 'inset 3px 0 0 var(--color-warn)',
  },
});

/**
 * The flag is the only thing that differs between schemes.
 *
 * Colours never branch in JavaScript — both modes apply the single UI_THEME above, and
 * `var(--token)` resolves against the user's selected theme in tokens.css. The flag only tells CodeMirror which of *its own* internal
 * defaults to use (scrollbars, selection fallbacks, `.cm-content` base colour), and it is
 * declared explicitly for both schemes so neither inherits a library default.
 */
const SCHEME_FLAG_DARK = EditorView.theme({}, { dark: true });
const SCHEME_FLAG_LIGHT = EditorView.theme({}, { dark: false });

const SYNTAX_THEME = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.modifier], color: 'var(--syntax-keyword)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syntax-type)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--syntax-function)' },
  { tag: [tags.definition(tags.variableName), tags.variableName], color: 'var(--syntax-variable)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--syntax-operator)' },
  { tag: tags.invalid, color: 'var(--color-fail)' },
]);

export const EDITOR_ACCESSIBILITY = EditorView.contentAttributes.of({
  'aria-label': 'C source editor',
  spellcheck: 'false',
  autocapitalize: 'off',
  autocomplete: 'off',
});

/** Theme + syntax + the accessibility content attributes. */
export function editorExtensions(dark: boolean) {
  return [
    dark ? SCHEME_FLAG_DARK : SCHEME_FLAG_LIGHT,
    UI_THEME,
    syntaxHighlighting(SYNTAX_THEME),
    EDITOR_ACCESSIBILITY,
  ];
}
