const COMPONENT_SCHEMA = {
  version: 2,
  schemaVersion: 2,
  deviceProfile: "waveshare-esp32-s3-touch-lcd-1.85b",
  fallbackPage: "home",
  components: [
    "hero_status",
    "app_grid",
    "big_button",
    "card",
    "list",
    "progress_ring",
    "media_player",
    "quiz_card",
    "voice_orb",
    "toast",
    "dialog",
    "text",
    "button",
    "progress",
    "spacer"
  ],
  actions: [
    "ai.toggle",
    "music.play_pause",
    "music.next",
    "music.set_source",
    "music.server.play_pause",
    "music.server.next",
    "music.server.cache",
    "music.sd.play_pause",
    "music.sd.next",
    "music.sd.scan",
    "screensaver.start",
    "screensaver.stop",
    "english.start",
    "schedule.complete",
    "schedule.snooze",
    "app.open",
    "openclaw.run",
    "content.recommend",
    "memory.add",
    "homeassistant.call",
    "homeassistant.scene",
    "nas.music.scan",
    "family.mode",
    "family.member.status",
    "voice.intent",
    "toast",
    "dialog.open"
  ],
  layouts: ["watch-home", "two-column", "list", "status", "simple"],
  themeTokens: {
    bg: "#080b10",
    panel: "#141b24",
    accent: "#63e6be",
    blue: "#6aa8ff",
    warm: "#ffc857",
    text: "#f3f7fb",
    muted: "#94a3b2"
  },
  limits: {
    maxComponents: 16,
    maxItems: 8,
    maxTextLength: 96
  }
};

function text(id, value, style = "body") {
  return { type: "text", id, text: value, style };
}

function button(id, label, action, params = {}, style = "primary") {
  return { type: "button", id, text: label, action: { type: action, params }, style };
}

function page(pageId, title, layout, children) {
  return {
    version: 2,
    schemaVersion: 2,
    deviceProfile: "waveshare-esp32-s3-touch-lcd-1.85b",
    capabilities: COMPONENT_SCHEMA.components,
    themeTokens: COMPONENT_SCHEMA.themeTokens,
    fallbackPage: pageId === "home" ? "home" : "home",
    page: pageId,
    title,
    layout,
    children
  };
}

function home(summary) {
  return page("home", "家庭中控", "watch-home", [
    text("clock", "{{time}}", "hero-time"),
    text("weather", summary.weather.summary, "muted"),
    text("schedule", `${summary.schedule.next.time} ${summary.schedule.next.title}`, "body"),
    button("ask_ai", "问 AI", "ai.toggle", {}, "accent"),
    button("music", summary.music.activeLabel, "music.play_pause", {}, summary.music.server.playing || summary.music.sd.playing ? "active" : "primary"),
    button("english", `英语 ${summary.english.progress}`, "english.start", {}, "secondary"),
    button("apps", "应用", "app.open", { id: "apps" }, "secondary")
  ]);
}

function music(summary) {
  const active = summary.music.activeSource === "sd" ? summary.music.sd : summary.music.server;
  return page("music", "音乐中心", "two-column", [
    button("music_sd", "SD 卡音乐", "music.set_source", { source: "sd" }, summary.music.activeSource === "sd" ? "active" : "secondary"),
    button("music_server", "服务器播客", "music.set_source", { source: "server" }, summary.music.activeSource === "server" ? "active" : "secondary"),
    text("music_title", active.title, "title"),
    text("music_artist", `${active.artist} | ${active.source}`, "muted"),
    { type: "progress", id: "volume", value: active.volume, min: 0, max: 100, label: `音量 ${active.volume}` },
    button("play_pause", active.playing ? "暂停" : "播放", "music.play_pause", {}, active.playing ? "active" : "primary"),
    button("next", summary.music.activeSource === "sd" ? "下一首" : "下一集", "music.next"),
    ...(summary.music.activeSource === "server" && active.cacheable ? [
      button("cache", "缓存到 SD", "music.server.cache", {}, "secondary")
    ] : [])
  ]);
}

function schedule(summary) {
  return page("schedule", "日程", "list", [
    text("next", `${summary.schedule.next.time} ${summary.schedule.next.title}`, "title"),
    {
      type: "list",
      id: "today",
      items: summary.schedule.today.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: `${item.time} ${item.done ? "已完成" : "待处理"}`
      }))
    },
    button("complete", "完成下一项", "schedule.complete", { id: summary.schedule.next.id }),
    button("snooze", "稍后提醒", "schedule.snooze", { id: summary.schedule.next.id, minutes: 10 }, "secondary")
  ]);
}

