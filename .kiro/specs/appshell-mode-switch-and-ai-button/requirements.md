# Requirements Document

## Introduction

This feature optimizes the persistent App Shell chrome of the Waveshare ESP32-S3 1.85B firmware on its 360x360 circular LVGL screen. The App Shell chrome consists of a top status bar, a content region, and a bottom status bar. This spec changes only the chrome; the per-page content-region redesign is explicitly out of scope and will be handled in a later effort.

Three chrome changes are in scope:

1. Replace the passive backend-status label in the top bar with an interactive Mode Switcher that lists and applies the four existing family modes (默认 / 儿童 / 夜间 / 访客).
2. Change the initial default mode to 儿童 only when there is no saved mode preference and the device is offline at initialization time; a previously saved mode is always respected and connectivity changes never force a mode switch.
3. Add a persistent AI activation button in the bottom arc, move the subtitle/marquee up one notch to make room, and fold the backend online/offline indication into the bottom marquee (since the top bar no longer shows backend status).

A fourth requirement keeps the existing 模式 (kFamilyMode) page as a read-only detail page, and documentation must be kept in sync.

Selecting a mode sets the role/permission context enforced by the backend Policy Engine for all Page Agents, so role identification during AI conversation is achieved through mode selection and requires no separate identity mechanism.

## Glossary

- **App_Shell**: The persistent firmware UI chrome comprising the top status bar, content region, and bottom status bar (implemented in `main/app_shell/app_shell.cc`).
- **Top_Bar**: The top status bar showing time, home button, page title, and (previously) backend status and settings button.
- **Mode_Switcher**: The interactive Top_Bar element that displays the current family mode name and opens the Mode_Popup when tapped.
- **Mode_Popup**: The overlay/popup (弹层) that lists the four family modes for selection.
- **Family_Mode**: One of the four modes: 默认, 儿童, 夜间, 访客. Persisted in Settings under namespace "appshell", key "family_mode".
- **Bottom_Bar**: The bottom status band containing the subtitle/marquee label and (new) the AI_Button.
- **AI_Button**: A persistent, arc-friendly control in the bottom arc that toggles the current page's Page Agent AI listening state.
- **Marquee**: The subtitle label (`subtitle_label_`) using LVGL LV_LABEL_LONG_SCROLL_CIRCULAR behavior, showing AI state, optional subtitle segment, and (new) backend-status token.
- **Page_Agent**: The per-page AI agent context; the current page's agent is activated by the AI_Button (Page Agent First), rather than force-navigating to the AI page.
- **Policy_Engine**: The backend component (server/src/fixtures.js policies) that enforces per-mode permission flags (music/ai/learning/apps/openclaw/homeControl/quiet).
- **Backend_Sync**: The action `family.mode` sent via `RunBackendAction`, which propagates the selected Family_Mode to the backend.
- **Settings_Store**: The persistent Settings storage (namespace "appshell").
- **Offline_State**: The condition where the backend is not reachable (`backend_.online == false`).
- **Mode_Detail_Page**: The existing kFamilyMode "模式" page, retained as read-only and not part of the BOOT navigation cycle.
- **Navigation_Doc**: The documentation file `docs/family-ai-os/03-page-navigation.md`.

## Requirements

### Requirement 1: Mode Switcher in the Top Bar

**User Story:** As a device user, I want to tap the top bar to see and choose the current family mode, so that I can switch modes directly without cycling through them.

#### Acceptance Criteria

1. THE Mode_Switcher SHALL display the name of the currently active Family_Mode.
2. WHEN the active Family_Mode changes, THE Mode_Switcher SHALL update its displayed text to the new Family_Mode name.
3. THE Mode_Switcher SHALL be tappable.
4. WHEN the user taps the Mode_Switcher, THE App_Shell SHALL open the Mode_Popup.
5. THE Mode_Popup SHALL list exactly the four Family_Mode options: 默认, 儿童, 夜间, 访客.
6. WHEN the user selects a Family_Mode from the Mode_Popup, THE App_Shell SHALL make the selected Family_Mode the active Family_Mode and close the Mode_Popup.
7. THE App_Shell SHALL replace the previous passive backend-status label (`header_state_label_` showing the fixed text "后端") with the Mode_Switcher.

### Requirement 2: Apply a Specific Selected Mode

**User Story:** As a device user, I want the mode I pick to be saved and communicated to the backend, so that my choice persists and takes effect consistently.

#### Acceptance Criteria

1. WHEN a Family_Mode is selected through the Mode_Popup, THE App_Shell SHALL set the active Family_Mode to the selected value.
2. WHEN a Family_Mode is selected, THE App_Shell SHALL persist the selected value to the Settings_Store under key "family_mode".
3. WHEN a Family_Mode is selected, THE App_Shell SHALL send the selected value to the backend via the `family.mode` Backend_Sync action.
4. WHEN a Family_Mode is applied, THE App_Shell SHALL re-render the current page so the change is reflected in the chrome.
5. THE App_Shell SHALL apply a specifically chosen Family_Mode through a dedicated `SetFamilyMode(mode)` path that reuses the same persistence, Backend_Sync, and render behavior as the existing `CycleFamilyMode` path.
6. IF the backend is in Offline_State when a Family_Mode is selected, THEN THE App_Shell SHALL persist the selection to the Settings_Store and update the local UI without blocking on the unavailable Backend_Sync.
7. WHEN a Family_Mode is selected while the backend is online, THE App_Shell SHALL set the role and permission context associated with that Family_Mode as enforced by the Policy_Engine.

