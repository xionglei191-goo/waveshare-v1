# Requirements Document

## Introduction

This feature makes the ESP32-S3 round-screen device's in-page AI voice interaction reach the page-matching Page Agent ("Page Agent First") by adopting a self-hosted voice provider as an independent Voice Provider. The self-hosted voice provider is the open-source `xinnan-tech/xiaozhi-esp32-server`, deployed on the family LAN. It runs the realtime voice pipeline (VAD -> ASR -> LLM -> TTS) and routes page-scoped requests to the existing Family Backend Page Agents through a function-calling / MCP tool that calls `POST /api/agent/ask`.

The Family Backend (Node.js at 192.168.31.246:3100) remains the "brain" that owns agents, policy, tools and execution. It is NOT replaced. The self-hosted server is a replaceable runtime voice entrance that supplies streaming ASR/LLM/TTS and delegates all family decisions to the backend. Official Xiaozhi remains a low-latency fallback path.

The device change scope is intentionally minimal: switch the device's OTA/config discovery URL (plus optional auth token) so the device auto-learns the self-hosted WebSocket endpoint, and add reporting of the device's current one-level page (and family mode) so the voice provider can route each turn to the correct Page Agent. This feature does NOT rebuild the on-device ASR/TTS stack.

This document defines testable requirements for: voice-provider adoption and device OTA URL switch, current-page propagation and correct Page Agent routing, family-mode/permission context propagation, a latency target with a required streaming profile, fallback behavior, authentication/security, provider selection, and documentation synchronization.

## Glossary

- **Round_Screen_Device**: The Waveshare ESP32-S3 1.85B round-screen terminal running the AppShell firmware. It speaks the Xiaozhi WebSocket protocol (stt/tts/llm/listen/mcp messages) and does not run Agent or LLM logic.
- **Voice_Provider**: A replaceable runtime voice entrance that provides wake word / ASR / TTS / realtime conversation. The system supports more than one Voice_Provider.
- **Self_Hosted_Voice_Server**: The self-hosted deployment of `xinnan-tech/xiaozhi-esp32-server` on the family LAN, acting as the primary Voice_Provider. It runs VAD -> ASR -> LLM -> TTS and calls the Family_Backend.
- **Official_Xiaozhi**: The official Xiaozhi cloud voice service, retained as the low-latency fallback Voice_Provider.
- **Family_Backend**: The existing Node.js capability hub at 192.168.31.246:3100 that owns Page Agents, Policy Engine, capability tools, execution and audit. It exposes `POST /api/agent/ask`.
- **Agent_Ask_Endpoint**: The Family_Backend HTTP endpoint `POST /api/agent/ask` that accepts a `page` key, `utterance`, and optional `agent`, `user`, `familyMode`, `deviceId`, `pageState`, and both plans and executes in one call.
- **Page_Agent**: A per-page AI agent in the Family_Backend selected from the reported page key via `agentForPage()` (home, weather, schedule, ai/general, music/media, english, album, apps/tools, settings/device).
- **Family_Agent_Tool**: The tool `family.agent.ask` invoked by the Self_Hosted_Voice_Server, which calls the Agent_Ask_Endpoint. It is exposed either as a local function-calling plugin or as an MCP tool registered via `data/.mcp_server_settings.json`.
- **Current_Page**: The single one-level page currently shown on the Round_Screen_Device (for example home, weather, schedule, ai, music, album, english, apps, settings).
- **Page_Key**: The normalized lowercase backend page key derived from the device page enum and sent to the Self_Hosted_Voice_Server (kAskAi->ai, kMusic->music, kContent->album, kSettings/kSettings*->settings, kApps->apps, kHome->home, kWeather->weather, kSchedule->schedule, kEnglishPractice->english; screensaver/notifications/familymode/minigame use defined fallbacks).
- **Family_Mode**: One of the four modes 默认, 儿童, 夜间, 访客, used by the Family_Backend Policy Engine to enforce role/mode permissions.
- **OTA_Config_Endpoint**: The Xiaozhi OTA discovery endpoint (self-hosted form `http(s)://<host>:8003/xiaozhi/ota/`) that the Round_Screen_Device queries to auto-learn its voice WebSocket URL and optional auth token.
- **Voice_WebSocket_URL**: The realtime voice WebSocket endpoint auto-learned from the OTA_Config_Endpoint (self-hosted form `ws://<host>:8000/xiaozhi/v1/`).
- **Streaming_Profile**: The configured pipeline profile that uses streaming ASR, a fast time-to-first-token LLM, streaming TTS, and Intent mode `function_call`.
- **Intent_Function_Call**: The Self_Hosted_Voice_Server intent mode `function_call`, in which tool selection is inline in the LLM turn (no extra serial LLM hop).
- **Time_To_First_Audio**: The elapsed time from end of user speech (VAD end-of-utterance) to the first audio packet played on the Round_Screen_Device.
- **Voice_Provider_Auth_Token**: The optional authentication token required by the Self_Hosted_Voice_Server when server authentication is enabled.
- **Tool_Auth_Token**: The Family_Backend tool token (`XIAOZHI_TOOL_TOKEN`) required by the Family_Agent_Tool when tool authentication is enabled.
- **Architecture_Doc**: The documentation file `docs/family-ai-os/02-architecture.md`.
- **AI_Service_Doc**: The documentation file `docs/family-ai-os/11-ai-service-v1.md`.

