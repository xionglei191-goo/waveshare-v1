# AI Enhancement Privacy And Parent Control

The Xiaozhi official AI link remains the primary wake word, ASR, LLM, TTS, OTA, and MQTT path. The local Family Hub backend only adds family tools, content recommendations, learning records, and optional memories.

## Stored Data

- Family memories: text, title, member id, visibility, tags, source, timestamps.
- Learning records: member id, type, title, score, progress, source, timestamps.
- Tool audit: action name, category, mode, member id, decision, status, reason.
- Content metadata: title, type, tags, language, pack id, version, checksum-backed files.

## Parent Controls

- Parents can view, edit, and delete memories through `/api/memory` or `/companion`.
- Parents can inspect learning records through `/api/learning/records`.
- Children, guests, and night mode cannot run OpenClaw or other restricted tools unless a parent/admin role explicitly overrides the policy.
- Unknown Remote UI actions and components are rejected or rendered inert on the ESP32.

## Failure Behavior

- If the Family Hub backend is offline, the ESP32 AppShell keeps local fallback pages usable.
- Xiaozhi official wake word and basic AI conversation do not depend on the Family Hub backend.
- Failed tool calls are recorded in audit/job history and surfaced as notifications rather than blocking the UI.
