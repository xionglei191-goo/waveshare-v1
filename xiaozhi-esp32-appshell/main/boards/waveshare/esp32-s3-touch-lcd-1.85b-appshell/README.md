新增 微雪 开发板: ESP32-S3-Touch-LCD-1.85B AppShell
产品链接：
https://www.waveshare.net/shop/ESP32-S3-Touch-LCD-1.85B.htm

这是基于官方 1.85B 板型扩展的前台应用壳版本：

- 触摸屏：切换首页 / AI / 天气 / 日程 / 音乐 / 相册 / 英语 / 应用 / 设置
- 单击 BOOT：切换一级页面；启动阶段仍用于进入 Wi-Fi 配网
- 长按 BOOT：切换小智 AI 对话
- 双击 BOOT：切换设备侧 AEC（启用 CONFIG_USE_DEVICE_AEC 时）
- 自动省电保持低亮；AI 消息、系统提示、后端动作反馈和新通知会自动唤醒并恢复亮度；后端新通知通过 `/api/events/latest` 轻量探针触发，30 秒完整轮询保底
