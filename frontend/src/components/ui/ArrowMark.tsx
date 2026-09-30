export function ArrowMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M3.5 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
