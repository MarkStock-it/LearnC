#!/bin/bash
mysql -h 127.0.0.1 -u s25103705_LearnC -pJumong09 s25103705_LearnC <<'SQL' 2>&1 | grep -v password
SHOW CREATE TABLE problem_sets\G
SQL
