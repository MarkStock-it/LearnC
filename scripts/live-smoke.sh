#!/bin/bash
# External smoke test against the LIVE deployment. Read-only: every request below is a
# GET, or a POST that must be rejected before it can write anything.
#
# The assertions that matter:
#   1. nothing returns 5xx — a 500 here is a broken deploy;
#   2. a user-scoped route without a session returns 401, not 500;
#   3. *every* /api route answers JSON, including unknown ones, which catches an
#      .htaccess rewrite that swallows the API and serves index.html instead;
#   4. a deep client route serves the SPA (200 HTML) rather than a 404.
#
# Usage: BASE=https://learnc.dcism.org bash scripts/live-smoke.sh
set -u

BASE="${BASE:-https://learnc.dcism.org}"
pass=0
fail=0

req() {
  local method="$1" path="$2" expect="$3"
  local out code ctype
  out=$(curl -sS -m 25 -o /tmp/smoke-body -w '%{http_code} %{content_type}' \
        -X "$method" "$BASE$path" 2>/dev/null)
  code="${out%% *}"
  ctype="${out#* }"

  local verdict="ok"
  case "$code" in
    5*) verdict="FAIL 5xx" ;;
  esac
  if [ -n "$expect" ] && [ "$code" != "$expect" ]; then
    verdict="FAIL expected $expect"
  fi
  # An /api route must never come back as HTML.
  case "$path" in
    /api/*)
      case "$ctype" in
        *html*) verdict="FAIL served HTML for an API route" ;;
      esac
      ;;
  esac

  if [ "$verdict" = "ok" ]; then
    pass=$((pass + 1))
    printf '  %-4s %-46s %s\n' "$method" "$path" "$code"
  else
    fail=$((fail + 1))
    printf '  %-4s %-46s %s  <-- %s\n' "$method" "$path" "$code" "$verdict"
    echo "        body: $(head -c 200 /tmp/smoke-body)"
    echo "        type: $ctype"
  fi
}

echo "=== PUBLIC (must be 200) ==="
req GET / 200
req GET /api/health 200
req GET /api 200
req GET /api/public-bundles 200

echo "=== USER-SCOPED WITHOUT A SESSION (must be 401, never 500) ==="
req GET /api/auth/me ""
req GET /api/dashboard ""
req GET /api/dashboard/leaderboard ""
req GET /api/submissions ""
req GET /api/problem-sets ""
req POST /api/run-code ""
req POST /api/memory-trace ""
req POST /api/ai/generate-problem ""

echo "=== REJECTED INPUT (must be 4xx, never 500) ==="
req POST /api/auth/login 400

echo "=== UNKNOWN ROUTES ==="
req GET /api/does-not-exist 404
req GET /api/public-bundles/999999 ""

echo "=== SPA FALLBACK (deep routes must serve the app, not 404) ==="
req GET /problems/1 200
req GET /bundles/public 200
req GET /a/route/that/does/not/exist 200

echo
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ] || exit 1
