import type { Difficulty } from '../domain/types.js';

/**
 * Curated problem bank (plan §Phase 1 fallback).
 *
 * Two jobs:
 *  1. `AI_PROVIDER=offline` uses it to seed problem sets without an API key, so the
 *     platform is demoable and testable with no external dependencies.
 *  2. Every entry ships a `referenceSolution`, which the seeding/verification step
 *     compiles and runs against the test cases. If a hand-written or AI-generated
 *     expectation is wrong, verification fails loudly instead of shipping a problem
 *     whose "correct" answer is unachievable.
 */
export interface BankTestCase {
  input: string;
  expectedOutput: string;
  isPublic: boolean;
  description: string;
}

export interface BankProblem {
  key: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  timeLimitSeconds: number;
  memoryLimitMb: number;
  inputFormat: string;
  outputFormat: string;
  description: string;
  sampleInput: string;
  sampleOutput: string;
  referenceSolution: string;
  testCases: BankTestCase[];
}

const ARRAY_SUM: BankProblem = {
  key: 'array-sum',
  title: 'Array Sum',
  difficulty: 'easy',
  tags: ['arrays', 'loops', 'arithmetic'],
  timeLimitSeconds: 2,
  memoryLimitMb: 256,
  inputFormat: 'The first line contains an integer n (1 <= n <= 1000). The second line contains n integers separated by single spaces (-10^6 <= x <= 10^6).',
  outputFormat: 'Print a single integer: the sum of the n values, followed by a newline.',
  description: `## Array Sum

Read \`n\` integers and print their total.

### Input
The first line contains an integer \`n\` (1 <= n <= 1000). The second line contains \`n\`
integers separated by single spaces. Each value is in the range -10^6 to 10^6.

### Output
Print one integer: the sum of the \`n\` values, followed by a newline.

### Example
\`\`\`
Input        Output
3
1 2 3        6
\`\`\`

### Notes
Use a loop and an accumulator. Values may be negative, so do not assume the sum is
positive when printing it.`,
  sampleInput: '3\n1 2 3\n',
  sampleOutput: '6\n',
  referenceSolution: `#include <stdio.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 1;

    long long sum = 0;
    for (int i = 0; i < n; i++) {
        long long value;
        if (scanf("%lld", &value) != 1) return 1;
        sum += value;
    }

    printf("%lld\\n", sum);
    return 0;
}
`,
  testCases: [
    { input: '3\n1 2 3\n', expectedOutput: '6\n', isPublic: true, description: 'Statement example' },
    { input: '1\n42\n', expectedOutput: '42\n', isPublic: true, description: 'Boundary: n = 1' },
    { input: '5\n1 1 1 1 1\n', expectedOutput: '5\n', isPublic: true, description: 'All equal values' },
    { input: '2\n-5 5\n', expectedOutput: '0\n', isPublic: false, description: 'Negative plus positive' },
    {
      input: '4\n1000000 2000000 3000000 4000000\n',
      expectedOutput: '10000000\n',
      isPublic: false,
      description: 'Large values (needs 64-bit accumulator)',
    },
    { input: '6\n0 0 0 0 0 1\n', expectedOutput: '1\n', isPublic: false, description: 'Mostly zeros' },
    { input: '8\n9 8 7 6 5 4 3 2\n', expectedOutput: '44\n', isPublic: false, description: 'All distinct, descending' },
  ],
};

const REVERSE_WORD: BankProblem = {
  key: 'reverse-word',
  title: 'Reverse a Word',
  difficulty: 'easy',
  tags: ['strings', 'arrays'],
  timeLimitSeconds: 2,
  memoryLimitMb: 256,
  inputFormat: 'A single word of at most 100 characters with no whitespace, on one line.',
  outputFormat: 'Print the word reversed, followed by a newline.',
  description: `## Reverse a Word

Read one word and print it backwards.

### Input
A single word of at most 100 characters containing no whitespace, on one line.

### Output
Print the word reversed, followed by a newline.

### Example
\`\`\`
Input        Output
hello        olleh
\`\`\`

### Notes
Find the length first, then print characters from the last index down to 0. A word
that reads the same forwards and backwards must print unchanged.`,
  sampleInput: 'hello\n',
  sampleOutput: 'olleh\n',
  referenceSolution: `#include <stdio.h>
#include <string.h>

int main(void) {
    char word[128];
    if (scanf("%127s", word) != 1) return 1;

    size_t length = strlen(word);
    for (size_t i = length; i > 0; i--) {
        putchar(word[i - 1]);
    }
    putchar('\\n');
    return 0;
}
`,
  testCases: [
    { input: 'hello\n', expectedOutput: 'olleh\n', isPublic: true, description: 'Statement example' },
    { input: 'C\n', expectedOutput: 'C\n', isPublic: true, description: 'Boundary: one character' },
    { input: 'level\n', expectedOutput: 'level\n', isPublic: true, description: 'Palindrome' },
    { input: 'abcdefghij\n', expectedOutput: 'jihgfedcba\n', isPublic: false, description: 'Ten distinct characters' },
    { input: '12345\n', expectedOutput: '54321\n', isPublic: false, description: 'Digits only' },
    { input: 'racecar\n', expectedOutput: 'racecar\n', isPublic: false, description: 'Longer palindrome' },
  ],
};

