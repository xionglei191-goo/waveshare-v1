#!/usr/bin/env bash
set -euo pipefail

target="${1:-diagnostics}"
shift || true

openclaw_bin="${OPENCLAW_BIN:-/home/linuxbrew/.linuxbrew/bin/openclaw}"
node_path="${OPENCLAW_NODE_PATH:-/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/opt/node/bin}"
export PATH="${node_path}:${PATH}"

run_shell_command() {
  local command="$1"
  if [ -z "${command}" ]; then
    return 1
  fi
  exec /usr/bin/env bash -lc "${command}"
}

target_env_name() {
  printf 'OPENCLAW_TARGET_%s_COMMAND' "$(printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_')"
}

case "${target}" in
  diagnostics)
    custom_var="$(target_env_name "${target}")"
    custom_command="${!custom_var:-}"
    if [ -n "${custom_command}" ]; then
      run_shell_command "${custom_command}"
    fi
    echo "OpenClaw diagnostics target"
    "${openclaw_bin}" --version
    "${openclaw_bin}" status
    ;;
  default|music)
    custom_var="$(target_env_name "${target}")"
    custom_command="${!custom_var:-}"
    if [ -n "${custom_command}" ]; then
      run_shell_command "${custom_command}"
    fi
    echo "OpenClaw target '${target}' is allowed but has no command mapping yet." >&2
    echo "Set ${custom_var} to enable this target." >&2
    exit 64
    ;;
  *)
    echo "Unsupported OpenClaw target: ${target}" >&2
    exit 64
    ;;
esac
