import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type MemoryTraceResponse, type MemoryTraceStep, type MemoryTraceVariable } from '../../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
  problemId: number;
  code: string;
  stdin: string;
}

function shortValue(value: string): string {
  if (value === '(nil)' || value === '0x0') return 'NULL';
  return value;
}

function valueText(variable: MemoryTraceVariable, step: MemoryTraceStep): string {
  if (!variable.pointer) return variable.value;
  const pointed = step.heap.some((block) => block.address === variable.value && !block.freed);
  if (shortValue(variable.value) === 'NULL') return '∅ NULL';
  return pointed ? variable.value : `${variable.value} · not heap`;
}

function TraceFrame({ frameName, variables, currentLine, step }: {
  frameName: string;
  variables: MemoryTraceVariable[];
  currentLine: number;
  step: MemoryTraceStep;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-2.5">
      <div className="mono mb-1 flex items-baseline gap-2 text-[var(--text-small)]">
        <span className="font-[var(--weight-strong)] text-[var(--color-accent)]">{frameName}</span>
        <span className="type-micro ms-auto">line {currentLine}</span>
      </div>
      {variables.map((variable) => (
        <div
          key={variable.id}
          data-anchor={variable.id}
          className={`grid grid-cols-[74px_1fr_auto] items-baseline gap-2.5 rounded-[5px] px-2 py-0.5 font-mono text-[var(--text-small)] ${variable.pointer ? 'text-[var(--color-accent)]' : ''}`}
        >
          <span className="type-micro">{variable.type}</span>
          <span className="text-[var(--color-ink-soft)]">{variable.name}</span>
          <span className="text-[var(--color-ink)]">{valueText(variable, step)}</span>
        </div>
      ))}
      {variables.length === 0 ? <p className="type-micro">No supported local variables at this step.</p> : null}
    </div>
  );
}