const COUNT_VOWELS: BankProblem = {
  key: 'count-vowels',
  title: 'Count the Vowels',
  difficulty: 'easy',
  tags: ['strings', 'loops', 'characters'],
  timeLimitSeconds: 2,
  memoryLimitMb: 256,
  inputFormat: 'One or more characters on a single line (may contain spaces), ending with a newline.',
  outputFormat: 'Print the number of vowels (a, e, i, o, u in either case) followed by a newline.',
  description: `## Count the Vowels

Count how many vowels appear in a line of text.

### Input
A single line of at most 200 characters. The line may contain spaces and digits.

### Output
Print the count of vowels — \`a\`, \`e\`, \`i\`, \`o\`, \`u\` in either upper or lower case —
followed by a newline.

### Example
\`\`\`
Input              Output
Hello World        3
\`\`\`

### Notes
The line contains spaces, so \`scanf("%s")\` stops too early. Read the whole line with
\`fgets\`, then examine each character. Non-letter characters are never vowels.`,
  sampleInput: 'Hello World\n',
  sampleOutput: '3\n',
  referenceSolution: `#include <stdio.h>
#include <string.h>

int main(void) {
    char line[256];
    if (fgets(line, sizeof(line), stdin) == NULL) {
        printf("0\\n");
        return 0;
    }

    int count = 0;
    for (size_t i = 0; line[i] != '\\0'; i++) {
        char c = line[i];
        if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u' ||
            c == 'A' || c == 'E' || c == 'I' || c == 'O' || c == 'U') {
            count++;
        }
    }

    printf("%d\\n", count);
    return 0;
}
`,
  testCases: [
    { input: 'Hello World\n', expectedOutput: '3\n', isPublic: true, description: 'Statement example' },
    { input: 'aeiou\n', expectedOutput: '5\n', isPublic: true, description: 'Every vowel once' },
    { input: 'xyz\n', expectedOutput: '0\n', isPublic: true, description: 'No vowels' },
    { input: 'AEIOU\n', expectedOutput: '5\n', isPublic: false, description: 'Upper case vowels' },
    {
      input: 'The quick brown fox\n',
      expectedOutput: '5\n',
      isPublic: false,
      description: 'Mixed case with spaces',
    },
    { input: '\n', expectedOutput: '0\n', isPublic: false, description: 'Edge case: empty line' },
    {
      input: 'Programming is FUN 12345\n',
      expectedOutput: '5\n',
      isPublic: false,
      description: 'Digits and mixed case',
    },
  ],
};

