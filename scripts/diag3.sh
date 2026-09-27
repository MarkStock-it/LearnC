#!/bin/bash
echo "=== login as baljeetflow user, list databases ==="
mysql -h 127.0.0.1 -u s25103705_BaljeetFlow -pJumong09 -e "SHOW DATABASES;" 2>&1 | head -15
echo "=== grants ==="
mysql -h 127.0.0.1 -u s25103705_BaljeetFlow -pJumong09 -e "SHOW GRANTS FOR CURRENT_USER;" 2>&1 | head -5
echo "=== try learnc db variants ==="
for db in learnc s25103705_learnc; do
  mysql -h 127.0.0.1 -u s25103705_BaljeetFlow -pJumong09 -e "USE \`$db\`; SELECT 1;" 2>&1 | head -2 | sed "s/^/db=$db: /"
done
echo "=== try user s25103705_learnc ==="
mysql -h 127.0.0.1 -u s25103705_learnc -pJumong09 -e "SELECT 1;" 2>&1 | head -2
echo "=== can we create a database? (dry test as baljeetflow user) ==="
mysql -h 127.0.0.1 -u s25103705_BaljeetFlow -pJumong09 -e "CREATE DATABASE IF NOT EXISTS s25103705_learnc;" 2>&1 | head -3
echo "=== databases after create attempt ==="
mysql -h 127.0.0.1 -u s25103705_BaljeetFlow -pJumong09 -e "SHOW DATABASES;" 2>&1 | head -15
