# Current State

Last updated: 2026-07-11.

This file records the current project state. Treat it as the first stop before changing code.

## Product Position

- Family AI OS is a three-part home AI interaction ecosystem: round screen terminal, AI-native backend and future mobile app.
- ESP32 is a thin family interaction terminal, not a data processing or business logic host.
- Family Backend is the AI-native Capability Hub for tools, content, Remote UI, sync, memory, schedules, policies and integrations.
- Xiaozhi official AI remains a fast voice entrance; the future custom AI service will own family roles, multi-memory, knowledge base and Page Agents.
- Mobile App is reserved for provisioning, portable management, diagnostics, resource import and future phone-network proxy.

## Firmware State

- Target board: Waveshare ESP32-S3 Touch LCD 1.85B AppShell.
- Build environment: ESP-IDF v5.5.4.
- Build command:

```sh
source /Users/xionglei/esp/esp-idf-v5.5.4/export.sh
idf.py build
```

- Flash command:

```sh
idf.py -p /dev/cu.usbmodem101 flash
```

- Verified startup: LCD, touch, BQ27220, SD 4-bit mount, Wi-Fi, Xiaozhi OTA/MQTT, wake word and backend connection.
- Latest P9 firmware moves the persistent 24 KB Opus codec stack and optional music/network workers to PSRAM. Verified minima are `49627` bytes for the same Chinese MP3, `38279` bytes across the long self-hosted session, `41999` bytes during Provider restart recovery, and `39567` bytes for official fallback. All are above the 20 KB acceptance floor with no panic, reboot or leak.
- Device heartbeat now reports explicit `freeInternalSram` and `minimumFreeInternalSram`; total heap including PSRAM is no longer presented as internal SRAM.
- Settings > Network now shows SSID, RSSI/channel, IP and backend state for BluFi/Wi-Fi acceptance.
- BluFi and AFSK provisioning logs redact Wi-Fi passwords.
- Firmware now has a low-frequency `appshell.heartbeat` path to `/api/device/logs`; it reports UUID, logical device id, page, AI/backend state, wake/reset, heap, SSID/IP/RSSI/channel and device status when backend refresh is online and the device is not busy.
- Firmware now reports a dedicated `appshell.wifi_provisioned` device log after a successful AppShell BluFi provisioning flow. Readiness requires this event plus a recent heartbeat; acceptance still requires real phone-side proof.

## Backend State

- P9 AI runtime is deployed: device page context push/cache, trace/session propagation, deterministic Page Agent boundary, lightweight `gpt-5.4-mini` fallback, complex `gpt-5.5` fallback, command idempotency, sanitized trace storage and admin trace diagnostics.
- Family-memory CRUD now requires admin authorization. Memory supports member scope, visibility, source, expiry and per-member enable policy; Provider remains `nomem`, and conversation text is not persisted by default.

