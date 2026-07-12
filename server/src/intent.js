function normalizeText(text) {
  return String(text || "").trim().toLowerCase();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function resolveVoiceIntent(input, defaults = {}) {
  const text = normalizeText(input);
  if (!text) {
    return { matched: false, reason: "empty intent text" };
  }

  if (includesAny(text, ["下一首", "下一集", "next song", "next podcast"])) {
    return { matched: true, action: "music.next", params: {}, reason: "music next" };
  }
  if (includesAny(text, ["播放音乐", "暂停音乐", "播放播客", "暂停播客", "music", "podcast"])) {
    return { matched: true, action: "music.play_pause", params: {}, reason: "music play pause" };
  }
  if (includesAny(text, ["英语", "口语", "跟读", "english"])) {
    return { matched: true, action: "english.start", params: {}, reason: "english practice" };
  }
  if (includesAny(text, ["推荐", "内容", "故事", "听故事", "学什么", "看什么"])) {
    const type = includesAny(text, ["故事", "听故事"]) ? "story" :
      (includesAny(text, ["英语", "english"]) ? "english" :
        (includesAny(text, ["播客", "podcast"]) ? "podcast" : ""));
    return { matched: true, action: "content.recommend", params: { type }, reason: "content recommendation" };
  }
  if (includesAny(text, ["记住", "帮我记", "remember"])) {
    const cleaned = text.replace(/^(请)?(帮我)?记住/, "").replace(/^remember/, "").trim();
    return {
      matched: true,
      action: "memory.add",
      params: { text: cleaned || input, source: "voice.intent" },
      reason: "family memory"
    };
  }
  if (includesAny(text, ["屏保", "相册", "照片", "album", "screensaver"])) {
    return { matched: true, action: "screensaver.start", params: {}, reason: "screensaver" };
  }
  if (includesAny(text, ["openclaw", "open claw", "爪", "机械臂"])) {
    return {
      matched: true,
      action: "openclaw.run",
      params: { target: defaults.target || "default" },
      reason: "openclaw"
    };
  }
  if (includesAny(text, ["开灯", "打开灯", "turn on light"])) {
    return {
      matched: true,
      action: "homeassistant.call",
      params: {
        domain: "light",
        service: "turn_on",
        serviceData: { entity_id: defaults.entityId || defaults.entity_id || "light.family" }
      },
      reason: "home assistant light on"
    };
  }
  if (includesAny(text, ["关灯", "关闭灯", "turn off light"])) {
    return {
      matched: true,
      action: "homeassistant.call",
      params: {
        domain: "light",
        service: "turn_off",
        serviceData: { entity_id: defaults.entityId || defaults.entity_id || "light.family" }
      },
      reason: "home assistant light off"
    };
  }
  if (includesAny(text, ["回家模式", "家庭模式", "默认模式"])) {
    return { matched: true, action: "family.mode", params: { mode: "默认" }, reason: "family mode default" };
  }
  if (includesAny(text, ["儿童模式", "孩子模式"])) {
    return { matched: true, action: "family.mode", params: { mode: "儿童" }, reason: "family mode child" };
  }
  if (includesAny(text, ["访客模式", "客人模式"])) {
    return { matched: true, action: "family.mode", params: { mode: "访客" }, reason: "family mode guest" };
  }

  return { matched: false, reason: "no safe intent mapping" };
}

module.exports = {
  resolveVoiceIntent
};
