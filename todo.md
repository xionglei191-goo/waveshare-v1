# Family AI OS 圆屏开发计划

## 文档分层说明

后续路线以 [docs/family-ai-os/00-index.md](docs/family-ai-os/00-index.md) 为主入口。

- Family AI OS 产品和架构文档：`docs/family-ai-os/`
- 小智上游底座参考：`docs/xiaozhi-upstream/`
- 当前执行清单和验收记录：`todo.md`

本文件保留历史阶段计划和实施记录，但不再作为完整设计文档。新页面职责、架构、后端 API、SD 资源系统和部署说明，请优先修改 `docs/family-ai-os/` 下的对应文件。

## 产品定位

基于 Waveshare ESP32-S3 1.85B、小智 AI 主线、自建后端和未来手机 App，构建一个全家通用的 Family AI OS 三端生态。

圆屏不再被定位为数据处理端或完整 App 平台。它是家庭现场交互端，负责展示、触摸、语音入口、播放、确认和反馈。复杂业务、搜索、权限、记忆、知识库、工具编排和系统管理全部放到后端。

新的长期方向是：

- 小智官方继续负责高速语音 AI 入口：唤醒词、ASR、TTS、官方 OTA/MQTT 和音频链路。
- 自建 AI 服务作为长期家庭智能大脑，负责多角色、多记忆、性格画像、知识库和 Page Agent 编排。
- 自建 Family Backend 是 AI-native Capability Hub，负责家庭能力、资源、权限、工具、同步、OpenClaw/Home Assistant/NAS 等扩展。
- ESP32 负责稳定 UI、触摸、音频入口、SD 本地资源、离线兜底和轻量设备命令 ACK。
- 手机 App 预留为便携管理和连接桥，负责配网、诊断、资源导入、外出访问和未来无 Wi-Fi 网络代理。
- SD 卡从“音乐存储”升级为本地资源仓库：图标、图片、动画、字体、音乐、课程、游戏资源、缓存、日志和 outbox。
- 网络从“只靠 Wi-Fi”逐步抽象成 Connectivity Layer：Wi-Fi、BLE 手机代理、USB 导入/调试和未来 4G/eSIM 预留。

Family AI OS 设计基准见 [docs/family-ai-os/00-index.md](docs/family-ai-os/00-index.md)。旧入口 [architecture-v2.md](architecture-v2.md) 和 [docs/page-navigation-contract.md](docs/page-navigation-contract.md) 仅作为兼容入口保留。

## 设计方向

- 首页采用「极简手表风 + 一点 AI 助手仪表盘风」。
- 圆屏界面避免手机页面缩小版，优先使用大时间、少文字、圆形/胶囊入口、清晰状态反馈。
- AI 是系统级能力，但页面内交互采用 Page Agent First：一级页面优先直达对应 Agent，Router 只做兜底和跨域转发。
- ESP32 固件负责稳定显示、触摸、音频入口、SD 资源读取、离线队列和本地兜底；服务端和自建 AI 负责页面配置、业务数据、资源包、同步、权限、记忆、知识库和扩展程序调用。
- 后端所有核心能力都要 AI-native：后台、手机、圆屏和 AI 都应复用同一套经过权限和审计保护的 Capability Tools。
- Remote JSON UI 是白名单组件协议，不是浏览器、HTML、CSS 或脚本运行时。
- 后端不可用时，本地首页、设置、AI 状态、SD 音乐、图片屏保和小游戏仍应可用。

## 总体架构

```text
Voice Providers
  Xiaozhi Official / optional xiaozhi server / future voice gateway
        |
Custom AI Service
  Page Agents / Router Fallback / Memory / Knowledge
        |
Family Backend Capability Hub
  Tools / Policy / Resources / Media / Schedule / Device Commands
        |
ESP32 Round Screen Terminal
  Display / Touch / Audio / SD / Local Fallback / ACK
        |
Mobile App Reserved
  Provisioning / Management / Diagnostics / Phone Proxy
```

## 页面职责与导航基准

详细规范见 [docs/page-navigation-contract.md](docs/page-navigation-contract.md)。

当前导航收口规则：

- 首页保持当前实现，作为稳定首屏，不在本轮继续大改。
- 顶部系统栏固定承担时间、首页、短标题、后端状态和设置入口。
- 设置是系统级入口，只从顶部系统栏进入；应用页和 Remote UI 应用列表不放设置。
- 天气、日程、音乐、AI、英语、相册、应用、设置都是一级能力页，但不等于都必须放到首页。
- 内容系统是后端资源层概念；圆屏端不再保留“内容”作为一级页面名称。
- 应用页只承载小游戏、OpenClaw、Home Assistant 场景、家庭工具和实验功能。
- 底部轻状态栏只显示一行 toast、同步结果或后端动作反馈，不承载 AI 对话正文。
- 页面操作栏只放当前页面业务动作，例如播放、确认、返回、刷新、扫描。

## 大线路阶段计划

说明：

- `P0-P8` 是当前工程任务优先级，用来判断具体代码和功能是否完成。
- `Phase 0-20` 是产品长期演进路线，用来判断整个 Family AI OS 走到哪个阶段。
- `Phase 0-10` 已完成原型到产品化底座收口；`Phase 11-15` 已进入“真实家庭闭环”落地和人工验收阶段；`Phase 16-20` 是产品重定位后的 AI-native 三端生态路线。
- 以后讨论“Phase 5”时，默认指这里的大线路阶段；讨论“P5”时，指后面的离线优先与同步任务。

### Phase 0：方向确认与底座选择

目标：确定不重写底层音频和 AI 链路，而是在小智主线之上做 Family AI OS。

范围：

- 明确设备定位：全家通用，不只是儿童学习工具。
- 保留小智官方高速 AI 主链路：唤醒词、ASR、LLM、TTS、OTA、MQTT、音频链路。
- 自建 Family Backend 只负责家庭能力、资源、UI 配置、同步和扩展程序调用。
- 确认目标硬件为 Waveshare ESP32-S3 1.85B。
- 确认后端目标地址为 `192.168.31.246:3100`，保留 `3000` 端口现有服务。

验收：

- [x] 完成产品定位。
- [x] 完成小智主线保留策略。
- [x] 完成 Family Backend 分工。
- [x] 完成 1.85B 板型和 AppShell 工程基线。

### Phase 1：本地 AppShell 可用版本

目标：设备先成为一个稳定可触摸、可导航、可离线兜底的圆屏终端。

范围：

- 本地 LVGL AppShell 常驻。
- 首页、时间天气、AI、音乐、应用/游戏、英语、日程、通知、设置、家庭模式、屏保。
- 极简手表风首页。
- AI 页面显示小智状态、呼吸/声波动效。
- 后端不可用时，本地页面仍可操作。
- 官方小智连接保持独立，不依赖自建后端。

验收：

- [x] AppShell 主导航可用。
- [x] 主要页面可触摸切换。
- [x] 首页显示时间、AI 状态、核心入口。
- [x] 设置页显示 Wi-Fi、后端、SD/资源、同步/音频状态。
- [x] AI 页面有状态展示和动效。
- [x] 真机重新刷入，串口确认 LCD、触摸驱动、Wi-Fi、小智官方连接启动正常。
- [x] 真机手动触摸/页面切换验证。

### Phase 2：家庭后端与 Action Hub

目标：建立设备和家庭服务器之间的标准动作通道，让 ESP32 不直接理解复杂业务。

范围：

- Node.js Express 后端。
- JSON 持久化状态存储。
- 设备 summary API。
- 天气、日程、音乐、英语、应用、通知模拟数据。
- 统一 `POST /api/action` Action Hub。
- OpenClaw、音乐控制、日程、英语、屏保、toast、dialog 等动作白名单。
- systemd 部署到 `192.168.31.246:3100`。

验收：

- [x] 后端服务骨架完成。
- [x] `/api/health` 可用。
- [x] `/api/device/summary` 可用。
- [x] `/api/action` 可用。
- [x] 后端已部署到 `192.168.31.246:3100`。
- [x] 保留 `192.168.31.246:3000` 现有服务。

### Phase 3：稳定性与圆屏体验打磨

目标：解决白屏重启、触摸不灵敏、按钮挤压和 1.85 寸圆屏显示拥挤问题。

范围：

- 后端 HTTP 请求串行化。
- action 队列化、互斥、限流和高频合并。
- 页面刷新避免触摸时删除 LVGL 对象。
- AI 动画从整页重建改成轻量状态更新。
- 音乐页按钮按源分布，扩大触摸命中。
- 圆屏安全区、底部按钮、tile/list 尺寸统一收敛。
- 设备状态页能辅助不用串口排查问题。

验收：

- [x] 快速点击时后端请求不并发抢占。
- [x] 音量连点合并请求。
- [x] AI 页面触摸和动画不互相打架。
- [x] 音乐页按钮布局完成一轮抗挤压修复。
- [x] 真机长时间页面切换和按钮连点稳定性测试。
  - 2026-07-03：完成 30 分钟真机串口长测和人工操作窗口；覆盖页面切换、服务器播客连点、AI 唤醒/听写/回复、SD 屏保、后端 action，未见 panic、异常重启或重启循环；最低 SRAM 约 40KB。

### Phase 4：SD 本地资源与离线优先

目标：让设备不再完全依赖 Wi-Fi 和后端，SD 卡成为本地资源仓库。

范围：

- SDMMC 4-bit 挂载。
- `/sdcard/manifest.json` 资源包清单。
- `/sdcard/music/local` 本地音乐扫描。
- `/sdcard/images` 图片屏保资源扫描。
- `/sdcard/outbox` 离线事件队列。
- 后端 `/api/resources/manifest` 与 `/api/resources/file/*`。
- 后端 `/api/sync/push` 与 `/api/sync/pull`。
- 网络恢复后 outbox 自动上传。
- 无 SD 卡时本地兜底 UI。

验收：

- [x] 1.85B SD 引脚配置完成。
- [x] `StorageManager` 完成。
- [x] `ResourceManager` 完成。
- [x] `SyncQueue` 完成。
- [x] 后端资源和同步 API 完成。
- [x] 设置页显示 SD/资源/同步状态。
- [x] 真机插卡挂载验证。
- [x] 真机断网/恢复同步验证。
- [x] SD 本地音乐真实解码和播放。
- [x] SD 图片真实解码显示到屏幕。

### Phase 5：Remote JSON UI 与资源包系统

目标：以后改部分界面和内容时，优先改服务端配置和 SD/后端资源包，而不是每次重新编译 ESP32。

范围：

- Remote JSON UI 白名单协议。
- 页面 schema 版本、字段长度、组件数量限制。
- ESP32 白名单组件 renderer。
- 首批组件：`hero_status`、`app_grid`、`big_button`、`card`、`list`。
- 第二批组件：`media_player`、`progress_ring`、`quiz_card`、`voice_orb`。
- 服务端 `GET /api/ui/page/:page` 页面配置中心。
- SD 资源包下载、校验、版本管理。
- 本地首页、AI、设置保留固件兜底。

验收：

- [x] 服务端页面 JSON 下发。
- [x] ESP32 schema/白名单安全校验。
- [x] ESP32 真正渲染白名单组件。
- [x] 未知组件安全占位或跳过。
- [x] 应用列表远程化。
- [x] 学习中心远程化。
- [x] SD 资源包版本校验和更新。

### Phase 6：家庭媒体与内容中心

目标：把音乐、播客、相册、故事、课程变成真正可长期使用的家庭内容系统。

范围：

- 音乐拆成两路：SD 本地音乐、服务器音乐/播客。
- NAS 音乐/播客目录接入。
- 后端媒体索引、封面、播放进度。
- 图片屏保支持 SD、本地缓存、服务器相册。
- 儿童故事、英语听力、白噪音、家庭播客。
- 服务端负责转码和轻量格式生成，ESP32 不解重格式。
- 音频会话统一由 `AudioSessionManager` 仲裁。

验收：

- [x] 音乐 UI 和 action 协议区分 SD/服务器。
- [x] `AudioSessionManager` 第一版完成。
- [x] SD 本地音乐可播放。
- [x] 服务器播客可真实播放/控制。
- [x] NAS/服务器媒体目录接入。
- [x] 图片屏保显示 SD 图片。
- [x] 音乐、AI、课程、提示音不会互相抢占失控。

### Phase 7：家庭能力集成

目标：让设备从“信息显示器”升级为家庭能力入口。

范围：

- OpenClaw action 深化。
- Home Assistant 接入。
- 家庭通知中心。
- 多成员状态：家长、孩子、访客。
- 用户模式：默认、儿童、访客。默认对应家长档案池，儿童对应孩子档案池，访客对应临时访客；夜间不再作为用户模式。
- 权限策略：哪些人可用哪些应用、哪些时间可用。
- 日程、提醒、音乐、屏保、AI 之间联动。
- 语音意图分发到后端程序。

验收：

- [x] OpenClaw action 占位和基础调用。
- [x] 家庭模式 UI 第一版。
- [x] OpenClaw 真实任务编排。
  - 说明：后端已实现 job 记录、target 安全化和 `OPENCLAW_COMMAND` 真实命令入口；2026-07-07 已将远端命令切到 `/opt/xiaozhi-family-hub/bin/openclaw-command-adapter.sh`，`diagnostics/default/music` 均已有 success job，`music` 下发 `media.server.play` 并收到真机 ACK；外部 acceptance 仍需人工观察效果并写入 evidence。
- [x] Home Assistant 调用链路、权限策略和调用历史完成。
  - 说明：后端已实现 `HOME_ASSISTANT_URL`/`HOME_ASSISTANT_TOKEN` 调用链路和调用历史；当前服务器未配置真实 HA 凭据时保持模拟发送。
- [ ] 配置真实 Home Assistant 后，验证场景触发能改变 HA 侧状态。
- [x] 家庭通知支持成员和等级。
- [x] 儿童/访客权限策略落地。
- [x] 语音意图能调用后端 action。

### Phase 8：多网络与手机伴侣

目标：降低只靠 Wi-Fi 的场景限制，让设备在更多家庭和外出场景下可用。

范围：

- `ConnectivityManager` 从 Wi-Fi 状态包装升级为 provider 架构。
- `WiFiProvider`。
- `BleProxyProvider`：手机代理网络、配网、离线同步桥。
- `UsbProvider`：开发、诊断、资源导入。
- `FutureCellularProvider`：为 4G/eSIM 硬件预留。
- 手机伴侣用于配置 Wi-Fi、管理资源、查看日志、导入内容。

验收：

- [x] `ConnectivityManager` 第一版完成。
- [x] Provider 接口完成。
- [x] Wi-Fi provider 迁移完成。
- [x] BLE 手机代理设计完成。
- [x] 手机伴侣最小原型。
- [x] USB 资源导入和诊断模式。
  - 说明：后端已提供 `/api/usb/import` 安全资源导入和 `/api/diagnostics/report` 诊断报告；设备端原生 USB MSC/CDC 文件导入可继续作为体验增强。

### Phase 9：家长后台与数据系统

目标：把家庭数据、学习记录、资源配置和设备管理从临时 JSON 演进成可长期维护的后台。

范围：

- SQLite 或 PostgreSQL 存储。
- 用户、家庭、设备、成员、权限。
- 学习记录、英语口语练习、积分和成就。
- 课程、故事、媒体、应用资源管理。
- 设备日志、崩溃记录、同步记录。
- 家长后台 Web UI。
- 备份、导出、迁移。

验收：

- [x] 数据库模型完成。
- [x] 后端从单文件 JSON 迁移到数据库。
- [x] 家庭/成员/设备模型完成。
- [x] 学习记录和媒体记录可查询。
- [x] 家长后台可管理内容和设备。
- [x] 日志和同步状态可追踪。

### Phase 10：产品化与可扩展 Family AI OS

目标：让项目从单设备原型变成可维护、可扩展、可升级的家庭 AI OS。

范围：

