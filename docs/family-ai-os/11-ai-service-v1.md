# AI Service V1 Design

This document turns the Agent Layer principles into the first implementable backend contract.

## Goal

AI Service V1 should prove that Family AI OS can use its own family brain without replacing Xiaozhi's fast voice path.

V1 focuses on:

- Page Agent First.
- Media Agent, Device Agent and Tools Agent as first working agents.
- Capability Tool Registry.
- Role/mode policy.
- Family memory read/write.
- Clear `speech + display + actions` response.

V1 does not need to solve:

- Full natural-language planning.
- Vector database retrieval.
- Multi-turn long conversation.
- Custom ASR/TTS.
- Mobile App native implementation.

## Public API

### `POST /api/agent/ask`

Main entry for page-local AI interaction.

Request:

```json
{
  "requestId": "optional-client-id",
  "deviceId": "esp32-185b",
  "page": "music",
  "inputType": "voice",
  "utterance": "继续",
  "user": {
    "id": "child",
    "role": "child",
    "name": "孩子"
  },
  "familyMode": "儿童",
  "pageState": {
    "currentTrackId": "optional"
  },
  "deviceState": {
    "online": true,
    "batteryPercent": 80
  }
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "agent": "media",
    "intent": "media.resume",
    "confidence": 0.95,
    "speech": "好的，继续播放上次没听完的故事。",
    "display": {
      "page": "music",
      "toast": "继续播放"
    },
    "actions": [
      {
        "tool": "family.media.resume",
        "status": "accepted",
        "result": {
          "commandId": "cmd_..."
        }
      }
    ],
    "handoff": null,
    "requiresConfirmation": false,
    "auditId": "audit_..."
  }
}
```

Failure response:

```json
{
  "ok": false,
  "error": "child mode does not allow external search",
  "data": {
    "speech": "儿童模式下不能搜索外部音频。",
    "display": {
      "toast": "权限限制"
    },
    "auditId": "audit_..."
  }
}
```

### `GET /api/agent/capabilities`

Returns registered Agents and tools for diagnostics/admin/mobile.

Response:

```json
{
  "ok": true,
  "data": {
    "agents": [
      {
        "id": "media",
        "page": "music",
        "tools": ["family.media.play", "family.media.resume"]
      }
    ],
    "tools": [
      {
        "name": "family.media.resume",
        "risk": "low",
        "roles": ["parent", "child"],
        "modes": ["默认", "儿童"]
      }
    ]
  }
}
```

### `POST /api/agent/tools/:name`

Direct safe tool execution for admin/mobile tests. It still runs policy and audit.

Request:

```json
{
  "args": {
    "deviceId": "esp32-185b"
  },
  "user": {
    "id": "parent",
    "role": "parent"
  },
  "familyMode": "默认",
  "source": "admin"
}
```

## Xiaozhi MCP Tool

Expose one high-level tool:

```text
family.agent.ask
```

Arguments:

- `text`: user utterance.
- `page`: optional current page. Defaults to `ai` if unknown.
- `deviceId`: target device.
- `userId`: optional.
- `role`: optional.
- `familyMode`: optional.

This lets Xiaozhi call the custom AI service while still allowing existing direct tools such as `family.media.play` during migration.

> The self-hosted Voice Provider invokes `family.agent.ask` with the fuller, page-routing schema described in the next section (`page` + `familyMode` are required and come from device context). The argument list above is the migration-era form retained for the Official Xiaozhi path.

## Self-Hosted Voice Provider Invocation

The primary Voice Provider is the self-hosted `xinnan-tech/xiaozhi-esp32-server` deployed on the family LAN. A pinned 0.9.5-derived image adds a deterministic Page Router at the final-ASR entry point; the ordinary LLM no longer decides whether page routing happens.

### Invocation flow

On each voice turn the self-hosted server:

1. Produces a final ASR transcript after VAD end-of-utterance.
2. Reads `page`, `familyMode`, `deviceId` and `pageState` from `self.page.get_context` with a 1-second timeout.
3. POSTs the final transcript and context to `POST /api/agent/ask` with a 2-second timeout.
4. Speaks `handled=true` responses directly, including policy denial and confirmation prompts.
5. Sends `handled=false` or transport failures through the existing Provider LLM once, without executing a Family Hub Capability.

The AppShell no longer jumps to the AI page when listening starts, so the MCP context remains the page on which the user pressed the AI button.

`/api/agent/ask` adds `handled` and `fallbackReason`. The only public fallback reasons are `general_query` and `unsupported_intent`; neither path mutates state or creates a device command.

### `family.agent.ask` tool schema

The tool advertised to the LLM:

```json
{
  "name": "family.agent.ask",
  "description": "Route a page-scoped family request to the Family Backend Page Agent. Always call self.page.get_context first and pass the returned page and familyMode.",
  "parameters": {
    "type": "object",
    "properties": {
      "page":       { "type": "string", "description": "Backend page key from device context: home, weather, schedule, ai, music, album, apps, settings" },
      "utterance":  { "type": "string", "description": "The user's final ASR transcript" },
      "familyMode": { "type": "string", "description": "Current user mode: 默认(parent) | 儿童 | 访客" },
      "deviceId":   { "type": "string", "description": "Target device id (default esp32-185b)" },
      "pageState":  { "type": "object", "description": "Optional page context, e.g. currentTrackId, currentScheduleId" },
      "confirmed":  { "type": "boolean", "description": "true when re-asking after a high-risk confirmation prompt" }
    },
    "required": ["page", "utterance", "familyMode", "deviceId"]
  }
}
```

`page`, `utterance`, `familyMode` and `deviceId` are required; `pageState` and `confirmed` are optional. `page` and `familyMode` always come from the device MCP context so the turn reaches the matching Page Agent under the correct policy mode.

Example POST body the tool sends to `POST /api/agent/ask`:

```json
{
  "page": "music",
  "utterance": "继续播放上次没听完的",
  "familyMode": "默认",
  "deviceId": "esp32-185b",
  "user": { "id": "device", "role": "" },
  "pageState": { "currentTrackId": "..." },
  "confirmed": false,
  "agent": null
}
```

Example response the server turns into streaming TTS:

```json
{
  "requestId": "",
  "agent": "media",
  "page": "music",
  "intent": "media.resume",
  "confidence": 0.95,
  "tool": "family.media.resume",
  "args": { "deviceId": "esp32-185b" },
  "speech": "好的，继续播放上次没听完的内容。",
  "display": { "page": "music", "toast": "继续播放" },
  "handoff": null,
  "requiresConfirmation": false
}
```

The backend routes by `page` via `agentForPage()` (music→media, settings→device, home→home, ai→general, weather→weather, schedule→schedule, english→english, album→album, apps→tools); an empty or unrecognized page falls back to the general agent.

### High-risk confirmation flow

When the backend sets `requiresConfirmation: true` (high-risk tools such as `family.openclaw.run` and `family.homeassistant.scene`, invoked without `confirmed`), the server speaks the confirmation prompt from `speech`, waits for the user's spoken yes/no, and re-invokes `family.agent.ask` with `confirmed: true`. The backend then executes and returns the final result.

### Authentication and secret handling

- The `family.agent.ask` tool reads the backend tool token `Tool_Auth_Token` from the server env/config `XIAOZHI_TOOL_TOKEN` and sends it as an `Authorization: Bearer <token>` header on the POST. When tool auth is enabled, the backend rejects calls without a valid token.
- Secret values, including `XIAOZHI_TOOL_TOKEN` and the voice-provider auth token, are never placed into `speech` or `display`. The tool strips any secret-bearing fields before they can reach TTS or the device UI.

## Page Agent Registry

V1 registry:

```json
[
  {
    "id": "media",
    "page": "music",
    "description": "Media playback, podcast, queue, resume and favorites.",
    "tools": [
      "family.media.play",
      "family.media.resume",
      "family.media.next",
      "family.media.stop",
      "family.media.favorite"
    ]
  },
  {
    "id": "device",
    "page": "settings",
    "description": "Device status, diagnostics, network, storage and backend health.",
    "tools": [
      "family.device.status",
      "family.device.diagnostics"
    ]
  },
  {
    "id": "tools",
    "page": "apps",
    "description": "Safe household tools, OpenClaw, Home Assistant scenes and NAS/server media scan.",
    "tools": [
      "family.openclaw.run",
      "family.homeassistant.scene",
      "family.nas.music.scan",
      "family.tools.status"
    ]
  },
  {
    "id": "general",
    "page": "ai",
    "description": "General entry and router fallback.",
    "tools": [
      "family.memory.remember",
      "family.content.recommend"
    ]
  }
]
```

V1 also registers Weather, Schedule, English and Album Agents with deterministic page-local tools.

## Intent Resolution

V1 can use deterministic rules before any LLM planning.

Media Agent examples:

| Utterance | Intent | Tool |
| --- | --- | --- |
| 继续 / 接着听 / 上次没听完 | `media.resume` | `family.media.resume` |
| 下一集 / 下一首 | `media.next` | `family.media.next` |
| 停止 / 暂停 | `media.stop` | `family.media.stop` |
| 收藏这个 | `media.favorite` | `family.media.favorite` |
| 播放恐龙故事 | `media.play` | `family.media.play` |

Device Agent examples:

| Utterance | Intent | Tool |
| --- | --- | --- |
| 状态怎么样 | `device.status` | `family.device.status` |
| 网络正常吗 | `device.status` | `family.device.status` |
| 诊断一下 | `device.diagnostics` | `family.device.diagnostics` |

