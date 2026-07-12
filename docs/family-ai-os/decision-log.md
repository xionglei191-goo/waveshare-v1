# Decision Log

This file records decisions that should survive across Codex threads.

## 2026-07-04: Documentation Split

- Status: `Accepted`
- Decision: `todo.md` is an execution checklist and implementation record, not the full design source.
- Canonical docs live in `docs/family-ai-os/`.
- Rationale: long-running product work was mixing Xiaozhi upstream docs, project roadmap and implementation status.

## 2026-07-04: Page Responsibility Boundary

- Status: `Accepted`
- Decision: First-level pages are Home, Weather, Schedule, AI, Music, English, Album, Apps and Settings.
- Settings is accessed from the top system bar, not from Apps.
- Apps does not duplicate first-level pages or family mode settings.
- Album replaces the old first-level Content page and only handles photos/screensaver resources.

## 2026-07-05: Xiaozhi Official AI Remains Primary

- Status: `Accepted`
- Decision: Keep Xiaozhi official AI for wake word, ASR/LLM/TTS, OTA and MQTT.
- Family Backend only adds tools, memory, content, Remote UI, sync and permissions.
- Rationale: Xiaozhi official AI is significantly faster and already stable on the device.

## 2026-07-05: Power Button Scope

- Status: `Accepted`
- Decision: BOOT remains first-level page switching and setup entry. The physical power key is not used for firmware screen-off unless a readable PWR GPIO or PMIC interrupt is confirmed.
- Rationale: current official 1.85B BSP exposes GPIO0 as the usable button.

## 2026-07-06: Server Podcast Architecture

- Status: `Accepted`
- Decision: Server podcasts use online streaming by default, with optional SD offline cache.
- Server must provide metadata, byte-range streaming and progress APIs.
- ESP32 validates cached files with SHA-256/size and plays cached files first when valid.
- Rationale: this matches podcast app behavior while keeping ESP32 memory use low.

## 2026-07-06: SD Card Mode For 1.85B

- Status: `Accepted`
- Decision: The current 1.85B AppShell target uses official 4-bit SDMMC.
- Pins: `CLK=GPIO15`, `CMD=GPIO14`, `D0=GPIO16`, `D1=GPIO17`, `D2=GPIO12`, `D3=GPIO13`.
- Evidence: Waveshare official 1.85B BSP and serial verification with `SSR: bus_width=4`.

## 2026-07-06: Deprecated 1-bit SD Conclusion

- Status: `Deprecated`
- Old decision: use 1-bit SDMMC with `CLK=GPIO14`, `CMD=GPIO17`, `D0=GPIO16`.
- Why it changed: the conclusion came from generic 1.85 wiki/old-project inference while investigating corrupted SD files. It does not match the current 1.85B official BSP and caused mount timeout on the actual device.
- What remains valid from that work: normal firmware must not auto-format, recovery formatting must be explicit, and SD writes should use locking plus tmp-then-rename.

## 2026-07-06: Xiaozhi Tool Gateway Before ESP32 Tool Bridge

- Status: `Accepted`
- Decision: For Family Backend tools, prefer a narrow public Xiaozhi AI Tool Gateway over registering many ESP32-side MCP tools.
- Flow: Xiaozhi official AI calls `POST /api/ai/xiaozhi/tool`; Family Backend maps the safe intent to a device command; ESP32 receives the command through `/api/events/latest`, executes media/UI work, then ACKs `/api/device/commands/:id/ack`.
- Rationale: Xiaozhi keeps the fast voice path, Family Backend owns tool routing and permissions, and ESP32 stays a thin renderer/player instead of becoming a growing tool server.
- Security boundary: only the AI tool gateway should be exposed publicly, protected by `XIAOZHI_TOOL_TOKEN`/`AI_TOOL_TOKEN`; do not expose broad admin/action/OpenClaw/Home Assistant APIs directly to the public internet.

## 2026-07-07: Product Repositioning As Three-part Ecosystem

- Status: `Accepted`
- Decision: Family AI OS is a three-part ecosystem: round screen interaction terminal, AI-native backend and future mobile app.
- ESP32 is not the product brain and must not become the data processing or business logic host.
- Rationale: the round screen wins over phone only in simple, convenient, natural family-site interactions. Heavy logic belongs to backend; complex management belongs to backend/mobile.

