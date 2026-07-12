const { AGENT_REGISTRY, listCapabilities } = require("./capabilities");
const { buildMemberContext, personalizeSpeech } = require("./member-context");
const { compactQuery } = require("./media");

const HIGH_RISK_TOOLS = new Set(["family.openclaw.run", "family.homeassistant.scene"]);

function safeText(value, limit = 240) {
  return String(value || "").trim().slice(0, limit);
}

function truthyFlag(value) {
  if (value === true || value === 1) {
    return true;
  }
  return ["1", "true", "yes", "y", "confirmed", "confirm"].includes(String(value || "").trim().toLowerCase());
}

function normalizePage(value) {
  const page = safeText(value, 32).toLowerCase();
  const aliases = {
    media: "music",
    podcast: "music",
    podcasts: "music",
    device: "settings",
    setting: "settings",
    config: "settings",
    tool: "apps",
    tools: "apps",
    content: "album",
    photo: "album",
    photos: "album"
  };
  return aliases[page] || page || "ai";
}

function normalizeRole(value) {
  return safeText(value, 32).toLowerCase();
}

function normalizeAskBody(body = {}) {
  const user = body.user && typeof body.user === "object" ? body.user : {};
  const params = body.params && typeof body.params === "object" ? body.params : {};
  const utterance = safeText(
    body.utterance ||
    body.text ||
    body.query ||
    body.message ||
    body.transcript ||
    params.text ||
    params.query ||
    "",
    300
  );
  return {
    requestId: safeText(body.requestId || body.request_id || "", 80),
    traceId: safeText(body.traceId || body.trace_id || "", 96),
    sessionId: safeText(body.sessionId || body.session_id || "", 96),
    deviceId: safeText(body.deviceId || body.device_id || params.deviceId || params.device_id || "esp32-185b", 80),
    page: normalizePage(body.page || params.page || "ai"),
    inputType: safeText(body.inputType || body.input_type || "text", 24),
    utterance,
    query: safeText(body.query || params.query || "", 160),
    user: {
      id: safeText(user.id || body.memberId || body.member || body.userId || "device", 48),
      role: normalizeRole(user.role || body.role || ""),
      name: safeText(user.name || "", 48)
    },
    familyMode: safeText(body.familyMode || body.modeContext || body.mode || "", 24),
    confirmed: truthyFlag(body.confirmed || body.confirm || params.confirmed || params.confirm),
    pageState: body.pageState && typeof body.pageState === "object" ? body.pageState : {},
    deviceState: body.deviceState && typeof body.deviceState === "object" ? body.deviceState : {},
    source: safeText(body.source || "agent.ask", 48)
  };
}

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function normalizedUtterance(input) {
  return `${input.utterance} ${input.query}`.toLowerCase();
}

function agentForPage(page) {
  switch (normalizePage(page)) {
    case "music":
      return "media";
    case "settings":
      return "device";
    case "home":
      return "home";
    case "ai":
      return "general";
    case "weather":
      return "weather";
    case "schedule":
      return "schedule";
    case "english":
      return "english";
    case "album":
      return "album";
    case "apps":
      return "tools";
    default:
      return "general";
  }
}

function isSpeakerUtterance(text) {
  return includesAny(text, ["小爱", "小米音箱", "音箱", "xiaoai", "xiaomi speaker"]);
}

function isToolsUtterance(text, page) {
  if (includesAny(text, ["openclaw", "home assistant", "homeassistant", "家庭场景", "ha 场景", "nas", "工具自动化"])) {
    return true;
  }
  if (isSpeakerUtterance(text)) {
    return true;
  }
  if (agentForPage(page) !== "tools") {
    return false;
  }
  return includesAny(text, ["运行", "打开", "扫描", "诊断", "场景", "工具", "自动化"]);
}

