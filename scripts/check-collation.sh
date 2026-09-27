#!/bin/bash
mysql -h 127.0.0.1 -u s25103705_LearnC -pJumong09 s25103705_LearnC <<'SQL' 2>&1 | grep -v password
SELECT @@collation_database, @@character_set_database, @@version;
SHOW COLLATION WHERE Collation LIKE 'utf8mb4%' AND Compiled='Yes';
SQL
echo "=== partially created tables ==="
mysql -h 127.0.0.1 -u s25103705_LearnC -pJumong09 s25103705_LearnC -e "SHOW TABLES;" 2>&1 | grep -v password
mysql -h 127.0.0.1 -u s25103705_LearnC -pJumong09 s25103705_LearnC -e "SHOW CREATE TABLE users\G" 2>&1 | grep -v password | head -12