## 2026-07-07: Backend Is AI-native Capability Hub

- Status: `Accepted`
- Decision: Backend capabilities should be operable by AI through safe semantic tools, not by exposing raw CRUD APIs.
- Each important capability needs traditional API/admin access, AI tool access, policy checks, audit and clear speech/display/action output.
- Rationale: the product needs multi-user roles, permissions, memory, knowledge and tool orchestration that Xiaozhi's single-role setup cannot own long-term.

## 2026-07-07: Page Agent First + Router Fallback

- Status: `Accepted`
- Decision: Each first-level page has a default Page Agent. Page-local interactions call that Agent first. Router is used only for Home/AI broad requests, ambiguous input or cross-domain handoff.
- Rationale: the round screen should feel fast and natural. The current page is the strongest context, while Router fallback preserves flexibility.
- Rule: page provides context bias, role/mode policy provides permission, capability tools perform execution.

## 2026-07-07: Xiaozhi Server As Voice Provider, Not Product Backend

- Status: `Accepted`
- Decision: If `xinnan-tech/xiaozhi-esp32-server` is used later, treat it as an independent Voice Provider/runtime, not as the Family Backend base.
- Family Backend remains the product's Capability Hub and should be callable from Xiaozhi official, xiaozhi server, custom AI service, mobile app and round screen.
- Rationale: the open-source Xiaozhi server is centered on voice/device protocol and agent runtime, while Family AI OS needs stable product ownership over household data, tools, permissions and resources.

## 2026-07-09: Device-facing Media URLs Stay On LAN HTTP

- Status: `Accepted`
- Decision: Device-facing media `streamUrl`/`downloadUrl` must point at the LAN HTTP backend, never at the public HTTPS tunnel. Web companion/admin keep the public HTTPS URL.
- Implementation: added `deviceMediaBaseUrl` config (env `DEVICE_MEDIA_BASE_URL`/`LAN_BASE_URL`; when unset and `publicBaseUrl` is HTTPS, it falls back to `http://192.168.31.246:3100`). The backend rewrites the URL origin only at device-facing exits: `/api/media/server/tracks`, `/api/device/summary` (`music.server`) and device command payloads (`media.server.play`/`resume`/`next`). Files: `server/src/config.js`, `media.js`, `routes.js`, `device-commands.js`.
- Evidence / why it changed: after `PUBLIC_BASE_URL=https://wave.xionglei.online` was set (2026-07-06), server media `streamUrl` became a public HTTPS URL. The ESP32 audio client (`AudioService::PlayOggUrl`/`PlayMp3Url`, plain `esp_http_client` with no TLS/cert-bundle config) cannot open HTTPS, so playback silently failed while the command ACK was still sent on receipt. On 2026-07-09 the fix restored audible playback of the server podcast on `esp32-185b` and `openclaw-default-music` acceptance passed.
- Rule: the round screen prefers LAN `http://192.168.31.246:3100` for media playback and does not depend on the public path.

## 2026-07-09: Xiaomi/XiaoAi Speaker Control Via Home Assistant

