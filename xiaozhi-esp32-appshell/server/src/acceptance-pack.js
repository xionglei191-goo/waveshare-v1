const DEFAULT_ACCEPTANCE_ITEMS = [
  "blufi-new-wifi",
  "home-assistant-real-scene",
  "real-family-content",
  "openclaw-default-music"
];

function itemById(collection, id) {
  return (collection?.items || []).find((item) => item.id === id) || null;
}

function latestBySource(logs, source) {
  return (logs || []).find((log) => log.source === source) || null;
}

function latestOpenClawJob(jobs, target) {
  return (jobs || []).find((job) => job.target === target) || null;
}

function latestDeviceCommandAck(commands, type, deviceId = "") {
  return (commands || []).find((command) =>
    command.type === type &&
    command.status !== "pending" &&
    (!deviceId || command.deviceId === deviceId)
  ) || null;
}

function recentOpenClawPolicyAudit(audit) {
  return (audit || [])
    .filter((item) => item.action === "openclaw.run" && (item.status === "denied" || item.status === "confirmation_required"))
    .slice(0, 8)
    .map((item) => ({
      at: item.at,
      status: item.status,
      memberId: item.memberId,
      mode: item.mode,
      reason: item.reason
    }));
}

function latestHomeAssistant(integrations) {
  return integrations?.homeAssistant?.history?.[0] || null;
}

function manifestFiles(manifest) {
  return (manifest?.packs || []).flatMap((pack) => (pack.files || []).map((file) => ({ ...file, packId: pack.id })));
}

function contentItemsByType(catalog, type) {
  return (catalog || []).filter((item) => item.type === type);
}

function checksSummary(readinessItem) {
  return (readinessItem?.checks || []).map((check) => ({
    id: check.id,
    label: check.label,
    ok: Boolean(check.ok),
    detail: check.detail || ""
  }));
}

function evidenceDraftFor(id, context, observations = {}) {
  const readiness = itemById(context.readiness, id);
  const logs = context.deviceLogs || [];
  const observation = observations[id] || {};

  if (id === "blufi-new-wifi") {
    const heartbeat = latestBySource(logs, "appshell.heartbeat");
    const provisioned = latestBySource(logs, "appshell.wifi_provisioned");
    const board = heartbeat?.data?.board || {};
    return {
      status: "pending",
      actor: "parent",
      source: "acceptance-pack",
      note: "Wi-Fi provisioning evidence draft (SoftAP web portal or BluFi); set passed only after phone provisioning success, settings page network fields and Xiaozhi voice path are confirmed.",
      reference: observation.reference || "",
      data: {
        readiness,
        heartbeatAt: heartbeat?.at || "",
        provisionedAt: provisioned?.at || "",
        method: provisioned?.data?.method || "",
        ssid: board.ssid || "",
        ip: board.ip || "",
        rssi: board.rssi,
        channel: board.channel,
        xiaozhiVoiceOk: Boolean(observation.xiaozhiVoiceOk),
        settingsPageObserved: Boolean(observation.settingsPageObserved),
        serialPanic: observation.serialPanic === true
      }
    };
  }

  if (id === "home-assistant-real-scene") {
    return {
      status: "pending",
      actor: "parent",
      source: "acceptance-pack",
      note: "Home Assistant evidence draft; set passed only after HA-side entity or scene state change is confirmed.",
      reference: observation.reference || "",
      data: {
        readiness,
        latestHomeAssistant: latestHomeAssistant(context.integrations),
        observedBefore: observation.before || null,
        observedAfter: observation.after || null,
        haSideStateChanged: Boolean(observation.haSideStateChanged),
        auditChecked: Boolean(observation.auditChecked)
      }
    };
  }

  if (id === "real-family-content") {
    const files = manifestFiles(context.manifest);
    const types = ["album", "podcast", "english", "game"];
    return {
      status: "pending",
      actor: "parent",
      source: "acceptance-pack",
      note: "Real family content evidence draft; set passed only after ESP32 display/playback/entry checks are confirmed.",
      reference: observation.reference || "",
      data: {
        readiness,
        items: types.map((type) => {
          const catalog = contentItemsByType(context.catalog, type).slice(0, 5);
          return {
            type,
            catalog,
            files: files.filter((file) => catalog.some((item) => item.path === file.path)).slice(0, 5)
          };
        }),
        deviceObserved: {
          album: Boolean(observation.album),
          podcastPlayback: Boolean(observation.podcastPlayback),
          englishEntry: Boolean(observation.englishEntry),
          gameEntry: Boolean(observation.gameEntry)
        }
      }
    };
  }

  if (id === "openclaw-default-music") {
    const jobs = context.openclawJobs || [];
    const commandHistory = context.commandStatus?.history || [];
    return {
      status: "pending",
      actor: "parent",
      source: "acceptance-pack",
      note: "OpenClaw evidence draft; set passed only after default/music real household effects and policy checks are confirmed.",
      reference: observation.reference || "",
      data: {
        readiness,
        latestDefaultJob: latestOpenClawJob(jobs, "default"),
        latestMusicJob: latestOpenClawJob(jobs, "music"),
        latestMediaPlayAck: latestDeviceCommandAck(commandHistory, "media.server.play", "esp32-185b"),
        defaultObservedEffect: observation.defaultObservedEffect || "",
        musicObservedEffect: observation.musicObservedEffect || "",
        policyChecks: observation.policyChecks || {
          recentAudit: recentOpenClawPolicyAudit(context.recentAudit || [])
        }
      }
    };
  }

  return {
    status: "pending",
    actor: "parent",
    source: "acceptance-pack",
    note: "Unknown acceptance evidence draft.",
    data: { readiness }
  };
}