- 固件 OTA 策略。
- SD 资源包 OTA。
- 后端版本迁移。
- 设备端日志采集和问题上报。
- 稳定性压测：长时间运行、断网、频繁触摸、低电量、SD 拔插。
- 应用/小游戏扩展规范。
- Remote JSON UI 组件版本治理。
- 安全边界：动作白名单、权限、资源校验、服务端鉴权。
- 多设备支持：客厅、儿童房、厨房等多个圆屏终端。

验收：

- [x] 固件 OTA 和资源包 OTA 策略稳定。
- [x] 长时间运行稳定性达标。
  - 2026-07-03：完成 30 分钟真机稳定性验收；串口观察无 panic、assert、heap corruption、异常重启或白屏相关错误，AI 官方链路、服务器播客、SD 屏保和后端接口均保持可用。
- [x] 后端升级不会破坏旧设备。
- [x] Remote UI 组件版本兼容。
- [x] 多设备可注册、配置、同步。
- [x] 安全边界和权限策略完成。

### Phase 11：真实 OpenClaw 与家庭程序编排

目标：让圆屏能真实调用服务器程序，而不只是模拟 action。

范围：

- 固定 `OPENCLAW_COMMAND target` 命令适配器契约。
- 配置 OpenClaw 真实命令路径、工作目录和运行用户。
- 定义任务白名单：`default`、`music`、后续家庭自动化任务。
- 记录 job 状态：queued、started、success、failed、timeout。
- 任务失败时返回 toast/通知，不阻塞设备 UI。
- 结合用户模式权限：儿童、访客模式默认禁止敏感任务。
- 安全审计记录每次触发来源、成员、模式、target 和结果。

验收：

- [x] 服务器配置可执行 `OPENCLAW_COMMAND` 后，`openclaw.run` 能启动真实任务；远端 `diagnostics` target 已通过真实 OpenClaw CLI status 检查生成 success job。
- [x] `/api/openclaw/jobs` 可查询最近任务状态、target、时间和结果。
- [x] OpenClaw 任务失败、超时或命令缺失时，设备不白屏、不重启，后端返回明确错误。
- [x] 儿童/访客模式不能越权执行 OpenClaw 敏感任务。
- [x] 伴侣页或后台能查看 OpenClaw 配置状态和任务历史。

### Phase 12：家庭内容与资源运营系统

目标：让 SD、服务器媒体、相册、英语素材、故事、小游戏资源形成长期可维护内容库。

范围：

- 统一内容目录规范：音乐、播客、相册、英语、故事、小游戏、图标、字体、动画。
- 后端资源导入支持封面、标题、作者、标签、年龄段、语言、时长、版本。
- 资源包按课程包、相册包、播客包、小游戏包组织。
- 服务端生成 manifest，包含 `sha256`、`size`、`contentType`、`version` 和设备 profile。
- 支持资源版本升级、回滚、删除、重新校验和损坏修复。
- SD 卡作为本地缓存和离线内容仓库，后端作为资源配置中心。

验收：

- [x] 可从伴侣页或后端导入家庭相册、播客、英语素材和故事资源。
- [x] 设备能从 SD 或服务器显示/播放导入后的内容。
- [x] `/api/resources/manifest` 能追踪内容版本、校验和资源包归属。
- [x] 资源损坏、缺失或 profile 不匹配时，设备安全跳过并显示诊断信息。
- [x] 内容库能支持至少一个英语练习包、一个家庭相册包、一个服务器播客包。
  - 说明：当前验收以 seed 示例包和 representative smoke 导入为证据；smoke 已覆盖相册、播客 MP3、英语 JSON、小游戏 JSON 的 `/api/content/import`、catalog、packs、manifest、服务器媒体流和 Remote UI 页面入口。真实家庭素材还需要单独导入和设备端视觉/音频确认。
- [ ] 导入真实家庭相册、播客、英语包和小游戏素材，并在设备端完成显示/播放/入口验收。

### Phase 13：手机伴侣与 BLE 配网/代理

目标：降低只靠 Wi-Fi 的限制，让手机成为配置、导入、诊断和临时连接入口。

范围：

- 增强 `/companion` 手机伴侣：设备绑定、Wi-Fi 配置、资源导入、日志查看、诊断报告。
- 设计 BLE 配网流程：发现设备、写入 Wi-Fi、验证联网、回传后端状态。
- 预研手机代理网络：设备无法直连后端时，通过手机桥接同步和轻量请求。
- USB 继续作为开发、诊断、资源导入和恢复通道。
- `BleProxyProvider`、`UsbProvider` 与现有 `ConnectivityManager` provider 架构对齐。
- 设备恢复模式用于 Wi-Fi 错误、后端不可达、SD 资源损坏等场景。

验收：

- [x] 手机伴侣可完成设备绑定、状态查看和资源导入。
- [x] BLE 配网设计文档和协议草案完成。
- [x] 固件端 BLE provider 第一版能暴露设备身份和配网入口。
- [ ] 新 Wi-Fi 配置可写入并验证联网，不破坏现有小智官方连接。
- [x] 诊断报告可从手机伴侣读取并用于定位后端、SD、资源和网络问题。

### Phase 14：Remote JSON UI V2

目标：让更多界面通过服务端配置演进，同时保持 ESP32 安全和轻量。

范围：

- 首页卡片支持服务端远程配置，但保留本地时间、AI、设置兜底。
- 应用页、英语页、相册页、媒体页逐步 Remote UI 化。
- 增加组件版本治理和能力协商：设备声明支持组件，服务端按 profile 下发。
- 引入主题 token：颜色、字体级别、间距、圆屏安全区，不允许任意 CSS。
- 组件继续白名单化，不支持脚本、HTML、远程代码或任意样式。
- 失败降级：schema 不兼容、组件未知、资源缺失时回落本地页面。

验收：

- [x] 服务端修改首页卡片、应用列表或英语内容后，设备无需重新烧录即可更新展示。
- [x] 未知组件、未知 action、超长字段和过量组件会被安全拒绝或占位。
- [x] 首页、AI、设置在后端不可用时仍保持本地可操作。
- [x] Remote UI V2 schema 有版本号、profile、组件能力和降级策略。
- [x] 至少三个页面完成 V2 配置化：应用页、英语页、相册页。

### Phase 15：AI 增强层与家庭记忆

目标：不替换小智官方高速 AI 主链路，只在自建后端增加家庭上下文和工具编排。

范围：

- 小智官方继续负责唤醒词、ASR、LLM、TTS、OTA、MQTT 和低延迟语音对话。
- 自建后端负责家庭记忆、学习记录、内容推荐、工具调用和权限策略。
- 语音意图可分发到 OpenClaw、音乐、日程、内容推荐、英语练习等 action。
- 家庭记忆区分成员、模式、可见范围和过期策略。
- 家长可查看、编辑、删除家庭记忆和学习记录。
- 后端不可用时，官方小智 AI 仍能独立对话，设备 UI 不被阻塞。

验收：

- [x] AI 可通过后端触发至少三个家庭工具：音乐/播客、OpenClaw、日程或内容推荐。
- [x] 家庭记忆和学习记录可查询、编辑、删除。
- [x] 儿童/访客模式下，AI 工具调用遵守权限策略。
- [x] 后端不可用时，官方小智唤醒和基础对话仍可用。
- [x] AI 增强层有清晰隐私说明和家长控制入口。

### Phase 11-15 优先路线

1. 真实 OpenClaw 与家庭程序编排。
2. 家庭内容与资源运营系统。
3. 手机伴侣与 BLE 配网/代理。
4. Remote JSON UI V2。
5. AI 增强层与家庭记忆。

### Phase 16：产品重定位收口

目标：把项目从历史上的“ESP32 圆屏功能集合”旧定位正式调整为“三端家庭 AI 生态”。

范围：

- 圆屏定位为家庭现场交互端，不承载复杂业务。
- 后端定位为 AI-native Family Capability Hub。
- 手机 App 定位为便携管理和连接桥。
- 小智官方定位为低延迟语音入口。
- 自建 AI 服务定位为长期家庭智能大脑。
- `xinnan-tech/xiaozhi-esp32-server` 如后续使用，只作为独立 Voice Provider，不作为产品主后端。

验收：

- [x] 产品定位文档更新。
- [x] 总体架构文档更新。
- [x] AI Agent Layer 文档新增。
- [x] 决策日志记录新定位。
- [x] 清理旧文档和代码注释中“ESP32 承载复杂业务”的表述。

### Phase 17：AI Service V1

目标：建立自建 AI 服务最小闭环，不替换小智官方语音入口。

范围：

- AI Service V1 设计文档：`docs/family-ai-os/11-ai-service-v1.md`。
- 新增 `POST /api/agent/ask`。
- 新增 `family.agent.ask` MCP 工具。
- Page Agent registry。
- Router Fallback。
- Identity：family member、role、family mode。
- Memory：家庭记忆、成员偏好、最近上下文。
- Knowledge：媒体库、日程、设备状态、家庭记忆。
- Response：`speech`、`display`、`actions`、`handoff`。

验收：

- [x] AI Service V1 API、数据契约、Agent registry、Capability Tool contract 和验收场景完成文档化。
- [x] 小智可调用 `family.agent.ask`。
- [x] 音乐页“继续”直达 Media Agent。
- [x] 设置页“设备状态”直达 Device Agent。
- [x] AI/Home 页可 Router 到 Media/Device/Schedule/Weather/English/Album。
- [x] Schedule Agent Router 场景接入。
- [x] 儿童模式下外网搜索和危险工具被拒绝。
- [x] 所有 Agent action 产生审计记录。

### Phase 18：Capability Tool Registry

目标：把现有后端功能从 ad hoc action 收敛成可被 AI、后台、手机和圆屏复用的安全能力。

范围：

- Tool metadata：name、description、schema、role、mode、risk、audit。
- Tool executor。
- Policy Engine。
- Audit record。
- Confirmation requirement。
- Tool result standardization。

首批工具：

- `family.media.play`
- `family.media.resume`
- `family.media.next`
- `family.media.favorite`
- `family.schedule.today`
- `family.schedule.complete`
- `family.schedule.snooze`
- `family.english.start`
- `family.english.status`
- `family.weather.today`
- `family.album.status`
- `family.album.slideshow_start`
- `family.album.slideshow_stop`
- `family.device.status`
- `family.device.diagnostics`
- `family.memory.remember`
- `family.content.recommend`
- `family.openclaw.run`
- `family.homeassistant.scene`
- `family.nas.music.scan`
- `family.tools.status`

验收：

- [x] 后端可列出 tool registry。
- [x] AI 调用工具经过统一 policy。
- [x] 后台和手机可复用同一 tool executor。
- [x] 高风险工具支持确认、拒绝和审计。

### Phase 19：Page Agents

目标：一级页面拥有默认 Agent，页面内交互保持快速、自然、语义稳定。

Page Agents：

- Home Agent。
- General Agent。
- Weather Agent。
- Schedule Agent。
- Media Agent。
- Album Agent。
- English Agent。
- Tools Agent。
- Device Agent。

验收：

- [x] 每个一级页面有默认 Agent 配置。
- [x] 页面内短命令不先走全局 Router。
- [x] Agent 可以 handoff 到其他 Agent。
- [x] 家庭成员具备结构化 profile、persona 和 memoryPolicy。
- [x] Page Agent 自动注入成员可见记忆、学习记录和最近交互。
- [x] 后台可编辑成员性格画像并查看实际 Agent 上下文。
- [x] 页面 UI 保持稳定，只接收 display/action 结果。
- [x] Tools Agent 接入 OpenClaw/Home Assistant 安全工具链。
  - 说明：已验证工具注册、确认、拒绝、审计和 OpenClaw diagnostics success；HA 真实设备状态变化仍取决于真实 `HOME_ASSISTANT_URL/TOKEN`。

### Phase 20：手机 App 与连接桥

目标：手机 App 从预留进入最小可用，承担复杂管理和无 Wi-Fi 场景。

范围：

- 配网和绑定。
- 管理后台移动体验。
- 诊断和日志。
- 资源/内容导入。
- 家庭成员和权限管理。
- BLE/手机网络代理预研。

验收：

- [ ] 手机可完成新 Wi-Fi 配网。
- [x] 移动 Web 伴侣可查看设备状态和诊断报告。
- [x] 移动 Web 伴侣可导入媒体、相册和课程资源。
- [x] 断 Wi-Fi 场景有明确连接策略。

## 功能页面

### 首页

- 显示大时间。
- 显示天气摘要。
- 显示下一条日程。
- 显示 AI 当前状态。
- 显示快捷动作入口：AI、音乐、应用、英语。

### 天气

- 今日天气。
- 温度、湿度、空气质量等摘要。
- 简短预报和刷新。
- 不显示日程事项，不跳转日程。

### AI 对话

- 支持系统级唤醒词。
- 显示 AI 状态：待命、聆听中、思考中、回复中、异常。
- 显示声波或呼吸动画。
- 显示最近一句用户/AI 文本。
- 支持调用后端程序，例如 OpenClaw、音乐播放等。

### 音乐播放

- 分为两路能力：SD 卡本地音乐、服务器音乐/播客。
- 当前源播放/暂停。
- 当前源上一首/下一首或下一集。
- 音量控制。
- 当前歌曲、歌手、播放源。
- SD 卡音乐由 ESP32 本地扫描和播放，后续需要确认 1.85B 的 SD 接线与音频解码管线。
- 服务器音乐/播客由后端负责实际播放控制，ESP32 负责显示和发送动作。

### 相册 / 屏保

- 浏览 SD 卡和服务器同步的家庭照片。
- 支持上一张、下一张、幻灯片播放。
- 支持选择或预览屏保资源。
- 空闲后自动进入图片屏保。
- 触摸或唤醒词退出屏保。
- 支持夜间降低亮度或关闭屏幕。
- 不承载故事、播客、英语课程或小游戏资源管理。

### 游戏 / 应用

- 第一版保留本地小游戏。
- 后续由服务端下发应用列表。
- 应用以独立娱乐和家庭工具为主，可扩展。
- 不放设置、天气、音乐、英语、相册等已有明确职责的一级页面。

### 英语口语练习

- 偏口语跟读和 AI 对话练习。
- 支持今日主题。
- 支持跟读文本、练习进度、完成状态。
- 后续由后端提供内容和评分/记录。

### 日程

- 显示今日下一项。
- 显示今天剩余事项。
- 显示明天预告。
- 支持完成、稍后提醒。
- 可联动其他功能，例如英语练习提醒、音乐播放、后端任务执行。

### 通知提醒

- 统一处理日程提醒、英语提醒、后端任务提醒、系统异常提醒。
- 支持弹窗、声音、屏幕提示、稍后提醒、已完成。

### 设置

- Wi-Fi 状态。
- 后端地址。
- 小智连接状态。
- 音量。
- 亮度。
- 固件版本。
- IP 地址。
- 缓存/存储状态。

### 家庭模式

- 默认模式。
- 儿童模式。
- 夜间低亮/勿扰作为设备设置或 HA 场景，不再作为用户模式。
- 访客模式。
- 模式影响首页快捷入口、亮度、通知、主动播报和可访问功能。

## 固件能力

- AppShell 常驻外壳。
- LVGL 固定组件库：文本、按钮、卡片、列表、进度条、弹窗、图标、动画。
- Remote JSON UI Renderer：服务端下发页面描述，ESP32 根据 JSON 渲染页面。
- 系统级唤醒词：任何页面可进入 AI 对话。
- 通知提醒管理。
- 屏保管理。
- 本地兜底页面。
- 设备状态监控。
- LAN Action Client：向 `192.168.31.246:3100` 发送标准动作。

## 后端能力

- 页面 JSON 下发。
- 天气服务。
- 日程服务。
- 音乐控制：SD 卡本地音乐、服务器音乐/播客。
- 图片资源服务。
- OpenClaw / 其他程序调用。
- 英语口语练习内容。
- 通知推送。
- 应用列表。
- 语音意图分发。
- JSON 持久化状态存储。
- 远端部署脚本和健康检查。

