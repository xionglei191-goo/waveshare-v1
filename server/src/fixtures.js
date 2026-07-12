function createInitialState() {
  return {
    schemaVersion: 1,
    weather: {
      summary: "多云 26C",
      condition: "多云",
      temperature: 26,
      humidity: 68,
      air: "空气 优",
      apparentTemperature: 26,
      weatherCode: 2,
      provider: "mock",
      airQuality: { aqi: 35, pm25: 12.5, level: "优" },
      forecast: {
        tonight: { condition: "多云", weatherCode: 2, temperature: 24 },
        tomorrow: { condition: "阵雨", weatherCode: 80, high: 29, low: 22 }
      },
      location: "家",
      updatedAt: new Date().toISOString()
    },
    schedule: [
      { id: "evt_english", title: "孩子英语跟读", time: "20:00", note: "今日主题口语", done: false },
      { id: "evt_music", title: "晚间音乐", time: "21:00", note: "家庭歌单/播客", done: false },
      { id: "evt_tomorrow", title: "明早出门提醒", time: "明天 08:00", note: "天气、书包、钥匙", done: false }
    ],
    music: {
      activeSource: "server",
      sd: {
        available: false,
        playing: false,
        title: "SD 卡音乐",
        artist: "本地文件",
        source: "SD 卡",
        detail: "等待 ESP32 SD 驱动",
        volume: 45,
        currentIndex: 0,
        tracks: [
          { title: "Morning Walk", artist: "Local Track", durationSec: 198 },
          { title: "Bedtime Story", artist: "Family SD", durationSec: 420 }
        ]
      },
      server: {
        available: true,
        playing: false,
        title: "Family Podcast",
        artist: "Home Server",
        source: "服务器播客",
        detail: "局域网模拟内容",
        volume: 45,
        currentIndex: 0,
        tracks: [
          { title: "Family Podcast", artist: "Home Server", durationSec: 900 },
          { title: "Evening Jazz", artist: "Home Radio", durationSec: 1800 },
          { title: "Kids English Talk", artist: "AI Practice", durationSec: 720 }
        ]
      }
    },
    english: {
      topic: "Daily Talk",
      prompt: "Tell Xiaozhi one thing you did today.",
      progress: "0/5",
      score: 0,
      lastStartedAt: null,
      history: []
    },
    notifications: [
      { id: "n_backend", title: "后端已启动", message: "家庭中控 API 可用", level: "info", createdAt: new Date().toISOString() }
    ],
    apps: [
      { id: "openclaw", title: "OpenClaw", subtitle: "远程程序", action: "openclaw.run" },
      { id: "tap", title: "Focus Tap", subtitle: "本地小游戏", action: "app.open" },
      { id: "ha", title: "Home Assistant", subtitle: "家庭控制", action: "homeassistant.scene", params: { entityId: "scene.family" } },
      { id: "nas", title: "NAS 音乐", subtitle: "扫描播客/音乐", action: "nas.music.scan" }
    ],
    screensaver: {
      active: false,
      mode: "album",
      images: [],
      updatedAt: new Date().toISOString()
    },
    resources: {
      manifestVersion: "2026.07.02",
      version: 1,
      deviceProfile: "waveshare-esp32-s3-touch-lcd-1.85b"
    },
    content: {
      catalog: [],
      packs: [],
      recommendations: [],
      lastSeedAt: null,
      lastImportAt: null
    },
    memory: {
      items: [],
      lastUpdatedAt: null
    },
    aiRuntime: {
      deviceContexts: {},
      traces: [],
      stats: {
        turns: 0,
        handled: 0,
        fallback: 0,
        failed: 0,
        lastTurnAt: null
      }
    },
    learning: {
      records: [],
      lastRecordAt: null
    },
    media: {
      serverProgress: [],
      onlineTracks: [],
      searchHistory: [],
      podcastFeeds: [],
      podcastEpisodes: [],
      favorites: [],
      playbackHistory: [],
      queue: {
        items: [],
        currentId: "",
        updatedAt: null
      }
    },
    sync: {
      events: [],
      stats: {
        received: 0,
        lastPushAt: null
      }
    },
    deviceCommands: {
      queue: [],
      history: [],
      stats: {
        created: 0,
        acked: 0,
        rejected: 0,
        lastCreatedAt: null,
        lastAckAt: null
      }
    },
    familyMode: "默认",
    family: {
      activeMembers: {
        默认: "parent",
        儿童: "child",
        访客: "guest"
      },
      members: [
        {
          id: "parent", name: "家长", role: "parent", status: "online",
          profile: { preferredName: "家长", ageGroup: "adult", locale: "zh-CN", timezone: "Asia/Shanghai", interests: [], avoidTopics: [], accessibility: [] },
          persona: { assistantName: "小智", addressAs: "家长", tone: "自然、可靠、简洁", verbosity: "brief", traits: ["可靠", "自然", "尊重"], instructions: "" },
          memoryPolicy: { enabled: true, maxContextItems: 10, includeFamilyMemory: true, includeLearning: true, retentionDays: 730 },
          updatedAt: new Date().toISOString()
        },
        {
          id: "child", name: "孩子", role: "child", status: "home",
          profile: { preferredName: "孩子", ageGroup: "child", locale: "zh-CN", timezone: "Asia/Shanghai", interests: [], avoidTopics: [], accessibility: [] },
          persona: { assistantName: "小智", addressAs: "孩子", tone: "温暖、耐心、鼓励", verbosity: "brief", traits: ["鼓励", "耐心", "清晰"], instructions: "使用适龄表达，避免恐吓和成人化内容。" },
          memoryPolicy: { enabled: true, maxContextItems: 8, includeFamilyMemory: true, includeLearning: true, retentionDays: 365 },
          updatedAt: new Date().toISOString()
        },
        {
          id: "guest", name: "访客", role: "guest", status: "limited",
          profile: { preferredName: "访客", ageGroup: "", locale: "zh-CN", timezone: "Asia/Shanghai", interests: [], avoidTopics: [], accessibility: [] },
          persona: { assistantName: "小智", addressAs: "访客", tone: "礼貌、克制、简洁", verbosity: "brief", traits: ["礼貌", "克制"], instructions: "不要引用任何私人家庭记忆。" },
          memoryPolicy: { enabled: false, maxContextItems: 3, includeFamilyMemory: false, includeLearning: false, retentionDays: 30 },
          updatedAt: new Date().toISOString()
        }
      ],
      policies: {
        默认: { music: true, ai: true, learning: true, apps: true, openclaw: true, homeControl: true, family: true, quiet: false },
        儿童: { music: true, ai: true, learning: true, apps: false, openclaw: false, homeControl: false, family: true, quiet: false },
        访客: { music: true, ai: false, learning: false, apps: false, openclaw: false, homeControl: false, family: true, quiet: false }
      }
    },
    security: {
      policyVersion: 1,
      deniedCount: 0,
      lastDecisionAt: null,
      audit: [],
      tokens: []
    },
    openclaw: {
      jobs: [],
      tasks: [
        { id: "default", title: "默认任务", description: "运行服务器上的默认 OpenClaw 编排" },
        { id: "music", title: "音乐自动化", description: "调用服务器音乐/播客相关流程" },
        { id: "diagnostics", title: "诊断任务", description: "运行服务器诊断和日志采集" }
      ],
      lastRunAt: null
    },
    integrations: {
      homeAssistant: {
        configured: false,
        lastActionAt: null,
        history: []
      },
      nas: {
        configured: false,
        lastScanAt: null,
        history: []
      }
    },
    devices: [
      {
        id: "waveshare-1.85b-main",
        name: "家庭圆屏",
        profile: "waveshare-esp32-s3-touch-lcd-1.85b",
        room: "home",
        owner: "family",
        firmware: "2.2.6",
        createdAt: new Date().toISOString(),
        lastSeenAt: null
      }
    ],
    deviceLogs: [],
    database: {
      schemaVersion: 1,
      tables: {
        families: "family profile and policy records",
        members: "family member identities and roles",
        devices: "registered ESP32 terminals",
        events: "sync, learning, media, and system events",
        resources: "resource package manifests and files",
        audit: "action security audit records"
      }
    },
    product: {
      releaseChannel: "local",
      minFirmware: "2.2.6",
      remoteUiSchema: 2,
      backendApi: 1,
      upgradePolicy: {
        firmware: "manual-confirm",
        resources: "auto-verified",
        backend: "compatible-migrations"
      }
    },
    remoteUi: {
      schemaVersion: 2,
      deviceProfile: "waveshare-esp32-s3-touch-lcd-1.85b",
      capabilities: ["text", "button", "card", "list", "app_grid", "progress", "media_player", "quiz_card"],
      fallbackPages: ["home", "ai", "settings"]
    },
    connectivity: {
      blufi: {
        available: true,
        deviceName: "Xiaozhi-Blufi",
        status: "available",
        lastProvisionedAt: null
      },
      phoneProxy: {
        available: false,
        status: "reserved"
      }
    },
    acceptance: {
      updatedAt: null,
      items: []
    },
    ota: {
      firmware: {
        version: "2.2.6",
        channel: "local",
        url: "",
        sha256: "",
        mandatory: false
      }
    },
    dialogs: []
  };
}

module.exports = {
  createInitialState
};
