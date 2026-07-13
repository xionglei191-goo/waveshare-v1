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

- Status: `Superseded by 2026-07-12: Self-Hosted AI Chain Is Primary, Official Xiaozhi Is Fallback`
- Decision: Keep Xiaozhi official AI for wake word, ASR/LLM/TTS, OTA and MQTT.
- Family Backend only adds tools, memory, content, Remote UI, sync and permissions.
- Rationale: Xiaozhi official AI is significantly faster and already stable on the device.
- Note: this rationale weighed only speed. It did not account for the official AI being closed — unable to reach the family knowledge base or custom tool calls — which is why the decision was later reversed. See the 2026-07-12 entry.

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

## 2026-07-12: Custom AI Chain Is Primary, Xiaozhi Official Is Fallback

- Status: `Accepted` (supersedes 2026-07-05 "Xiaozhi Official AI Remains Primary")
- Decision: The primary conversation chain is self-hosted. The voice-provider LLM runs against **Zhipu GLM official API directly** (both tiers `glm-4-flashx-250414`), routed through the family page router so it can reach the Family Hub's tools, knowledge base and MCP capabilities. Xiaozhi official AI is demoted to **fallback only** (wake word, pure chit-chat, and degradation when the self-hosted chain is unavailable).
- Rationale: Xiaozhi official AI responds faster but is **closed** — it cannot call the user's own knowledge base or custom tools, so it cannot carry the core Family AI capabilities. Extensibility is worth the extra hop; the model was chosen so the latency cost is minimal.
- Model selection (measured TTFT on host, 2026-07-12): `glm-4-flashx-250414` **0.44s** (chosen — fast + confirmed function_call), `glm-4-flashx` 1.78s, `glm-4-flash` 2.10s but **does not trigger function_call** (fabricates tool answers — rejected), `deepseek-v4-flash` 2.71s, `deepseek-v4-pro` 6.74s, `glm-4.7-flash` unusable for voice (reasoning model — emits long `reasoning_content` before any speakable `content`). GLM flashx is ~6x faster first-token than the prior DeepSeek default.
- Migration history: this chain was first moved off the local `sub2api` gateway (OpenAI upstream `gpt-5.5`/`gpt-5.4-mini` took 20–36s and blew the 20s LLM read timeout, so every turn failed to the local Xiaozhi page) to DeepSeek direct on 2026-07-11 (fixed the timeouts but first-token was still ~2.7s), then to Zhipu GLM flashx on 2026-07-12 for the speed. DeepSeekLLM and Sub2ApiLLM blocks are retained in `.config.yaml` as fallbacks. Do NOT reuse sub2api for this chain.
- Config coupling (all three model-name sources MUST agree, or device chat 400s or uses the wrong model — the endpoint comes from `selected_module.LLM`'s provider, so ALL tiers must be models that provider's endpoint accepts; do not mix a GLM name with a DeepSeek endpoint):
  - Family Hub (Node backend) systemd drop-in `/etc/systemd/system/xiaozhi-family-hub.service.d/60-ai-models.conf`: `AI_LIGHTWEIGHT_MODEL=glm-4-flashx-250414`, `AI_COMPLEX_MODEL=glm-4-flashx-250414`. This feeds the `modelName` the backend returns to the router (primary path).
  - Voice-provider `docker-compose.family.yml`: `FAMILY_LIGHTWEIGHT_MODEL=glm-4-flashx-250414`, `FAMILY_COMPLEX_MODEL=glm-4-flashx-250414`. Used when the backend times out / circuit is open (fallback path).
  - Voice-provider `data/.config.yaml`: default `selected_module.LLM = GLMLLM` → `base_url: https://open.bigmodel.cn/api/paas/v4`, Zhipu key required, `timeout.read: 40`.
  - Voice-provider `FAMILY_BACKEND_TIMEOUT_MS=5000` (was 2000; a cold weather lookup took 2.4s and tripped the old 2s timeout, causing the router to fall back to LLM chit-chat instead of returning the real weather).
- Mechanism note: device voice chat picks its model from `conn.family_model_name`, injected per-request in `core/connection.py:923` and passed as `model_name=` into every LLM call, which **overrides** `.config.yaml`'s default model (`core/providers/llm/.../openai.py`: `kwargs.get("model_name", self.model_name)`). Changing only `.config.yaml` does not affect device chat — the two env-var sources above must also be changed.
- Verified end-to-end 2026-07-12: `selected_model=glm-4-flashx-250414` in logs, weather ("爸爸，今天家晴，33℃…") and schedule tools return real data via function_call, member-context addressing ("爸爸") works. (ASR was later switched from Aliyun to Xunfei — see the 2026-07-12 ASR decision below.)
- Backups on host `192.168.31.246`: `.config.yaml.bak-deepseek-20260711-225213`, `.config.yaml.bak-glm-20260712-181210`, `docker-compose.family.yml.bak-deepseek-20260711-230939`.

## 2026-07-12: Family Permissions And Personas Live In Family Hub, Not The Voice Provider

