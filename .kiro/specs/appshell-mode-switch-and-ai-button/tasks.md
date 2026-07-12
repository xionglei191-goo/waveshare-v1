# Implementation Plan: App Shell Mode Switcher & AI Button

## Overview

Implement the App Shell chrome changes in `main/app_shell/app_shell.cc` / `app_shell.h` (ESP-IDF /
LVGL firmware for the 360x360 circular panel). The plan builds incrementally: first extract three pure
decision/composition helpers (testable without LVGL or NVS) and cover them with property-based tests,
then introduce the `SetFamilyMode` apply path, the offline initial-default logic, the top-bar Mode
Switcher, the on-demand Mode Popup overlay, the persistent bottom-arc AI button, the marquee reposition
with backend-status folding, and finally build/verify and documentation sync. Each step wires directly
into the existing `EnsureUi` / `UpdateHeader` / `UpdateSubtitle` / `SetPage` flow so no code is left
orphaned.

Implementation language: C++ (ESP-IDF, matching the existing firmware). Property tests use a host or
ESP-IDF unit-test component with a property library (e.g., RapidCheck), each running ≥100 iterations.

## Tasks

- [x] 1. Extract pure decision/composition helpers into the anonymous namespace
  - [x] 1.1 Add `NextFamilyMode`, `ChooseInitialFamilyMode`, and `ComposeFooterText` to the anonymous namespace in `main/app_shell/app_shell.cc`
    - Implement `std::string NextFamilyMode(const std::string& current)` encoding the fixed cycle 默认→儿童→夜间→访客→默认 (unknown/empty falls back to 默认→儿童 start of cycle)
    - Implement `std::string ChooseInitialFamilyMode(const std::string& stored, bool has_stored, bool offline_at_init)`: return `stored` when `has_stored`, else "儿童" when `offline_at_init`, else "默认"
    - Implement `std::string ComposeFooterText(const std::string& ai_state_text, const std::string& subtitle, bool page_is_ask_ai, bool backend_online)`: begins with `ai_state_text`, appends `" | " + subtitle` only when not AskAi page and subtitle is non-empty and not equal to `ai_state_text` or "AI 待命", then appends exactly one backend-status token (" · 在线" / " · 离线")
    - Keep all three free of LVGL and NVS dependencies so they are host-testable
    - Ensure they compile into the existing translation unit (no callers yet — wired in later tasks)
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 5.3, 5.4, 5.5, 5.7_

  - [x]* 1.2 Write property test for `ChooseInitialFamilyMode`
    - **Feature: appshell-mode-switch-and-ai-button, Property 1: Initial family-mode decision table**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - Generator over {stored ∈ modes ∪ arbitrary strings} × {has_stored} × {offline_at_init}; assert stored wins when has_stored, else 儿童 when offline else 默认
    - Minimum 100 iterations

  - [x]* 1.3 Write property test for `NextFamilyMode` cycle and settings round-trip
    - **Feature: appshell-mode-switch-and-ai-button, Property 2: Family-mode cycle and persistence round-trip**
    - **Validates: Requirements 2.1, 2.2, 2.5**
    - Generator over the four-mode set; assert applying `NextFamilyMode` four times returns to start, and write/read of key "family_mode" against an in-memory settings fake is identity
    - Minimum 100 iterations

  - [x]* 1.4 Write property test for `ComposeFooterText`
    - **Feature: appshell-mode-switch-and-ai-button, Property 3: Footer composition and backend-status token**
    - **Validates: Requirements 5.3, 5.4, 5.5, 5.7**
    - Generators over AI-state strings, subtitle strings (incl. empty, equal-to-AI-state, "AI 待命"), page flag, backend-online flag; assert prefix is AI-state text, subtitle-inclusion rule holds, and exactly one trailing token in correct online/offline form
    - Minimum 100 iterations

