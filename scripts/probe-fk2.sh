#!/bin/bash
# The database password is read from the environment and never stored in this file.
: "${DCISM_DB_PASSWORD:?Set DCISM_DB_PASSWORD before calling this script}"
mysql -h 127.0.0.1 -u s25103705_LearnC -p"${DCISM_DB_PASSWORD}" s25103705_LearnC <<'SQL' 2>&1 | grep -v password
CREATE TABLE fktest2_a (id int unsigned NOT NULL AUTO_INCREMENT, name varchar(50), PRIMARY KEY (id));
CREATE TABLE fktest2_b (id int unsigned NOT NULL AUTO_INCREMENT, a_id int unsigned NOT NULL, INDEX a_id_idx (a_id), CONSTRAINT fk_b2_a FOREIGN KEY (a_id) REFERENCES fktest2_a (id) ON DELETE CASCADE, PRIMARY KEY (id));
SHOW WARNINGS;
DROP TABLE IF EXISTS fktest2_b;
DROP TABLE IF EXISTS fktest2_a;
SELECT 'FKTEST2-DONE';
SQL
