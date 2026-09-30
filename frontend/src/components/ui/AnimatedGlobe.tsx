/**
 * A theme-colored, hand-built SVG globe. The sphere's longitudes gently compress
 * and reopen to suggest slow axial rotation; tiny orbits travel around it at
 * independent speeds. SVG only — no raster artwork or 3D dependency.
 */
import { useId } from 'react';

export function AnimatedGlobe({ className = '' }: { className?: string }) {
  const rawId = useId().replace(/:/g, '');
  const ids = {
    fill: `globe-fill-${rawId}`,
    tailA: `orbit-tail-a-${rawId}`,
    tailB: `orbit-tail-b-${rawId}`,
    tailC: `orbit-tail-c-${rawId}`,
    clip: `globe-clip-${rawId}`,
    glow: `satellite-glow-${rawId}`,
  };

  return (
    <svg
      viewBox="0 0 480 480"
      role="img"
      aria-label="An animated wireframe globe with orbiting satellites"
      className={className}
      fill="none"
    >
      <defs>
        <radialGradient id={ids.fill} cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="var(--color-accent-quiet)" stopOpacity=".5" />
          <stop offset="1" stopColor="var(--color-surface-2)" stopOpacity=".08" />
        </radialGradient>
        <linearGradient id={ids.tailA} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity=".65" />
        </linearGradient>
        <linearGradient id={ids.tailB} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--color-pass)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--color-pass)" stopOpacity=".55" />
        </linearGradient>
        <linearGradient id={ids.tailC} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--color-warn)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--color-warn)" stopOpacity=".5" />
        </linearGradient>
        <clipPath id={ids.clip}>
          <circle cx="240" cy="240" r="137" />
        </clipPath>
        <filter id={ids.glow} x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Quiet sphere body and its fine outline. */}
      <circle cx="240" cy="240" r="137" fill={`url(#${ids.fill})`} stroke="var(--color-hairline)" strokeOpacity=".72" strokeWidth="1.2" />

      {/* Latitude curves are clipped to the spherical silhouette. */}
      <g clipPath={`url(#${ids.clip})`} stroke="var(--color-muted)" strokeOpacity=".36" strokeWidth="1">
        <ellipse cx="240" cy="240" rx="137" ry="33" />
        <ellipse cx="240" cy="240" rx="137" ry="72" />
        <ellipse cx="240" cy="240" rx="137" ry="106" />
        <path d="M103 240h274" strokeOpacity=".2" />
        <g className="globe-longitudes">
          <ellipse cx="240" cy="240" rx="34" ry="137" />
          <ellipse cx="240" cy="240" rx="78" ry="137" />
          <ellipse cx="240" cy="240" rx="112" ry="137" />
        </g>
      </g>

      {/* The orbit paths sit outside the sphere; the dots use SVG motion paths. */}
      <g className="globe-orbit globe-orbit-a" transform="rotate(-22 240 240)">
        <ellipse cx="240" cy="240" rx="194" ry="70" stroke="var(--color-accent)" strokeOpacity=".27" strokeWidth="1" />
        <path d="M54 240 C82 184 122 170 162 169" stroke={`url(#${ids.tailA})`} strokeWidth="2" strokeLinecap="round" />
        <circle r="2.2" fill="var(--color-accent)" fillOpacity=".2">
          <animateMotion dur="17s" begin="-0.55s" repeatCount="indefinite" path="M434 240 A194 70 0 1 1 46 240 A194 70 0 1 1 434 240" />
        </circle>
        <circle r="3.1" fill="var(--color-accent)" fillOpacity=".38">
          <animateMotion dur="17s" begin="-0.28s" repeatCount="indefinite" path="M434 240 A194 70 0 1 1 46 240 A194 70 0 1 1 434 240" />
        </circle>
        <circle r="4.5" fill="var(--color-accent)" filter={`url(#${ids.glow})`}>
          <animateMotion dur="17s" repeatCount="indefinite" path="M434 240 A194 70 0 1 1 46 240 A194 70 0 1 1 434 240" />
        </circle>
      </g>
      <g className="globe-orbit globe-orbit-b" transform="rotate(48 240 240)">
        <ellipse cx="240" cy="240" rx="178" ry="105" stroke="var(--color-pass)" strokeOpacity=".23" strokeWidth="1" />
        <path d="M72 240 C100 304 147 322 181 320" stroke={`url(#${ids.tailB})`} strokeWidth="1.8" strokeLinecap="round" />
        <circle r="1.8" fill="var(--color-pass)" fillOpacity=".18">
          <animateMotion dur="23s" begin="-7.62s" repeatCount="indefinite" path="M418 240 A178 105 0 1 1 62 240 A178 105 0 1 1 418 240" />
        </circle>
        <circle r="2.5" fill="var(--color-pass)" fillOpacity=".35">
          <animateMotion dur="23s" begin="-7.3s" repeatCount="indefinite" path="M418 240 A178 105 0 1 1 62 240 A178 105 0 1 1 418 240" />
        </circle>
        <circle r="3.6" fill="var(--color-pass)" filter={`url(#${ids.glow})`}>
          <animateMotion dur="23s" begin="-7s" repeatCount="indefinite" path="M418 240 A178 105 0 1 1 62 240 A178 105 0 1 1 418 240" />
        </circle>
      </g>
      <g className="globe-orbit globe-orbit-c" transform="rotate(76 240 240)">
        <ellipse cx="240" cy="240" rx="203" ry="45" stroke="var(--color-warn)" strokeOpacity=".18" strokeWidth="1" />
        <path d="M43 240 C80 209 111 199 145 198" stroke={`url(#${ids.tailC})`} strokeWidth="1.6" strokeLinecap="round" />
        <circle r="1.5" fill="var(--color-warn)" fillOpacity=".16">
          <animateMotion dur="29s" begin="-13.7s" repeatCount="indefinite" path="M443 240 A203 45 0 1 1 37 240 A203 45 0 1 1 443 240" />
        </circle>
        <circle r="2.1" fill="var(--color-warn)" fillOpacity=".32">
          <animateMotion dur="29s" begin="-13.35s" repeatCount="indefinite" path="M443 240 A203 45 0 1 1 37 240 A203 45 0 1 1 443 240" />
        </circle>
        <circle r="3" fill="var(--color-warn)" filter={`url(#${ids.glow})`}>
          <animateMotion dur="29s" begin="-13s" repeatCount="indefinite" path="M443 240 A203 45 0 1 1 37 240 A203 45 0 1 1 443 240" />
        </circle>
      </g>

      {/* A tiny axis glint adds depth without introducing a new color. */}
      <circle cx="197" cy="143" r="2.2" fill="var(--color-accent)" fillOpacity=".65" />
    </svg>
  );
}
