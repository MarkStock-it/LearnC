import type { CSSProperties } from 'react';

/**
 * Entrance stagger.
 *
 * The whole interface animates in CSS only: `.reveal` in app.css owns the keyframes and
 * the timing, and this publishes each element's index as the `--i` custom property so the
 * delay cascades down the page.
 *
 * That is why there is no motion library in package.json. Nothing here is an interruptible
 * gesture — the only things that move are a page entrance, a disclosure, a press, and a
 * score bar — so springs would have been machinery with no job, and every JS animation
 * path would have been a second place to remember `prefers-reduced-motion`.
 */
export function revealDelay(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}