### Requirement 3: Offline Initial Default Mode

**User Story:** As a parent setting up the device, I want a fresh device with no network to start in child mode, so that the device is safe by default before I configure it.

#### Acceptance Criteria

1. WHEN the App_Shell initializes AND no "family_mode" value exists in the Settings_Store AND the device is in Offline_State at that time, THE App_Shell SHALL set the initial active Family_Mode to 儿童.
2. WHEN the App_Shell initializes AND no "family_mode" value exists in the Settings_Store AND the device is not in Offline_State at that time, THE App_Shell SHALL set the initial active Family_Mode to 默认.
3. WHEN the App_Shell initializes AND a "family_mode" value exists in the Settings_Store, THE App_Shell SHALL set the active Family_Mode to the stored value regardless of connectivity.
4. WHILE the device is running after initialization, THE App_Shell SHALL retain the active Family_Mode when connectivity changes between online and Offline_State.
5. WHEN the device transitions into Offline_State after a Family_Mode has already been established, THE App_Shell SHALL keep the current Family_Mode unchanged.

### Requirement 4: Persistent AI Button in the Bottom Arc

**User Story:** As a device user, I want a persistent AI button at the bottom of the screen, so that I can start talking to the current page's AI from any page.

#### Acceptance Criteria

1. THE App_Shell SHALL display a persistent AI_Button in the Bottom_Bar arc region across all pages that show the App_Shell chrome.
2. THE AI_Button SHALL be rendered as an arc-friendly control (centered pill or round icon) positioned within the usable area of the circular 360x360 screen.
3. WHEN the user taps the AI_Button, THE App_Shell SHALL toggle AI listening for the current page's Page_Agent using the existing `ToggleAiListening` path.
4. WHEN the user taps the AI_Button, THE App_Shell SHALL activate the current page's Page_Agent without navigating away from the current page.
5. THE App_Shell SHALL keep the AI toggle behavior of the AI_Button consistent with the BOOT-button long-press behavior that toggles the chat state.

### Requirement 5: Marquee Reposition and Backend-Status Folding

**User Story:** As a device user, I want to still see whether the backend is online after the top-bar indicator is removed, so that I can tell the device's connection status from the bottom bar.

#### Acceptance Criteria

1. THE App_Shell SHALL position the Marquee higher than its previous baseline (kFooterTop = 330) to make room for the AI_Button in the bottom arc.
2. THE App_Shell SHALL preserve the existing LV_LABEL_LONG_SCROLL_CIRCULAR scrolling behavior of the Marquee after repositioning.
3. THE Marquee SHALL include a backend-status token that indicates whether the backend is online or in Offline_State.
4. WHEN the backend is online, THE Marquee SHALL present the backend-status token in its online form.
5. WHEN the backend is in Offline_State, THE Marquee SHALL present the backend-status token in its offline form.
6. WHILE the current backend state has not yet been confirmed after a state change, THE Marquee SHALL present the backend-status token using the last known backend state.
7. THE App_Shell SHALL continue to compose the Marquee text from the AI state text and the optional subtitle segment together with the backend-status token.
8. THE App_Shell SHALL keep the AI_Button and the repositioned Marquee within the non-clipped usable region of the circular screen.

### Requirement 6: Retain Mode Detail Page and Unchanged Page Content

**User Story:** As a maintainer, I want the existing mode page and all per-page content preserved, so that this change is limited to the persistent chrome.

#### Acceptance Criteria

1. THE App_Shell SHALL retain the existing kFamilyMode "模式" Mode_Detail_Page as a read-only page.
2. THE App_Shell SHALL keep the Mode_Detail_Page out of the BOOT navigation cycle.
3. THE App_Shell SHALL leave the per-page content-region rendering functionally unchanged for all pages.
4. THE App_Shell SHALL limit changes to the persistent chrome elements: `EnsureUi`, `UpdateHeader`, `UpdateSubtitle`, the new event handlers, and the Mode_Popup.

### Requirement 7: Documentation Synchronization

**User Story:** As a maintainer, I want the navigation documentation to match the shipped behavior, so that the docs remain the accurate acceptance baseline.

#### Acceptance Criteria

1. WHEN the Mode_Switcher replaces the top-bar backend status, THE Navigation_Doc SHALL be updated to describe the Top_Bar Mode_Switcher instead of the passive backend-status entry.
2. WHEN the AI_Button is added to the Bottom_Bar, THE Navigation_Doc SHALL be updated to describe the bottom-arc AI_Button.
3. THE Navigation_Doc SHALL be updated to state that backend online/offline status is now shown in the bottom Marquee.
4. THE Navigation_Doc SHALL be updated to reflect that the offline initial default Family_Mode is 儿童 when no preference is stored.
