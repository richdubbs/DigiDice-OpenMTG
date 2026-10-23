#!/bin/sh
# Runs once, at the development database's first start (the postgres image's /docker-entrypoint-initdb.d; docker-compose.dev.yml): makes the role the
# hosted server connects as. It may log in and nothing else; `ops migrate --grant openmtg_service` (run with the owner's role) gives it the rights on the
# tables the migrations make, never the right to change the schema (design 11). The password comes from the environment, never from this file.
set -eu
: "${OPENMTG_SERVICE_PASSWORD:?OPENMTG_SERVICE_PASSWORD is not set}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pw="$OPENMTG_SERVICE_PASSWORD" <<'SQL'
CREATE ROLE openmtg_service LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE openmtg TO openmtg_service;
GRANT USAGE ON SCHEMA public TO openmtg_service;
SQL
