#!/bin/bash
cd ~/learnc-app/backend || exit 1
for m in dist/config.js dist/utils/logger.js dist/db/knex.js dist/db/repositories.js dist/domain/problem.js dist/services/evaluationService.js dist/services/problemBank.js dist/services/executor/index.js dist/app.js; do
  node -e "import('./$m').then(()=>console.log('$m OK')).catch(e=>console.log('$m FAIL', e.message))" 2>&1 | tail -1
done