- [x] 2. Add `SetFamilyMode` apply path and refactor `CycleFamilyMode`
  - [x] 2.1 Declare `void SetFamilyMode(const std::string& mode);` in `app_shell.h` next to `CycleFamilyMode`
    - _Requirements: 2.5_

  - [x] 2.2 Implement `AppShell::SetFamilyMode` as the single source of truth for applying a mode
    - Set `family_mode_ = mode`, persist to `Settings("appshell", true)` under key "family_mode", set `subtitle_ = "家庭模式: " + family_mode_`, dispatch `RunBackendAction("family.mode", "{\"mode\":\"" + family_mode_ + "\"}")`, then `SetPage(page_)` to re-render chrome
    - Rely on the existing non-blocking backend action dispatch so an offline backend does not block persistence/UI (R2.6)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7_

  - [x] 2.3 Refactor `CycleFamilyMode` to delegate to `SetFamilyMode(NextFamilyMode(family_mode_))`
    - Preserve exact external behavior (same persistence, subtitle, backend action, re-render) previously done inline
    - _Requirements: 2.1, 2.5_

  - [x]* 2.4 Write unit/mock example tests for `SetFamilyMode`
    - Assert `family.mode` sent with selected payload (mock `RunBackendAction`) and `SetPage(page_)` triggered; offline apply persists + updates UI without blocking
    - _Requirements: 2.3, 2.4, 2.6_

- [x] 3. Implement offline initial-default logic in initialization
  - [x] 3.1 Replace the init read of `family_mode_` with the empty-string sentinel + `ChooseInitialFamilyMode`
    - Read `stored = settings.GetString("family_mode", "")`; compute `has_stored = !stored.empty()` and `offline_at_init = !AppConnectivityManager::GetInstance().status().online` (after the existing `Refresh()`); set `family_mode_ = ChooseInitialFamilyMode(stored, has_stored, offline_at_init)`
    - Ensure the decision runs exactly once at init; do not add any connectivity callback that rewrites `family_mode_`; leave `OnBackendSnapshot` mode-sync unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Repurpose the top-bar label into the tappable Mode Switcher
  - [x] 4.1 Add `lv_obj_t* mode_switch_btn_ = nullptr;` member and build it in `EnsureUi`
    - Where `header_state_label_` was created, build `mode_switch_btn_ = CreateButton(root_, FamilyModeText(), 30, 27, 60, 30, OnOpenModePopup, false, LV_EVENT_PRESSED, 8);` and remove the passive `header_state_label_` usage
    - _Requirements: 1.1, 1.3, 1.7_

  - [x] 4.2 Add a `SetButtonText(lv_obj_t* button, const char* text)` helper and update `UpdateHeader`
    - `SetButtonText` gets the button's child label (`lv_obj_get_child(button, 0)`) and sets its text; in `UpdateHeader` replace the forced-"后端" logic with `SetButtonText(mode_switch_btn_, FamilyModeText())`
    - _Requirements: 1.1, 1.2, 1.7_

  - [x] 4.3 Add the `OnOpenModePopup` free-function handler wired to open the popup
    - `void OnOpenModePopup(lv_event_t*) { Schedule(OpenModePopupAction); }` and `OpenModePopupAction()` → `AppShell::GetInstance().OpenModePopup();`
    - _Requirements: 1.3, 1.4_

- [~] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement the Mode Popup overlay
  - [x] 6.1 Add `lv_obj_t* mode_popup_ = nullptr;` member and implement `AppShell::OpenModePopup`
    - Build a semi-opaque full-`root_` scrim (child of `root_`, sized to `display_->width() x display_->height()`), idempotent (no-op if `mode_popup_ != nullptr`), with a centered `CreatePanel` holding four `CreateButton` rows for 默认/儿童/夜间/访客; highlight the active row via the `active` flag; stash the mode index in `lv_obj_set_user_data`; `lv_obj_move_foreground`
    - Register `OnDismissModePopup` on the scrim for `LV_EVENT_PRESSED` (outside-tap dismiss)
    - _Requirements: 1.5_

  - [x] 6.2 Implement mode-selection handlers → `CloseModePopup` + `SetFamilyMode`
    - `OnSelectMode` resolves the tapped row's index to a mode string (via user_data), schedules an action that calls `CloseModePopup()` then `SetFamilyMode(mode)` (use dedicated per-mode actions or a Schedule overload consistent with existing style)
    - _Requirements: 1.6, 2.1_

  - [x] 6.3 Implement `CloseModePopup`, `OnDismissModePopup`, and defensive teardown
    - `CloseModePopup` deletes the overlay via `lv_obj_del(mode_popup_)` under `DisplayLockGuard` and nulls `mode_popup_`; `OnDismissModePopup` schedules `CloseModePopup`; call `CloseModePopup()` at the start of `SetPageLocked` so page changes never leave an orphan overlay
    - _Requirements: 1.6, 6.4_

  - [x]* 6.4 Write unit/example tests for popup lifecycle
    - Popup builds exactly four rows labelled 默认/儿童/夜间/访客; selecting a row applies that mode and tears down the overlay; `OpenModePopup` is idempotent
    - _Requirements: 1.5, 1.6, 6.4_

