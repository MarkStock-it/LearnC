#!/bin/bash
cd ~/learnc-app || exit 1
ls -la data/
node -e "
const db = require('better-sqlite3')('data/c-practice.sqlite');
const c = (t) => db.prepare('select count(*) as n from ' + t).get().n;
console.log(JSON.stringify({
  problem_sets: c('problem_sets'),
  problems: c('problems'),
  test_cases: c('test_cases'),
  users: c('users'),
  submissions: c('submissions')
}));
"
