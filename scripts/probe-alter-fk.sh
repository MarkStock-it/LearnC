#!/bin/bash
# The database password is read from the environment and never stored in this file.
: "${DCISM_DB_PASSWORD:?Set DCISM_DB_PASSWORD before calling this script}"
mysql -h 127.0.0.1 -u s25103705_LearnC -p"${DCISM_DB_PASSWORD}" s25103705_LearnC <<'SQL' 2>&1 | grep -v password
CREATE TABLE alt_users (id int unsigned NOT NULL AUTO_INCREMENT, username varchar(255) NOT NULL, PRIMARY KEY (id));
CREATE TABLE alt_sets (id int unsigned NOT NULL AUTO_INCREMENT, created_by int unsigned NULL, PRIMARY KEY (id));
ALTER TABLE alt_sets ADD CONSTRAINT alt_sets_created_by_foreign FOREIGN KEY (created_by) REFERENCES alt_users (id) ON DELETE SET NULL;
SHOW WARNINGS;
SHOW ERRORS;
DROP TABLE IF EXISTS alt_sets;
DROP TABLE IF EXISTS alt_users;
SELECT 'ALTERTEST-DONE';
SQL
