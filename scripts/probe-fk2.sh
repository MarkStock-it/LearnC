#!/bin/bash
mysql -h 127.0.0.1 -u s25103705_LearnC -pJumong09 s25103705_LearnC <<'SQL' 2>&1 | grep -v password
CREATE TABLE fktest2_a (id int unsigned NOT NULL AUTO_INCREMENT, name varchar(50), PRIMARY KEY (id));
CREATE TABLE fktest2_b (id int unsigned NOT NULL AUTO_INCREMENT, a_id int unsigned NOT NULL, INDEX a_id_idx (a_id), CONSTRAINT fk_b2_a FOREIGN KEY (a_id) REFERENCES fktest2_a (id) ON DELETE CASCADE, PRIMARY KEY (id));
SHOW WARNINGS;
DROP TABLE IF EXISTS fktest2_b;
DROP TABLE IF EXISTS fktest2_a;
SELECT 'FKTEST2-DONE';
SQL
