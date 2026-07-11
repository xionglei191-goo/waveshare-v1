# 实施记录摘要

详细历史仍保留在 `../../todo.md` 的实施记录区。这里以后只保留影响路线判断的摘要。

## 2026-07-02

- 建立 Family AI OS 方向：保留小智官方高速语音链路，自建后端负责家庭能力。
- 完成本地 AppShell、Node.js 后端、Action Hub、Remote JSON UI、SD 资源基础。
- 完成 SD 挂载、图片屏保、本地 Ogg/Opus 音乐和服务器播客链路。

## 2026-07-03

- 完成 Phase 1-10 产品化底座验收。
- 完成 SQLite 后端、伴侣页、USB/资源导入 API、诊断报告。
- 完成 Phase 11-15 第一轮：OpenClaw job、内容 seed、Remote UI V2、家庭记忆和 AI intent。
- 启用 BluFi 配网配置，人工新 Wi-Fi 写入仍待验收。

## 2026-07-04

- 重构圆屏四区 UI：顶部系统栏、主体、页面操作栏、底部轻状态栏。
- 设置页重组为设备中心：网络、连接、电源、存储、系统、诊断。
- 接入 1.85B BQ27220 电量计。
- 明确一级页面：首页、天气、日程、AI、音乐、英语、相册、应用、设置。
- 天气页移除日程事项。
- 内容页产品语义迁移为相册页。
- 应用页移除家庭模式和一级页面入口，只保留扩展工具。
- 修复远端旧 node 进程导致 Remote UI 返回旧应用列表的问题，恢复 systemd 后端为 active。

## 2026-07-05

- 完成 BQ27220 500mAh profile 接入和真机验证。
- 完成后端事件探针唤醒、60 分钟稳定性长测和服务器播客 MP3 HTTP 播放。

## 2026-07-06

- 将服务器播客升级为“默认在线播放 + 可选 SD 离线缓存”：Range stream、播放进度 API、cache metadata、设备端 SHA-256 校验缓存和缓存优先播放。
- 修正 1.85B SD 卡官方 4-bit SDMMC 针脚，恢复真机 SD 挂载。

## 2026-07-07

