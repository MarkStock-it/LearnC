#!/bin/bash
# The database password is read from the environment and never stored in this file.
: "${DCISM_DB_PASSWORD:?Set DCISM_DB_PASSWORD before calling this script}"
mysql -h 127.0.0.1 -u s25103705_LearnC -p"${DCISM_DB_PASSWORD}" s25103705_LearnC <<'SQL' 2>&1 | grep -v password
CREATE TABLE IF NOT EXISTS fktest_a (id int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, name varchar(50));
CREATE TABLE IF NOT EXISTS fktest_b (id int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, a_id int unsigned NOT NULL, CONSTRAINT fk_b_a FOREIGN KEY (a_id) REFERENCES fktest_a (id) ON DELETE CASCADE);
SHOW WARNINGS;
DROP TABLE IF EXISTS fktest_b;
DROP TABLE IF EXISTS fktest_a;
SELECT 'FKTEST-DONE';
SQL