- Status: `Accepted`
- Decision: The family mode / role permission system (默认→parent, 儿童→child, 访客→guest) and the family-member/persona model are owned by the Family Hub backend (`server/`). The self-hosted voice provider (`xinnan-tech/xiaozhi-esp32-server`) stays a generic voice pipeline and is not expected to enforce household permissions.
- Evidence (Family Hub, confirmed in code): `server/src/security.js` defines `POLICY` per mode with explicit tool allow/deny sets (child can play media/schedule/weather/english/memory but is denied `family.openclaw.run`, `family.homeassistant.scene`, `family.speaker.command`; guest is read-only-ish). `agents.js` calls `policyDecision()` before every tool execution and returns `denyResponse()` when not allowed. `member-context.js` provides parent/child/guest members with relationship and address ("爸爸"/"孩子"/"访客"), which drives personalized speech (e.g. "爸爸，今天…").
- Evidence (upstream voice provider, confirmed via research): stock `xiaozhi-esp32-server` has NO per-user RBAC, NO per-mode tool gating, and NO family-member entity in either the standalone Python tier (device-token auth only) or the full Java console tier (`superAdmin` boolean only, `sys_role` tables absent). Its `change_role` only swaps the system prompt (persona), voiceprint only personalizes addressing, and `roleConfig.vue` edits AI personas, not access-control roles. A family/child/guest mode is entirely custom work — correctly built in the Family Hub, not the voice provider.
- Implication for latency: the ONLY irreplaceable job of the voice-provider `family_page_router` intercept is to carry `familyMode` to the Family Hub for the permission check. Per the `selfhosted-voice-provider-page-agents` design.md, this can be restructured so `family_agent_ask` is a native `function_call` tool that passes `familyMode` as an argument and lets the Family Hub enforce policy at tool-execution time — preserving all permissions (still enforced by `security.js`) while removing the per-utterance synchronous backend hop that currently slows plain chit-chat. Not yet implemented; see [[family-ai-llm-chain]].
- Rule: do not look for or add household permission/role features in the voice provider. New permission, role, member, or content-policy logic belongs in `server/src/` (security.js / member-context.js / content-policy.js).

## 2026-07-12: Voice ASR Switched From Aliyun To Xunfei (iFlytek) Streaming

- Status: `Accepted`
- Decision: The self-hosted voice provider's ASR is switched from `AliyunBLStreamASR` (阿里百炼 `paraformer-realtime-v2`) to `XunfeiStreamASR` (讯飞流式听写, `type: xunfei_stream`). The previous Aliyun ASR block is retained in `.config.yaml` as a fallback (one-line switch back via `selected_module.ASR`).
- Reason: with Aliyun streaming ASR the user reported "beginning of the sentence not captured" / fragmented recognition — e.g. a full "今天天气怎么样" was split into "你。" / "是呢？" / "怎么样？". Root cause (confirmed by firmware + log reading): device runs `kListeningModeRealtime` (because `CONFIG_USE_DEVICE_AEC=y` → `aec_mode_ = kAecOnDeviceSide`, application.cc:1302), so it does NOT re-wake per turn; instead the Aliyun streaming ASR closes its stream on VAD silence and drops the head of the next utterance when re-establishing the stream (no pre-roll buffer). Xunfei streaming was chosen to test better head-of-utterance capture.
- Config (voice-provider `data/.config.yaml`, container path `/opt/xiaozhi-esp32-server/data/.config.yaml`):
  - `selected_module.ASR: XunfeiStreamASR`
  - `ASR.XunfeiStreamASR: { type: xunfei_stream, app_id, api_key, api_secret }` — iFlytek 语音听写 (iat) credentials; the APPID must have the 语音听写 service enabled and in-quota, or the server logs `错误码 11201, licc failed` and recognizes nothing (this happened first; user fixed it in the iFlytek console).
