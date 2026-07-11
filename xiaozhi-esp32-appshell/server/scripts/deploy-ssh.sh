#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-192.168.31.246}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"
DEPLOY_BASE="${DEPLOY_BASE:-/opt/xiaozhi-family-hub}"
DEPLOY_PORT="${DEPLOY_PORT:-3100}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://wave.xionglei.online}"
FAMILY_SERVICE="${FAMILY_SERVICE:-xiaozhi-family-hub.service}"
MCP_SERVICE="${MCP_SERVICE:-xiaozhi-mcp-bridge.service}"
VOICE_PROVIDER_SERVICE="${VOICE_PROVIDER_SERVICE:-}"
VOICE_PROVIDER_CONTAINER="${VOICE_PROVIDER_CONTAINER:-xiaozhi-voice-provider}"
VOICE_PROVIDER_HOST_FILE="${VOICE_PROVIDER_HOST_FILE:-/home/xionglei/xiaozhi-esp32-server/main/xiaozhi-server/plugins_func/functions/family_agent_ask.py}"
NODE_BIN="${NODE_BIN:-/opt/node-v22/bin/node}"
NPM_BIN="${NPM_BIN:-/opt/node-v22/bin/npm}"
SKIP_LOCAL_TESTS="${SKIP_LOCAL_TESTS:-0}"
SKIP_REMOTE_SMOKE="${SKIP_REMOTE_SMOKE:-0}"
REMOTE_SMOKE_ATTEMPTS="${REMOTE_SMOKE_ATTEMPTS:-15}"
DRY_RUN="${DRY_RUN:-0}"
ROLLBACK="${ROLLBACK:-0}"
ROLLBACK_RELEASE="${ROLLBACK_RELEASE:-}"
ROLLBACK_DB="${ROLLBACK_DB:-}"

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GIT_SHA="$(git -C "${ROOT_DIR}" rev-parse --short=12 HEAD 2>/dev/null || echo nogit)"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)-${GIT_SHA}}"
REMOTE_RELEASE="${DEPLOY_BASE}/releases/${RELEASE_ID}"
REMOTE_CURRENT="${DEPLOY_BASE}/current"
REMOTE_SHARED="${DEPLOY_BASE}/shared"

log() {
  printf '[deploy] %s\n' "$*"
}

run_local() {
  log "+ $*"
  if [[ "${DRY_RUN}" == "1" ]]; then
    return 0
  fi
  "$@"
}

run_remote() {
  local command="$1"
  log "+ ssh ${REMOTE} ${command}"
  if [[ "${DRY_RUN}" == "1" ]]; then
    return 0
  fi
  ssh "${REMOTE}" "${command}"
}

remote_script() {
  log "+ ssh ${REMOTE} <script>"
  if [[ "${DRY_RUN}" == "1" ]]; then
    sed 's/^/[remote] /'
    return 0
  fi
  ssh "${REMOTE}" "bash -s" "$@"
}

run_local_tests() {
  if [[ "${SKIP_LOCAL_TESTS}" == "1" ]]; then
    log "Skipping local tests by SKIP_LOCAL_TESTS=1"
    return
  fi
  run_local bash -lc "cd '${ROOT_DIR}' && npm run check && npm test && npm run smoke && npm run smoke:sqlite && npm run smoke:sqlite:relational && npm run test:weather && python3 -m pytest voice-provider/tests/test_family_agent_ask.py"
}

