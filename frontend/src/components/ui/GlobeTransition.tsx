import { AnimatedGlobe } from './AnimatedGlobe';

/** Persistent overlay so the success transition survives the landing state change. */
export function GlobeTransition({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="globe-transition" aria-label="Opening C Practice" role="status">
      <AnimatedGlobe className="globe-transition-art" />
      <span className="sr-only">Opening your workspace…</span>
    </div>
  );
}
