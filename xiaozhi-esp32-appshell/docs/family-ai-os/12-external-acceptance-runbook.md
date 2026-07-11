# 外部验收执行 Runbook

本文档只用于执行和记录剩余真实外部验收项，不用于勾选 `todo.md`，也不把 readiness 或 smoke 结果等同于验收完成。只有真实设备、真实服务或真实家庭内容被现场验证，并通过 `/admin`、`/companion` 或验收 API 写入 evidence 后，才可以把对应 acceptance item 状态改为 `passed`。

## 当前入口

- LAN 后端：`http://192.168.31.246:3100`
- 公网入口：`https://wave.xionglei.online`
- 后台页：`http://192.168.31.246:3100/admin` 或 `https://wave.xionglei.online/admin`
- 伴侣页：`http://192.168.31.246:3100/companion` 或 `https://wave.xionglei.online/companion`
- 人工验收状态：`GET /api/acceptance/status`
- 只读前置检查：`GET /api/acceptance/readiness`
- 写入 evidence：`POST /api/admin/acceptance/:id/evidence`

推荐先用 LAN 地址完成现场验收；公网入口适合远程查看状态或补录已经脱敏的 evidence。

## Evidence 记录规则

每条 evidence 至少记录这些字段：

- `status`：`pending`、`passed`、`failed` 或 `blocked`。不确定时先用 `pending` 或 `blocked`。
- `note`：人工摘要，包含观察时间、设备或服务、实际结果和关键日志/job/entity。
- `reference`：截图路径、串口日志文件名、HA entity id、OpenClaw job id、manifest path 等。
- `data`：结构化 JSON，只放可复核的非敏感字段。
- `actor` 和 `source`：通过 `/admin` 或 `/companion` 记录时页面会自动写入 `parent/admin` 或 `parent/companion`。

不要写入 evidence 的内容：

- Wi-Fi 密码、Home Assistant token、`ADMIN_TOKEN`、`XIAOZHI_TOOL_TOKEN`、`AI_TOOL_TOKEN`、Authorization header、cookie、API key。
- OpenClaw 命令中包含的密钥、内网凭据、私人路径凭据或完整 shell 环境。
- 家庭成员身份证明、精确住址、原始照片/video/base64、带 EXIF/GPS 的原始素材。
- 可能含隐私的完整 stdout/stderr。若必须引用，只记录 job id、退出码、时间和已脱敏摘要。

后端会对 `data` 里 key 名包含 token/password/secret 等字段做打码，但 `note`、`reference` 和普通字段值仍需要人工脱敏。

## 通用记录方式

### 通过 `/admin`

1. 打开 `http://192.168.31.246:3100/admin`。
2. 在页面里填入管理 token 并保存到当前浏览器。
3. 进入“外部验收”面板。
4. 选择 acceptance item，设置 `status`。
5. 填写 `note`、`reference` 和可选 `data` JSON。
6. 点击“记录证据”，再刷新确认列表中出现最新 evidence。

### 通过 `/companion`

1. 打开 `http://192.168.31.246:3100/companion`。
2. 填入管理 token。
3. 在“外部验收”面板选择 item 和状态。
4. 填写 evidence 摘要、引用和结构化 `data`。
5. 点击“记录证据”，刷新后确认 evidenceCount 和 latestEvidence 更新。

### 通过 API

```sh
export ADMIN_TOKEN="<admin-token>"

curl -X POST http://192.168.31.246:3100/api/admin/acceptance/blufi-new-wifi/evidence \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "pending",
    "actor": "parent",
    "source": "manual-runbook",
    "note": "2026-07-07 EspBlufi phone-side test started; waiting for final voice/MQTT confirmation.",
    "reference": "screenshots/blufi-20260707-01.png",
    "data": {
      "method": "blufi",
      "deviceName": "Xiaozhi-Blufi"
    }
  }'
```

把 item id 替换为本次验收项：`blufi-new-wifi`、`home-assistant-real-scene`、`real-family-content` 或 `openclaw-default-music`。

## 通用预检

从 `server/` 目录运行：

```sh
cd /Users/xionglei/Documents/waveshare/xiaozhi-esp32-appshell/server
npm run acceptance:preflight -- --base-url=http://192.168.31.246:3100
```

生成证据包：

```sh
npm run acceptance:pack -- \
  --base-url=http://192.168.31.246:3100 \
  --out=acceptance-artifacts/2026-07-07
```

