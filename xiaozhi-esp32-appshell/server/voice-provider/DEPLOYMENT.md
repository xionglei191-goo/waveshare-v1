# 自建语音入口部署运行手册

> Feature: **selfhosted-voice-provider-page-agents**
> 覆盖 Task 5 (服务器部署)、Task 6/7 (配置与鉴权, 见同目录模板)、Task 8 (设备 OTA URL 切换)、Task 9 (验证清单)。

本手册说明如何在家庭局域网内部署开源的 `xinnan-tech/xiaozhi-esp32-server` 作为**自建语音入口 (Self_Hosted_Voice_Server)**, 让圆屏设备的页面内语音直达 Family_Backend 的对应 Page Agent, 同时把官方小智保留为低延迟**回退入口**。

架构要点:

- **Family_Backend (Node.js @ 192.168.31.246:3100) 仍是唯一"大脑"**, 拥有 Agent、策略、工具与执行, 不被替换 (Req 1.3, 1.4)。
- 自建服务器只做**可替换的运行时语音入口**: 跑 VAD → ASR → LLM → TTS, 每轮把页面内请求委托给后端 (Req 1.1, 1.2)。
- 设备侧改动**最小**: 只切 OTA/配置发现 URL (+ 可选鉴权 token), 并上报当前一级页面 + 家庭模式。**不重建设备端 ASR/TTS 栈** (Req 2.4)。

配套模板文件 (本目录):

| 文件 | 用途 | 对应任务 |
|------|------|---------|
| `data/.config.yaml.example` | Streaming Profile + 服务器鉴权配置模板 | Task 6, 7 |
| `data/.mcp_server_settings.json.example` | Option B (MCP 工具, 备选) | 参考 |
| `plugins_func/functions/family_agent_ask.py` | `family.agent.ask` 本地插件 (Option A, 推荐) | Task 10-13 |

---

## 已验证的 246 单模块配置

以下记录的是 2026-07-10 在 `192.168.31.246` 上实际运行的轻量部署，供后续维护和恢复使用。它只启动语音入口，不启动上游的 Web 控制台、MySQL 或 Redis；家庭业务、Agent 与工具仍由 Family_Backend `:3100` 负责。

> 本手册后文的 `8000/8003` Compose 片段是上游默认 bridge 网络示例。246 使用 host 网络并把语音 WebSocket 放在 `8100`，两套端口和网络设置不能混用。

### 部署目录与文件职责

```text
/home/xionglei/xiaozhi-esp32-server/main/xiaozhi-server/
  docker-compose.family.yml    # 246 当前实际使用的 Compose 文件
  .voice-provider.env          # 仅本机保存的 XIAOZHI_TOOL_TOKEN，权限必须为 0600
  data/.config.yaml            # VAD / ASR / LLM / TTS、OTA 和设备鉴权配置
  voice-provider-build/        # 固定 0.9.5 基线的 Page Router 派生镜像上下文
  plugins_func/functions/family_agent_ask.py
```

`.voice-provider.env` 不进入 Git，也不在聊天、日志或文档中写入真实值：

```dotenv
XIAOZHI_TOOL_TOKEN=<must match Family Hub systemd XIAOZHI_TOOL_TOKEN>
```

`docker-compose.family.yml` 的关键部分：

```yaml
services:
  xiaozhi-esp32-server:
    build:
      context: ./voice-provider-build
    image: xiaozhi-voice-provider:0.9.5-family-router2
    network_mode: host
    env_file:
      - ./.voice-provider.env
    environment:
      - FAMILY_BACKEND_URL=http://127.0.0.1:3100
    volumes:
      - ./data:/opt/xiaozhi-esp32-server/data
      - ./plugins_func/functions/family_agent_ask.py:/opt/xiaozhi-esp32-server/plugins_func/functions/family_agent_ask.py:ro
```

host 网络使容器能够访问同机的 Family_Backend 和 Sub2API。派生镜像固定到上游摘要 `sha256:3aab4836f012f59145926ac023a45857f6a87e9b6089eea7ffa277faafcfe887`，构建时校验 `intentHandler.py` 和 `connection.py`，基线变化会直接失败。`router2` 同时把连接日志收紧为只记录请求头名称，禁止记录 Authorization、WebSocket nonce 等请求头值。

### 语音与设备配置

246 的 `data/.config.yaml` 已验证使用以下端口与模块：

