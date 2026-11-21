#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077

if [ ! -f .env ]; then
  port="${HTTPS_PORT:-8443}"
  cat > .env <<ENV
HTTPS_PORT=$port
APP_ORIGIN=https://localhost:$port
POSTGRES_ADMIN_PASSWORD=$(openssl rand -hex 24)
APP_DB_PASSWORD=$(openssl rand -hex 24)
IDENTITY_DB_PASSWORD=$(openssl rand -hex 24)
RABBIT_PASSWORD=$(openssl rand -hex 24)
KEYCLOAK_ADMIN_PASSWORD=$(openssl rand -hex 24)
KEYCLOAK_CLEANUP_SECRET=$(openssl rand -hex 24)
ENV
fi

if [ ! -f .local/tls/cert.pem ] || [ ! -f .local/tls/key.pem ]; then
  mkdir -p .local/tls
  chmod 0755 .local/tls
  openssl req -x509 -nodes -newkey rsa:3072 -sha256 -days 30 \
    -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -keyout .local/tls/key.pem -out .local/tls/cert.pem 2>/dev/null
  chmod 0644 .local/tls/key.pem .local/tls/cert.pem
fi

printf '%s\n' "Configuración local preparada. Ejecuta docker compose up --build -d."