证据包会生成：

- `report.md`：每个外部验收项的状态、readiness、缺口和 evidence 草稿路径。
- `next-actions.md`：仍缺哪些真实动作。
- `raw/*.json`：status、readiness、diagnostics、device logs、integrations、OpenClaw jobs、manifest、catalog 的原始快照。
- `evidence-drafts/*.json`：可复制到 `/admin` 或 `/companion` 的脱敏草稿。

证据包默认只读，不触发 HA/OpenClaw，不导入内容，不写 evidence，不标记 `passed`。即使某项 readiness 全绿，也必须人工确认真实设备或真实服务效果后再提交 evidence。

也可以直接在页面生成草稿：

- `/admin` 的“外部验收”面板中，点击 `填入草稿` 可把当前验收项的 pending draft 填入 note/reference/data 表单，点击 `下载证据包` 可下载完整 JSON 包。
- `/companion` 的“外部验收”面板提供同样按钮，适合手机现场验收。

页面入口同样只生成草稿；点击 `记录证据` 前仍要确认真实手机、真实 HA、真实家庭内容或真实 OpenClaw 效果。

公网只读检查：

```sh
npm run acceptance:preflight -- --base-url=https://wave.xionglei.online
```

默认预检只读，不触发 HA/OpenClaw，也不写 evidence。输出里的 `ready` 表示当前前置检查全部满足，`partial` 表示部分满足，`missing` 表示缺少可用前置条件。最终验收仍以 `/api/acceptance/status` 的人工 evidence 为准。

只读 API 快查：

```sh
curl http://192.168.31.246:3100/api/acceptance/readiness
curl http://192.168.31.246:3100/api/acceptance/status
curl https://wave.xionglei.online/api/acceptance/readiness
curl https://wave.xionglei.online/api/acceptance/status
```

`--execute` 只适用于真实触发 Home Assistant 和 OpenClaw：

```sh
npm run acceptance:preflight -- \
  --base-url=http://192.168.31.246:3100 \
  --execute \
  --ha-scene=scene.family \
  --openclaw-targets=default,music
```

如果部署启用了 `XIAOZHI_TOOL_TOKEN` 或 `AI_TOOL_TOKEN`，`--execute` 的 bearer 需要使用 AI gateway token。脚本参数名仍是 `--admin-token`，但这时不要把 token 写进日志或 evidence。`--record --status=...` 会调用 admin evidence API；如果 admin token 和 AI gateway token 不同，不要把 `--execute` 和 `--record` 合并到一次命令，先执行真实工具，再通过 `/admin` 或 `/companion` 手动记录。

`--record --status=...` 只会自动记录 HA 和 OpenClaw 两项，并会把最近调用摘要写入 evidence。若 stdout/stderr 或 HA 返回摘要可能含隐私，不要使用自动记录，改用 `/admin` 或 `/companion` 手动写脱敏版。

## 1. BluFi 新 Wi-Fi 配网

- Acceptance id：`blufi-new-wifi`
- 验收目标：手机通过 EspBlufi 写入新 Wi-Fi，设备联网后小智 OTA/MQTT/唤醒词和后端连接仍正常。

### 前置条件

- ESP32 已刷入包含 `appshell.heartbeat` 和 `appshell.wifi_provisioned` 上报的固件。
- 手机已安装 EspBlufi App，蓝牙可用。
- 有一个可用于验收的新 Wi-Fi；操作者知道密码，但密码不得写入 evidence。
- 后端 `http://192.168.31.246:3100` 可达，设备连上该 Wi-Fi 后能访问后端。
- 可以查看圆屏设置页网络信息，最好同时打开串口日志用于确认无 panic。

### 操作步骤

1. 打开 `/companion` 或 `/admin`，刷新“外部验收”，确认 `blufi-new-wifi` 当前状态和 readiness。
2. 让设备进入 BluFi 配网状态，确认手机能看到 `Xiaozhi-Blufi`。
3. 在 EspBlufi App 中连接 `Xiaozhi-Blufi`，选择目标 Wi-Fi，输入密码并发送。
4. 等待 App 返回连接成功，设备重新联网。
5. 在圆屏设置页确认新 SSID、IP、RSSI/channel 和后端状态。
6. 刷新 `/companion` 或查询 `/api/device/logs`，确认最近有 `appshell.wifi_provisioned` 和 `appshell.heartbeat`。
7. 唤醒小智并做一次基础对话，确认 OTA/MQTT/唤醒词恢复正常；串口不应出现 panic 或重启循环。
8. 运行通用预检，确认 `blufi-new-wifi` readiness 包含近期心跳、BluFi 专用事件、`method=blufi`、SSID、IP、RSSI/channel 和 backend probe。
9. 通过 `/admin` 或 `/companion` 记录 evidence。只有 App 成功、圆屏网络信息、后端日志和语音链路都确认后，才使用 `passed`。

