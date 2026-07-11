# 小智上游参考文档

这一层只作为“小智底座”的参考，不作为 Family AI OS 产品路线图。

当前项目仍基于小智主线，所以下列文档仍有价值：

- `../websocket.md` / `../websocket_zh.md`：小智通信链路参考。
- `../mqtt-udp.md` / `../mqtt-udp_zh.md`：MQTT/UDP 协议参考。
- `../blufi.md` / `../blufi_zh.md`：BluFi 配网参考。
- `../custom-board.md` / `../custom-board_zh.md`：自定义板型参考。
- `../code_style.md` / `../code_style_zh.md`：原项目代码风格参考。
- `../mcp-protocol.md`、`../mcp-usage.md`：小智 MCP 能力参考。

边界：

- 小智负责唤醒词、ASR/LLM/TTS、音频链路、OTA/MQTT 和官方连接。
- Family AI OS 不重写这些底层能力。
- Family AI OS 的产品定义、页面职责、后端 API、SD 资源系统和路线图，以 `../family-ai-os/00-index.md` 为准。

