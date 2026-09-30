import { describe, expect, it } from 'vitest';
import { instrumentCForMemoryTrace, traceMemory } from '../src/services/memoryTrace.js';
import type { ExecutionLimits } from '../src/domain/types.js';

const LIMITS: ExecutionLimits = {
  timeLimitMs: 2_000,
  memoryLimitMb: 256,
  pidsLimit: 64,
  maxOutputBytes: 16_384,
};

describe('memory trace instrumentation', () => {
  it('adds stderr probes for initialized locals and pointer assignments', () => {
    const code = `#include <stdio.h>\n#include <stdlib.h>\nint main(void) {\n  int n = 3;\n  int *p = malloc(sizeof *p);\n  *p = n;\n  free(p);\n  return 0;\n}`;
    const instrumented = instrumentCForMemoryTrace(code);
    expect(instrumented.variables).toContain('n');
    expect(instrumented.variables).toContain('p');
    expect(instrumented.code).toContain('__MEMTRACE_STEP__');
    expect(instrumented.code).toContain('__MEMTRACE_FREE__');
  });

  it('executes a small draft and returns live scalar snapshots', async () => {
    const code = `#include <stdio.h>\nint main(void) {\n  int n = 3;\n  n = n + 2;\n  printf("%d\\n", n);\n  return 0;\n}`;
    const response = await traceMemory({ code, stdin: '', limits: LIMITS });
    expect(response.traceable).toBe(true);
    expect(response.steps.length).toBeGreaterThanOrEqual(2);
    expect(response.steps[0]?.variables.find((variable) => variable.name === 'n')?.value).toBe('3');
    expect(response.steps[1]?.variables.find((variable) => variable.name === 'n')?.value).toBe('5');
  });

  it('captures heap allocations and frees from the running program', async () => {
    const code = `#include <stdlib.h>\nint main(void) {\n  int *p = malloc(sizeof *p);\n  *p = 5;\n  free(p);\n  return 0;\n}`;
    const response = await traceMemory({ code, stdin: '', limits: LIMITS });
    expect(response.traceable).toBe(true);
    expect(response.steps.some((step) => step.heap.some((block) => !block.freed))).toBe(true);
    expect(response.steps.at(-1)?.heap.some((block) => block.freed)).toBe(true);
  });
});