## Requirements

### Requirement 1: Adopt the Self-Hosted Voice Provider

**User Story:** As a family operator, I want the round-screen device's realtime voice to run through a self-hosted voice server on my LAN, so that in-page voice reaches my Family Backend Page Agents while official Xiaozhi stays available as a fallback.

#### Acceptance Criteria

1. THE Self_Hosted_Voice_Server SHALL run the realtime voice pipeline consisting of voice activity detection, ASR, LLM, and TTS.
2. WHEN the Self_Hosted_Voice_Server produces a final ASR transcript for a voice turn, THE Self_Hosted_Voice_Server SHALL invoke the Family_Agent_Tool to reach the Page_Agent.
3. THE Self_Hosted_Voice_Server SHALL delegate family decisions to the Family_Backend through the Agent_Ask_Endpoint and SHALL NOT replace the Family_Backend as the owner of agents, policy, tools, or execution.
4. THE Family_Backend SHALL remain reachable at its existing address for the Agent_Ask_Endpoint.
5. WHERE both the Self_Hosted_Voice_Server and Official_Xiaozhi are configured, THE system SHALL treat the Self_Hosted_Voice_Server as the primary Voice_Provider and Official_Xiaozhi as the fallback Voice_Provider.

### Requirement 2: Device OTA/Config URL Switch

**User Story:** As a family operator, I want to point the device at the self-hosted voice server by changing only its OTA/config URL, so that the device auto-learns the new voice endpoint without rebuilding its voice stack.

#### Acceptance Criteria

1. THE Round_Screen_Device SHALL obtain its Voice_WebSocket_URL by querying the configured OTA_Config_Endpoint.
2. WHEN the OTA_Config_Endpoint is set to the Self_Hosted_Voice_Server address, THE Round_Screen_Device SHALL connect its realtime voice session to the Voice_WebSocket_URL returned by that endpoint.
3. WHERE the Self_Hosted_Voice_Server requires authentication, THE Round_Screen_Device SHALL present the Voice_Provider_Auth_Token learned from the OTA_Config_Endpoint when establishing the voice session.
4. THE Round_Screen_Device SHALL continue to use its existing on-device ASR/TTS handling behavior unchanged, limiting the on-device change to the OTA/config URL, the Voice_Provider_Auth_Token, current-page reporting, and Page_Key derivation.
5. IF the OTA_Config_Endpoint is unreachable at connection time, THEN THE Round_Screen_Device SHALL apply the fallback behavior defined in Requirement 6 regardless of whether cached configuration data is available.
6. WHERE cached configuration data or a default endpoint is available while applying fallback behavior, THE Round_Screen_Device SHALL establish the voice session using that cached URL or default endpoint.

