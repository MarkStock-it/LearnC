import type { ExecutionLimits } from '../domain/types.js';
import type { MemoryTraceResponse, MemoryTraceStep, MemoryTraceVariable } from '../domain/memoryTrace.js';
import { getExecutor } from './executor/index.js';

interface TrackedVariable {
  name: string;
  type: string;
  format: '%lld' | '%g' | '%p';
  cast: string;
  pointer: boolean;
  heap: boolean;
  initialized: boolean;
  depth: number;
}

interface TraceEvent {
  kind: 'step' | 'variable' | 'free';
  seq: number;
  line: number;
  name?: string;
  type?: string;
  depth?: number;
  pointer?: boolean;
  heap?: boolean;
  value?: string;
}

const POINTER_DECLARATION = /^\s*(?:(?:const|volatile|static|unsigned|signed|short|long)\s+)*(int|char|short|long|float|double|size_t|[A-Za-z_]\w*)\s*(\*\s*)+([A-Za-z_]\w*)\s*(?:=\s*(.+?))?;\s*$/;
const SCALAR_DECLARATION = /^\s*(?:(?:const|volatile|static|unsigned|signed|short|long)\s+)*(int|char|short|long|float|double|size_t)\s+([A-Za-z_]\w*)\s*(?:=\s*(.+?))?;\s*$/;
const IDENTIFIER = '[A-Za-z_]\\w*';

function cString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function variableProbe(variable: TrackedVariable): string {
  const name = cString(variable.name);
  const type = cString(variable.type);
  return `fprintf(stderr, "__MEMTRACE_VAR__|%lu|${name}|${type}|${variable.depth}|${variable.pointer ? 1 : 0}|${variable.heap ? 1 : 0}|${variable.format}\\n", __memtrace_step, ${variable.cast}${variable.name});`;
}

