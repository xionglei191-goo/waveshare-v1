# 总体架构

Family AI OS 的核心不是 ESP32 单体设备，而是“圆屏 + 后端 + 手机 App”的家庭 AI 生态。

## 系统视图

```text
                         Mobile App (reserved)
          management / provisioning / diagnostics / network proxy
                                  |
                                  v
┌─────────────────────────────────────────────────────────┐
│                Family Backend / Capability Hub           │
│  data / permissions / resources / tools / device command │
└─────────────────────────────────────────────────────────┘
                  ^                         |
                  | safe tools              | commands / state / UI JSON
                  |                         v
┌────────────────────────────────┐   ┌────────────────────────────────┐
│ Voice Providers                │   │ ESP32 Round Screen Terminal     │
│ - self-hosted server (primary) │   │ display / touch / mic / speaker │
│ - Xiaozhi official (fallback)  │   │ local fallback / SD / ACK       │
│ - future custom voice gateway  │   └────────────────────────────────┘
└────────────────────────────────┘
                  ^
                  | ask / tool call
                  v
┌─────────────────────────────────────────────────────────┐
│                    Custom AI Service                    │
│ Page Agents / Router fallback / memory / knowledge base │
└─────────────────────────────────────────────────────────┘
```

## Role Boundaries

### ESP32 Round Screen Terminal

The round screen is a thin family interaction terminal.

It does:

- Render stable LVGL UI.
- Capture touch/button/voice-entry context.
- Show local fallback pages when the backend is unavailable.
- Play local SD audio and server audio streams.
- Show AI status, notifications, toast and action feedback.
- Poll or receive device commands, execute them, and ACK.

It does not:

- Own business logic.
- Search content.
- Manage subscriptions, permissions, knowledge, user profiles or schedules.
- Run Agent logic or LLM inference.
- Host a growing tool registry.
- Render HTML/CSS/JavaScript.

### Family Backend / Capability Hub

The backend owns state, tools and execution.

It does:

- Media library, podcasts, progress, favorites and queue.
- Content packs, resources, SD manifest and import.
- Family members, roles, modes, policy and audit.
- Schedules, notifications, memory and learning records.
- OpenClaw, Home Assistant, NAS and future integrations.
- Device command queue and ACK history.
- Admin UI, companion UI and future mobile API.

It exposes capabilities, not raw dangerous APIs, to AI.

### Custom AI Service

The custom AI service is the future long-term family brain.

It does:

- Multi-user identity and role-aware conversation.
- Personality and preference profiles.
- Family memory and knowledge base retrieval.
- Page Agent First routing.
- Tool planning through backend capabilities.
- Safe speech/display/action response generation.

It should call Family Backend tools instead of directly manipulating device or database state.

### Voice Providers

Voice providers are replaceable runtime entrances. A single active Voice Provider serves each voice session, chosen at connect time — the realtime voice WebSocket endpoint is never switched per page.

Primary:

- The **Self-Hosted Voice Server** (self-hosted `xinnan-tech/xiaozhi-esp32-server` on the family LAN) is the primary Voice Provider.
- It runs the realtime pipeline and invokes the deterministic Page Router after final ASR, before the ordinary LLM path.
- It is a replaceable runtime voice entrance, not the product backend. It delegates all family decisions to the Family Backend and does not own agents, policy, tools or execution.

Fallback:

- **Official Xiaozhi** remains the low-latency fallback Voice Provider (wake word / ASR / TTS / conversation).
- The device connects to Official Xiaozhi only when the self-hosted path is unavailable at connect time.

Optional future:

- A custom voice gateway may be added later.

The device points at the Self-Hosted Voice Server through `Settings("wifi").ota_url` (`http://<host>:8003/xiaozhi/ota/`). The verified 246 deployment advertises `ws://<host>:8100/xiaozhi/v1/`. `CONFIG_OTA_URL` remains the official Xiaozhi discovery endpoint used only for connection-time fallback.

#### Current-page propagation and Page Agent routing

For a voice request on the current page to reach that page's agent, the device reports its current one-level page and family mode to the voice server:

- The device exposes `self.page.get_context`, returning `page`, `familyMode`, logical `deviceId` and page-local `pageState` (`currentTrackId` or `currentScheduleId` when available).
- The voice server reads `self.page.get_context` over the existing device MCP channel at tool-invocation time, so it always uses the most recent page and mode.
- Page changes are reflected live: navigation updates the device page state, and the MCP tool reads it on demand, so no separate push is needed.

Page Key is the normalized lowercase backend key derived from the device page enum:

