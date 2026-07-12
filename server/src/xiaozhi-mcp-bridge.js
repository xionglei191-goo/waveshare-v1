const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const { loadConfig } = require("./config");

const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_DEVICE_ID = "esp32-185b";

function readSecretFile(filePath) {
  if (!filePath) {
    return "";
  }
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch (error) {
    return "";
  }
}

function resolveRuntimeConfig(overrides = {}) {
  const config = loadConfig(overrides);
  const endpointFile = process.env.XIAOZHI_MCP_ENDPOINT_FILE ||
    path.join(config.rootDir, "secrets/xiaozhi-mcp-endpoint");
  const tokenFile = process.env.XIAOZHI_TOOL_TOKEN_FILE ||
    path.join(config.rootDir, "secrets/xiaozhi-tool-token");
  return {
    name: config.name,
    version: config.version,
    endpoint: process.env.XIAOZHI_MCP_ENDPOINT || readSecretFile(endpointFile),
    backendUrl: (process.env.FAMILY_BACKEND_URL || `http://127.0.0.1:${config.port}`).replace(/\/$/, ""),
    toolToken: process.env.XIAOZHI_TOOL_TOKEN || process.env.AI_TOOL_TOKEN || readSecretFile(tokenFile),
    reconnectMinMs: Number(process.env.MCP_RECONNECT_MIN_MS || 1000),
    reconnectMaxMs: Number(process.env.MCP_RECONNECT_MAX_MS || 30000)
  };
}

function tool(name, description, properties = {}, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false
    }
  };
}