- Status: `Accepted`
- Decision: Control the Xiaomi/XiaoAi speaker through Home Assistant (`xiaomi_miot`), exposed as backend Capability Tools `family.speaker.command|say|volume|play|pause`. No Mi-account credentials are stored in this project; the speaker is reached via HA services.
- Implementation: reuses `runHomeAssistantService` (generic `/api/services/{domain}/{service}`). `command`/`say` call the configurable `XIAOMI_SPEAKER_SERVICE` (default `xiaomi_miot.intelligent_speaker`) with `{entity_id, text, execute}`; `volume` → `media_player.volume_set`; `play`/`pause` → `media_player.media_play|media_pause`. Target entity is always the configured `XIAOMI_SPEAKER_ENTITY` (AI cannot target arbitrary HA entities). Tools stay simulated until HA + entity are configured. Policy category `homeControl` (parent/member, 默认 mode); audited. Tools Agent (apps page) routes speaker utterances.
- Rationale: fits the AI-native Capability Hub model, reuses existing HA plumbing/audit/policy, keeps credentials in HA, and `command` (delegating to XiaoAi's own assistant) is model-agnostic across 小爱 speakers.
- Alternative deferred: direct Mi-cloud control (MiService/XiaoGPT-style) would need Mi account credentials in backend secrets and is less stable; revisit only if the user does not run Home Assistant.

## 2026-07-10: Device Resource Downloads Reuse LAN Family Hub Origin

- Status: `Accepted`
- Decision: AppShell treats the configured LAN Family Hub as the authority for resource files. It fetches `/api/resources/file/<path>` from `backend_url_` and does not follow the manifest's public HTTPS `baseUrl`.
- Evidence: the public `https://wave.xionglei.online/api/resources/file` origin failed because the embedded resource client had no TLS verification configuration. During a post-voice background refresh this contributed to an `app_backend` stack overflow and reboot. After same-origin LAN rewriting and increasing the refresh task stack from 8 KB to 12 KB, the real device crossed the five-minute refresh boundary without TLS error, stack overflow or reboot.
- Rule: public HTTPS URLs remain valid for browser/admin consumers, but round-screen media and resource downloads use LAN HTTP unless the embedded client is explicitly upgraded with verified TLS support.

## 2026-07-11: Power Save Stays At Screen-Dim Only (No Light Sleep)

- Status: `Accepted`
- Decision: On the 1.85B AppShell target, power saving is intentionally limited to the display-off tier. Full CPU downscaling and light sleep are deliberately not enabled.
- Implementation: `InitializePowerSaveTimer()` constructs `new PowerSaveTimer(-1, 60, 300)`. The first argument `cpu_max_freq_ = -1` is a sentinel that makes `PowerSaveTimer::PowerSaveCheck()`/`WakeUp()` skip the entire `esp_pm_configure({..., light_sleep_enable = true})` block, plus the wake-word-detection disable and audio-input disable. After 60s idle it only calls `GetDisplay()->SetPowerSaveMode(true)` (dim/off); any AI message, system notice, backend action feedback, touch or new notification calls `WakeUp()` to restore brightness. Files: `main/boards/waveshare/esp32-s3-touch-lcd-1.85b-appshell/esp32-s3-touch-lcd-1.85b-appshell.cc`.
- Config coupling: `sdkconfig` has `# CONFIG_PM_ENABLE is not set`, so the ESP-IDF power-management framework is not even compiled in. Enabling light sleep later requires BOTH `CONFIG_PM_ENABLE=y` (with tickless idle) AND passing a real `cpu_max_freq` (e.g. 240) to the constructor; changing one without the other is a no-op or an error.
- Rationale: this is an always-on voice wake-word device. Light sleep forces disabling wake-word detection (the code does exactly that), so "你好小智" would stop working during standby and require a touch to wake first. Keeping the wake word always live is more important than the extra power saving on a mains/large-battery desktop device.
- Not done on purpose: (a) light sleep + CPU downscale, (b) the 300s `seconds_to_shutdown` auto-shutdown — its `OnShutdownRequest` callback is left commented out, so the 300s threshold currently fires nothing.
- Revisit if: the device moves to battery-critical use, or a wake source other than the always-on mic (e.g. touch-to-wake acceptance) becomes acceptable for standby.

## 2026-07-12: Waveshare Root Is The Only Project Root

- Status: `Accepted`
- Decision: `/Users/xionglei/Documents/waveshare` is the only development root. The full ESP-IDF firmware, Family Hub, Voice Provider, documentation and project scripts live directly under it.
- Migration: promoted the production project out of `xiaozhi-esp32-appshell/`, removed the obsolete root PlatformIO starter, merged ignore rules, changed local runbook paths and made `scripts/restore-idf-and-build.sh` locate the repository dynamically.
- Development policy: retain the verified Xiaozhi-derived voice implementation as internal product code, but stop maintaining a separate directory for upstream merges. New work must target root `main/`, `server/`, `docs/` or `scripts/` paths.
- Verification: Family Hub syntax checks, 23 Node.js unit tests, JSON and SQLite smoke tests, 31 Voice Provider tests and a clean ESP-IDF v5.5.4 firmware build all passed from the new root.
- Rule: do not recreate `xiaozhi-esp32-appshell/`, `platformio.ini`, root `src/` or the former Arduino starter. Git history is the archive for that retired baseline.

## Conflict Rule

When a future conversation conflicts with these decisions, do not silently overwrite them. Add a new decision entry with:

- new evidence,
- test result,
- files changed,
- whether the old decision is still valid, amended or deprecated.