function english(summary) {
  const lessons = (summary.content?.english || []).slice(0, 3);
  return page("english", "英语口语", "simple", [
    text("topic", summary.english.topic, "title"),
    text("prompt", summary.english.prompt, "body"),
    { type: "progress", id: "progress", value: Number(String(summary.english.progress).split("/")[0] || 0), min: 0, max: 5, label: summary.english.progress },
    text("score", `口语分 ${summary.english.score}`, "muted"),
    {
      type: "list",
      id: "english_lessons",
      items: lessons.length > 0 ? lessons.map((entry) => ({
        id: entry.id,
        title: entry.title,
        subtitle: entry.subtitle || entry.packId,
        action: { type: "english.start", params: { id: entry.id } }
      })) : [
        {
          id: "empty",
          title: "暂无课程包",
          subtitle: "请在伴侣页导入英语素材"
        }
      ]
    },
    button("start", "开始练习", "english.start")
  ]);
}

function apps(summary) {
  const gameItems = (summary.content?.games || []).slice(0, 4).map((entry) => ({
    id: entry.id,
    label: entry.title,
    subtitle: entry.subtitle || entry.packId,
    action: { type: "app.open", params: { id: entry.entry || entry.id } }
  }));
  return page("apps", "应用", "list", [
    {
      type: "app_grid",
      id: "family_tools",
      // First-class pages such as settings, weather, music, English, and album are not app-grid items.
      items: [
        ...(gameItems.length > 0 ? gameItems : [
          { id: "tap", label: "小游戏", subtitle: "Focus Tap", action: { type: "app.open", params: { id: "tap" } } }
        ]),
        { id: "openclaw", label: "OpenClaw", subtitle: "远程程序", action: { type: "openclaw.run", params: { target: "default" } } },
        { id: "ha", label: "HA 场景", subtitle: "家庭控制", action: { type: "homeassistant.scene", params: { entityId: "scene.family" } } },
        { id: "nas", label: "NAS 扫描", subtitle: "媒体索引", action: { type: "nas.music.scan", params: {} } }
      ]
    }
  ]);
}

function album(summary) {
  const items = (summary.content?.albums || summary.content?.recent || []).filter((entry) => entry.type === "album").slice(0, 4);
  return page("album", "相册", "list", [
    text("album_status", `相册 ${items.length} 项 | 资源包 ${summary.content?.packCount || 0}`, "muted"),
    {
      type: "list",
      id: "album_items",
      items: items.length > 0 ? items.map((entry) => ({
        id: entry.id,
        title: entry.title,
        subtitle: `屏保资源 | ${entry.packId}`,
        action: { type: "screensaver.start", params: { id: entry.id } }
      })) : [
        {
          id: "empty",
          title: "暂无相册",
          subtitle: "请在伴侣页导入照片"
        }
      ]
    },
    button("slideshow", "开始屏保", "screensaver.start", {}, "accent"),
    button("stop", "停止屏保", "screensaver.stop", {}, "secondary")
  ]);
}

const content = album;

function settings(summary) {
  return page("settings", "设置", "status", [
    text("backend", `${summary.backend.name} ${summary.backend.version}`, "body"),
    text("url", summary.backend.publicBaseUrl, "muted"),
    text("mode", `家庭模式 ${summary.familyMode}`, "body"),
    text("security", `拒绝 ${summary.security?.deniedCount || 0} 次`, "muted"),
    text("devices", `设备 ${summary.devices?.count || 0} 台`, "muted"),
    text("uptime", `运行 ${summary.backend.uptimeSec}s`, "muted")
  ]);
}

function family(summary) {
  return page("family", "家庭", "list", [
    text("mode", `当前 ${summary.familyMode}`, "title"),
    {
      type: "list",
      id: "members",
      items: (summary.family.members || []).map((member) => ({
        id: member.id,
        title: member.name,
        subtitle: `${member.role} | ${member.status}`
      }))
    },
    button("default", "默认", "family.mode", { mode: "默认" }),
    button("child", "儿童", "family.mode", { mode: "儿童" }, "secondary"),
    button("guest", "访客", "family.mode", { mode: "访客" }, "secondary")
  ]);
}

const BUILDERS = {
  home,
  music,
  schedule,
  english,
  apps,
  album,
  content,
  settings,
  family
};

function buildPage(pageId, summary) {
  const builder = BUILDERS[pageId] || BUILDERS.home;
  return builder(summary);
}

module.exports = {
  COMPONENT_SCHEMA,
  buildPage
};
