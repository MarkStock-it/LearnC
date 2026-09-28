import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The memory drawer from the concept, ported to React and kept a canned, honest
 * teaching view: the sandbox does not record a real execution trace, so this modal
 * walks a recorded linked-list build-and-leak trace (the concept's exact lesson) with
 * the same transport: step, scrub, play. It is labelled as a walkthrough, not live
 * state of the student's program.
 */

interface MemVar {
  id: string;
  type: string;
  name: string;
  ptr: boolean;
  value: string | number;
  target: string | null;
  uninit?: boolean;
}

interface MemFrame {
  name: string;
  args: string;
  vars: MemVar[];
  kids: MemFrame[];
  num?: number;
}

interface MemBlock {
  id: string;
  addr: string;
  type: string;
  leaked?: boolean;
  fields: MemVar[];
}

interface MemStep {
  line: number;
  note: string;
  flash: string[];
  frames: MemFrame[];
  blocks: MemBlock[];
}

const ADDR: Record<string, string> = { A: '0x7f3a2010', B: '0x7f3a2030', C: '0x7f3a2050' };

const SRC = [
  '#include <stdio.h>',
  '#include <stdlib.h>',
  '',
  'typedef struct Node {',
  '    int val;',
  '    struct Node *next;',
  '} Node;',
  '',
  'Node *make_node(int v) {',
  '    Node *n = malloc(sizeof *n);',
  '    n->val = v;',
  '    n->next = NULL;',
  '    return n;',
  '}',
  '',
  'int main(void) {',
  '    Node *head = NULL;',
  '    head = make_node(3);',
  '    head->next = make_node(2);',
  '    head = make_node(9);  /* oops — the old list leaks */',
  '    return 0;',
  '',
];

const F = (name: string, args: string, vars: MemVar[], kids: MemFrame[] = []): MemFrame => ({ name, args, vars, kids });
const V = (
  id: string,
  type: string,
  name: string,
  ptr: boolean,
  value: string | number,
  target: string | null = null,
  uninit = false,
): MemVar => ({ id, type, name, ptr, value, target, uninit });
const BLK = (id: string, val: number | null, next: string): MemBlock => ({
  id,
  addr: ADDR[id],
  type: 'Node',
  fields: [
    { id: `${id}.val`, type: 'int', name: 'val', ptr: false, value: val === null ? '?' : val, target: null, uninit: val === null },
    {
      id: `${id}.next`,
      type: 'Node *',
      name: 'next',
      ptr: true,
      value: next === 'null' ? 'null' : next,
      target: next === 'null' ? null : next,
    },
  ],
});

function buildSteps(): MemStep[] {
  const steps: MemStep[] = [];
  let S: { frames: MemFrame[]; blocks: MemBlock[] };
  const snap = (note: string, line: number, flash: string[] = []) => {
    const copy = (o: unknown) => JSON.parse(JSON.stringify(o)) as typeof S;
    let n = 0;
    const num = (fs: MemFrame[]) => fs.forEach((f) => { f.num = n++; num(f.kids); });
    const frames = copy(S).frames;
    num(frames);
    steps.push({ note, line, flash, frames, blocks: copy(S).blocks });
  };

  S = { frames: [F('main', '(void)', [V('head', 'Node *', 'head', true, 'null')])], blocks: [] };
  snap('Node *head = NULL — head exists but points at nothing. The ∅ stub makes that visible.', 17);

  S.frames[0].kids = [F('make_node', '(3)', [V('v', 'int', 'v', false, 3), V('n', 'Node *', 'n', true, 0, null, true)])];
  snap('make_node(3) is called — its frame nests inside main. n is not yet initialised: ?', 18);

  S.blocks = [BLK('A', null, 'null')];
  S.frames[0].kids[0].vars[1] = V('n', 'Node *', 'n', true, ADDR.A, 'A');
  snap('malloc hands back 0x7f3a2010. The block’s fields are garbage — val shows ?, not a fake 0.', 10, ['n']);

  S.blocks[0].fields[0] = V('A.val', 'int', 'val', false, 3);
  snap('n->val = v writes through the pointer — the block’s first field is filled.', 11, ['A.val']);

  S.blocks[0].fields[1] = V('A.next', 'Node *', 'next', true, 'null');
  snap('n->next = NULL — a one-node list so far. NULL is a value worth seeing, not hiding.', 12, ['A.next']);

  S.frames[0].kids = [];
  S.frames[0].vars[0] = V('head', 'Node *', 'head', true, ADDR.A, 'A');
  snap('make_node returns and its frame is gone — not greyed, gone. The return value lands in head.', 13, ['head']);

  S.frames[0].kids = [F('make_node', '(2)', [V('v', 'int', 'v', false, 2), V('n', 'Node *', 'n', true, 0, null, true)])];
  snap('head->next = make_node(2): the call nests again, one lifetime inside another.', 19);

  S.blocks.push(BLK('B', null, 'null'));
  S.frames[0].kids[0].vars[1] = V('n', 'Node *', 'n', true, ADDR.B, 'B');
  snap('a second malloc — 0x7f3a2030 sits above the first block, address order preserved.', 10, ['n']);

  S.blocks[1].fields[0] = V('B.val', 'int', 'val', false, 2);
  snap('n->val = 2 fills the new node.', 11, ['B.val']);

  S.blocks[1].fields[1] = V('B.next', 'Node *', 'next', true, 'null');
  snap('n->next = NULL — this node will be the tail.', 12, ['B.next']);

  S.frames[0].kids = [];
  S.blocks[0].fields[1] = V('A.next', 'Node *', 'next', true, ADDR.B, 'B');
  snap('the frame pops; head->next is the return value. The green heap→heap arrow is the list itself.', 19, ['A.next']);

  S.frames[0].kids = [F('make_node', '(9)', [V('v', 'int', 'v', false, 9), V('n', 'Node *', 'n', true, ADDR.C, 'C')])];
  S.blocks.push(BLK('C', null, 'null'));
  snap('head = make_node(9): a third node is allocated — but watch what this line is about to do to head.', 20, ['n']);

  S.frames[0].kids = [];
  S.frames[0].vars[0] = V('head', 'Node *', 'head', true, ADDR.C, 'C');
  S.blocks[0].leaked = true;
  S.blocks[1].leaked = true;
  snap('head is rewired to the new node — and the old two-node list is now unreachable. Dashed borders, leaked? tags: nothing points at them any more.', 20, ['head']);

  return steps;
}

const STEPS = buildSteps();

function maxFrameNum(frames: MemFrame[]): number {
  let m = 0;
  const walk = (fs: MemFrame[]) => fs.forEach((f) => { m = Math.max(m, f.num ?? 0); walk(f.kids); });
  walk(frames);
  return m;
}

function ValueRow({ v, flash }: { v: MemVar; flash: boolean }) {
  const cls = ['num mono text-[var(--text-small)] grid grid-cols-[74px_1fr_auto] gap-2.5 items-baseline rounded-[5px] px-2 py-0.5'];
  if (v.ptr) cls.push('text-[var(--color-accent)] font-[var(--weight-medium)]');
  return (
    <div
      className={`${cls.join(' ')} ${flash ? 'mem-flash' : ''}`}
      {...(v.ptr ? { 'data-anchor': v.id } : {})}
    >
      <span className="type-micro">{v.type}</span>
      <span className="text-[var(--color-ink-soft)]">{v.name}</span>
      {v.uninit ? (
        <span className="text-[var(--color-faint)] italic">?</span>
      ) : v.ptr && v.value === 'null' ? (
        <span className="text-[var(--color-faint)]">∅ NULL</span>
      ) : (
        <span className="text-[var(--color-ink)]">{String(v.value)}</span>
      )}
    </div>
  );
}

function Frame({ frame, cur, flashSet }: { frame: MemFrame & { num?: number }; cur: number; flashSet: Set<string> }) {
  const isCur = frame.num === cur;
  return (
    <div
      className={`rounded-lg border bg-[var(--color-paper)] px-3 py-2.5 ${isCur ? 'border-s-[3px] border-s-[var(--color-accent)] bg-[var(--color-surface)]' : 'border-[var(--color-rule)]'}`}
    >
      <div className="mono mb-1 flex items-baseline gap-2 text-[var(--text-small)]">
        <span className={`font-[var(--weight-strong)] ${isCur ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink)]'}`}>
          {frame.name}
        </span>
        <span className="text-[var(--color-muted)]">{frame.args}</span>
        <span className="type-micro ms-auto">frame #{frame.num}</span>
      </div>
      {frame.vars.map((v) => (
        <ValueRow key={v.id} v={v} flash={flashSet.has(v.id)} />
      ))}
      {frame.kids.length > 0 ? (
        <div className="ms-3.5 mt-2 flex flex-col gap-2">
          {frame.kids.map((kid, i) => (
            <Frame key={i} frame={kid} cur={cur} flashSet={flashSet} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Block({ block, flashSet }: { block: MemBlock; flashSet: Set<string> }) {
  return (
    <div
      className={`max-w-[340px] rounded-lg border bg-[var(--color-surface)] px-3 py-2.5 ${block.leaked ? 'border-dashed border-[var(--color-hairline)] bg-[var(--color-paper)]' : 'border-[var(--color-rule)]'}`}
      data-block={block.id}
    >
      <div className="mono mb-1 flex items-baseline gap-2 text-[var(--text-small)]">
        <span className="font-[var(--weight-strong)] text-[var(--color-ink)]">{block.addr}</span>
        <span className="type-micro">{block.type}</span>
        {block.leaked ? (
          <span className="ms-auto rounded-full border border-dashed border-[var(--color-warn)] px-2 text-[10px] font-[var(--weight-strong)] text-[var(--color-warn)]">
            leaked?
          </span>
        ) : null}
      </div>
      {block.fields.map((f) => (
        <ValueRow key={f.id} v={f} flash={flashSet.has(f.id)} />
      ))}
    </div>
  );
}

export function MemoryViz({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const memRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const current = STEPS[Math.min(step, STEPS.length - 1)];
  const flashSet = useMemo(() => new Set(current.flash), [current]);

  // Escape closes; arrows step — the mockup's transport keys.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (event.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
    else setPlaying(false);
  }, [open]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setStep((s) => {
        if (s >= STEPS.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [playing]);

  // Arrows are absolutely positioned SVG paths between real DOM anchors; they must be
  // recomputed whenever the step changes or the modal resizes.
  useEffect(() => {
    if (!open) return;
    const svg = svgRef.current;
    const mem = memRef.current;
    if (!svg || !mem) return;

    const draw = () => {
      const box = mem.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      svg.innerHTML = '';
      const NS = 'http://www.w3.org/2000/svg';

      const collect = (): Array<{
        id: string;
        target: string | null;
        origin: 'stack' | 'heap';
        x: number;
        y: number;
        lane?: number;
        count?: number;
      }> => {
        const out: Array<{
          id: string;
          target: string | null;
          origin: 'stack' | 'heap';
          x: number;
          y: number;
          lane?: number;
          count?: number;
        }> = [];
        const anchor = (id: string) => {
          const el = mem.querySelector(`[data-anchor="${CSS.escape(id)}"]`);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.right - box.left, y: r.top + r.height / 2 - box.top };
        };
        const walk = (frames: MemFrame[], origin: 'stack' | 'heap') =>
          frames.forEach((f) => {
            f.vars.forEach((v) => {
              if (!v.ptr) return;
              const g = anchor(v.id);
              if (g) out.push({ id: v.id, target: v.target, origin, ...g });
            });
            walk(f.kids, origin);
          });
        walk(current.frames, 'stack');
        current.blocks.forEach((b) =>
          b.fields.forEach((f) => {
            if (!f.ptr) return;
            const g = anchor(f.id);
            if (g) out.push({ id: f.id, target: f.target, origin: 'heap', ...g });
          }),
        );
        return out;
      };

      const ptrs = collect();
      const stackRegion = mem.querySelector('[data-region="stack"]');
      const heapRegion = mem.querySelector('[data-region="heap"]');
      const stackR = stackRegion?.getBoundingClientRect();
      const heapR = heapRegion?.getBoundingClientRect();
      if (!stackR || !heapR) return;

      const midL = stackR.right - box.left + 8;
      const midR = heapR.left - box.left - 8;
      const rightL = heapR.right - box.left + 10;
      const rightR = box.width - 14;

      const live = ptrs.filter((p) => p.target);
      const nils = ptrs.filter((p) => !p.target);
      const mid = [...live.filter((p) => p.origin === 'stack'), ...nils.filter((p) => p.origin === 'stack')];
      const right = [...live.filter((p) => p.origin === 'heap'), ...nils.filter((p) => p.origin === 'heap')];
      const lane = (arr: Array<{ y: number; lane?: number; count?: number }>) => {
        arr.sort((a, b) => a.y - b.y);
        arr.forEach((p, i) => {
          p.lane = i;
          p.count = arr.length;
        });
      };
      lane(mid);
      lane(right);

      const path = (d: string, stroke: string, marker = true) => {
        const el = document.createElementNS(NS, 'path');
        el.setAttribute('d', d);
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', stroke);
        el.setAttribute('stroke-width', '1.6');
        if (marker) el.setAttribute('marker-end', `url(#${markerId(stroke)})`);
        svg.appendChild(el);
      };
      const markerId = (stroke: string) =>
        stroke.includes('accent') ? 'mv-accent' : stroke.includes('pass') ? 'mv-pass' : 'mv-warn';

      mid.forEach((p) => {
        const target = mem.querySelector(`[data-block="${p.target}"]`);
        if (!target) return;
        const tr = target.getBoundingClientRect();
        const ty = tr.top + 16 - box.top;
        const lx = midL + (midR - midL) * (((p.lane ?? 0) + 1) / ((p.count ?? 1) + 1));
        path(`M ${p.x} ${p.y} C ${lx} ${p.y}, ${lx} ${ty}, ${tr.left - box.left - 2} ${ty}`, 'var(--color-accent)');
      });
      right.forEach((p) => {
        const target = mem.querySelector(`[data-block="${p.target}"]`);
        if (!target) return;
        const tr = target.getBoundingClientRect();
        const ty = tr.top + 16 - box.top;
        const lx = rightL + (rightR - rightL) * (((p.lane ?? 0) + 1) / ((p.count ?? 1) + 1));
        path(`M ${p.x} ${p.y} C ${lx} ${p.y}, ${lx} ${ty}, ${tr.right - box.left + 2} ${ty}`, 'var(--color-pass)');
      });
      nils.forEach((p) => {
        const l = p.origin === 'stack' ? midL : rightL;
        const r = p.origin === 'stack' ? midR : rightR;
        const lx = l + (r - l) * (((p.lane ?? 0) + 1) / ((p.count ?? 1) + 1));
        path(`M ${p.x} ${p.y} L ${lx} ${p.y}`, 'var(--color-faint)', false);
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', String(lx));
        dot.setAttribute('cy', String(p.y));
        dot.setAttribute('r', '3.5');
        dot.setAttribute('fill', 'none');
        dot.setAttribute('stroke', 'var(--color-faint)');
        dot.setAttribute('stroke-width', '1.4');
        svg.appendChild(dot);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(mem);
    return () => observer.disconnect();
  }, [open, current]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[oklch(20%_0.02_258_/_0.45)] p-8 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Memory walkthrough: stack, heap and pointers"
        className="flex max-h-[min(90vh,860px)] w-full max-w-[1080px] flex-col overflow-hidden rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] shadow-[0_24px_64px_oklch(20%_0.02_258_/_0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-none items-baseline gap-3 border-b border-[var(--color-rule)] px-6 py-3">
          <h2 className="type-micro font-[var(--weight-strong)] uppercase tracking-[0.09em] text-[var(--color-muted)]">
            Memory
          </h2>
          <span className="mono type-micro truncate">
            main.c:{current.line} — <b className="font-[var(--weight-medium)] text-[var(--color-ink)]">{SRC[current.line - 1]?.trim()}</b>
          </span>
          <button ref={closeRef} type="button" className="btn btn-quiet ms-auto px-3" onClick={onClose} aria-label="Close memory view">
            ✕
          </button>
        </header>

        <div className="overflow-auto">
          <div ref={memRef} className="relative grid grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_100px] pb-4 pe-1.5 ps-6 pt-3">
            <div data-region="stack" className="min-w-0 pe-6">
              <h3 className="type-micro mb-2.5 mt-1.5 font-[var(--weight-strong)] uppercase tracking-[0.09em]">
                Stack <span className="normal-case tracking-normal">· frames nested by call depth</span>
              </h3>
              {current.frames.map((f, i) => (
                <div key={i} className={i > 0 ? 'mt-2' : ''}>
                  <Frame frame={f} cur={maxFrameNum(current.frames)} flashSet={flashSet} />
                </div>
              ))}
            </div>
            <div aria-hidden />
            <div data-region="heap" className="min-w-0 ps-6">
              <h3 className="type-micro mb-2.5 mt-1.5 font-[var(--weight-strong)] uppercase tracking-[0.09em]">
                Heap <span className="normal-case tracking-normal">· allocations in address order</span>
              </h3>
              {current.blocks.map((b) => (
                <div key={b.id} className="mb-2.5">
                  <Block block={b} flashSet={flashSet} />
                </div>
              ))}
              {current.blocks.length === 0 ? (
                <p className="mono type-micro">— empty —</p>
              ) : null}
            </div>
            <div aria-hidden />
            <svg ref={svgRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
          </div>

          <p className="px-6 pt-2.5 text-[var(--text-small)] text-[var(--color-ink-soft)]">
            <b className="font-[var(--weight-strong)] text-[var(--color-ink)]">
              step {step + 1} of {STEPS.length}
            </b>{' '}
            — {current.note}
          </p>

          <div className="mt-3 flex items-center gap-2 border-t border-[var(--color-rule)] px-6 pb-3.5 pt-3">
            <button type="button" className="btn btn-quiet" onClick={() => { setPlaying(false); setStep(0); }} disabled={step === 0}>
              ⏮ restart
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0}>
              ◀ prev
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setPlaying((p) => !p)}>
              {playing ? '⏸ pause' : '▶ play'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => { setPlaying(false); setStep((s) => Math.min(STEPS.length - 1, s + 1)); }} disabled={step === STEPS.length - 1}>
              next ▶
            </button>
            <span className="mono num type-micro">
              step <b className="text-[var(--color-ink)]">{step + 1}</b> / {STEPS.length}
            </span>
            <input
              type="range"
              className="ms-auto h-1 min-h-0 flex-1 accent-[var(--color-accent)]"
              min={0}
              max={STEPS.length - 1}
              value={step}
              onChange={(event) => { setPlaying(false); setStep(Number(event.target.value)); }}
              aria-label="Scrub through recorded steps"
            />
          </div>

          <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-rule)] px-6 py-3">
            <span className="type-micro flex items-baseline gap-2">
              <span className="inline-block h-0 w-[22px] border-t-2 border-[var(--color-accent)]" /> stack → heap
            </span>
            <span className="type-micro flex items-baseline gap-2">
              <span className="inline-block h-0 w-[22px] border-t-2 border-[var(--color-pass)]" /> heap → heap
            </span>
            <span className="type-micro flex items-baseline gap-2">
              <span className="inline-block h-0 w-[22px] border-t-2 border-[var(--color-faint)]" /> NULL stub
            </span>
            <span className="type-micro ms-auto">
              A recorded walkthrough of a linked-list leak — not live state of your program.
            </span>
          </footer>
        </div>
      </section>
    </div>,
    document.body,
  );
}
