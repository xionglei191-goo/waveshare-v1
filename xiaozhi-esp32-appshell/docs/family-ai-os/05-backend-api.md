# 后端 API 与 Capability Hub

Family Backend 默认地址：

```text
http://192.168.31.246:3100
```

`3000` 端口保留给服务器现有服务。

## 定位

Family Backend 不只是普通 HTTP 后台。它是 AI-native Family Capability Hub。

每个重要能力都应该同时支持：

- 后台/手机 App 的传统 API。
- AI 可调用的安全 Capability Tool。
- 圆屏可执行的轻量设备命令。
- 权限策略和审计记录。

AI 不直接调用危险 CRUD API。AI 只能调用经过语义封装、参数校验、角色/模式判断和审计的工具。

## 核心接口

- `GET /api/health`
- `GET /api/device/summary`
- `GET /api/ui/page/:page`
- `GET /api/ui/capabilities`
- `GET /api/resources/manifest`
- `GET /api/sync/pull`
- `POST /api/sync/push`
- `POST /api/action`
- `POST /api/ai/xiaozhi/tool`
- `GET /api/agent/capabilities`
- `POST /api/agent/tools/:name`
- `POST /api/agent/ask`
- `GET /api/device/commands/poll`
- `POST /api/device/commands/:id/ack`

## 页面接口

正式页面：

- `home`
- `apps`
- `english`
- `album`
- `settings`

兼容页面：

- `content`：旧路由，只返回相册语义。

## Capability 边界

后端内部可以有较细的管理 API，但暴露给 AI 和圆屏的能力必须经过白名单。

当前传统 action 白名单：

- `music.*`
- `schedule.*`
- `english.start`
- `screensaver.*`
- `app.open`
- `openclaw.run`
- `homeassistant.*`
- `nas.music.scan`
- `family.mode`
- `voice.intent`
- `toast`
- `dialog.open`

服务端负责权限判断、审计和失败反馈；ESP32 不直接理解复杂业务。

未来 Capability Tool 应统一描述：

```json
{
  "name": "family.media.resume",
  "description": "继续播放最近未听完的家庭音频。",
  "inputSchema": {},
  "roles": ["parent", "child"],
  "modes": ["默认", "儿童"],
  "risk": "low",
  "audit": true
}
```

Capability Tool 执行后可产生：

- 后端状态变更。
- 设备命令。
- 语音回复。
- 圆屏展示状态。
- 审计记录。

## Xiaozhi AI Tool Gateway

公网只建议暴露窄入口：

```text
POST /api/ai/xiaozhi/tool
Authorization: Bearer <XIAOZHI_TOOL_TOKEN>
```

示例：

```json
{
  "tool": "family.podcast.play",
  "text": "播放服务器播客",
  "params": {
    "deviceId": "esp32-185b"
  }
}
```

后端会把安全工具调用映射为设备命令，例如：

```json
{
  "type": "media.server.play",
  "payload": {
    "track": {
      "id": "...",
      "streamUrl": "http://192.168.31.246:3100/api/media/server/stream/..."
    }
  }
}
```

ESP32 通过 `GET /api/events/latest?deviceId=esp32-185b` 取一条 pending command，执行后调用 `POST /api/device/commands/:id/ack`。

当前白名单命令：

- `media.server.play`
- `media.server.next`
- `media.server.stop`
- `media.server.cache`
- `ui.toast`

## Custom AI Service Gateway

已实现：

```text
GET /api/agent/capabilities
POST /api/agent/tools/:name
POST /api/agent/ask
```

用途：

- 接收页面上下文、用户角色、家庭模式和用户输入。
- 按 Page Agent First 调用默认 Page Agent。
- 必要时 Router Fallback 到其他 Agent。
- 通过 Capability Tools 执行动作。
- 返回 `speech`、`display`、`actions` 和审计结果。

示例请求：

```json
{
  "deviceId": "esp32-185b",
  "page": "music",
  "inputType": "voice",
  "utterance": "继续",
  "user": {
    "id": "child",
    "role": "child"
  },
  "familyMode": "儿童"
}
```

示例响应：

```json
{
  "speech": "好的，继续播放上次没听完的故事。",
  "display": {
    "page": "music",
    "toast": "继续播放"
  },
  "actions": [
    {
      "tool": "family.media.resume",
      "status": "accepted"
    }
  ]
}
```

## 部署形态

- 远端目录：`/opt/xiaozhi-family-hub`
- systemd 服务：`xiaozhi-family-hub.service`
- 服务用户：`xiaozhi`
- 数据目录：`/opt/xiaozhi-family-hub/data`
- SQLite：`/opt/xiaozhi-family-hub/data/family-hub.sqlite`
