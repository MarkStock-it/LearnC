---
name: ui-verification
description: How to actually verify a web UI change instead of assuming it worked — reading computed styles rather than intentions, auditing contrast against the real effective background, noticing when a preview or compositor is lying to you, and catching a dependency's default styles overriding your design tokens. Use this skill whenever you change CSS, add or upgrade a component library, restyle a surface, audit a frontend for accessibility or visual defects, or are about to say a UI "looks right" or "is fixed". Also use it when a visual bug is reported that you cannot reproduce from the DOM, when a screenshot and the DOM disagree, or when an element seems present but wrong.
---

# Verifying a UI change

The DOM is the source of truth for *structure and computed style*. It is **not** a source
of truth for *what the user sees*, because what the user sees also depends on paint and
compositing — and those can be broken while the DOM looks perfect. Almost every mistake
this skill prevents comes from confusing one of those for the other.

Read a claim as a hierarchy of strength, weakest first:

| Evidence | Tells you | Does **not** tell you |
|---|---|---|
| The code you wrote | intent | anything about the result |
| A typecheck / build | it compiles | that it renders |
| The accessibility tree | structure, labels, order | colours, opacity, overlap |
| `getComputedStyle` | the resolved values | whether those values are painted |
| A screenshot | what was on screen *at that instant* | whether the frame is current |
| A measured number you can state | what actually happened | — if the measurement is sound |

Prefer the strongest evidence available, and know which one you are holding.

## Trap 1: a stalled compositor freezes every animation

This one is easy to miss because nothing errors. If the embedding is not compositing,
`document.timeline.currentTime` stays pinned at `0` and **every** animation and
transition in the page sits at progress 0 forever. Elements with an entrance animation
stay invisible. Check it before you trust any visual reading:

```js
document.timeline.currentTime   // 0 (or a value that never changes) → the timeline is frozen
element.getAnimations().map(a => ({
  name: a.animationName, state: a.playState, time: a.currentTime,
  progress: a.effect?.getComputedTiming().progress,
}))
// playState "running" with progress 0 forever is the signature
```

Symptoms that look like different bugs but are this one: screenshots that report
"produced no frames"; screenshots that return the *same* image after you scroll; a panel
that is `opacity: 0` in computed style yet obviously fine in the code; `@starting-style`
or a keyframe animation that "doesn't work" no matter how many times you rewrite it.

**Do not chase this in CSS.** It is the environment. Instead, neutralise time-based CSS
and audit the resting state, which is what actually matters:

```js
const s = document.createElement('style');
s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
document.head.appendChild(s);
```

Now measure. A page that renders correctly with animations off is correctly built; a page
that goes blank has a real defect (see "fail visible" below). Remove the injected style
before drawing conclusions about motion.

## Trap 2: audits that pass on invisible elements

`getBoundingClientRect()`, contrast maths, overflow checks and `innerText` **all ignore
opacity**. So a whole-page audit can report "no contrast failures" on a page that is
entirely invisible. Always include an explicit visibility sweep:

```js
[...document.querySelectorAll('*')]
  .filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height; })
  .filter(el => parseFloat(getComputedStyle(el).opacity) < 0.99)
  .map(el => el.tagName + '.' + el.className + ' opacity=' + getComputedStyle(el).opacity)
```

Empty result = nothing is hidden. Anything listed is either a legitimate fade or the bug.

## Trap 3: contrast measured against the wrong background

`color` and `background-color` are rarely on the same element. Resolve the **effective**
background by walking ancestors until you find an opaque one, then compute the ratio.
Measuring the pair from the two declarations you happen to remember is how "it looks fine"
turns into an unreadable card:

```js
const parse = c => { /* paint c into a 1×1 canvas, read the RGBA back */ };
const lum = px => { /* WCAG relative luminance from sRGB */ };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const effBg = el => {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const bg = parse(getComputedStyle(n).backgroundColor);
    if (bg.a > 0.95) return bg;
  }
  return parse(getComputedStyle(document.body).backgroundColor);
};
// then: body text ≥ 4.5:1; ≥24px regular or ≥18.66px bold, icons and focus rings ≥ 3:1
```

Do this for every element with direct text, not just the ones you touched. A colour change
on one token can break a pairing three components away.

## Trap 4: a dependency's default theme overriding your tokens

The most expensive bug class here, because a CSS search misses it. A component library
applied its own default (`backgroundColor: '#fff'`) scoped to **generated class names**
(`ͼ1i`), so the element was white while its text was near-white — and grepping the
stylesheet for `.cm-editor` background rules returned nothing at all.

Symptoms: an element's computed colour is correct everywhere *except* one property; the
library's styles win despite your extension being registered later; the wrapper carries a
class like `cm-theme-light` you never asked for.

Method: read the installed source rather than the docs.

```bash
grep -rnE "theme ===|defaultTheme|cm-theme|oneDark" node_modules/<pkg>/esm/*.js
sed -n '15,60p' node_modules/<pkg>/esm/getDefaultExtensions.js
grep -o "@starting-style\|\.your-class{[^}]*}" dist/assets/*.css   # how the build really emitted it
```

Look for the library's supported opt-out (this one exposed `theme="none"`) rather than
fighting it with `!important`. Then confirm by computed style, and state the old and new
values.

## Fail visible

Every state a user must be able to read has to survive the effect that decorates it
failing. Two consequences that have already bitten this codebase:

- An entrance animation declares its **hidden** frame in the keyframes and uses
  `animation-fill-mode: backwards`, so the element's own resting style is the visible one.
  Never `opacity: 0` in the rule plus `forwards`.
- Content that *encodes data* (a bar whose length is the value) must not depend on an
  animation: a stalled fill reads as "zero passed" and misreports.

Verify it directly by disabling animations and re-auditing visibility, as above. "It
renders with animations off" is the test.

## Reproduce before and after

A fix is only verified if you can show the original failure and its absence. Capture the
broken value first — `rgb(255, 255, 255)` for the editor background, `opacity: 0` for the
panel, `1e-05s` where you expected 150ms — then the corrected one. Report both numbers. If
you cannot reproduce the failure, you have not verified the fix; you have only observed
that things currently look fine.

## Check the contract, not just the code

A UI change can pass every visual test and still be wrong because the client and server
disagree. Run the project's typecheck after any API-shape edit, and grep for the field you
renamed. In this project a `label` that had been carrying a description is exactly the
kind of drift that typecheck catches and eyes do not.

## Reporting

State the number you measured and the method, or say plainly that you could not measure
it. "Contrast is 17.18:1, measured against the editor's effective background" is
verifiable; "the editor looks fine now" is not. When the environment prevented
verification — a stalled compositor, an OS-level reduced-motion setting you cannot flip —
say so explicitly and name what remains unproven. An honest gap is worth far more than a
confident claim that quietly rests on nothing.
