#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --quiet \
  --set ON_ERROR_STOP=1 --set app_password="$APP_DB_PASSWORD" --set identity_password="$IDENTITY_DB_PASSWORD" <<'SQL'
CREATE USER ritmo_app WITH PASSWORD :'app_password';
CREATE USER ritmo_identity WITH PASSWORD :'identity_password';
CREATE DATABASE ritmo_app OWNER ritmo_app;
CREATE DATABASE ritmo_identity OWNER ritmo_identity;
REVOKE CONNECT ON DATABASE ritmo_app FROM PUBLIC;
REVOKE CONNECT ON DATABASE ritmo_identity FROM PUBLIC;
SQL