const SECOND_LARGEST: BankProblem = {
  key: 'second-largest',
  title: 'Second Largest Value',
  difficulty: 'medium',
  tags: ['arrays', 'loops', 'comparisons'],
  timeLimitSeconds: 2,
  memoryLimitMb: 256,
  inputFormat: 'The first line contains n (1 <= n <= 1000). The second line contains n integers separated by spaces.',
  outputFormat: 'Print the second largest distinct value, or NONE if fewer than two distinct values exist.',
  description: `## Second Largest Value

Find the second largest *distinct* value in a list.

### Input
The first line contains an integer \`n\` (1 <= n <= 1000). The second line contains
\`n\` integers separated by spaces.

### Output
Print the second largest **distinct** value, followed by a newline. If the list has
fewer than two distinct values, print \`NONE\`.

### Example
\`\`\`
Input              Output
5
1 5 3 5 2          3
\`\`\`

### Notes
Repeated values must be ignored: in \`1 5 3 5\` the answer is \`3\`, not \`5\`. Track the
largest and second largest in a single pass, or sort the list first.`,
  sampleInput: '5\n1 5 3 5 2\n',
  sampleOutput: '3\n',
  referenceSolution: `#include <stdio.h>
#include <limits.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 1;

    long long largest = LLONG_MIN;
    long long second = LLONG_MIN;

    for (int i = 0; i < n; i++) {
        long long value;
        if (scanf("%lld", &value) != 1) return 1;
        if (value > largest) {
            second = largest;
            largest = value;
        } else if (value < largest && value > second) {
            second = value;
        }
    }

    if (second == LLONG_MIN) {
        printf("NONE\\n");
    } else {
        printf("%lld\\n", second);
    }
    return 0;
}
`,
  testCases: [
    { input: '5\n1 5 3 5 2\n', expectedOutput: '3\n', isPublic: true, description: 'Statement example' },
    { input: '3\n1 1 1\n', expectedOutput: 'NONE\n', isPublic: true, description: 'All values identical' },
    { input: '2\n-1 -5\n', expectedOutput: '-5\n', isPublic: true, description: 'All negative' },
    { input: '4\n10 20 30 40\n', expectedOutput: '30\n', isPublic: false, description: 'Strictly increasing' },
    { input: '1\n7\n', expectedOutput: 'NONE\n', isPublic: false, description: 'Boundary: n = 1' },
    { input: '6\n-3 -3 -1 -2 -1 -2\n', expectedOutput: '-2\n', isPublic: false, description: 'Duplicates with negatives' },
    { input: '3\n5 5 1\n', expectedOutput: '1\n', isPublic: false, description: 'Largest repeated' },
  ],
};

const MATRIX_TRANSPOSE: BankProblem = {
  key: 'matrix-transpose',
  title: 'Matrix Transpose',
  difficulty: 'medium',
  tags: ['arrays', 'matrices', 'nested-loops'],
  timeLimitSeconds: 3,
  memoryLimitMb: 256,
  inputFormat: 'The first line contains r and c (1 <= r, c <= 20). The next r lines each contain c integers.',
  outputFormat: 'Print the transposed matrix: c lines, each with r integers separated by single spaces.',
  description: `## Matrix Transpose

Print the transpose of a matrix.

### Input
The first line contains two integers \`r\` and \`c\` (1 <= r, c <= 20). The next \`r\`
lines each contain \`c\` integers.

### Output
Print the transposed matrix: \`c\` lines, each containing \`r\` integers separated by
single spaces, followed by a newline.

### Example
\`\`\`
Input           Output
2 3
1 2 3           1 4
4 5 6           2 5
                3 6
\`\`\`

### Notes
Store the matrix in a 2-D array, then print \`m[col][row]\` while looping over columns
in the outer loop. Do not print a trailing space at the end of a line.`,
  sampleInput: '2 3\n1 2 3\n4 5 6\n',
  sampleOutput: '1 4\n2 5\n3 6\n',
  referenceSolution: `#include <stdio.h>

int main(void) {
    int rows, cols;
    if (scanf("%d %d", &rows, &cols) != 2) return 1;

    int matrix[20][20];
    for (int r = 0; r < rows; r++) {
        for (int c = 0; c < cols; c++) {
            if (scanf("%d", &matrix[r][c]) != 1) return 1;
        }
    }

    for (int c = 0; c < cols; c++) {
        for (int r = 0; r < rows; r++) {
            if (r > 0) putchar(' ');
            printf("%d", matrix[r][c]);
        }
        putchar('\\n');
    }
    return 0;
}
`,
  testCases: [
    { input: '2 3\n1 2 3\n4 5 6\n', expectedOutput: '1 4\n2 5\n3 6\n', isPublic: true, description: 'Statement example' },
    { input: '1 1\n7\n', expectedOutput: '7\n', isPublic: true, description: 'Boundary: 1x1 matrix' },
    { input: '3 2\n1 2\n3 4\n5 6\n', expectedOutput: '1 3 5\n2 4 6\n', isPublic: true, description: 'Tall matrix' },
    { input: '2 2\n-1 0\n0 -1\n', expectedOutput: '-1 0\n0 -1\n', isPublic: false, description: 'Negatives, symmetric' },
    { input: '1 4\n1 2 3 4\n', expectedOutput: '1\n2\n3\n4\n', isPublic: false, description: 'Single row becomes a column' },
    { input: '4 1\n9\n8\n7\n6\n', expectedOutput: '9 8 7 6\n', isPublic: false, description: 'Single column becomes a row' },
  ],
};

