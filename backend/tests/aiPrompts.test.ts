import { describe, expect, it } from 'vitest';
import { condenseProblemForTestCases, formatAvoidTitles, learnerIntentBlock } from '../src/services/aiPrompts.js';
import type { GenerateOptions } from '../src/services/aiService.js';
import type { GeneratedProblem } from '../src/domain/problem.js';

const baseOptions: GenerateOptions = {
  difficulty: 'easy',
  topics: ['arrays'],
  testCaseCount: 6,
  publicTestCaseCount: 2,
};

function problemWithDescription(description: string): GeneratedProblem {
  return {
    title: 'Sum the Array Values',
    description,
    constraints: {
      time_limit_seconds: 2,
      memory_limit_mb: 256,
      input_format: 'An integer n followed by n values.',
      output_format: 'Print the sum as an integer.',
      sample_input: '2 3 4',
      sample_output: '7',
    },
    tags: ['arrays'],
    difficulty: 'easy',
    reference_solution: '#include <stdio.h>\nint main(void) { return 0; }',
  };
}

describe('formatAvoidTitles', () => {
  it('returns nothing when there is nothing to avoid', () => {
    expect(formatAvoidTitles(undefined)).toBe('');
    expect(formatAvoidTitles([])).toBe('');
  });

  it('keeps only the freshest titles so old ones stop costing tokens', () => {
    const titles = Array.from({ length: 12 }, (_, index) => `Problem ${index + 1}`);
    const segments = formatAvoidTitles(titles).split('; ');
    expect(segments).toHaveLength(10);
    expect(segments[0]).toBe('Problem 3');
    expect(segments[9]).toBe('Problem 12');
    expect(segments).not.toContain('Problem 1');
    expect(segments).not.toContain('Problem 2');
  });

  it('truncates overlong titles', () => {
    const formatted = formatAvoidTitles([`x`.repeat(200)]);
    expect(formatted.length).toBeLessThan(70);
    expect(formatted).toMatch(/…$/);
  });
});

describe('learnerIntentBlock', () => {
  it('omits the avoid line when no titles are given', () => {
    expect(learnerIntentBlock({ ...baseOptions, instructions: 'Focus on loops.' }))
      .toContain('LEARNER INSTRUCTIONS');
    expect(learnerIntentBlock(baseOptions)).toBe('');
  });
});

describe('condenseProblemForTestCases', () => {
  it('returns short statements untouched', () => {
    const problem = problemWithDescription('Read numbers, print the sum.');
    expect(condenseProblemForTestCases(problem)).toBe(problem);
  });

  it('trims long prose but keeps formats, samples and identity', () => {
    const problem = problemWithDescription(`${'Statement prose. '.repeat(200)}`);
    const condensed = condenseProblemForTestCases(problem);
    expect(condensed).not.toBe(problem);
    expect(condensed.description.length).toBeLessThan(problem.description.length);
    expect(condensed.description).toContain('trimmed to keep the request small');
    expect(condensed.title).toBe(problem.title);
    expect(condensed.constraints).toEqual(problem.constraints);
    expect(condensed.reference_solution).toBe(problem.reference_solution);
  });
});