- VAD note: `min_silence_duration_ms` was temporarily raised 700→1500 to mitigate head-drop, then set back to **700** at the user's request after Xunfei was working (Xunfei recognized full sentences correctly in testing, so the longer silence wait was not needed).
- Verified 2026-07-12: after fixing the 11201 authorization, Xunfei recognizes full sentences (LLM replies tracked the user's actual words about a lost cat / kitchen), `selected_model=glm-4-flashx-250414`, full ASR→GLM→TTS chain healthy.
- Backups: `.config.yaml.bak-xunfei-20260712-131309`, `.config.yaml.bak-vad-20260712-185126`.

## 2026-07-12: Speaker Volume Forced To 100 On Boot

- Status: `Accepted`
- Decision: The firmware forces speaker output volume to 100 on every boot. `AudioCodec::Start()` sets `output_volume_ = 100` and persists it to NVS, ignoring any previously stored value. The header default (`audio_codec.h`) was also raised 70→100.
- Reason: the user reported the speaker was too quiet. Investigation found (a) the only volume input is the device MCP tool `self.audio_speaker.set_volume`; (b) the current LLM `glm-4-flashx-250414` repeatedly *claimed* to raise the volume ("好的，音量已调到最大！") without ever emitting the function_call — verified in logs by the absence of any `发送客户端mcp工具调用请求: self.audio_speaker.set_volume` line while the device heartbeat kept reporting volume 70; (c) there is no on-screen volume control. So the effective volume was stuck at the default 70 with no working way to raise it.
- Why the default change alone failed: `AudioCodec::Start()` does `output_volume_ = settings.GetInt("output_volume", output_volume_)` — it reads the NVS-stored value first, and the device already had 70 persisted (flashing the app partition does not clear NVS). Only force-writing 100 in `Start()` overrides the stale NVS value.
- Files: `main/audio/audio_codec.cc` (`Start()` force-set + persist), `main/audio/audio_codec.h` (`output_volume_ = 100`). Verified on real hardware 2026-07-12: after reflash the user confirmed the volume was audibly louder.
- Side effect / trade: volume now always resets to 100 at boot and cannot be persistently lowered. Acceptable because there is currently no reliable volume-adjust path anyway (LLM hallucinates the tool call, no screen control). Revisit when a real volume control exists (screen slider, or an LLM that reliably emits `set_volume`), then remove the forced write and honor NVS again.
- Related: this is the same `glm-4-flashx` weak-function_call behavior already noted for tools; it triggers `family_agent_ask`/weather reliably but skips `set_volume`. See [[family-ai-llm-chain]].

## 2026-07-12: Voice TTS Switched From Aliyun CosyVoice To Xunfei (iFlytek) Super-Realistic

- Status: `Accepted` (supersedes the Aliyun CosyVoice TTS in the 2026-07-12 "Voice Pipeline Configuration" snapshot)
- Decision: The self-hosted voice provider's TTS is switched from `AliBLTTS` (阿里百炼 CosyVoice `cosyvoice-v2`, voice `longcheng_v2`) to `XunFeiTTS` (讯飞 **超拟人合成 / super-realistic synthesis**, `type: xunfei_stream`, voice `x5_lingxiaoxuan_flow`). The previous `AliBLTTS` block is retained in `.config.yaml` as a fallback (one-line switch back via `selected_module.TTS`).
- Reason: user asked to move the whole voice stack onto iFlytek and off Aliyun ("换成讯飞的模型，不要用阿里云百炼"). ASR was already on iFlytek; this completes the move so ASR+TTS share one vendor and one APPID.
- IMPORTANT — provider only supports 超拟人合成, NOT 在线语音合成(流式版): the only iFlytek TTS provider bundled in `xinnan-tech/xiaozhi-esp32-server` is `core/providers/tts/xunfei_stream.py`, and it is hard-wired to the **超拟人合成** WebSocket endpoint `wss://cbm01.cn-huabei-1.xf-yun.com/v1/private/mcd9m97e6`. The user separately pointed at 讯飞「在线语音合成（流式版）」`wss://tts-api.xfyun.cn/v2/tts` — that is a DIFFERENT service with different auth/protocol and has **no** provider in this codebase (verified: no TTS provider references `tts-api.xfyun.cn`). Using `v2/tts` would require writing a new provider. User chose to stay on the bundled 超拟人合成 provider ("那现在还用这个吧").
- Config (voice-provider `data/.config.yaml`, container path `/opt/xiaozhi-esp32-server/data/.config.yaml`, host-mounted — always edit the host file):
  - `selected_module.TTS: XunFeiTTS`
  - `TTS.XunFeiTTS: { type: xunfei_stream, api_url: wss://cbm01.cn-huabei-1.xf-yun.com/v1/private/mcd9m97e6, app_id: 1484e00f, api_key, api_secret, voice: x5_lingxiaoxuan_flow, output_dir: tmp/ }` — reuses the SAME APPID `1484e00f` and iFlytek credentials as the ASR (iFlytek keys are per-APPID).
- Service-enablement caveat (mirrors the ASR 11201 lesson): iFlytek 超拟人合成 (uts) is a **separate purchasable service** from 语音听写 (iat/ASR). The shared APPID `1484e00f` must have 超拟人合成 enabled and in-quota at https://console.xfyun.cn/services/uts or the first synthesis fails with an authorization error — that is a console/quota action, not a config bug.
- TTS connects lazily: unlike ASR (which opens its WebSocket at startup), `xunfei_stream` TTS only connects on the first synthesis, so startup logs show no TTS connection line — real-device verification requires speaking one turn.
- Verification: end-to-end real-device synthesis confirmed on 2026-07-13 after boot 111. The ESP connected to router5, completed ASR -> GLM -> XunFeiTTS, received the spoken reply, and reported no TTS authorization or synthesis error.
- Backup: `.config.yaml.bak-*` created on host `192.168.31.246` before the edit.

## Conflict Rule

When a future conversation conflicts with these decisions, do not silently overwrite them. Add a new decision entry with:

- new evidence,
- test result,
- files changed,
- whether the old decision is still valid, amended or deprecated.
