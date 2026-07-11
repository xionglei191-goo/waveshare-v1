# AI Agent Layer

This document defines the target AI logic for Family AI OS.

## Goal

Build a custom family AI service that can handle identity, roles, memory, knowledge and tool planning while keeping Xiaozhi official AI as the fast voice entrance.

The product should support:

- Multiple family members.
- Parent/child/guest roles.
- User modes: default for parents, child for children, and guest for visitors.
- Long-term memory and preference profiles.
- Family knowledge base.
- Tool permissions and audit.
- Page-specific interaction logic.

## Relationship With Xiaozhi

Xiaozhi official AI remains valuable because it is fast and already handles wake word, ASR, TTS and the device audio path.

Target split:

```text
Xiaozhi Official AI = low-latency voice entrance
Custom AI Service = family brain
Family Backend = capability hub and execution layer
ESP32 = interaction terminal
```

Xiaozhi can call:

- Existing direct tools, such as `family.media.play`.
- `family.agent.ask`, which forwards user context to the custom AI service.

Do not migrate Family Backend into `xiaozhi-esp32-server`. If that project is used later, treat it as a Voice Provider that calls Family Backend tools.

## Page Agent First

First-level pages provide the strongest context. A page interaction should call the page's default Agent first.

| Page | Agent |
| --- | --- |
| Home | Home Agent |
| AI | General Agent |
| Weather | Weather Agent |
| Schedule | Schedule Agent |
| Music | Media Agent |
| Album | Album Agent |
| English | English Agent |
| Apps | Tools Agent |
| Settings | Device Agent |

The current page is not a prison. It is a bias.

Examples:

- On Music, "continue" means resume media.
- On English, "continue" means resume practice.
- On Settings, "status" means device diagnostics.
- If Music receives "what is today's schedule", it can hand off to Schedule Agent.

## Router Fallback

Router is not the default path for every request. It is used only when:

- The page is Home or AI and the request is broad.
- The page Agent cannot handle the domain.
- The user intent is ambiguous.
- A cross-domain handoff is needed.

This keeps page-local interactions fast and natural while preserving flexibility.

## Request Context

Every Agent call should receive structured context:

```json
{
  "deviceId": "esp32-185b",
  "page": "music",
  "utterance": "继续",
  "inputType": "voice",
  "user": {
    "id": "child",
    "role": "child"
  },
  "familyMode": "儿童",
  "deviceState": {
    "online": true,
    "battery": 82
  },
  "pageState": {
    "currentTrackId": "..."
  }
}
```

## Agent Response

Agents return a result that separates speech, display and actions:

```json
{
  "speech": "好的，继续播放昨天没听完的故事。",
  "display": {
    "page": "music",
    "toast": "继续播放"
  },
  "actions": [
    {
      "tool": "family.media.resume",
      "args": {
        "deviceId": "esp32-185b"
      }
    }
  ],
  "handoff": null,
  "requiresConfirmation": false
}
```

## Capability Tools

Agents do not directly edit database rows, files or device state. They call backend capability tools.

Tool requirements:

- Stable name.
- Description for AI.
- JSON input schema.
- Role and mode policy.
- Executor.
- Audit entry.
- Safe error message.

Example:

```json
{
  "name": "family.media.resume",
  "description": "Continue the most recent unfinished family audio item.",
  "roles": ["parent", "child"],
  "modes": ["默认", "儿童"],
  "audit": true
}
```

Tool examples:

- `family.media.play`
- `family.media.resume`
- `family.media.next`
- `family.media.favorite`
- `family.schedule.today`
- `family.schedule.complete`
- `family.english.practice_start`
- `family.album.slideshow_start`
- `family.device.status`
- `family.home.scene`
- `family.memory.remember`
- `family.content.recommend`

## Policy Engine

Policy is centralized. Agents decide intent; policy decides permission.

Inputs:

- User role.
- Family mode.
- Page.
- Tool.
- Arguments.
- Risk level.

Policy outputs:

- allow
- deny
- require confirmation
- require parent
- sanitize arguments

Examples:

- Child can play local or subscribed stories.
- Child cannot delete media, add RSS feeds or run arbitrary direct URLs.
- Night mode can reduce volume and block loud media.
- Guest cannot trigger OpenClaw or sensitive Home Assistant actions.
- Parent can manage tools and memory.

## Memory And Knowledge

Memory types:

- Family memory: durable household facts.
- Member profile: preferences, restrictions, learning status.
- Conversation memory: short-term recent context.
- Activity memory: media history, learning records, schedule interactions.
- Tool memory: common actions and safe defaults.

Knowledge base types:

- Family documents.
- Device manuals.
- Media catalog and resource metadata.
- Learning materials.
- Home Assistant entity descriptions.
- OpenClaw task descriptions.

The custom AI service should retrieve memory/knowledge before planning tools.

## AI Service V1

Minimum viable service:

- `POST /api/agent/ask`
- `family.agent.ask` MCP tool
- Page Agent registry.
- Role/mode context.
- Memory read/write.
- Media Agent using existing media tools.
- Device Agent using diagnostics/status tools.
- Response shape: `speech`, `display`, `actions`.

First target scenarios:

- "继续播放上次没听完的故事。"
- "给孩子推荐一个睡前内容。"
- "记住孩子喜欢恐龙故事。"
- "现在设备状态怎么样？"
- "儿童模式下播放一个已订阅故事。"

## Migration Rule

Do not rewrite working backend features first. Wrap them as capability tools and gradually move intent handling into Page Agents.

Current best sample capability:

- Server media/podcast center:
  - search
  - queue
  - progress
  - resume
  - favorite
  - cache
  - device command ACK

This should be the model for later schedule, English, album, device and tools Agents.
