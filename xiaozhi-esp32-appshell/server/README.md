# Xiaozhi Family Hub Server

局域网 Family Backend，给 ESP32 AppShell 提供天气、日程、双通道音乐、英语练习、应用列表、通知、屏保、Action Hub、Remote JSON UI 页面描述、SD 资源 manifest 和离线同步接口。

## Run

```bash
npm install
npm start
```

默认监听 `0.0.0.0:3100`，设备默认访问 `http://192.168.31.246:3100`。`3000` 端口保留给远端现有服务。

管理后台：

- `/admin`：正式 Family Hub 后台，管理媒体库、家庭权限、设备、工具、内容、资源和诊断。
- `/companion`：轻量伴侣页，保留旧入口。

## API

- `GET /api/health`
- `GET /api/events` - SSE 事件流，用于通知设备尽快刷新和自动唤醒
- `GET /api/events/latest` - 轻量事件探针，用于 ESP32 低内存场景的快速唤醒和设备命令拉取
- `GET /api/device/summary`
- `GET /api/device/commands/poll`
- `POST /api/device/commands/:id/ack`
- `GET /api/weather/today`
- `GET /api/schedule/today`
- `GET /api/music/state`
- `GET /api/media/library`
- `GET /api/media/server/tracks`
- `GET /api/media/search?q=<keyword>`
- `GET /api/media/queue`
- `POST /api/media/queue`
- `POST /api/media/queue/play`
- `POST /api/media/queue/next`
- `POST /api/media/queue/stop`
- `POST /api/media/queue/clear`
- `PATCH /api/media/queue/:id`
- `DELETE /api/media/queue/:id`
- `GET /api/media/resume`
- `POST /api/media/resume`
- `GET /api/media/favorites`
- `POST /api/media/favorites`
- `DELETE /api/media/favorites/:id`
- `GET /api/media/server/stream/:id`
- `GET /api/media/online/stream/:id`
- `GET /api/media/server/progress`
- `POST /api/media/server/progress`
- `PATCH /api/media/server/progress/:trackId`
- `DELETE /api/media/server/progress/:trackId`
- `GET /api/apps`
- `GET /api/english/session`
- `GET /api/notifications`
- `GET /api/family/members`
- `GET /api/admin/family/members/:id/context`
- `GET /api/family/policies`
- `GET /api/integrations/status`
- `GET /api/openclaw/jobs`
- `GET /api/screensaver/state`
- `GET /api/devices`
- `POST /api/devices/register`
- `GET /api/device/logs`
- `POST /api/device/logs`
- `GET /api/ui/schema`
- `GET /api/ui/page/:page`
- `GET /api/resources/manifest`
- `GET /api/resources/file/*`
- `POST /api/resources/import`
- `POST /api/usb/import`
- `GET /api/ota/manifest`
- `GET /api/compatibility`
- `GET /api/diagnostics/report`
- `POST /api/sync/push`
- `GET /api/sync/pull`
- `POST /api/action`
- `POST /api/intent`
- `POST /api/ai/xiaozhi/tool`
- `GET /api/admin/dashboard`
- `GET /api/admin/config`
- `GET /api/admin/media`
- `POST /api/admin/media/command`
- `GET /api/admin/podcasts/feeds`
- `POST /api/admin/podcasts/feeds`
- `PATCH /api/admin/podcasts/feeds/:id`
- `DELETE /api/admin/podcasts/feeds/:id`
- `POST /api/admin/podcasts/feeds/:id/refresh`
- `POST /api/admin/podcasts/refresh-all`
- `GET /api/admin/podcasts/episodes`
- `GET /api/admin/media/catalog`
- `POST /api/admin/media/catalog`
- `DELETE /api/admin/media/catalog/:id`
- `PATCH /api/admin/media/server/:id`
- `DELETE /api/admin/media/server/:id`
- `GET /api/admin/family`
- `POST /api/admin/family/members`
- `PATCH /api/admin/family/members/:id`
- `DELETE /api/admin/family/members/:id`
- `PATCH /api/admin/family/policies/:mode`
- `GET /api/admin/database/schema`

## Actions

- `ai.toggle`
- `ai.start`
- `ai.stop`
- `music.play_pause`
- `music.next`
- `music.volume`
- `music.set_source`
- `music.sd.scan`
- `music.sd.play_pause`
- `music.sd.next`
- `music.server.play_pause`
- `music.server.next`
- `schedule.complete`
- `schedule.snooze`
- `english.start`
- `english.reset`
- `app.open`
- `screensaver.start`
- `screensaver.stop`
- `openclaw.run`
- `toast`
- `dialog.open`
- `notification.push`
- `family.mode`
- `family.member.status`
- `voice.intent`