### 建议 evidence data

```json
{
  "method": "blufi",
  "deviceName": "Xiaozhi-Blufi",
  "ssid": "new-ssid-name-only",
  "ip": "192.168.31.xxx",
  "rssi": -45,
  "channel": 6,
  "backendBaseUrl": "http://192.168.31.246:3100",
  "deviceLogSources": ["appshell.wifi_provisioned", "appshell.heartbeat"],
  "deviceLogAt": "2026-07-07T00:00:00.000Z",
  "settingsPageObserved": true,
  "xiaozhiVoiceOk": true,
  "serialPanic": false
}
```

不要记录 Wi-Fi 密码、路由器管理密码、完整 BSSID/MAC 清单或手机蓝牙调试包。

## 2. Home Assistant 真实场景

- Acceptance id：`home-assistant-real-scene`
- 验收目标：配置真实 `HOME_ASSISTANT_URL` 和 `HOME_ASSISTANT_TOKEN` 后，通过工具触发 scene，并确认 HA 侧状态实际变化。

### 前置条件

- 远端后端服务已配置 `HOME_ASSISTANT_URL`、`HOME_ASSISTANT_TOKEN`、`HOME_ASSISTANT_SCENES` 和合理的 `HOME_ASSISTANT_TIMEOUT_MS`。
- `HOME_ASSISTANT_SCENES` 中至少包含本次要触发的安全场景，例如 `scene.family`。
- HA 场景影响的实体可观察，例如灯、开关、脚本日志或 HA logbook。
- 当前家庭模式允许默认/家长档案执行 HA 工具；儿童、访客拒绝策略仍应保持。
- 管理 token 只用于写 evidence，不要放入 evidence。

### 操作步骤

1. 在 HA 中记录触发前状态，例如 `light.living_room=off` 或场景关联实体的状态。
2. 查询 `/api/acceptance/readiness`，确认 HA URL/token 和场景白名单至少已被识别。
3. 触发场景。可在 `/admin` 的工具区点击 HA 场景按钮，也可运行：

```sh
cd /Users/xionglei/Documents/waveshare/xiaozhi-esp32-appshell/server
npm run acceptance:preflight -- \
  --base-url=http://192.168.31.246:3100 \
  --execute \
  --ha-scene=scene.family \
  --ha-observe-entity=light.living_room \
  --openclaw-targets=
```

如果本机环境已设置 `HOME_ASSISTANT_URL` 和 `HOME_ASSISTANT_TOKEN`，`--ha-observe-entity` 会在触发前后读取实体状态并写入 evidence 草稿；这只辅助记录 before/after，不替代人工确认。
4. 在 HA 页面或实体实际状态中确认场景产生了可见变化。
5. 查询 `/api/integrations/status` 或刷新 `/admin`，确认 Home Assistant history 中最近调用为 `success` 或 HTTP 2xx。
6. 如本轮包含安全验收，切换儿童/访客模式后尝试敏感 HA 操作，确认拒绝记录进入审计；再恢复默认/家长模式。
7. 运行通用预检，确认 `home-assistant-real-scene` readiness 变为 `ready` 或明确记录仍缺哪项。
8. 通过 `/admin` 或 `/companion` 写 evidence。

### 建议 evidence data

```json
{
  "sceneEntityId": "scene.family",
  "haBefore": {
    "entityId": "light.living_room",
    "state": "off"
  },
  "haAfter": {
    "entityId": "light.living_room",
    "state": "on"
  },
  "historyStatus": "success",
  "httpCode": 200,
  "durationMs": 320,
  "auditChecked": true
}
```

不要记录 `HOME_ASSISTANT_TOKEN`、Authorization header、HA 用户 cookie、完整 HA 配置文件或包含家庭隐私的 logbook 文本。

