#!/usr/bin/env bash
# =============================================================================
# deploy.sh —— 自建语音入口一键部署脚本
# Feature: selfhosted-voice-provider-page-agents / Task 5
#
# 作用:
#   在家庭后端服务器 (192.168.31.246) 上以 docker compose 拉起
#   xiaozhi-esp32-server 作为可替换语音入口。脚本本身只负责本目录内的
#   xiaozhi-server 容器, 全程不停止 / 不修改 / 不重启现有服务
#   (family-hub :3100 / mcp-bridge), 也不触碰 3100 端口相关任何东西。
#
# 用法:
#   cd server/voice-provider
#   export XIAOZHI_TOOL_TOKEN=<后端 server/.env 中同名的真实值>
#   ./deploy.sh
#
# 幂等: 可重复执行。docker compose up -d 只会在需要时重建容器。
#
# 前置检查 (任一失败即报错退出, 不做任何破坏性动作):
#   - docker / docker compose 是否可用
#   - 宿主机端口 8000 / 8003 是否已被占用
#   - data/.config.yaml 是否存在 (否则从 example 复制并提示填密钥后退出)
#   - 环境变量 XIAOZHI_TOOL_TOKEN 是否已设置
#   - data/.config.yaml 是否仍含 <your-...> 占位符 (有则拒绝启动并列出)
# =============================================================================

set -euo pipefail

# --- 定位到脚本所在目录 (server/voice-provider) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CONFIG_FILE="data/.config.yaml"
CONFIG_EXAMPLE="data/.config.yaml.example"
COMPOSE_FILE="docker-compose.yml"
HOST_PORTS=(8100 8003)
HEALTH_URL="http://localhost:8003/xiaozhi/ota/"
COMPOSE_SERVICE="xiaozhi-esp32-server"

# --- 颜色输出 (无 tty 时降级为纯文本) ---
if [ -t 1 ]; then
  C_RED="$(printf '\033[31m')"; C_GRN="$(printf '\033[32m')"
  C_YEL="$(printf '\033[33m')"; C_RST="$(printf '\033[0m')"
else
  C_RED=""; C_GRN=""; C_YEL=""; C_RST=""