- [x] 7. Add the persistent bottom-arc AI button and reposition the marquee
  - [x] 7.1 Add layout constants and build the AI button in `EnsureUi`
    - Add `kAiButtonTop`/`kAiButtonWidth`/`kAiButtonHeight` and change `kFooterTop` 330→316; build `ai_button_ = CreateButton(root_, "AI", 0, kAiButtonTop, kAiButtonWidth, kAiButtonHeight, OnToggleAi, false, LV_EVENT_PRESSED, 6);` as a child of `root_` so it is present on every chrome page and wired to the existing `OnToggleAi`→`ToggleAiListening` path
    - Confirm the marquee (`subtitle_label_`) now positions via the updated `kFooterTop` while keeping height 18, `kFooterWidth`, and `LV_LABEL_LONG_SCROLL_CIRCULAR`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.8_

  - [x] 7.2 Fold the backend-status token into `UpdateSubtitle` via `ComposeFooterText`
    - Replace the inline footer composition with `ComposeFooterText(AiStateText(), subtitle_, page_ == kAskAi, backend_.online)`, preserving the existing CLIP-vs-SCROLL selection and using `backend_.online` as the last-known backend state
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 8. Verify Mode Detail Page and per-page content remain unchanged
  - Confirm kFamilyMode "模式" page stays read-only and is not added to the BOOT cycle (`ShowNextApp` excludes it), and that no per-page content rendering was modified; this is a verification/checkpoint (no code change expected)
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 9. Build gate and on-device verification
  - [x] 9.1 Run `idf.py build` and fix any new errors/warnings
    - Resolve compilation issues introduced by `EnsureUi`, `UpdateHeader`, `UpdateSubtitle`, `SetFamilyMode`/`CycleFamilyMode`, init default logic, and the new handlers/popup; confirm a clean build
    - _Requirements: 6.4_

  - [ ]* 9.2 Execute on-device manual verification checklist
    - Confirm switcher tap opens popup and label updates on selection; outside-tap dismiss; four rows 默认/儿童/夜间/访客; touch targets not clipped by the bezel (adjust `kAiButtonTop`/`kAiButtonHeight` if needed); marquee scrolls long text circularly and shows backend token matching connectivity; AI button toggles listening without navigation on multiple pages; mode persists across reboot; offline fresh-default = 儿童, online fresh-default = 默认; connectivity toggling after init does not change mode
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_

- [x] 10. Documentation sync
  - Update `docs/family-ai-os/03-page-navigation.md` to describe the top-bar Mode Switcher (replacing the passive backend-status entry), the bottom-arc AI button, backend online/offline status shown in the bottom marquee, and the 儿童 offline initial default when no preference is stored
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

## Notes

- Tasks marked with `*` are optional (property tests, unit/example tests, on-device manual verification) and can be skipped for a faster MVP; core implementation and the build gate are not optional.
- Each task references specific requirement clause numbers for traceability; every requirement R1–R7 is covered by at least one task.
- Property tests validate the three universal correctness properties from the design; unit/example tests and on-device checks cover the LVGL wiring and geometry that are not property-testable.
- Checkpoints ensure incremental validation; the build gate (9.1) is the primary automated gate for this ESP-IDF firmware.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["2.3", "2.4"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3"] },
    { "id": 8, "tasks": ["6.4", "7.1"] },
    { "id": 9, "tasks": ["7.2"] },
    { "id": 10, "tasks": ["9.1"] },
    { "id": 11, "tasks": ["9.2", "10"] }
  ]
}
```