### Requirement 3: Current-Page Propagation and Page Agent Routing

**User Story:** As a device user, I want my voice request on the current page to reach that page's agent, so that "continue" on the Music page resumes media and "status" on Settings runs device diagnostics.

#### Acceptance Criteria

1. THE Round_Screen_Device SHALL derive the Page_Key for its Current_Page using the defined page-enum-to-backend-key mapping.
2. THE Round_Screen_Device SHALL report its Current_Page Page_Key to the Self_Hosted_Voice_Server as session context.
3. WHEN the Current_Page changes on the Round_Screen_Device, THE Round_Screen_Device SHALL update the reported Page_Key immediately, independent of whether a voice turn begins.
4. WHEN the Self_Hosted_Voice_Server invokes the Family_Agent_Tool for a voice turn, THE Self_Hosted_Voice_Server SHALL pass the most recently reported Page_Key as the `page` argument to the Agent_Ask_Endpoint.
5. WHEN the Agent_Ask_Endpoint receives a request with a valid Page_Key, THE Family_Backend SHALL route the request to the Page_Agent that `agentForPage()` maps to that Page_Key.
6. IF the reported Page_Key is empty or unrecognized, THEN THE Family_Backend SHALL route the request to the general agent.
7. WHERE the Round_Screen_Device is on a page outside the one-level page set (screensaver, notifications, family-mode, or mini-game), THE Round_Screen_Device SHALL report the defined fallback Page_Key for that page.

### Requirement 4: Family Mode and Permission Context

**User Story:** As a parent, I want the current family mode carried with each voice request, so that the backend Policy Engine applies the correct permissions to agent actions.

#### Acceptance Criteria

1. THE Round_Screen_Device SHALL report its current Family_Mode to the Self_Hosted_Voice_Server as session context.
2. WHEN the Self_Hosted_Voice_Server invokes the Family_Agent_Tool, THE Self_Hosted_Voice_Server SHALL pass the reported Family_Mode as the `familyMode` argument to the Agent_Ask_Endpoint.
3. WHEN the Current_Page Family_Mode changes on the Round_Screen_Device, THE Round_Screen_Device SHALL update the reported Family_Mode before the next voice turn begins.
4. IF the Family_Agent_Tool would be invoked without a reported Family_Mode, THEN THE Self_Hosted_Voice_Server SHALL defer the tool invocation until a Family_Mode is available.
5. WHEN the Family_Backend evaluates an agent action, THE Family_Backend SHALL enforce the Policy Engine permissions for the reported Family_Mode.

### Requirement 5: Latency Target and Streaming Profile

**User Story:** As a device user, I want spoken replies to start quickly, so that talking to the self-hosted provider feels as responsive as the official service.

#### Acceptance Criteria

1. THE Self_Hosted_Voice_Server SHALL operate with the Streaming_Profile using streaming ASR, a fast time-to-first-token LLM, streaming TTS, and Intent_Function_Call.
2. WHEN a user completes a spoken page-local request under normal LAN conditions, THE Self_Hosted_Voice_Server SHALL achieve a Time_To_First_Audio of 1500 milliseconds or less.
3. THE Self_Hosted_Voice_Server SHALL resolve tool selection inline within the LLM turn using Intent_Function_Call rather than an additional serial LLM classification hop.
4. WHEN the user begins speaking while a spoken reply is playing, THE Self_Hosted_Voice_Server SHALL abort the current playback to allow barge-in, and MAY take a cleanup delay to fully stop audio processing before accepting new input.

### Requirement 6: Fallback Behavior

**User Story:** As a device user, I want voice to keep working when the self-hosted server or a page agent cannot serve me, so that I still get a useful answer.

#### Acceptance Criteria