General/Router examples:

| Utterance | Target |
| --- | --- |
| 继续播放故事 | Media Agent |
| 设备状态怎么样 | Device Agent |
| 运行 OpenClaw 诊断 | Tools Agent |
| 记住孩子喜欢恐龙 | Memory tool |

## Capability Tool Contract

Tool metadata:

```json
{
  "name": "family.media.resume",
  "description": "Continue the most recent unfinished family audio item.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "deviceId": { "type": "string" },
      "trackId": { "type": "string" }
    },
    "additionalProperties": false
  },
  "roles": ["parent", "child"],
  "modes": ["默认", "儿童"],
  "risk": "low",
  "requiresConfirmation": false,
  "audit": true
}
```

Tool result:

```json
{
  "ok": true,
  "tool": "family.media.resume",
  "speech": "好的，继续播放上次没听完的故事。",
  "display": {
    "page": "music",
    "toast": "继续播放"
  },
  "deviceCommand": {
    "id": "cmd_...",
    "type": "media.server.play"
  },
  "state": {
    "trackId": "...",
    "positionSec": 120
  }
}
```

## Policy Rules For V1

Default:

- Parent can call all V1 tools.
- Child can call low-risk media, English, schedule and memory tools.
- Guest can call status and local/subscribed media tools only.
- Night mode allows status, quiet media control and diagnostics; blocks loud/unsafe tools.

V1-specific restrictions:

- Child cannot use direct external URLs.
- Child cannot add/delete feeds or delete media.
- Guest cannot trigger OpenClaw, Home Assistant or memory writes.
- Device Agent diagnostics are readable by parent, child and guest, but logs containing secrets are never returned.

## Memory V1

Use existing memory storage first.

Memory write tool:

```text
family.memory.remember
```

Example:

```json
{
  "text": "孩子喜欢恐龙故事",
  "memberId": "child",
  "visibility": "family",
  "tags": ["preference", "story"]
}
```

Retrieval for V1:

- Recent family memories.
- Memories matching `memberId`.
- Memories tagged with requested domain, such as `media`, `english`, `device`.

No vector store is required in V1. Add vector retrieval only after deterministic memory and tool flow are stable.

## Member Profile And Persona

Each family member now owns a structured profile instead of relying only on
`id`, `name` and `role`:

```json
{
  "id": "child",
  "name": "孩子",
  "role": "child",
  "profile": {
    "preferredName": "小明",
    "ageGroup": "child",
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai",
    "interests": ["恐龙", "太空"],
    "avoidTopics": ["惊悚"],
    "accessibility": []
  },
  "persona": {
    "assistantName": "小智",
    "addressAs": "小明",
    "tone": "温暖、耐心、鼓励",
    "verbosity": "brief",
    "traits": ["鼓励", "耐心", "清晰"],
    "instructions": "使用适龄表达。"
  },
  "memoryPolicy": {
    "enabled": true,
    "maxContextItems": 8,
    "includeFamilyMemory": true,
    "includeLearning": true,
    "retentionDays": 365
  }
}
```

Before every Page Agent plan, the backend resolves the stored member and builds
one `memberContext` containing:

- normalized member identity and role;
- response guidance from the member persona;
- relevant member and shared-family memories;
- recent learning records;
- recent Agent interactions.

Stored member roles override caller-supplied roles. This prevents a caller from
claiming parent permissions for a known child or guest identity.

Memory records support `kind`, `importance` and `expiresAt`. Retrieval enforces
member visibility, ignores expired records, ranks important/recent records and
respects the member's context-size and retention policy.

Admin endpoints:

- `GET /api/admin/family/members/:id/context`
- `POST /api/admin/family/members`
- `PATCH /api/admin/family/members/:id`

`POST /api/agent/ask` returns the effective `memberContext` for diagnostics and
future LLM prompt assembly. Deterministic responses already apply the member's
preferred form of address, while the full tone and instruction fields are
available to the later LLM planning layer.

## Knowledge V1

Knowledge sources:

- Device summary.
- Diagnostics report.
- Media library.
- Schedule.
- Family memories.
- Content catalog.

Use existing APIs and in-memory summaries. Do not add a vector database in V1.

## Execution Order

1. Normalize request context.
2. Select default Page Agent from `page`.
3. Let Page Agent resolve deterministic intent.
4. If unresolved, use Router fallback.
5. Build candidate tool call.
6. Run policy.
7. Execute Capability Tool.
8. Persist audit.
9. Return `speech`, `display`, `actions`, `handoff`.

## Implementation Order