function declarationInfo(line: string, depth: number): TrackedVariable | null {
  const pointer = POINTER_DECLARATION.exec(line);
  if (pointer) {
    const baseType = pointer[1] ?? 'void';
    const name = pointer[3] ?? '';
    const initializer = pointer[4] ?? '';
    return {
      name,
      type: `${baseType} *`,
      format: '%p',
      cast: '(void *)',
      pointer: true,
      heap: /\b(?:malloc|calloc|realloc)\s*\(/.test(initializer),
      initialized: initializer.length > 0,
      depth,
    };
  }

  const scalar = SCALAR_DECLARATION.exec(line);
  if (!scalar) return null;
  const prefix = line.trim().match(/^(?:(?:const|volatile|static|unsigned|signed|short|long)\s+)*/)?.[0] ?? '';
  const baseType = `${prefix}${scalar[1]}`.trim();
  const name = scalar[2] ?? '';
  const initializer = scalar[3] ?? '';
  const floating = /\b(?:float|double)\b/.test(baseType);
  return {
    name,
    type: baseType,
    format: floating ? '%g' : '%lld',
    cast: floating ? '(double)' : '(long long)',
    pointer: false,
    heap: false,
    initialized: initializer.length > 0,
    depth,
  };
}

function emitSnapshot(line: number, active: TrackedVariable[], freeName?: string): string[] {
  const out = ['++__memtrace_step;', `fprintf(stderr, "__MEMTRACE_STEP__|%lu|${line}\\n", __memtrace_step);`];
  if (freeName) {
    const variable = active.find((entry) => entry.name === freeName);
    if (variable?.pointer && variable.initialized) {
      out.push(`fprintf(stderr, "__MEMTRACE_FREE__|%lu|${cString(freeName)}|%p\\n", __memtrace_step, (void *)${freeName});`);
      out.push(`${freeName} = NULL;`);
    }
  }
  out.push(...active.filter((variable) => variable.initialized).map(variableProbe));
  return out;
}

/** Instrument simple local scalar/pointer declarations and assignments. */
export function instrumentCForMemoryTrace(source: string): { code: string; variables: string[] } {
  const active = new Map<string, TrackedVariable>();
  const allNames = new Set<string>();
  const output: string[] = [];
  let depth = 0;
  let sawSnapshot = false;
  let lineNumber = 0;

  for (const originalLine of source.split('\n')) {
    lineNumber += 1;
    const trimmed = originalLine.trim();
    const declaration = declarationInfo(originalLine, depth);
    let changed: TrackedVariable | null = null;
    let freeName: string | undefined;

    if (declaration) {
      active.set(declaration.name, declaration);
      allNames.add(declaration.name);
      if (declaration.initialized) changed = declaration;
    } else {
      const freeMatch = /^\s*free\s*\(\s*([A-Za-z_]\w*)\s*\)\s*;\s*$/.exec(originalLine);
      if (freeMatch) freeName = freeMatch[1];

      for (const variable of active.values()) {
        const assignment = new RegExp(`^\\s*${variable.name}\\s*(?:\\+\\+|--|(?:\\+|-|\\*|/|%|&|\\||\\^|<<|>>)?=\\s*.+)\\s*;\\s*$`);
        if (!assignment.test(originalLine)) continue;
        changed = variable;
        variable.initialized = true;
        if (variable.pointer) {
          const rhs = originalLine.slice(originalLine.indexOf('=') + 1);
          variable.heap = /\b(?:malloc|calloc|realloc)\s*\(/.test(rhs) || [...active.values()].some((candidate) => candidate.name !== variable.name && candidate.heap && new RegExp(`\\b${candidate.name}\\b`).test(rhs));
        }
        break;
      }

      if (/^\s*(?:scanf|fscanf)\s*\(.*\)\s*;\s*$/.test(originalLine)) {
        for (const match of originalLine.matchAll(new RegExp(`&\\s*(${IDENTIFIER})`, 'g'))) {
          const variable = active.get(match[1] ?? '');
          if (variable) {
            variable.initialized = true;
            changed = variable;
          }
        }
      }

      if (/^\s*(?:if|while|for|switch)\s*\(/.test(originalLine) && /\{\s*$/.test(originalLine)) {
        // Control-flow expressions can mutate variables; emit the current snapshot
        // at the branch boundary so the UI at least reflects the entering state.
        if ([...active.values()].some((variable) => variable.initialized)) changed = [...active.values()].find((variable) => variable.initialized) ?? null;
      }
    }

    output.push(originalLine);
    if (changed || freeName) {
      const probes = emitSnapshot(lineNumber, [...active.values()], freeName);
      output.push(`    ${probes.join('\n    ')}`);
      sawSnapshot = true;
    }

    if (trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
      for (const char of originalLine) {
        if (char === '{') depth += 1;
        if (char === '}') {
          depth = Math.max(0, depth - 1);
          for (const [name, variable] of active) if (variable.depth > depth) active.delete(name);
        }
      }
    }
  }

  if (!sawSnapshot) return { code: source, variables: [] };
  if (!/^\s*#\s*include\s*<stdio\.h>/m.test(source)) output.unshift('#include <stdio.h>');
  const includeIndex = output.findIndex((line) => /^\s*#\s*include\b/.test(line));
  output.splice(includeIndex < 0 ? 0 : includeIndex + 1, 0, 'static unsigned long __memtrace_step = 0;');
  return { code: output.join('\n'), variables: [...allNames] };
}

function parseEvents(stderr: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of stderr.split('\n')) {
    const step = /__MEMTRACE_STEP__\|(\d+)\|(\d+)/.exec(line);
    if (step) {
      events.push({ kind: 'step', seq: Number(step[1]), line: Number(step[2]) });
      continue;
    }
    const variable = /__MEMTRACE_VAR__\|(\d+)\|([^|]+)\|([^|]+)\|(\d+)\|(\d+)\|(\d+)\|(.+)$/.exec(line);
    if (variable) {
      events.push({
        kind: 'variable', seq: Number(variable[1]), name: variable[2], type: variable[3], depth: Number(variable[4]),
        pointer: variable[5] === '1', heap: variable[6] === '1', value: variable[7]?.trim() ?? '', line: 0,
      });
      continue;
    }
    const freed = /__MEMTRACE_FREE__\|(\d+)\|([^|]+)\|(.+)$/.exec(line);
    if (freed) events.push({ kind: 'free', seq: Number(freed[1]), name: freed[2], value: freed[3]?.trim() ?? '', line: 0 });
  }
  return events;
}

function snapshotsFromEvents(events: TraceEvent[]): MemoryTraceStep[] {
  const bySeq = new Map<number, TraceEvent[]>();
  for (const event of events) {
    const current = bySeq.get(event.seq) ?? [];
    current.push(event);
    bySeq.set(event.seq, current);
  }

  const state = new Map<string, MemoryTraceVariable>();
  const heap = new Map<string, { address: string; type: string; freed: boolean }>();
  const steps: MemoryTraceStep[] = [];
  for (const [sequence, group] of [...bySeq.entries()].sort(([a], [b]) => a - b)) {
    const event = group.find((entry) => entry.kind === 'step');
    // Every instrumented statement emits the full currently-live variable set;
    // resetting here lets variables disappear from snapshots when a C scope exits.
    state.clear();
    for (const item of group) {
      if (item.kind === 'free' && item.value) {
        const block = heap.get(item.value);
        if (block) block.freed = true;
      }
      if (item.kind === 'free' && item.name) {
        const previous = state.get(item.name);
        if (previous) state.set(item.name, { ...previous, value: '(nil)', heap: false });
      }
      if (item.kind !== 'variable' || !item.name || !item.type || item.value === undefined) continue;
      state.set(item.name, {
        id: item.name,
        name: item.name,
        type: item.type,
        value: item.value,
        pointer: Boolean(item.pointer),
        heap: Boolean(item.heap),
        depth: item.depth ?? 0,
      });
      if (item.pointer && item.heap && item.value !== '(nil)' && item.value !== '0x0' && item.value !== '0') {
        heap.set(item.value, { address: item.value, type: item.type.replace(/\s*\*+$/, ''), freed: false });
      }
    }
    steps.push({
      line: event?.line ?? 0,
      variables: [...state.values()],
      heap: [...heap.values()].map((block) => ({ ...block })),
      sequence,
    });
  }
  return steps;
}

export async function traceMemory(input: {
  code: string;
  stdin: string;
  limits: ExecutionLimits;
}): Promise<MemoryTraceResponse> {
  const instrumented = instrumentCForMemoryTrace(input.code);
  if (instrumented.variables.length === 0) {
    return {
      steps: [],
      traceable: false,
      message: 'No supported simple local scalar or pointer statements were found in this C draft.',
      stderr: '',
    };
  }

  const { executor } = await getExecutor();
  const outcome = await executor.execute({
    code: instrumented.code,
    testCases: [{ id: 1, inputData: input.stdin, expectedOutput: '' }],
    limits: input.limits,
  });
  if (!outcome.compiled) {
    return { steps: [], traceable: false, message: outcome.compilationError ?? 'Could not compile the current draft for tracing.', stderr: '' };
  }

  const run = outcome.runs[0];
  const steps = snapshotsFromEvents(parseEvents(run?.stderr ?? ''));
  return {
    steps,
    traceable: steps.length > 0,
    message: steps.length > 0 ? null : 'The program ran, but no supported statements produced runtime snapshots.',
    stderr: (run?.stderr ?? '').split('\n').filter((line) => !line.includes('__MEMTRACE_')).join('\n').trim(),
  };
}
