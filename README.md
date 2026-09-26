# C Practice Platform

Web platform for exam-style C programming practice: exam bundles of problems, a
sandboxed compiler/runner, per-test-case grading with diff feedback, and an AI
problem generator. This README records what was built, how it was verified, and
where the implementation deliberately differs from the original engineering plan.

```
frontend/  React 18 + Vite + Tailwind SPA (problem viewer, editor, results console, dashboard)
backend/   Express + TypeScript API, submission pipeline, evaluators, sandbox adapters
executor/  Dockerfile for the gcc sandbox image that runs student code
```

## Quick start (no Docker, no database server required)

```bash
npm run install:all          # install backend + frontend dependencies
cp backend/.env.example backend/.env
npm run db:migrate           # create the schema (SQLite by default)
npm run db:seed              # load 2 exam bundles / 8 problems / 51 test cases
npm run api                  # http://127.0.0.1:4000
npm run web                  # http://127.0.0.1:5173  (proxies /api to the API)
```

`db:seed` is idempotent — re-running it adds only what is missing, so graded
submissions survive. It compiles every problem's reference solution and runs it
against all of its test cases before inserting anything: problems whose expected
outputs cannot be produced are logged and skipped rather than shipped. Flags:
`--skip-verify` to bypass the check, `--strict` to fail instead of skipping, and
`--force` to delete and rebuild the bundles (which also removes their submissions).
With npm, pass them through the backend script:
`npm --prefix backend run db:seed -- --force`.

Requirements: Node 20+ and a C compiler (`gcc`) on `PATH` or at a well-known location
(MSYS2 UCRT64 is auto-detected on Windows). Docker is optional and only used when a
daemon is reachable.

## How grading works

```
POST /api/submissions ──► insert row (QUEUED) ──► queue ──► worker
                                                             │
                        COMPILING ──► compile once in the sandbox
                                                             │
                        EXECUTING ──► run the binary per test case, compare stdout
                                                             │
                        COMPLETED  ──► verdicts persisted, GET /api/submissions/:id returns them
```

Client contract: submit, then poll `GET /api/submissions/:id` (the UI starts at
~700 ms and backs off to 1.5 s).

**Status semantics.** The plan is ambiguous between `FAILED`-means-bad-code and
`FAILED`-means-infrastructure. This implementation resolves it as:

| Outcome | Status | Why |
| --- | --- | --- |
| Compile error | `COMPLETED` + `compilationError` | The verdict is final; retrying cannot change it |
| Wrong answer / timeout / crash | `COMPLETED` + per-case `errorType` | Same |
| Sandbox or queue failure | `FAILED` + `errorMessage` | Retried up to 3× with exponential backoff first |

**Hidden test cases.** Public samples return input, expected output, actual output and
a line diff. Hidden cases return only pass/fail, runtime and stderr — never their
input or expectation, which would otherwise be one API call away.

**Output comparison.** CRLF and LF are equivalent, trailing whitespace per line is
ignored, and leading/trailing blank lines are trimmed; leading indentation is
preserved. This is not cosmetic: a Windows-compiled binary emits `\r\n`, and a
byte-exact judge fails correct programs on it.

## Sandbox

Two adapters satisfy the same interface, chosen by `EXECUTOR_MODE`:

| Mode | Behaviour | Use |
| --- | --- | --- |
| `docker` | Container per submission: 256 MB, 1 CPU, 64 PIDs, `NetworkMode: none`, all capabilities dropped, `no-new-privileges`, read-only input mount | Production (plan §6.1) |
| `local` | Host compiler with a wall-clock timeout, output caps and process-group kill | Development only; **no isolation** |
| `auto` (default) | Docker when the daemon answers, otherwise local with a loud warning | Local dev without Docker |

Limits are enforced per problem: the problem's own time limit (clamped by
`EXECUTOR_TIME_LIMIT_MS`), memory cap, PID cap and a bounded output budget. A
submission that loops forever is killed and reported as `TIMEOUT`; the API stays
responsive. The `local` mode is refused outright when `NODE_ENV=production`.

The selected sandbox is visible in `GET /api/health` and on every submission record,
so a grade is always attributable to the sandbox that produced it.

