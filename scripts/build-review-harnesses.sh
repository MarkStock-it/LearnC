#!/usr/bin/env bash
# Build both design-review harnesses as self-contained HTML files:
#   design/quiz-review/index.html        — GeneratePage
#   design/workbench-review/index.html   — PracticePage (workbench) with a crashed
#                                          submission stubbed so the verdict,
#                                          Execution stack and Memory modal render.
set -euo pipefail
cd "$(dirname "$0")/../frontend"

# — quiz page harness —
npx vite build --config vite.review.config.ts
node - <<'EOF'
const fs = require('fs');
const p = '../design/quiz-review/review.html';
let html = fs.readFileSync(p, 'utf8');
const stub = fs.readFileSync('../design/quiz-stub.html', 'utf8');
html = html.replace('</head>', stub + '\n</head>');
fs.writeFileSync(p, html);
fs.renameSync(p, '../design/quiz-review/index.html');
console.log('quiz harness -> ../design/quiz-review/index.html');
EOF

# — workbench harness —
npx vite build --config vite.workbench-review.config.ts
node - <<'EOF'
const fs = require('fs');
const p = '../design/workbench-review/review-workbench.html';
let html = fs.readFileSync(p, 'utf8');
const stub = fs.readFileSync('../design/workbench-stub.html', 'utf8');
html = html.replace('</head>', stub + '\n</head>');
fs.writeFileSync(p, html);
fs.renameSync(p, '../design/workbench-review/index.html');
console.log('workbench harness -> ../design/workbench-review/index.html');
EOF