| Device page | Page Key | Backend Page Agent |
| --- | --- | --- |
| kAskAi | ai | general |
| kMusicLocal / kMusicServer | music | media |
| kContent | album | album |
| kSettings / kSettings* | settings | device |
| kApps | apps | tools |
| kHome | home | home |
| kWeather | weather | weather |
| kSchedule | schedule | schedule |
| kEnglishPractice | english | english |
| kScreensaver / kNotifications / kFamilyMode | home | home |
| kMiniGame | apps | tools |

On each turn, the Provider's Page Router calls `self.page.get_context`, then POSTs to `/api/agent/ask`. `handled=true` is spoken directly; `handled=false`, MCP timeout or backend timeout falls through exactly once to the Provider LLM. The compatibility `family_agent_ask` plugin remains installed but is not advertised to the ordinary LLM, preventing duplicate execution.

#### Latency target and Streaming Profile

The self-hosted provider targets a Time To First Audio (from end of user speech to first audio packet played on the device) of 1500 ms or less under normal LAN conditions.

This requires the Streaming Profile:

- Streaming ASR (final transcript fires quickly after VAD end).
- A fast time-to-first-token, function-calling LLM.
- Streaming TTS (synthesis begins on the first sentence, not the full text).
- Intent mode `function_call`, so tool selection is inline in the LLM turn rather than an extra serial LLM classification hop.

When the user speaks during playback, the server aborts the current TTS to allow barge-in and may take a short cleanup delay before accepting new input.

#### Fallback behavior

A single active Voice Provider is used per session. Fallback is decided at three points:

- **Connect-time (device):** the custom OTA endpoint is tried twice. If OTA or the learned voice channel cannot connect, the device fetches `CONFIG_OTA_URL` and uses the returned Official Xiaozhi WebSocket or MQTT configuration for that session.
- **Mid-turn (server):** if the Family Backend `POST /api/agent/ask` is unreachable, the self-hosted server answers from its own LLM as a general spoken answer, without a backend tool action and without telling the user that backend-dependent features are reduced.
- **Recovery:** before the next voice session, the device re-queries the self-hosted OTA endpoint with a 30-second probe cooldown. Provider switching never occurs during ASR or TTS.

### Mobile App

The mobile app is reserved as management and connectivity companion.

It does:

- Wi-Fi/BluFi provisioning.
- Device binding.
- Logs and diagnostics.
- Resource/content import.
- Family settings and permissions.
- Out-of-home access.
- Future BLE or phone-network proxy.

## Page Agent First

Each first-level page has a default Page Agent. Page interactions go directly to that Agent before using a global router.

| Page | Default Agent | Default Meaning Of Short Commands |
| --- | --- | --- |
| Home | Home Agent | Continue recent family task |
| AI | General Agent | Continue conversation |
| Weather | Weather Agent | Refresh weather/environment |
| Schedule | Schedule Agent | Today, next item, complete, snooze |
| Music | Media Agent | Play, resume, next, stop, favorite |
| Album | Album Agent | Slideshow, screensaver, photo status |
| English | English Agent | Continue practice, start speaking |
| Apps | Tools Agent | Open tool/game, run safe household action |
| Settings | Device Agent | Device status, diagnostics, network/storage |

Router fallback only handles:

- Home and AI page broad requests.
- A Page Agent deciding the request belongs to another domain.
- Ambiguous requests that need disambiguation.

## Request Flow

Normal page-local flow:

```text
ESP32 page + user input
  -> current Page Agent
  -> Policy Engine
  -> Capability Tool
  -> Action Executor
  -> device command / backend state
  -> speech + display + action result
```

Cross-domain fallback:

```text
Page Agent
  -> handoff to Router
  -> target Domain Agent
  -> Policy Engine
  -> Capability Tool
```

## AI-native Backend Rule

Every important backend capability should have:

- Traditional API/admin entry.
- Safe AI tool entry.
- Policy rule.
- Audit record.
- Clear response shape: `speech`, `display`, `actions`, `state`.

But AI must not receive broad CRUD access. Dangerous operations such as delete, rename, subscription management, OpenClaw, Home Assistant and external search require explicit capability wrappers and role/mode checks.

## Connectivity

Business logic must not bind directly to Wi-Fi.

Provider model:

1. Wi-Fi: normal home operation.
2. BLE/BluFi: provisioning and future companion path.
3. USB: development, diagnostics and import.
4. Phone proxy: future no-Wi-Fi bridge.
5. Cellular: future optional hardware.

ESP32 modules should ask a connectivity layer for request/stream/download/sync instead of assuming a specific network.

## Current Implementation Position

Implemented today:

- ESP32 AppShell and local fallback pages.
- Family Backend with admin UI, media center, device commands and tool gateway.
- Xiaozhi official tool gateway to backend.
- Server podcast/media as the best current sample capability.

Next architectural work:

- Add custom AI Service V1.
- Register Page Agents and capability tools explicitly.
- Move existing ad hoc intent/action logic behind the Agent/Capability layer.
- Keep ESP32 protocol thin.
