#!/bin/bash
cd ~/learnc-app/backend || exit 1
test_import() {
  node --input-type=module -e "import '$1'" >/dev/null 2>&1
  code=$?
  echo "$1 -> exit $code"
}
test_import './dist/db/migrations/index.js'
test_import './dist/scripts/migrate.js'
test_import './dist/services/executor/localExecutor.js'
test_import './dist/services/executor/unshareExecutor.js'
test_import './dist/services/executor/dockerExecutor.js'
test_import './dist/services/executor/executor.js'
test_import './dist/services/aiService.js'
test_import './dist/queue/index.js'
test_import './dist/queue/inlineQueue.js'
test_import './dist/services/submissionProcessor.js'
