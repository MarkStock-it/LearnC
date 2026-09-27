#!/bin/bash
cd ~/learnc-app/backend || exit 1
test_import() {
  node --input-type=module -e "import '$1'" >/dev/null 2>&1
  code=$?
  echo "$1 -> exit $code"
}
test_import './dist/db/knex.js'
test_import './dist/db/migrations/index.js'
test_import './dist/db/migrations/001_init.js'
test_import './dist/utils/logger.js'
test_import './dist/config.js'