## 3. 真实家庭素材导入

- Acceptance id：`real-family-content`
- 验收目标：导入真实家庭相册、播客、英语包和小游戏素材，并在设备端完成显示、播放或入口验收。

### 前置条件

- 已准备最小真实素材集：至少 1 个 album 图片、1 个 podcast/audio、1 个 English JSON、1 个 game JSON。
- 素材已去除不需要的 EXIF/GPS，文件名不包含隐私信息。
- 文件名、packId、标题或标签不要包含 `sample/smoke/representative/test/demo/diagnostic/placeholder/dummy/mock/fixture/示例/占位/测试/诊断`，这些会被 readiness 视为测试素材。
- `/admin` 或 `/companion` 可访问内容导入面板。
- 设备能连接后端并进入 Album、Music、English、Apps 页面。

### 操作步骤

1. 优先使用批量导入脚本，从 `server/` 目录执行：

```sh
cd /Users/xionglei/Documents/waveshare/xiaozhi-esp32-appshell/server
npm run content:import-real -- \
  --base-url=http://192.168.31.246:3100 \
  --album=/path/to/family-photo.jpg \
  --podcast=/path/to/family-audio.mp3 \
  --english=/path/to/english-session.json \
  --game=/path/to/game-entry.json \
  --pack-id=real-family-20260707
```

2. 脚本会导入四类内容，读取 `/api/resources/manifest` 和 `/api/acceptance/readiness`，并输出一份 evidence data 草稿。
3. 如果不用脚本，也可以在 `/admin` 或 `/companion` 使用内容导入：album 默认进入 `images/`，podcast 进入 `music/server/`，English 进入 `courses/english/`，game 进入 `games/`。
4. 每类导入后刷新内容列表和资源列表，确认 catalog 有对应条目；查询 `/api/resources/manifest`，记录每个文件的 path、sha256、size、contentType、packId 或 version。
5. 在圆屏上验证：Album 能显示真实照片或屏保资源，Music 能播放真实播客/音频，English 能进入真实课程，Apps 能进入小游戏入口。
6. 如音频来自服务器，确认播放链路不是只停留在 catalog；需要听到播放或看到设备播放状态变化。
7. 运行通用预检，确认 `real-family-content` 的 album、podcast、english、game 和 manifest 检查都满足。
8. 通过 `/admin` 或 `/companion` 写 evidence。导入脚本和预检只确认 catalog/manifest，不替代设备端显示和播放观察。

### 建议 evidence data

```json
{
  "packId": "real-family-pack-20260707",
  "items": [
    {
      "type": "album",
      "path": "images/family-photo-01.jpg",
      "sha256": "sha256-from-manifest",
      "size": 123456,
      "contentType": "image/jpeg"
    },
    {
      "type": "podcast",
      "path": "music/server/family-audio-01.mp3",
      "sha256": "sha256-from-manifest",
      "size": 234567,
      "contentType": "audio/mpeg"
    }
  ],
  "deviceObserved": {
    "album": true,
    "podcastPlayback": true,
    "englishEntry": true,
    "gameEntry": true
  },
  "manifestChecked": true
}
```

不要把原始图片、音频 base64、儿童姓名、精确家庭场景描述、GPS/EXIF 或私密文件路径写入 evidence。

## 4. OpenClaw default/music

- Acceptance id：`openclaw-default-music`
- 验收目标：为 `OPENCLAW_TARGET_DEFAULT_COMMAND` 和 `OPENCLAW_TARGET_MUSIC_COMMAND` 配置真实家庭任务，并验收 default/music 的真实控制效果。

### 前置条件

- 远端后端服务配置了可执行的 `OPENCLAW_COMMAND`，当前推荐为 `/opt/xiaozhi-family-hub/bin/openclaw-command-adapter.sh`。
- 已配置 `OPENCLAW_TARGET_DEFAULT_COMMAND` 和 `OPENCLAW_TARGET_MUSIC_COMMAND`，且命令可由 `xiaozhi-family-hub.service` 运行用户执行。
- default 和 music 目标各自对应可观察的家庭程序或媒体流程。
- 命令不会执行破坏性操作，不依赖交互式 shell，不在 stdout/stderr 输出 secret。
- 当前家庭模式允许默认/家长档案执行；未确认、儿童、访客拒绝策略仍应保持。

当前推荐的安全映射脚本：