音乐拆成两路：`sd` 表示 ESP32 本地 SD 卡音乐，`server` 表示服务器音乐/播客。服务器播客会先搜索 `SERVER_MUSIC_DIR` 本地文件；本地没有匹配时，再搜索播放队列、后台 RSS 订阅节目、网络曲库、环境变量 RSS、公共音频库或安全直链。ESP32 始终播放后端给出的统一 `streamUrl`，网络音频也由后端 `/api/media/online/stream/:id` 代理，避免设备直接连接外部 HTTPS。

后台媒体库能力：

- 本地服务器音频：上传到 `music/server/`，支持 MP3/Ogg/Opus，后台可播放、改名、删除。
- 播客订阅：后台可添加 RSS URL、手动刷新节目、一键刷新全部订阅、播放节目、加入队列、收藏。
- 播放队列：后端维护当前队列、历史和收藏，可播放、上移、下移、移除、清空，`下一集` 优先消费队列。
- 进度/续播：设备上报 `/api/media/server/progress` 后，媒体库会显示每个曲目/节目的进度；后台可标记已听完或重置进度，小智工具可通过 `/api/media/resume` 继续上次未听完内容；ESP32 仍接收 `media.server.play`。
- 网络曲库：后台可保存安全直链，设备播放时仍由后端代理。
- 小智工具调用：`family.media.play` / `family.podcast.play` 先搜本地文件，本地没有再搜网络来源。
- ESP32 只执行后端下发的 `media.server.*` 命令，不承担搜索、权限、曲库管理。

网络媒体配置：

- `ONLINE_MEDIA_PROVIDERS=rss,archive,direct`：启用 RSS、公共音频库、直链解析。
- `ONLINE_MEDIA_FEEDS=https://example.com/podcast.xml`：逗号分隔的播客/RSS 源。
- `ONLINE_MEDIA_ALLOW_DIRECT_URLS=1`：允许工具传入 MP3/Ogg/Opus 直链。
- `ONLINE_MEDIA_ALLOW_PRIVATE_HOSTS=0`：默认拒绝 localhost/私网地址，只有明确接 NAS/LAN HTTP 源时再打开。
- `PODCAST_REFRESH_INTERVAL_MINUTES=0`：RSS 定时刷新间隔，`0` 表示关闭后台自动刷新。
- `PODCAST_REFRESH_BATCH_SIZE=6`：每轮最多刷新多少个订阅源。

## Admin Security

后台管理和小智工具网关使用两套独立凭证：

- `ADMIN_TOKEN`：只给 `/admin` 页面和 `/api/admin/*` 后台接口使用。
- `XIAOZHI_TOOL_TOKEN` / `AI_TOOL_TOKEN`：只给 `/api/ai/xiaozhi/tool` 使用。

公开域名建议配置：

```bash
PUBLIC_BASE_URL=https://wave.xionglei.online
ADMIN_PUBLIC_HOSTS=wave.xionglei.online
ADMIN_PROTECT_PUBLIC_MUTATIONS=1
ADMIN_TOKEN=<random-admin-token>
```

当请求来自 `ADMIN_PUBLIC_HOSTS` 时，除 `GET/HEAD/OPTIONS` 和小智窄入口外，公网写操作都要求 `ADMIN_TOKEN` 或 Cloudflare Access。局域网设备继续访问 `192.168.31.246:3100`，不受管理 token 影响。浏览器后台只把 token 保存到本地 localStorage，服务端不会回显 token 明文。

可选开启 Cloudflare Access：

```bash
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=<access-app-audience>
CLOUDFLARE_ACCESS_ALLOWED_EMAILS=you@example.com
CLOUDFLARE_ACCESS_REQUIRED=1
```

## Xiaozhi Tool Gateway

小智官方 AI 继续负责高速语音，家庭工具优先调用后端窄入口，再由后端下发设备命令给 ESP32。公网暴露前必须设置 `XIAOZHI_TOOL_TOKEN` 或 `AI_TOOL_TOKEN`。

```bash
curl -X POST http://192.168.31.246:3100/api/ai/xiaozhi/tool \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"tool":"family.media.play","text":"播放服务器播客","params":{"query":"睡前故事","deviceId":"esp32-185b"}}'
```

当前网关会生成这些设备命令：`media.server.play`、`media.server.next`、`media.server.stop`、`media.server.cache`、`ui.toast`。`family.media.play` 和兼容旧名 `family.podcast.play` 都会走“本地优先、网络兜底”；`family.podcast.resume` 会选择最近未完成的服务器音频继续播放。ESP32 通过 `/api/events/latest` 取命令并通过 `/api/device/commands/:id/ack` 确认。

