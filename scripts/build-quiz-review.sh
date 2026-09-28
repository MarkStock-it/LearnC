#!/usr/bin/env bash
# Build the GeneratePage design-review harness: one self-contained HTML file
# (design/quiz-review/index.html) with the api stubbed at the fetch level.
set -euo pipefail
cd "$(dirname "$0")/../frontend"

npx vite build --config vite.review.config.ts

node - <<'EOF'
const fs = require('fs');
const p = '../design/quiz-review/review.html';
let html = fs.readFileSync(p, 'utf8');

const stub = `<script>
// ——— design-review harness: fake session + stubbed API ———
(function () {
  var withKey = new URLSearchParams(location.search).get('key') === '1';
  localStorage.setItem('c-practice.token', 'review-token');
  localStorage.setItem('c-practice.student', 'mark');
  var me = {
    user: { id: 1, username: 'mark', email: 'mark@example.edu' },
    ai: { userId: 1, hasPassword: true, hasGeminiKey: withKey, aiProvider: withKey ? 'gemini' : 'server' },
  };
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(new Response(JSON.stringify(me), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (url.includes('/generate-problem')) {
      var body = JSON.parse((init && init.body) || '{}');
      var n = body.problemCount || 1;
      var problems = [];
      for (var i = 0; i < n; i++) {
        problems.push({
          problemId: 100 + i,
          title: 'Sum of digits (review ' + (i + 1) + ')',
          difficulty: body.difficulty || 'easy',
          verificationPassed: true,
          verificationDetail: '',
          warnings: [],
        });
      }
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(new Response(JSON.stringify({
            count: n, problems: problems, problemSetId: 42, geminiError: null,
            notes: ['Reviewed harness response — not a real generation.'],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }, 900);
      });
    }
    return realFetch(input, init);
  };
})();
</script>`;

html = html.replace('</head>', stub + '\n</head>');
fs.writeFileSync(p, html);
fs.renameSync(p, '../design/quiz-review/index.html');
console.log('harness stub injected -> ../design/quiz-review/index.html');
EOF