- 完成产品重新定位：Family AI OS 不再以 ESP32 承载复杂功能为中心，而是“三端家庭 AI 生态”：圆屏交互端、AI-native 后端、手机 App 预留。
- 明确后端是 Family Capability Hub，所有核心能力都应可被 AI 通过安全工具调用，但 AI 不直接访问危险 CRUD API。
- 确认自建 AI 服务是长期家庭智能大脑，小智官方继续作为低延迟语音入口。
- 确认 `xinnan-tech/xiaozhi-esp32-server` 若后续使用，应作为独立 Voice Provider，而不是 Family Backend 的基础。
- 确认 AI 交互架构采用 Page Agent First + Router Fallback：一级页面内交互优先直达对应 Agent，Router 仅兜底和跨域转发。
- 完成 AI Service V1 设计：`POST /api/agent/ask`、`GET /api/agent/capabilities`、`POST /api/agent/tools/:name`、`family.agent.ask` MCP 工具、Media Agent、Device Agent、Capability Tool contract、Policy V1、Memory/Knowledge V1 和验收测试。
- 完成 AI Service V1 后端第一版落地：新增 `server/src/capabilities.js` 和 `server/src/agents.js`，开放 `/api/agent/capabilities`、`/api/agent/tools/:name`、`/api/agent/ask`，小智 MCP 桥新增 `family.agent.ask`；Media Agent 支持播放/续播/下一集/停止/收藏，Device Agent 支持状态/诊断，General/AI 页可 handoff 到 Media/Device。`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 扩展 AI Service V1 Page Agents：Weather Agent 支持今日天气，Schedule Agent 支持今日日程/完成/稍后提醒，English Agent 支持状态/开始练习，Album Agent 支持相册状态/屏保开关；天气权限从 notifications 拆为独立只读 `weather` policy。`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 完成 Phase 16 旧定位清理：协议文档不再把 WebSocket JSON 处理称为设备端“业务逻辑”；旧“ESP32 承载复杂业务”表述仅保留在历史记录、兼容入口或否定性边界中。
- 完成 Phase 18/19 Tools Agent 安全收口：Capability registry 新增 `family.openclaw.run`、`family.homeassistant.scene`、`family.nas.music.scan`、`family.tools.status`；OpenClaw/HA 高风险工具需要家长确认，儿童/访客/夜间按策略拒绝并写入 audit，应用页 Tools Agent 可路由“运行诊断 / 打开家庭场景 / 扫描 NAS”。`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 完成移动 Web 伴侣补强：`/companion` 支持 admin token 保存/测试、BluFi 配网指引、连接策略查看、诊断/日志查看、资源上传和内容入库。Phase 20 中“新 Wi-Fi 写入”仍等待 EspBlufi App 真机人工验收。
- 部署 Phase 18/19/20 本轮收口到 `192.168.31.246:3100`，`xiaozhi-family-hub.service` 和 `xiaozhi-mcp-bridge.service` 均为 active。远端 LAN/公网 health、`/api/agent/capabilities`、`/companion`、OpenClaw 未确认不建 job、儿童拒绝、应用页 Tools Agent 扫描 NAS 路由均验证通过。
- 修复 OpenClaw 远端 success target：新增 `server/bin/openclaw-command-adapter.sh`，远端 systemd drop-in 指向 `/opt/xiaozhi-family-hub/bin/openclaw-command-adapter.sh`，规避服务用户无法访问 `/home/xionglei/.local/bin/openclaw` 和默认 Node 18 不满足 OpenClaw CLI 要求的问题。通过正式 Agent API 确认执行 `openclaw diagnostics`，后端记录 success job：`OpenClaw 完成: diagnostics`。当时 `default/music` target 仍需具体家庭任务命令；后续已补齐映射、success job 和真机 ACK，最终仍需人工 evidence。
- 完成 PM 口径复核：将已完成的“安全工具链/API/seed 示例”与待外部验收的“Home Assistant 真实状态变化、真实家庭素材导入、OpenClaw default/music 任务映射、EspBlufi 新 Wi-Fi 写入”拆开记录，避免路线图把框架完成误读成真实家庭闭环全部完成。
- 完成外部验收证据系统：新增 `GET /api/acceptance/status` 和 `POST /api/admin/acceptance/:id/evidence`，诊断报告包含 `acceptanceStatus`，移动 Web 伴侣新增“外部验收”面板；证据 `data` 限制大小/层级并打码 token/password/secret 等敏感字段。本地伴侣页脚本语法、`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过；远端 LAN/公网 health 正常，公网未授权写入验收证据返回 401，`/companion` 面板可见。
- 正式后台 `/admin` 增加“外部验收”面板和总览验收计数，可查看四项真实验收状态、所需证据和最新 evidence，并可用管理 token 写入证据；smoke 覆盖 `/admin` 和 `/companion` 均包含外部验收入口。
- Home Assistant 调用从“已发送”升级为记录 HTTP code、exit code、耗时和响应摘要，新增 `HOME_ASSISTANT_SCENES` 与 `HOME_ASSISTANT_TIMEOUT_MS`；smoke 使用独立 mock HA 验证配置真实 URL/token 时记录 `success/httpCode=200`。固件设置-网络页补充 SSID、RSSI/channel、IP 和后端状态；BluFi/AFSK 配网日志脱敏 Wi-Fi 密码。后端 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过，固件 `idf.py build` 通过，并已部署后端到 `192.168.31.246:3100`。
- 补齐设备心跳证据链：固件每 60 秒低频上报 `appshell.heartbeat` 到 `/api/device/logs`，包含 UUID、逻辑设备 ID、页面、AI/后端状态、wake/reset、heap、SSID/IP/RSSI/channel；后端将心跳聚合到设备记录和 `/api/diagnostics/report` 的 `esp32Status`。smoke 覆盖日志保存、设备 registry 更新和 diagnostics 字段；远端临时 heartbeat 验证通过，acceptance 四项仍保持 pending。
- 补齐家庭内容 representative 验收链：smoke 通过 `/api/content/import` 覆盖相册、播客 MP3、英语 JSON、小游戏 JSON 四类导入，并断言 catalog、packs、manifest、服务器媒体流和 Remote UI 页面入口；Remote UI 英语页/应用页开始消费导入 catalog，伴侣页按内容类型生成正确默认路径。真实家庭素材和真机显示/播放仍需外部验收证据。
- 补齐外部验收 readiness 和预检工具：新增只读 `GET /api/acceptance/readiness` 并纳入诊断报告，后台/伴侣页显示每项 readiness 检查；新增 `npm run acceptance:preflight`，默认只读，显式 `--execute` 才触发 HA/OpenClaw，显式 `--record --status=...` 才写入 evidence；后台 `/admin` 增加 album/podcast/English/story/game 通用内容导入；后台/伴侣页 evidence 表单支持 reference 和结构化 data JSON。真实外部验收项仍等待真实设备/服务证据。
- 收紧并部署 BluFi 外部验收 readiness：固件在 BluFi 配网成功后异步上报 `appshell.wifi_provisioned`，后端 readiness 要求近期 heartbeat、专用配网事件和 `method=blufi` 同时存在，避免旧 smoke 心跳误判为可验收。已重新部署到 `192.168.31.246:3100`，LAN/公网 health 正常，`npm run acceptance:preflight` 显示 1 ready、3 partial、4 pending；已构建并刷入 `/dev/cu.usbmodem101`，串口确认 LCD、触摸、SD 4-bit、BQ27220、Wi-Fi、小智 OTA/MQTT、唤醒词和后端探针正常，最低 SRAM `15123` 字节。真机 heartbeat 已更新为 `liuliu/192.168.31.160/RSSI -45/channel 6`，BluFi 仍因未执行手机新 Wi-Fi 配网而保持 partial。
- 收紧真实家庭内容 readiness：`real-family-content` 不再把 seed/sample/smoke/representative/示例/占位资源计为真实素材，只有非示例的 album、podcast、English、game catalog 条目和对应 manifest 校验文件齐全才会 ready；设备端显示/播放仍必须写入 acceptance evidence。已部署到 `192.168.31.246:3100`，远端 LAN/公网 `/api/acceptance/readiness` 变为 `0 ready / 3 partial / 1 missing`，其中 `real-family-content` 为 `missing 0/5`。
- 继续降低外部验收人工成本：新增 `npm run content:import-real` 批量导入真实相册、播客、英语和小游戏素材，并输出 manifest/readiness-backed evidence 草稿；新增 `npm run acceptance:pack` 生成只读证据包，包含 `report.md`、`next-actions.md`、`raw/*.json` 和 `evidence-drafts/*.json`。两个工具都不写 acceptance passed，也不替代真机显示/播放、HA 侧状态变化、BluFi 手机配网或 OpenClaw 真实效果观察。
- 后台和伴侣页外部验收面板补齐 evidence pack UI：新增 admin-only `/api/admin/acceptance/evidence-pack`，`/admin` 与 `/companion` 均可对当前选中验收项“填入草稿”，也可下载完整 JSON 证据包。smoke 覆盖未授权拒绝、endpoint shape 和页面按钮存在；入口仍只填 pending 草稿，不自动记录 passed。
- 配置远端管理 token 以打通后台验收写入和 evidence pack：生成并保存 `/opt/xiaozhi-family-hub/secrets/admin-token`，通过 `/opt/xiaozhi-family-hub/secrets/admin.env` 注入 `xiaozhi-family-hub.service`，本机副本保存在 `~/.config/xiaozhi-family-hub/admin-token`。验证无 token 访问 `/api/admin/acceptance/evidence-pack` 返回 401，带 token 可获取 `blufi-new-wifi` evidence draft；未改变任何 acceptance passed 状态。
- 外部验收面板继续增强为 PM 工作台：`/admin` 和 `/companion` 的验收列表现在直接展示 evidence pack `nextActions`，包括缺失 readiness 条件和仍需人工观察的真实动作；smoke 覆盖 nextActions API 文本、`evidence-pack?items=` 调用和页面“下一步”入口。
- 修复 OpenClaw target 自调用死锁：Agent Tool 执行路径改为异步 `spawn`，避免 target 脚本回调本机 Family Hub 时被同步 `spawnSync` 阻塞。新增 `openclaw-family-default.sh` 和 `openclaw-family-music.sh` 并部署为远端 `OPENCLAW_TARGET_DEFAULT_COMMAND`、`OPENCLAW_TARGET_MUSIC_COMMAND`；通过正式 `family.openclaw.run` 确认 `default/music` 均 success，`music` 下发 `media.server.play` 并收到 `esp32-185b` ACK。`openclaw-default-music` readiness 已为 `ready 5/5`，acceptance 仍保持 pending，等待人工观察后记录 evidence。
- 继续收紧真实家庭内容误判边界：`real-family-content` readiness 和 `content:import-real` 告警现在额外排除 `test/demo/diagnostic/placeholder/dummy/mock/fixture/测试/诊断` 等测试资源；smoke 测试改用 demo/test/diagnostic/dummy 命名的导入素材，确认这些资源仍不会让真实家庭素材验收变成 ready。