```yaml
selected_module:
  VAD: SileroVAD
  ASR: AliyunBLStreamASR
  LLM: Sub2ApiLLM
  TTS: AliBLTTS

server:
  port: 8100
  http_port: 8003
  websocket: ws://192.168.31.246:8100/xiaozhi/v1/
  auth_key: <keep private>
  auth:
    enabled: true
```

`Intent.function_call.functions` 只保留 `get_news_from_newsnow` 和 `handle_exit_intent`。页面路由由 ASR 后置 Page Router 强制执行；`family_agent_ask` 只作为兼容插件保留。设备侧把 NVS `wifi.ota_url` 配成：

```text
http://192.168.31.246:8003/xiaozhi/ota/
```

`data/.config.yaml` 还应显式配置 `exit_commands`，至少包含 `退出`、`关闭`、
`停止对话`、`结束对话` 和 `退出对话`。这些命令由 Provider 在 Page Router
之前处理并直接关闭当前连接，不能交给 Home/Media/Album Agent 解释。

设备随后从 OTA 响应自动学习 `ws://192.168.31.246:8100/xiaozhi/v1/`，无需把 WebSocket 地址或鉴权密钥手动写进固件。

### 应用配置与验证

修改 `data/.config.yaml`、插件或 `.voice-provider.env` 后，只重建语音容器：

```sh
cd /home/xionglei/xiaozhi-esp32-server/main/xiaozhi-server
docker compose -f docker-compose.family.yml config -q
docker compose -f docker-compose.family.yml up -d --force-recreate --no-deps xiaozhi-esp32-server
```

验证命令：

```sh
curl -i http://127.0.0.1:8003/xiaozhi/ota/
docker logs --tail 100 xiaozhi-voice-provider
docker exec xiaozhi-voice-provider test -f /opt/xiaozhi-esp32-server/plugins_func/functions/family_agent_ask.py
```

预期日志包含 VAD、ASR、LLM、TTS 初始化成功；容器环境中同时存在 `FAMILY_BACKEND_URL` 与 `XIAOZHI_TOOL_TOKEN`。

---

## 一、Task 5 —— 部署 xiaozhi-esp32-server

### 1. 拉取源码

```sh
git clone https://github.com/xinnan-tech/xiaozhi-esp32-server.git
cd xiaozhi-esp32-server
```

### 2. 放置配置与插件

把本目录 (`server/voice-provider/`) 的模板复制进 xiaozhi-esp32-server 的部署目录:

```sh
# 在 xiaozhi-esp32-server 根目录下 (示例路径按实际调整):
# 1) 主配置 (去掉 .example 后缀), 填入真实密钥
cp <appshell>/server/voice-provider/data/.config.yaml.example  data/.config.yaml

# 2) family.agent.ask 本地插件 (Option A, 推荐)
cp <appshell>/server/voice-provider/plugins_func/functions/family_agent_ask.py \
   plugins_func/functions/family_agent_ask.py
# server_latest 镜像的插件目录是 plugins_func/functions/；若后续更换镜像版本，
# 请先在容器内确认实际目录，再调整挂载目标。

# 3) 如果确实要走 MCP 路径 (Option B, 一般不需要):
# cp <appshell>/server/voice-provider/data/.mcp_server_settings.json.example \
#    data/.mcp_server_settings.json
```

编辑 `data/.config.yaml`:

- 填写 ASR / LLM / TTS 各 provider 的真实密钥 (`<your-...>` 占位符)。
- 在 `Intent.function_call.functions` 中确认已登记 `family_agent_ask` (模板已含)。
- 设置 `server.auth.enabled: true`, 并把 `family-round-screen` 的 token 换成真实随机值 (见第二章 / Task 7)。

### 3. Docker 部署 (docker-compose)

xiaozhi-esp32-server 提供 docker-compose 部署方式。确保 compose 把以下端口映射到宿主机:

- **OTA / 配置发现**: `:8003` (`http://<host>:8003/xiaozhi/ota/`)
- **语音 WebSocket**: `:8000` (`ws://<host>:8000/xiaozhi/v1/`)

并注入 `family.agent.ask` 插件所需的环境变量 (见"环境变量"一节)。示例 compose 片段:

```yaml
services:
  xiaozhi-server:
    image: ghcr.io/xinnan-tech/xiaozhi-esp32-server:latest   # 或按仓库说明本地构建
    ports:
      - "8000:8000"   # 语音 WS
      - "8003:8003"   # OTA/配置
    volumes:
      - ./data:/opt/xiaozhi-esp32-server/data
      - ./plugins_func/functions/family_agent_ask.py:/opt/xiaozhi-esp32-server/plugins_func/functions/family_agent_ask.py:ro
    environment:
      - FAMILY_BACKEND_URL=http://192.168.31.246:3100
      - XIAOZHI_TOOL_TOKEN=${XIAOZHI_TOOL_TOKEN}
    restart: unless-stopped
```