const GCD_LCM: BankProblem = {
  key: 'gcd-lcm',
  title: 'GCD and LCM',
  difficulty: 'medium',
  tags: ['math', 'loops', 'arithmetic'],
  timeLimitSeconds: 2,
  memoryLimitMb: 256,
  inputFormat: 'A single line with two positive integers a and b (1 <= a, b <= 10^6), separated by a space.',
  outputFormat: 'Print the greatest common divisor and the least common multiple on one line, separated by a single space.',
  description: `## GCD and LCM

Given two positive integers, print their greatest common divisor (GCD) and least
common multiple (LCM).

### Input
One line with two positive integers \`a\` and \`b\` (1 <= a, b <= 10^6) separated by a space.

### Output
Print the GCD and the LCM on one line, separated by a single space, followed by a
newline.

### Example
\`\`\`
Input        Output
12 18        6 36
\`\`\`

### Notes
Euclid's algorithm finds the GCD quickly: repeatedly replace \`(a, b)\` with
\`(b, a % b)\` until \`b\` is 0. The LCM is \`a / gcd * b\` — divide first to avoid
overflow. Values of \`a * b\` can reach 10^12, which does not fit in \`int\`.`,
  sampleInput: '12 18\n',
  sampleOutput: '6 36\n',
  referenceSolution: `#include <stdio.h>

static long long gcd(long long a, long long b) {
    while (b != 0) {
        long long t = a % b;
        a = b;
        b = t;
    }
    return a;
}

int main(void) {
    long long a, b;
    if (scanf("%lld %lld", &a, &b) != 2) return 1;

    long long g = gcd(a, b);
    long long l = (a / g) * b;
    printf("%lld %lld\\n", g, l);
    return 0;
}
`,
  testCases: [
    { input: '12 18\n', expectedOutput: '6 36\n', isPublic: true, description: 'Statement example' },
    { input: '5 7\n', expectedOutput: '1 35\n', isPublic: true, description: 'Coprime values' },
    { input: '100 75\n', expectedOutput: '25 300\n', isPublic: true, description: 'Shares a large factor' },
    { input: '1 1\n', expectedOutput: '1 1\n', isPublic: false, description: 'Boundary: both one' },
    { input: '7 7\n', expectedOutput: '7 7\n', isPublic: false, description: 'Equal values' },
    {
      input: '1000000 999999\n',
      expectedOutput: '1 999999000000\n',
      isPublic: false,
      description: 'Stress: LCM exceeds 32-bit range',
    },
  ],
};

const SORT_DESCENDING: BankProblem = {
  key: 'sort-descending',
  title: 'Sort Scores Descending',
  difficulty: 'medium',
  tags: ['arrays', 'sorting', 'algorithms'],
  timeLimitSeconds: 2,
  memoryLimitMb: 256,
  inputFormat: 'The first line contains n (1 <= n <= 500). The second line contains n integers separated by spaces.',
  outputFormat: 'Print the values in non-increasing order on one line, separated by single spaces.',
  description: `## Sort Scores Descending

Sort a list of scores from highest to lowest.

### Input
The first line contains an integer \`n\` (1 <= n <= 500). The second line contains \`n\`
integers separated by spaces.

### Output
Print the values in non-increasing order on a single line, separated by single
spaces, followed by a newline.

### Example
\`\`\`
Input              Output
5
3 1 4 1 5          5 4 3 1 1
\`\`\`

### Notes
A simple selection or bubble sort is enough for n = 500. Equal values are allowed and
must all be printed. Do not print a trailing space after the last value.`,
  sampleInput: '5\n3 1 4 1 5\n',
  sampleOutput: '5 4 3 1 1\n',
  referenceSolution: `#include <stdio.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 1;

    int values[500];
    for (int i = 0; i < n; i++) {
        if (scanf("%d", &values[i]) != 1) return 1;
    }

    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - 1 - i; j++) {
            if (values[j] < values[j + 1]) {
                int temp = values[j];
                values[j] = values[j + 1];
                values[j + 1] = temp;
            }
        }
    }

    for (int i = 0; i < n; i++) {
        if (i > 0) putchar(' ');
        printf("%d", values[i]);
    }
    putchar('\\n');
    return 0;
}
`,
  testCases: [
    { input: '5\n3 1 4 1 5\n', expectedOutput: '5 4 3 1 1\n', isPublic: true, description: 'Statement example' },
    { input: '1\n9\n', expectedOutput: '9\n', isPublic: true, description: 'Boundary: n = 1' },
    { input: '3\n-1 -2 -3\n', expectedOutput: '-1 -2 -3\n', isPublic: true, description: 'Already sorted, negatives' },
    { input: '4\n2 2 2 2\n', expectedOutput: '2 2 2 2\n', isPublic: false, description: 'All equal' },
    { input: '6\n0 9 8 7 6 5\n', expectedOutput: '9 8 7 6 5 0\n', isPublic: false, description: 'Zero at the end' },
    { input: '2\n-5 10\n', expectedOutput: '10 -5\n', isPublic: false, description: 'Two values' },
  ],
};