## Integrations

真实家庭能力通过环境变量开启，未配置时保持可演示的模拟状态。

- `OPENCLAW_COMMAND=/path/to/command`：`openclaw.run` 会以 `target` 作为第一个参数启动任务，并记录到 `/api/openclaw/jobs`。
- 默认部署推荐使用 `OPENCLAW_COMMAND=/opt/xiaozhi-family-hub/bin/openclaw-command-adapter.sh`。这个 adapter 会把 `diagnostics` 映射到真实 OpenClaw CLI 的 `--version` 和 `status` 检查；`default`、`music` 只有在设置 `OPENCLAW_TARGET_DEFAULT_COMMAND` 或 `OPENCLAW_TARGET_MUSIC_COMMAND` 后才会执行真实任务，否则会返回明确 failed job。
- `HOME_ASSISTANT_URL=http://homeassistant.local:8123`
- `HOME_ASSISTANT_TOKEN=<long-lived-access-token>`
- `XIAOMI_SPEAKER_ENTITY=media_player.xiaoai_speaker`：小米/小爱音箱在 Home Assistant 中的实体（由 `xiaomi_miot` 集成暴露），配置后 `family.speaker.*` 工具才会真正控制音箱；未配置时保持模拟。
- `XIAOMI_SPEAKER_SERVICE=xiaomi_miot.intelligent_speaker`：`family.speaker.say`/`family.speaker.command` 使用的 HA 服务（`domain.service`），默认小爱文字指令服务；音量/播放/暂停固定用 `media_player.*`。
- `HOME_ASSISTANT_SCENES=scene.family,scene.good_night`：允许 AI/后台触发的场景白名单。
- `HOME_ASSISTANT_TIMEOUT_MS=5000`：调用 HA 服务的超时时间。
- `NAS_MUSIC_DIR=/path/to/podcasts-or-music`

Action Hub 会根据当前用户模式执行权限策略：默认模式对应家长档案，儿童模式对应孩子档案，访客模式对应访客档案。儿童/访客会限制应用、OpenClaw、Home Assistant、语音意图等敏感能力。夜间不再作为用户模式，低亮/勿扰应作为设备设置或 HA 场景处理。HA 调用会记录 HTTP code、exit code、耗时和响应摘要；真实验收仍需要在 HA 侧确认场景或实体状态变化。所有 action 决策会进入安全审计，可在 `/api/family/policies` 和 `/api/admin/dashboard` 查看。

## Acceptance Readiness

真实外部验收不要靠 smoke 自动勾选。后端提供只读 readiness 和手动 evidence 两层：

- `GET /api/acceptance/status`：查看四项外部验收的人工证据状态。
- `GET /api/acceptance/readiness`：只读检查当前系统前置条件，例如 HA 是否配置、OpenClaw default/music 是否有映射和 success job、真实内容 catalog/manifest 是否齐全、设备心跳是否含 SSID/IP/RSSI。
- `POST /api/admin/acceptance/:id/evidence`：用 `ADMIN_TOKEN` 记录人工验收证据。

`real-family-content` readiness 会排除 sample、smoke、representative 和“示例/占位”内容。seed 示例包和 representative smoke 只能证明内容系统可用，不能替代真实家庭相册、播客、英语包和小游戏素材的设备端验收。

真实素材可用批量导入脚本减少手工操作：

```bash
npm run content:import-real -- \
  --base-url=http://192.168.31.246:3100 \
  --album=/path/photo.jpg \
  --podcast=/path/audio.mp3 \
  --english=/path/session.json \
  --game=/path/game.json \
  --pack-id=real-family-20260707
```

脚本会导入四类内容、读取 manifest 和 readiness，并输出一份 evidence data 草稿。它不会自动把 `real-family-content` 标记为 passed；仍需在 ESP32 上确认相册显示、音频播放、英语入口和小游戏入口后，再通过 `/admin` 或 `/companion` 记录 evidence。

预检脚本默认只读：

```bash
npm run acceptance:preflight -- --base-url=http://192.168.31.246:3100
```

也可以生成外部验收证据包，方便人工复核和复制 evidence 草稿：

```bash
npm run acceptance:pack -- \
  --base-url=http://192.168.31.246:3100 \
  --out=acceptance-artifacts/2026-07-07
```

该命令会写入 `report.md`、`next-actions.md`、`raw/*.json` 和 `evidence-drafts/*.json`。它只读，不调用工具、不写 evidence，也不会把任何项标记为 `passed`。

后台和伴侣页也提供同样的只读能力：