export function MemoryViz({ open, onClose, problemId, code, stdin }: Props) {
  const [trace, setTrace] = useState<MemoryTraceResponse | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const codeAtOpen = useRef('');

  const current = trace?.steps[Math.min(stepIndex, Math.max(0, trace.steps.length - 1))] ?? null;
  const frameGroups = useMemo(() => {
    if (!current) return [];
    const groups = new Map<number, MemoryTraceVariable[]>();
    for (const variable of current.variables) {
      const group = groups.get(variable.depth) ?? [];
      group.push(variable);
      groups.set(variable.depth, group);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b).map(([depth, variables]) => ({ depth, variables }));
  }, [current]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    codeAtOpen.current = code;
    setTrace(null);
    setTraceError(null);
    setStepIndex(0);
    setLoading(true);
    let cancelled = false;
    api.traceMemory(problemId, code, stdin)
      .then((result) => {
        if (cancelled) return;
        setTrace(result);
        setStepIndex(0);
      })
      .catch((error: unknown) => {
        if (!cancelled) setTraceError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, problemId, code, stdin]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') setStepIndex((index) => Math.min(index + 1, (trace?.steps.length ?? 1) - 1));
      if (event.key === 'ArrowLeft') setStepIndex((index) => Math.max(index - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, trace?.steps.length]);

  useEffect(() => {
    if (!playing || !trace?.steps.length) return;
    const timer = window.setInterval(() => {
      setStepIndex((index) => {
        if (index >= trace.steps.length - 1) {
          setPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [playing, trace?.steps.length]);

  useEffect(() => {
    if (!open) setPlaying(false);
  }, [open]);

  if (!open) return null;

  const steps = trace?.steps ?? [];
  const canPlay = steps.length > 1;
  const activeStep = current;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[oklch(20%_0.02_258_/_0.45)] p-4 backdrop-blur-[2px] sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Live memory trace: stack, heap and pointers"
        className="flex max-h-[min(90vh,860px)] w-full max-w-[1080px] flex-col overflow-hidden rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] shadow-[0_24px_64px_oklch(20%_0.02_258_/_0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-none items-baseline gap-3 border-b border-[var(--color-rule)] px-4 py-3 sm:px-6">
          <h2 className="type-micro font-[var(--weight-strong)] uppercase tracking-[0.09em] text-[var(--color-muted)]">Live memory</h2>
          <span className="mono type-micro truncate">{activeStep ? `line ${activeStep.line} · ${codeAtOpen.current.split('\n')[activeStep.line - 1]?.trim() ?? ''}` : 'Current draft'}</span>
          <button ref={closeRef} type="button" className="btn btn-quiet ms-auto px-3" onClick={onClose} aria-label="Close memory view">✕</button>
        </header>

        <div className="min-h-0 overflow-auto">
          <div className="grid min-h-[260px] grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] sm:px-6">
            <div data-region="stack" className="min-w-0">
              <h3 className="type-micro mb-2.5 mt-1.5 font-[var(--weight-strong)] uppercase tracking-[0.09em]">Stack · current local variables</h3>
              {loading ? <p className="type-small text-[var(--color-muted)]">Compiling and tracing the current draft…</p> : null}
              {traceError ? <p role="alert" className="type-small text-[var(--color-fail)]">Trace failed: {traceError}</p> : null}
              {!loading && !traceError && frameGroups.map(({ depth, variables }) => (
                <div key={depth} className={depth > 0 ? 'ms-3.5 mt-2' : 'mt-2'}>
                  <TraceFrame frameName={depth === 0 ? 'current function' : `nested scope ${depth}`} variables={variables} currentLine={activeStep?.line ?? 0} step={activeStep!} />
                </div>
              ))}
              {!loading && !traceError && !trace?.traceable ? (
                <p className="type-small text-[var(--color-muted)]">{trace?.message ?? 'No live trace is available yet.'}</p>
              ) : null}
              {trace?.stderr ? <pre className="mt-3 whitespace-pre-wrap text-[var(--text-micro)] text-[var(--color-fail)]">{trace.stderr}</pre> : null}
            </div>

            <div aria-hidden className="hidden sm:block" />

            <div data-region="heap" className="min-w-0">
              <h3 className="type-micro mb-2.5 mt-1.5 font-[var(--weight-strong)] uppercase tracking-[0.09em]">Heap · observed allocations</h3>
              {!activeStep || activeStep.heap.length === 0 ? (
                <p className="mono type-micro">— no tracked allocations —</p>
              ) : activeStep.heap.map((block) => (
                <div key={block.address} className={`mb-2.5 max-w-[340px] rounded-lg border px-3 py-2.5 ${block.freed ? 'border-dashed border-[var(--color-warn)] bg-[var(--color-paper)]' : 'border-[var(--color-rule)] bg-[var(--color-surface)]'}`}>
                  <div className="mono mb-1 flex items-baseline gap-2 text-[var(--text-small)]">
                    <span className="font-[var(--weight-strong)] text-[var(--color-ink)]">{block.address}</span>
                    <span className="type-micro">{block.type}</span>
                    {block.freed ? <span className="ms-auto type-micro text-[var(--color-warn)]">freed</span> : null}
                  </div>
                  <p className="type-micro">Allocation observed in the current trace.</p>
                </div>
              ))}
            </div>
          </div>

          <p className="px-4 pt-1 text-[var(--text-small)] text-[var(--color-ink-soft)] sm:px-6">
            {activeStep ? <><b className="font-[var(--weight-strong)] text-[var(--color-ink)]">step {stepIndex + 1} of {steps.length}</b> — runtime snapshot after source line {activeStep.line}.</> : loading ? 'Preparing a bounded, isolated trace run.' : trace?.message}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-rule)] px-4 pb-3.5 pt-3 sm:px-6">
            <button type="button" className="btn btn-quiet" onClick={() => { setPlaying(false); setStepIndex(0); }} disabled={!steps.length || stepIndex === 0}>⏮ restart</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setPlaying(false); setStepIndex((index) => Math.max(0, index - 1)); }} disabled={!steps.length || stepIndex === 0}>◀ prev</button>
            <button type="button" className="btn btn-quiet" onClick={() => setPlaying((value) => !value)} disabled={!canPlay}>{playing ? '⏸ pause' : '▶ play'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setPlaying(false); setStepIndex((index) => Math.min(steps.length - 1, index + 1)); }} disabled={!steps.length || stepIndex >= steps.length - 1}>next ▶</button>
            <span className="mono num type-micro">step <b className="text-[var(--color-ink)]">{steps.length ? stepIndex + 1 : 0}</b> / {steps.length}</span>
            <input type="range" className="ms-auto min-w-24 flex-1 accent-[var(--color-accent)]" min={0} max={Math.max(0, steps.length - 1)} value={Math.min(stepIndex, Math.max(0, steps.length - 1))} onChange={(event) => { setPlaying(false); setStepIndex(Number(event.target.value)); }} aria-label="Scrub through live memory snapshots" disabled={!steps.length} />
          </div>
        </div>
        <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-rule)] px-4 py-3 sm:px-6">
          <span className="type-micro flex items-baseline gap-2"><span className="inline-block h-0 w-[22px] border-t-2 border-[var(--color-accent)]" /> current draft trace</span>
          <span className="type-micro flex items-baseline gap-2"><span className="inline-block h-0 w-[22px] border-t-2 border-[var(--color-pass)]" /> observed heap allocation</span>
          <span className="type-micro ms-auto">Sandboxed sample input: {stdin.trim() ? `${stdin.trim().slice(0, 56)}${stdin.trim().length > 56 ? '…' : ''}` : '(empty)'}</span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