- Backend directory: `server/`.
- Remote deployment: `/opt/xiaozhi-family-hub`.
- Remote URL: `http://192.168.31.246:3100`.
- Public tunnel URL: `https://wave.xionglei.online`.
- Service: `xiaozhi-family-hub.service`.
- Store: SQLite at `/opt/xiaozhi-family-hub/data/family-hub.sqlite`.
- Media directory: `/opt/xiaozhi-family-hub/data/resources/music/server`.
- Admin page: `http://192.168.31.246:3100/admin`.
- Companion page: `http://192.168.31.246:3100/companion`.
- Admin and companion scope today: status/diagnostics, admin-token test, BluFi guide, content/resource import, device logs, connectivity strategy, external acceptance evidence and acceptance readiness.
- Admin and companion acceptance forms can record note, reference and bounded structured data JSON; backend redacts token/password/secret-like fields.
- Companion content import now chooses default paths by content type: album to `images/`, podcast to `music/server/`, English to `courses/english/`, game to `games/`, story to `courses/stories/`.
- Admin content import now also supports album/podcast/English/story/game uploads into catalog, matching the companion content import path.
- `npm run content:import-real` can batch import real album, podcast, English and game files, then print a manifest/readiness-backed evidence draft. It validates file extensions and does not mark acceptance as passed.
- External acceptance API: `GET /api/acceptance/status`, `GET /api/acceptance/readiness` and `POST /api/admin/acceptance/:id/evidence`.
- External acceptance evidence currently tracks EspBlufi new Wi-Fi, Home Assistant real scene, real family content and OpenClaw default/music mappings. Evidence `data` is bounded and redacts token/password/secret-like fields, but notes should still avoid private credentials.
- Remote `ADMIN_TOKEN` is configured through `/opt/xiaozhi-family-hub/secrets/admin.env`; the raw token is also saved locally at `~/.config/xiaozhi-family-hub/admin-token` for admin API verification. Do not paste it into docs, evidence notes or chat.
- `npm run acceptance:preflight` is the safe default preflight for external items; it is read-only unless called with `--execute` and never records evidence unless `--record --status=...` is provided with an admin token.
- `npm run acceptance:pack` generates a read-only evidence pack with raw snapshots, report, next actions and evidence draft JSON. It lowers manual evidence collection cost but never marks an item as passed.
- `/admin` and `/companion` external acceptance panels can fill the selected item's pending evidence draft into the form, download the read-only evidence pack JSON and show each item's `nextActions` inline. These UI entries still require manual confirmation before saving evidence.
- Real family content readiness intentionally ignores sample, smoke, representative, test, demo, diagnostic, placeholder, dummy, mock and fixture entries. Seed/test packs prove the pipeline works, but real content acceptance needs non-sample assets plus on-device display/playback evidence.
- Diagnostics report aggregates the latest device heartbeat into `esp32Status.network`, `esp32Status.recentMemory`, wake/reset and backend probe fields.
- Xiaozhi AI Tool Gateway: `POST /api/ai/xiaozhi/tool`.
- Gateway token: configured through systemd drop-in; remote secret at `/opt/xiaozhi-family-hub/secrets/xiaozhi-tool-token`, local copy at `~/.config/xiaozhi-family-hub/xiaozhi-tool-token`.
- Device command queue: `/api/events/latest` includes one pending command; ESP32 ACKs with `POST /api/device/commands/:id/ack`.
- Backend media/podcast capability is the current reference implementation for AI-native tools: search, queue, progress, resume, favorite, cache and device command ACK.
- AI agent layer now registers 9 Page Agents including a Home Agent (`family.home.overview` read-only overview + router fallback). Previously-registered-but-unrouted tools `family.content.recommend` and `family.memory.search` are now wired through the General/Home agents. Cross-cutting intents (recommend/remember/recall) take priority over domain-noun routing via `pickDefaultAgent` (see agents.js / capabilities.js, 2026-07-09).
- Family members now have structured `profile`, `persona` and `memoryPolicy`
  fields. Every `/api/agent/ask` resolves the stored member role, retrieves
  visible member/family memory, learning records and recent Agent interactions,
  and returns the effective `memberContext`. Deterministic speech applies the
  configured member address; full tone and custom instructions are ready for
  future LLM prompt assembly. Admin can edit these fields and inspect
  `/api/admin/family/members/:id/context`.
- User modes are now identity selectors, not a separate night/permission state:
  `默认` resolves to the active parent profile such as dad or mom, `儿童`
  resolves to the active child profile, and `访客` resolves to the guest profile.
  `夜间` is retired; older stored values are normalized to `默认`. Quiet or
  good-night behavior should be handled by device settings or HA scenes.
