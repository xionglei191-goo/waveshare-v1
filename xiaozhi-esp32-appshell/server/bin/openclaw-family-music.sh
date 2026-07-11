#!/usr/bin/env bash
set -euo pipefail

base_url="${FAMILY_HUB_INTERNAL_URL:-http://127.0.0.1:${PORT:-3100}}"
timeout_sec="${FAMILY_HUB_TOOL_TIMEOUT_SEC:-6}"
token="${XIAOZHI_TOOL_TOKEN:-${AI_TOOL_TOKEN:-}}"

if [ -z "${token}" ]; then
  echo "XIAOZHI_TOOL_TOKEN is required for the music target" >&2
  exit 65
fi

curl -fsS -m "${timeout_sec}" \
  -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "family.media.play",
    "text": "播放服务器播客",
    "params": {
      "deviceId": "esp32-185b"
    }
  }' \
  "${base_url}/api/ai/xiaozhi/tool" >/dev/null

printf 'family.music media.server.play command queued via Xiaozhi tool gateway\n'