fi
info()  { printf '%s[deploy]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn()  { printf '%s[deploy]%s %s\n' "$C_YEL" "$C_RST" "$*"; }
error() { printf '%s[deploy] 错误:%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
die()   { error "$*"; exit 1; }

# ---------------------------------------------------------------------------
# 1. docker / docker compose 可用性
# ---------------------------------------------------------------------------
check_docker() {
  command -v docker >/dev/null 2>&1 || die "未找到 docker。请先安装 Docker Engine。"

  # 优先 docker compose (v2 插件), 回退 docker-compose (v1)。
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    die "未找到 'docker compose' (v2 插件) 或 'docker-compose' (v1)。请先安装。"
  fi

  # daemon 是否可访问 (不改任何状态)。
  docker info >/dev/null 2>&1 || \
    die "无法连接 Docker daemon (可能未运行, 或当前用户无权限)。"

  info "docker 就绪: $(docker --version 2>/dev/null); compose: ${COMPOSE[*]}"
}

# ---------------------------------------------------------------------------
# 2. 端口占用检查 (只读探测, 不杀进程)
#    只有当占用者不是本 compose 的 xiaozhi-server 容器时才算冲突。
# ---------------------------------------------------------------------------
port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE "[:.]${port}[[:space:]]"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
  else
    warn "ss / lsof 均不可用, 跳过端口 ${port} 占用检查。"
    return 1
  fi
}

# 判断某端口是否正是被本 compose 的 xiaozhi-server 容器占用 (幂等重跑场景)。
port_owned_by_our_container() {
  local port="$1"
  local cid
  cid="$("${COMPOSE[@]}" ps -q "$COMPOSE_SERVICE" 2>/dev/null || true)"
  [ -n "$cid" ] || return 1
  docker port "$cid" 2>/dev/null | grep -qE "(^|[:.])${port}(/| )" \
    || docker inspect "$cid" 2>/dev/null | grep -q "\"${port}\""
}

check_ports() {
  local conflict=0
  for port in "${HOST_PORTS[@]}"; do
    if port_in_use "$port"; then
      if port_owned_by_our_container "$port"; then
        info "端口 ${port} 由本服务 (${COMPOSE_SERVICE}) 占用, 视为可重入。"
      else
        error "宿主机端口 ${port} 已被其它进程占用。"
        error "  这台是共享服务器, 严禁停用别的服务腾端口。"
        error "  请改 ${COMPOSE_FILE} 里 ${port} 的宿主机侧映射 (如 \"1${port}:${port}\"),"
        error "  并同步更新设备 OTA URL 后重试。"
        conflict=1
      fi
    else
      info "端口 ${port} 空闲。"
    fi
  done
  [ "$conflict" -eq 0 ] || die "存在端口冲突, 已中止 (未做任何改动)。"
}

# ---------------------------------------------------------------------------
# 3. data/.config.yaml 是否存在
# ---------------------------------------------------------------------------
check_config_present() {
  if [ ! -f "$CONFIG_FILE" ]; then
    if [ -f "$CONFIG_EXAMPLE" ]; then
      cp "$CONFIG_EXAMPLE" "$CONFIG_FILE"
      warn "未找到 ${CONFIG_FILE}, 已从 ${CONFIG_EXAMPLE} 复制一份。"
      warn "请编辑 ${CONFIG_FILE} 填入真实的 ASR/LLM/TTS 密钥与鉴权 token,"
      warn "然后重新执行 ./deploy.sh。"
      exit 1
    else
      die "缺少 ${CONFIG_FILE} 且找不到模板 ${CONFIG_EXAMPLE}, 无法继续。"
    fi
  fi
  info "配置文件存在: ${CONFIG_FILE}"
}

# ---------------------------------------------------------------------------
# 4. 环境变量 XIAOZHI_TOOL_TOKEN
# ---------------------------------------------------------------------------
check_env() {
  if [ -n "${XIAOZHI_TOOL_TOKEN:-}" ]; then
    info "XIAOZHI_TOOL_TOKEN 已设置 (值不回显)。"
    return
  fi
  if [ -f .voice-provider.env ] && grep -q '^XIAOZHI_TOOL_TOKEN=.' .voice-provider.env; then
    info ".voice-provider.env 已配置 XIAOZHI_TOOL_TOKEN (值不回显)。"
    return
  fi
  if [ -z "${XIAOZHI_TOOL_TOKEN:-}" ]; then
    error "环境变量 XIAOZHI_TOOL_TOKEN 未设置。"
    error "  该值必须与 Family_Backend (server/.env) 的同名 token 一致 (Req 7.2)。"
    error "  设置后重试:  export XIAOZHI_TOOL_TOKEN=<真实值> && ./deploy.sh"
    die "缺少 XIAOZHI_TOOL_TOKEN。"
  fi
}

# ---------------------------------------------------------------------------
# 5. 占位符检查: .config.yaml 中不得残留 <your-...>
# ---------------------------------------------------------------------------
check_placeholders() {
  local hits
  hits="$(grep -nE '<your-[^>]*>' "$CONFIG_FILE" || true)"
  if [ -n "$hits" ]; then
    error "${CONFIG_FILE} 仍含未填写的占位符, 拒绝启动 (不会伪造密钥):"
    printf '%s\n' "$hits" | sed 's/^/    /' >&2
    die "请把上述 <your-...> 替换为真实值后重试。"
  fi
  info "配置无占位符残留。"
}

# ---------------------------------------------------------------------------
# 6. 启动 + 健康检查
# ---------------------------------------------------------------------------
bring_up() {
  info "docker compose up -d --build (${COMPOSE_SERVICE}) ..."
  "${COMPOSE[@]}" -f "$COMPOSE_FILE" up -d --build "$COMPOSE_SERVICE"
}

health_check() {
  info "等待服务就绪并做健康检查 ..."

  # 6.1 OTA/配置端点可达 (最多重试 ~30s)
  local ota_ok=0
  if command -v curl >/dev/null 2>&1; then
    for _ in $(seq 1 15); do
      if curl -fsS -o /dev/null "$HEALTH_URL" 2>/dev/null; then
        ota_ok=1; break
      fi
      sleep 2
    done
    if [ "$ota_ok" -eq 1 ]; then
      info "OK: OTA/配置端点可达 ${HEALTH_URL}"
    else
      warn "OTA/配置端点 ${HEALTH_URL} 暂未就绪 (可能仍在初始化)。"
      warn "  可稍后手动核对:  curl -i ${HEALTH_URL}"
    fi
  else
    warn "未找到 curl, 跳过 OTA 端点检查。"
  fi

  # 6.2 日志中确认四段管线加载 (VAD/ASR/LLM/TTS)
  local logs
  logs="$("${COMPOSE[@]}" -f "$COMPOSE_FILE" logs --no-color "$COMPOSE_SERVICE" 2>/dev/null | tail -n 400 || true)"
  if [ -n "$logs" ]; then
    info "管线加载迹象 (VAD/ASR/LLM/TTS):"
    printf '%s\n' "$logs" | grep -iE "VAD|ASR|LLM|TTS|selected_module" | tail -n 20 | sed 's/^/    /' || \
      warn "  日志中暂未匹配到管线关键字 (服务可能仍在启动)。"
    if printf '%s\n' "$logs" | grep -iqE "error|traceback|exception"; then
      warn "  日志中出现 error/exception, 请核对:"
      printf '%s\n' "$logs" | grep -iE "error|traceback|exception" | tail -n 10 | sed 's/^/    /'
    fi
  else
    warn "暂时取不到容器日志, 稍后可:  ${COMPOSE[*]} -f ${COMPOSE_FILE} logs -f ${COMPOSE_SERVICE}"
  fi
}

check_router_sources() {
  local expected_digest="sha256:3aab4836f012f59145926ac023a45857f6a87e9b6089eea7ffa277faafcfe887"
  local expected_handler="004702ad61a90454afb7f4cedff015973081c3c2a0587ec23a960f26de39d1c3"
  grep -q "$expected_digest" Dockerfile || die "Dockerfile 未固定到已验证的 0.9.5 镜像摘要。"
  grep -q "$expected_handler" build/apply_page_router.py || die "Page Router 上游入口校验值缺失。"
  [ -f core/handle/family_page_router.py ] || die "缺少确定性 Page Router 源码。"
  info "Page Router 基线与入口校验已锁定。"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
main() {
  info "=== 自建语音入口部署 (Task 5) ==="
  info "工作目录: ${SCRIPT_DIR}"
  warn "共享服务器提示: 本脚本只管 ${COMPOSE_SERVICE}, 不动 family-hub(:3100) / mcp-bridge。"

  check_docker
  check_config_present
  check_env
  check_placeholders
  check_ports
  check_router_sources

  bring_up
  health_check

  info "=== 完成。后续验证见 DEPLOYMENT.md 第五章 (Task 9)。 ==="
  info "查看日志:  ${COMPOSE[*]} -f ${COMPOSE_FILE} logs -f ${COMPOSE_SERVICE}"
}

main "$@"