## 2026-07-10

- 将页面 Agent 路由落到真机：1.85B AppShell 在 NVS 未配置 `wifi.ota_url` 时默认使用 246 的 OTA/配置入口，官方 `CONFIG_OTA_URL` 只作为连接级回退；真机连接 `ws://192.168.31.246:8100/xiaozhi/v1/`，ASR `刷新一下` 后 Provider 只调用一次 `self.page.get_context`，得到 `home/默认/esp32-185b`，Home Agent 直接完成 TTS。
- Provider 升级为 `xiaozhi-voice-provider:0.9.5-family-router2`：固定上游摘要并同时校验 `intentHandler.py`、`connection.py`；连接日志只保留 header 名称，不再输出 Authorization 或 WebSocket nonce。Provider 测试 `29 passed`，246 容器运行、重启数 0；容器内旧连接日志中的两类敏感 header 值已清理为 0。
- 真机长会话暴露并修复 AppShell 资源同步崩溃：manifest 的公网 HTTPS `baseUrl` 会触发未配置证书的 TLS 失败，随后 8 KB `app_backend` 栈溢出。资源下载改为始终复用 LAN Family Hub origin，后台栈增至 12 KB；重新刷写后跨过 5 分钟同步边界，未再出现 TLS 错误、栈溢出或重启，最低 SRAM 约 16.6 KB。
- 完成官方 Provider 真机回退与自建 Provider 恢复验收：仅暂停 `xiaozhi-voice-provider` 后，本地 WakeNet 检测到 `你好小智`；主 WebSocket 连接失败后日志出现 `primary -> official`，设备拉取官方 OTA 配置、连接 `mqtt.xiaozhi.me`、进入 `fallback/official` 并完成官方 ASR/TTS 对话。恢复 Provider、结束官方会话并回到 idle 后，下一次唤醒出现 `recovery probe: primary/self-hosted`，重新拉取 246 配置并连接 `ws://192.168.31.246:8100/xiaozhi/v1/`，Home Agent 完成 TTS；Provider 运行正常、restart count 0。
- 同轮真机测试发现三个待修项：自建会话中的“停止/停止对话”被 Home Agent 当作首页请求，未退出会话；资源刷新对包含中文或空格的路径未做 URL 编码，`esp_http_client` 报 `Error parse url`；官方回退会话期间最低 SRAM 降至约 `2619` 字节，虽未崩溃但余量不足。
- 完成 Provider 回退 SRAM 加固并二次真机验收：AppShell 在 AI connecting/listening/speaking 期间及回 idle 后 3 秒内统一暂停 refresh/event/action 网络任务，worker 入口再次检查状态，动作在竞态下重新排队，`force=true` 不绕过安全门；12 KB `app_backend`、8 KB `app_action`、4 KB `app_events` 栈迁到 PSRAM。WebSocket 失败连接立即释放 transport、清除旧 hello bit，并抑制失败清理产生的伪 channel-close。新增会话局部 heap 低水位日志。暂停 Provider 后官方回退完整对话最低 `15431` 字节，恢复 Provider 后自建会话最低 `15539` 字节；跨过后续 5 分钟资源刷新边界后启动期最低 `13827` 字节、当前内部 SRAM 恢复约 29 KB，无 panic/重启。原 `2619` 字节风险关闭；此时尚余停止语义和资源 URL 编码两项，已在下方同日记录中继续关闭。
- 完成资源路径 URL 编码并真机验收：AppShell 对 UTF-8 路径逐字节执行 RFC 3986 percent-encoding、保留目录分隔 `/`，并继续复用配置的 LAN Family Hub origin。真机刷新 heartbeat 显示 `下载 25 项`，包含中文和空格的资源已落到 SD；未再出现 `HTTP_CLIENT: Error parse url`、panic 或重启。
- 完成 MP3 播放 SRAM 加固：Audio Simple Player/GMF worker 显式使用 6 KB PSRAM 栈。同一中文服务器 MP3 的内部 SRAM 最低值由 `2963` 提升到 `17275` 字节，增加约 14.3 KB；停止后当前 SRAM 回到约 36-38 KB，无泄漏、panic 或重启。
- 完成 Provider 原生退出语义并真机验收：推荐 `exit_commands` 包含 `退出/关闭/停止对话/结束对话/退出对话`，246 的运行配置已部署；Provider 在 Family Page Router 之前精确匹配并直接 `conn.close()`，避免 Home Agent 抢走退出命令。真人麦克风测试中，不完整 ASR `对话` 未被误判；随后 `停止对话` 精确命中，Provider 记录 `识别到明确的退出命令`，设备 WebSocket 断开并从 listening 回到 idle，未调用 `self.page.get_context`、未返回 Home Agent 概览。会话局部最低 SRAM `18995` 字节；Provider 测试 `29 passed`。