// Return a specific domain agent id when the utterance clearly matches a
// domain, or "" when nothing specific matched. Kept separate from the page
// fallback so Home/General agents can distinguish "handoff to X" from "no
// specific domain, use my own default".
function detectSpecificDomain(input) {
  const text = normalizedUtterance(input);
  if (isToolsUtterance(text, input.page)) {
    return "tools";
  }
  if (includesAny(text, ["天气", "气温", "温度", "湿度", "空气", "下雨", "多云", "晴天", "weather"])) {
    return "weather";
  }
  if (includesAny(text, ["日程", "安排", "提醒", "待办", "完成日程", "稍后提醒", "schedule", "todo"])) {
    return "schedule";
  }
  if (includesAny(text, ["英语", "跟读", "口语", "练习", "单词", "english"])) {
    return "english";
  }
  if (includesAny(text, ["相册", "照片", "图片", "屏保", "幻灯片", "album", "photo", "slideshow"])) {
    return "album";
  }
  if (includesAny(text, ["继续播放", "继续听", "接着听", "上次没听完", "播客", "音乐", "歌曲", "故事", "下一集", "下一首", "停止播放", "暂停播放", "收藏这个"])) {
    return "media";
  }
  if (includesAny(text, ["设备", "状态", "诊断", "网络", "后端", "电池", "电量", "存储", "sd", "蓝牙", "wifi", "wi-fi"])) {
    return "device";
  }
  return "";
}

function detectRouterAgent(input) {
  return detectSpecificDomain(input) || agentForPage(input.page);
}

function isPageContextUtterance(input, pageAgent) {
  const text = normalizedUtterance(input);
  const contextual = {
    home: ["首页", "概览", "家里", "看看家里", "现在怎么样"],
    media: ["播放", "继续", "接着", "下一", "停止", "暂停", "收藏", "听"],
    device: ["看看", "检查", "刷新", "怎么样"],
    weather: ["今天怎么样", "现在怎么样", "刷新", "更新", "看看"],
    schedule: ["今天有什么", "接下来", "下一项", "完成", "推迟", "稍后", "添加"],
    english: ["开始", "继续", "下一题", "答对", "记录"],
    album: ["打开", "关闭", "开始", "停止", "下一张", "看看"],
    tools: ["看看", "检查", "刷新", "运行", "扫描"]
  };
  return includesAny(text, contextual[pageAgent] || []);
}

function isGeneralConversation(input) {
  const text = normalizedUtterance(input);
  return includesAny(text, [
    "你好", "您好", "在吗", "早上好", "下午好", "晚上好", "hello", "hi",
    "为什么", "是什么", "怎么回事", "谁是", "介绍一下", "解释一下", "解释",
    "翻译", "计算", "笑话", "聊聊天", "告诉我"
  ]);
}

