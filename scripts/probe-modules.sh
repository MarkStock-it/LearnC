#!/bin/bash
cd ~/learnc-app/backend || exit 1
for m in dotenv knex express cors pino pino-http zod bull dockerode pg better-sqlite3; do
  node -e "require('$m'); console.log('$m OK')" 2>&1 | tail -1
done
