# Family AI OS 文档入口

这一组文档是后续产品设计、代码落地和验收的主线。小智原项目文档只作为底座参考。

## 当前定位

Family AI OS 已从“把功能塞进 ESP32 的圆屏系统”重新定位为一个三端生态：

- 圆屏是家庭现场交互端，负责展示、触摸、语音入口、播放、确认和反馈。
- 后端是 AI-native Family Capability Hub，负责数据处理、系统管理、权限、工具、内容、记忆和设备命令。
- 手机 App 是预留的便携管理和连接桥，负责配网、诊断、资源导入、外出管理和未来无 Wi-Fi 网络代理。
- 小智官方继续作为低延迟语音入口之一；自建 AI 服务将作为长期家庭智能大脑。

## 文档结构

0. `current-state.md`：当前项目事实和最新可用状态。
1. `hardware-facts.md`：硬件事实、证据优先级和废弃结论。
2. `decision-log.md`：跨会话必须保留的产品/技术决策。
3. `01-product-positioning.md`：产品定位和边界。
4. `02-architecture.md`：总体架构和模块分层。
5. `03-page-navigation.md`：一级页面、导航和页面职责。
6. `04-firmware-appshell.md`：固件端 AppShell 模块规划。
7. `05-backend-api.md`：Family Backend API 和 action 边界。
8. `06-sd-resource-system.md`：SD 卡资源系统。
9. `07-deployment-and-test.md`：部署、真机烧录和验收。
10. `08-roadmap.md`：长期 Phase 路线。
11. `09-implementation-log.md`：实施记录摘要。
12. `10-ai-agent-layer.md`：AI-native 后端、Page Agent First 和自建 AI 服务规划。
13. `11-ai-service-v1.md`：AI Service V1 可实现接口、数据契约和验收标准。
14. `12-external-acceptance-runbook.md`：BluFi、Home Assistant、真实家庭内容和 OpenClaw default/music 的外部验收执行手册。

## 使用规则

- 新会话或子 agent 开始改代码前，先读 `current-state.md`、`hardware-facts.md` 和 `decision-log.md`。
- 新功能先检查 `03-page-navigation.md`，确认它属于哪个一级页面。
- 涉及固件架构时看 `04-firmware-appshell.md`。
- 涉及后端接口时看 `05-backend-api.md`。
- 涉及 SD、资源包、相册、屏保、离线缓存时看 `06-sd-resource-system.md`。
- 涉及 AI 服务、Agent、工具权限和小智/自建 AI 分工时看 `10-ai-agent-layer.md`。
- 准备实现 AI Service V1 时看 `11-ai-service-v1.md`。
- 执行真实手机配网、真实 HA、真实家庭素材或 OpenClaw default/music 外部验收时看 `12-external-acceptance-runbook.md`。
- `todo.md` 只记录当前执行清单和验收状态，不再作为完整设计文档。
- 如果聊天记录、旧计划和事实文档冲突，以真机验证和 `hardware-facts.md` 为准，并在 `decision-log.md` 追加变更原因。