## 2026-07-11

- 完成 P9 SRAM 安全水位：24 KB `opus_codec` 常驻栈、服务器/本地音乐栈、AppShell 网络 worker 迁入 PSRAM，并加入 16 KB/12 KB 分级保护。真机同一中文 MP3 最低 `49627` B，自建长会话启动低水位 `38279` B，Provider 重启 `41999` B，官方回退 `39567` B；资源 heartbeat 为 `资源已是最新`，无泄漏、panic 或重启。
- 完成上下文缓存和首音频链路：设备页面变化及每 60 秒主动同步，Provider 先用 Backend 缓存，428 时才调用 `self.page.get_context`；HTTP/TTS 连接复用，AliBLTTS 修复隔轮关闭 WebSocket 导致的 TLS 抖动。确定性 Home Agent 四个真机样本为 `1305/1341/2816/2865 ms`，P50=`1341 ms`、P95=`2865 ms`。
- 完成模型边界：确定性 Page Agent 不调用模型，未知/开放输入只在 `handled=false` 后调用一次模型；简单闲聊真机选择 `gpt-5.4-mini`，量子/分析等复杂请求选择 `gpt-5.5`。未知 ASR 片段不再被当前首页误执行为家庭概览。
- 完成隔离与恢复：Backend 2 秒超时和三次失败熔断、Provider 恢复探测、动作 idempotency key/重放保护、原生退出优先级已部署。Provider 在会话中重启时设备断开回 idle；停止自建服务后设备自动切官方 OTA/MQTT，恢复后下一次唤醒重新连接 `ws://192.168.31.246:8100/xiaozhi/v1/`。
- 完成脱敏观测与家庭记忆：统一 `traceId/sessionId` 记录路由、模型、Backend、LLM、首音频和内部 SRAM；后台支持设备/会话/时间筛选。Provider 不再记录 ASR 原文，仅记录字符数；连接 header、Authorization 和令牌不入日志。AI 工具令牌已轮换并迁入 0600 secret 文件。家庭记忆 CRUD 改为 admin 鉴权，支持成员、可见性、来源、过期和关闭策略，默认不保存原始语音或完整对话。
- 最终自动化：后端 `check/smoke/smoke:sqlite`、Provider `31 passed`、`git diff --check`、ESP-IDF 5.5.4 构建均通过；Router3 与 Family Hub 已部署到 246，固件已刷入 `/dev/cu.usbmodem101`。
