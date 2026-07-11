# Implementation Plan: Self-hosted Voice Provider Page Agents

## Overview

This implementation plan converts the feature design into discrete coding and deployment tasks for adopting a self-hosted voice provider (`xiaozhi-esp32-server`) on the family LAN, with page-matching Page Agent routing. The work is organized into five groups:

1. **Device-side infrastructure** — `PageToBackendKey()` helper + MCP tool `self.page.get_context`
2. **Self-hosted server deployment** — Docker bring-up + Streaming Profile configuration
3. **Family_Agent_Tool plugin** — `family.agent.ask` function-calling plugin
4. **Integration testing** — End-to-end page routing, latency, fallback, auth
5. **Documentation sync** — Update architecture and AI service docs

---

## Tasks

### Group 1: Device-side Infrastructure

- [x] 1. Implement `PageToBackendKey()` helper function
  - Add pure function `PageToBackendKey(AppShell::Page)` in `main/app_shell/app_shell.cc` (anonymous namespace)
  - Map all `AppShell::Page` enum values to backend `Page_Key` per the mapping table (kAskAi→ai, kMusicLocal/kMusicServer→music, kContent→album, kSettings*→settings, kApps→apps, kHome→home, kWeather→weather, kSchedule→schedule, kEnglishPractice→english, kScreensaver/kNotifications/kFamilyMode→home, kMiniGame→apps)
  - Return `"home"` as default fallback
  - Keep function pure (no I/O, no locks) for testability
  - _Requirements: 3.1, 3.7_

  - [ ]* 1.1 Write property test for `PageToBackendKey()` mapping
    - **Property 1: Page-to-backend-key mapping is total and in-range**
    - Test that for all `AppShell::Page` enum values, the returned key is non-empty and in `{ai, music, album, settings, apps, home, weather, schedule, english}`
    - Verify all `kSettings*` → `settings`, `kMusicLocal`/`kMusicServer` → `music`, out-of-one-level pages map to correct fallbacks
    - Tag: **Feature: selfhosted-voice-provider-page-agents, Property 1: Page-to-backend-key mapping is total and in-range**
    - _Requirements: 3.1, 3.7_

- [x] 2. Add `AppShell` accessors for current page key and family mode
  - Add `std::string CurrentPageKey() const` returning `PageToBackendKey(page_)`
  - Add `std::string CurrentFamilyMode() const` returning `family_mode_`
  - Ensure thread-safe reads of existing members
  - _Requirements: 3.2, 4.1_

- [x] 3. Implement MCP tool `self.page.get_context`
  - Register new MCP tool in `McpServer` initialization (mirrors `self.get_device_status`)
  - Tool returns JSON with `page` (from `CurrentPageKey()`) and `familyMode` (from `CurrentFamilyMode()`)
  - Description: "Returns the device's current one-level page key and family mode for routing the family.agent.ask tool."
  - _Requirements: 3.2, 3.3, 4.1, 4.3_

- [x] 4. Checkpoint — Device infrastructure ready
  - Verify property test passes
  - Verify MCP tool returns expected values via manual check
  - Ask the user if questions arise.

### Group 2: Self-hosted Server Deployment and Configuration

- [ ] 5. Deploy `xiaozhi-esp32-server` Docker container on family LAN
  - Clone `xinnan-tech/xiaozhi-esp32-server` repository
  - Build and run Docker container with ports: OTA `:8003`, voice WS `:8000`
  - Verify server starts and pipeline loads without errors
  - _Requirements: 1.1, 1.3, 1.4_

- [x] 6. Configure Streaming Profile in `data/.config.yaml`
  - Set `selected_module` with streaming ASR (e.g., `DoubaoStreamASR`), fast-TTFT LLM (e.g., `OpenAILLM` with `qwen-flash`), streaming TTS (e.g., `HuoshanDoubleStreamTTS`), and `Intent: function_call`
  - Configure provider credentials (ASR appid/token, LLM base_url/model_name/api_key, TTS appid/token)
  - Set `Memory: nomem`
  - _Requirements: 5.1, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 7. Enable server authentication
  - Set `server.auth.enabled: true`
  - Add `Voice_Provider_Auth_Token` under `server.auth.tokens`
  - Ensure token is surfaced through OTA `websocket.token` field
  - _Requirements: 7.1, 7.3, 7.4_

- [ ] 8. Configure device OTA URL to point to self-hosted server
  - Set `Settings("wifi").ota_url` to `http://<host>:8003/xiaozhi/ota/` (via device WiFi/OTA config UI or provisioning)
  - Verify device auto-learns `Voice_WebSocket_URL` and `Voice_Provider_Auth_Token` from OTA response
  - Verify device connects voice session to self-hosted server
  - _Requirements: 2.1, 2.2, 2.3, 2.5_

- [ ] 9. Checkpoint — Server deployment verified
  - Run single voice turn through self-hosted server
  - Confirm OTA discovery works
  - Ask the user if questions arise.