function nextActionsFor(id, draft) {
  const checks = draft.data?.readiness?.checks || [];
  const missing = checks.filter((check) => !check.ok).map((check) => ({
    type: "readiness",
    text: `${check.label}${check.detail ? `: ${check.detail}` : ""}`
  }));
  const ok = (checkId) => checks.some((check) => check.id === checkId && check.ok);
  const manual = [];
  if (id === "blufi-new-wifi") {
    if (!ok("wifi-provisioned") || !ok("method")) {
      manual.push("Use EspBlufi App to provision a new Wi-Fi.");
    }
    manual.push("Confirm Settings page network fields and Xiaozhi OTA/MQTT/wake word.");
  } else if (id === "home-assistant-real-scene") {
    if (!ok("configured")) {
      manual.push("Configure real HOME_ASSISTANT_URL/TOKEN.");
    }
    manual.push("Observe and record the HA-side scene/entity state change.");
  } else if (id === "real-family-content") {
    if (missing.length > 0) {
      manual.push("Import non-sample album/podcast/english/game assets.");
    }
    manual.push("Confirm ESP32 Album/Music/English/Apps display, playback and entries.");
  } else if (id === "openclaw-default-music") {
    if (!ok("default-mapping") || !ok("music-mapping")) {
      manual.push("Configure OPENCLAW_TARGET_DEFAULT_COMMAND and OPENCLAW_TARGET_MUSIC_COMMAND.");
    }
    if (!ok("default-success") || !ok("music-success")) {
      manual.push("Trigger default/music through family.openclaw.run until both produce success jobs.");
    }
    manual.push("Confirm default/music real household effects and policy denials.");
  }
  return [
    ...missing,
    ...manual.map((text) => ({ type: "manual", text }))
  ];
}

function buildAcceptanceEvidencePack(context, options = {}) {
  const items = (options.items || DEFAULT_ACCEPTANCE_ITEMS).filter((id) => DEFAULT_ACCEPTANCE_ITEMS.includes(id));
  const selected = items.length > 0 ? items : DEFAULT_ACCEPTANCE_ITEMS;
  const drafts = {};
  const nextActions = {};
  for (const id of selected) {
    drafts[id] = evidenceDraftFor(id, context, options.observations || {});
    nextActions[id] = nextActionsFor(id, drafts[id]);
  }
  return {
    generatedAt: new Date().toISOString(),
    items: selected,
    status: context.status,
    readiness: context.readiness,
    diagnostics: context.diagnostics || null,
    raw: {
      deviceLogs: context.deviceLogs || [],
      integrations: context.integrations || {},
      openclawJobs: context.openclawJobs || [],
      recentAudit: context.recentAudit || [],
      manifest: context.manifest || {},
      catalog: context.catalog || []
    },
    evidenceDrafts: drafts,
    nextActions,
    note: "Read-only evidence pack. Review manually and submit evidence through /admin or /companion; this endpoint never marks acceptance as passed."
  };
}

module.exports = {
  buildAcceptanceEvidencePack
};