## AI problem generation

`POST /api/admin/generate-problem` (requires `x-admin-token: $ADMIN_TOKEN`) generates
a problem plus test cases using the §4.1/§4.2 prompts and validates the response with
Zod schemas. Two safeguards matter more than the prompting:

1. **Fallback, not failure.** With `AI_PROVIDER=offline`, or after
   `AI_MAX_ATTEMPTS` malformed responses, the curated problem bank is used instead,
   so the endpoint always returns something usable and the warnings say why.
2. **Expectation verification.** When the model returns a reference solution, it is
   compiled and run against every generated test case; disagreements are reported in
   `verification.detail` rather than silently stored.

## Configuration

See `backend/.env.example` for every variable. The ones that change behaviour most:

| Variable | Default | Effect |
| --- | --- | --- |
| `DB_CLIENT` | `better-sqlite3` | `pg` for PostgreSQL (the plan's target) |
| `QUEUE_DRIVER` | `inline` | `bull` for Redis-backed durable jobs + separate workers |
| `EXECUTOR_MODE` | `auto` | `docker` / `local` / `auto` |
| `AI_PROVIDER` | `offline` | `anthropic` to generate with a model |
| `ADMIN_TOKEN` | *(empty)* | Admin API is disabled until this is set |

## Production

```bash
export ADMIN_TOKEN=$(openssl rand -hex 16)
docker compose up --build          # postgres, redis, sandbox image, migrate, api, worker, web
docker compose run --rm seed       # optional: load the sample bundles
```

`docker-compose.yml` runs the API and worker with the host Docker socket mounted so
the sandbox can spawn sibling containers. That grants host-level access: acceptable on
a dedicated grading host, not for multi-tenant use — an isolated executor fleet is the
correct next step (plan §8.3).

## Tests

```bash
npm test              # backend: 40 tests (evaluation, sandbox, full API integration)
npm run typecheck     # backend + frontend
```

The integration suite drives the real Express app end to end: submit correct code →
poll → `COMPLETED` 7/7 → problem marked solved; submit an off-by-one solution → diffs
for public cases and no expectation leaks for hidden ones; submit non-compiling code;
submit an infinite loop and observe every case time out without hanging the API.

## Deviations from the plan (and why)

| Plan | Built | Reason |
| --- | --- | --- |
| Monaco editor | CodeMirror 6 (`@uiw/react-codemirror`) | §2.1 lists either; identical C highlighting without Vite worker plumbing, and it is code-split away from the dashboard |
| `react-diff-viewer` / `jsdiff` | Server-side diff, rendered by a small component | The grader already knows both outputs; shipping the diff lines removes a client dependency and keeps comparison logic in one place |
| Axios | `fetch` wrapper | Fewer dependencies; the client also owns the identity header for the MVP auth stub |
| Knex CLI migrations | Explicit ordered migration runner | The CLI is awkward with TypeScript + ESM; the runner tracks `schema_migrations` and works on both dialects |
| `ENUM` / array columns | `varchar` + JSON columns, validated by Zod | SQLite has neither, and the same schema then runs on both dialects unchanged |
| Bull + Redis, always | Pluggable queue (`inline` dev / `bull` prod) | Keeps dev and CI dependency-free while preserving the production path |
| Docker-only sandbox | Docker + explicitly-opted-in local fallback | Verifiable on a workstation without Docker; production refuses the fallback |
| JWT auth | `x-user-id` / `Bearer <username>` stub | Plan defers real auth; every query is already scoped by `req.user.id`, so swapping it in touches one middleware |

## Known gaps / next steps

- Docker and PostgreSQL paths are implemented but **not executable in this
  environment** (no Docker daemon, no Postgres): they are the production path and need
  a machine with those services to verify.
- `memory_used_mb` is always `null` — Docker enforces the cap and OOM-kills, but peak
  RSS is not collected yet (needs `container.stats()` or `getrusage`).
- No authentication beyond the stub, no instructor dashboard, no hint system, no
  plagiarism detection (plan §7.2), and no LTI/Canvas integration (plan §7.1).
- Frontend has no component tests; the API integration suite covers the grading flow.