### Group 3: Family_Agent_Tool Plugin Development

- [x] 10. Create `family_agent_ask.py` plugin function
  - Create file under `plugins_func/functions/family_agent_ask.py`
  - Implement function schema with parameters: `page`, `utterance`, `familyMode`, `deviceId`, `pageState`, `confirmed`
  - HTTP POST to `Agent_Ask_Endpoint` (`http://192.168.31.246:3100/api/agent/ask`)
  - Add `Tool_Auth_Token` from env `XIAOZHI_TOOL_TOKEN` as `Authorization: Bearer <token>` header
  - _Requirements: 1.2, 3.4, 4.2, 7.2_

- [x] 11. Register plugin in function-calling tool list
  - Add tool to server's function-calling tool registry
  - Set tool description: "Route a page-scoped family request to the Family Backend Page Agent. Always call self.page.get_context first and pass the returned page and familyMode."
  - _Requirements: 1.2, 5.3_

- [x] 12. Implement MCP context read before tool invocation
  - Server reads `self.page.get_context` via device MCP channel
  - Inject `page` and `familyMode` into tool arguments
  - Ensure fresh context is read at tool-invocation time
  - _Requirements: 3.4, 4.2_

- [x] 13. Implement secret redaction in plugin response
  - Strip `Voice_Provider_Auth_Token` and `Tool_Auth_Token` from `speech` and `display` fields
  - Ensure secrets never appear in TTS/UI
  - _Requirements: 7.5_

  - [ ]* 13.1 Write unit test for secret redaction
    - Test that token values are stripped from response `speech`/`display`
    - _Requirements: 7.5_

- [ ] 14. Checkpoint — Family_Agent_Tool wired
  - Verify tool is invoked with correct parameters
  - Verify backend receives and responds correctly
  - Ask the user if questions arise.

### Group 4: Integration Testing and Verification

- [ ] 15. Verify end-to-end page routing
  - On each page (home, weather, schedule, ai, music, album, apps, settings, english), speak a page-local request
  - Confirm request reaches correct Page Agent (e.g., "继续" on Music → media agent, "状态" on Settings → device agent)
  - _Requirements: 3.2, 3.3, 3.5, 4.1, 4.2, 4.5_

- [ ] 16. Verify fallback behavior
  - Block self-hosted OTA/WS → confirm device connects to Official Xiaozhi
  - Take backend down mid-turn → confirm general spoken answer without disclaimer
  - Recover self-hosted server → confirm next connect prefers self-hosted
  - Confirm single Voice Provider per session
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 17. Verify authentication
  - Test invalid `Voice_Provider_Auth_Token` → confirm session denied, pipeline not started
  - Test invalid `Tool_Auth_Token` → confirm backend rejects `/api/agent/ask`
  - _Requirements: 7.1, 7.2, 7.4_

- [ ] 18. Measure latency
  - Use server's `performance_tester` tool and end-to-end timing under LAN
  - Confirm `Time_To_First_Audio` ≤ 1500 ms
  - Verify single LLM classification hop in turn trace (Intent_Function_Call)
  - _Requirements: 5.2, 5.3_

- [ ] 19. Verify barge-in behavior
  - Speak during TTS playback → confirm playback aborts
  - Confirm short cleanup delay before accepting new input
  - _Requirements: 5.4_

- [ ] 20. Verify on-device audio handling unchanged
  - Confirm existing voice behavior works
  - Run regression smoke test
  - _Requirements: 2.4_

- [ ] 21. Final checkpoint — All integration verified
  - Ensure all tests pass
  - Document any deviations or issues
  - Ask the user if questions arise.

### Group 5: Documentation Synchronization

- [x] 22. Update `docs/family-ai-os/02-architecture.md`
  - Describe Self_Hosted_Voice_Server as independent primary Voice Provider with Official Xiaozhi fallback
  - Document current-page propagation from device to voice server
  - Document Page Agent routing through Family_Agent_Tool
  - State latency target (≤1500ms) and required Streaming_Profile
  - Document fallback behavior between Self_Hosted_Voice_Server and Official_Xiaozhi
  - _Requirements: 9.1, 9.2, 9.4, 9.5_

- [x] 23. Update `docs/family-ai-os/11-ai-service-v1.md`
  - Document how Self_Hosted_Voice_Server invokes Family_Agent_Tool with `page` and `familyMode` arguments
  - _Requirements: 9.3_

- [x] 24. Final checkpoint — Documentation complete
  - Review all doc updates
  - Ensure consistency with implementation
  - Ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Group dependencies:
  - Group 2 depends on Group 1 (MCP tool for context)
  - Group 3 depends on Group 2 (server running)
  - Group 4 depends on Groups 1-3 (full stack)
  - Group 5 can run in parallel with Groups 1-4 but should be finalized after Group 4