## 动作协议草案

ESP32 不直接理解所有后端程序，只发送标准动作，由服务器分发执行。

```json
{
  "type": "action.call",
  "name": "music.play",
  "params": {
    "query": "周杰伦"
  }
}
```

第一版支持动作：

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
- `screensaver.start`
- `screensaver.stop`
- `english.start`
- `schedule.complete`
- `schedule.snooze`
- `app.open`
- `action.call`
- `toast`
- `dialog.open`

## Remote JSON UI 草案

页面由服务端描述，ESP32 只渲染白名单组件和执行白名单动作。

```json
{
  "version": 1,
  "page": "home",
  "layout": "watch-home",
  "children": [
    {
      "type": "text",
      "id": "clock",
      "text": "{{time}}",
      "style": "hero-time"
    },
    {
      "type": "text",
      "id": "weather",
      "text": "{{weather.summary}}",
      "style": "muted"
    },
    {
      "type": "button",
      "text": "AI",
      "icon": "mic",
      "action": {
        "type": "ai.toggle"
      }
    }
  ]
}
```

## 优先级计划

### P0：基础可靠性

- [x] 保持官方小智 OTA/MQTT/唤醒词连接稳定。
- [x] 完成 AppShell 主导航结构。
- [x] 首页支持时间、AI 状态、主要入口。
- [x] 设置页显示 Wi-Fi、小智状态、后端状态、版本、IP。
- [x] 设备状态页可用于不用串口排查问题。
- [x] AI 页面支持唤醒词触发和状态展示。

### P1：家庭核心能力

- [x] 接入 `192.168.31.246` 后端基础连接。
- [x] 实现天气数据展示。
- [x] 实现日程列表、下一条日程、提醒状态。
- [x] 实现通知提醒中心。
- [x] 实现音乐中心页面，区分 SD 卡本地音乐和服务器音乐/播客。
- [x] 实现英语口语练习第一版。
- [x] 实现后端 Action Client。

### P2：体验完善

- [x] 重新设计 A + C 视觉风格。
- [x] 首页改成圆屏手表式布局。
- [x] AI 页面增加声波/呼吸动画。
- [x] 实现图片屏保和空闲进入策略。
- [x] 实现快捷动作配置。
- [x] 实现用户模式：默认、儿童、访客。

### P3：扩展系统

- [x] 实现 Remote JSON UI Renderer。
- [x] 实现服务端页面 JSON 下发。
- [x] 实现应用/游戏列表由后端配置。
- [x] 支持更多后端程序调用，例如 OpenClaw。
- [x] 增加本地缓存和离线兜底策略。
- [x] 接入 1.85B SD 卡真实扫描、Ogg/Opus 解码和本地播放链路。
- [x] 增加应用版本兼容和页面 schema 校验。
- [x] 完成 `192.168.31.246:3100` 后端部署，保留 `3000` 端口现有服务。

### P4：SD 本地资源系统

- [x] 确认 Waveshare ESP32-S3 1.85B 的 SD 卡硬件接线、驱动和挂载方式。
- [x] 实现 `StorageManager`，统一管理 SD 挂载、状态、容量和错误信息。
- [x] 定义并读取 `/sdcard/manifest.json`。
- [x] 扫描 `/sdcard/music/local`，生成本地音乐列表。
- [x] 支持图片屏保读取 `/sdcard/images`。
- [x] 在设置页显示 SD 卡状态、容量、资源包版本。
- [x] 保留无 SD 卡时的本地兜底 UI。

### P5：离线优先与同步

- [x] 实现 `SyncQueue` 和 `/sdcard/outbox` 事件队列。
- [x] 后端增加 `POST /api/sync/push`。
- [x] 后端增加 `GET /api/sync/pull`。
- [x] 记录离线学习、音乐、日程和系统事件。
- [x] 网络恢复后自动上传 outbox。
- [x] 同步成功后清理或归档本地事件。

### P6：Remote JSON UI V1

- [x] 实现 ESP32 白名单组件 renderer。
- [x] 支持 `hero_status`、`app_grid`、`big_button`、`card`、`list` 的白名单校验。
- [x] 支持 `media_player`、`progress_ring`、`quiz_card`、`voice_orb` 的白名单校验。
- [x] 增加 schema 版本检查、字段长度限制、组件数量限制。
- [x] 未知组件安全拒绝，不执行非白名单内容。
- [x] 首批远程化应用列表和学习中心，本地首页/AI/设置保持兜底。

### P7：家庭能力扩展

- [x] OpenClaw action 深化。
- [x] Home Assistant action 接入。
- [x] NAS 音乐/播客目录接入。
- [x] 家庭通知和多成员状态。
- [x] 儿童、访客模式的权限和 UI 策略。

### P8：多网络预留

- [x] 抽象 `ConnectivityManager`，业务代码不直接依赖 Wi-Fi。
- [x] 预留 `WiFiProvider`、`BleProxyProvider`、`UsbProvider`、`FutureCellularProvider` 接口。
- [x] BLE 手机代理进入设计阶段。
- [x] USB 资源导入和诊断进入设计阶段。

### P9：语音 AI 全链路优化

#### 1. SRAM 安全水位

- [x] 将更多音频、网络任务栈和大缓冲迁移到 PSRAM。
- [x] 复用录音、解码和播放缓冲；AI 活跃期间暂停非必要后台任务。
- [x] 增加内部 SRAM 分级保护：低于 16 KB 时暂停资源同步等非必要任务，低于 12 KB 时禁止启动新的播放或高内存任务。
- [x] 真机覆盖官方回退、自建会话、MP3 播放和资源同步；各场景最低内部 SRAM 均不低于 20 KB，且无泄漏、panic 或重启。
- 验收证据：Opus 24 KB 常驻任务栈迁入 PSRAM 后，MP3 播放最低内部 SRAM 为 `49627` 字节，自建长会话启动低水位为 `38279` 字节，Provider 服务重启会话为 `41999` 字节，官方回退会话为 `39567` 字节；资源刷新 heartbeat 为 `资源已是最新`，当前空闲内部 SRAM 约 `52115` 字节。原基线 `2963 → 17275`（MP3）与 `2619 → 15431`（官方回退）保留在实施记录。

#### 2. 首音频延迟

- [x] 页面变化时主动同步上下文，由 Provider 缓存；迁移期间保留 `self.page.get_context` 按需读取作为兼容兜底。
- [x] Provider 到 Backend 复用连接，Backend 和 TTS 按句流式输出，避免等待完整回答后再开始播报。
- [x] 记录 ASR 结束、上下文就绪、Backend 返回、TTS 首包和设备首音频等阶段耗时。
- [x] 确定性 Page Agent 的“说完到首音频”达到 P50 不高于 2 秒、P95 不高于 3.5 秒。真机四个有效样本为 `1305/1341/2816/2865 ms`，nearest-rank P50=`1341 ms`、P95=`2865 ms`。

#### 3. 大模型调用边界

- [x] Page Agent 和设备控制优先使用确定性路由与 Capability Tools，不为可确定处理的请求调用大模型。
- [x] 只有开放问答、复杂推理或 Backend 明确返回 `handled=false` 时才进入大模型路径。
- [x] 简单闲聊使用轻量模型，复杂推理继续使用 `gpt-5.5`。
- [x] 同一请求最多调用一次大模型，并记录 `modelName`、`fallbackReason` 和调用耗时；不得出现 Backend 与 Provider 双回答。

#### 4. 故障隔离与自动回退

- [x] 为 ASR、Backend、LLM 和 TTS 分别设置独立超时、取消机制和可诊断错误状态。
- [x] 增加 Backend 熔断、自建 Provider 健康探测和自动恢复，避免故障期间每轮对话重复等待超时。
- [x] 设备动作增加 `actionId`、幂等校验和重放保护，重连后不得重复执行已确认动作。
- [x] “停止对话”保持最高优先级，可立即取消 Agent、LLM、TTS 和播放。
- [ ] 逐项注入超时、断网和服务重启；设备均能回到 idle 或官方回退，且不重复执行动作。

#### 5. 连续对话体验

- [x] 优化 VAD/ASR 断句，减少正常停顿被提前提交和尾音被截断。
- [x] 支持播报中打断，并在新一轮输入开始前取消旧 TTS 和剩余音频。
- [x] 长回答先播结论，后续内容继续按句流式生成和播放。
- [x] 区分“停止播放”和“停止对话”；高风险动作在低置信度 ASR 下先确认。
- [ ] 真机覆盖停顿、抢话、连续唤醒、播放中打断和误识别场景。

#### 6. 全链路可观测性

- [x] 每轮生成统一 `traceId`/`sessionId`，贯穿设备、Provider、Backend、Page Agent/LLM 和 TTS。
- [x] 统一记录 ASR 长度与耗时、页面上下文、路由结果、模型调用、首音频延迟、SRAM 低水位、退出原因和回退状态。
- [x] 管理后台提供脱敏后的对话链路诊断视图，可按设备、会话和时间查询。
- [x] 任意一次“卡住”都能定位到具体阶段；日志不得包含令牌、Authorization、原始密钥或不必要的家庭敏感数据。

#### 7. 家庭记忆与隐私

- [x] Provider 保持无本地长期记忆，结构化家庭记忆统一由 Backend 管理。
- [x] 记忆支持成员作用域、可见范围、来源、过期时间和记忆策略。
- [x] 家长可查看、修改、删除和关闭记忆；儿童与访客遵守成员和模式权限隔离。
- [x] 覆盖跨成员隔离、过期、删除、关闭记忆和 Backend 不可用场景；默认不保存原始语音或完整对话。

#### P9 统一验收

- [x] 固件构建、后端 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 和 Provider 自动化测试全部通过。
- [ ] 真机完成自建对话、官方回退与恢复、MP3、资源同步、连续打断和服务故障注入。
- [x] 只有实际完成且有日志或真机证据的项目才能勾选，并在“实施记录”中登记对应证据。

### P10：Family Hub 后端九方向优化

目标：在保持现有设备、API、SQLite 数据和语音链路向后兼容的前提下，将 Family Hub 从可运行版本提升为稳定、真实、可维护的家庭服务。按三个版本逐步部署到 `192.168.31.246:3100`；家庭画像与长期记忆默认只保存在 246 或用户明确指定的本地介质。

#### 第一阶段：稳定性基础版

##### 1. 设备崩溃与重启诊断

- [x] 固件最小增量上报 `bootId`、`bootSequence`、`uptimeSec`、`firmwareBuild`、复位原因和脱敏后的 `panicSummary`；旧固件不提供这些字段时后端继续兼容。
- [x] 后端以 `bootId` 建立启动会话；同一启动会话的重复心跳只统计一次复位，避免把持续上报的上一次 `resetReason` 误判为多次崩溃。
- [x] 设备稳定状态统一为 `healthy`、`startup_pending`、`backend_unreachable`、`crash_loop`；10 分钟内至少两个不同 panic 启动会话才判定 `crash_loop`。
- [x] 启动后 180 秒内的后端探针失败归为 `startup_pending`，连续失败超过阈值后才生成后端不可达事件。
- [x] 设备日志按 30 天或 20000 条保留，启动会话保留 180 天；管理端显示最近启动、连续运行时间、不同启动会话 panic 次数和复位历史。

##### 4. 全链路运行监控

- [x] HTTP 中间件接受或生成 `requestId`，通过响应头和响应体贯通 Agent、设备命令、Home Assistant、OpenClaw、安全审计和错误日志。
- [x] 记录接口状态码与耗时、命令创建/投递/ACK 耗时、依赖错误和设备离线区间；外部服务耗时与后端自身耗时分开统计。
- [x] 新增受管理鉴权保护的 `GET /api/admin/metrics` 和 `GET /api/admin/devices/:id/diagnostics`，并在管理端展示稳定性、命令成功率和依赖健康度。
- [x] 服务日志统一为结构化 JSON，集中脱敏 token、Authorization、Cookie、密码和不必要的家庭隐私字段。
- [x] 任意一次设备重启、命令失败或外部服务超时，都能由 `requestId` 或 `bootId` 定位到完整链路。

##### 9. 统一部署、备份与回滚

- [x] 替换当前与实际 systemd 环境不一致的旧部署脚本，固定使用 `/opt/xiaozhi-family-hub`、`xiaozhi-family-hub.service` 和 `xiaozhi-mcp-bridge.service`。
- [x] 使用版本化 release 目录、`current` 软链接和共享 `data`、`secrets`、`resources`；部署前自动创建代码备份和 SQLite 在线备份。
- [x] 部署流程固定为本地测试、远端备份、安装依赖、远端语法检查、切换 release、按变更重启 Family Hub/MCP/Voice Provider、LAN 与公网 smoke。
- [x] 每日执行 SQLite 备份和完整性检查，保留 14 个日备份与 8 个周备份；每个阶段至少完成一次真实恢复演练。
- [x] 在 246 并行安装独立 Node 22 LTS runtime，systemd 显式使用该路径；保留 Node 18、上一 release 和迁移前数据库作为快速回滚路径。

#### 第二阶段：家庭产品化版

##### 2. 真实家庭成员档案

- [x] 成员档案增加 `relationship`、`profileVersion`、`createdAt`、`updatedAt`；关系支持爸爸、妈妈、监护人、孩子和访客。
- [x] 保留现有 `parent`、`child`、`guest` 占位档案，不自动虚构姓名；通过管理端创建每位真实家长和孩子的独立画像、性格与记忆策略。
- [x] 默认模式只能选择家长成员，儿童模式只能选择孩子，访客固定使用访客档案；删除当前成员时自动选择同角色备用成员。
- [x] 增加成员归档、导出、显式级联删除和切换审计；删除时必须明确选择保留、转移或删除该成员记忆。
- [x] 访客禁止读取或写入成员/家庭长期记忆；不同孩子的学习记录、兴趣、内容限制和最近互动严格隔离。
- [x] 扩展现有成员 API 返回新增字段，保留当前 URL 和旧字段；补充档案导出、归档与安全删除管理接口。

##### 3. 真实家庭内容与验收

- [x] 建立家庭自有内容包规范；相册、播客、英语课程和小游戏均包含 manifest、版本、SHA-256、类型和来源说明。
- [x] 英语包支持课程 JSON、音频与封面；小游戏包支持题库/关卡 JSON 和必要媒体资源。
- [x] 内容导入检查路径穿越、文件大小、扩展名、重复内容、音频兼容性和 manifest 一致性，失败时不得留下半导入状态。
- [x] 示例、诊断和占位内容进入独立命名空间，生产页面默认隐藏，且不能满足真实内容验收条件。
- [ ] `real-family-content` 只有在真实英语和游戏素材于设备端实际进入、播放或运行并人工确认后才能标记 passed；未提供真实素材时保持 pending。
- [x] BluFi 状态分开显示“历史人工验收”和“近期配网就绪信号”，近期没有配网事件不得覆盖已经通过的历史证据。

##### 8. 真实 Provider 与模拟状态治理

- [x] 所有集成统一返回 `real`、`cached`、`mock`、`simulated`、`unavailable` 来源状态，管理端和诊断报告使用相同定义。
- [x] 将 Open-Meteo 天气正式配置到 246；刷新失败时保留缓存，并显示来源、更新时间、陈旧状态和失败原因。
- [x] Home Assistant、OpenClaw、天气、媒体和语音服务明确区分真实执行与模拟结果；模拟结果不得写入真实验收证据。
- [x] 生产媒体和内容列表默认过滤诊断音频、示例资源和占位文件，同时保留受控的诊断入口。

#### 第三阶段：平台工程化版

##### 5. SQLite 数据模型与迁移