- `/admin` 外部验收面板：`填入草稿` 会把当前验收项的 pending evidence draft 填入表单，`下载证据包` 会下载完整 JSON 包。
- `/companion` 外部验收面板：提供同样入口，方便手机现场验收时记录证据。
- 两个页面的验收列表都会显示 evidence pack 里的 `nextActions`，直接列出当前还缺的 readiness 条件和人工观察动作。

这两个入口都需要管理 token，且只生成或填入草稿；点击 `记录证据` 前仍需要人工确认真实设备或真实服务效果。

显式 `--execute` 才会触发真实 HA/OpenClaw 工具；显式 `--record --status=...` 才会写入证据：

```bash
ADMIN_TOKEN=<admin-token> npm run acceptance:preflight -- \
  --base-url=http://192.168.31.246:3100 \
  --execute \
  --ha-scene=scene.family \
  --openclaw-targets=default,music
```

## V2 Direction

Family AI OS V2 保留小智官方高速 AI 主链路，自建后端负责家庭能力、资源、UI 配置和同步。SD 卡作为本地资源仓库，后端通过 `/api/resources/manifest` 描述资源包，通过 `/api/sync/*` 接收设备离线事件。

## Persistence

运行状态默认保存在 `DATA_DIR/state.json`。配置 `STORE_DRIVER=sqlite` 后会使用 `SQLITE_FILE`，默认是 `DATA_DIR/family-hub.sqlite`，首次启动会从现有 `state.json` 迁移。当前 SQLite 表包括 `kv`、`devices`、`device_logs`、`sync_events`、`security_audit`，其中 `kv.state` 保存完整兼容状态，表结构用于日志、审计和后续后台查询演进。

资源导入：

```bash
curl -X POST http://192.168.31.246:3100/api/usb/import \
  -H 'Content-Type: application/json' \
  -d '{"path":"images/family.rgb565.bin","contentBase64":"..."}'
```

`/api/diagnostics/report` 会返回后端、设备摘要、资源 manifest、近期日志和安全审计，用于 USB/手机伴侣诊断模式。

## Deploy

独立部署到 `192.168.31.246`：

```bash
DEPLOY_USER=<remote-user> ./scripts/deploy-ssh.sh
```

当前家庭服务器按 systemd + release 目录部署到 `/opt/xiaozhi-family-hub`：

- `current`：指向当前 release 的软链接。
- `releases/<timestamp>-<gitsha>`：版本化后端代码目录。
- `shared/data`：SQLite 和运行状态。
- `shared/resources`：媒体、相册、课程和资源文件。
- `shared/secrets`：`admin.env`、`integrations.env`、`home-assistant.env`、小智 MCP token 等。
- `backups/sqlite`：部署前和每日 SQLite 备份。

部署脚本固定使用：

- `xiaozhi-family-hub.service`
- `xiaozhi-mcp-bridge.service`
- `PUBLIC_BASE_URL=https://wave.xionglei.online`
- `DEPLOY_BASE=/opt/xiaozhi-family-hub`

部署流程：

1. 本地运行 `npm run check && npm run smoke && npm run smoke:sqlite`。
2. 远端创建 `releases/current/shared/backups` 布局。
3. 部署前记录当前 release 指针，并对 SQLite 执行 `.backup` 和 `PRAGMA integrity_check`。
4. rsync 新 release，远端 `npm ci --omit=dev`，远端 `npm run check`。
5. 切换 `current`，重启 Family Hub 和 MCP Bridge。
6. 验证 LAN health、device summary、agent capabilities 和公网 health。

回滚：

```bash
ROLLBACK=1 DEPLOY_USER=<remote-user> ./scripts/deploy-ssh.sh
ROLLBACK=1 ROLLBACK_RELEASE=20260710093000-abcdef123456 ./scripts/deploy-ssh.sh
ROLLBACK=1 ROLLBACK_DB=/opt/xiaozhi-family-hub/backups/sqlite/family-hub-20260710093000.sqlite ./scripts/deploy-ssh.sh
```

每日备份可安装 `deploy/xiaozhi-family-hub-backup.service` 和 `deploy/xiaozhi-family-hub-backup.timer`。timer 默认每天 03:20 运行，保留 14 个日备份和 8 个周备份。每个阶段上线后仍需要在 246 做一次真实恢复演练：切回上一 release，按需恢复 SQLite 备份，确认核心流程失败时可快速回滚。

systemd 模板默认使用 `/opt/node-v22/bin/node`。在切换模板前，需要在 246 并行安装 Node 22 LTS，同时保留现有 Node 18 作为快速回滚路径。

## Verify

```bash
npm run check
npm run smoke
npm run smoke:sqlite
bash -n scripts/deploy-ssh.sh scripts/backup-sqlite.sh
curl http://192.168.31.246:3100/api/device/summary
```