1. Add `server/src/capabilities.js`.
2. Add `server/src/agents.js`.
3. Add `GET /api/agent/capabilities`.
4. Add `POST /api/agent/tools/:name`.
5. Add `POST /api/agent/ask`.
6. Add `family.agent.ask` to `xiaozhi-mcp-bridge.js`.
7. Wrap existing media resume/play/next/stop/favorite as capability tools.
8. Add Device Agent status/diagnostics tools.
9. Add Tools Agent for OpenClaw, Home Assistant, NAS/server scan and tool status.
10. Add smoke tests for Media Agent, Device Agent, Tools Agent, policy denial, confirmation flow and MCP tool listing.

## Acceptance Tests

- Music page + "继续" calls Media Agent and creates `media.server.play`.
- Settings page + "状态怎么样" calls Device Agent and returns diagnostics summary.
- AI page + "继续播放故事" routes to Media Agent.
- Child mode blocks direct external URL playback.
- Guest mode blocks memory write.
- `GET /api/agent/capabilities` lists Media Agent, Device Agent and registered tools.
- `family.agent.ask` appears in MCP tool list.
- Apps page + "扫描 NAS" routes to Tools Agent.
- Parent OpenClaw requires confirmation before creating a job.
- Confirmed parent OpenClaw creates an audited job.
- Child mode blocks OpenClaw even with confirmation.
- Confirmed Home Assistant scene records a safe scene action.

## Implementation Status

Implemented on 2026-07-07:

- `server/src/capabilities.js` registers the first Capability Tools and runs policy/audit before execution.
- `server/src/agents.js` implements deterministic Page Agent routing for Media, Device, Weather, Schedule, English, Album, Tools and General fallback.
- `/api/agent/capabilities`, `/api/agent/tools/:name` and `/api/agent/ask` are available.
- `family.agent.ask` is exposed through the Xiaozhi MCP bridge while direct media tools remain available.
- Tools Agent exposes `family.openclaw.run`, `family.homeassistant.scene`, `family.nas.music.scan` and `family.tools.status`.
- High-risk tools require parent confirmation, reject child/guest use through policy, and write audit records for confirmation, denial and execution.

Updated user-mode model:

- `默认` means a parent is using the device. It resolves to the active parent
  member, such as dad or mom.
- `儿童` means a child is using the device. It resolves to the active child
  member.
- `访客` means a visitor is using the device. It resolves to the guest member.
- `夜间` is retired as a user mode. Low brightness, quiet behavior and good-night
  scenes should be modeled as device settings or Home Assistant scenes, not as a
  user identity mode.
- Smoke tests cover Media Agent resume, Device Agent status, Weather/Schedule/English/Album Agents, Tools Agent, Router handoff, child direct-URL denial, guest memory-write denial, high-risk confirmation and MCP tool listing/call.

Extended on 2026-07-09:

- Added a Home Agent (`page: home`) with a read-only `family.home.overview` tool that returns time/weather/next schedule/active media/backend state, and hands off to specific domain agents for domain requests.
- Wired two previously-registered-but-unrouted tools: `family.content.recommend` (推荐/讲个故事/睡前/无聊…) and `family.memory.search` (查家庭记忆/记得/回忆…), both through the General/Home agents.
- Added `pickDefaultAgent` so cross-cutting intents (recommend/remember/recall) take priority over domain-noun routing. Before this, "推荐睡前故事" would match the `故事` media keyword and never reach content recommendation.
- Refactored `detectRouterAgent` into `detectSpecificDomain` (returns "" when no domain matched) plus a page fallback, so Home/General can distinguish "hand off to X" from "use my own default".
- Smoke covers content recommend routing, memory search routing, home overview, home→weather handoff, and capability listing of the home agent and new tools.

Extended on 2026-07-10:

- Added structured per-member `profile`, `persona` and `memoryPolicy`.
- Agent requests resolve the stored family member, inject visible memories,
  learning records and recent interactions, and return this as `memberContext`.
- Added short-term Agent interaction records and richer memory metadata:
  `kind`, `importance` and `expiresAt`.
- Admin can edit member personality, interests, avoided topics and memory
  policy, and inspect the effective context for a member.
- Stored member roles are authoritative for capability policy.

Still pending:

- Native mobile confirmation UX is not implemented yet; current confirmation is API-level and admin/mobile-Web-ready.
- Mobile App native integration is not implemented yet.
- Media volume control (`family.media.volume`) needs a new device command type plus firmware support (reflash), so it is deferred.
- Weather is still a mock provider; real weather needs an external provider.
- Intent resolution is deterministic-only by design; LLM planning for ambiguous utterances is a later step.

## Non-goals For V1

- Do not move admin media management into AI tools.
- Do not expose delete/rename/feed management to AI.
- Do not replace Xiaozhi ASR/TTS.
- Do not require a mobile App before Agent V1 works.
- Do not add complex LLM planning before deterministic Page Agents are proven.