- [x] 使用 Node 22 内置 SQLite API 和 `schema_migrations` 管理显式、事务化、可重复的数据库迁移，停止每次写入调用外部 `sqlite3` 子进程。
- [x] 建立成员、活动成员、记忆、学习记录、最近互动、设备启动、设备日志、设备命令、媒体进度、验收证据和令牌关系表及必要索引。
- [x] 第一阶段采用关系表与 `kv.state` 双写并进行一致性校验；连续两个稳定发布周期后切换关系表读取，再停止整块状态重写。
- [x] 迁移失败必须回滚事务并保持旧服务可启动；原 `kv.state` 至少保留两个稳定版本作为兼容快照。
- [x] 数据迁移前后校验记录数量、成员活动指针、记忆归属、命令状态、验收证据和安全审计，无静默丢失或重复。

##### 6. 鉴权、安全与幂等

- [x] 分离管理令牌、设备令牌和 AI/MCP 令牌；数据库只保存令牌哈希、作用域、创建时间、最后使用时间和撤销状态。
- [x] 令牌作用域至少包含 `admin:*`、`device:write`、`agent:invoke`、`content:write`，提供创建、撤销和轮换接口，明文只返回一次。
- [ ] 旧固件在兼容期继续使用 LAN 入口；新固件稳定后启用设备令牌强制校验，公网写入口始终要求对应鉴权。
- [x] `/api/action`、Agent 工具和设备命令支持 `Idempotency-Key`，结果保留 24 小时，重复请求返回原结果且不得重复执行副作用。
- [x] 默认限流：Agent 30 次/分钟、Action 60 次/分钟、设备日志 120 次/分钟、管理接口 120 次/分钟，并允许通过环境变量调整。
- [x] query string token 保留两个版本的兼容告警后默认关闭；浏览器 CORS 收紧为 LAN 与配置域名白名单。

##### 7. 后端模块与测试结构拆分

- [x] 将集中式路由按 `family`、`devices`、`agent`、`media`、`acceptance`、`admin` 拆分，保持现有 URL、状态码和响应结构兼容。
- [x] 路由层只处理输入输出，业务规则进入 service，SQLite 操作进入 repository，Home Assistant/OpenClaw/天气/语音进入 adapter。
- [x] 每次只迁移一个路由组，迁移前先补契约测试，迁移后比较新旧响应并运行完整 smoke，避免一次性重写。
- [x] 使用 Node 内置测试框架补充单元测试，覆盖启动会话去重、成员角色约束、访客记忆隔离、幂等、限流、迁移和内容包校验。

#### P10 API 与兼容约束

- [x] 设备日志只增量增加 `bootId`、`bootSequence`、`uptimeSec`、`firmwareBuild`、`panicSummary` 和 `requestId`；旧请求体继续接受。
- [x] Action、Agent、Home Assistant/OpenClaw 历史和设备命令统一返回 `requestId`，旧客户端忽略新字段时仍可正常工作。
- [x] 数据库和 API 迁移期间不得破坏当前三种身份模式、活动成员指针、媒体播放、官方小智链路或设备离线兜底。

#### P10 统一测试与发布验收

- [x] 每个阶段执行 `npm run check`、`npm run smoke`、`npm run smoke:sqlite`、新增单元测试和 Provider 自动化测试，全部通过后才允许部署。
- [x] SQLite 覆盖迁移、双写一致性、备份恢复、旧版本回滚和 20 个并行写请求测试；不得出现数据丢失、重复副作用或数据库损坏。
- [x] LAN 只读接口 P95 不高于 250ms，本地 mutation P95 不高于 500ms；外部 Provider 延迟单独统计，不掩盖后端自身耗时。
- [x] 每阶段部署 246 后验证 Family Hub、MCP Bridge、Voice Provider、LAN/公网健康、SQLite integrity、三种身份模式和关键 Agent 请求。
- [x] 第一阶段协同固件构建并刷入真机，至少观察 30 分钟；确认 `bootId` 统计正确、无新增 panic 启动、心跳、模式切换、音频和小智链路正常。
- [x] 每阶段保留上一 release 和数据库备份；迁移校验、健康检查或真机核心流程失败时立即回滚，且不得记录通过证据。

## 实施记录

- 2026-07-12：完成 AI 全链路优化最终发布与真机验收。最终固件 `build/xiaozhi.bin` SHA-256 为 `2b57bd21bedcbfb958d48b9e29536cba81a6a66a9e096abb81012e0f0848a877`，ELF SHA-256 为 `c22b0bf3e6598998a3cfb52a0ec53366542f804d912ed5e057c85f0df55dc354`；刷入后 boot #108 验证 LCD、触摸、SD、BQ27220、Wi-Fi、OTA、router5 WebSocket 正常，summary/event/page-context 三个常驻 worker 只在启动时创建。246 最终 Family Hub release 为 `/opt/xiaozhi-family-hub/releases/20260712121100-ai-latency-final`，router5 镜像 SHA 为 `fa4f3bcdea5c86a313a31f3b1d904098f29ca1ead6a025cc52f330e18839cb27`，Family Hub/MCP active、Provider restart 0、SQLite integrity `ok`。以 `2026-07-12T02:49:35Z` 为边界固定 10/8/2 轮样本：确定性首音频 P50/P95 `1498/4412 ms`，lightweight `3317/4370 ms`，complex `6680/8814 ms`，失败为 0；无静音、DSML、首包/解码丢包或异常断连，heartbeat 捕获的首包到 PCM P95 为 `36 ms`。实时模式没有设备 `listen stop`，相关设备指标保持 `-1`，ASR finalize 不伪造；心跳记录到最多 2 次会话收尾 WebSocket send failure，但未造成音频丢失、Provider 重启或连接异常。两小时稳定性窗口使用 warm-up 后首个稳定 heartbeat（uptime `1943s`、free heap `7450516`）到 uptime `9211s`（`7268s`/121 分钟、free heap `7452580`），总 heap 净变化 `+2064` 字节，最低内部 SRAM `68719` 字节，同一 bootId、无 panic/看门狗/重启。最终后端 26 项测试、三套 smoke、Provider 34 项测试、ESP-IDF 完整构建和 `git diff --check` 通过；回滚点保留 `/opt/xiaozhi-family-hub/backups/ai-latency-20260712-085423`、`/opt/xiaozhi-family-hub/backups/sqlite/pre-20260712121100-ai-latency-final.sqlite`、router4 和 `artifacts/firmware-backups/esp32-app-before-ai-latency-20260712.bin`（SHA-256 `cc778ef3e4fd18ea3403d118fe03d7e42475d5cabee940db8f4c824e190063a5`）。
- 2026-07-11：完成真实儿童档案建档。根据用户明确提供的信息，在 246 通过正式管理 API 创建唯一儿童成员 `liuliu`（溜溜、女孩、小学四年级），未虚构兴趣、禁忌或额外个人资料；儿童模式活动成员切换为 `liuliu`，默认模式恢复并保持活动家长 `dad`，内置 `parent/child/guest` 继续作为兜底。只读上下文发现历史家庭级占位记忆会进入儿童上下文，因此将溜溜的 `includeFamilyMemory` 关闭，保留个人记忆和学习记录，复验 memory/learning 均为空且最近互动只属于 `liuliu`。变更前 SQLite 备份为 `/opt/xiaozhi-family-hub/shared/data/family-hub.sqlite.bak-liuliu-20260711-201235`，备份和当前数据库 integrity 均为 `ok`。
- 2026-07-11：完成 P10 后端平台工程化收口并部署 246 release `20260711120336-05e0a74d0380`。集中式 `routes.js` 从约 1954 行降至约 1020 行，`family/devices/agent/media/acceptance/admin` 均由独立路由模块注册；Agent 与媒体迁移保持 URL、状态码和响应结构，内存、兼容 SQLite、关系读取 SQLite smoke 全部通过。新增 `src/adapters/`，OpenClaw 同步 Action 与异步 Capability 共用子进程/超时/输出截断 adapter，HA、Open-Meteo、语音事件通过统一 adapter 边界；新增 OpenClaw adapter 契约测试，Node 测试增至 23，Voice Provider 全量 31 passed。246 上 Family Hub/MCP active、Voice Provider running、SQLite integrity `ok`，默认 Agent 请求解析活动家长 `dad`，媒体 Range 返回 206，LAN/公网健康通过。设备串口确认仍在运行且最低 SRAM 约 63 KB，但最新心跳未持续上报，后端保留此前 `crash_loop` 历史状态；该固件心跳缺口作为独立残余问题，不影响本次纯后端路由契约发布。
- 2026-07-11：推进并部署 P10 九方向优化到 `192.168.31.246:3100`。246 已切换到独立 `/opt/node-v22` (`v22.23.1`) 和版本化 release/shared 布局，启用关系表读取、紧凑 `kv.state`、每日 SQLite backup timer、14 日/8 周保留、LAN/公网逐 URL 重试 smoke 与失败自动回滚。首次旧库迁移发现早期 `device_logs` 缺少 `boot_id`，迁移事务正确中止并自动回滚；修正为补列后建索引并增加旧表回归。完成最新日备份隔离恢复到临时端口、SQLite integrity/计数验证、上一 release 与当前 release 往返回滚演练。
- 2026-07-11：完成 P10 SQLite 冷恢复数据修复。恢复演练发现历史日志重复 ID 和关系读取只还原业务 `data`、遗漏关系列；新增稳定 ID 去重、完整日志关系映射和冷启动测试。使用首次迁移前备份恢复 300 条历史日志，与 5 条新日志合并为 305 条，恢复后空时间日志为 0、`integrity=ok`、mirror consistency 通过，并保留恢复前数据库备份。
- 2026-07-11：完成成员、内容、Provider 和安全生产验收。246 保留 `parent/child/guest` 占位档案，新增独立 `dad`/`mom` 家长档案，默认活动家长最终设为 `dad`，导出与活动指针切换通过；未虚构真实姓名、兴趣或儿童资料。导入原创英语课程和家庭问答游戏包，SHA-256/manifest/readiness 为 5/5，但 `real-family-content` 仍保持历史 `pending`，等待真机人工打开确认。Open-Meteo、HA、OpenClaw、媒体来源状态验证为统一枚举；生产设备令牌完成哈希存储、创建、轮换、撤销和公网 401 验证。
- 2026-07-11：完成 P10 后端测试与部分模块拆分。新增 managed token、内容包、启动会话、成员生命周期、访客隔离、限流、幂等、SQLite 迁移/失败回滚/紧凑快照/20 并行写等 20 个 Node 单测；内存、兼容 SQLite、关系读取 SQLite smoke、天气测试和 20 个 Voice Provider 测试通过。路由已拆出 `family`、`devices`、`admin`、`acceptance`，`agent`、`media` 仍按逐组迁移约束保持未完成。
- 2026-07-11：扩展家庭内容包媒体规范，`english`/`game` 可在同一 pack 下使用 `assetRole` 关联 JSON、MP3/Ogg/Opus、JPG/PNG，导入时校验音频/图片真实文件头；内容、限流与幂等加入后 Node 单测增至 21，完整 smoke 通过并发布 246。公网 query token 返回 401，允许域名返回精确 CORS origin，非白名单 origin 不返回 CORS 授权头。
- 2026-07-11：固件完成 `bootId/bootSequence/uptimeSec/firmwareBuild/panicSummary` 增量上报并两次构建刷入 `/dev/cu.usbmodem101`。首次长测启动会话持续约 113 分钟无 panic，但服务器媒体播放后 background HTTP 通道不能恢复，因此未记录通过；修复为媒体播放期间仅保留事件探针/ACK，暂停 summary/context/action，流停止后延迟 5 秒恢复。修复版 `boot -83` 已验证 MP3 真机进入 running、自然关闭、5 秒后心跳 `backendRefresh=刷新成功`，最终 30 分钟观察结论以本条后续记录为准。
- 2026-07-11：修复版固件 `boot -83` 完成 30 分钟真机观察，最终 `uptimeSec=1823`、`health=healthy`、同一 bootId、无 panic；串口确认服务器 MP3 播放/自然关闭、后台探针恢复、心跳持续、内部 SRAM 最低约 49.6 KB。默认/儿童/访客模式切换后恢复默认模式，默认活动家长为 `dad`；设备命令创建、真机执行和 ACK 闭环通过。