function createToolList() {
  const deviceId = {
    type: "string",
    description: "目标 ESP32 设备 ID，默认 esp32-185b。"
  };
  const text = {
    type: "string",
    description: "用户原始语音或意图文本，可为空。"
  };
  const userId = { type: "string", description: "可选，家庭成员 ID。" };
  const role = { type: "string", description: "可选，用户角色，例如 parent、child、guest。" };
  const familyMode = { type: "string", description: "可选，当前用户模式：默认（家长）、儿童或访客。" };
  return [
    tool("family.agent.ask", "把用户话语交给 Family AI OS 自建 Agent 层处理。会根据当前一级页面优先选择对应 Agent，并通过后端安全 Capability Tools 执行动作。", {
      text,
      page: { type: "string", description: "当前一级页面，例如 ai、music、settings。默认 ai。" },
      inputType: { type: "string", description: "输入类型，通常为 voice 或 text。" },
      userId: { type: "string", description: "可选，家庭成员 ID。" },
      role: { type: "string", description: "可选，用户角色，例如 parent、child、guest。" },
      familyMode: { type: "string", description: "可选，当前用户模式：默认（家长）、儿童或访客。" },
      deviceId
    }, ["text"]),
    tool("family.media.play", "播放家庭服务器或公开网络来源的音频。优先搜索服务器本地文件，本地没有时再搜索已配置的 RSS、公共音频库或安全直链。", {
      text,
      query: { type: "string", description: "要搜索的标题、歌手、故事名或播客关键词。" },
      trackId: { type: "string", description: "可选，服务器媒体 track id。" },
      deviceId
    }),
    tool("family.podcast.play", "播放家庭服务器上的播客或音乐文件；本地没有匹配时会使用网络兜底来源。", {
      text,
      query: { type: "string", description: "可选，按标题或路径搜索音频。" },
      trackId: { type: "string", description: "可选，服务器媒体 track id。" },
      deviceId
    }),
    tool("family.podcast.resume", "继续播放上次没有听完的服务器播客或音乐。", {
      text,
      trackId: { type: "string", description: "可选，指定要继续播放的 track id。" },
      deviceId
    }),
    tool("family.podcast.next", "切换到下一集服务器播客。", { text, deviceId }),
    tool("family.podcast.stop", "停止当前服务器播客播放。", { text, deviceId }),
    tool("family.podcast.cache", "把当前服务器播客缓存到 ESP32 的 SD 卡。", { text, deviceId }),
    tool("family.podcast.favorite", "收藏当前正在播放的服务器播客或音乐。", { text, deviceId }),
    tool("family.speaker.say", "让小米/小爱音箱用语音念出一段话（TTS 播报），不作为指令执行。用于让家里的小爱音箱开口说话。", {
      text,
      deviceId,
      userId,
      role,
      familyMode
    }, ["text"]),
    tool("family.speaker.command", "让小米/小爱音箱执行一句语音指令（交给小爱自己的助手执行）。可用于让音箱放歌、暂停、下一首、设闹钟、报时，或控制其它已接入的小米设备。", {
      text,
      deviceId,
      userId,
      role,
      familyMode
    }, ["text"]),
    tool("family.speaker.volume", "设置小米/小爱音箱的音量，取值 0-100（百分比）或 0-1。", {
      level: { type: "number", description: "音量，0-100 百分比或 0-1 级别。" },
      deviceId,
      userId,
      role,
      familyMode
    }),
    tool("family.toast", "向家庭圆屏发送一条简短提示。", {
      message: { type: "string", description: "要显示在圆屏上的短消息。" },
      deviceId
    }, ["message"])
  ];
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function normalizeArguments(params = {}) {
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  return {
    ...args,
    deviceId: args.deviceId || args.device_id || DEFAULT_DEVICE_ID
  };
}

function gatewayToolName(name) {
  switch (name) {
    case "family.media.play":
      return "family.media.play";
    case "family.podcast.play":
      return "family.podcast.play";
    case "family.podcast.resume":
      return "family.podcast.resume";
    case "family.podcast.next":
      return "family.podcast.next";
    case "family.podcast.stop":
      return "family.podcast.stop";
    case "family.podcast.cache":
      return "family.podcast.cache";
    case "family.podcast.favorite":
      return "family.podcast.favorite";
    case "family.toast":
      return "ui.toast";
    default:
      return "";
  }
}

async function callAgent(runtime, args) {
  const headers = { "Content-Type": "application/json" };
  if (runtime.toolToken) {
    headers.Authorization = `Bearer ${runtime.toolToken}`;
  }
  const response = await fetch(`${runtime.backendUrl}/api/agent/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: args.text || args.query || "",
      utterance: args.text || args.query || "",
      page: args.page || "ai",
      inputType: args.inputType || "voice",
      deviceId: args.deviceId || DEFAULT_DEVICE_ID,
      user: {
        id: args.userId || args.memberId || "xiaozhi",
        role: args.role || ""
      },
      familyMode: args.familyMode || args.mode || "",
      source: "xiaozhi.mcp"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || payload.data?.speech || `agent http ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload.data || {};
}

async function callCapabilityTool(runtime, name, args) {
  const headers = { "Content-Type": "application/json" };
  if (runtime.toolToken) {
    headers.Authorization = `Bearer ${runtime.toolToken}`;
  }
  const response = await fetch(`${runtime.backendUrl}/api/agent/tools/${encodeURIComponent(name)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      args,
      user: {
        id: args.userId || args.memberId || "xiaozhi",
        role: args.role || ""
      },
      familyMode: args.familyMode || args.mode || "",
      source: "xiaozhi.mcp"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.data?.speech || payload.error || `tool http ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload.data || {};
}

async function callGateway(runtime, name, args) {
  if (name === "family.agent.ask") {
    return callAgent(runtime, args);
  }
  if (name.startsWith("family.speaker.")) {
    return callCapabilityTool(runtime, name, args);
  }
  const mapped = gatewayToolName(name);
  if (!mapped) {
    const error = new Error(`unknown tool: ${name}`);
    error.code = -32601;
    throw error;
  }
  const body = {
    tool: mapped,
    text: args.text || args.query || args.message || name,
    params: args
  };
  const headers = { "Content-Type": "application/json" };
  if (runtime.toolToken) {
    headers.Authorization = `Bearer ${runtime.toolToken}`;
  }
  const response = await fetch(`${runtime.backendUrl}/api/ai/xiaozhi/tool`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || `gateway http ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload.data || {};
}

async function handleMcpRequest(runtime, request) {
  if (!request || request.jsonrpc !== "2.0") {
    return null;
  }
  const id = request.id;
  const method = request.method || "";
  if (!id && method.startsWith("notifications/")) {
    return null;
  }

  try {
    switch (method) {
      case "initialize":
        return jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "xiaozhi-family-hub", version: runtime.version || "0.2.0" }
        });
      case "tools/list":
        return jsonRpcResult(id, { tools: createToolList(), nextCursor: "" });
      case "tools/call": {
        const name = request.params?.name || "";
        const args = normalizeArguments(request.params);
        const result = await callGateway(runtime, name, args);
        return jsonRpcResult(id, {
          content: [
            {
              type: "text",
              text: result.speech || result.command?.type || "家庭工具已下发。"
            }
          ],
          isError: false
        });
      }
      case "ping":
        return jsonRpcResult(id, {});
      case "resources/list":
        return jsonRpcResult(id, { resources: [] });
      case "prompts/list":
        return jsonRpcResult(id, { prompts: [] });
      default:
        return jsonRpcError(id, -32601, `unsupported method: ${method}`);
    }
  } catch (error) {
    return jsonRpcError(id, error.code || -32000, error.message || "tool failed");
  }
}

function runBridge(runtime = resolveRuntimeConfig()) {
  if (!runtime.endpoint) {
    throw new Error("XIAOZHI_MCP_ENDPOINT or XIAOZHI_MCP_ENDPOINT_FILE is required");
  }
  let stopped = false;
  let retryMs = runtime.reconnectMinMs;
  let socket = null;
  let heartbeat = null;

  const connect = () => {
    if (stopped) {
      return;
    }
    console.log(`[mcp-bridge] connecting to ${runtime.endpoint.slice(0, 36)}...`);
    socket = new WebSocket(runtime.endpoint, {
      perMessageDeflate: false,
      handshakeTimeout: 10000
    });

    socket.on("open", () => {
      retryMs = runtime.reconnectMinMs;
      console.log("[mcp-bridge] connected");
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.ping();
        }
      }, 30000);
    });

    socket.on("message", async (data) => {
      const raw = data.toString("utf8");
      let message = null;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        console.warn("[mcp-bridge] ignore non-json message");
        return;
      }
      const messages = Array.isArray(message) ? message : [message];
      for (const item of messages) {
        const response = await handleMcpRequest(runtime, item);
        if (response && socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(response));
        }
      }
    });

    socket.on("close", (code, reason) => {
      clearInterval(heartbeat);
      heartbeat = null;
      console.warn(`[mcp-bridge] closed code=${code} reason=${reason?.toString?.() || ""}`);
      if (!stopped) {
        const delay = retryMs;
        retryMs = Math.min(retryMs * 2, runtime.reconnectMaxMs);
        setTimeout(connect, delay);
      }
    });

    socket.on("error", (error) => {
      console.warn(`[mcp-bridge] error: ${error.message}`);
    });
  };

  connect();

  const stop = () => {
    stopped = true;
    clearInterval(heartbeat);
    heartbeat = null;
    if (socket) {
      socket.close();
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return { stop };
}

if (require.main === module) {
  runBridge();
}

module.exports = {
  createToolList,
  handleMcpRequest,
  resolveRuntimeConfig,
  runBridge
};