1. IF the Self_Hosted_Voice_Server is unreachable at voice-session connection time, THEN THE Round_Screen_Device SHALL connect to Official_Xiaozhi as the fallback Voice_Provider.
2. WHEN a reported Page_Key does not match a specific domain Page_Agent, THE Family_Backend SHALL return a general-agent answer rather than failing the request.
3. IF the Agent_Ask_Endpoint is unreachable during a voice turn, THEN THE Self_Hosted_Voice_Server SHALL produce a general spoken answer from its LLM without a Family_Backend tool action and without indicating that backend-dependent features are reduced.
4. THE system SHALL use a single active Voice_Provider per voice session rather than switching the realtime voice WebSocket endpoint per page.
5. WHEN the Self_Hosted_Voice_Server becomes reachable again after a fallback to Official_Xiaozhi, THE Round_Screen_Device SHALL prefer the Self_Hosted_Voice_Server on the next voice-session connection.

### Requirement 7: Authentication and Security

**User Story:** As a family operator, I want the self-hosted voice server and backend tool access protected on my LAN, so that only authorized devices can use them.

#### Acceptance Criteria

1. WHERE Self_Hosted_Voice_Server authentication is enabled, THE Self_Hosted_Voice_Server SHALL reject voice sessions that do not present a valid Voice_Provider_Auth_Token.
2. WHERE Family_Agent_Tool authentication is enabled, THE Family_Backend SHALL reject Agent_Ask_Endpoint calls that do not present a valid Tool_Auth_Token.
3. THE Self_Hosted_Voice_Server SHALL be deployed for family LAN access, and any exposure beyond the LAN SHALL require authentication to be enabled.
4. IF a voice session presents an invalid Voice_Provider_Auth_Token, THEN THE Self_Hosted_Voice_Server SHALL deny the session and SHALL NOT start the voice pipeline.
5. THE Self_Hosted_Voice_Server SHALL exclude secret values, including the Voice_Provider_Auth_Token and Tool_Auth_Token, from spoken and displayed responses.

### Requirement 8: Provider Selection

**User Story:** As a family operator, I want a defined set of streaming ASR/LLM/TTS providers configured, so that the deployment meets the latency target predictably.

#### Acceptance Criteria

1. THE Self_Hosted_Voice_Server SHALL be configured with a streaming ASR provider.
2. THE Self_Hosted_Voice_Server SHALL be configured with an LLM provider that supports fast time-to-first-token streaming and function calling.
3. THE Self_Hosted_Voice_Server SHALL be configured with a streaming TTS provider.
4. THE Self_Hosted_Voice_Server SHALL set the intent mode to Intent_Function_Call in its selected-module configuration.
5. THE selected ASR, LLM, and TTS providers SHALL be recorded in the deployment configuration so the Streaming_Profile is reproducible.

### Requirement 9: Documentation Synchronization

**User Story:** As a maintainer, I want the family-ai-os docs to describe the self-hosted Voice Provider architecture and Page Agent First routing, so that the documentation remains the accurate baseline.

#### Acceptance Criteria

1. WHEN the Self_Hosted_Voice_Server is adopted as the primary Voice_Provider, THE Architecture_Doc SHALL be updated to describe the Self_Hosted_Voice_Server as an independent Voice_Provider with Official_Xiaozhi as fallback.
2. THE Architecture_Doc SHALL be updated to describe current-page propagation from the Round_Screen_Device to the Self_Hosted_Voice_Server and Page_Agent routing through the Family_Agent_Tool.
3. THE AI_Service_Doc SHALL be updated to describe how the Self_Hosted_Voice_Server invokes the Family_Agent_Tool with the `page` and `familyMode` arguments.
4. THE Architecture_Doc SHALL be updated to state the latency target and the required Streaming_Profile.
5. THE Architecture_Doc SHALL be updated to state the fallback behavior between the Self_Hosted_Voice_Server and Official_Xiaozhi.
