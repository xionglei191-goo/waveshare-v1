#!/usr/bin/env bash
set -euo pipefail

base_url="${FAMILY_HUB_INTERNAL_URL:-http://127.0.0.1:${PORT:-3100}}"
timeout_sec="${FAMILY_HUB_TOOL_TIMEOUT_SEC:-4}"

curl -fsS -m "${timeout_sec}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "notification.push",
    "params": {
      "title": "OpenClaw",
      "message": "默认家庭任务已执行",
      "level": "info",
      "audience": "family"
    }
  }' \
  "${base_url}/api/action" >/dev/null

printf 'family.default notification created via Family Hub\n'
