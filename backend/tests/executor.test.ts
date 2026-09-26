import { beforeAll, describe, expect, it } from 'vitest';
import { resolveCompiler } from '../src/config.js';
import { LocalExecutor } from '../src/services/executor/localExecutor.js';
import type { ExecutionLimits } from '../src/domain/types.js';

const compiler = resolveCompiler();
const executor = LocalExecutor.resolve();

const limits: ExecutionLimits = {
  timeLimitMs: 2_000,
  memoryLimitMb: 256,
  pidsLimit: 64,
  maxOutputBytes: 64 * 1024,
};

const ECHO_SUM = `#include <stdio.h>
int main(void) {
    int n, x;
    long long sum = 0;
    if (scanf("%d", &n) != 1) return 1;
    for (int i = 0; i < n; i++) { if (scanf("%d", &x) != 1) return 1; sum += x; }
    printf("%lld\\n", sum);
    return 0;
}
`;

describe.skipIf(!compiler || !executor)('LocalExecutor', () => {
  beforeAll(() => {
    // Fail loudly if this suite is running without a sandbox.
    if (!executor) throw new Error('LocalExecutor could not resolve a C compiler');
  });

  it('accepts a correct program and reports per-case timing', async () => {
    const outcome = await executor!.execute({
      code: ECHO_SUM,
      testCases: [
        { id: 1, inputData: '3\n1 2 3\n', expectedOutput: '6\n' },
        { id: 2, inputData: '2\n-5 5\n', expectedOutput: '0\n' },
      ],
      limits,
    });

    expect(outcome.compiled).toBe(true);
    expect(outcome.compilationError).toBeNull();
    expect(outcome.runs).toHaveLength(2);
    expect(outcome.runs.every((run) => run.passed)).toBe(true);
    expect(outcome.runs.every((run) => run.errorType === 'PASS')).toBe(true);
    expect(outcome.runs.every((run) => run.runtimeMs >= 0)).toBe(true);
    expect(outcome.executor).toBe('local');
  });

  it('surfaces a WRONG_ANSWER without failing the whole run', async () => {
    const outcome = await executor!.execute({
      code: 'int main(void){ return 0; }\n',
      testCases: [{ id: 7, inputData: '1\n1\n', expectedOutput: '1\n' }],
      limits,
    });

    expect(outcome.compiled).toBe(true);
    expect(outcome.runs[0]?.passed).toBe(false);
    expect(outcome.runs[0]?.errorType).toBe('WRONG_ANSWER');
    expect(outcome.runs[0]?.testCaseId).toBe(7);
  });

  it('returns compiler diagnostics for code that does not compile', async () => {
    const outcome = await executor!.execute({
      code: 'int main(void){ return undeclared_thing; }\n',
      testCases: [{ id: 1, inputData: '', expectedOutput: '' }],
      limits,
    });

    expect(outcome.compiled).toBe(false);
    expect(outcome.compilationError).toContain('undeclared_thing');
    expect(outcome.runs).toEqual([]);
  });

  it('kills an infinite loop and reports TIMEOUT', async () => {
    const outcome = await executor!.execute({
      code: '#include <stdio.h>\nint main(void){ while(1){} return 0; }\n',
      testCases: [{ id: 1, inputData: '', expectedOutput: '' }],
      limits: { ...limits, timeLimitMs: 800 },
    });

    expect(outcome.compiled).toBe(true);
    expect(outcome.runs[0]?.passed).toBe(false);
    expect(outcome.runs[0]?.errorType).toBe('TIMEOUT');
  });

  it('reports RUNTIME_ERROR for a non-zero exit', async () => {
    const outcome = await executor!.execute({
      code: 'int main(void){ return 3; }\n',
      testCases: [{ id: 1, inputData: '', expectedOutput: '' }],
      limits,
    });

    expect(outcome.runs[0]?.errorType).toBe('RUNTIME_ERROR');
    expect(outcome.runs[0]?.passed).toBe(false);
  });

  it('bounds output so a chatty program cannot flood the response', async () => {
    const outcome = await executor!.execute({
      code: `#include <stdio.h>
int main(void) {
    for (int i = 0; i < 200000; i++) printf("noise-noise-noise-noise\\n");
    return 0;
}`,
      testCases: [{ id: 1, inputData: '', expectedOutput: 'x\n' }],
      limits: { ...limits, maxOutputBytes: 4096 },
    });

    expect(outcome.compiled).toBe(true);
    expect(Buffer.byteLength(outcome.runs[0]?.actualOutput ?? '', 'utf8')).toBeLessThanOrEqual(4096 + 32);
  });

  it('does not leak a program that reads no input', async () => {
    const outcome = await executor!.execute({
      code: '#include <stdio.h>\nint main(void){ printf("done\\n"); return 0; }\n',
      testCases: [{ id: 1, inputData: 'ignored input\n', expectedOutput: 'done\n' }],
      limits,
    });

    expect(outcome.runs[0]?.passed).toBe(true);
  });
});

describe.skipIf(!!compiler)('LocalExecutor without a toolchain', () => {
  it('reports that no compiler is available instead of crashing', () => {
    expect(LocalExecutor.resolve()).toBeNull();
  });
});
