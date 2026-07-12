# 路线图

## Phase 0-10：产品底座

已完成：

- 小智主线保留策略。
- 本地 LVGL AppShell。
- Family Backend 和 Action Hub。
- SD 资源、离线 outbox、资源 manifest。
- Remote JSON UI V1/V2。
- 服务器播客、SD 本地音乐、图片屏保。
- 设置设备中心、电源/存储/网络/蓝牙/诊断。
- 后端 SQLite、伴侣页、诊断 API。

## Phase 11-15：真实家庭闭环

已进入落地和验收：

1. 真实 OpenClaw 与家庭程序编排。
2. 家庭内容与资源运营系统。
3. 手机伴侣与 BLE 配网/代理。
4. Remote JSON UI V2 治理。
5. AI 增强层与家庭记忆。

当前后端媒体/播客能力已经成为 AI-native capability 的样板：

- 本地服务器音频。
- RSS 播客。
- 搜索、队列、收藏、历史。
- 播放进度、续播、标记已听完。
- 小智 MCP/工具调用。
- ESP32 轻量设备命令 ACK。

## Phase 16：产品重定位收口

目标：把项目从历史上的“ESP32 圆屏功能集合”旧定位正式调整为“三端家庭 AI 生态”。

范围：

- 圆屏定位为家庭现场交互端。
- 后端定位为 AI-native Family Capability Hub。
- 手机 App 定位为便携管理和连接桥。
- 小智官方定位为低延迟语音入口。
- 自建 AI 服务定位为长期家庭智能大脑。

验收：

- [x] 产品定位文档更新。
- [x] 总体架构文档更新。
- [x] 决策日志记录新定位。
- [x] 旧文档和 `todo.md` 中“ESP32 承载复杂业务”的表述全部清理或标注为历史。

## Phase 17：AI Service V1

目标：建立自建 AI 服务最小闭环，不替换小智官方语音入口。

范围：

- AI Service V1 design document.
- `POST /api/agent/ask`。
- `family.agent.ask` MCP 工具。
- Page Agent registry。
- Router fallback。
- 基础 Identity：family member、role、family mode。
- 基础 Memory：读写家庭记忆、成员偏好。
- 基础 Knowledge：媒体库、日程、设备状态、家庭记忆。
- Response shape：`speech`、`display`、`actions`、`handoff`。

验收：

- [x] AI Service V1 API、数据契约、Agent registry、Capability Tool contract 和验收场景完成文档化。
- [x] 小智可调用 `family.agent.ask`。
- [x] 音乐页“继续”直达 Media Agent。
- [x] 设置页“设备状态”直达 Device Agent。
- [x] AI/Home 页可 Router 到 Media/Device/Schedule/Weather/English/Album。
- [x] Schedule Agent Router 场景接入。
- [x] 儿童模式下外网搜索和危险工具被拒绝。
- [x] 所有 Agent action 产生审计记录。

## Phase 18：Capability Tool Registry

目标：把现有后端功能从 ad hoc action 逐步收敛成可被 AI/后台/手机复用的安全能力。

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

- [x] 后端可列出工具 registry。
- [x] AI 调用工具经过统一 policy。
- [x] 后台和手机可复用同一 tool executor。
- [x] 高风险工具支持确认/拒绝/审计。

## Phase 19：Page Agents

目标：一级页面拥有默认 Agent，页面内交互保持快速自然。

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
- [x] 页面 UI 保持稳定，只接收 display/action 结果。
- [x] Tools Agent 接入 OpenClaw/Home Assistant 安全工具链。

## Phase 20：Mobile App And Connectivity Bridge

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
- [x] 移动 Web 伴侣可导入媒体/相册/课程资源。
- [x] 断 Wi-Fi 场景有明确连接策略。

## 下一阶段优先级

1. 完成 EspBlufi 新 Wi-Fi 写入和小智官方链路回归验收。
2. 配置真实 Home Assistant 后，验证 HA 侧场景状态变化。
3. 继续把真实家庭素材导入内容库，验证相册/播客/英语包长期管理。
4. 对 OpenClaw `default/music` 已 ready 的映射做人工观察验收，并通过 `/admin` 或 `/companion` 写入 evidence。
5. 设计原生手机 App 或 PWA 的下一版连接桥，不让圆屏承担复杂管理。
6. 再决定是否接入 `xiaozhi-esp32-server` 作为独立 Voice Provider。