const RUN_LENGTH_ENCODING: BankProblem = {
  key: 'run-length-encoding',
  title: 'Run-Length Encoding',
  difficulty: 'hard',
  tags: ['strings', 'loops', 'algorithms'],
  timeLimitSeconds: 2,
  memoryLimitMb: 256,
  inputFormat: 'A single line of at most 200 printable characters with no whitespace.',
  outputFormat: 'Print the compressed text: each run of identical characters becomes the character followed by its count.',
  description: `## Run-Length Encoding

Compress a string by replacing every run of identical characters with the character
followed by the length of that run.

### Input
A single line of at most 200 characters containing no whitespace.

### Output
Print the compressed text, followed by a newline. Counts are printed in decimal with
no separators between runs.

### Example
\`\`\`
Input        Output
aaabbc       a3b2c1
\`\`\`

### Notes
A run of length 1 still prints its count, so \`abc\` becomes \`a1b1c1\`. Counts of ten
or more print as multiple digits, for example ten \`z\` characters compress to
\`z10\`. The compressed form of an empty line is an empty line.`,
  sampleInput: 'aaabbc\n',
  sampleOutput: 'a3b2c1\n',
  referenceSolution: `#include <stdio.h>

int main(void) {
    int current = getchar();
    while (current == '\\n') current = getchar();

    while (current != EOF && current != '\\n') {
        int count = 0;
        int symbol = current;
        while (current == symbol) {
            count++;
            current = getchar();
        }
        printf("%c%d", symbol, count);
    }

    putchar('\\n');
    return 0;
}
`,
  testCases: [
    { input: 'aaabbc\n', expectedOutput: 'a3b2c1\n', isPublic: true, description: 'Statement example' },
    { input: 'abc\n', expectedOutput: 'a1b1c1\n', isPublic: true, description: 'Every run has length one' },
    { input: 'aaaa\n', expectedOutput: 'a4\n', isPublic: true, description: 'Single run' },
    { input: 'a\n', expectedOutput: 'a1\n', isPublic: false, description: 'Boundary: one character' },
    { input: 'aabbaa\n', expectedOutput: 'a2b2a2\n', isPublic: false, description: 'A run repeats after a different run' },
    {
      input: 'zzzzzzzzzz\n',
      expectedOutput: 'z10\n',
      isPublic: false,
      description: 'Multi-digit count',
    },
  ],
};

export const PROBLEM_BANK: BankProblem[] = [
  ARRAY_SUM,
  REVERSE_WORD,
  COUNT_VOWELS,
  SECOND_LARGEST,
  SORT_DESCENDING,
  MATRIX_TRANSPOSE,
  GCD_LCM,
  RUN_LENGTH_ENCODING,
];

export function findBankProblem(key: string): BankProblem | undefined {
  return PROBLEM_BANK.find((problem) => problem.key === key);
}

/** Deterministic pick so repeat generations rotate through the bank instead of repeating. */
export function pickBankProblem(options: { difficulty?: Difficulty; topics?: string[]; offset?: number }): BankProblem {
  const pool = PROBLEM_BANK.filter((problem) => {
    const difficultyOk = options.difficulty ? problem.difficulty === options.difficulty : true;
    const topicsOk =
      options.topics && options.topics.length > 0
        ? problem.tags.some((tag) =>
            options.topics!.some((topic) => topic.toLowerCase() === tag.toLowerCase()),
          )
        : true;
    return difficultyOk && topicsOk;
  });

  const candidates = pool.length > 0 ? pool : PROBLEM_BANK;
  const index = Math.abs(options.offset ?? 0) % candidates.length;
  return candidates[index]!;
}