启动:

```sh
docker compose up -d
docker compose logs -f xiaozhi-server
```

### 3b. 一键部署 (deploy.sh, 推荐)

本目录提供 `docker-compose.yml` + `deploy.sh`, 把上面的手动步骤收敛为一条命令,
并在启动前做前置检查、启动后做健康检查。**脚本只管理本目录内的 `xiaozhi-server`
容器, 全程不停止 / 不修改 / 不重启现有服务 (family-hub `:3100` / mcp-bridge),
也不触碰 3100 端口相关任何东西。**

前置准备:

```sh
cd server/voice-provider

# 1) 准备主配置 (首次运行 deploy.sh 会自动从 example 复制并提示, 然后退出)
#    复制后务必填入真实的 ASR/LLM/TTS 密钥与 server.auth token
cp data/.config.yaml.example data/.config.yaml
$EDITOR data/.config.yaml

# 2) 设置后端工具鉴权 token (必须与后端 server/.env 的同名值一致, Req 7.2)
export XIAOZHI_TOOL_TOKEN=<真实值>
```

执行:

```sh
./deploy.sh
```

`deploy.sh` 会依次做:

1. **docker / docker compose 可用性** —— 检测 `docker`、`docker compose` (v2) 或
   `docker-compose` (v1), 并确认 daemon 可访问; 缺失即报错退出。
2. **端口占用检查** —— 用 `ss`/`lsof` 检查宿主机 `8000`、`8003`; 若被**非本服务**
   进程占用则报错退出, 并提示改 `docker-compose.yml` 里宿主机侧映射
   (如 `"18000:8000"`), 绝不为腾端口去停别的服务。
3. **配置存在性** —— 若 `data/.config.yaml` 不存在, 从 `.config.yaml.example`
   复制一份并提示填密钥后退出。
4. **环境变量校验** —— `XIAOZHI_TOOL_TOKEN` 未设置则报错退出 (不回显其值)。
5. **占位符校验** —— `data/.config.yaml` 中仍含 `<your-...>` 则拒绝启动并列出待填项
   (脚本**绝不伪造密钥**绕过)。
6. **启动 + 健康检查** —— `docker compose up -d xiaozhi-server`, 随后
   `curl http://localhost:8003/xiaozhi/ota/`, 并 `grep` 容器日志中的
   `VAD/ASR/LLM/TTS` 管线加载迹象与 error。

**所需环境变量:**

| 变量 | 是否必填 | 说明 |
|------|---------|------|
| `XIAOZHI_TOOL_TOKEN` | 是 | 后端工具鉴权 token; 未设置 `deploy.sh` 拒绝启动 (Req 7.2) |
| `FAMILY_BACKEND_URL` | 否 | 默认 `http://192.168.31.246:3100`; compose 已内置默认值 |

**幂等性:** `deploy.sh` 可重复执行。端口检查会识别"端口正被本 `xiaozhi-server`
容器占用"的重入场景, 不会误报冲突; `docker compose up -d` 仅在需要时重建容器。

若健康检查阶段 OTA 端点暂未就绪, 多为服务仍在初始化, 可稍后手动核对:

```sh
curl -i http://localhost:8003/xiaozhi/ota/
docker compose -f docker-compose.yml logs -f xiaozhi-server
```

### 4. 启动与健康检查

确认服务起来且管线加载正常:

```sh
# OTA/配置端口可达
curl -i http://<host>:8003/xiaozhi/ota/

# 观察启动日志, 确认 VAD → ASR → LLM → TTS 四段管线均已加载, 无 provider 报错
docker compose logs xiaozhi-server | grep -iE "VAD|ASR|LLM|TTS|selected_module|error"
```

判据 (Req 1.1, 1.3, 1.4):

- 日志显示 `SileroVAD` / `DoubaoStreamASR` / `OpenAILLM` / `HuoshanDoubleStreamTTS` 均初始化成功。
- `Intent: function_call` 生效, 且 `family_agent_ask` 工具已登记。
- OTA 端点返回包含 `websocket` 段的配置 JSON。

---

## 二、环境变量

`family.agent.ask` 插件 (`family_agent_ask.py`) 在运行环境读取以下变量, **不写进 `.config.yaml`**:

| 变量 | 值 | 说明 |
|------|-----|------|
| `FAMILY_BACKEND_URL` | `http://192.168.31.246:3100` | Family_Backend 基址; 插件拼接 `/api/agent/ask` |
| `XIAOZHI_TOOL_TOKEN` | `<your-tool-auth-token>` | 后端工具鉴权 token (Req 7.2); 作为 `Authorization: Bearer` 头发给后端 |

说明:

- 插件默认基址为 `http://192.168.31.246:3100` (未设 `FAMILY_BACKEND_URL` 时)。
- `XIAOZHI_TOOL_TOKEN` 必须与 Family_Backend 的同名配置 (`server/.env` 中的 `XIAOZHI_TOOL_TOKEN`) 一致。
- 该 token 绝不进入 speech/display; 插件在返回前会剥离所有密钥字段 (Req 7.5)。

---

## 三、Task 6/7 —— 配置要点回顾

详细内容见 `data/.config.yaml.example` 顶部注释。关键点:

- **Streaming Profile (Req 5.1, 8.1-8.4)**: 流式 ASR + 快首字 LLM + 流式 TTS + `Intent: function_call`, 服务于 `Time_To_First_Audio ≤ 1500ms` (Req 5.2)。
- **provider 复现性 (Req 8.5)**: ASR/LLM/TTS 的 type/base_url/model_name 等均记录在配置中 (密钥占位), 可复现。
- **服务器鉴权 (Req 7.1, 7.3, 7.4)**: `server.auth.enabled: true`; `family-round-screen` token 下发给圆屏设备。
- **token 下发路径**: 该 token 写在 `server.auth.tokens`, 由 OTA 响应的 `websocket.token` 字段发给设备, 设备建立语音会话时出示 (设备无需改固件)。

---

## 四、Task 8 —— 设备 OTA URL 切换

设备已实现"从 OTA 自动学习语音端点"的读取路径, **无需改固件**。只需把设备 NVS 的 OTA URL 指向自建服务器:

- **NVS 命名空间**: `wifi`
- **键**: `ota_url`
- **新值**: `http://<host>:8003/xiaozhi/ota/` (若前置 TLS 则用 `https://`)

设置方式 (二选一):

1. 通过设备的 **Wi-Fi/OTA 配网 UI** 或 provisioning 流程写入 `ota_url`。
2. 通过 BluFi/配网客户端把 `ota_url` 写进 `wifi` 命名空间。

设备读取路径 (现有代码, 无需改动):

- `Ota::GetCheckVersionUrl()` 读取 `Settings("wifi").GetString("ota_url")` (回退 `CONFIG_OTA_URL`)。
- `Ota::CheckVersion()` 把 OTA 响应里的 `websocket` 对象原样拷进 `Settings("websocket")` (含 `url`、`token`)。
- 实时会话随后用学到的 `websocket.url` 连接, 并出示 `websocket.token` 作为鉴权头。

因此设备会自动学到:

- **Voice_WebSocket_URL**: `ws://<host>:8000/xiaozhi/v1/`
- **Voice_Provider_Auth_Token**: 即配置里 `family-round-screen` 的 token

验证 (Req 2.1-2.3, 2.5):

```sh
# 在设备串口 monitor 中观察, 确认学到自建服务器的 ws url + token, 并成功握手
idf.py -p <port> monitor
# 关注日志: 解析 OTA websocket 段 → 连接 ws://<host>:8000/xiaozhi/v1/ → 鉴权通过
```

---

## 五、Task 9 —— 验证清单

### 5.1 单次语音回合 (Req 1.1, 3.2-3.5, 4.1-4.3)

在每个一级页面说一句页面内请求, 确认到达匹配的 Page Agent:

| 页面 | 示例语音 | 期望 Page Agent |
|------|---------|----------------|
| home | "今天有什么安排" | home |
| weather | "明天会下雨吗" | weather |
| schedule | "帮我加个日程" | schedule |
| ai | "讲个笑话" | general |
| music | "继续" | media (resume) |
| album | "看看相册" | album |
| apps | "打开应用" | tools |
| settings | "状态" | device (diagnostics) |
| english | "练一句口语" | english |

判据: 后端日志显示 `agentForPage(page)` 命中对应 agent, 圆屏播出对应 speech。

### 5.2 OTA discovery (Req 2.1-2.3)

- 设置 `Settings("wifi").ota_url` → `http://<host>:8003/xiaozhi/ota/`。
- 确认 `websocket.url` / `token` 学进 NVS, 设备打开到自建服务器的语音 WS。