- `OPENCLAW_TARGET_DEFAULT_COMMAND=/opt/xiaozhi-family-hub/bin/openclaw-family-default.sh`
- `OPENCLAW_TARGET_MUSIC_COMMAND=/opt/xiaozhi-family-hub/bin/openclaw-family-music.sh`

`default` 会创建一条 Family Hub 可见通知；`music` 会通过小智工具网关下发 `media.server.play` 设备命令。它们是低风险、可观察的 OpenClaw target 映射，但最终 `passed` 仍需要人工确认圆屏或后台出现对应效果。

### 操作步骤

1. 配置或确认远端服务环境变量。优先把 target command 指向固定脚本，不要把含密钥的完整命令写入文档或 evidence。
2. 重启 `xiaozhi-family-hub.service` 后，打开 `/admin` 查看运行配置，或查询 `/api/openclaw/jobs`，确认 OpenClaw configured 且 allowed targets 包含 `default` 和 `music`。
3. 先触发 `default`。首选在 `/admin` 的 OpenClaw target 下拉选择 `default` 后运行；如果要用 agent tool API，必须带 AI gateway token，且 token 不得写入 evidence。

```sh
export XIAOZHI_TOOL_TOKEN="<ai-gateway-token>"

curl -X POST http://192.168.31.246:3100/api/agent/tools/family.openclaw.run \
  -H "Authorization: Bearer ${XIAOZHI_TOOL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "args": { "target": "default" },
    "confirm": true,
    "user": { "id": "parent", "role": "parent" },
    "source": "external-acceptance"
  }'
```

4. 观察 default 对应的真实家庭程序效果，并在 `/api/openclaw/jobs` 中确认出现 `target=default`、`status=success` 的 job。
5. 对 `music` 重复同样步骤，确认真实媒体流程被触发，并出现 `target=music`、`status=success` 的 job。
6. 验证安全边界：未确认调用不应创建 job；儿童或访客模式不应越权执行敏感 target，拒绝应进入审计。
7. 运行通用预检，确认 `openclaw-default-music` readiness 包含 command、default mapping、music mapping、default success 和 music success。
8. 通过 `/admin` 或 `/companion` 写 evidence。若 job stdout/stderr 含隐私，手动写脱敏摘要，不使用自动 `--record`。

如果本轮计划同时验收 HA 和 OpenClaw，可以使用 `npm run acceptance:preflight -- --execute --ha-scene=... --openclaw-targets=default,music`；该命令会先触发 HA，再触发 OpenClaw，不适合只想单独运行 OpenClaw 的场景。

### 建议 evidence data

```json
{
  "commandMappingsConfigured": {
    "default": true,
    "music": true
  },
  "targets": [
    {
      "target": "default",
      "jobId": "job-id-from-api",
      "status": "success",
      "exitCode": 0,
      "finishedAt": "2026-07-07T00:00:00.000Z",
      "observedEffect": "default household task visibly ran"
    },
    {
      "target": "music",
      "jobId": "job-id-from-api",
      "status": "success",
      "exitCode": 0,
      "finishedAt": "2026-07-07T00:00:00.000Z",
      "observedEffect": "music flow started on the intended player"
    }
  ],
  "policyChecks": {
    "unconfirmedBlocked": true,
    "childDenied": true,
    "guestDenied": true,
    "defaultParentAllowed": true
  }
}
```

不要记录完整 target command、OpenClaw 内部 token、家庭自动化凭据、敏感 stdout/stderr 或可反推出私有路径的完整环境变量。

## 最终核对

完成一项真实外部验收后，至少做三次核对：

```sh
cd /Users/xionglei/Documents/waveshare/xiaozhi-esp32-appshell/server
npm run acceptance:preflight -- --base-url=http://192.168.31.246:3100
curl http://192.168.31.246:3100/api/acceptance/status
curl http://192.168.31.246:3100/api/acceptance/readiness
```

如果公网也需要同步确认：

```sh
curl https://wave.xionglei.online/api/acceptance/status
curl https://wave.xionglei.online/api/acceptance/readiness
```

`/api/acceptance/readiness` 负责说明还缺哪些前置条件，`/api/acceptance/status` 负责说明人工 evidence 是否已记录。不要因为 preflight 通过就修改 `todo.md`；如需推进 todo 状态，必须由主验收人根据 evidence 另行处理。