- Deterministic voice routing (2026-07-10): the 246 Provider runs `xiaozhi-voice-provider:0.9.5-family-router2`, reads `self.page.get_context` after final ASR, and calls `/api/agent/ask` before the ordinary LLM. `handled=false` is non-mutating and falls through once to Sub2ApiLLM. `router2` logs only request-header names, never Authorization or WebSocket header values. When NVS has no override, the 1.85B AppShell uses `http://192.168.31.246:8003/xiaozhi/ota/` as primary discovery and keeps `CONFIG_OTA_URL` as the official fallback.
- Real-device evidence (2026-07-10): firmware SHA `c28af028a...` was flashed to MAC `a0:f2:62:e4:3f:2c`. The device connected to `ws://192.168.31.246:8100/xiaozhi/v1/`; ASR `刷新一下` caused one `self.page.get_context` call returning `page=home`, `familyMode=默认`, `deviceId=esp32-185b`, and the Home Agent TTS response completed. The device then crossed the five-minute resource-refresh boundary without the prior TLS error, `app_backend` stack overflow or reboot; minimum SRAM was about 16.6 KB.
- Official-provider fallback acceptance passed on real hardware (2026-07-10): with only `xiaozhi-voice-provider` stopped, local WakeNet detected `你好小智`; the primary WebSocket connection to `192.168.31.246:8100` failed, firmware logged `Voice channel fallback: primary -> official`, fetched official OTA configuration, connected to `mqtt.xiaozhi.me`, logged `Voice provider: fallback/official`, and completed official ASR/TTS conversation. After the Provider was restarted and the official session returned to idle, a later wake logged `Voice provider recovery probe: primary/self-hosted`, refreshed the LAN OTA configuration, logged `Voice provider: primary/self-hosted`, reconnected to `ws://192.168.31.246:8100/xiaozhi/v1/`, and completed a Home Agent response. The Provider finished healthy with restart count 0.
- Provider fallback SRAM hardening passed on real hardware (2026-07-10): AppShell now blocks backend refresh/event/action networking while AI is connecting/listening/speaking and for three seconds after idle, rechecks inside worker entry points, and allocates the 12 KB refresh, 8 KB action and 4 KB event worker stacks from PSRAM. Failed primary WebSocket opens immediately release their transport without firing a false channel-close callback. Conversation-scoped heap telemetry measured `15431` bytes minimum during the official session and `15539` bytes during the recovered self-hosted session. After the five-minute resource-refresh boundary, the boot-lifetime minimum was `13827` bytes and current internal SRAM recovered to about 29 KB; no panic or reboot occurred. This replaces the earlier `2619`-byte fallback result.
- Resource URL encoding passed on real hardware (2026-07-10): AppShell percent-encodes each UTF-8 path byte according to RFC 3986 while preserving `/`, and downloads from the configured LAN Family Hub through `/api/resources/file/...`. A real refresh completed with heartbeat status `下载 25 项`; Chinese and space-containing paths were written to SD, with no `HTTP_CLIENT: Error parse url`, panic or reboot.
- MP3 SRAM hardening passed on real hardware (2026-07-10): the Audio Simple Player/GMF worker uses a 6 KB PSRAM-backed task stack. Replaying the same Chinese server MP3 raised the internal-SRAM minimum from `2963` to `17275` bytes (about 14.3 KB recovered), and current SRAM returned to roughly 36-38 KB after stop with no leak, panic or reboot.
- Provider-native exit semantics passed on real hardware (2026-07-10): exact commands include `退出`、`关闭`、`停止对话`、`结束对话` and `退出对话`; the Provider checks them before the Family Page Router and closes the connection directly. In the final microphone test, ASR first safely treated the incomplete phrase `对话` as an ordinary request, then recognized `停止对话` exactly; the Provider logged `识别到明确的退出命令: 停止对话`, the WebSocket disconnected, and the device returned from listening to idle without calling `self.page.get_context` or producing a Home Agent reply. Conversation-local SRAM minimum was `18995` bytes.
- Xiaomi/XiaoAi speaker control (2026-07-09): Tools Agent exposes `family.speaker.command` (send a text directive so XiaoAi's own assistant executes it), `family.speaker.say` (TTS), `family.speaker.volume`, `family.speaker.play`, `family.speaker.pause`. They run through the existing Home Assistant service call path (`runHomeAssistantService`) and stay simulated until `HOME_ASSISTANT_URL`/`HOME_ASSISTANT_TOKEN` and `XIAOMI_SPEAKER_ENTITY` are configured. `speaker.*` is categorized as `homeControl` policy (parent/member, 默认 mode). The say/command service is configurable via `XIAOMI_SPEAKER_SERVICE` (default `xiaomi_miot.intelligent_speaker`).
- Xiaozhi MCP bridge (2026-07-09) now exposes explicit `family.speaker.say`, `family.speaker.command` and `family.speaker.volume` tools (routed to `/api/agent/tools/*`), so Xiaozhi can control the speaker directly instead of only via `family.agent.ask`. The MCP-invoked path uses role empty + source `xiaozhi.mcp`, so it obeys user-mode policy: `homeControl` (and thus speaker control) is allowed in 默认 mode but denied in 儿童/访客 unless parent. Switch to 默认 mode to let Xiaozhi drive the speaker.
- VERIFIED on real hardware 2026-07-09: `family.speaker.say` and `family.speaker.command` both returned HA http 200 and the physical 小米AI音箱(第二代) audibly spoke. Live config: `XIAOMI_SPEAKER_ENTITY=media_player.xiaomi_l15a_654a_play_control` (model `xiaomi.wifispeaker.l15a`), service `xiaomi_miot.intelligent_speaker` with `{entity_id, text, execute}` (execute=false → TTS, true → run as XiaoAi directive).

## Home Assistant Deployment

- Home Assistant runs as a Docker container on the same server (`192.168.31.246`), config at `/opt/homeassistant`, `--network=host`, port `8123`, image `ghcr.io/home-assistant/home-assistant:stable`.
- HACS + `al-one/hass-xiaomi-miot` ("Xiaomi Miot Auto") integration installed; Mi account logged in, devices imported (speaker, cameras, routers, lock, lights).
- Docker daemon proxy drop-in (`/etc/systemd/system/docker.service.d/http-proxy.conf`) was disabled (renamed to `.disabled`) because the local proxy `127.0.0.1:10808` was dead; the server now uses Cloudflare WARP for outbound. Re-enable by renaming back if needed.
- Family Hub HA config lives in `/opt/xiaozhi-family-hub/secrets/home-assistant.env` (chmod 600, root) loaded via systemd drop-in `40-home-assistant.conf` (`HOME_ASSISTANT_URL=http://127.0.0.1:8123`, `HOME_ASSISTANT_TOKEN`, `XIAOMI_SPEAKER_ENTITY`). Do not paste the HA token into docs or chat.
- Content representative smoke now covers album, podcast MP3, English JSON and game JSON imports through `/api/content/import`; catalog, packs, manifest, media stream and Remote UI page entries are automatically verified. This is not a substitute for real family asset acceptance, and it no longer makes `real-family-content` readiness pass.

## Page Responsibilities

- First-level pages: Home, Weather, Schedule, AI, Music, English, Album, Apps, Settings.
- Settings is a global top-bar entry, not an app item.
- Apps page contains expandable tools and games only.
- Album page only handles photos, slideshow and screensaver resources.
- Weather page must not show schedule items.
- Each first-level page has a default Page Agent. Page-local interactions go to that Agent first; Router is fallback only.
- Apps page uses Tools Agent for OpenClaw, Home Assistant scenes, NAS/server media scan and tool status.
- Home Assistant tool calls record HTTP code, exit code, duration and response summaries when `HOME_ASSISTANT_URL/TOKEN` are configured.

## Media State

- SD local music supports Ogg/Opus and MP3.
- Server podcast/music supports Ogg/Opus and MP3 HTTP streaming.
- Server streams expose `format`, `contentType`, `sha256`, `size`, `cachePath`, `streamUrl`, `downloadUrl`, `cacheable` and `supportsRange`.
- Server stream endpoint supports HTTP byte ranges.
- Device-facing `streamUrl`/`downloadUrl` (from `/api/media/server/tracks`, `/api/device/summary` and `media.server.*` device commands) are rewritten to the LAN HTTP backend via `deviceMediaBaseUrl`. The ESP32 audio HTTP client has no TLS config and cannot open the public HTTPS tunnel URL; web companion/admin keep public HTTPS.
- AppShell resource downloads also stay on the configured LAN Family Hub origin. The device ignores a public HTTPS `baseUrl` in the manifest, percent-encodes UTF-8/space-containing relative paths, and requests `/api/resources/file/...` from `backend_url_`; the background refresh task has a 12 KB PSRAM-backed stack.
- ESP32 can optionally cache server podcasts to `/sdcard/music/cache/` and prefers valid cached files.
- Xiaozhi official AI can trigger server podcast play/next/stop/cache through the backend gateway and device command queue without making ESP32 host a large tool registry.

## Open Items

- The fallback/recovery follow-ups are closed and verified on hardware: Provider-native exit commands run before the Page Router, resource paths are percent-encoded, and the earlier `2619`-byte fallback SRAM risk is resolved. The final microphone test for `停止对话` returned the device directly to idle without a Page Router call. The latest MP3 stress minimum is `17275` bytes, while the earlier full fallback/recovery cycle minimum was `13827` bytes.
- OpenClaw `diagnostics/default/music` run through `/opt/xiaozhi-family-hub/bin/openclaw-command-adapter.sh` and have verified success jobs. `openclaw-default-music` acceptance is now `passed` (2026-07-09): a human confirmed the round screen audibly played the server podcast after the device-facing media URL fix below. `/api/acceptance/status` is now `1/4 passed`.
- Device-facing media `streamUrl`/`downloadUrl` now stay on the LAN HTTP backend, because the ESP32 audio HTTP client cannot open the public HTTPS tunnel URL. Only device-facing exits are rewritten; web companion/admin keep public HTTPS. See decision-log 2026-07-09.
- Home Assistant has safe tool wiring, policy checks and action history, but real device control still needs `HOME_ASSISTANT_URL` and `HOME_ASSISTANT_TOKEN` plus HA-side state verification.
- EspBlufi new Wi-Fi provisioning needs one full manual acceptance pass.
- Latest flashed firmware has already restored a real heartbeat from SSID `liuliu` at `192.168.31.160`; BluFi readiness is intentionally still partial because no `appshell.wifi_provisioned` event has been recorded yet.
- Native phone App and phone-network proxy are still future work; current accepted phone surface is the mobile Web companion.
- Content seed packs and representative import APIs are working; real family photos, podcasts, English packs and game assets still need to be imported and verified on-device.
- Do not mark the external items above complete until `/api/acceptance/status` has matching evidence from the real device/service check.
- Current device command delivery uses the 5-second lightweight probe; upgrade to WebSocket/MQTT only after this gateway path is stable.
