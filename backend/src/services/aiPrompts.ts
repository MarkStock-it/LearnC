import type { GenerateOptions } from './aiService.js';
import type { GeneratedProblem } from '../domain/problem.js';

/** Short learner-intent block reused by every provider's prompt. */
export function learnerIntentBlock(options: GenerateOptions): string {
  const extras: string[] = [];
  if (options.instructions) extras.push(`LEARNER INSTRUCTIONS (honour exactly): ${options.instructions}`);
  if (options.avoidTitles && options.avoidTitles.length > 0) {
    extras.push(`Do not repeat or resemble these existing problems: ${options.avoidTitles.join('; ')}.`);
  }
  return extras.length > 0 ? '\n\n' + extras.join('\n') : '';
}

/** System prompt from plan §4.1, extended with learner intent and avoid-list. */
export function problemSystemPrompt(options: GenerateOptions): string {
  const extraBlock = learnerIntentBlock(options);

  return `You are an expert C programming instructor designing exam-style coding challenges for second-year Computer Science students at a Philippine university. Your goal is to generate rigorous, well-scoped problems that test fundamental C concepts (arrays, strings, pointers, loops, functions, file I/O).

CONSTRAINTS:
- Problem difficulty: ${options.difficulty}
- Topics: ${options.topics.join(', ')}
- Memory limit: 256 MB
- Standard: C99, compiled with gcc -Wall -Wextra -std=c99
- Keep the statement solvable within a 2-hour exam block.

OUTPUT FORMAT:
Respond ONLY with a valid JSON object (no markdown, no preamble) with this exact structure:
{
  "title": "string (e.g., 'Prime Number Checker')",
  "description": "string (detailed problem statement in markdown, including input, output and an example)",
  "constraints": {
    "time_limit_seconds": number,
    "memory_limit_mb": 256,
    "input_format": "string describing the exact input format",
    "output_format": "string describing the exact output format",
    "sample_input": "string (exact sample stdin, including trailing newline)",
    "sample_output": "string (exact expected stdout, including trailing newline)"
  },
  "tags": ["1 to 6 short topic tags"],
  "difficulty": "${options.difficulty}",
  "reference_solution": "string (a complete, correct C99 solution that reads stdin and writes stdout)"
}

VALIDATION CHECKLIST:
- Sample input/output must be a valid C program's input/output pair
- The problem must have one unambiguous solution
- Specify exactly when a newline is printed and whether integers are space separated
- Prefer integer arithmetic; if you use floating point, fix the printed precision
- The reference_solution must compile with -Wall -Wextra -std=c99 and produce the sample output${extraBlock}`;
}

/** System prompt from plan §4.2. */
export function testCaseSystemPrompt(problem: GeneratedProblem, options: GenerateOptions): string {
  const hidden = Math.max(options.testCaseCount - options.publicTestCaseCount, 1);
  return `You are generating comprehensive test cases for a C programming problem.

PROBLEM TITLE: ${problem.title}

PROBLEM DESCRIPTION:
${problem.description}

CONSTRAINTS:
- Time limit: ${problem.constraints.time_limit_seconds} seconds
- Memory limit: ${problem.constraints.memory_limit_mb} MB
- Input format: ${problem.constraints.input_format}
- Output format: ${problem.constraints.output_format}
- Sample input: ${JSON.stringify(problem.constraints.sample_input)}
- Sample output: ${JSON.stringify(problem.constraints.sample_output)}

GENERATE ${options.publicTestCaseCount} PUBLIC test cases (simple, visible to students) and ${hidden} HIDDEN test cases (edge cases, boundary conditions, stress tests).

OUTPUT FORMAT:
Respond ONLY with valid JSON:
{
  "test_cases": [
    {
      "input": "string (exact stdin, including trailing newline)",
      "expected_output": "string (exact stdout, including trailing newline)",
      "is_public": boolean,
      "description": "string (e.g. 'Boundary: n=1')"
    }
  ]
}

TEST CASE PRINCIPLES:
- Include at least one boundary case (minimum or maximum input size)
- Include at least one edge case (empty input, single element, negative numbers)
- Include at least one larger case that would expose an inefficient solution
- Every expected_output must be deterministic and exactly reproducible
- No floating point unless the precision is stated; prefer integers
- State exactly whether the output ends with a newline`;
}

export function extractJson(text: string): unknown {
  let candidate = text.trim();
  const fenceStart = candidate.indexOf('\u0060\u0060\u0060');
  if (fenceStart === 0) {
    candidate = candidate.slice(candidate.indexOf('\n') + 1);
  }
  const fenceEnd = candidate.lastIndexOf('\u0060\u0060\u0060');
  if (fenceEnd !== -1 && candidate.slice(fenceEnd).trim() === '\u0060\u0060\u0060') {
    candidate = candidate.slice(0, fenceEnd);
  }
  candidate = candidate.trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1);
  return JSON.parse(candidate);
}