### 5.3 延迟测量 (Req 5.2, 5.3)

- 使用 xiaozhi-esp32-server 自带的 `performance_tester` 工具, 配合局域网端到端计时。
- 确认 `Time_To_First_Audio ≤ 1500ms` (从 VAD 收尾到第一个音频包)。
- 在 turn trace 中确认只有**一次** LLM 分类跳 (Intent_Function_Call 内联工具选择, Req 5.3)。

### 5.4 鉴权 (Req 7.1, 7.2, 7.4)

- 用错误的 `Voice_Provider_Auth_Token` 连接 → 会话被拒, 管线不启动。
- 用错误的 `Tool_Auth_Token` 调 `/api/agent/ask` → 后端拒绝。

### 5.5 barge-in (Req 5.4)

- 播放中说话 → 当前播放中断; 允许短暂清理延迟后接受新输入。

### 5.6 设备侧回归 (Req 2.4)

- 确认设备原有音频处理行为不变, 既有语音功能仍正常。

---

## 六、回退说明 (Req 6.1-6.5)

单会话只有**一个**活跃 Voice Provider, 不按页切换实时语音 WS 端点 (Req 6.4)。

| 场景 | 行为 | Req |
|------|------|-----|
| 主 OTA 连续两次不可达，或主语音通道无法建立 | 获取 `CONFIG_OTA_URL`，使用官方返回的 WebSocket/MQTT 配置完成当前会话 | 2.5, 2.6, 6.1 |
| 页面 Agent 返回 `handled=false` | 不执行 Capability，由自建 Provider LLM 普通回答 | 3.6, 6.2 |
| 语音轮中途后端不可达 | 服务器用**自身 LLM** 给通用回答, 不做后端工具动作, **不提示功能降级** | 6.3 |
| 自建服务器恢复 | 下次会话前探测主 OTA；30 秒冷却内不重复探测，且不在 ASR/TTS 中途切换 | 6.5 |

---

## 七、安全 (Req 7.1-7.5)

- **局域网部署**: 服务器面向家庭 LAN; 任何超出 LAN 的暴露都必须开启鉴权 (Req 7.3)。
- **启用鉴权**: `server.auth.enabled: true`; 无效 `Voice_Provider_Auth_Token` → 拒绝会话且不启动管线 (Req 7.1, 7.4)。
- **工具鉴权**: 插件用 `XIAOZHI_TOOL_TOKEN` 作为 `Authorization: Bearer` 头; 后端在开启工具鉴权时拒绝无 token 调用 (Req 7.2)。
- **密钥不入 speech/display**: 插件在返回前剥离所有密钥字段 (token/secret/authorization/api_key/password), 保证密钥不进入 TTS 与 UI (Req 7.5)。

---

## 八、引用的设备端已完成改动

本 feature 的设备端改动已在本仓库落地, 供交叉核对:

- `main/app_shell/app_shell.cc`
  - `PageToBackendKey(AppShell::Page)` —— 纯函数, 把页面枚举映射到后端 `Page_Key`
    (kAskAi→ai, kMusicLocal/kMusicServer→music, kContent→album, kSettings*→settings,
    kApps→apps, kHome→home, kWeather→weather, kSchedule→schedule,
    kEnglishPractice→english; kScreensaver/kNotifications/kFamilyMode→home,
    kMiniGame→apps)。
  - `AppShell::CurrentPageKey()` → 返回 `PageToBackendKey(page_)`。
  - `AppShell::CurrentFamilyMode()` → 返回 `family_mode_`。
- `main/mcp_server.cc`
  - MCP 工具 `self.page.get_context` —— 每次调用实时读取 AppShell 状态, 返回
    `{ page, familyMode }`, 供自建语音服务器在调用 `family.agent.ask` 前拉取最新上下文。

---

## 九、任务对应速查

| 任务 | 内容 | 交付物 |
|------|------|--------|
| Task 5 | 部署 xiaozhi-esp32-server (Docker) | 本手册第一章 + `docker-compose.yml` + `deploy.sh` (一键部署见 3b) |
| Task 6 | Streaming Profile 配置 | `data/.config.yaml.example` |
| Task 7 | 服务器鉴权 | `data/.config.yaml.example` (`server.auth`) |
| Task 8 | 设备 OTA URL 切换 | 本手册第四章 |
| Task 9 | 验证清单 | 本手册第五章 |
| Task 10-13 | `family.agent.ask` 插件 | `plugins_func/functions/family_agent_ask.py` |
