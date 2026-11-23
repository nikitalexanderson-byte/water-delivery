#!/usr/bin/env bash
# Install this file outside the checkout as the SSH key's sole forced command.
set -euo pipefail
umask 077

fail() { printf 'Staging release: %s\n' "$*" >&2; exit 1; }
revision=${SSH_ORIGINAL_COMMAND:-}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail 'expected a single full Git commit SHA'
cd /opt/farvater
exec 9>.git/staging-release.lock
flock -w 600 9 || fail 'another release holds the lock'

[[ "$(git symbolic-ref --short HEAD)" == main ]] || fail 'checkout must be on main'
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail 'checkout contains local changes'
[[ -r .env.vps ]] || fail '.env.vps is missing'
git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main </dev/null
[[ "$(git rev-parse refs/remotes/origin/main)" == "$revision" ]] || fail 'requested revision is not the tip of origin/main'
git merge-base --is-ancestor HEAD "$revision" || fail 'checkout cannot fast-forward to origin/main'

mkdir -p -m 0755 downloads
incoming=$(mktemp --suffix=.apk downloads/.incoming-XXXXXXXX)
trap 'rm -f -- "$incoming"' EXIT
# Bound even a malformed upload before asking unzip to decompress the APK.
max_bytes=$((128 * 1024 * 1024))
head -c "$((max_bytes + 1))" > "$incoming"
size=$(stat -c %s -- "$incoming")
(( size > 0 && size <= max_bytes )) || fail 'APK size outside the allowed range'
python3 - "$incoming" <<'PY'
import sys
from zipfile import ZipFile

with ZipFile(sys.argv[1]) as apk:
    entries = apk.infolist()
    if len(entries) > 40000 or sum(item.file_size for item in entries) > 512 * 1024 * 1024:
        sys.exit("APK ZIP exceeds size limits")
    if not {"AndroidManifest.xml", "classes.dex"}.issubset(apk.namelist()):
        sys.exit("ZIP is missing required APK entries")
    if apk.testzip() is not None:
        sys.exit("APK ZIP has a damaged entry")
PY

compose=(docker compose --env-file .env.vps -f deploy/compose.vps.yml)
project=$("${compose[@]}" config --format json | python3 -c 'import json, sys; print(json.load(sys.stdin)["name"])')
db_container=$("${compose[@]}" ps --all --quiet db)
db_volume=$(docker volume ls --quiet --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.volume=postgres)
if [[ -n "$db_container" || -n "$db_volume" ]]; then
  "${compose[@]}" up --detach --wait --wait-timeout 120 db </dev/null
  bash deploy/backup.sh </dev/null
fi

git merge --ff-only "$revision" </dev/null
"${compose[@]}" config --quiet
"${compose[@]}" run --rm --no-deps -T --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null
"${compose[@]}" up --detach --build --wait --wait-timeout 300 </dev/null

# A file bind mount can retain the previous inode when Git replaces Caddyfile.
host_config=$(sha256sum deploy/Caddyfile)
mounted_config=$("${compose[@]}" exec -T caddy sha256sum /etc/caddy/Caddyfile </dev/null)
if [[ "${host_config%% *}" != "${mounted_config%% *}" ]]; then
  "${compose[@]}" up --detach --force-recreate --no-deps --wait --wait-timeout 120 caddy </dev/null
fi
"${compose[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null
chmod 0644 "$incoming"
mv -fT -- "$incoming" downloads/farvater-driver.apk
