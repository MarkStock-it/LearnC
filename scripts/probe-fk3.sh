#!/bin/bash
mysql -h 127.0.0.1 -u s25103705_LearnC -pJumong09 s25103705_LearnC <<'SQL' 2>&1 | grep -v password
CREATE TABLE fktest3_users (id int unsigned NOT NULL AUTO_INCREMENT, username varchar(255) NOT NULL, PRIMARY KEY (id));
CREATE TABLE fktest3_sets (id int unsigned NOT NULL AUTO_INCREMENT, created_by int unsigned NULL, CONSTRAINT fk_sets_user FOREIGN KEY (created_by) REFERENCES fktest3_users (id) ON DELETE SET NULL, PRIMARY KEY (id));
SHOW WARNINGS;
DROP TABLE IF EXISTS fktest3_sets;
DROP TABLE IF EXISTS fktest3_users;
SELECT 'FKTEST3-DONE';
SQL
