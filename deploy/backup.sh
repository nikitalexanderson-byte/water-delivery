#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."

directory="${1:-backups}"
mkdir -p -- "$directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$(mktemp "$directory/farvater-$timestamp.XXXXXX.partial")"
trap 'rm -f -- "$temporary"' EXIT
docker compose --env-file .env.vps -f deploy/compose.vps.yml exec -T db +  sh -ec 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$temporary"
docker compose --env-file .env.vps -f deploy/compose.vps.yml exec -T db pg_restore --list < "$temporary" > /dev/null
output="${temporary%.partial}.dump"
mv -- "$temporary" "$output"
printf '%s\n' "$output"