- 2026-07-02：补充完整大线路阶段计划，明确 `Phase 0-10` 是产品长期演进路线，`P0-P8` 是当前工程任务优先级；避免后续讨论中 Phase 5 和 P5 混淆。
- 2026-07-02：项目方向升级为 Family AI OS V2：保留小智官方高速 AI 主链路，自建后端负责家庭能力、资源、UI 和同步，ESP32 负责本地 UI、SD 资源、离线队列和稳定入口；新增 `architecture-v2.md` 作为后续架构基准。
- 2026-07-02：完成第一阶段本地 LVGL AppShell、LAN 后端客户端、Node.js Express 后端骨架、模拟数据接口、Action Hub、后端离线兜底、A + C 圆屏 UI、设置/设备状态、通知、屏保、家庭模式、音乐、日程、英语口语和应用/游戏入口。
- 2026-07-02：音乐页调整为双通道音乐中心：SD 卡本地音乐 + 服务器音乐/播客；第一阶段完成 UI、状态模型和 action 协议，真实 SD 播放链路待硬件与解码确认。
- 2026-07-02：后端重构为模块化 Express 服务，补齐 JSON 持久化、Action Hub、Remote JSON UI 页面下发、部署脚本和 smoke test；`192.168.31.246:3000` 已有现存 Express 服务，改用 `192.168.31.246:3100` 独立部署。
- 2026-07-02：后端已部署到 `192.168.31.246:3100`，使用 `/opt/xiaozhi-family-hub` 与 systemd `xiaozhi-family-hub.service` 托管；`3000` 端口现有服务保持不变。
- 2026-07-02：完成一轮圆屏 UI 抗挤压修复：收窄顶部/底部安全区、缩小 tile/list 共用组件、压缩页面底部按钮行，并重点调整首页、天气、AI、音乐、应用、英语、日程、通知、设置、家庭模式和小游戏页面。
- 2026-07-02：AI 对话页升级为前端动态视觉：按小智状态切换主色，增加呼吸光环、轨道点、声波柱和状态胶囊；打开 AI 页时持续刷新轻量动画。
- 2026-07-02：修正 AI 对话页动效体验：光环下移并缩小避免被顶部状态区裁切，移除空闲态“轻触开始对话”长提示，动画改为 LVGL 120ms timer 独立刷新，避免 1 秒刷新带来的卡顿感。
- 2026-07-02：修正 AI 页动画与触摸事件冲突：“开始说话”改为按下即触发，触摸按住期间暂停动画重绘，避免按钮被重建导致点击丢失。
- 2026-07-02：修正音乐页底部控制区：服务器播客 4 按钮和 SD 卡 5 按钮分别采用等间距布局，控制按钮扩大触摸命中并改为按下即触发，同时 action 发出后立即刷新底部反馈。
- 2026-07-02：针对随机白屏重启做稳定性止血：移除 AI 页 120ms 整页重建动画，异步 AI/后端状态更新在触摸按住时改为延迟重绘，避免正在交互的 LVGL 对象被删除。
- 2026-07-02：定位白屏重启主因在后端 HTTP 访问链路：连续请求触发底层 `HttpClient/EspTcp` 看门狗/回调竞态；固件端后端客户端切换为 ESP-IDF `esp_http_client`，请求串行化，action 直接解析返回 summary，并对 action/refresh 做互斥和限流。
- 2026-07-02：继续加固快速点击场景：AppShell 后端 action 改为单队列调度，刷新和动作互不抢占，高频音量点击合并为一次请求，后台 worker 栈提升到 8KB，降低页面切换和按钮连点时的白屏/重启风险。
- 2026-07-02：落地 V2 基础底座：完成 1.85B SDMMC 4-bit 引脚配置与挂载、`StorageManager`、`ResourceManager`、`SyncQueue`、`ConnectivityManager`、`AudioSessionManager`、Remote JSON UI schema/白名单校验、后端资源清单与 sync push/pull API；固件重新构建通过。
- 2026-07-02：重新部署后端到 `192.168.31.246:3100`，systemd `xiaozhi-family-hub.service` active；验证 `/api/health`、`/api/device/summary`、`/api/resources/manifest`、`/api/sync/pull`、`/api/sync/push` 正常。
- 2026-07-02：Remote JSON UI renderer 第一版完成，可渲染白名单组件并绑定白名单 action；更复杂的图像、动画和组件版本治理继续后续扩展。
- 2026-07-02：完成 P1-P8 工程闭环补齐：ESP32 Remote JSON UI 白名单 renderer 可渲染远程应用页/英语页；SD 本地音乐接入 Ogg/Opus 文件播放链路；Connectivity provider 预留 Wi-Fi/BLE/USB/蜂窝；后端增加 Home Assistant、NAS 音乐扫描、家庭成员状态和模式权限 action，并扩展 smoke test。
- 2026-07-02：P1-P8 本地构建与后端部署验证通过；已烧录到 `/dev/cu.usbmodem101`，串口确认 1.85B LCD、触摸控制器、音频 codec、Wi-Fi、小智官方 OTA/MQTT、唤醒词链路启动正常，观察约 40 秒未见 panic 或重启循环。
- 2026-07-02：真机启动日志显示 SD 卡本轮挂载失败，SD 插卡、格式和本地音乐/图片资源真实播放显示仍需单独复测。
- 2026-07-02：定位 SD 挂载失败原因为卡上原文件系统不可挂载，`vfs_fat_sdmmc` 返回 FatFS code 13；通过临时开启一次性格式化修复，随后刷回正式固件并关闭自动格式化。正式固件串口确认 `format_if_failed=0` 仍可挂载 SDHC 卡，4-bit bus 正常。
- 2026-07-02：启用 FatFS 长文件名和 UTF-8 API，修复 `/sdcard/animations` 等超过 8.3 文件名目录创建失败问题；资源包仍建议优先使用英文/数字文件名。
- 2026-07-02：确定 SD 卡路线选择 FAT32 标准资源卡，不在当前阶段引入 exFAT；新增 `docs/sd-card-resource-pack.md` 作为资源包格式、目录和安全规则。
- 2026-07-02：完成 SD 图片屏保真实显示闭环：屏保支持 SD JPG/JPEG 解码和 192x104 RGB565 raw 预览图，空 `/sdcard/images` 会自动生成诊断图 `sample.rgb565.bin`；真机串口确认自动屏保已加载 `/sdcard/images/sample.rgb565.bin` 并显示，JPG 家庭照片待放入 SD 后做视觉复测。
- 2026-07-02：推进 SD 本地音乐真机验证：固件在空 `/sdcard/music/local` 时会生成内置 Ogg 诊断音频 `sample-success.ogg`，已重新构建并刷入设备；真实播放验收等待在音乐页选择 SD 卡并点击播放后确认。
- 2026-07-02：用户确认 SD 本地音乐可播放；Phase 4/6 的 SD 本地 Ogg/Opus 播放验收完成。
- 2026-07-02：完成 Phase 1-6 收尾实现：后端新增服务器媒体目录 `/opt/xiaozhi-family-hub/data/resources/music/server`、`GET /api/media/server/tracks`、`GET /api/media/server/stream/:id`，资源 manifest 增加 `sha256`、`size`、`contentType`、`version`；固件新增服务器播客 HTTP Ogg/Opus 分块拉流播放器、资源包下载校验更新、Remote JSON UI 未知组件/未知 action 安全处理和 AI 抢占音乐的音频会话规则。
- 2026-07-02：后端重新部署到 `192.168.31.246:3100`，验证 `/api/health`、`/api/media/server/tracks`、`/api/media/server/stream/:id`、`/api/resources/manifest`、`/api/sync/push`、`/api/sync/pull` 正常；`3000` 端口未被占用或替换。
- 2026-07-02：完成真机断网/恢复同步验证：停掉 `xiaozhi-family-hub.service` 后设备后端请求失败但未重启；恢复服务后 `/api/sync/pull` 中 sync received 从 18 增加到 22，确认 SD outbox 自动 flush 成功。
- 2026-07-02：最新固件重新构建并刷入 `/dev/cu.usbmodem101`；串口确认 1.85B LCD、触摸、SDMMC 4-bit、音频 codec、Wi-Fi、小智官方 OTA/MQTT、唤醒词、后端刷新和 SD 屏保启动正常，短时观察未见 panic、白屏或重启循环。
- 2026-07-03：完成 Phase 7 家庭能力收口：Action Hub 增加模式权限策略、安全审计、家庭成员/等级通知、`voice.intent` 语音意图分发、OpenClaw job 编排入口、Home Assistant 调用历史；未配置 `OPENCLAW_COMMAND`、`HOME_ASSISTANT_URL`、`HOME_ASSISTANT_TOKEN` 时保持模拟执行。
- 2026-07-03：完成 Phase 8 手机伴侣最小原型：后端新增 `/companion` 移动端 Web 控制台，可查看状态、切换家庭模式、注册设备、触发音乐/英语/OpenClaw/HA/语音意图、查看日志和集成状态；BLE/USB provider 继续保留为后续原生连接层。
- 2026-07-03：完成 Phase 9/10 后端基础：新增设备注册、设备日志、admin dashboard、表结构数据模型、OTA manifest、兼容性 API、多设备注册和安全边界；SQLite 已完成正式迁移，PostgreSQL 保留为后续扩展。
- 2026-07-03：后端新版本重新部署到 `192.168.31.246:3100`，验证 `/api/health`、`/api/compatibility`、`/api/family/policies`、`/api/integrations/status`、`/api/ota/manifest`、`/api/admin/dashboard`、`/api/intent` 和 `/companion` 正常。
- 2026-07-03：固件重新构建并刷入 `/dev/cu.usbmodem101`；串口确认冷启动、SD、LCD/触摸、音频、Wi-Fi、小智官方 OTA/MQTT、唤醒词、后端刷新正常。真机触发服务器播客后串口显示 `Opened ogg stream http 200`、读取 2012 bytes、`Server podcast finished: ok`，服务器播客真实播放闭环完成。
- 2026-07-03：完成后端 SQLite 迁移：新增 `STORE_DRIVER=sqlite`、`SQLITE_FILE=/opt/xiaozhi-family-hub/data/family-hub.sqlite`，首次启动从 `state.json` 迁移；远端已安装 `sqlite3`，`/api/admin/database/schema` 确认 driver 为 `sqlite`，SQLite 表包含 `kv`、`devices`、`device_logs`、`sync_events`、`security_audit`。
- 2026-07-03：完成 USB/诊断后端闭环：新增 `/api/usb/import`、`/api/resources/import`、`/api/diagnostics/report`；远端测试导入 `cache/remote-smoke.txt` 后资源 manifest 显示新文件，诊断报告返回 SQLite store、设备摘要、资源 manifest、日志和安全审计。
- 2026-07-03：完成 Phase 1-10 收口验收：后端本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过；远端 `192.168.31.246:3100` 健康检查、SQLite、资源 manifest、媒体目录、诊断报告通过；固件重新构建并刷入 `/dev/cu.usbmodem101`，30 分钟真机串口长测通过。OpenClaw 命令适配器已验收，真实控制仍需在运行环境配置 `OPENCLAW_COMMAND`。
- 2026-07-03：新增 Phase 11-15 下一阶段路线：按真实家庭闭环推进 OpenClaw 真实程序编排、家庭内容与资源运营、手机伴侣与 BLE 配网/代理、Remote JSON UI V2、AI 增强层与家庭记忆。
- 2026-07-03：完成 Phase 11-15 第一轮全量落地：后端新增真实 OpenClaw job 状态、内容 catalog/seed/import、资源 manifest schema 2、Remote JSON UI V2、家庭记忆/学习记录和 AI intent 工具分发；伴侣页新增内容库、OpenClaw jobs、Remote UI 预览、记忆和诊断面板；新增 `docs/ai-enhancement-privacy.md`。
- 2026-07-03：远端重新部署到 `192.168.31.246:3100`，SQLite driver 生效；`/usr/local/bin/openclaw` 已指向真实 OpenClaw CLI，`openclaw.run default/diagnostics` 进入真实 failed job 而非 simulated，失败原因是当前 OpenClaw CLI 未提供 `default`/`diagnostics` target 命令元数据；儿童/访客/夜间模式权限拒绝已验证不会新增 job。
- 2026-07-03：内容系统远端验收完成：`/api/content/seed` 生成相册、英语、播客、故事、小游戏示例包；`/api/content/import` 导入 `courses/stories/story-smoke.json`；`/api/resources/manifest` 返回 schema 2、内容包、catalog、sha256/size/contentType/version 和资源包归属。
- 2026-07-03：Remote UI V2 远端验收完成：`/api/ui/capabilities` 返回 schemaVersion 2、profile、组件能力和主题 token；`/api/ui/page/apps`、`/api/ui/page/english`、`/api/ui/page/content` 可下发 V2 页面；固件 renderer 接受 V1/V2 并保留字段长度、组件数量和 action 白名单。
- 2026-07-03：AI 增强层远端验收完成：`/api/intent` 已触发音乐/播客和内容推荐，OpenClaw 通过真实 job 链路触发；`english.start` 写入学习记录；`/api/memory` 创建、更新、删除验收通过；官方小智 OTA/MQTT、唤醒词和基础对话链路启动正常。
- 2026-07-03：固件启用 `CONFIG_USE_ESP_BLUFI_WIFI_PROVISIONING=y` 并关闭热点默认配网，构建通过并刷入 `/dev/cu.usbmodem101`；串口确认 1.85B LCD、触摸、SDMMC 4-bit、音频 codec、Wi-Fi、小智官方 OTA/MQTT、唤醒词和后端启动正常，无 panic 或重启循环。EspBlufi App 写入新 Wi-Fi 的人工验收待执行。
- 2026-07-04：重构圆屏 AppShell 为四区 UI 基线：紧凑顶部系统栏（时间、首页、短标题、后端状态、设置）、页面主体区、页面业务操作栏和底部轻状态栏；同步适配首页、应用、天气、日程、设置、音乐和 AI 对话页，释放内容主体显示空间并减少全局导航按钮与页面内容重叠。
- 2026-07-04：收敛底部轻状态栏职责：不再承载 AI 对话正文，只保留单行轻状态和动作反馈，并改为跑马灯显示；AI 正文留在 AI 页面自身内容区，主体内容区进一步放大。
- 2026-07-04：细化底部轻状态栏跑马灯规则：短文本一行可显示时保持居中静止，只有溢出时才启用从右向左循环滚动。
- 2026-07-04：新增设备重启原因记录：启动时读取 `esp_reset_reason()`，用短 NVS key 持久化启动次数、reset code 和中文原因；设置页显示“重启”诊断 tile，用于区分低压掉电、供电毛刺、看门狗、panic、USB/刷机复位等情况。
- 2026-07-04：重组设置页为“设备中心”：设置首页显示网络、连接、电源、存储、系统、诊断六个概览卡片；新增网络/连接/电源/存储/系统/诊断详情页，其中连接页包含 Wi-Fi、蓝牙 BluFi、USB 和未来 4G/eSIM provider 状态。
- 2026-07-04：补齐 1.85B 电量读取根因记录和首版实现：当前“电池 未接入”并非电池物理未连接，而是 AppShell 板级层此前没有接入 1.85B 官方 BQ27220 电量计；新增 BQ27220 最小只读驱动读取 SOC/电压/电流，并将读取失败文案改为“电量 未知”。
- 2026-07-04：补充电源详情页：新增通用 `BatteryInfo` 板级接口，1.85B BQ27220 继续保持只读模式并上报 SOC、电压、电流、SOH 和计量状态；设置-电源页改为显示电量、电压、电流、健康、计量/校准状态和最近重启原因。
- 2026-07-04：明确导航语义边界：首页保持现状；设置是顶部系统栏全局入口，不属于应用页；应用页只承载可扩展应用/家庭工具。固件拦截远程 `app.open(settings)` 并提示使用顶部入口，家庭模式页底部按钮从“设置”改为“应用”，后端 Remote UI 应用列表继续禁止设置项。
- 2026-07-04：新增 `docs/page-navigation-contract.md` 页面职责与导航规范，正式固化首页、AI、天气、日程、音乐、相册、英语、应用和设置的职责边界；后续页面调整以该规范作为验收基准。
- 2026-07-04：一级页面规划继续收口：将圆屏端“内容”页面语义调整为“相册”，只承担家庭照片浏览、幻灯片和屏保资源；故事/播客归音乐音频内容，英语素材归英语页，小游戏资源归应用页，资源导入和版本管理归后端/伴侣页。
- 2026-07-04：完成一级页面职责代码落地第一轮：天气页移除日程事项和日程跳转；相册页替代内容页文案并只展示照片/屏保资源；应用页移除内容/相册/播客等一级入口；设置页底部动作改为刷新/首页；Remote UI `album` 成为正式相册页面，`content` 仅保留兼容。
- 2026-07-04：修正真机复测发现的页面边界问题：应用页彻底移除家庭模式/家庭工具入口，改为小游戏、OpenClaw、HA 场景、NAS 扫描；相册页不再优先渲染远端资源列表，改为本地 SD 照片预览、图片数量、缓存状态和屏保入口。同步部署后端到 `192.168.31.246:3100`，清理旧 node 进程并恢复 systemd `xiaozhi-family-hub.service` 为 active。
- 2026-07-04：完成文档分层整理第一版：新增 `docs/family-ai-os/` 作为 Family AI OS 产品和架构主文档入口，新增 `docs/xiaozhi-upstream/` 作为小智上游底座参考索引；`todo.md` 明确降级为当前执行清单和验收记录，避免后续路线与上游文档混在一起。
- 2026-07-05：将 1.85B 电量计从最小只读接入升级为正式 BQ27220 profile 接入：新增 Espressif `bq27220` 组件，按微雪官方 ESP-IDF 示例写入 500mAh CEDV/容量/计量配置，启动时自动检查并更新 profile；设置页计量状态改为 `BQ27220 500mAh/学习中`。本地 `idf.py build` 已通过，等待设备串口连接后刷入并确认 profile update 日志。
- 2026-07-05：已通过 `/dev/cu.usbmodem101` 刷入 BQ27220 正式 profile 固件；串口确认 `Design Capacity: 500`、`Skip battery profile update`、`BQ27220 fuel gauge ready: 100%, 4160mV, design=500mAh, fcc=500mAh, rc=500mAh`，Wi-Fi、小智 MQTT、唤醒词、LCD、触摸、SD 和音频链路启动正常。
- 2026-07-05：纠正按键语义：BOOT 是一级页面切换键，不再承担手动熄屏/唤醒；开机键熄屏需先确认 1.85B 是否提供 ESP32 可读的 PWR GPIO 或 PMIC 中断，当前官方 1.85B BSP 只导出 GPIO0 按键。本轮已恢复 BOOT 单击为一级页面切换，启动阶段仍保留进入 Wi-Fi 配网。
- 2026-07-05：保留自动省电低亮方案，并新增事件自动唤醒：公共 `Board::WakeDisplay()` 作为显示唤醒接口，1.85B AppShell 通过 `PowerSaveTimer::WakeUp()` 退出低亮省电；AI 活动/文本、系统消息、后端动作完成或失败、新通知到达时自动恢复亮度并重置屏保计时。真机已验证低亮后通过后端 `notification.push` 推送消息，串口出现 `PowerSaveTimer: Exiting power save mode` 和 `Backlight: Set brightness to 75`，显示会自动变亮。开机键仍不参与该逻辑。
- 2026-07-05：将后端新通知唤醒从 30 秒完整轮询优化为事件探针：后端新增 `GET /api/events` SSE 事件流和 `GET /api/events/latest` 轻量探针；ESP32 使用 5 秒轻量探针检测 `notification.created`，命中后立即 `WakeDisplayForEvent()` 并强制刷新 summary。已部署到 `192.168.31.246:3100` 并刷入 `/dev/cu.usbmodem101`；真机低亮状态下推送 `notification.push` 后串口确认 `Backend event probe: notification.created`、`PowerSaveTimer: Exiting power save mode`、`Backlight: Set brightness to 75`。最低 SRAM 约 9.3KB，未见 panic/重启。
- 2026-07-05：完成下一轮六方向第一轮落地：收敛固件 HTTP 并发，后端刷新/action/事件探针互斥；事件探针从常驻任务改为 5 秒短生命周期任务；资源 manifest 更新降频并避开 AI、音乐、相册/屏保；离开相册/屏保释放图片 buffer；设置-诊断页补充刷新、探针、动作、唤醒和资源状态；Remote UI 渲染层拒绝 `app.open(settings/family/weather/music/english/album/content/schedule/ai)` 等一级页伪装入口。
- 2026-07-05：后端完成本轮诊断和伴侣页增强：`/api/diagnostics/report` 增加 eventStatus、resourceStatus、esp32Status 和 OpenClaw latest job；`/companion` 增加资源文件上传入口，复用 `/api/resources/import`。本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过；远端重新部署到 `192.168.31.246:3100`，`/api/health`、`/api/events/latest`、`/api/resources/manifest`、`/api/diagnostics/report` 验证通过，`3000` 端口未被占用。
- 2026-07-05：本轮固件已重新构建并刷入 `/dev/cu.usbmodem101`。第一次尝试将 `app_backend` 栈降到 6KB 导致真机明确报 `stack overflow in task app_backend`，已回滚为 8KB 栈并改用非驻留事件探针。最终版本串口确认 LCD、触摸、SD、BQ27220、Wi-Fi、小智 OTA/MQTT、唤醒词、后端刷新和事件探针正常；连续观察约 8 分钟 56 秒，屏保多次切图、低亮省电触发、后端通知唤醒成功，最低 SRAM 稳定在 `15259` 字节，未再出现 panic、白屏或异常重启。
- 2026-07-05：完成下一轮六方向 60 分钟真机长测。串口记录时间 `21:04:28` 至 `22:04:28`，实际 `3600` 秒；`panicCount=0`，最低 SRAM `14555` 字节，内存样本 `360` 次，后端事件探针 `307` 次，唤醒相关事件 `33` 次。测试期间 15/30/45/58 分钟后端通知均触发 `notification.created`，设备从低亮省电退出并恢复背光；除打开串口导致的预期 USB reset 外，未见中途异常重启、panic、白屏或重启循环。
- 2026-07-05：服务器播客升级支持 MP3：后端服务器媒体目录扫描加入 `.mp3`，`/api/media/server/tracks` 返回 `format` 和 `contentType`，`/api/media/server/stream/:id` 对 MP3 返回 `audio/mpeg`；伴侣页资源导入默认把 MP3 放入 `music/server/`。固件启用 `CONFIG_ESP_AUDIO_SIMPLE_PLAYER_HTTP_EN`，新增 `AudioService::PlayMp3Url()`，服务器播客播放器根据 `contentType/format` 自动选择 Ogg/Opus demux 或 MP3 HTTP 播放。已部署到 `192.168.31.246:3100`，导入 `test-mp3-44100hz.mp3` 验证 stream 为 `audio/mpeg`，构建并刷入 `/dev/cu.usbmodem101`；串口确认 LCD、触摸、SD、BQ27220、Wi-Fi、小智 OTA/MQTT、唤醒词启动正常，未见 panic。
- 2026-07-06：按“默认在线播放 + 可选 SD 离线缓存”的播客方向完成正式链路：后端服务器媒体元数据增加 `sha256/size/format/contentType/streamUrl/downloadUrl/cacheable/supportsRange/cachePath`，`/api/media/server/stream/:id` 显式支持 HTTP Range `206 Content-Range`，新增 `/api/media/server/progress` 记录播放进度；固件服务器播客播放器支持缓存优先播放、下载到 `/sdcard/music/cache/*.tmp` 后校验 SHA-256/size 并原子 rename，播放完成后回写 progress。音乐页服务器播客底部操作栏调整为 `- / 播放 / 下集 / 缓存 / +`，Remote UI/action 白名单补充 `music.server.cache`。
- 2026-07-06：修正 1.85B SD 卡根因：对照 Waveshare 官方 1.85B BSP，确认 TF 卡为 4-bit SDMMC，针脚应为 `CLK=GPIO15`、`CMD=GPIO14`、`D0=GPIO16`、`D1=GPIO17`、`D2=GPIO12`、`D3=GPIO13`；此前 `CLK=14/CMD=17` 导致 `send_op_cond ESP_ERR_TIMEOUT`。已修正板级配置、增加短延迟重试、更新 SD 文档，并重新构建刷入 `/dev/cu.usbmodem101`；串口确认 `Mount SD: width=4`、`Name: SDABC`、`SSR: bus_width=4`，LCD、触摸、BQ27220、Wi-Fi、小智 OTA/MQTT、唤醒词、后端连接正常，最低 SRAM 约 `15791` 字节，未见 panic。
- 2026-07-06：补齐跨会话事实库：新增 `docs/family-ai-os/current-state.md`、`hardware-facts.md`、`decision-log.md`，把当前设备、官方/真机验证证据、SD 4-bit 事实、1-bit 旧结论废弃原因、后端地址、页面职责和下一步 open items 写成仓库内事实源；更新 `docs/family-ai-os/00-index.md` 和 `AGENTS.md`，要求后续新会话/子 agent 改代码前先读取事实库，冲突时按“真机验证 > 官方 1.85B BSP > 当前代码实测 > 通用 Wiki > 旧会话推断”的顺序处理。
- 2026-07-06：完成“小智直接调用后台”的第一版闭环：后端新增 `POST /api/ai/xiaozhi/tool` 窄入口、`deviceCommands` 队列、`GET /api/device/commands/poll`、`POST /api/device/commands/:id/ack`，并在 `/api/events/latest` 返回一条待执行设备命令；固件事件探针解析 `media.server.play/next/stop/cache` 和 `ui.toast`，执行后 ACK。小智官方 AI 继续负责高速语音链路，ESP32 只作为媒体/UI 执行端，不承载扩张型工具注册表。本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 和 `idf.py build` 已通过。
- 2026-07-06：完成本机 SSH 免密别名 `246`：生成 `~/.ssh/xiaozhi_family_hub` 并写入 `~/.ssh/config`，以后可直接 `ssh 246` 连接 `xionglei@192.168.31.246`。随后部署最新后端到 `/opt/xiaozhi-family-hub` 并重启 `xiaozhi-family-hub.service`；远端 `POST /api/ai/xiaozhi/tool`、`GET /api/device/commands/poll`、`POST /api/device/commands/:id/ack` smoke 验收通过。
- 2026-07-06：完成公网工具入口加固：用户已通过 Cloudflare Tunnel 将 `192.168.31.246:3100` 暴露为 `https://wave.xionglei.online`；后端 systemd drop-in 增加 `XIAOZHI_TOOL_TOKEN/AI_TOOL_TOKEN`，token 存放在远端 `/opt/xiaozhi-family-hub/secrets/xiaozhi-tool-token` 和本机 `~/.config/xiaozhi-family-hub/xiaozhi-tool-token`。公网验收：`/api/health` 返回 200，未带 token 调 `/api/ai/xiaozhi/tool` 返回 401，带 token 可创建命令并 ACK 清空。
- 2026-07-06：完成服务后台管理增强：新增独立 `ADMIN_TOKEN` 管理认证、Cloudflare Access 校验预留、公开域名写操作保护、后台本地服务器音频改名/删除、网络曲库管理、家庭成员管理和家庭模式权限策略编辑；`/admin` 可管理媒体库、设备、工具、内容、家庭权限、资源和诊断。后端本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 2026-07-06：完成家庭媒体中心 P0 后端落地：新增统一媒体库 `/api/media/library`、RSS 播客订阅源管理、节目刷新、播放队列、收藏、播放历史和队列播放/下一集/停止接口；搜索优先级固定为本地服务器文件、播放队列、已订阅 RSS 节目、网络曲库/RSS/直链/archive。`/admin` 媒体页拆分为搜索播放、网络曲库、播客订阅、播放队列、服务器曲目、播客节目、收藏/历史；小智 MCP 工具增加 `family.podcast.favorite`。本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 2026-07-06：继续完善家庭媒体中心日常管理能力：播放队列新增上移、下移、移除和清空接口/后台按钮，RSS 播客新增“全刷”管理接口和可选后台定时刷新配置 `PODCAST_REFRESH_INTERVAL_MINUTES`、`PODCAST_REFRESH_BATCH_SIZE`；更新 `server/README.md` 和 smoke 覆盖队列整理、全量刷新。本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 2026-07-06：已将家庭媒体中心日常管理增强部署到 `192.168.31.246:3100`；远端 `xiaozhi-family-hub.service` 和 `xiaozhi-mcp-bridge.service` 均为 active，`http://192.168.31.246:3100/api/health` 与 `https://wave.xionglei.online/api/health` 正常；远端轻量 smoke 验证后台配置、队列新增、上移和删除接口正常，未清空真实队列、未强刷真实 RSS 源。
- 2026-07-06：补齐服务器播客“继续上次没听完”能力：后端从 `/api/media/server/progress` 生成未完成候选，新增 `GET/POST /api/media/resume`；小智 MCP 增加 `family.podcast.resume`，网关识别“继续播放/继续听/上次没听完”等意图并下发 `media.server.play`，payload 带 `resumePositionSec/progress`。后台 `/admin` 媒体页增加“继续”按钮和未听完列表；ESP32 协议仍保持轻量。
- 2026-07-06：已将“继续上次没听完”部署到 `192.168.31.246:3100`；远端 LAN/公网 health 正常，`xiaozhi-family-hub.service` 和 `xiaozhi-mcp-bridge.service` 为 active。远端 smoke 写入临时播放进度、查询续播候选、触发 `/api/media/resume`、生成 `media.server.play` 命令并 ACK 成功。
- 2026-07-07：完成 Phase 18/19 Tools Agent 安全收口：Capability registry 新增 `family.openclaw.run`、`family.homeassistant.scene`、`family.nas.music.scan`、`family.tools.status`；OpenClaw/HA 高风险工具需要家长确认，儿童/访客/夜间按策略拒绝并写入 audit，应用页 Tools Agent 可路由“运行诊断 / 打开家庭场景 / 扫描 NAS”。本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 2026-07-06：继续优化服务器播客进度管理：媒体库 `tracks/localTracks/podcastEpisodes` 均带 `progress` 状态，新增 `PATCH/DELETE /api/media/server/progress/:trackId` 用于后台标记已听完或重置进度；`/admin` 服务器曲目和播客节目列表显示播放进度、未播放/未听完/已听完状态，并提供“标已听”“重置”按钮。smoke 覆盖标记已听完后不再进入续播候选、重置进度成功。
- 2026-07-06：已将服务器播客进度管理增强部署到 `192.168.31.246:3100`；远端 LAN/公网 health 正常，两个 systemd 服务为 active。远端 smoke 写入临时进度、标记已听完、确认续播候选归零、重置进度成功。
- 2026-07-07：完成产品和 AI 架构重定位文档收口：Family AI OS 正式调整为“圆屏交互端 + AI-native 后端 + 手机 App 预留”的三端生态；新增 `docs/family-ai-os/10-ai-agent-layer.md`，确认自建 AI 服务作为长期家庭智能大脑，小智官方保留为低延迟语音入口；确定 Page Agent First + Router Fallback 为后续 AI 交互硬约束；`xinnan-tech/xiaozhi-esp32-server` 后续仅作为独立 Voice Provider 候选，不作为 Family Backend 基础。本轮只改文档和路线，不改固件/后端代码。
- 2026-07-07：完成 AI Service V1 可实现设计文档 `docs/family-ai-os/11-ai-service-v1.md`：明确 `/api/agent/ask`、`/api/agent/capabilities`、`/api/agent/tools/:name`、`family.agent.ask` MCP 工具、Page Agent registry、Capability Tool contract、Policy V1、Memory/Knowledge V1、实现顺序和验收测试。本轮仍只改文档，不改固件/后端代码。
- 2026-07-07：完成 AI Service V1 后端第一版落地：新增 Capability Tool Registry 和 Page Agent 层，开放 `/api/agent/capabilities`、`/api/agent/tools/:name`、`/api/agent/ask`，小智 MCP 桥新增 `family.agent.ask`。首批 Media Agent 和 Device Agent 已接入现有媒体中心、设备状态、诊断、家庭记忆和统一 policy/audit；AI/Home 可 handoff 到 Media/Device。后端 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 2026-07-07：继续扩展 Page Agents：Weather Agent 支持今日天气，Schedule Agent 支持今日日程/完成/稍后提醒，English Agent 支持状态/开始练习，Album Agent 支持相册状态/屏保开关；AI/Home Router 可 handoff 到 Schedule/Weather/English/Album；天气权限从 notifications 拆为独立只读 `weather` policy。后端 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 已通过。
- 2026-07-07：完成 Phase 16 旧定位清理：协议文档不再把 WebSocket JSON 处理称为设备端“业务逻辑”；代码注释未发现“ESP32 承载复杂业务/数据处理主机”类表述，剩余命中均为历史记录、兼容入口或否定性边界。
- 2026-07-07：完成 Phase 18/19/20 本轮收口并部署远端：Tools Agent、高风险确认/拒绝/审计、移动 Web 伴侣状态/诊断/资源导入已同步到路线图；本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过；已部署到 `192.168.31.246:3100` 并重启 `xiaozhi-family-hub.service`、`xiaozhi-mcp-bridge.service`。远端 LAN/公网 health、`/api/agent/capabilities`、`/companion`、OpenClaw 未确认不建 job、儿童拒绝、应用页 Tools Agent 扫描 NAS 路由均验证通过。
- 2026-07-07：修复 OpenClaw 远端 success target：新增 `server/bin/openclaw-command-adapter.sh`，远端 systemd drop-in 指向 `/opt/xiaozhi-family-hub/bin/openclaw-command-adapter.sh`，规避服务用户无法访问 `/home/xionglei/.local/bin/openclaw` 和默认 Node 18 不满足 OpenClaw CLI 要求的问题。通过正式 Agent API 确认执行 `openclaw diagnostics`，后端记录 success job：`OpenClaw 完成: diagnostics`。当时 `default/music` target 仍需具体家庭任务命令；后续已补齐映射、success job 和真机 ACK，最终仍需人工 evidence。
- 2026-07-07：补齐外部验收证据系统：新增 `server/src/acceptance.js`、`GET /api/acceptance/status`、`POST /api/admin/acceptance/:id/evidence`，诊断报告纳入 `acceptanceStatus`，移动 Web 伴侣增加“外部验收”面板，用于记录 EspBlufi 新 Wi-Fi、Home Assistant 真实场景、真实家庭素材、OpenClaw default/music 等不能靠 smoke 伪完成的证据；证据 `data` 会限制大小/层级并打码 token/password/secret 等敏感字段。本地伴侣页脚本语法、`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 均通过；已部署到 `192.168.31.246:3100`，LAN/公网 health 正常，公网未授权写验收证据返回 401，`/companion` 显示外部验收面板，OpenClaw diagnostics latest job 仍为 success。
- 2026-07-07：正式后台 `/admin` 同步增加“外部验收”面板和总览验收计数，可查看四项真实验收状态、所需证据和最新 evidence，并可用管理 token 写入证据；smoke 已检查 `/admin` 与 `/companion` 均包含外部验收入口，避免后续 UI 回退。
- 2026-07-07：继续推进剩余外部项的可验收性：Home Assistant 调用从 detached 发送升级为同步记录 HTTP code、exit code、耗时和响应摘要，新增 `HOME_ASSISTANT_SCENES` 白名单和 `HOME_ASSISTANT_TIMEOUT_MS`；smoke 使用独立 mock HA 验证真实配置下会记录 `success/httpCode=200`。固件侧设置-网络页改为展示 `SSID/信号(RSSI+channel)/IP/后端`，对齐 BluFi 新 Wi-Fi 验收口径；BluFi 和 AFSK 配网日志不再输出明文 Wi-Fi 密码。后端本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过，固件 `idf.py build` 通过；后端已重新部署到 `192.168.31.246:3100`，LAN/公网 health、`/admin` 验收面板、acceptance/diagnostics 读检查正常。四个真实外部验收项仍保持 `pending`，等待真实 HA、真实手机配网、真实内容和 OpenClaw default/music 映射证据。
- 2026-07-07：补齐设备心跳证据链：固件后端刷新成功后每 60 秒低频上报 `appshell.heartbeat` 到 `/api/device/logs`，payload 包含设备 UUID、逻辑设备 ID、页面、AI 状态、后端状态、wake/reset、free/min heap、SSID/IP/RSSI/channel 和设备状态；后端 `appendDeviceLog` 会把心跳聚合到设备记录，并在 `/api/diagnostics/report` 的 `esp32Status` 展示网络、内存、唤醒、重启和探针摘要。后端 smoke 覆盖 heartbeat 日志、设备 registry 聚合和 diagnostics 字段；固件 `idf.py build` 通过。已部署后端到 `192.168.31.246:3100`，远端写入临时 smoke heartbeat 后 diagnostics 正确显示 `RemoteSmokeWiFi/192.168.31.223/RSSI -54/minHeap 17000`，acceptance 仍保持 4 项 pending。真机需要刷入后再验证真实 heartbeat。
- 2026-07-07：补齐家庭内容 representative 验收链：`server/scripts/smoke-test.js` 新增相册、播客 MP3、英语 JSON、小游戏 JSON 四类 `/api/content/import` 用例，断言 `sha256/size/contentType/version`、catalog、packs、manifest、服务器媒体流，以及 `/api/ui/page/album`、`/api/ui/page/english`、`/api/ui/page/apps` 会暴露导入条目；后端 `deviceSummary` 将 content 按 `albums/english/games/podcasts` 分组，Remote UI 英语页和应用页接入导入内容；伴侣页按内容类型自动选择 `images/`、`music/server/`、`courses/english/`、`games/` 等路径。本地伴侣/后台脚本语法、`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过。真实家庭素材和真机显示/播放验收仍保持 pending。
- 2026-07-07：补齐外部验收 readiness 和预检工具：新增只读 `GET /api/acceptance/readiness` 并纳入 `/api/diagnostics/report`，后台和伴侣页在外部验收面板展示每项 readiness 检查；新增 `server/scripts/acceptance-preflight.js` 与 `npm run acceptance:preflight`，默认只读，显式 `--execute` 才触发 HA/OpenClaw，显式 `--record --status=...` 才写入 evidence；后台 `/admin` 增加 album/podcast/English/story/game 通用内容导入；后台/伴侣页 evidence 表单支持 reference 和结构化 data JSON。后端脚本语法、`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过。真实外部验收项仍保持 pending，等待真实设备/服务证据。
- 2026-07-07：收紧 BluFi 新 Wi-Fi 外部验收 readiness 并完成部署刷机：固件在 BluFi 配网成功后上报专用 `appshell.wifi_provisioned` 设备日志，后端 readiness 需要近期 `appshell.heartbeat`、专用配网事件和 `method=blufi` 同时存在，避免旧 smoke heartbeat 被误判为通过。后端已部署到 `192.168.31.246:3100`，`xiaozhi-family-hub.service` 和 `xiaozhi-mcp-bridge.service` 均 active，LAN/公网 health 正常；`npm run acceptance:preflight` 显示 1 ready、3 partial、4 pending。固件已构建并刷入 `/dev/cu.usbmodem101`，串口确认 LCD、触摸、SD 4-bit、BQ27220、Wi-Fi、小智 OTA/MQTT、唤醒词和后端探针正常，最低 SRAM `15123` 字节；真机 heartbeat 已更新为 `liuliu/192.168.31.160/RSSI -45/channel 6`。BluFi 仍未勾选，因为还没有用 EspBlufi App 真实写入新 Wi-Fi 并记录 evidence。
- 2026-07-07：以 PM 口径继续收紧外部验收：新增 `docs/family-ai-os/12-external-acceptance-runbook.md`，覆盖 BluFi、Home Assistant、真实家庭内容和 OpenClaw default/music 的操作步骤、evidence 字段和敏感信息禁写规则，并挂入 `docs/family-ai-os/00-index.md`。同时修正 `real-family-content` readiness：seed/sample/smoke/representative/示例/占位资源不再算真实家庭素材；远端已部署，`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过，LAN/公网 readiness 当前为 `0 ready / 3 partial / 1 missing`，其中真实家庭内容为 `missing 0/5`。
- 2026-07-07：继续工具化外部验收准备：新增 `server/scripts/import-real-content.js` 和 `npm run content:import-real`，用于批量导入真实相册、播客、英语、小游戏素材并输出 evidence data 草稿；新增 `server/scripts/acceptance-evidence-pack.js` 和 `npm run acceptance:pack`，用于生成只读证据包 `report.md`、`next-actions.md`、`raw/*.json`、`evidence-drafts/*.json`。两者均不自动写入 passed，不替代真机显示/播放、手机配网、HA 侧状态变化或 OpenClaw 实际效果确认。
- 2026-07-07：将证据包能力接入后台/伴侣页：新增 admin-only `GET /api/admin/acceptance/evidence-pack`，`/admin` 和 `/companion` 外部验收面板增加 `填入草稿` 与 `下载证据包`；填草稿只把 pending evidence draft 放入表单，不自动点击记录、不写 passed。后端 smoke 已覆盖未授权拒绝、endpoint shape 和页面按钮存在。
- 2026-07-07：配置远端 `ADMIN_TOKEN`，让后台/伴侣页外部验收面板可以真实调用 admin API。token 通过 `/opt/xiaozhi-family-hub/secrets/admin.env` 注入 systemd，本机副本保存在 `~/.config/xiaozhi-family-hub/admin-token`；验证无 token 调 evidence-pack 为 401，带 token 可获取 `blufi-new-wifi` 草稿。未改变 acceptance 状态，仍保持 4 项 pending。
- 2026-07-07：补齐 OpenClaw `default/music` 的低风险 target 映射脚本：`openclaw-family-default.sh` 创建 Family Hub 可见通知，`openclaw-family-music.sh` 通过小智工具网关下发 `media.server.play`。这一步只建立可验收前置能力；最终 `openclaw-default-music` 仍需远端配置、执行 success job、人工观察真实效果并写入 evidence 后才能标记 passed。
- 2026-07-07：外部验收面板增加 inline nextActions：`/admin` 和 `/companion` 的每个验收项直接显示当前缺失 readiness 条件和仍需人工完成的真实动作；smoke 覆盖 API 中的 nextActions 文本、页面 `evidence-pack?items=` 调用和“下一步”显示。真实验收状态仍保持 pending。
- 2026-07-07：修复 OpenClaw target 自调用死锁：Agent Tool 执行路径改为异步 `spawn`，避免 target 脚本回调 `127.0.0.1:3100` 时被同步 `spawnSync` 阻塞。已部署远端并配置 `OPENCLAW_TARGET_DEFAULT_COMMAND=/opt/xiaozhi-family-hub/bin/openclaw-family-default.sh`、`OPENCLAW_TARGET_MUSIC_COMMAND=/opt/xiaozhi-family-hub/bin/openclaw-family-music.sh`；通过正式 `family.openclaw.run` 触发后，`default` 和 `music` 均生成 success job，`music` 下发的 `media.server.play` 已被真机 `esp32-185b` ACK。`/api/acceptance/readiness` 中 `openclaw-default-music` 为 `ready 5/5`，但 `/api/acceptance/status` 仍保持 `pending`，等待人工观察效果并写入 evidence。
- 2026-07-07：优化 evidence pack 的下一步提示：`nextActions` 会根据 readiness 动态隐藏已满足的配置项，OpenClaw 草稿额外包含最近 `media.server.play` 真机 ACK，避免已 ready 后仍提示“配置 target command”的 stale 状态；仍不自动写 passed。
- 2026-07-07：为 `openclaw-default-music` 写入一条 `pending` 自动化 readiness evidence，包含 default/music success job 与 `esp32-185b` ACK 摘要，明确标注仍需人工观察真实效果和策略拒绝后才能 passed；远端 `/api/acceptance/status` 仍为 `0/4 passed`。
- 2026-07-07：同步修复 CLI 版 `npm run acceptance:pack` 的 stale nextActions，使其和后台 evidence pack 一样按 readiness 动态隐藏已满足的 OpenClaw 配置项，并把诊断报告中的 `media.server.play` ACK 写入 OpenClaw 草稿。
- 2026-07-07：补强 OpenClaw policy evidence：通过正式 `family.openclaw.run` 验证未确认调用只返回 `requires_confirmation` 且不建 job，儿童/访客/夜间模式均返回 403 denied 且不建 job；OpenClaw job 数保持不变。后台和 CLI evidence pack 的 OpenClaw 草稿会自动带最近 policy audit 摘要，便于人工验收时复核拒绝链路。
- 2026-07-07：继续降低外部验收误判风险：BluFi readiness 要求 `appshell.wifi_provisioned` 也是近期事件，避免旧配网日志误判；`acceptance:preflight` 增加 `--ha-observe-entity`，可在真实 HA 场景触发前后读取实体状态并写入草稿；`/admin` 和 `/companion` 的验收状态下拉默认改为 `pending`，降低误点 `passed` 风险。
- 2026-07-07：继续收紧真实家庭内容误判边界：`real-family-content` readiness 和 `content:import-real` 告警现在额外排除 `test/demo/diagnostic/placeholder/dummy/mock/fixture/测试/诊断` 等测试资源；smoke 测试改用 demo/test/diagnostic/dummy 命名的导入素材，确认这些资源仍不会让真实家庭素材验收变成 ready。
- 2026-07-09：新增"AI 控制小米/小爱音箱"能力（经 Home Assistant，纯后端，无需重烧固件）。Tools Agent 新增 `family.speaker.command`（把文字指令交给小爱自己的助手执行，最省心且跨型号）、`family.speaker.say`（TTS 播报）、`family.speaker.volume`、`family.speaker.play`、`family.speaker.pause`。复用现有 `runHomeAssistantService` 调 HA 服务：say/command 走可配置的 `XIAOMI_SPEAKER_SERVICE`（默认 `xiaomi_miot.intelligent_speaker`，payload `{entity_id,text,execute}`），volume→`media_player.volume_set`，play/pause→`media_player.media_play/media_pause`；目标实体固定为 `XIAOMI_SPEAKER_ENTITY`，AI 不能指向任意 HA 实体。未配 `HOME_ASSISTANT_URL/TOKEN` 或 `XIAOMI_SPEAKER_ENTITY` 时优雅降级为 simulated 并记录 integration history。`speaker.*` 归 `homeControl` 权限类别（parent/member、默认模式、带审计）。改动文件 `server/src/config.js`、`security.js`、`capabilities.js`、`agents.js`、`scripts/smoke-test.js`（mock HA 改为通用 service 路径并断言 execute 标志/entity_id/音量归一化 + 路由 + 儿童拒绝 + capabilities）。本地 `npm run check`、`smoke`、`smoke:sqlite` 通过；已部署到 `192.168.31.246:3100` 并重启（备份 `.bak`）。远端验证：capabilities 含 5 个 speaker 工具，"让小爱播放周杰伦的歌"路由到 `family.speaker.command`，因远端未配 HA 返回"模拟音箱执行指令…（未配置音箱实体）"。待用户配置真实 HA + 音箱实体后即可实际控制。
- 2026-07-09：让小智可直接控制小米音箱。MCP 桥 `xiaozhi-mcp-bridge.js` 新增显式工具 `family.speaker.say`/`family.speaker.command`/`family.speaker.volume`（经 `callCapabilityTool` 走 `/api/agent/tools/*`），小智不必再绕 `family.agent.ask` 猜。MCP 调用路径用空 role + `source=xiaozhi.mcp`，遵守家庭模式策略：`homeControl`（含音箱）在默认模式放开、儿童/夜间/访客默认拒绝（非家长）。smoke 新增 MCP tools/list 含三个 speaker 工具 + `family.speaker.command` tools/call（走 mock HA 成功）。本地 check/smoke/smoke:sqlite 通过；已部署并重启 `xiaozhi-mcp-bridge.service`（重连小智成功，备份 `.bak-1783596082`）。已把家庭模式切到"默认"（可逆），并以小智实际路径 `POST /api/agent/tools/family.speaker.say`（role 空、source xiaozhi.mcp）验证 http 200、音箱真机出声。剩：用户对小智语音说"让小爱/音箱 …"验证 LLM 选对工具。
- 2026-07-09：完成 Home Assistant 部署并真机打通 AI 控制小米AI音箱(第二代)。在服务器 `192.168.31.246` 用 Docker 起 `ghcr.io/home-assistant/home-assistant:stable`（`--network=host`、config `/opt/homeassistant`、8123）；因 docker 守护进程原配的本地代理 `127.0.0.1:10808` 已失效，禁用其 `http-proxy.conf`（改名 `.disabled`）改用 Cloudflare WARP 出网（顺带短暂重启了同机 sub2api/postgres/redis 等容器，均自动恢复）；预装 HACS，用户在 UI 装 `al-one/hass-xiaomi-miot`（Xiaomi Miot Auto）并登录小米账号导入设备。从 HA 存储读出音箱实体 `media_player.xiaomi_l15a_654a_play_control`（型号 `xiaomi.wifispeaker.l15a`），确认 `intelligent_speaker` 服务字段 `entity_id/text/execute/silent`。Family Hub 侧新增 `/opt/xiaozhi-family-hub/secrets/home-assistant.env`（600）经 systemd drop-in `40-home-assistant.conf` 注入 `HOME_ASSISTANT_URL=http://127.0.0.1:8123`、`HOME_ASSISTANT_TOKEN`、`XIAOMI_SPEAKER_ENTITY`。真机验收：`family.speaker.say`（execute=false）和 `family.speaker.command`（execute=true）均返回 HA http 200，且小米AI音箱真实出声（用户确认）。HA 已配置，`home-assistant-real-scene` 现具备验收条件（待有真实场景时补 evidence）。
- 2026-07-09：完善服务端 AI 工具层（纯后端，无需重烧固件）。补齐两个"已注册但没接路由"的工具：`family.content.recommend`（推荐/讲个故事/睡前/无聊）和 `family.memory.search`（查家庭记忆/记得/回忆），文档里的 V1 目标场景"给孩子推荐一个睡前内容"现在可用；新增 Home Agent（`family.home.overview` 只读概览：时间/天气/下一项日程/在播媒体/后端状态 + 领域 handoff 兜底），补齐设计文档里列了但缺失的 Home Agent。为避免"推荐睡前故事"被 `故事` 领域名词抢到 media，新增 `pickDefaultAgent` 让跨域通用意图（推荐/记住/查记忆）优先；把 `detectRouterAgent` 重构为 `detectSpecificDomain`（无匹配返回空）+ 页面兜底。改动文件 `server/src/agents.js`、`capabilities.js`、`scripts/smoke-test.js`；smoke 新增内容推荐、记忆检索、首页概览、home→weather handoff 和 capabilities 断言。本地 `npm run check`、`smoke`、`smoke:sqlite` 通过，已部署到 `192.168.31.246:3100` 并重启（备份 `.bak-1783583405`）。远端验证：capabilities 现含 9 个 Agent（新增 home）；`content.recommend`/`memory.search`/`home.overview` 路由并执行成功，`home.overview` 输出"多云 26C，今天没有待办日程，正在播放 sample success"，home→weather handoff 正确。较大项（音量控制需固件、真实天气 provider、歧义 LLM 规划）暂缓。根因：2026-07-06 配公网隧道后 `PUBLIC_BASE_URL=https://wave.xionglei.online`，`media.js` 用它拼 `streamUrl`，导致下发给设备的播放地址变成公网 HTTPS；固件 `AudioService::PlayOggUrl/PlayMp3Url` 的 `esp_http_client` 无 TLS/证书配置，打不开 HTTPS，播放静默失败，而设备命令 ACK 在收到命令时就已发出，后端误以为在播。修复：新增 LAN 专用 `deviceMediaBaseUrl`（`DEVICE_MEDIA_BASE_URL`/`LAN_BASE_URL`，未设且 publicBaseUrl 为 https 时回落 `http://192.168.31.246:3100`），只在设备侧出口（`/api/media/server/tracks`、`/api/device/summary` 的 `music.server`、`media.server.play/resume/next` 命令 payload）改写 streamUrl/downloadUrl 的 origin；网页伴侣/后台仍用公网 HTTPS。改动文件 `server/src/config.js`、`media.js`、`routes.js`、`device-commands.js`；本地 `npm run check`、`smoke`、`smoke:sqlite` 通过，已部署到 `192.168.31.246:3100` 并重启（覆盖前文件备份在远端 `.bak-1783581191`）。真机 `esp32-185b` 通过正式 `family.openclaw.run target=music` 触发后实际播放服务器播客 `sample success` 并听到声音，`/api/admin/acceptance/openclaw-default-music/evidence` 记录 passed，`/api/acceptance/status` 变为 1/4 passed。未改固件、未重新烧录。
- 2026-07-10：完成语音 Provider 真机回退与恢复验收。暂停自建 `xiaozhi-voice-provider` 后，设备通过本地 `你好小智` 唤醒，主 WebSocket 失败后自动切到官方 OTA/MQTT，日志确认 `fallback/official` 并完成官方语音对话；恢复 Provider、结束官方会话并等待冷却后，设备执行 `primary/self-hosted` recovery probe，重新连接 `ws://192.168.31.246:8100/xiaozhi/v1/` 并由 Home Agent 完成 TTS，Provider restart count 0。测试同时暴露三项待修：停止会话语义被 Home Agent 抢走、中文/空格资源路径未 URL 编码、官方回退期间最低 SRAM 约 `2619` 字节。
- 2026-07-10：关闭上述 Provider 回退 SRAM 风险。固件统一阻止 AI 活跃期及回 idle 后 3 秒内的 AppShell refresh/event/action 网络 worker，worker 入口二次检查并对动作重新排队；将 12 KB 刷新、8 KB 动作、4 KB 事件任务栈迁到 PSRAM；失败的主 WebSocket 连接立即释放且不触发伪 channel-close；新增会话局部 SRAM 低水位日志。二次真机测试中官方回退对话最低 `15431` 字节，自建恢复对话最低 `15539` 字节，随后跨 5 分钟资源刷新边界的启动期最低 `13827` 字节，当前内部 SRAM 回升约 29 KB，无 panic/重启。
- 2026-07-10：完成中文/空格资源路径 URL 编码并真机通过。固件按 RFC 3986 对 UTF-8 字节 percent-encode、保留 `/`，从 LAN Family Hub 的 `/api/resources/file/...` 下载；heartbeat 显示 `下载 25 项`，中文/空格文件已写入 SD，未见 `Error parse url`、panic 或重启。
- 2026-07-10：完成 MP3 播放 SRAM 优化。Audio Simple Player/GMF worker 的 6 KB 栈迁到 PSRAM，同一中文服务器 MP3 的内部 SRAM 最低值从 `2963` 提升到 `17275` 字节，停止后恢复约 36-38 KB，无泄漏、panic 或重启。
- 2026-07-10：Provider 原生退出命令已实现、部署并真机通过，`退出/关闭/停止对话/结束对话/退出对话` 会在 Page Router 前精确匹配并直接断开；真人麦克风测试中 `停止对话` 被准确识别，设备未调用 `self.page.get_context`、未返回 Home Agent 概览，直接断开 WebSocket 并回 idle，会话局部最低 SRAM `18995` 字节；自动化测试 `29 passed`。
- 2026-07-10：启动 P10 后端可观测性与设备启动诊断底座。新增 `server/src/observability.js`，HTTP 中间件接受/生成 `X-Request-Id`，响应头和 JSON body 自动携带 `requestId`，并记录结构化 JSON 请求日志、接口状态码、耗时、按路由聚合的 P50/P95 和错误摘要；新增 `GET /api/admin/metrics` 与 `GET /api/admin/devices/:id/diagnostics`，设备日志兼容增量字段 `bootId`、`bootSequence`、`uptimeSec`、`firmwareBuild`、`panicSummary`、`requestId`，后端按 `deviceId + bootId` 建立 180 天启动会话并区分 `healthy/startup_pending/backend_unreachable/crash_loop`。本轮只完成可本地验证的后端基础，不提前勾选仍需 UI 展示、全链路 requestId 传播、真机刷入和远端部署验收的 P10 大项；本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过。
- 2026-07-10：继续推进 P10 鉴权安全与真实成员档案。新增 `server/src/request-controls.js`，为 `/api/action`、Agent tools 和设备命令 ACK 提供 `Idempotency-Key` 24 小时结果缓存与重复请求 replay，默认限流为 Agent 30/min、Action 60/min、设备日志 120/min、管理接口 120/min，并支持环境变量调整；成员档案保留并返回 `relationship/profileVersion/createdAt/updatedAt`，管理端更新会递增 `profileVersion`，访客模式强制固定 `guest` 档案，guest 上下文即使错误开启 memoryPolicy 也不会读取成员/家庭长期记忆；成员创建、更新、删除和切换写入安全审计。后端 smoke 覆盖 OpenClaw 幂等 replay 不重复建 job、requestId 贯通 OpenClaw/HA/audit、成员字段、访客固定档案和 guest 记忆隔离；本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过。
- 2026-07-10：完成 P10 统一部署脚本本地收口。`server/scripts/deploy-ssh.sh` 从旧 `~/xiaozhi-family-hub` + pm2/nohup 模型替换为 `/opt/xiaozhi-family-hub` systemd release 模型，支持 `releases/<id>`、`current` 软链接、`shared/data|resources|secrets`、部署前 SQLite `.backup`/integrity check、远端 `npm ci --omit=dev` + `npm run check`、切换 release 后重启 `xiaozhi-family-hub.service` 和 `xiaozhi-mcp-bridge.service`，可选重启 Voice Provider，并提供 `ROLLBACK=1`。systemd 模板改为 `/opt/xiaozhi-family-hub/current`、shared 数据目录和 `/opt/node-v22/bin/node`；新增 `backup-sqlite.sh` 与每日 backup timer/service 模板，保留 14 个日备份和 8 个周备份。已通过 `bash -n`、`DRY_RUN=1 SKIP_LOCAL_TESTS=1 SKIP_REMOTE_SMOKE=1` 部署 dry-run、本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite`；真实 246 Node 22 安装、timer 启用、远端部署 smoke 和恢复演练仍需实机证据。
- 2026-07-10：补齐生产内容过滤底座。新增 `server/src/content-policy.js`，统一识别 `sample/demo/test/diagnostic/placeholder/dummy/mock/fixture/示例/诊断` 等代表性或诊断资源；`/api/content/catalog`、`/api/device/summary`、Remote UI 页面、`/api/media/server/tracks` 和 `/api/media/library` 默认过滤示例/诊断/占位内容，显式 `includeDiagnostics=1` 或后台媒体接口仍可查看诊断资源。seed 内容和代表性 smoke 导入不会出现在生产 catalog、生产 Remote UI 或生产媒体列表，也不会让 `real-family-content` readiness 误判；本地 `npm run check`、`npm run smoke`、`npm run smoke:sqlite` 通过。
- 2026-07-11：完成 P10 SQLite 数据模型与迁移本地闭环。`server/src/sqlite-store.js` 改为使用 Node 内置 `node:sqlite` `DatabaseSync`，不再在写入路径调用外部 `sqlite3` 子进程；新增 `server/src/sqlite-migrations.js` 和 `schema_migrations`，每个迁移在 `BEGIN IMMEDIATE` 事务内执行并校验 checksum。第一阶段继续以 `kv.state` 作为兼容读模型，同时双写成员、活动成员、记忆、学习记录、最近互动、设备启动、设备日志、设备命令、媒体进度、验收证据、令牌、安全审计等关系镜像表并做计数一致性校验；`/api/admin/database/schema` 暴露 migration、表计数、`kv.state` 快照、SQLite integrity 和 mirror consistency。新增 Node 内置测试 `npm run test:sqlite-store`，覆盖迁移幂等、旧式仅 `kv.state` 数据库迁移、关系镜像计数和兼容快照；smoke:sqlite 增加 schema/integrity/mirror consistency 和 20 个并行设备日志写入验证。本地 `npm run test:sqlite-store`、`npm run check`、`npm run smoke`、`npm run smoke:sqlite` 均通过。未勾选远端备份恢复、真实旧版本 release 回滚和 246 部署验收，仍需实机/运维证据。

## 下一阶段收口顺序（Phase 16-20）

1. Phase 16-19 已完成本轮代码/文档/后端 smoke 收口；后续继续避免把 ESP32 当作复杂业务端。
2. 使用 `/admin` 或 `/companion` 外部验收面板记录真实证据，先完成 EspBlufi 新 Wi-Fi 写入和小智官方链路回归验收。
3. 配置真实 Home Assistant 后，验证 HA 侧场景状态变化，并记录验收证据。
4. ~~对 OpenClaw `default/music` 已 ready 的映射做人工观察验收，并通过 `/admin` 或 `/companion` 写入 evidence。~~（2026-07-09 完成：修复设备侧公网 HTTPS 流地址回归后，真机实际播放服务器播客并写入 passed evidence。）
5. 导入真实家庭相册、播客、英语包和小游戏资源，验证内容系统长期管理体验。
6. 设计原生手机 App 或 PWA 下一版连接桥，明确离家/无 Wi-Fi 场景的产品边界。
7. 再决定是否接入 `xinnan-tech/xiaozhi-esp32-server` 作为独立 Voice Provider。

## 当前约束

- 设备是 Waveshare ESP32-S3 1.85B。
- 产品是“圆屏 + AI-native 后端 + 手机 App 预留”的三端生态，不是 ESP32 单体功能平台。
- 圆屏是家庭现场交互端，只做展示、触摸、语音入口、播放、确认、反馈、本地兜底和轻量设备命令 ACK。
- 后端是 Family Capability Hub，复杂业务、搜索、权限、记忆、知识库、工具编排和系统管理都归后端/自建 AI 服务。
- 手机 App 预留为便携管理和连接桥，负责配网、诊断、资源导入、外出访问和未来无 Wi-Fi 网络代理。
- 小智官方连接保持不变，并作为低延迟语音 AI 主链路。
- 小智官方仍是低延迟语音入口；自建 AI 服务是长期家庭智能大脑，负责多角色、多记忆、性格画像、知识库和 Page Agent 编排。
- 后端所有核心能力都要 AI-native：后台、手机、圆屏和 AI 复用经过权限和审计保护的 Capability Tools。
- 一级页面采用 Page Agent First：页面内交互优先直达对应 Agent；Router 仅用于 Home/AI 页广义请求、歧义处理和跨域 handoff。
- 如果后续接入 `xinnan-tech/xiaozhi-esp32-server`，它只能作为独立 Voice Provider，不作为 Family Backend 的产品基础。
- 家庭工具优先走后端 AI Tool Gateway：小智/外部 AI 只调用 `POST /api/ai/xiaozhi/tool` 这类窄入口，并设置 `XIAOZHI_TOOL_TOKEN` 或 `AI_TOOL_TOKEN`；ESP32 只收少量设备命令，不维护庞大工具列表。
- 当前公网入口为 `https://wave.xionglei.online`；小智工具入口使用 `XIAOZHI_TOOL_TOKEN`，管理后台 `/admin` 和 `/api/admin/*` 使用独立 `ADMIN_TOKEN` 或 Cloudflare Access，公网写操作默认受保护。
- 后端外部验收入口为 `GET /api/acceptance/status`、`GET /api/acceptance/readiness` 和 `POST /api/admin/acceptance/:id/evidence`；任何需要真实手机、真实 HA、真实家庭内容或真实 OpenClaw 目标的事项，必须通过证据记录后再勾选。`npm run acceptance:preflight` 默认只读，可用于生成下一步验收缺口。
- ESP32 仍优先使用局域网 `http://192.168.31.246:3100` 拉状态和播放服务器音频，不依赖公网路径。
- 后端 API 目标地址是 `192.168.31.246:3100`，`3000` 端口保留给服务器现有服务。
- 当前工程已定义 1.85B 的 SD 卡 SDMMC 4-bit 引脚并完成挂载、文件扫描、SD 图片屏保显示、Ogg/Opus/MP3 本地播放链路和服务器播客 Ogg/Opus/MP3 HTTP 拉流链路；JPG 家庭照片需放入 SD 后继续视觉复测。
- SD 卡标准格式定为 FAT32；正式固件禁止自动格式化，`APPSHELL_SD_FORMAT_ON_MOUNT_FAILED` 只能作为一次性恢复开关。
- Remote UI 不执行脚本、HTML、远程代码或任意样式；ESP32 只接受 JSON 页面描述、白名单组件和白名单动作。
- 设置是顶部系统栏的全局系统入口，不属于应用页；应用页只放可扩展应用、小游戏和家庭工具，Remote UI 不应下发设置应用项。
- 天气、日程、音乐、AI、英语、相册、应用、设置是一级能力页；应用页不再重复承载这些已有明确职责的页面。
- 圆屏端“内容”不再作为一级页面名称；后端内容系统继续作为资源层，负责相册包、故事包、播客包、课程包和小游戏资源包。
- 本地页面必须保留兜底，避免后端不可用时设备不可操作。
- BLE、USB、未来蜂窝都必须作为 Connectivity Layer 的 provider 接入，不让业务代码直接绑定某一种网络。
- 增加更多音频功能前必须先设计 `AudioSessionManager`，避免 AI、音乐、课程音频和提示音互相抢占。
- 手机伴侣最小原型地址为 `http://192.168.31.246:3100/companion`。
- Home Assistant 真实控制需要在后端配置 `HOME_ASSISTANT_URL` 和 `HOME_ASSISTANT_TOKEN`。
- OpenClaw 真实能力依赖运行环境配置可执行的 `OPENCLAW_COMMAND`，命令必须接受第一个参数 `target`；当前远端使用 `/opt/xiaozhi-family-hub/bin/openclaw-command-adapter.sh`，`diagnostics/default/music` 均已有 success job；2026-07-09 修复设备侧公网 HTTPS 流地址回归后，真机 `esp32-185b` 实际播放服务器播客并听到声音，`openclaw-default-music` acceptance 已 passed。
- NAS 音乐真实扫描可以通过后端配置 `NAS_MUSIC_DIR` 接入；当前默认服务器媒体目录为 `/opt/xiaozhi-family-hub/data/resources/music/server`。
- 真机刷入、SD 插卡挂载、本地音乐播放、本地图片显示、服务器播客播放、后端断网恢复同步、SQLite 持久化、USB/资源导入 API、30 分钟稳定性长测和下一轮六方向 60 分钟稳定性长测已完成；设备端原生 USB MSC/CDC 文件导入仍需后续单独推进。
- 下一轮六方向长测最低 SRAM 已从事件探针优化前约 9.3KB 提升并稳定到 `14555` 字节以上；当前仍需继续补 EspBlufi 新 Wi-Fi 人工验收、真实 Home Assistant 场景状态变化 evidence、真实家庭内容扩充和 P10 后端产品化/工程化收口。
