#!/usr/bin/env bash
set -euo pipefail

DEPLOY_BASE="${DEPLOY_BASE:-/opt/xiaozhi-family-hub}"
DB_FILE="${SQLITE_FILE:-${DEPLOY_BASE}/shared/data/family-hub.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-${DEPLOY_BASE}/backups/sqlite}"
DAILY_KEEP="${DAILY_KEEP:-14}"
WEEKLY_KEEP="${WEEKLY_KEEP:-8}"

mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/weekly"

if [[ ! -f "${DB_FILE}" ]]; then
  echo "SQLite database not found: ${DB_FILE}" >&2
  exit 0
fi

timestamp="$(date -u +%Y%m%d%H%M%S)"
daily="${BACKUP_DIR}/daily/family-hub-${timestamp}.sqlite"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB_FILE}" ".backup '${daily}'"
  result="$(sqlite3 "${daily}" 'PRAGMA integrity_check;')"
  if [[ "${result}" != "ok" ]]; then
    echo "SQLite integrity check failed for ${daily}: ${result}" >&2
    exit 1
  fi
else
  cp "${DB_FILE}" "${daily}"
fi

weekday="$(date -u +%u)"
if [[ "${weekday}" == "1" ]]; then
  cp "${daily}" "${BACKUP_DIR}/weekly/$(basename "${daily}")"
fi

find "${BACKUP_DIR}/daily" -type f -name 'family-hub-*.sqlite' -printf '%T@ %p\n' |
  sort -rn |
  awk -v keep="${DAILY_KEEP}" 'NR > keep { print $2 }' |
  xargs -r rm -f

find "${BACKUP_DIR}/weekly" -type f -name 'family-hub-*.sqlite' -printf '%T@ %p\n' |
  sort -rn |
  awk -v keep="${WEEKLY_KEEP}" 'NR > keep { print $2 }' |
  xargs -r rm -f

echo "SQLite backup ok: ${daily}"