ensure_remote_layout() {
  remote_script <<EOF
set -euo pipefail
sudo mkdir -p '${DEPLOY_BASE}/releases' '${REMOTE_SHARED}/data' '${REMOTE_SHARED}/resources' '${REMOTE_SHARED}/secrets' '${DEPLOY_BASE}/backups/sqlite' '${DEPLOY_BASE}/backups/releases'
if [[ ! -f '${REMOTE_SHARED}/data/family-hub.sqlite' && -f '${DEPLOY_BASE}/data/family-hub.sqlite' ]]; then
  sudo cp -a '${DEPLOY_BASE}/data/.' '${REMOTE_SHARED}/data/'
fi
if [[ -d '${DEPLOY_BASE}/data/resources' && -z "\$(find '${REMOTE_SHARED}/resources' -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  sudo cp -a '${DEPLOY_BASE}/data/resources/.' '${REMOTE_SHARED}/resources/'
fi
if [[ -d '${DEPLOY_BASE}/secrets' && -z "\$(find '${REMOTE_SHARED}/secrets' -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  sudo cp -a '${DEPLOY_BASE}/secrets/.' '${REMOTE_SHARED}/secrets/'
fi
sudo chown -R xiaozhi:xiaozhi '${REMOTE_SHARED}' '${DEPLOY_BASE}/backups' 2>/dev/null || true
sudo chown -R '${DEPLOY_USER}':xiaozhi '${DEPLOY_BASE}/releases' 2>/dev/null || true
sudo chmod 0755 '${DEPLOY_BASE}' '${DEPLOY_BASE}/releases' '${REMOTE_SHARED}'
EOF
}

backup_remote_state() {
  remote_script <<EOF
set -euo pipefail
ts="\$(date -u +%Y%m%d%H%M%S)"
if [[ -L '${REMOTE_CURRENT}' ]]; then
  current_target="\$(readlink '${REMOTE_CURRENT}')"
  printf '%s\n' "\${current_target}" | sudo tee '${DEPLOY_BASE}/backups/releases/previous-\${ts}.txt' >/dev/null
elif [[ -f '${DEPLOY_BASE}/index.js' ]]; then
  legacy_release='${DEPLOY_BASE}/releases/pre-${RELEASE_ID}'
  mkdir -p "\${legacy_release}"
  rsync -a --delete --exclude releases --exclude shared --exclude backups --exclude data --exclude secrets --exclude logs '${DEPLOY_BASE}/' "\${legacy_release}/"
  printf '%s\n' "\${legacy_release}" | sudo tee '${DEPLOY_BASE}/backups/releases/previous-\${ts}.txt' >/dev/null
fi
db='${REMOTE_SHARED}/data/family-hub.sqlite'
if [[ -f "\${db}" ]]; then
  backup='${DEPLOY_BASE}/backups/sqlite/pre-${RELEASE_ID}.sqlite'
  if command -v sqlite3 >/dev/null 2>&1; then
    sudo -u xiaozhi sqlite3 "\${db}" ".backup '\${backup}'"
    result="\$(sudo -u xiaozhi sqlite3 "\${backup}" 'PRAGMA integrity_check;')"
    test "\${result}" = "ok"
  else
    cp "\${db}" "\${backup}"
  fi
fi
EOF
}

sync_release() {
  run_remote "mkdir -p '${REMOTE_RELEASE}'"
  log "+ rsync -> ${REMOTE}:${REMOTE_RELEASE}/"
  if [[ "${DRY_RUN}" != "1" ]]; then
    rsync -az --delete \
      --exclude node_modules \
      --exclude data \
      --exclude logs \
      --exclude secrets \
      --exclude '*.log' \
      "${ROOT_DIR}/" "${REMOTE}:${REMOTE_RELEASE}/"
  fi
}

install_and_check_remote() {
  remote_script <<EOF
set -euo pipefail
cd '${REMOTE_RELEASE}'
sudo bash scripts/install-node-runtime.sh
export PATH='/opt/node-v22/bin':"\${PATH}"
'${NPM_BIN}' ci --omit=dev
'${NPM_BIN}' run check
mkdir -p '${REMOTE_SHARED}/data' '${REMOTE_SHARED}/resources' '${REMOTE_SHARED}/secrets'
rm -rf data resources
ln -sfn '${REMOTE_SHARED}/data' data
ln -sfn '${REMOTE_SHARED}/resources' resources
EOF
}

install_service_units() {
  remote_script <<EOF
set -euo pipefail
sudo install -m 0644 '${REMOTE_RELEASE}/deploy/xiaozhi-family-hub.service' /etc/systemd/system/xiaozhi-family-hub.service
sudo install -m 0644 '${REMOTE_RELEASE}/deploy/xiaozhi-mcp-bridge.service' /etc/systemd/system/xiaozhi-mcp-bridge.service
sudo install -m 0644 '${REMOTE_RELEASE}/deploy/xiaozhi-family-hub-backup.service' /etc/systemd/system/xiaozhi-family-hub-backup.service
sudo install -m 0644 '${REMOTE_RELEASE}/deploy/xiaozhi-family-hub-backup.timer' /etc/systemd/system/xiaozhi-family-hub-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now xiaozhi-family-hub-backup.timer
EOF
}

sync_voice_provider_plugin() {
  remote_script <<EOF
set -euo pipefail
source_file='${REMOTE_RELEASE}/voice-provider/plugins_func/functions/family_agent_ask.py'
target_file='${VOICE_PROVIDER_HOST_FILE}'
if [[ -f "\${source_file}" && -f "\${target_file}" ]] && ! cmp -s "\${source_file}" "\${target_file}"; then
  cp "\${target_file}" "\${target_file}.bak-${RELEASE_ID}"
  install -m 0644 "\${source_file}" "\${target_file}"
  if docker inspect '${VOICE_PROVIDER_CONTAINER}' >/dev/null 2>&1; then
    docker restart '${VOICE_PROVIDER_CONTAINER}' >/dev/null
  fi
fi
if docker inspect '${VOICE_PROVIDER_CONTAINER}' >/dev/null 2>&1; then
  test "\$(docker inspect -f '{{.State.Running}}' '${VOICE_PROVIDER_CONTAINER}')" = "true"
fi
EOF
}

switch_release_and_restart() {
  remote_script <<EOF
set -euo pipefail
sudo ln -sfn '${REMOTE_RELEASE}' '${REMOTE_CURRENT}'
sudo systemctl daemon-reload
sudo systemctl restart '${FAMILY_SERVICE}'
sudo systemctl restart '${MCP_SERVICE}'
if [[ -n '${VOICE_PROVIDER_SERVICE}' ]]; then
  sudo systemctl restart '${VOICE_PROVIDER_SERVICE}'
fi
sudo systemctl is-active --quiet '${FAMILY_SERVICE}'
sudo systemctl is-active --quiet '${MCP_SERVICE}'
EOF
}

remote_smoke() {
  if [[ "${SKIP_REMOTE_SMOKE}" == "1" ]]; then
    log "Skipping remote smoke by SKIP_REMOTE_SMOKE=1"
    return
  fi
  local failed=0
  smoke_url "http://${DEPLOY_HOST}:${DEPLOY_PORT}/api/health" || failed=1
  smoke_url "http://${DEPLOY_HOST}:${DEPLOY_PORT}/api/device/summary" || failed=1
  smoke_url "http://${DEPLOY_HOST}:${DEPLOY_PORT}/api/agent/capabilities" || failed=1
  if [[ -n "${PUBLIC_BASE_URL}" ]]; then
    smoke_url "${PUBLIC_BASE_URL%/}/api/health" || failed=1
  fi
  return "${failed}"
}

smoke_url() {
  local url="$1"
  local attempt
  log "+ curl (up to ${REMOTE_SMOKE_ATTEMPTS} attempts) ${url}"
  if [[ "${DRY_RUN}" == "1" ]]; then
    return 0
  fi
  for ((attempt = 1; attempt <= REMOTE_SMOKE_ATTEMPTS; attempt += 1)); do
    if curl --fail --silent --show-error --output /dev/null "${url}"; then
      return 0
    fi
    sleep 1
  done
  log "Smoke failed after ${REMOTE_SMOKE_ATTEMPTS} attempts: ${url}"
  return 1
}

rollback() {
  local release="${ROLLBACK_RELEASE}"
  if [[ -z "${release}" ]]; then
    release="$(ssh "${REMOTE}" "ls -1dt '${DEPLOY_BASE}'/releases/* 2>/dev/null | sed -n '2p'")"
  elif [[ "${release}" != /* ]]; then
    release="${DEPLOY_BASE}/releases/${release}"
  fi
  if [[ -z "${release}" ]]; then
    echo "No rollback release found. Set ROLLBACK_RELEASE=<release-id-or-path>." >&2
    exit 2
  fi
  remote_script <<EOF
set -euo pipefail
test -d '${release}'
sudo ln -sfn '${release}' '${REMOTE_CURRENT}'
if [[ -n '${ROLLBACK_DB}' ]]; then
  test -f '${ROLLBACK_DB}'
  sudo systemctl stop '${FAMILY_SERVICE}' || true
  sudo rm -f '${REMOTE_SHARED}/data/family-hub.sqlite-wal' '${REMOTE_SHARED}/data/family-hub.sqlite-shm'
  sudo cp '${ROLLBACK_DB}' '${REMOTE_SHARED}/data/family-hub.sqlite'
  sudo chown xiaozhi:xiaozhi '${REMOTE_SHARED}/data/family-hub.sqlite'
fi
sudo systemctl daemon-reload
sudo systemctl restart '${FAMILY_SERVICE}'
sudo systemctl restart '${MCP_SERVICE}'
if [[ -f '${VOICE_PROVIDER_HOST_FILE}.bak-${RELEASE_ID}' ]]; then
  cp '${VOICE_PROVIDER_HOST_FILE}.bak-${RELEASE_ID}' '${VOICE_PROVIDER_HOST_FILE}'
  if docker inspect '${VOICE_PROVIDER_CONTAINER}' >/dev/null 2>&1; then
    docker restart '${VOICE_PROVIDER_CONTAINER}' >/dev/null
  fi
fi
sudo systemctl is-active --quiet '${FAMILY_SERVICE}'
sudo systemctl is-active --quiet '${MCP_SERVICE}'
EOF
  remote_smoke
  log "Rollback ok: ${release}"
}

deploy() {
  log "Deploying ${RELEASE_ID} to ${REMOTE}:${DEPLOY_BASE}"
  run_local_tests
  run_remote "echo ok >/dev/null"
  ensure_remote_layout
  backup_remote_state
  local previous_release
  previous_release="$(ssh "${REMOTE}" "if [ -L '${REMOTE_CURRENT}' ]; then readlink '${REMOTE_CURRENT}'; else ls -1dt '${DEPLOY_BASE}'/releases/pre-${RELEASE_ID} 2>/dev/null | head -1; fi")"
  sync_release
  install_and_check_remote
  install_service_units
  sync_voice_provider_plugin
  if ! switch_release_and_restart || ! remote_smoke; then
    log "Deployment verification failed; rolling back to ${previous_release}"
    ROLLBACK_RELEASE="${previous_release}" ROLLBACK_DB="${DEPLOY_BASE}/backups/sqlite/pre-${RELEASE_ID}.sqlite" rollback
    exit 1
  fi
  log "Deploy ok: ${PUBLIC_BASE_URL%/}/api/health"
}

if [[ "${ROLLBACK}" == "1" ]]; then
  rollback
else
  deploy
fi