function mediaQueryFromText(text) {
  const compact = compactQuery(text)
    .replace(/继续|接着|上次没听完|下一集|下一首|停止|暂停|收藏|这个|一下/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact;
}

function planMedia(input) {
  const text = normalizedUtterance(input);
  const baseArgs = {
    deviceId: input.deviceId,
    text: input.utterance || input.query
  };
  if (input.pageState.currentTrackId) {
    baseArgs.trackId = input.pageState.currentTrackId;
  }

  if (includesAny(text, ["继续", "接着", "上次没听完", "没听完", "resume", "continue"])) {
    return {
      intent: "media.resume",
      confidence: 0.95,
      tool: "family.media.resume",
      args: baseArgs,
      speech: "好的，继续播放上次没听完的内容。",
      display: { page: "music", toast: "继续播放" }
    };
  }
  if (includesAny(text, ["下一集", "下一首", "下一个", "next"])) {
    return {
      intent: "media.next",
      confidence: 0.95,
      tool: "family.media.next",
      args: baseArgs,
      speech: "好的，切到下一集。",
      display: { page: "music", toast: "下一集" }
    };
  }
  if (includesAny(text, ["停止", "暂停", "关掉", "stop", "pause"])) {
    return {
      intent: "media.stop",
      confidence: 0.95,
      tool: "family.media.stop",
      args: baseArgs,
      speech: "好的，先停下来。",
      display: { page: "music", toast: "停止播放" }
    };
  }
  if (includesAny(text, ["收藏", "喜欢这个", "favorite", "like this"])) {
    return {
      intent: "media.favorite",
      confidence: 0.9,
      tool: "family.media.favorite",
      args: baseArgs,
      speech: "好的，收藏当前节目。",
      display: { page: "music", toast: "收藏" }
    };
  }

  const query = input.query || mediaQueryFromText(input.utterance);
  if (query || includesAny(text, ["播放", "听", "来一首", "play"])) {
    return {
      intent: "media.play",
      confidence: query ? 0.86 : 0.68,
      tool: "family.media.play",
      args: {
        ...baseArgs,
        query
      },
      speech: query ? `好的，帮你找${query}。` : "好的，打开服务器媒体。",
      display: { page: "music", toast: "播放媒体" }
    };
  }

  return {
    intent: "media.help",
    confidence: 0.45,
    tool: "",
    args: {},
    speech: "在音乐页可以说继续、下一集、停止、收藏，或者说播放某个节目。",
    display: { page: "music", toast: "音乐助手" }
  };
}

function planDevice(input) {
  const text = normalizedUtterance(input);
  const args = {
    deviceId: input.deviceId
  };
  if (includesAny(text, ["诊断", "报告", "日志", "异常", "重启", "panic", "白屏"])) {
    return {
      intent: "device.diagnostics",
      confidence: 0.9,
      tool: "family.device.diagnostics",
      args,
      speech: "我来做一次设备诊断。",
      display: { page: "settings", toast: "设备诊断" }
    };
  }
  return {
    intent: "device.status",
    confidence: includesAny(text, ["状态", "网络", "电池", "电量", "存储", "后端", "wifi", "wi-fi", "蓝牙"]) ? 0.88 : 0.7,
    tool: "family.device.status",
    args,
    speech: "我看一下当前设备状态。",
    display: { page: "settings", toast: "设备状态" }
  };
}

function planWeather(input) {
  const forceRefresh = includesAny(normalizedUtterance(input), ["刷新天气", "更新天气", "刷新一下", "更新一下", "refresh weather"]);
  return {
    intent: "weather.today",
    confidence: 0.9,
    tool: "family.weather.today",
    args: { forceRefresh },
    speech: "我看一下今天的天气。",
    display: { page: "weather", toast: "今日天气" }
  };
}

function extractScheduleTitle(text) {
  return safeText(
    String(text || "")
      .replace(/提醒我|加个日程|添加日程|新增日程|记一下|记个|帮我|请/g, " ")
      .replace(/\badd schedule\b|\badd reminder\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
    80
  );
}

const CHINESE_DIGITS = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 };

// Pull the number of correctly-answered phrases from an English record
// utterance such as "答对3句" or "答对了两句". Clamped to 0-5 to match the
// backend english progress scale; defaults to 1 when no number is present.
function extractCorrectCount(text) {
  const value = String(text || "");
  const arabic = value.match(/(\d+)/);
  if (arabic) {
    return Math.max(0, Math.min(Number(arabic[1]) || 0, 5));
  }
  const chinese = value.match(/[零一两二三四五]/);
  if (chinese) {
    return CHINESE_DIGITS[chinese[0]] ?? 1;
  }
  return 1;
}

function planSchedule(input) {
  const text = normalizedUtterance(input);
  const baseArgs = {
    deviceId: input.deviceId
  };
  if (input.pageState.currentScheduleId) {
    baseArgs.id = input.pageState.currentScheduleId;
  }
  if (includesAny(text, ["完成", "做完", "已做", "done", "complete"])) {
    return {
      intent: "schedule.complete",
      confidence: 0.9,
      tool: "family.schedule.complete",
      args: baseArgs,
      speech: "好的，我把这项日程标记为完成。",
      display: { page: "schedule", toast: "完成日程" }
    };
  }
  if (includesAny(text, ["稍后", "等会", "延后", "snooze", "remind later"])) {
    return {
      intent: "schedule.snooze",
      confidence: 0.86,
      tool: "family.schedule.snooze",
      args: {
        ...baseArgs,
        minutes: 10
      },
      speech: "好的，稍后再提醒。",
      display: { page: "schedule", toast: "稍后提醒" }
    };
  }
  if (includesAny(text, ["提醒我", "加个日程", "添加日程", "新增日程", "记一下", "记个", "add schedule", "add reminder"])) {
    const title = extractScheduleTitle(text);
    return {
      intent: "schedule.add",
      confidence: 0.82,
      tool: "family.schedule.add",
      args: {
        ...baseArgs,
        title
      },
      speech: title ? `好的，我记下日程：${title}。` : "好的，请告诉我要添加的日程内容。",
      display: { page: "schedule", toast: "添加日程" }
    };
  }
  return {
    intent: "schedule.today",
    confidence: 0.86,
    tool: "family.schedule.today",
    args: baseArgs,
    speech: "我看一下今天的日程。",
    display: { page: "schedule", toast: "今日日程" }
  };
}

function planEnglish(input) {
  const text = normalizedUtterance(input);
  const args = {
    deviceId: input.deviceId,
    memberId: input.user.id
  };
  if (includesAny(text, ["答对", "记录练习", "记录一下", "完成练习", "练习结果", "record", "got it right"])) {
    return {
      intent: "english.record",
      confidence: 0.88,
      tool: "family.english.record",
      args: {
        ...args,
        correct: extractCorrectCount(text)
      },
      speech: "好的，我记录这次英语练习结果。",
      display: { page: "english", toast: "记录练习" }
    };
  }
  if (includesAny(text, ["开始", "跟读", "练习", "口语", "start", "practice", "speak"])) {
    return {
      intent: "english.start",
      confidence: 0.9,
      tool: "family.english.start",
      args,
      speech: "好的，开始英语口语练习。",
      display: { page: "english", toast: "开始英语" }
    };
  }
  return {
    intent: "english.status",
    confidence: 0.82,
    tool: "family.english.status",
    args,
    speech: "我看一下英语练习状态。",
    display: { page: "english", toast: "英语状态" }
  };
}

function planAlbum(input) {
  const text = normalizedUtterance(input);
  if (includesAny(text, ["停止", "关闭", "退出", "stop", "off"])) {
    return {
      intent: "album.slideshow_stop",
      confidence: 0.9,
      tool: "family.album.slideshow_stop",
      args: {},
      speech: "好的，停止家庭相册。",
      display: { page: "album", toast: "停止相册" }
    };
  }
  if (includesAny(text, ["开始", "播放", "打开", "屏保", "幻灯片", "start", "play", "slideshow"])) {
    return {
      intent: "album.slideshow_start",
      confidence: 0.88,
      tool: "family.album.slideshow_start",
      args: {},
      speech: "好的，开始播放家庭相册。",
      display: { page: "album", toast: "开始相册" }
    };
  }
  return {
    intent: "album.status",
    confidence: 0.8,
    tool: "family.album.status",
    args: {},
    speech: "我看一下相册和屏保状态。",
    display: { page: "album", toast: "相册状态" }
  };
}

function openClawTargetFromText(input, text) {
  const hinted = safeText(input.pageState.openclawTarget || input.pageState.target || "", 48);
  if (hinted) {
    return hinted;
  }
  if (includesAny(text, ["诊断", "diagnostic", "diagnostics", "日志", "检查"])) {
    return "diagnostics";
  }
  if (includesAny(text, ["音乐", "播客", "music", "podcast"])) {
    return "music";
  }
  return "default";
}

function sceneEntityFromText(input, text) {
  const hinted = safeText(input.pageState.sceneEntityId || input.pageState.entityId || "", 96);
  if (hinted) {
    return hinted;
  }
  if (includesAny(text, ["晚安", "睡觉", "good night"])) {
    return "scene.good_night";
  }
  if (includesAny(text, ["早晨", "早安", "morning"])) {
    return "scene.morning";
  }
  if (includesAny(text, ["离家", "出门", "away"])) {
    return "scene.away";
  }
  if (includesAny(text, ["回家", "到家", "home"])) {
    return "scene.home";
  }
  if (includesAny(text, ["晚间", "傍晚", "evening"])) {
    return "scene.evening";
  }
  return "scene.family";
}

function speakerCommandText(utterance) {
  return safeText(
    String(utterance || "")
      .replace(/(帮我|请)/g, "")
      .replace(/(让|叫|用|通过|告诉|对|跟)?(小爱同学|小爱|小米音箱|音箱)(同学)?/g, "")
      .replace(/^[,，:：\s]+/, "")
      .trim(),
    240
  );
}

function speakerSayText(utterance) {
  const match = String(utterance || "").match(/(播报|念|读)(一下|一句|一遍)?[:：,，]?\s*(.+)$/);
  return safeText(match ? match[3] : speakerCommandText(utterance), 240);
}

function planSpeaker(input, text) {
  if (includesAny(text, ["音量", "声音", "大声", "小声", "调高", "调低", "volume"])) {
    const num = String(input.utterance).match(/(\d+)/);
    const level = num ? Number(num[1]) : (includesAny(text, ["大声", "调高", "更大", "大一点"]) ? 80 : 20);
    return {
      intent: "speaker.volume",
      confidence: 0.86,
      tool: "family.speaker.volume",
      args: { level },
      speech: `好的，把音箱音量调到 ${level}。`,
      display: { page: "apps", toast: "音箱音量" }
    };
  }
  if (includesAny(text, ["暂停", "停一下", "别放了", "停止播放", "pause"])) {
    return {
      intent: "speaker.pause",
      confidence: 0.85,
      tool: "family.speaker.pause",
      args: {},
      speech: "好的，让音箱暂停。",
      display: { page: "apps", toast: "音箱暂停" }
    };
  }
  if (includesAny(text, ["继续播放", "接着放", "继续放", "resume"])) {
    return {
      intent: "speaker.play",
      confidence: 0.82,
      tool: "family.speaker.play",
      args: {},
      speech: "好的，让音箱继续播放。",
      display: { page: "apps", toast: "音箱播放" }
    };
  }
  if (includesAny(text, ["播报", "念", "读一下", "读一遍"])) {
    const sayText = speakerSayText(input.utterance);
    return {
      intent: "speaker.say",
      confidence: 0.84,
      tool: "family.speaker.say",
      args: { text: sayText },
      speech: sayText ? `好的，让音箱说：${sayText}` : "请告诉我要让音箱说什么。",
      display: { page: "apps", toast: "音箱播报" }
    };
  }
  const cmd = speakerCommandText(input.utterance);
  return {
    intent: "speaker.command",
    confidence: cmd ? 0.8 : 0.5,
    tool: "family.speaker.command",
    args: { text: cmd },
    speech: cmd ? `好的，让小爱${cmd}。` : "请告诉我要让音箱做什么。",
    display: { page: "apps", toast: "音箱指令" }
  };
}

function planTools(input) {
  const text = normalizedUtterance(input);
  if (isSpeakerUtterance(text)) {
    return planSpeaker(input, text);
  }
  if (includesAny(text, ["home assistant", "homeassistant", "ha 场景", "家庭场景", "打开场景", "开启场景", "场景"])) {
    return {
      intent: "tools.homeassistant.scene",
      confidence: 0.9,
      tool: "family.homeassistant.scene",
      args: {
        entityId: sceneEntityFromText(input, text)
      },
      speech: "我准备打开家庭场景。",
      display: { page: "apps", toast: "家庭场景" }
    };
  }
  if (includesAny(text, ["nas", "扫描音乐", "扫描播客", "媒体扫描", "音乐扫描"])) {
    return {
      intent: "tools.nas.music_scan",
      confidence: 0.88,
      tool: "family.nas.music.scan",
      args: {},
      speech: "我来扫描 NAS 或服务器音乐。",
      display: { page: "apps", toast: "NAS 扫描" }
    };
  }
  if (includesAny(text, ["openclaw", "运行", "启动", "执行", "诊断", "自动化"])) {
    const target = openClawTargetFromText(input, text);
    return {
      intent: "tools.openclaw.run",
      confidence: includesAny(text, ["openclaw", "诊断", "运行"]) ? 0.9 : 0.72,
      tool: "family.openclaw.run",
      args: {
        target
      },
      speech: `我准备运行 OpenClaw ${target} 任务。`,
      display: { page: "apps", toast: "OpenClaw" }
    };
  }
  return {
    intent: "tools.status",
    confidence: 0.75,
    tool: "family.tools.status",
    args: {},
    speech: "我看一下家庭工具状态。",
    display: { page: "apps", toast: "工具状态" }
  };
}

function memoryTextFromUtterance(utterance) {
  return safeText(
    utterance
      .replace(/^记住/, "")
      .replace(/^帮我记住/, "")
      .replace(/^请记住/, "")
      .replace(/^remember/i, "")
      .trim(),
    240
  );
}

function contentTypeFromText(text) {
  if (includesAny(text, ["故事", "睡前", "story", "bedtime"])) {
    return "story";
  }
  if (includesAny(text, ["游戏", "小游戏", "game"])) {
    return "game";
  }
  if (includesAny(text, ["英语", "english"])) {
    return "english";
  }
  if (includesAny(text, ["相册", "照片", "图片", "album", "photo"])) {
    return "album";
  }
  if (includesAny(text, ["播客", "podcast", "音频"])) {
    return "podcast";
  }
  return "";
}

// Cross-page general intents that do not belong to a single first-level page:
// memory write, memory search and content recommendation. Returns a plan or
// null so both General and Home agents can reuse the same logic.
function planGeneralIntents(input) {
  const text = normalizedUtterance(input);

  if (includesAny(text, ["记住", "remember"])) {
    const memoryText = memoryTextFromUtterance(input.utterance);
    if (memoryText) {
      return {
        intent: "memory.remember",
        confidence: 0.82,
        tool: "family.memory.remember",
        args: {
          text: memoryText,
          memberId: input.user.id,
          visibility: "family",
          tags: ["agent"]
        },
        speech: "好的，我会把这条家庭记忆保存下来。",
        display: { page: "ai", toast: "家庭记忆" }
      };
    }
  }

  if (includesAny(text, ["记得", "记过", "查记忆", "查一下记忆", "家庭记忆", "记忆里", "想起", "回忆", "recall", "remember what", "what did"])) {
    return {
      intent: "memory.search",
      confidence: 0.8,
      tool: "family.memory.search",
      args: {
        memberId: input.user.role === "parent" ? "" : input.user.id
      },
      speech: "我查一下家庭记忆。",
      display: { page: "ai", toast: "家庭记忆" }
    };
  }

  if (includesAny(text, ["推荐", "recommend", "讲个", "讲故事", "来个故事", "来点", "睡前", "无聊", "随便放", "随便来", "有什么好听", "有什么好玩", "有什么推荐"])) {
    const type = contentTypeFromText(text);
    return {
      intent: "content.recommend",
      confidence: type ? 0.84 : 0.7,
      tool: "family.content.recommend",
      args: {
        type,
        memberId: input.user.id
      },
      speech: type ? `我给你推荐一个${type === "story" ? "故事" : "内容"}。` : "我给你推荐一个家庭内容。",
      display: { page: "ai", toast: "内容推荐" }
    };
  }

  return null;
}

// Hand off to a specific domain agent's plan. Returns null when the domain is
// not a recognized first-level agent, so the caller can fall back to its own
// default (general help or home overview).
function routeToDomain(routed, input, from) {
  const planners = {
    media: planMedia,
    device: planDevice,
    weather: planWeather,
    schedule: planSchedule,
    english: planEnglish,
    album: planAlbum,
    tools: planTools
  };
  const planner = planners[routed];
  if (!planner) {
    return null;
  }
  return { ...planner(input), handoff: { from, to: routed } };
}

function planGeneral(input) {
  const general = planGeneralIntents(input);
  if (general) {
    return general;
  }
  const routed = routeToDomain(detectSpecificDomain(input), input, "general");
  if (routed) {
    return routed;
  }
  return {
    intent: "general.help",
    confidence: 0.4,
    tool: "",
    args: {},
    speech: "我现在可以帮你控制服务器播客、查看设备状态、推荐家庭内容，或者记录家庭记忆。",
    display: { page: "ai", toast: "家庭助手" }
  };
}

function planHome(input) {
  const general = planGeneralIntents(input);
  if (general) {
    return general;
  }
  const routed = routeToDomain(detectSpecificDomain(input), input, "home");
  if (routed) {
    return routed;
  }
  return {
    intent: "home.overview",
    confidence: 0.8,
    tool: "family.home.overview",
    args: { deviceId: input.deviceId },
    speech: "我给你看一下家里现在的情况。",
    display: { page: "home", toast: "首页概览" }
  };
}

function planForAgent(agentId, input) {
  switch (agentId) {
    case "media":
      return planMedia(input);
    case "device":
      return planDevice(input);
    case "weather":
      return planWeather(input);
    case "schedule":
      return planSchedule(input);
    case "english":
      return planEnglish(input);
    case "album":
      return planAlbum(input);
    case "tools":
      return planTools(input);
    case "home":
      return planHome(input);
    case "general":
      return planGeneral(input);
    default:
      return {
        intent: `${agentId}.planned`,
        confidence: 0.3,
        tool: "",
        args: {},
        speech: "这个页面的专属 Agent 还在建设中，我会先保持当前页面可用。",
        display: { page: input.page, toast: "Agent 规划中" }
      };
  }
}

function pickDefaultAgent(input, explicitAgent, pageAgent) {
  if (explicitAgent) {
    return explicitAgent;
  }
  // Cross-cutting general intents (remember / recall / recommend) take priority
  // over domain-noun routing, so "推荐睡前故事" is recommendation, not media
  // playback. Home page keeps its own overview-capable agent.
  if (planGeneralIntents(input)) {
    return pageAgent === "home" ? "home" : "general";
  }
  const specificAgent = detectSpecificDomain(input);
  if (specificAgent) {
    return specificAgent;
  }
  if (pageAgent !== "general" && isPageContextUtterance(input, pageAgent)) {
    return pageAgent;
  }
  if (isGeneralConversation(input)) {
    return "general";
  }
  // An unknown utterance is not a page command merely because that page is
  // visible. Route it to the general fallback so ASR truncation cannot turn an
  // open question into an unrelated deterministic action (for example a Home
  // overview). Explicit page phrases were already accepted above.
  return "general";
}

async function planAgentRequest(state, config, body = {}) {
  const input = normalizeAskBody(body);
  const explicitAgent = safeText(body.agent || body.agentId || "", 32);
  const pageAgent = agentForPage(input.page);
  const defaultAgent = pickDefaultAgent(input, explicitAgent, pageAgent);
  const plan = planForAgent(defaultAgent, input);
  const registry = AGENT_REGISTRY.find((agent) => agent.id === defaultAgent) || AGENT_REGISTRY.find((agent) => agent.id === "general");
  const memberContext = buildMemberContext(state, input, defaultAgent);
  input.familyMode = memberContext.familyMode;
  input.user = {
    id: memberContext.member.id,
    role: memberContext.member.role || input.user.role,
    name: memberContext.member.name || input.user.name
  };
  plan.speech = personalizeSpeech(plan.speech, memberContext);
  const handoff = plan.handoff || (pageAgent !== defaultAgent ? { from: pageAgent, to: defaultAgent } : null);
  const requiresConfirmation = Boolean(plan.tool && HIGH_RISK_TOOLS.has(plan.tool) && !input.confirmed);
  const handled = Boolean(plan.tool);
  const args = {
    ...(plan.args || {}),
    deviceId: input.deviceId
  };
  if (input.confirmed) {
    args.confirmed = true;
  }
  return {
    requestId: input.requestId,
    traceId: input.traceId,
    sessionId: input.sessionId,
    agent: registry?.id || defaultAgent,
    page: input.page,
    intent: plan.intent,
    confidence: plan.confidence,
    tool: plan.tool,
    args,
    context: {
      source: input.source,
      page: input.page,
      inputType: input.inputType,
      memberId: input.user.id,
      role: input.user.role,
      modeContext: input.familyMode,
      confirmed: input.confirmed,
      user: input.user,
      requestId: input.requestId,
      traceId: input.traceId
    },
    memberContext,
    speech: plan.speech,
    display: plan.display || {},
    handoff,
    handled,
    fallbackReason: handled ? "" : (plan.intent === "general.help" ? "general_query" : "unsupported_intent"),
    requiresConfirmation,
    confirmationRequired: requiresConfirmation,
    capabilities: listCapabilities()
  };
}

module.exports = {
  agentForPage,
  normalizeAskBody,
  planAgentRequest
};
