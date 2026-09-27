#!/bin/bash
echo "=== environment DB vars present? ==="
env | grep -E "^DB_|^NODE_ENV|^PORT|^EXECUTOR|^AI_" | head -10 || echo "none"
echo "=== run env -i style ==="
cd ~/learnc-app/backend
env -u DB_CLIENT node --input-type=module -e "
import { config } from './dist/config.js';
console.log('client (env -u DB_CLIENT):', config.db.client);
" 2>&1 | head -3
