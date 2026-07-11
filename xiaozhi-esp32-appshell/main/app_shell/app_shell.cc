#include "app_shell.h"

#include "app_audio_session_manager.h"
#include "application.h"
#include "app_connectivity_manager.h"
#include "app_local_music_player.h"
#include "app_remote_page.h"
#include "app_resource_manager.h"
#include "app_server_music_player.h"
#include "app_storage_manager.h"
#include "app_sync_queue.h"
#include "assets/lang_config.h"
#include "board.h"
#include "display.h"
#include "settings.h"
#include "system_info.h"

#include <cJSON.h>
#include <esp_app_desc.h>
#include <esp_log.h>
#include <esp_heap_caps.h>
#include <esp_jpeg_common.h>
#include <esp_jpeg_dec.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/idf_additions.h>
#include <freertos/task.h>
#include <lvgl.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <vector>

namespace {
constexpr const char* TAG = "AppShell";

constexpr uint32_t kRootBg = 0x080b10;
constexpr uint32_t kPanelBg = 0x141b24;
constexpr uint32_t kPanelSoftBg = 0x1d2732;
constexpr uint32_t kPanelActiveBg = 0x17362f;
constexpr uint32_t kBorder = 0x2d3a46;
constexpr uint32_t kText = 0xf3f7fb;
constexpr uint32_t kMutedText = 0x94a3b2;
constexpr uint32_t kAccent = 0x63e6be;
constexpr uint32_t kAccentBlue = 0x6aa8ff;
constexpr uint32_t kWarm = 0xffc857;
constexpr uint32_t kDanger = 0xff7a7a;
constexpr int kContentWidth = 300;
constexpr int kContentTop = 58;
constexpr int kContentHeight = 268;
constexpr int kFooterTop = 304;
constexpr int kFooterWidth = 156;
constexpr int kAiButtonTop = 326;
constexpr int kAiButtonWidth = 88;
constexpr int kAiButtonHeight = 26;
constexpr int kActionTop = 214;
constexpr int kSafeActionTop = 204;
constexpr int kSafeActionHeight = 34;
constexpr int kTileWidth = 132;
constexpr int kTileHeight = 52;
constexpr int kTileColumnX = 70;
constexpr int kBackendRefreshIntervalSec = 30;
constexpr int kBackendStartupDelaySec = 12;
constexpr int kBackendEventProbeIntervalSec = 5;
constexpr int kBackendResumeDelaySec = 3;
constexpr int kDeviceHeartbeatIntervalSec = 60;
constexpr int kPageContextRefreshIntervalSec = 60;
constexpr int kRemotePageRefreshIntervalSec = 90;
constexpr int kResourceManifestRefreshIntervalSec = 300;
constexpr int kScreensaverIdleSec = 120;
constexpr int kPomodoroFocusSec = 25 * 60;
constexpr int kPomodoroBreakSec = 5 * 60;
constexpr int kScreensaverImageWidth = 192;
constexpr int kScreensaverImageHeight = 104;
constexpr size_t kMaxScreensaverJpegBytes = 2 * 1024 * 1024;
constexpr size_t kSramSoftReserveBytes = 16 * 1024;
constexpr size_t kSramCriticalReserveBytes = 12 * 1024;

struct BackendRefreshContext {
    bool force = false;
    int requested_tick = 0;
};

struct BackendActionContext {
    std::string action;
    std::string params;
};

void Schedule(void (*handler)()) {
    Application::GetInstance().Schedule([handler]() {
        handler();
    });
}

// Pure decision/composition helpers (no LVGL / NVS dependency) so they can be
// host/property tested independently. Wired into callers by later tasks.

// Encodes the fixed user-mode cycle 默认(parent)→儿童→访客→默认.
// Retired or unknown modes, including older "夜间", map to 默认.
std::string NextFamilyMode(const std::string& current) {
    if (current == "默认") {
        return "儿童";
    } else if (current == "儿童") {
        return "访客";
    } else {
        return "默认";
    }
}

std::string NormalizeFamilyMode(const std::string& mode) {
    return (mode == "儿童" || mode == "访客") ? mode : "默认";
}

// Chooses the initial family mode at App Shell init: a stored preference always
// wins; otherwise a fresh device starts in 儿童 when offline at init and 默认 when
// online.
std::string ChooseInitialFamilyMode(const std::string& stored, bool has_stored,
                                    bool offline_at_init) {
    if (has_stored) {
        return NormalizeFamilyMode(stored);
    }
    return offline_at_init ? "儿童" : "默认";
}

// Composes the bottom marquee text: begins with the AI-state text, optionally
// appends the subtitle segment (only when not on the AskAi page and the subtitle
// is non-empty and distinct from the AI-state text and "AI 待命"), then appends
// exactly one backend-status token. Mirrors AppShell::UpdateSubtitle composition
// plus the folded backend online/offline token.
std::string ComposeFooterText(const std::string& ai_state_text, const std::string& subtitle,
                              bool page_is_ask_ai, bool backend_online) {
    std::string footer = ai_state_text;
    if (!page_is_ask_ai && !subtitle.empty() && subtitle != footer && subtitle != "AI 待命") {
        footer += " | " + subtitle;
    }
    footer += backend_online ? " · 在线" : " · 离线";
    return footer;
}

void ShowHomeAction() { AppShell::GetInstance().ShowHome(); }
void ShowWeatherAction() { AppShell::GetInstance().ShowWeather(); }
void RefreshWeatherAction() { AppShell::GetInstance().RefreshWeather(); }
void ShowMusicAction() { AppShell::GetInstance().ShowMusicLocal(); }
void ShowMusicServerAction() { AppShell::GetInstance().ShowMusicServer(); }
void ShowAppsAction() { AppShell::GetInstance().ShowApps(); }
void ShowEnglishAction() { AppShell::GetInstance().ShowEnglishPractice(); }
void ShowScheduleAction() { AppShell::GetInstance().ShowSchedule(); }
void ShowNotificationsAction() { AppShell::GetInstance().ShowNotifications(); }
void ShowSettingsAction() { AppShell::GetInstance().ShowSettings(); }
void ShowSettingsNetworkAction() { AppShell::GetInstance().ShowSettingsNetwork(); }
void ShowSettingsConnectivityAction() { AppShell::GetInstance().ShowSettingsConnectivity(); }
void ShowSettingsPowerAction() { AppShell::GetInstance().ShowSettingsPower(); }
void ShowSettingsStorageAction() { AppShell::GetInstance().ShowSettingsStorage(); }
void ShowSettingsSystemAction() { AppShell::GetInstance().ShowSettingsSystem(); }
void ShowSettingsDiagnosticsAction() { AppShell::GetInstance().ShowSettingsDiagnostics(); }
void ShowMiniGameAction() { AppShell::GetInstance().ShowMiniGame(); }
void ToggleAiAction() { AppShell::GetInstance().ToggleAiListening(); }
void MusicSdPlayPauseAction() { AppShell::GetInstance().RunBackendAction("music.sd.play_pause"); }
void MusicSdNextAction() { AppShell::GetInstance().RunBackendAction("music.sd.next"); }
void MusicServerPlayPauseAction() { AppShell::GetInstance().RunBackendAction("music.server.play_pause"); }
void MusicServerNextAction() { AppShell::GetInstance().RunBackendAction("music.server.next"); }
void MusicServerCacheAction() { AppShell::GetInstance().RunBackendAction("music.server.cache"); }
void MusicSdScanAction() { AppShell::GetInstance().RunBackendAction("music.sd.scan"); }
void MusicVolumeDownAction() { AppShell::GetInstance().RunBackendAction("music.volume", R"({"delta":-5})"); }
void MusicVolumeUpAction() { AppShell::GetInstance().RunBackendAction("music.volume", R"({"delta":5})"); }
void ScheduleCompleteAction() { AppShell::GetInstance().CompleteNextSchedule(); }
void ScheduleSnoozeAction() { AppShell::GetInstance().SnoozeNextSchedule(); }
void ScreensaverStartAction() { AppShell::GetInstance().RunBackendAction("screensaver.start"); AppShell::GetInstance().ShowScreensaver(); }
void ScreensaverStopAction() { AppShell::GetInstance().RunBackendAction("screensaver.stop"); AppShell::GetInstance().ShowHome(); }
void OpenClawAction() { AppShell::GetInstance().RunBackendAction("openclaw.run", R"({"target":"default"})"); }
void HomeAssistantAction() { AppShell::GetInstance().RunBackendAction("homeassistant.scene", R"({"entityId":"scene.family"})"); }
void NasMusicScanAction() { AppShell::GetInstance().RunBackendAction("nas.music.scan"); }
void CycleFamilyModeAction() { AppShell::GetInstance().CycleFamilyMode(); }
void OpenModePopupAction() { AppShell::GetInstance().OpenModePopup(); }
void SelectMode0Action() { AppShell::GetInstance().SelectModeByIndex(0); }
void SelectMode1Action() { AppShell::GetInstance().SelectModeByIndex(1); }
void SelectMode2Action() { AppShell::GetInstance().SelectModeByIndex(2); }
void SelectMode3Action() { AppShell::GetInstance().SelectModeByIndex(3); }
void CloseModePopupAction() { AppShell::GetInstance().CloseModePopup(); }
void TapMiniGameAction() { AppShell::GetInstance().TapMiniGame(); }
void ResetMiniGameAction() { AppShell::GetInstance().ResetMiniGame(); }
void ShowPomodoroAction() { AppShell::GetInstance().ShowPomodoro(); }
void TogglePomodoroAction() { AppShell::GetInstance().TogglePomodoro(); }
void ResetPomodoroAction() { AppShell::GetInstance().ResetPomodoro(); }
void RefreshBackendAction() { AppShell::GetInstance().RefreshBackend(); }

void OnShowHome(lv_event_t*) { Schedule(ShowHomeAction); }
void OnShowWeather(lv_event_t*) { Schedule(ShowWeatherAction); }
void OnRefreshWeather(lv_event_t*) { Schedule(RefreshWeatherAction); }
void OnShowMusic(lv_event_t*) { Schedule(ShowMusicAction); }
void OnShowMusicServer(lv_event_t*) { Schedule(ShowMusicServerAction); }
void OnShowApps(lv_event_t*) { Schedule(ShowAppsAction); }
void OnShowEnglish(lv_event_t*) { Schedule(ShowEnglishAction); }
void OnShowSchedule(lv_event_t*) { Schedule(ShowScheduleAction); }
void OnShowNotifications(lv_event_t*) { Schedule(ShowNotificationsAction); }
void OnShowSettings(lv_event_t*) { Schedule(ShowSettingsAction); }
void OnShowSettingsNetwork(lv_event_t*) { Schedule(ShowSettingsNetworkAction); }
void OnShowSettingsConnectivity(lv_event_t*) { Schedule(ShowSettingsConnectivityAction); }
void OnShowSettingsPower(lv_event_t*) { Schedule(ShowSettingsPowerAction); }
void OnShowSettingsStorage(lv_event_t*) { Schedule(ShowSettingsStorageAction); }
void OnShowSettingsSystem(lv_event_t*) { Schedule(ShowSettingsSystemAction); }
void OnShowSettingsDiagnostics(lv_event_t*) { Schedule(ShowSettingsDiagnosticsAction); }
void OnShowMiniGame(lv_event_t*) { Schedule(ShowMiniGameAction); }
void OnToggleAi(lv_event_t*) { Schedule(ToggleAiAction); }
void OnMusicSdPlayPause(lv_event_t*) { Schedule(MusicSdPlayPauseAction); }
void OnMusicSdNext(lv_event_t*) { Schedule(MusicSdNextAction); }
void OnMusicServerPlayPause(lv_event_t*) { Schedule(MusicServerPlayPauseAction); }
void OnMusicServerNext(lv_event_t*) { Schedule(MusicServerNextAction); }
void OnMusicServerCache(lv_event_t*) { Schedule(MusicServerCacheAction); }
void OnMusicSdScan(lv_event_t*) { Schedule(MusicSdScanAction); }
void OnMusicVolumeDown(lv_event_t*) { Schedule(MusicVolumeDownAction); }
void OnMusicVolumeUp(lv_event_t*) { Schedule(MusicVolumeUpAction); }
void OnScheduleComplete(lv_event_t*) { Schedule(ScheduleCompleteAction); }
void OnScheduleSnooze(lv_event_t*) { Schedule(ScheduleSnoozeAction); }
void OnScreensaverStart(lv_event_t*) { Schedule(ScreensaverStartAction); }
void OnScreensaverStop(lv_event_t*) { Schedule(ScreensaverStopAction); }
void OnOpenClaw(lv_event_t*) { Schedule(OpenClawAction); }
void OnHomeAssistant(lv_event_t*) { Schedule(HomeAssistantAction); }
void OnNasMusicScan(lv_event_t*) { Schedule(NasMusicScanAction); }
void OnCycleFamilyMode(lv_event_t*) { Schedule(CycleFamilyModeAction); }
void OnOpenModePopup(lv_event_t*) { Schedule(OpenModePopupAction); }
void OnSelectMode(lv_event_t* e) {
    // The row callback is registered directly on the tapped button, so the
    // current target is that row; user_data carries its mode index (0..3).
    auto* target = static_cast<lv_obj_t*>(lv_event_get_current_target(e));
    intptr_t idx = reinterpret_cast<intptr_t>(lv_obj_get_user_data(target));
    switch (idx) {
        case 0: Schedule(SelectMode0Action); break;
        case 1: Schedule(SelectMode1Action); break;
        case 2: Schedule(SelectMode2Action); break;
        default: Schedule(SelectMode3Action); break;
    }
}
void OnDismissModePopup(lv_event_t*) { Schedule(CloseModePopupAction); }
void OnTapMiniGame(lv_event_t*) { Schedule(TapMiniGameAction); }
void OnResetMiniGame(lv_event_t*) { Schedule(ResetMiniGameAction); }
void OnShowPomodoro(lv_event_t*) { Schedule(ShowPomodoroAction); }
void OnTogglePomodoro(lv_event_t*) { Schedule(TogglePomodoroAction); }
void OnResetPomodoro(lv_event_t*) { Schedule(ResetPomodoroAction); }
void OnRefreshBackend(lv_event_t*) { Schedule(RefreshBackendAction); }

lv_obj_t* CreateLabel(lv_obj_t* parent, const char* text, int x, int y, int width, uint32_t color,
                      lv_text_align_t align, lv_label_long_mode_t long_mode = LV_LABEL_LONG_DOT) {
    auto label = lv_label_create(parent);
    lv_label_set_text(label, text);
    lv_label_set_long_mode(label, long_mode);
    lv_obj_set_width(label, width);
    lv_obj_set_style_text_align(label, align, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
    lv_obj_set_style_text_letter_space(label, 0, 0);
    lv_obj_set_style_text_line_space(label, 1, 0);
    lv_obj_align(label, LV_ALIGN_TOP_MID, x, y);
    return label;
}

lv_obj_t* CreateLabelBox(lv_obj_t* parent, const char* text, int x, int y, int width, int height,
                         uint32_t color, lv_text_align_t align,
                         lv_label_long_mode_t long_mode = LV_LABEL_LONG_DOT) {
    auto label = CreateLabel(parent, text, x, y, width, color, align, long_mode);
    lv_obj_set_height(label, height);
    return label;
}

bool TextFitsLabelWidth(lv_obj_t* label, const std::string& text, int width) {
    auto font = lv_obj_get_style_text_font(label, LV_PART_MAIN);
    lv_point_t size = {};
    lv_text_get_size(&size, text.c_str(), font,
                     lv_obj_get_style_text_letter_space(label, LV_PART_MAIN),
                     lv_obj_get_style_text_line_space(label, LV_PART_MAIN),
                     LV_COORD_MAX, LV_TEXT_FLAG_NONE);
    return size.x <= width;
}

lv_obj_t* CreatePanel(lv_obj_t* parent, int x, int y, int width, int height, uint32_t bg,
                      uint32_t border = kBorder, int radius = 20) {
    auto panel = lv_obj_create(parent);
    lv_obj_remove_style_all(panel);
    lv_obj_clear_flag(panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(panel, width, height);
    lv_obj_set_style_radius(panel, radius, 0);
    lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(panel, lv_color_hex(bg), 0);
    lv_obj_set_style_border_width(panel, 1, 0);
    lv_obj_set_style_border_color(panel, lv_color_hex(border), 0);
    lv_obj_align(panel, LV_ALIGN_TOP_MID, x, y);
    return panel;
}

lv_obj_t* CreateButton(lv_obj_t* parent, const char* text, int x, int y, int width, int height,
                       lv_event_cb_t callback, bool active = false,
                       lv_event_code_t event_code = LV_EVENT_CLICKED, int ext_click_area = 0) {
    auto button = CreatePanel(parent, x, y, width, height, active ? kPanelActiveBg : kPanelBg,
                              active ? kAccent : kBorder, height / 2);
    lv_obj_add_flag(button, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(button, callback, event_code, nullptr);
    if (ext_click_area > 0) {
        lv_obj_set_ext_click_area(button, ext_click_area);
    }

    auto label = lv_label_create(button);
    lv_label_set_text(label, text);
    lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
    lv_obj_set_width(label, width - 16);
    lv_obj_set_style_text_align(label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(active ? kAccent : kText), 0);
    lv_obj_center(label);
    return button;
}

lv_obj_t* CreateControlButton(lv_obj_t* parent, const char* text, int x, int y, int width, int height,
                              lv_event_cb_t callback, bool active = false) {
    return CreateButton(parent, text, x, y, width, height, callback, active, LV_EVENT_PRESSED, 4);
}

void SetButtonText(lv_obj_t* button, const char* text) {
    if (button == nullptr) return;
    lv_obj_t* label = lv_obj_get_child(button, 0);
    if (label != nullptr) lv_label_set_text(label, text);
}

lv_obj_t* CreateVolumeButton(lv_obj_t* parent, const char* text, int x, int y, int width, int height,
                             lv_event_cb_t callback) {
    return CreateButton(parent, text, x, y, width, height, callback, false, LV_EVENT_RELEASED, 4);
}

std::string FormatTime(int seconds) {
    seconds = std::max(0, seconds);
    char buffer[16];
    std::snprintf(buffer, sizeof(buffer), "%02d:%02d", seconds / 60, seconds % 60);
    return buffer;
}

std::string FormatMusicProgressText(int position_ms, int duration_ms, bool has_duration) {
    const int safe_position_ms = has_duration ? std::min(std::max(0, position_ms), duration_ms) :
                                 std::max(0, position_ms);
    if (has_duration && duration_ms > 0) {
        return FormatTime(safe_position_ms / 1000) + " / " + FormatTime(duration_ms / 1000);
    }
    if (safe_position_ms > 0) {
        return "已播放 " + FormatTime(safe_position_ms / 1000);
    }
    return "00:00";
}

std::string WeatherUpdateLabel(const AppWeatherState& weather, bool online) {
    if (!online) {
        return weather.location + " · 离线数据";
    }
    if (!weather.available) {
        return weather.location + " · 暂无数据";
    }
    if (weather.is_stale) {
        return weather.location + " · 数据较旧";
    }
    if (!weather.updated_local_time.empty()) {
        return weather.location + " · " + weather.updated_local_time + "更新";
    }
    return weather.location + " · 已更新";
}

uint32_t WeatherAccent(int weather_code) {
    if (weather_code >= 51 && weather_code <= 99) {
        return kAccentBlue;
    }
    return kAccent;
}

uint32_t AirAccent(int aqi) {
    if (aqi < 0 || aqi <= 50) {
        return kAccent;
    }
    if (aqi <= 100) {
        return kAccentBlue;
    }
    if (aqi <= 150) {
        return kWarm;
    }
    return kDanger;
}

bool IsInputPressed() {
    auto* indev = lv_indev_get_next(nullptr);
    while (indev != nullptr) {
        if (lv_indev_get_state(indev) != LV_INDEV_STATE_RELEASED) {
            return true;
        }
        indev = lv_indev_get_next(indev);
    }
    return false;
}

std::string FileNameOf(const std::string& path) {
    const auto pos = path.find_last_of("/\\");
    if (pos == std::string::npos) {
        return path;
    }
    return path.substr(pos + 1);
}

std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool IsJpegFile(const std::string& path) {
    const std::string lower = Lower(path);
    return (lower.size() >= 4 && lower.rfind(".jpg") == lower.size() - 4) ||
           (lower.size() >= 5 && lower.rfind(".jpeg") == lower.size() - 5);
}

bool IsRawRgb565File(const std::string& path) {
    const std::string lower = Lower(path);
    return lower.size() >= 4 && lower.rfind(".bin") == lower.size() - 4;
}

bool IsScreensaverImageFile(const std::string& path) {
    return IsJpegFile(path) || IsRawRgb565File(path);
}

std::string MakeErrorPayload(const std::string& error) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "error", error.c_str());
    char* raw = cJSON_PrintUnformatted(root);
    std::string result = raw != nullptr ? raw : "{}";
    if (raw != nullptr) {
        cJSON_free(raw);
    }
    cJSON_Delete(root);
    return result;
}

std::string NotificationWakeKey(const AppNotificationItem& item) {
    if (!item.id.empty()) {
        return item.id;
    }
    return item.title + "|" + item.message + "|" + item.level;
}

lv_obj_t* CreateTile(lv_obj_t* parent, const char* title, const char* subtitle, int x, int y,
                     lv_event_cb_t callback, bool active = false, uint32_t accent = kAccent) {
    auto tile = CreatePanel(parent, x, y, kTileWidth, kTileHeight, active ? kPanelActiveBg : kPanelSoftBg,
                            active ? accent : kBorder, 20);
    lv_obj_add_flag(tile, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(tile, callback, LV_EVENT_CLICKED, nullptr);
    CreateLabel(tile, title, 0, 7, 112, active ? accent : kText, LV_TEXT_ALIGN_CENTER);
    CreateLabel(tile, subtitle, 0, 29, 112, kMutedText, LV_TEXT_ALIGN_CENTER);
    return tile;
}

lv_obj_t* CreateSettingsDetailPanel(lv_obj_t* parent, const char* title, const char* status,
                                    uint32_t accent) {
    auto panel = CreatePanel(parent, 0, 0, 276, 196, kPanelBg, accent, 16);
    std::string header = std::string(title) + " | " + status;
    CreateLabel(panel, header.c_str(), 0, 14, 232, accent, LV_TEXT_ALIGN_CENTER);
    return panel;
}

void CreateSettingsDetailRow(lv_obj_t* panel, const char* label, const char* value, int y,
                             uint32_t value_color = kText) {
    CreateLabel(panel, label, -92, y, 54, kMutedText, LV_TEXT_ALIGN_RIGHT);
    CreateLabel(panel, value, 34, y, 184, value_color, LV_TEXT_ALIGN_LEFT);
}

lv_obj_t* CreateGlowCircle(lv_obj_t* parent, int x, int center_y, int size, uint32_t color, lv_opa_t bg_opa,
                           int border_width = 1) {
    auto circle = lv_obj_create(parent);
    lv_obj_remove_style_all(circle);
    lv_obj_clear_flag(circle, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(circle, size, size);
    lv_obj_set_style_radius(circle, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(circle, bg_opa, 0);
    lv_obj_set_style_bg_color(circle, lv_color_hex(color), 0);
    lv_obj_set_style_border_width(circle, border_width, 0);
    lv_obj_set_style_border_color(circle, lv_color_hex(color), 0);
    lv_obj_set_style_border_opa(circle, LV_OPA_60, 0);
    lv_obj_align(circle, LV_ALIGN_TOP_MID, x, center_y - size / 2);
    return circle;
}

lv_obj_t* CreateGlowDot(lv_obj_t* parent, int x, int center_y, int size, uint32_t color, lv_opa_t opa) {
    auto dot = CreateGlowCircle(parent, x, center_y, size, color, opa, 0);
    lv_obj_set_style_bg_opa(dot, opa, 0);
    return dot;
}

lv_obj_t* CreateWaveBar(lv_obj_t* parent, int x, int baseline, int width, int height, uint32_t color,
                        lv_opa_t opa = LV_OPA_COVER) {
    auto bar = lv_obj_create(parent);
    lv_obj_remove_style_all(bar);
    lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(bar, width, height);
    lv_obj_set_style_radius(bar, width / 2, 0);
    lv_obj_set_style_bg_opa(bar, opa, 0);
    lv_obj_set_style_bg_color(bar, lv_color_hex(color), 0);
    lv_obj_align(bar, LV_ALIGN_TOP_MID, x, baseline - height);
    return bar;
}

uint32_t AiPrimaryColor(DeviceState state) {
    switch (state) {
        case kDeviceStateListening: return kAccent;
        case kDeviceStateSpeaking: return kWarm;
        case kDeviceStateConnecting:
        case kDeviceStateActivating: return kAccentBlue;
        case kDeviceStateFatalError: return kDanger;
        default: return kAccentBlue;
    }
}

uint32_t AiSecondaryColor(DeviceState state) {
    switch (state) {
        case kDeviceStateListening: return 0x1dd8ff;
        case kDeviceStateSpeaking: return 0xff8f5a;
        case kDeviceStateConnecting:
        case kDeviceStateActivating: return kAccent;
        case kDeviceStateFatalError: return kWarm;
        default: return kAccent;
    }
}

const char* AiCoreText(DeviceState state) {
    switch (state) {
        case kDeviceStateListening: return "听";
        case kDeviceStateSpeaking: return "说";
        case kDeviceStateConnecting:
        case kDeviceStateActivating: return "连";
        case kDeviceStateFatalError: return "!";
        default: return "AI";
    }
}

const char* AiVisualHint(DeviceState state) {
    switch (state) {
        case kDeviceStateListening: return "正在聆听";
        case kDeviceStateSpeaking: return "正在回复";
        case kDeviceStateConnecting: return "连接中";
        case kDeviceStateActivating: return "激活中";
        case kDeviceStateWifiConfiguring: return "等待配网";
        case kDeviceStateFatalError: return "需要检查";
        default: return "轻触开始对话";
    }
}

const char* AiPageStateLabel(DeviceState state) {
    switch (state) {
        case kDeviceStateListening: return "聆听中";
        case kDeviceStateSpeaking: return "回复中";
        case kDeviceStateConnecting: return "连接中";
        case kDeviceStateActivating: return "激活中";
        case kDeviceStateWifiConfiguring: return "配网中";
        case kDeviceStateFatalError: return "异常";
        default: return "待命";
    }
}

std::string JsonString(cJSON* object, const char* key, const std::string& fallback = "") {
    auto item = cJSON_GetObjectItem(object, key);
    if (cJSON_IsString(item) && item->valuestring != nullptr) {
        return item->valuestring;
    }
    return fallback;
}

int JsonInt(cJSON* object, const char* key, int fallback = 0) {
    auto item = cJSON_GetObjectItem(object, key);
    if (cJSON_IsNumber(item)) {
        return item->valueint;
    }
    return fallback;
}

bool JsonBool(cJSON* object, const char* key, bool fallback = false) {
    auto item = cJSON_GetObjectItem(object, key);
    if (cJSON_IsBool(item)) {
        return cJSON_IsTrue(item);
    }
    return fallback;
}

int ClampInt(int value, int min_value, int max_value) {
    if (value < min_value) {
        return min_value;
    }
    if (value > max_value) {
        return max_value;
    }
    return value;
}

bool IsVolumeAction(const std::string& action) {
    return action == "music.volume";
}

int ExtractVolumeDelta(const std::string& params_json) {
    auto root = cJSON_Parse(params_json.c_str());
    if (root == nullptr) {
        return 0;
    }
    const int delta = JsonInt(root, "delta", 0);
    cJSON_Delete(root);
    return delta;
}

std::string BuildVolumeParams(int delta) {
    return "{\"delta\":" + std::to_string(delta) + "}";
}

AppMusicChannelState& ActiveMusicChannel(AppMusicState& music) {
    return music.active_source == "sd" ? music.sd : music.server;
}

std::string ActionDisplayName(const std::string& action) {
    if (action == "weather.refresh") {
        return "天气更新";
    }
    if (action == "music.play_pause") {
        return "音乐播放";
    }
    if (action == "music.next" || action == "music.server.next" || action == "music.sd.next") {
        return "切到下一项";
    }
    if (action == "music.volume") {
        return "音量调整";
    }
    if (action == "music.set_source") {
        return "切换音源";
    }
    if (action == "music.sd.scan") {
        return "扫描 SD 卡";
    }
    if (action == "music.server.cache") {
        return "缓存播客";
    }
    if (action == "english.start") {
        return "英语练习";
    }
    if (action == "schedule.complete") {
        return "日程完成";
    }
    if (action == "schedule.snooze") {
        return "稍后提醒";
    }
    if (action == "screensaver.start" || action == "screensaver.stop") {
        return "屏保切换";
    }
    if (action == "openclaw.run") {
        return "OpenClaw";
    }
    if (action == "family.mode") {
        return "家庭模式";
    }
    if (action == "homeassistant.call" || action == "homeassistant.scene") {
        return "家庭控制";
    }
    if (action == "nas.music.scan") {
        return "NAS 扫描";
    }
    if (action == "voice.intent") {
        return "语音意图";
    }
    return action;
}

const char* ResetReasonText(esp_reset_reason_t reason) {
    switch (reason) {
        case ESP_RST_POWERON: return "上电";
        case ESP_RST_EXT: return "外部复位";
        case ESP_RST_SW: return "软件重启";
        case ESP_RST_PANIC: return "panic";
        case ESP_RST_INT_WDT: return "中断看门狗";
        case ESP_RST_TASK_WDT: return "任务看门狗";
        case ESP_RST_WDT: return "看门狗";
        case ESP_RST_DEEPSLEEP: return "深睡眠唤醒";
        case ESP_RST_BROWNOUT: return "低压掉电";
        case ESP_RST_SDIO: return "SDIO复位";
        case ESP_RST_USB: return "USB复位";
        case ESP_RST_JTAG: return "JTAG复位";
        case ESP_RST_EFUSE: return "eFuse错误";
        case ESP_RST_PWR_GLITCH: return "电源毛刺";
        case ESP_RST_CPU_LOCKUP: return "CPU锁死";
        case ESP_RST_UNKNOWN:
        default: return "未知";
    }
}

bool IsSuspiciousReset(int reset_code) {
    auto reason = static_cast<esp_reset_reason_t>(reset_code);
    return reason == ESP_RST_PANIC || reason == ESP_RST_INT_WDT || reason == ESP_RST_TASK_WDT ||
           reason == ESP_RST_WDT || reason == ESP_RST_BROWNOUT || reason == ESP_RST_PWR_GLITCH ||
           reason == ESP_RST_CPU_LOCKUP || reason == ESP_RST_EFUSE;
}

std::string FormatKilobytes(uint64_t kb) {
    char buffer[32];
    if (kb >= 1024 * 1024) {
        std::snprintf(buffer, sizeof(buffer), "%lluGB", static_cast<unsigned long long>(kb / 1024 / 1024));
    } else if (kb >= 1024) {
        std::snprintf(buffer, sizeof(buffer), "%lluMB", static_cast<unsigned long long>(kb / 1024));
    } else {
        std::snprintf(buffer, sizeof(buffer), "%lluKB", static_cast<unsigned long long>(kb));
    }
    return buffer;
}

std::string FormatBytesAsKb(size_t bytes) {
    return FormatKilobytes(static_cast<uint64_t>(bytes / 1024));
}

const AppConnectivityProviderStatus* FindProvider(AppConnectivityProviderKind kind) {
    for (const auto& provider : AppConnectivityManager::GetInstance().providers()) {
        if (provider.kind == kind) {
            return &provider;
        }
    }
    return nullptr;
}

std::string ProviderShortState(AppConnectivityProviderKind kind, const char* available_text,
                               const char* unavailable_text) {
    const auto* provider = FindProvider(kind);
    if (provider == nullptr) {
        return unavailable_text;
    }
    return provider->available ? available_text : unavailable_text;
}

bool ReadBatteryInfo(BatteryInfo& info) {
    if (Board::GetInstance().GetBatteryInfo(info)) {
        return true;
    }

    int level = 0;
    bool charging = false;
    bool discharging = false;
    if (!Board::GetInstance().GetBatteryLevel(level, charging, discharging)) {
        return false;
    }
    info.present = true;
    info.level = level;
    info.charging = charging;
    info.discharging = discharging;
    return true;
}

std::string BatteryStatusLine(const BatteryInfo& info) {
    std::string line = std::to_string(info.level) + "%";
    if (info.charging) {
        line += " 充电";
    } else if (info.discharging) {
        line += " 放电";
    } else {
        line += " 外接";
    }
    return line;
}

std::string BatteryStatusLine() {
    BatteryInfo info;
    if (!ReadBatteryInfo(info)) {
        return "电量 未知";
    }
    return BatteryStatusLine(info);
}

std::string BatteryVoltageLine(const BatteryInfo& info) {
    if (info.voltage_mv < 0) {
        return "电压 未知";
    }
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%d.%03dV", info.voltage_mv / 1000, info.voltage_mv % 1000);
    return buffer;
}

std::string BatteryCurrentLine(const BatteryInfo& info) {
    char buffer[40];
    const char* state = "外接";
    if (info.charging) {
        state = "充电";
    } else if (info.discharging) {
        state = "放电";
    }
    std::snprintf(buffer, sizeof(buffer), "%+dmA %s", info.current_ma, state);
    return buffer;
}

std::string BatteryHealthLine(const BatteryInfo& info) {
    if (info.health_percent < 0) {
        return "SOH 未上报";
    }
    return "SOH " + std::to_string(info.health_percent) + "%";
}

// Maps a device page enum to the normalized lowercase backend Page_Key used by
// the self-hosted voice provider to route requests to the matching Page Agent.
// Pure function (no I/O, no locks) so it stays unit/property testable off-device.
// Every enum value maps to a non-empty key in the one-level backend set
// {ai, music, album, settings, apps, home, weather, schedule, english}.
[[maybe_unused]] const char* PageToBackendKey(AppShell::Page page) {
    using Page = AppShell::Page;
    switch (page) {
        case Page::kAskAi:                return "ai";
        case Page::kMusicLocal:           return "music";
        case Page::kMusicServer:          return "music";
        case Page::kContent:              return "album";
        case Page::kSettings:             return "settings";
        case Page::kSettingsNetwork:      return "settings";
        case Page::kSettingsConnectivity: return "settings";
        case Page::kSettingsPower:        return "settings";
        case Page::kSettingsStorage:      return "settings";
        case Page::kSettingsSystem:       return "settings";
        case Page::kSettingsDiagnostics:  return "settings";
        case Page::kApps:                 return "apps";
        case Page::kHome:                 return "home";
        case Page::kWeather:              return "weather";
        case Page::kSchedule:             return "schedule";
        case Page::kEnglishPractice:      return "english";
        // Pages outside the one-level page set fall back to a defined key.
        case Page::kScreensaver:          return "home";
        case Page::kNotifications:        return "home";
        case Page::kFamilyMode:           return "home";
        case Page::kMiniGame:             return "apps";
        case Page::kPomodoro:             return "apps";
    }
    return "home";
}
} // namespace

AppShell& AppShell::GetInstance() {
    static AppShell instance;
    return instance;
}

void AppShell::Initialize(Display* display) {
    display_ = display;
    initialized_ = display_ != nullptr;
    if (!initialized_) {
        return;
    }

    AppBackendClient::GetInstance().LoadSettings();
    backend_.backend_url = AppBackendClient::GetInstance().backend_url();
    AppStorageManager::GetInstance().Initialize();
    AppResourceManager::GetInstance().Initialize();
    AppSyncQueue::GetInstance().Initialize();
    AppConnectivityManager::GetInstance().Refresh();
    Settings settings("appshell", false);
    std::string stored_family_mode = settings.GetString("family_mode", "");
    bool has_stored_family_mode = !stored_family_mode.empty();
    bool offline_at_init = !AppConnectivityManager::GetInstance().status().online;
    family_mode_ = ChooseInitialFamilyMode(stored_family_mode, has_stored_family_mode, offline_at_init);
    boot_count_ = settings.GetInt("boot_cnt", 0) + 1;
    last_reset_code_ = static_cast<int>(esp_reset_reason());
    last_reset_reason_ = ResetReasonText(static_cast<esp_reset_reason_t>(last_reset_code_));
    boot_id_ = Board::GetInstance().GetUuid() + "-" + std::to_string(boot_count_);
    const esp_app_desc_t* app_desc = esp_app_get_description();
    firmware_build_ = app_desc != nullptr ? app_desc->version : "unknown";
    if (last_reset_code_ == static_cast<int>(ESP_RST_PANIC)) {
        panic_summary_ = "reset_code=" + std::to_string(last_reset_code_) + ";reason=panic";
    }
    {
        Settings writable_settings("appshell", true);
        writable_settings.SetInt("boot_cnt", boot_count_);
        writable_settings.SetInt("rst_code", last_reset_code_);
        writable_settings.SetString("rst_text", last_reset_reason_);
    }
    ESP_LOGI(TAG, "Boot #%d reset reason: %s (%d)", boot_count_, last_reset_reason_.c_str(), last_reset_code_);
    subtitle_ = "上次重启: " + last_reset_reason_;

    {
        DisplayLockGuard lock(display_);
        EnsureUi();
        Render();
    }
    // Wi-Fi may not be ready during Initialize. Keep one coalesced context
    // update pending; Tick() sends it as soon as backend networking is safe.
    page_context_pending_.store(true);
}

void AppShell::ShowHome() { SetPage(Page::kHome); }
void AppShell::ShowWeather() { SetPage(Page::kWeather); }
void AppShell::RefreshWeather() {
    if (weather_refreshing_.exchange(true)) {
        return;
    }
    subtitle_ = "天气更新中";
    RunBackendAction("weather.refresh");
    RenderOrDefer();
}
void AppShell::ShowAskAi() { SetPage(Page::kAskAi); }
void AppShell::ShowMusicLocal() { SetPage(Page::kMusicLocal); }
void AppShell::ShowMusicServer() { SetPage(Page::kMusicServer); }
void AppShell::ShowScreensaver() { SetPage(Page::kScreensaver); }
void AppShell::ShowApps() { SetPage(Page::kApps); }
void AppShell::ShowContent() { SetPage(Page::kContent); }
void AppShell::ShowEnglishPractice() { SetPage(Page::kEnglishPractice); }
void AppShell::ShowSchedule() { SetPage(Page::kSchedule); }
void AppShell::ShowNotifications() { SetPage(Page::kNotifications); }
void AppShell::ShowSettings() { SetPage(Page::kSettings); }
void AppShell::ShowSettingsNetwork() { SetPage(Page::kSettingsNetwork); }
void AppShell::ShowSettingsConnectivity() { SetPage(Page::kSettingsConnectivity); }
void AppShell::ShowSettingsPower() { SetPage(Page::kSettingsPower); }
void AppShell::ShowSettingsStorage() { SetPage(Page::kSettingsStorage); }
void AppShell::ShowSettingsSystem() { SetPage(Page::kSettingsSystem); }
void AppShell::ShowSettingsDiagnostics() { SetPage(Page::kSettingsDiagnostics); }
void AppShell::ShowFamilyMode() { SetPage(Page::kFamilyMode); }
void AppShell::ShowMiniGame() { SetPage(Page::kMiniGame); }
void AppShell::ShowPomodoro() { SetPage(Page::kPomodoro); }

void AppShell::ShowNextApp() {
    switch (page_) {
        case Page::kHome: SetPage(Page::kWeather); break;
        case Page::kWeather: SetPage(Page::kAskAi); break;
        case Page::kAskAi: SetPage(Page::kMusicLocal); break;
        case Page::kMusicLocal: SetPage(Page::kMusicServer); break;
        case Page::kMusicServer: SetPage(Page::kContent); break;
        case Page::kContent: SetPage(Page::kEnglishPractice); break;
        case Page::kEnglishPractice: SetPage(Page::kSchedule); break;
        case Page::kSchedule: SetPage(Page::kApps); break;
        case Page::kApps: SetPage(Page::kSettings); break;
        default: SetPage(Page::kHome); break;
    }
}

void AppShell::RefreshBackend() {
    subtitle_ = "刷新后端状态";
    StartBackendRefresh(true);
    if (initialized_) {
        DisplayLockGuard lock(display_);
        Render();
    }
}

void AppShell::ToggleAiListening() {
    auto& app = Application::GetInstance();
    if (ai_state_ == kDeviceStateListening) {
        app.StopListening();
    } else if (ai_state_ == kDeviceStateSpeaking) {
        app.ToggleChatState();
    } else if (ai_state_ == kDeviceStateConnecting) {
        return;
    } else if (page_ == Page::kEnglishPractice) {
        app.StartOfficialListening();
    } else {
        app.StartListening();
    }
}

bool AppShell::ApplyLocalVolumeDelta(int delta) {
    if (delta == 0) {
        return false;
    }
    auto* codec = Board::GetInstance().GetAudioCodec();
    if (codec == nullptr) {
        return false;
    }

    const int current_volume = codec->output_volume();
    const int next_volume = ClampInt(current_volume + delta, 0, 100);
    codec->SetOutputVolume(next_volume);
    ActiveMusicChannel(backend_.music).volume = next_volume;
    subtitle_ = "本机音量 " + std::to_string(next_volume);
    return next_volume != current_volume;
}

void AppShell::QueueLocalVolumeDelta(int delta) {
    if (delta == 0) {
        return;
    }
    pending_volume_delta_ = ClampInt(pending_volume_delta_ + delta, -100, 100);
    subtitle_ = "音量调整 " + std::to_string(pending_volume_delta_ > 0 ? pending_volume_delta_ : -pending_volume_delta_);
    render_pending_ = true;
}

bool AppShell::ApplyQueuedLocalVolumeDelta() {
    if (pending_volume_delta_ == 0) {
        return false;
    }
    const int delta = pending_volume_delta_;
    pending_volume_delta_ = 0;
    const bool changed = ApplyLocalVolumeDelta(delta);
    render_pending_ = true;
    return changed;
}

void AppShell::RunBackendAction(const std::string& action, const std::string& params_json) {
    if ((action == "music.play_pause" && backend_.music.active_source == "sd") || action == "music.sd.play_pause") {
        AppServerMusicPlayer::GetInstance().Stop();
        AppLocalMusicPlayer::GetInstance().PlayPause();
        subtitle_ = AppLocalMusicPlayer::GetInstance().StatusLine();
        RefreshSubtitleOnly();
    } else if ((action == "music.next" && backend_.music.active_source == "sd") || action == "music.sd.next") {
        AppServerMusicPlayer::GetInstance().Stop();
        AppLocalMusicPlayer::GetInstance().Next();
        subtitle_ = AppLocalMusicPlayer::GetInstance().StatusLine();
        RefreshSubtitleOnly();
    } else if ((action == "music.play_pause" && backend_.music.active_source == "server") ||
               action == "music.server.play_pause") {
        AppLocalMusicPlayer::GetInstance().Stop();
        AppServerMusicPlayer::GetInstance().PlayPause(
            backend_.music.server.stream_url,
            backend_.music.server.title,
            !backend_.music.server.content_type.empty() ? backend_.music.server.content_type : backend_.music.server.format,
            backend_.music.server.download_url,
            backend_.music.server.sha256,
            backend_.music.server.cache_path,
            backend_.music.server.size,
            backend_.music.server.current_track_id,
            backend_.music.server.duration_sec,
            backend_.music.server.artist,
            backend_.music.server.source);
        subtitle_ = AppServerMusicPlayer::GetInstance().StatusLine();
        RefreshSubtitleOnly();
    } else if ((action == "music.next" && backend_.music.active_source == "server") || action == "music.server.next") {
        AppLocalMusicPlayer::GetInstance().Stop();
        AppServerMusicPlayer::GetInstance().Next();
        subtitle_ = AppServerMusicPlayer::GetInstance().StatusLine();
        RefreshSubtitleOnly();
    } else if (action == "music.server.cache") {
        const bool ok = AppServerMusicPlayer::GetInstance().CacheCurrent(
            backend_.music.server.stream_url,
            backend_.music.server.title,
            !backend_.music.server.content_type.empty() ? backend_.music.server.content_type : backend_.music.server.format,
            backend_.music.server.download_url,
            backend_.music.server.sha256,
            backend_.music.server.cache_path,
            backend_.music.server.size,
            backend_.music.server.current_track_id);
        (void)ok;
        subtitle_ = AppServerMusicPlayer::GetInstance().StatusLine();
        RefreshSubtitleOnly();
    } else if (action == "music.set_source") {
        if (params_json.find("\"sd\"") != std::string::npos) {
            AppServerMusicPlayer::GetInstance().Stop();
        } else if (params_json.find("\"server\"") != std::string::npos) {
            AppLocalMusicPlayer::GetInstance().Stop();
        }
    } else if (action == "music.sd.scan") {
        AppStorageManager::GetInstance().Refresh();
        subtitle_ = AppStorageManager::GetInstance().ResourceLine();
        RefreshSubtitleOnly();
    } else if (action == "music.volume") {
        QueueLocalVolumeDelta(ExtractVolumeDelta(params_json));
        if (!IsInputPressed()) {
            ApplyQueuedLocalVolumeDelta();
        }
        return;
    }

    if (!CanRunBackendNetworkTasks()) {
        QueueBackendAction(action, params_json);
        RefreshSubtitleOnly();
        return;
    }

    const bool wait_for_worker = backend_action_busy_.load() || backend_refreshing_.load() ||
                                 backend_events_running_.load();
    const bool wait_for_spacing = tick_count_ - last_backend_action_tick_ < 1;
    if (wait_for_worker || wait_for_spacing) {
        QueueBackendAction(action, params_json);
        RefreshSubtitleOnly();
        return;
    }

    if (StartBackendActionTask(action, params_json)) {
        subtitle_ = "已发送: " + ActionDisplayName(action);
        last_backend_action_status_ = "发送 " + ActionDisplayName(action);
    } else {
        QueueBackendAction(action, params_json);
    }
    RefreshSubtitleOnly();
}

void AppShell::CompleteNextSchedule() {
    std::string id = backend_.next_schedule.id.empty() ? "next" : backend_.next_schedule.id;
    RunBackendAction("schedule.complete", "{\"id\":\"" + id + "\"}");
}

void AppShell::SnoozeNextSchedule() {
    std::string id = backend_.next_schedule.id.empty() ? "next" : backend_.next_schedule.id;
    RunBackendAction("schedule.snooze", "{\"id\":\"" + id + "\",\"minutes\":10}");
}

void AppShell::CycleFamilyMode() {
    SetFamilyMode(NextFamilyMode(family_mode_));
}

void AppShell::SetFamilyMode(const std::string& mode) {
    family_mode_ = NormalizeFamilyMode(mode);
    Settings settings("appshell", true);
    settings.SetString("family_mode", family_mode_);
    subtitle_ = "当前用户: " + family_mode_;
    RunBackendAction("family.mode", "{\"mode\":\"" + family_mode_ + "\"}");
    SetPage(page_);
}

void AppShell::TapMiniGame() {
    mini_game_score_++;
    mini_game_level_ = mini_game_score_ / 10 + 1;
    if (page_ == Page::kMiniGame) {
        SetPage(page_);
    }
}

void AppShell::ResetMiniGame() {
    mini_game_score_ = 0;
    mini_game_level_ = 1;
    if (page_ == Page::kMiniGame) {
        SetPage(page_);
    }
}

void AppShell::TogglePomodoro() {
    pomodoro_running_ = !pomodoro_running_;
    if (page_ == Page::kPomodoro) {
        SetPage(page_);
    }
}

void AppShell::ResetPomodoro() {
    pomodoro_running_ = false;
    pomodoro_phase_ = PomodoroPhase::kFocus;
    pomodoro_remaining_sec_ = kPomodoroFocusSec;
    if (page_ == Page::kPomodoro) {
        SetPage(page_);
    }
}

void AppShell::Tick() {
    if (!initialized_) {
        return;
    }

    tick_count_++;
    ApplyQueuedLocalVolumeDelta();
    AppConnectivityManager::GetInstance().Refresh();
    if (tick_count_ % 30 == 0 && CanRunBackendNetworkTasks()) {
        AppResourceManager::GetInstance().Refresh();
        AppSyncQueue::GetInstance().Refresh();
    }
    if (!IsAiActive() && page_ == Page::kHome) {
        idle_seconds_++;
    }

    // 番茄钟每秒倒计时。计时用纯状态推进,阶段结束的提示音/字幕播报通过
    // Alert() 触发,放在显示锁之外,避免持锁期间播放音频。
    bool pomodoro_finished = false;
    PomodoroPhase finished_phase = pomodoro_phase_;
    if (pomodoro_running_) {
        if (pomodoro_remaining_sec_ > 0) {
            pomodoro_remaining_sec_--;
        }
        if (pomodoro_remaining_sec_ <= 0) {
            pomodoro_finished = true;
            finished_phase = pomodoro_phase_;
            if (pomodoro_phase_ == PomodoroPhase::kFocus) {
                pomodoro_completed_++;
                pomodoro_phase_ = PomodoroPhase::kBreak;
                pomodoro_remaining_sec_ = kPomodoroBreakSec;
            } else {
                pomodoro_phase_ = PomodoroPhase::kFocus;
                pomodoro_remaining_sec_ = kPomodoroFocusSec;
            }
        }
    }

    {
        DisplayLockGuard lock(display_);
        EnsureUi();
        if (render_pending_ && !IsInputPressed()) {
            Render();
        } else if (page_ == Page::kPomodoro && pomodoro_running_ && !IsInputPressed()) {
            // 运行中每秒重绘,让倒计时数字走动。
            UpdateClock();
            UpdateHeader();
            ClearContent();
            RenderPomodoro();
        } else if (page_ == Page::kHome && pomodoro_running_ && !IsInputPressed()) {
            // 番茄钟运行时每秒重绘主页,让顶部胶囊的剩余时间走动。
            UpdateClock();
            UpdateHeader();
            ClearContent();
            RenderHome();
        } else if (page_ == Page::kScreensaver) {
            UpdateClock();
            UpdateHeader();
            ClearContent();
            RenderScreensaver();
        } else if (page_ == Page::kMusicLocal && AppLocalMusicPlayer::GetInstance().playing() &&
                   !IsInputPressed()) {
            // 播放中每秒重绘,让歌曲进度条随播放位置走动。
            UpdateClock();
            UpdateHeader();
            ClearContent();
            RenderMusicLocal();
        } else if (page_ == Page::kMusicServer && AppServerMusicPlayer::GetInstance().playing() &&
                   !IsInputPressed()) {
            // 播放中每秒重绘,让歌曲进度条随播放位置走动。
            UpdateClock();
            UpdateHeader();
            ClearContent();
            RenderMusicServer();
        } else {
            UpdateClock();
            UpdateHeader();
        }
        lv_obj_move_foreground(root_);

        if (idle_seconds_ >= kScreensaverIdleSec && page_ == Page::kHome) {
            SetPageLocked(Page::kScreensaver);
        }
    }

    // 阶段切换后播报。本地无任意中文 TTS,用 Alert() 播内置提示音并把文案推到
    // 屏幕状态/表情/字幕,是本地不依赖网络的最可靠提示方式。
    if (pomodoro_finished) {
        if (finished_phase == PomodoroPhase::kFocus) {
            Application::GetInstance().Alert("番茄钟", "专注完成,休息一下", "happy",
                                             Lang::Sounds::OGG_SUCCESS);
        } else {
            Application::GetInstance().Alert("番茄钟", "休息结束,开始专注", "neutral",
                                             Lang::Sounds::OGG_SUCCESS);
        }
    }

    if (tick_count_ - last_page_context_tick_ >= kPageContextRefreshIntervalSec) {
        page_context_pending_.store(true);
    }
    if (page_context_pending_.load() && CanRunBackendNetworkTasks()) {
        StartPageContextTask();
    }
    if (!DispatchQueuedBackendAction()) {
        if (tick_count_ % kBackendEventProbeIntervalSec == 0) {
            StartBackendEventTask();
        }
        StartBackendRefresh(false);
    }
}

void AppShell::OnAiStateChanged(DeviceState state) {
    ai_state_ = state;
    if (IsAiActive()) {
        backend_network_resume_tick_ = tick_count_ + kBackendResumeDelaySec;
        if (AppLocalMusicPlayer::GetInstance().playing()) {
            AppLocalMusicPlayer::GetInstance().Stop();
        }
        if (AppServerMusicPlayer::GetInstance().playing()) {
            AppServerMusicPlayer::GetInstance().Stop();
        }
        AppAudioSessionManager::GetInstance().Request(AppAudioSessionType::kAi, "小智 AI");
    } else {
        backend_network_resume_tick_ = tick_count_ + kBackendResumeDelaySec;
        AppAudioSessionManager::GetInstance().Release(AppAudioSessionType::kAi);
    }
    if (!initialized_) {
        return;
    }
    if (IsAiActive()) {
        WakeDisplayForEvent("AI 状态");
    }

    DisplayLockGuard lock(display_);
    EnsureUi();
    RenderOrDefer();
}

void AppShell::OnUserTranscript(const std::string& text) {
    subtitle_ = "我: " + text;
    last_user_transcript_ = text;
    if (!initialized_) {
        return;
    }
    if (!text.empty()) {
        WakeDisplayForEvent("用户语音");
    }
    DisplayLockGuard lock(display_);
    RenderOrDefer();
}

void AppShell::OnAssistantTranscript(const std::string& text) {
    subtitle_ = "AI: " + text;
    last_assistant_transcript_ = text;
    if (!initialized_) {
        return;
    }
    if (!text.empty()) {
        WakeDisplayForEvent("AI 回复");
    }
    DisplayLockGuard lock(display_);
    RenderOrDefer();
}

void AppShell::OnSystemMessage(const std::string& text) {
    subtitle_ = text.empty() ? "AI 待命" : text;
    if (!initialized_) {
        return;
    }
    if (!text.empty()) {
        WakeDisplayForEvent("系统消息");
    }
    DisplayLockGuard lock(display_);
    RenderOrDefer();
}

void AppShell::OnBackendSnapshot(const AppBackendSnapshot& snapshot) {
    std::string notification_key;
    if (!snapshot.notifications.empty()) {
        notification_key = NotificationWakeKey(snapshot.notifications.front());
    }
    const bool has_new_notification = initialized_ && !notification_key.empty() &&
                                      notification_key != last_wake_notification_key_;
    if (!notification_key.empty()) {
        last_wake_notification_key_ = notification_key;
    }

    backend_ = snapshot;
    if (!snapshot.family_mode.empty() && snapshot.family_mode != family_mode_) {
        family_mode_ = snapshot.family_mode;
        Settings settings("appshell", true);
        settings.SetString("family_mode", family_mode_);
    }
    if (!initialized_) {
        return;
    }
    if (has_new_notification) {
        WakeDisplayForEvent("后端通知");
    }

    {
        DisplayLockGuard lock(display_);
        RenderOrDefer();
    }
    if (CurrentPageKey() == "music" || CurrentPageKey() == "schedule") {
        page_context_pending_.store(true);
        StartPageContextTask();
    }
}

void AppShell::WakeDisplayForEvent(const std::string& reason) {
    last_wake_reason_ = reason.empty() ? "事件" : reason;
    Board::GetInstance().WakeDisplay();
    idle_seconds_ = 0;
    if (page_ == Page::kScreensaver) {
        page_ = Page::kHome;
        render_pending_ = true;
    }
}

void AppShell::EnsureUi() {
    if (root_ != nullptr) {
        return;
    }

    auto screen = lv_scr_act();
    root_ = lv_obj_create(screen);
    lv_obj_remove_style_all(root_);
    lv_obj_clear_flag(root_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(root_, display_->width(), display_->height());
    lv_obj_set_style_bg_opa(root_, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(root_, lv_color_hex(kRootBg), 0);
    lv_obj_set_style_text_color(root_, lv_color_hex(kText), 0);
    lv_obj_align(root_, LV_ALIGN_CENTER, 0, 0);

    time_label_ = CreateLabel(root_, "--:--", 0, 3, 96, kAccent, LV_TEXT_ALIGN_CENTER);
    CreateButton(root_, "首页", -80, 27, 54, 30, OnShowHome, false, LV_EVENT_PRESSED, 8);
    header_title_label_ = CreateLabel(root_, "首页", -20, 33, 48, kText, LV_TEXT_ALIGN_CENTER);
    mode_switch_btn_ = CreateButton(root_, FamilyModeText(), 30, 27, 60, 30, OnOpenModePopup, false, LV_EVENT_PRESSED, 8);
    CreateButton(root_, "设置", 80, 27, 54, 30, OnShowSettings, false, LV_EVENT_PRESSED, 8);

    content_ = lv_obj_create(root_);
    lv_obj_remove_style_all(content_);
    lv_obj_clear_flag(content_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(content_, kContentWidth, kContentHeight);
    lv_obj_align(content_, LV_ALIGN_TOP_MID, 0, kContentTop);
    lv_obj_set_style_bg_opa(content_, LV_OPA_TRANSP, 0);

    subtitle_label_ = CreateLabel(root_, "AI 待命", 0, kFooterTop, kFooterWidth, kMutedText, LV_TEXT_ALIGN_CENTER,
                                  LV_LABEL_LONG_SCROLL_CIRCULAR);
    lv_obj_set_height(subtitle_label_, 18);
    lv_obj_set_style_text_line_space(subtitle_label_, 0, 0);

    ai_button_ = CreateButton(root_, "AI", 0, kAiButtonTop, kAiButtonWidth, kAiButtonHeight, OnToggleAi, false,
                              LV_EVENT_PRESSED, 6);
}

void AppShell::Render() {
    if (root_ == nullptr) {
        return;
    }

    UpdateClock();
    UpdateHeader();
    UpdateSubtitle();
    ClearContent();

    switch (page_) {
        case Page::kHome: RenderHome(); break;
        case Page::kWeather: RenderWeather(); break;
        case Page::kAskAi: RenderAskAi(); break;
        case Page::kMusicLocal: RenderMusicLocal(); break;
        case Page::kMusicServer: RenderMusicServer(); break;
        case Page::kScreensaver: RenderScreensaver(); break;
        case Page::kApps: RenderApps(); break;
        case Page::kContent: RenderContent(); break;
        case Page::kEnglishPractice: RenderEnglishPractice(); break;
        case Page::kSchedule: RenderSchedule(); break;
        case Page::kNotifications: RenderNotifications(); break;
        case Page::kSettings: RenderSettings(); break;
        case Page::kSettingsNetwork: RenderSettingsNetwork(); break;
        case Page::kSettingsConnectivity: RenderSettingsConnectivity(); break;
        case Page::kSettingsPower: RenderSettingsPower(); break;
        case Page::kSettingsStorage: RenderSettingsStorage(); break;
        case Page::kSettingsSystem: RenderSettingsSystem(); break;
        case Page::kSettingsDiagnostics: RenderSettingsDiagnostics(); break;
        case Page::kFamilyMode: RenderFamilyMode(); break;
        case Page::kMiniGame: RenderMiniGame(); break;
        case Page::kPomodoro: RenderPomodoro(); break;
    }

    lv_obj_move_foreground(root_);
}

void AppShell::RenderHome() {
    const std::string weather_summary = backend_.weather.available ? backend_.weather.summary : "天气暂不可用";
    // 天气按钮左移并缩窄,给右侧番茄钟剩余时间胶囊腾出空间。
    CreateButton(content_, weather_summary.c_str(), -42, 0, 150, 30, OnShowWeather, backend_.online);

    // 番茄钟胶囊:未运行显示"番茄钟",运行中显示走动的剩余时间并高亮。
    // 点击进入番茄钟页面。主页纯本地渲染,不会被后端页面覆盖,入口最稳。
    const bool pomodoro_active = pomodoro_running_;
    const std::string pomodoro_text = pomodoro_active ? FormatTime(pomodoro_remaining_sec_) : "番茄钟";
    CreateButton(content_, pomodoro_text.c_str(), 78, 0, 78, 30, OnShowPomodoro, pomodoro_active);

    std::string next = backend_.next_schedule.time + " " + backend_.next_schedule.title;
    auto next_card = CreatePanel(content_, 0, 38, 276, 62, kPanelBg, backend_.online ? kAccentBlue : kBorder, 16);
    lv_obj_add_flag(next_card, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(next_card, OnShowSchedule, LV_EVENT_CLICKED, nullptr);
    CreateLabel(next_card, "下一项", -92, 8, 70, kMutedText, LV_TEXT_ALIGN_LEFT);
    CreateLabelBox(next_card, next.c_str(), 18, 8, 180, 30, kText, LV_TEXT_ALIGN_LEFT, LV_LABEL_LONG_WRAP);
    CreateLabel(next_card, backend_.online ? "在线" : "离线", 92, 40, 54, backend_.online ? kAccent : kWarm,
                LV_TEXT_ALIGN_RIGHT);

    const auto& active_music = backend_.music.Active();
    std::string music_status = std::string(backend_.music.ActiveLabel()) +
                               (active_music.playing ? "播放中" : "待播放");
    CreateTile(content_, "音乐", music_status.c_str(), -kTileColumnX, 112, OnShowMusic,
               backend_.music.IsPlaying(), kWarm);
    CreateTile(content_, "播客", "在线音乐", kTileColumnX, 112, OnShowMusicServer,
               backend_.music.server.playing, kWarm);
    CreateTile(content_, "口语", "小智官方", -kTileColumnX, 172, OnShowEnglish, false, kAccentBlue);
    CreateTile(content_, "应用", "游戏/工具", kTileColumnX, 172, OnShowApps, false, kAccentBlue);
}

void AppShell::RenderWeather() {
    const auto& weather = backend_.weather;
    const uint32_t weather_accent = WeatherAccent(weather.weather_code);
    const std::string update = WeatherUpdateLabel(weather, backend_.online);
    CreateLabel(content_, update.c_str(), 0, 0, 220, weather.is_stale || !backend_.online ? kWarm : kMutedText,
                LV_TEXT_ALIGN_CENTER);

    if (!weather.available) {
        CreateLabel(content_, "天气暂不可用", 0, 64, 220, kText, LV_TEXT_ALIGN_CENTER);
        CreateLabel(content_, "刷新后获取当前位置天气", 0, 98, 240, kMutedText, LV_TEXT_ALIGN_CENTER);
    } else {
        char current[48];
        std::snprintf(current, sizeof(current), "%s %d℃", weather.condition.c_str(), weather.temperature);
        auto current_label = CreateLabel(content_, current, 0, 30, 220, weather_accent, LV_TEXT_ALIGN_CENTER);
        lv_obj_set_style_transform_zoom(current_label, 260, 0);

        if (weather.apparent_temperature != 0) {
            char apparent[32];
            std::snprintf(apparent, sizeof(apparent), "体感 %d℃", weather.apparent_temperature);
            CreateLabel(content_, apparent, 0, 78, 180, kMutedText, LV_TEXT_ALIGN_CENTER);
        }

        auto humidity_panel = CreatePanel(content_, -70, 104, 126, 36, kPanelSoftBg, kBorder, 8);
        char humidity[32];
        std::snprintf(humidity, sizeof(humidity), "湿度 %d%%", weather.humidity);
        CreateLabel(humidity_panel, humidity, 0, 8, 108, kAccent, LV_TEXT_ALIGN_CENTER);

        auto air_panel = CreatePanel(content_, 70, 104, 126, 36, kPanelSoftBg, kBorder, 8);
        std::string air = weather.aqi >= 0
            ? (weather.air_level + " · AQI " + std::to_string(weather.aqi))
            : weather.air;
        CreateLabel(air_panel, air.c_str(), 0, 8, 112, AirAccent(weather.aqi), LV_TEXT_ALIGN_CENTER);

        auto tonight_panel = CreatePanel(content_, -70, 150, 126, 50, kPanelBg, kBorder, 8);
        CreateLabel(tonight_panel, "今晚", 0, 8, 100, kMutedText, LV_TEXT_ALIGN_CENTER);
        std::string tonight = weather.tonight_available
            ? (std::to_string(weather.tonight_temperature) + "℃ " + weather.tonight_condition)
            : "暂无预报";
        CreateLabel(tonight_panel, tonight.c_str(), 0, 28, 108, kText, LV_TEXT_ALIGN_CENTER);

        auto tomorrow_panel = CreatePanel(content_, 70, 150, 126, 50, kPanelBg, kBorder, 8);
        CreateLabel(tomorrow_panel, "明天", 0, 8, 100, kMutedText, LV_TEXT_ALIGN_CENTER);
        std::string tomorrow = weather.tomorrow_available
            ? (std::to_string(weather.tomorrow_high) + "/" +
               std::to_string(weather.tomorrow_low) + "℃ " + weather.tomorrow_condition)
            : "暂无预报";
        CreateLabel(tomorrow_panel, tomorrow.c_str(), 0, 28, 108, kText, LV_TEXT_ALIGN_CENTER);
    }

    CreateButton(content_, weather_refreshing_.load() ? "更新中" : "刷新", 0, 204, 112, 34,
                 OnRefreshWeather, weather_refreshing_.load());
}

void AppShell::RenderAskAi() {
    const uint32_t primary = AiPrimaryColor(ai_state_);
    const uint32_t secondary = AiSecondaryColor(ai_state_);
    const int phase = ai_anim_frame_ % 12;
    const int center_y = 80;
    const int breath = IsAiActive() ? (phase % 4) * 2 : (phase % 5);

    auto status = CreatePanel(content_, 0, 0, 168, 26, IsAiActive() ? kPanelActiveBg : kPanelSoftBg,
                              primary, 8);
    std::string status_text = std::string(AiPageStateLabel(ai_state_)) + (backend_.online ? " · 在线" : " · 离线");
    CreateLabel(status, status_text.c_str(), 0, 5, 138, IsAiActive() ? primary : kMutedText,
                LV_TEXT_ALIGN_CENTER);

    CreateGlowCircle(content_, 0, center_y, 96 + breath, primary, LV_OPA_10, 1);
    CreateGlowCircle(content_, 0, center_y, 78 + breath / 2, secondary, LV_OPA_20, 1);
    CreateGlowCircle(content_, 0, center_y, 58, kPanelActiveBg, LV_OPA_COVER, 2);

    const int orbit_x[6] = {0, 38, 38, 0, -38, -38};
    const int orbit_y[6] = {-36, -18, 18, 36, 18, -18};
    for (int i = 0; i < 6; ++i) {
        const int dot_phase = phase % 6;
        const bool hot = i == dot_phase || (IsAiActive() && i == (dot_phase + 3) % 6);
        CreateGlowDot(content_, orbit_x[i], center_y + orbit_y[i], hot ? 8 : 5, hot ? primary : secondary,
                      hot ? LV_OPA_COVER : LV_OPA_40);
    }

    auto core = CreateGlowCircle(content_, 0, center_y, 48 + (IsAiActive() ? phase % 2 * 3 : 0), primary,
                                 LV_OPA_30, 2);
    CreateLabel(core, AiCoreText(ai_state_), 0, 7, 40, kText, LV_TEXT_ALIGN_CENTER);
    CreateLabel(core, IsAiActive() ? "LIVE" : "READY", 0, 28, 42, primary, LV_TEXT_ALIGN_CENTER);

    const int idle_wave[7] = {10, 14, 18, 24, 18, 14, 10};
    const int listen_wave[7] = {16, 26, 38, 48, 36, 24, 18};
    const int speak_wave[7] = {24, 42, 28, 50, 34, 46, 22};
    const int connect_wave[7] = {12, 18, 24, 30, 24, 18, 12};
    const int* wave = idle_wave;
    if (ai_state_ == kDeviceStateListening) {
        wave = listen_wave;
    } else if (ai_state_ == kDeviceStateSpeaking) {
        wave = speak_wave;
    } else if (ai_state_ == kDeviceStateConnecting || ai_state_ == kDeviceStateActivating) {
        wave = connect_wave;
    }
    for (int i = 0; i < 7; ++i) {
        int index = (i + phase) % 7;
        int height = wave[index];
        if (!IsAiActive() && i % 2 == phase % 2) {
            height += 4;
        }
        CreateWaveBar(content_, -48 + i * 16, 150, 7, height, i == 3 ? primary : secondary,
                      i == 3 ? LV_OPA_COVER : LV_OPA_70);
    }

    const bool has_caption = !subtitle_.empty() && subtitle_ != "AI 待命";
    const std::string caption = has_caption ? subtitle_ : AiVisualHint(ai_state_);
    auto caption_label = CreateLabelBox(content_, caption.c_str(), 0, 158, 248, 40,
                                        has_caption ? kText : primary, LV_TEXT_ALIGN_CENTER,
                                        LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_line_space(caption_label, 0, 0);
}

void AppShell::RenderMusicLocal() {
    const bool playing = AppLocalMusicPlayer::GetInstance().playing();
    const int track_count = AppStorageManager::GetInstance().status().music_count;
    const bool has_local = track_count > 0;
    auto& local_player = AppLocalMusicPlayer::GetInstance();

    const std::string count = std::to_string(track_count) + " 首";
    std::string status = playing ? "播放中" : (has_local ? "待播放" : "未就绪");
    std::string top_line = status + " · " + count;
    CreateLabel(content_, top_line.c_str(), 0, 2, 220, playing ? kAccent : kAccentBlue, LV_TEXT_ALIGN_CENTER);

    auto card = CreatePanel(content_, 0, 28, 276, 92, playing ? kPanelActiveBg : kPanelBg, kAccentBlue, 20);
    std::string title = playing ? local_player.DisplayTitle() : (has_local ? "SD 本地音乐" : "SD 无本地音乐");
    CreateLabelBox(card, title.c_str(), 0, 12, 238, 42, kText, LV_TEXT_ALIGN_CENTER, LV_LABEL_LONG_WRAP);
    std::string detail = playing ? local_player.MetadataLine() : (has_local ? "轻触播放本地音频" : "等待 /music/local");
    CreateLabel(card, detail.c_str(), 0, 62, 238, has_local || playing ? kMutedText : kWarm,
                LV_TEXT_ALIGN_CENTER);

    const int position_ms = local_player.position_ms();
    const int duration_ms = local_player.duration_ms();
    const bool has_duration = local_player.has_reliable_duration();

    int bar_value = 0;
    if (has_duration) {
        const int safe_position_ms = ClampInt(position_ms, 0, duration_ms);
        bar_value = ClampInt(safe_position_ms * 100 / duration_ms, 0, 100);
    }
    auto bar = lv_bar_create(content_);
    lv_obj_set_size(bar, 236, 8);
    lv_obj_align(bar, LV_ALIGN_TOP_MID, 0, 136);
    lv_bar_set_range(bar, 0, 100);
    lv_bar_set_value(bar, bar_value, LV_ANIM_OFF);
    lv_obj_set_style_bg_color(bar, lv_color_hex(kBorder), 0);
    lv_obj_set_style_bg_color(bar, lv_color_hex(kAccentBlue), LV_PART_INDICATOR);

    std::string progress = FormatMusicProgressText(position_ms, duration_ms, has_duration);
    CreateLabel(content_, progress.c_str(), 0, 152, 180, kMutedText, LV_TEXT_ALIGN_CENTER);

    CreateVolumeButton(content_, "-", -124, 184, 38, 36, OnMusicVolumeDown);
    CreateControlButton(content_, playing ? "暂停" : "播放", -67, 184, 58, 36, OnMusicSdPlayPause, playing);
    CreateControlButton(content_, "下首", -9, 184, 48, 36, OnMusicSdNext);
    CreateControlButton(content_, "扫描", 49, 184, 54, 36, OnMusicSdScan);
    CreateVolumeButton(content_, "+", 118, 184, 38, 36, OnMusicVolumeUp);
}

void AppShell::RenderMusicServer() {
    const auto& server = backend_.music.server;
    const bool playing = AppServerMusicPlayer::GetInstance().playing();
    auto& server_player = AppServerMusicPlayer::GetInstance();

    const std::string count = std::to_string(server.track_count) + " 项";
    std::string status = playing ? "播放中" : (server.available ? "待播放" : "未就绪");
    std::string top_line = status + " · " + count;
    CreateLabel(content_, top_line.c_str(), 0, 2, 220, playing ? kAccent : kWarm, LV_TEXT_ALIGN_CENTER);

    auto card = CreatePanel(content_, 0, 28, 276, 92, playing ? kPanelActiveBg : kPanelBg, kWarm, 20);
    std::string title = playing ? server_player.DisplayTitle() :
                        (!server.title.empty() ? server.title : "服务器暂无音频");
    CreateLabelBox(card, title.c_str(), 0, 12, 238, 42, kText, LV_TEXT_ALIGN_CENTER, LV_LABEL_LONG_WRAP);
    std::string detail = playing ? server_player.MetadataLine() :
                         (server.available ? server.detail : "后端在线后可播放服务器音频");
    CreateLabel(card, detail.c_str(), 0, 62, 238, server.available || playing ? kMutedText : kWarm,
                LV_TEXT_ALIGN_CENTER);

    const int position_ms = server_player.position_ms();
    const int duration_ms = server_player.duration_ms();
    const bool has_duration = server_player.has_reliable_duration();

    int bar_value = 0;
    if (has_duration) {
        const int safe_position_ms = ClampInt(position_ms, 0, duration_ms);
        bar_value = ClampInt(safe_position_ms * 100 / duration_ms, 0, 100);
    }
    auto bar = lv_bar_create(content_);
    lv_obj_set_size(bar, 236, 8);
    lv_obj_align(bar, LV_ALIGN_TOP_MID, 0, 136);
    lv_bar_set_range(bar, 0, 100);
    lv_bar_set_value(bar, bar_value, LV_ANIM_OFF);
    lv_obj_set_style_bg_color(bar, lv_color_hex(kBorder), 0);
    lv_obj_set_style_bg_color(bar, lv_color_hex(kWarm), LV_PART_INDICATOR);

    std::string progress = FormatMusicProgressText(position_ms, duration_ms, has_duration);
    CreateLabel(content_, progress.c_str(), 0, 152, 180, kMutedText, LV_TEXT_ALIGN_CENTER);

    CreateVolumeButton(content_, "-", -124, 184, 38, 36, OnMusicVolumeDown);
    CreateControlButton(content_, playing ? "暂停" : "播放", -67, 184, 58, 36, OnMusicServerPlayPause, playing);
    CreateControlButton(content_, "下集", -9, 184, 48, 36, OnMusicServerNext);
    CreateControlButton(content_, "缓存", 49, 184, 54, 36, OnMusicServerCache);
    CreateVolumeButton(content_, "+", 118, 184, 38, 36, OnMusicVolumeUp);
}

void AppShell::RenderScreensaver() {
    const auto& storage = AppStorageManager::GetInstance();
    const auto& images = storage.image_files();
    std::string image_path;
    if (storage.mounted() && !images.empty()) {
        const size_t start = (tick_count_ / 10) % images.size();
        for (size_t offset = 0; offset < images.size(); ++offset) {
            const size_t index = (start + offset) % images.size();
            if (IsScreensaverImageFile(images[index])) {
                image_path = images[index];
                break;
            }
        }
    }
    const bool has_sd_images = !image_path.empty();
    if (!has_sd_images) {
        ReleaseScreensaverImage();
    }
    const bool image_ready = has_sd_images && LoadScreensaverImage(image_path);
    std::string image_title = has_sd_images ? "SD 相册" : "图片屏保";
    std::string image_subtitle;
    if (has_sd_images) {
        image_subtitle = FileNameOf(image_path);
    } else {
        image_subtitle = images.empty() ? "等待 /images 图片" : "请使用 JPG 图片";
    }

    auto frame = CreatePanel(content_, 0, 4, 286, 184, image_ready ? 0x05070a : kPanelSoftBg,
                             image_ready ? kAccentBlue : kBorder, 22);
    lv_obj_set_style_clip_corner(frame, true, 0);
    if (image_ready && screensaver_image_dsc_ != nullptr) {
        auto img = lv_image_create(frame);
        lv_image_set_src(img, static_cast<lv_image_dsc_t*>(screensaver_image_dsc_));
        lv_obj_center(img);
    } else {
        CreateLabel(frame, image_title.c_str(), 0, 54, 180, kText, LV_TEXT_ALIGN_CENTER);
        CreateLabel(frame, image_subtitle.c_str(), 0, 84, 196, kMutedText, LV_TEXT_ALIGN_CENTER);
        if (storage.mounted()) {
            std::string count = std::to_string(images.size()) + " 张图片";
            CreateLabel(frame, count.c_str(), 0, 112, 166, kAccentBlue, LV_TEXT_ALIGN_CENTER);
        }
    }
    CreateButton(content_, "退出", 0, kSafeActionTop, 104, kSafeActionHeight, OnScreensaverStop);
}

void AppShell::RenderApps() {
    if (AppRemotePageRenderer::GetInstance().RenderCachedPage("apps", content_)) {
        return;
    }

    CreateTile(content_, "小游戏", "Focus Tap", -kTileColumnX, 0, OnShowMiniGame, false, kWarm);
    CreateTile(content_, "OpenClaw", "远程程序", kTileColumnX, 0, OnOpenClaw, false, kAccent);
    CreateTile(content_, "HA 场景", "家庭控制", -kTileColumnX, 60, OnHomeAssistant, false, kAccentBlue);
    CreateTile(content_, "NAS 扫描", "媒体索引", kTileColumnX, 60, OnNasMusicScan, false, kAccentBlue);
}

void AppShell::RenderContent() {
    const auto& storage_manager = AppStorageManager::GetInstance();
    const auto& storage = storage_manager.status();
    const auto& images = storage_manager.image_files();
    std::string image_path;
    if (storage.mounted && !images.empty()) {
        for (const auto& candidate : images) {
            if (IsScreensaverImageFile(candidate)) {
                image_path = candidate;
                break;
            }
        }
    }
    const bool image_ready = !image_path.empty() && LoadScreensaverImage(image_path);
    if (image_path.empty()) {
        ReleaseScreensaverImage();
    }

    const std::string image_count = std::to_string(storage.image_count) + " 张";
    const std::string resource_state = AppResourceManager::GetInstance().status().ready ? "资源就绪" : "资源同步中";

    auto frame = CreatePanel(content_, 0, 4, 286, 168, image_ready ? 0x05070a : kPanelSoftBg,
                             image_ready ? kAccentBlue : kBorder, 22);
    lv_obj_set_style_clip_corner(frame, true, 0);
    if (image_ready && screensaver_image_dsc_ != nullptr) {
        auto img = lv_image_create(frame);
        lv_image_set_src(img, static_cast<lv_image_dsc_t*>(screensaver_image_dsc_));
        lv_obj_center(img);
    } else {
        CreateLabel(frame, storage.mounted ? "等待照片" : "SD 未挂载", 0, 54, 170, kText, LV_TEXT_ALIGN_CENTER);
        CreateLabel(frame, storage.mounted ? "/images" : "插入资源卡", 0, 84, 170, kMutedText, LV_TEXT_ALIGN_CENTER);
    }

    std::string status = storage.mounted ? ("相册 " + image_count + " · SD 就绪 · " + resource_state)
                                         : ("SD 未挂载 · " + storage.last_error);
    CreateLabel(content_, status.c_str(), 0, 180, 244, storage.mounted ? kAccentBlue : kWarm,
                LV_TEXT_ALIGN_CENTER);
    CreateButton(content_, "屏保", 0, kSafeActionTop, 104, kSafeActionHeight, OnScreensaverStart);
}

void AppShell::RenderEnglishPractice() {
    const auto& english = backend_.english;
    const bool active = IsAiActive();
    const std::string prompt = english.prompt.empty() ? "Say one sentence about your day." : english.prompt;

    auto status = CreatePanel(content_, 0, 0, 184, 26, active ? kPanelActiveBg : kPanelSoftBg,
                              active ? kAccent : kAccentBlue, 8);
    std::string status_text = active ? (std::string(AiPageStateLabel(ai_state_)) + " · 小智官方")
                                     : "小智官方口语陪练";
    CreateLabel(status, status_text.c_str(), 0, 5, 164, active ? kAccent : kAccentBlue,
                LV_TEXT_ALIGN_CENTER);

    auto dialog_card = CreatePanel(content_, 0, 34, 286, 204, active ? kPanelActiveBg : kPanelBg,
                                   active ? kAccent : kAccentBlue, 14);
    if (!last_assistant_transcript_.empty()) {
        CreateLabel(dialog_card, "AI", -112, 14, 44, kAccent, LV_TEXT_ALIGN_LEFT);
        CreateLabelBox(dialog_card, last_assistant_transcript_.c_str(), 0, 34, 244, 78, kText,
                       LV_TEXT_ALIGN_LEFT, LV_LABEL_LONG_WRAP);
        if (!last_user_transcript_.empty()) {
            CreateLabel(dialog_card, "You", -112, 126, 54, kAccentBlue, LV_TEXT_ALIGN_LEFT);
            CreateLabelBox(dialog_card, last_user_transcript_.c_str(), 0, 138, 244, 40, kMutedText,
                           LV_TEXT_ALIGN_LEFT, LV_LABEL_LONG_WRAP);
        }
    } else if (!last_user_transcript_.empty()) {
        CreateLabel(dialog_card, "You", -112, 18, 54, kAccentBlue, LV_TEXT_ALIGN_LEFT);
        CreateLabelBox(dialog_card, last_user_transcript_.c_str(), 0, 44, 244, 112, kText,
                       LV_TEXT_ALIGN_LEFT, LV_LABEL_LONG_WRAP);
    } else {
        CreateLabel(dialog_card, "Try saying", 0, 24, 220, kAccentBlue, LV_TEXT_ALIGN_CENTER);
        CreateLabelBox(dialog_card, prompt.c_str(), 0, 66, 244, 86, kText, LV_TEXT_ALIGN_CENTER,
                       LV_LABEL_LONG_WRAP);
    }
}

void AppShell::RenderSchedule() {
    if (backend_.today_schedule.empty()) {
        auto empty = CreatePanel(content_, 0, 28, 264, 126, kPanelSoftBg, kBorder, 18);
        CreateLabel(empty, "今天暂无日程", 0, 40, 200, kText, LV_TEXT_ALIGN_CENTER);
        CreateLabel(empty, "有安排时会显示下一项", 0, 72, 210, kMutedText, LV_TEXT_ALIGN_CENTER);
    } else {
        const AppScheduleItem* primary = nullptr;
        const AppScheduleItem* secondary = nullptr;
        int pending_count = 0;
        for (const auto& item : backend_.today_schedule) {
            if (!item.done) {
                ++pending_count;
                if (primary == nullptr) {
                    primary = &item;
                } else if (secondary == nullptr) {
                    secondary = &item;
                }
            }
        }
        if (primary == nullptr) {
            primary = &backend_.today_schedule.front();
        }

        auto card = CreatePanel(content_, 0, 8, 276, 142, primary->done ? kPanelBg : kPanelActiveBg,
                                primary->done ? kBorder : kAccent, 18);
        CreateLabel(card, primary->time.c_str(), -88, 18, 78, primary->done ? kMutedText : kAccent,
                    LV_TEXT_ALIGN_LEFT);
        CreateLabel(card, primary->done ? "已完成" : "待处理", 88, 18, 74,
                    primary->done ? kMutedText : kWarm, LV_TEXT_ALIGN_RIGHT);
        CreateLabelBox(card, primary->title.c_str(), 0, 48, 230, 54, kText, LV_TEXT_ALIGN_CENTER,
                       LV_LABEL_LONG_WRAP);
        std::string remaining = pending_count > 0 ? ("今日剩余 " + std::to_string(pending_count) + " 项")
                                                  : "今天事项已处理";
        CreateLabel(card, remaining.c_str(), 0, 110, 210, kMutedText, LV_TEXT_ALIGN_CENTER);

        if (secondary != nullptr) {
            std::string more = "随后 " + secondary->time + " · " + secondary->title;
            CreateLabelBox(content_, more.c_str(), 0, 160, 244, 30, kMutedText, LV_TEXT_ALIGN_CENTER,
                           LV_LABEL_LONG_DOT);
        }
    }
    CreateButton(content_, "完成", -58, kSafeActionTop, 96, kSafeActionHeight, OnScheduleComplete, false);
    CreateButton(content_, "稍后", 58, kSafeActionTop, 96, kSafeActionHeight, OnScheduleSnooze, false);
}

void AppShell::RenderNotifications() {
    if (backend_.notifications.empty()) {
        auto empty = CreatePanel(content_, 0, 36, 264, 120, kPanelSoftBg, kBorder, 18);
        CreateLabel(empty, "暂无通知", 0, 38, 200, kText, LV_TEXT_ALIGN_CENTER);
        CreateLabel(empty, "新的提醒会显示在这里", 0, 70, 210, kMutedText, LV_TEXT_ALIGN_CENTER);
    } else {
        const auto& item = backend_.notifications.front();
        uint32_t accent = item.level == "warn" ? kWarm : (item.level == "error" ? kDanger : kAccent);
        auto card = CreatePanel(content_, 0, 8, 276, 138, kPanelBg, accent, 18);
        CreateLabel(card, "最新通知", -82, 16, 76, kMutedText, LV_TEXT_ALIGN_LEFT);
        CreateLabel(card, item.level.c_str(), 92, 16, 66, accent, LV_TEXT_ALIGN_RIGHT);
        CreateLabelBox(card, item.title.c_str(), 0, 42, 232, 36, kText, LV_TEXT_ALIGN_CENTER,
                       LV_LABEL_LONG_WRAP);
        CreateLabelBox(card, item.message.c_str(), 0, 86, 236, 42, kMutedText, LV_TEXT_ALIGN_CENTER,
                       LV_LABEL_LONG_WRAP);
        if (backend_.notifications.size() > 1) {
            const auto& next = backend_.notifications[1];
            std::string more = "还有 " + std::to_string(backend_.notifications.size() - 1) +
                               " 条 · " + next.title;
            CreateLabelBox(content_, more.c_str(), 0, 164, 244, 28, kMutedText, LV_TEXT_ALIGN_CENTER,
                           LV_LABEL_LONG_DOT);
        }
    }
    CreateButton(content_, "日程", 0, kSafeActionTop, 112, kSafeActionHeight, OnShowSchedule);
}

void AppShell::RenderSettings() {
    CreateTile(content_, "网络", backend_.online ? "后端在线" : "后端离线", -kTileColumnX, 0,
               OnShowSettingsNetwork, backend_.online, backend_.online ? kAccent : kWarm);
    CreateTile(content_, "连接", AppConnectivityManager::GetInstance().ProvidersLine().c_str(), kTileColumnX, 0,
               OnShowSettingsConnectivity, AppConnectivityManager::GetInstance().status().online, kAccentBlue);
    CreateTile(content_, "电源", BatteryStatusLine().c_str(), -kTileColumnX, 58,
               OnShowSettingsPower, IsSuspiciousReset(last_reset_code_), IsSuspiciousReset(last_reset_code_) ? kDanger : kWarm);
    CreateTile(content_, "存储", AppStorageManager::GetInstance().StatusLine().c_str(), kTileColumnX, 58,
               OnShowSettingsStorage, AppStorageManager::GetInstance().mounted(),
               AppStorageManager::GetInstance().mounted() ? kAccent : kWarm);
    CreateTile(content_, "系统", ResetStatusLine().c_str(), -kTileColumnX, 116,
               OnShowSettingsSystem, IsSuspiciousReset(last_reset_code_), IsSuspiciousReset(last_reset_code_) ? kDanger : kAccentBlue);
    CreateTile(content_, "诊断", AppSyncQueue::GetInstance().StatusLine().c_str(), kTileColumnX, 116,
               OnShowSettingsDiagnostics, AppSyncQueue::GetInstance().status().pending_count > 0, kWarm);

    CreateButton(content_, "刷新", -54, kSafeActionTop, 92, kSafeActionHeight, OnRefreshBackend, backend_.online);
    CreateButton(content_, "首页", 54, kSafeActionTop, 92, kSafeActionHeight, OnShowHome);
}

void AppShell::RenderSettingsNetwork() {
    std::string refresh_age = "未刷新";
    if (last_backend_refresh_result_tick_ > -900) {
        refresh_age = std::to_string(std::max(0, tick_count_ - last_backend_refresh_result_tick_)) + "s 前";
    }
    std::string backend_line = backend_.online ? ("在线 " + refresh_age) : ("离线 " + refresh_age);
    std::string backend_detail = backend_line + " 246:3100";
    std::string ssid_line = AppConnectivityManager::GetInstance().status().detail;
    std::string signal_line = "--";
    std::string ip_line = "--";
    auto root = cJSON_Parse(Board::GetInstance().GetBoardJson().c_str());
    if (root != nullptr) {
        std::string ssid = JsonString(root, "ssid", "");
        if (!ssid.empty()) {
            ssid_line = ssid;
        }
        int rssi = JsonInt(root, "rssi", 0);
        int channel = JsonInt(root, "channel", 0);
        if (rssi != 0 || channel != 0) {
            signal_line = std::to_string(rssi) + " dBm";
            if (channel > 0) {
                signal_line += " ch";
                signal_line += std::to_string(channel);
            }
        }
        ip_line = JsonString(root, "ip", ip_line);
        cJSON_Delete(root);
    }
    auto card = CreateSettingsDetailPanel(content_, "网络", backend_.online ? "后端在线" : "后端离线",
                                          backend_.online ? kAccent : kWarm);
    CreateSettingsDetailRow(card, "Wi-Fi", ssid_line.c_str(), 48,
                            AppConnectivityManager::GetInstance().status().online ? kText : kMutedText);
    CreateSettingsDetailRow(card, "信号", signal_line.c_str(), 78, kAccentBlue);
    CreateSettingsDetailRow(card, "IP", ip_line.c_str(), 108, kAccentBlue);
    CreateSettingsDetailRow(card, "后端", backend_line.c_str(), 138, backend_.online ? kAccent : kWarm);
    CreateSettingsDetailRow(card, "地址", "246:3100", 168, kMutedText);
    CreateButton(content_, "刷新", -54, kSafeActionTop, 92, kSafeActionHeight, OnRefreshBackend, backend_.online);
    CreateButton(content_, "返回", 54, kSafeActionTop, 92, kSafeActionHeight, OnShowSettings);
}

void AppShell::RenderSettingsConnectivity() {
    const bool online = AppConnectivityManager::GetInstance().status().online;
    std::string wifi_state = ProviderShortState(AppConnectivityProviderKind::kWifi, "在线", "离线");
    std::string ble_state = ProviderShortState(AppConnectivityProviderKind::kBleProxy, "可用", "待接入");
    std::string usb_state = ProviderShortState(AppConnectivityProviderKind::kUsb, "可用", "诊断");
    std::string cell_state = ProviderShortState(AppConnectivityProviderKind::kFutureCellular, "可用", "预留");
    std::string summary = "Wi-Fi " + wifi_state + " · BLE " + ble_state;
    auto card = CreateSettingsDetailPanel(content_, "连接", online ? "链路可用" : "链路待恢复",
                                          online ? kAccent : kWarm);
    CreateSettingsDetailRow(card, "摘要", summary.c_str(), 48, kMutedText);
    CreateSettingsDetailRow(card, "Wi-Fi", wifi_state.c_str(), 78, online ? kAccent : kWarm);
    CreateSettingsDetailRow(card, "蓝牙", ble_state.c_str(), 108,
                            ble_state == "可用" ? kAccentBlue : kMutedText);
    CreateSettingsDetailRow(card, "USB", usb_state.c_str(), 138,
                            usb_state == "可用" ? kAccentBlue : kMutedText);
    CreateSettingsDetailRow(card, "蜂窝", cell_state.c_str(), 168,
                            cell_state == "可用" ? kAccentBlue : kMutedText);
    CreateButton(content_, "刷新", -54, kSafeActionTop, 92, kSafeActionHeight, OnRefreshBackend, backend_.online);
    CreateButton(content_, "返回", 54, kSafeActionTop, 92, kSafeActionHeight, OnShowSettings);
}

void AppShell::RenderSettingsPower() {
    BatteryInfo battery;
    bool has_battery = ReadBatteryInfo(battery);
    std::string level = has_battery ? BatteryStatusLine(battery) : "电量 未知";
    std::string voltage = has_battery ? BatteryVoltageLine(battery) : "电压 未知";
    std::string current = has_battery ? BatteryCurrentLine(battery) : "电流 未知";
    std::string health = has_battery ? BatteryHealthLine(battery) : "SOH 未知";
    std::string gauge = has_battery && battery.gauge_online ? "在线" : "未响应";

    auto card = CreateSettingsDetailPanel(content_, "电源", level.c_str(), has_battery ? kWarm : kBorder);
    CreateSettingsDetailRow(card, "电量", level.c_str(), 48, has_battery ? kWarm : kMutedText);
    CreateSettingsDetailRow(card, "电压", voltage.c_str(), 78, has_battery ? kAccentBlue : kMutedText);
    CreateSettingsDetailRow(card, "电流", current.c_str(), 108,
                            has_battery ? (battery.charging ? kAccent : kWarm) : kMutedText);
    CreateSettingsDetailRow(card, "健康", health.c_str(), 138,
                            has_battery && battery.health_percent >= 0 ? kAccent : kMutedText);
    CreateSettingsDetailRow(card, "计量", gauge.c_str(), 168,
                            has_battery && battery.gauge_online ? kAccentBlue : kMutedText);
    CreateButton(content_, "刷新", -54, kSafeActionTop, 92, kSafeActionHeight, OnRefreshBackend, backend_.online);
    CreateButton(content_, "返回", 54, kSafeActionTop, 92, kSafeActionHeight, OnShowSettings);
}

void AppShell::RenderSettingsStorage() {
    const auto& storage = AppStorageManager::GetInstance().status();
    std::string capacity = storage.mounted ? (FormatKilobytes(storage.free_kb) + "/" + FormatKilobytes(storage.total_kb)) :
                                            storage.last_error;
    auto card = CreateSettingsDetailPanel(content_, "存储", storage.mounted ? "SD 已挂载" : "SD 未挂载",
                                          storage.mounted ? kAccent : kWarm);
    const std::string music_count = std::to_string(storage.music_count) + " 首";
    const std::string image_count = std::to_string(storage.image_count) + " 张";
    CreateSettingsDetailRow(card, "容量", capacity.c_str(), 48, storage.mounted ? kAccentBlue : kMutedText);
    CreateSettingsDetailRow(card, "音乐", music_count.c_str(), 78,
                            storage.music_count > 0 ? kAccent : kMutedText);
    CreateSettingsDetailRow(card, "图片", image_count.c_str(), 108,
                            storage.image_count > 0 ? kAccentBlue : kMutedText);
    CreateSettingsDetailRow(card, "资源", AppResourceManager::GetInstance().status().ready ? "就绪" : "同步中", 138,
                            AppResourceManager::GetInstance().status().ready ? kAccent : kWarm);
    CreateSettingsDetailRow(card, "状态", storage.mounted ? "可用" : "未就绪", 168,
                            storage.mounted ? kAccent : kWarm);
    CreateButton(content_, "刷新", -54, kSafeActionTop, 92, kSafeActionHeight, OnRefreshBackend, backend_.online);
    CreateButton(content_, "返回", 54, kSafeActionTop, 92, kSafeActionHeight, OnShowSettings);
}

void AppShell::RenderSettingsSystem() {
    std::string heap = "空闲 " + FormatBytesAsKb(SystemInfo::GetFreeHeapSize()) +
                       " 最低 " + FormatBytesAsKb(SystemInfo::GetMinimumFreeHeapSize());
    const uint32_t heap_color = SystemInfo::GetMinimumFreeHeapSize() >= 12 * 1024 ? kAccent : kDanger;
    auto card = CreateSettingsDetailPanel(content_, "系统", SystemInfo::GetChipModelName().c_str(),
                                          IsSuspiciousReset(last_reset_code_) ? kDanger : kAccentBlue);
    CreateSettingsDetailRow(card, "芯片", SystemInfo::GetChipModelName().c_str(), 48, kAccent);
    CreateSettingsDetailRow(card, "内存", heap.c_str(), 78, heap_color);
    CreateSettingsDetailRow(card, "重启", ResetStatusLine().c_str(), 108,
                            IsSuspiciousReset(last_reset_code_) ? kDanger : kAccentBlue);
    CreateSettingsDetailRow(card, "小智", IsAiActive() ? "语音链路工作中" : "官方链路待命", 138, kAccent);
    CreateSettingsDetailRow(card, "固件", "2.2.6", 168, kAccentBlue);
    CreateButton(content_, "刷新", -54, kSafeActionTop, 92, kSafeActionHeight, OnRefreshBackend, backend_.online);
    CreateButton(content_, "返回", 54, kSafeActionTop, 92, kSafeActionHeight, OnShowSettings);
}

void AppShell::RenderSettingsDiagnostics() {
    auto card = CreateSettingsDetailPanel(content_, "诊断", AppSyncQueue::GetInstance().StatusLine().c_str(),
                                          AppSyncQueue::GetInstance().status().pending_count > 0 ? kWarm : kAccent);
    const std::string notification_count = std::to_string(backend_.notifications.size());
    CreateSettingsDetailRow(card, "同步", AppSyncQueue::GetInstance().StatusLine().c_str(), 48,
                            AppSyncQueue::GetInstance().status().pending_count > 0 ? kWarm : kAccent);
    CreateSettingsDetailRow(card, "后端", last_backend_refresh_status_.c_str(), 78,
                            backend_.online ? kAccent : kWarm);
    CreateSettingsDetailRow(card, "探针", backend_event_failures_ > 0 ? "异常" : "正常", 108,
                            backend_event_failures_ > 0 ? kWarm : kAccentBlue);
    CreateSettingsDetailRow(card, "动作", (backend_action_busy_.load() || backend_action_pending_) ? "进行中" : "空闲", 138,
                            backend_action_busy_.load() || backend_action_pending_ ? kWarm : kAccent);
    CreateSettingsDetailRow(card, "通知", notification_count.c_str(), 168,
                            backend_.notifications.empty() ? kMutedText : kWarm);
    CreateButton(content_, "通知", -54, kSafeActionTop, 92, kSafeActionHeight, OnShowNotifications,
                 !backend_.notifications.empty());
    CreateButton(content_, "返回", 54, kSafeActionTop, 92, kSafeActionHeight, OnShowSettings);
}

void AppShell::RenderFamilyMode() {
    CreateTile(content_, "默认", "爸爸妈妈", -kTileColumnX, 8, OnCycleFamilyMode, family_mode_ == "默认", kAccent);
    CreateTile(content_, "儿童", "孩子档案", kTileColumnX, 8, OnCycleFamilyMode, family_mode_ == "儿童", kAccentBlue);
    CreateTile(content_, "访客", "临时使用", 0, 82, OnCycleFamilyMode, family_mode_ == "访客", kMutedText);
    CreateLabel(content_, "点击模式循环切换", 0, 132, 220, kMutedText, LV_TEXT_ALIGN_CENTER);
    CreateButton(content_, "应用", -54, 174, 92, 36, OnShowApps);
    CreateButton(content_, "首页", 54, 174, 92, 36, OnShowHome);
}

void AppShell::RenderMiniGame() {
    char score[32];
    std::snprintf(score, sizeof(score), "%d", mini_game_score_);
    CreateLabel(content_, score, 0, 6, 150, kWarm, LV_TEXT_ALIGN_CENTER);
    char level[32];
    std::snprintf(level, sizeof(level), "Level %d", mini_game_level_);
    CreateLabel(content_, level, 0, 44, 180, kText, LV_TEXT_ALIGN_CENTER);
    CreateLabel(content_, "Focus Tap", 0, 74, 180, kMutedText, LV_TEXT_ALIGN_CENTER);
    CreateButton(content_, "Tap", 0, 108, 168, 52, OnTapMiniGame, true);
    CreateButton(content_, "Reset", -54, 178, 92, 38, OnResetMiniGame);
    CreateButton(content_, "应用", 54, 178, 92, 38, OnShowApps);
}

void AppShell::RenderPomodoro() {
    const bool focus = pomodoro_phase_ == PomodoroPhase::kFocus;
    const uint32_t accent = focus ? kAccent : kAccentBlue;

    // 阶段标签。
    CreateLabel(content_, focus ? "专注" : "休息", 0, 6, 180, accent, LV_TEXT_ALIGN_CENTER);

    // 大号倒计时数字。
    const std::string remaining = FormatTime(pomodoro_remaining_sec_);
    auto time_label = CreateLabel(content_, remaining.c_str(), 0, 40, 260, kText, LV_TEXT_ALIGN_CENTER);
    lv_obj_set_style_transform_zoom(time_label, 320, 0);

    // 今日已完成的专注次数。
    char completed[32];
    std::snprintf(completed, sizeof(completed), "已完成 %d 个", pomodoro_completed_);
    CreateLabel(content_, completed, 0, 108, 200, kMutedText, LV_TEXT_ALIGN_CENTER);

    // 控制按钮:开始/暂停 + 重置。
    CreateButton(content_, pomodoro_running_ ? "暂停" : "开始", 0, 140, 168, 46, OnTogglePomodoro,
                 pomodoro_running_);
    CreateButton(content_, "重置", -54, 200, 92, 38, OnResetPomodoro);
    CreateButton(content_, "应用", 54, 200, 92, 38, OnShowApps);
}

void AppShell::OpenModePopup() {
    DisplayLockGuard lock(display_);
    if (mode_popup_ != nullptr) {
        return;
    }
    mode_popup_ = lv_obj_create(root_);
    lv_obj_remove_style_all(mode_popup_);
    lv_obj_clear_flag(mode_popup_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(mode_popup_, display_->width(), display_->height());
    lv_obj_align(mode_popup_, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_bg_opa(mode_popup_, LV_OPA_50, 0);
    lv_obj_set_style_bg_color(mode_popup_, lv_color_hex(0x000000), 0);
    lv_obj_add_flag(mode_popup_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(mode_popup_, OnDismissModePopup, LV_EVENT_PRESSED, nullptr);

    auto panel = CreatePanel(mode_popup_, 0, 0, 180, 150, kPanelBg, kBorder, 20);
    lv_obj_center(panel);

    const char* modes[] = {"默认", "儿童", "访客"};
    for (int i = 0; i < 3; ++i) {
        auto row = CreateButton(panel, modes[i], 0, 8 + i * 44, 160, 36, OnSelectMode,
                                family_mode_ == modes[i], LV_EVENT_PRESSED, 3);
        lv_obj_set_user_data(row, reinterpret_cast<void*>(static_cast<intptr_t>(i)));
    }

    lv_obj_move_foreground(mode_popup_);
}

void AppShell::SelectModeByIndex(int index) {
    static const char* kModes[] = {"默认", "儿童", "访客"};
    if (index < 0 || index > 2) {
        return;
    }
    CloseModePopup();
    SetFamilyMode(kModes[index]);
}

void AppShell::DeleteModePopupLocked() {
    if (mode_popup_ != nullptr) {
        lv_obj_del(mode_popup_);  // deletes children (panel + rows) too
        mode_popup_ = nullptr;
    }
}

void AppShell::CloseModePopup() {
    DisplayLockGuard lock(display_);
    DeleteModePopupLocked();
}

void AppShell::UpdateClock() {
    if (time_label_ == nullptr) {
        return;
    }

    char buffer[16] = "--:--";
    time_t now = time(nullptr);
    if (now > 1700000000) {
        struct tm local_time;
        localtime_r(&now, &local_time);
        std::snprintf(buffer, sizeof(buffer), "%02d:%02d", local_time.tm_hour, local_time.tm_min);
    }
    lv_label_set_text(time_label_, buffer);
}

void AppShell::UpdateHeader() {
    if (header_title_label_ != nullptr) {
        lv_label_set_text(header_title_label_, PageTitle());
    }
    if (mode_switch_btn_ != nullptr) {
        SetButtonText(mode_switch_btn_, FamilyModeText());
    }
    if (ai_button_ != nullptr) {
        SetButtonText(ai_button_, AiButtonText());
    }
}

const char* AppShell::AiButtonText() const {
    if (ai_state_ == kDeviceStateListening) {
        return "停止";
    }
    if (ai_state_ == kDeviceStateSpeaking) {
        return "打断";
    }
    if (ai_state_ == kDeviceStateConnecting || ai_state_ == kDeviceStateActivating) {
        return "连接中";
    }
    switch (page_) {
        case Page::kWeather: return "问天气";
        case Page::kAskAi: return "开始对话";
        case Page::kMusicLocal:
        case Page::kMusicServer: return "问音乐";
        case Page::kContent: return "问相册";
        case Page::kEnglishPractice: return "开始口语";
        case Page::kSchedule: return "问日程";
        case Page::kApps:
        case Page::kMiniGame: return "问应用";
        case Page::kPomodoro: return "问应用";
        case Page::kSettings:
        case Page::kSettingsNetwork:
        case Page::kSettingsConnectivity:
        case Page::kSettingsPower:
        case Page::kSettingsStorage:
        case Page::kSettingsSystem:
        case Page::kSettingsDiagnostics: return "问设置";
        case Page::kHome:
        case Page::kScreensaver:
        case Page::kNotifications:
        case Page::kFamilyMode: return "问首页";
    }
    return "问首页";
}

void AppShell::UpdateSubtitle() {
    if (subtitle_label_ == nullptr) {
        return;
    }
    const bool suppress_detail = page_ == Page::kAskAi || page_ == Page::kEnglishPractice;
    std::string footer = ComposeFooterText(AiStateText(), subtitle_, suppress_detail, backend_.online);
    const bool fits = TextFitsLabelWidth(subtitle_label_, footer, kFooterWidth);
    lv_label_set_long_mode(subtitle_label_, fits ? LV_LABEL_LONG_CLIP : LV_LABEL_LONG_SCROLL_CIRCULAR);
    lv_obj_set_width(subtitle_label_, kFooterWidth);
    lv_obj_set_height(subtitle_label_, 18);
    lv_obj_align(subtitle_label_, LV_ALIGN_TOP_MID, 0, kFooterTop);
    lv_label_set_text(subtitle_label_, footer.c_str());
}

void AppShell::SetPage(Page page) {
    if (!initialized_) {
        page_ = page;
        return;
    }

    {
        DisplayLockGuard lock(display_);
        SetPageLocked(page);
    }
    page_context_pending_.store(true);
    StartPageContextTask();
}

void AppShell::SetPageLocked(Page page) {
    // Tear down any open Mode Popup so page changes (remote nav, screensaver
    // entry) never leave an orphan overlay. Already runs under DisplayLockGuard
    // via SetPage, so delete without re-acquiring the lock.
    DeleteModePopupLocked();
    if (page != Page::kContent && page != Page::kScreensaver) {
        ReleaseScreensaverImage();
    }
    page_ = page;
    idle_seconds_ = 0;
    render_pending_ = false;
    EnsureUi();
    Render();
}

void AppShell::RenderOrDefer() {
    if (IsInputPressed()) {
        render_pending_ = true;
        ESP_LOGW(TAG, "Defer render while touch is active: %s", PageTitle());
        return;
    }

    EnsureUi();
    render_pending_ = false;
    Render();
}

const char* AppShell::PageTitle() const {
    switch (page_) {
        case Page::kHome: return "首页";
        case Page::kWeather: return "天气";
        case Page::kAskAi: return "对话";
        case Page::kMusicLocal: return "本地";
        case Page::kMusicServer: return "在线";
        case Page::kScreensaver: return "屏保";
        case Page::kApps: return "应用";
        case Page::kContent: return "相册";
        case Page::kEnglishPractice: return "英语";
        case Page::kSchedule: return "日程";
        case Page::kNotifications: return "通知";
        case Page::kSettings: return "设置";
        case Page::kSettingsNetwork: return "网络";
        case Page::kSettingsConnectivity: return "连接";
        case Page::kSettingsPower: return "电源";
        case Page::kSettingsStorage: return "存储";
        case Page::kSettingsSystem: return "系统";
        case Page::kSettingsDiagnostics: return "诊断";
        case Page::kFamilyMode: return "模式";
        case Page::kMiniGame: return "游戏";
        case Page::kPomodoro: return "番茄钟";
    }
    return "首页";
}

const char* AppShell::AiStateText() const {
    switch (ai_state_) {
        case kDeviceStateConnecting: return "AI 连接中";
        case kDeviceStateListening: return "AI 聆听中";
        case kDeviceStateSpeaking: return "AI 回复中";
        case kDeviceStateWifiConfiguring: return "配网模式";
        case kDeviceStateActivating: return "设备激活中";
        case kDeviceStateAudioTesting: return "音频测试";
        case kDeviceStateFatalError: return "系统异常";
        default: return "AI 待命";
    }
}

const char* AppShell::FamilyModeText() const {
    return family_mode_.c_str();
}

std::string AppShell::CurrentPageKey() const {
    // PageToBackendKey lives in this file's anonymous namespace and is pure;
    // read page_ directly like PageTitle()/FamilyModeText() do (no dedicated
    // mutex guards these members in the existing design).
    return PageToBackendKey(page_);
}

std::string AppShell::CurrentFamilyMode() const {
    return family_mode_;
}

std::string AppShell::CurrentPageStateJson() const {
    cJSON* state = cJSON_CreateObject();
    const std::string page_key = CurrentPageKey();
    if (page_key == "music") {
        const std::string& track_id = backend_.music.Active().current_track_id;
        if (!track_id.empty()) {
            cJSON_AddStringToObject(state, "currentTrackId", track_id.c_str());
        }
    } else if (page_key == "schedule" && !backend_.next_schedule.id.empty()) {
        cJSON_AddStringToObject(state, "currentScheduleId", backend_.next_schedule.id.c_str());
    }
    char* encoded = cJSON_PrintUnformatted(state);
    std::string result = encoded != nullptr ? encoded : "{}";
    cJSON_free(encoded);
    cJSON_Delete(state);
    return result;
}

void AppShell::ClearContent() {
    if (content_ != nullptr) {
        lv_obj_clean(content_);
    }
}

void AppShell::ReleaseScreensaverImage() {
    if (screensaver_image_buffer_ != nullptr) {
        jpeg_free_align(screensaver_image_buffer_);
        screensaver_image_buffer_ = nullptr;
    }
    if (screensaver_image_dsc_ != nullptr) {
        delete static_cast<lv_image_dsc_t*>(screensaver_image_dsc_);
        screensaver_image_dsc_ = nullptr;
    }
    screensaver_image_path_.clear();
    screensaver_image_width_ = 0;
    screensaver_image_height_ = 0;
}

bool AppShell::SetScreensaverImageBuffer(const std::string& path, void* buffer, int data_size, int width, int height) {
    if (buffer == nullptr || data_size <= 0 || width <= 0 || height <= 0) {
        return false;
    }
    ReleaseScreensaverImage();
    auto* dsc = new lv_image_dsc_t;
    std::memset(dsc, 0, sizeof(*dsc));
    dsc->header.magic = LV_IMAGE_HEADER_MAGIC;
    dsc->header.cf = LV_COLOR_FORMAT_RGB565;
    dsc->header.w = width;
    dsc->header.h = height;
    dsc->header.stride = width * 2;
    dsc->data_size = data_size;
    dsc->data = static_cast<const uint8_t*>(buffer);
    screensaver_image_buffer_ = buffer;
    screensaver_image_dsc_ = dsc;
    screensaver_image_path_ = path;
    screensaver_image_width_ = width;
    screensaver_image_height_ = height;
    return true;
}

bool AppShell::LoadScreensaverImage(const std::string& path) {
    if (path.empty() || !IsScreensaverImageFile(path)) {
        return false;
    }
    if (screensaver_image_dsc_ != nullptr && screensaver_image_path_ == path) {
        return true;
    }

    if (IsRawRgb565File(path)) {
        constexpr int data_size = kScreensaverImageWidth * kScreensaverImageHeight * 2;
        auto* output = static_cast<uint8_t*>(jpeg_calloc_align(data_size, 16));
        if (output == nullptr) {
            ReleaseScreensaverImage();
            return false;
        }
        FILE* file = std::fopen(path.c_str(), "rb");
        if (file == nullptr) {
            jpeg_free_align(output);
            ReleaseScreensaverImage();
            return false;
        }
        const size_t read = std::fread(output, 1, data_size, file);
        std::fclose(file);
        if (read != data_size) {
            ESP_LOGW(TAG, "Raw screensaver image has invalid size: %s", path.c_str());
            jpeg_free_align(output);
            ReleaseScreensaverImage();
            return false;
        }
        const bool ok = SetScreensaverImageBuffer(path, output, data_size, kScreensaverImageWidth,
                                                  kScreensaverImageHeight);
        if (ok) {
            ESP_LOGI(TAG, "Loaded raw screensaver image %s", path.c_str());
        } else {
            jpeg_free_align(output);
        }
        return ok;
    }

    FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        ESP_LOGW(TAG, "Open screensaver image failed: %s", path.c_str());
        ReleaseScreensaverImage();
        return false;
    }
    std::fseek(file, 0, SEEK_END);
    const long file_size = std::ftell(file);
    std::fseek(file, 0, SEEK_SET);
    if (file_size <= 0 || static_cast<size_t>(file_size) > kMaxScreensaverJpegBytes) {
        ESP_LOGW(TAG, "Skip screensaver image %s, size=%ld", path.c_str(), file_size);
        std::fclose(file);
        ReleaseScreensaverImage();
        return false;
    }

    std::vector<uint8_t> input(static_cast<size_t>(file_size));
    const size_t read = std::fread(input.data(), 1, input.size(), file);
    std::fclose(file);
    if (read != input.size()) {
        ESP_LOGW(TAG, "Read screensaver image failed: %s", path.c_str());
        ReleaseScreensaverImage();
        return false;
    }

    jpeg_dec_config_t probe_config = DEFAULT_JPEG_DEC_CONFIG();
    jpeg_dec_handle_t probe_dec = nullptr;
    jpeg_dec_io_t probe_io = {};
    jpeg_dec_header_info_t probe_info = {};
    probe_io.inbuf = input.data();
    probe_io.inbuf_len = static_cast<int>(input.size());
    jpeg_error_t ret = jpeg_dec_open(&probe_config, &probe_dec);
    if (ret != JPEG_ERR_OK) {
        ReleaseScreensaverImage();
        return false;
    }
    ret = jpeg_dec_parse_header(probe_dec, &probe_io, &probe_info);
    jpeg_dec_close(probe_dec);
    if (ret != JPEG_ERR_OK || probe_info.width == 0 || probe_info.height == 0) {
        ESP_LOGW(TAG, "Parse screensaver JPEG failed: %s ret=%d", path.c_str(), static_cast<int>(ret));
        ReleaseScreensaverImage();
        return false;
    }

    const int target_w = probe_info.width > kScreensaverImageWidth ?
                         kScreensaverImageWidth : probe_info.width;
    const int target_h = probe_info.height > kScreensaverImageHeight ?
                         kScreensaverImageHeight : probe_info.height;
    const bool use_scale = target_w != probe_info.width || target_h != probe_info.height;
    const int output_w = use_scale ? (target_w / 8) * 8 : target_w;
    const int output_h = use_scale ? (target_h / 8) * 8 : target_h;
    if (output_w <= 0 || output_h <= 0) {
        ReleaseScreensaverImage();
        return false;
    }

    jpeg_dec_config_t config = DEFAULT_JPEG_DEC_CONFIG();
    config.output_type = JPEG_PIXEL_FORMAT_RGB565_LE;
    if (use_scale) {
        config.scale.width = output_w;
        config.scale.height = output_h;
    }

    jpeg_dec_handle_t jpeg_dec = nullptr;
    ret = jpeg_dec_open(&config, &jpeg_dec);
    if (ret != JPEG_ERR_OK) {
        ReleaseScreensaverImage();
        return false;
    }
    jpeg_dec_io_t jpeg_io = {};
    jpeg_dec_header_info_t out_info = {};
    jpeg_io.inbuf = input.data();
    jpeg_io.inbuf_len = static_cast<int>(input.size());
    ret = jpeg_dec_parse_header(jpeg_dec, &jpeg_io, &out_info);
    if (ret != JPEG_ERR_OK) {
        ESP_LOGW(TAG, "Parse screensaver JPEG for decode failed: %s ret=%d", path.c_str(), static_cast<int>(ret));
        jpeg_dec_close(jpeg_dec);
        ReleaseScreensaverImage();
        return false;
    }
    int out_len = 0;
    ret = jpeg_dec_get_outbuf_len(jpeg_dec, &out_len);
    if (ret != JPEG_ERR_OK || out_len <= 0) {
        jpeg_dec_close(jpeg_dec);
        ReleaseScreensaverImage();
        return false;
    }

    auto* output = static_cast<uint8_t*>(jpeg_calloc_align(out_len, 16));
    if (output == nullptr) {
        jpeg_dec_close(jpeg_dec);
        ReleaseScreensaverImage();
        return false;
    }
    jpeg_io.outbuf = output;
    ret = jpeg_dec_process(jpeg_dec, &jpeg_io);
    jpeg_dec_close(jpeg_dec);
    if (ret != JPEG_ERR_OK) {
        ESP_LOGW(TAG, "Decode screensaver JPEG failed: %s ret=%d", path.c_str(), static_cast<int>(ret));
        jpeg_free_align(output);
        ReleaseScreensaverImage();
        return false;
    }

    if (!SetScreensaverImageBuffer(path, output, out_len, output_w, output_h)) {
        jpeg_free_align(output);
        return false;
    }
    ESP_LOGI(TAG, "Loaded screensaver image %s -> %dx%d", path.c_str(), output_w, output_h);
    return true;
}

void AppShell::RefreshSubtitleOnly() {
    if (!initialized_) {
        return;
    }

    if (IsInputPressed()) {
        render_pending_ = true;
        return;
    }

    DisplayLockGuard lock(display_);
    if (IsInputPressed()) {
        render_pending_ = true;
        return;
    }
    EnsureUi();
    UpdateSubtitle();
}

void AppShell::QueueBackendAction(const std::string& action, const std::string& params_json) {
    const std::string normalized_params = params_json.empty() ? "{}" : params_json;
    if (IsVolumeAction(action) && backend_action_pending_ && IsVolumeAction(pending_backend_action_)) {
        const int pending_delta = ExtractVolumeDelta(pending_backend_params_);
        const int next_delta = ExtractVolumeDelta(normalized_params);
        const int merged_delta = ClampInt(pending_delta + next_delta, -40, 40);
        if (merged_delta == 0) {
            backend_action_pending_ = false;
            pending_backend_action_.clear();
            pending_backend_params_.clear();
            subtitle_ = "已抵消: 音量";
            return;
        }
        pending_backend_params_ = BuildVolumeParams(merged_delta);
        subtitle_ = "已合并: 音量 " + std::to_string(merged_delta);
        return;
    }

    backend_action_pending_ = true;
    pending_backend_action_ = action;
    pending_backend_params_ = normalized_params;
    subtitle_ = "已排队: " + ActionDisplayName(action);
}

bool AppShell::DispatchQueuedBackendAction() {
    if (!backend_action_pending_ || backend_action_busy_.load() || backend_refreshing_.load() ||
        backend_events_running_.load()) {
        return false;
    }
    if (!CanRunBackendNetworkTasks()) {
        return false;
    }
    if (tick_count_ - last_backend_action_tick_ < 1) {
        return false;
    }

    const std::string action = pending_backend_action_;
    const std::string params = pending_backend_params_;
    backend_action_pending_ = false;
    pending_backend_action_.clear();
    pending_backend_params_.clear();

    if (!StartBackendActionTask(action, params)) {
        QueueBackendAction(action, params);
        subtitle_ = CanRunBackendNetworkTasks() ? "动作任务启动失败" :
                                                  ("已延后: " + ActionDisplayName(action));
        RefreshSubtitleOnly();
        return false;
    }

    subtitle_ = "已发送: " + ActionDisplayName(action);
    last_backend_action_status_ = "发送 " + ActionDisplayName(action);
    RefreshSubtitleOnly();
    return true;
}

void AppShell::ExecuteBackendCommand(const AppBackendEventState& event_state) {
    if (event_state.command_id.empty()) {
        return;
    }
    if (event_state.command_id == last_backend_command_id_) {
        return;
    }
    last_backend_command_id_ = event_state.command_id;
    last_backend_event_status_ = "命令 " + event_state.command_type;

    cJSON* payload = event_state.command_payload_json.empty() ? nullptr :
                     cJSON_Parse(event_state.command_payload_json.c_str());
    cJSON* track = payload != nullptr ? cJSON_GetObjectItem(payload, "track") : nullptr;
    if (!cJSON_IsObject(track)) {
        track = payload;
    }

    if (event_state.command_type == "media.server.play") {
        if (!cJSON_IsObject(track)) {
            subtitle_ = "后台命令缺少曲目";
            RefreshSubtitleOnly();
            cJSON_Delete(payload);
            return;
        }
        const std::string stream_url = JsonString(track, "streamUrl", JsonString(track, "stream_url"));
        if (stream_url.empty()) {
            subtitle_ = "后台命令缺少播放地址";
            RefreshSubtitleOnly();
            cJSON_Delete(payload);
            return;
        }

        backend_.music.active_source = "server";
        backend_.music.server.available = true;
        backend_.music.server.playing = true;
        backend_.music.server.current_track_id = JsonString(track, "id", backend_.music.server.current_track_id);
        backend_.music.server.title = JsonString(track, "title", backend_.music.server.title);
        backend_.music.server.artist = JsonString(track, "artist", backend_.music.server.artist);
        backend_.music.server.source = JsonString(track, "source", "服务器播客");
        backend_.music.server.stream_url = stream_url;
        backend_.music.server.download_url = JsonString(track, "downloadUrl",
                                                        JsonString(track, "download_url", stream_url));
        backend_.music.server.format = JsonString(track, "format", backend_.music.server.format);
        backend_.music.server.content_type = JsonString(track, "contentType",
                                                        JsonString(track, "content_type", backend_.music.server.content_type));
        backend_.music.server.sha256 = JsonString(track, "sha256", backend_.music.server.sha256);
        backend_.music.server.cache_path = JsonString(track, "cachePath",
                                                      JsonString(track, "cache_path", backend_.music.server.cache_path));
        backend_.music.server.size = JsonInt(track, "size", backend_.music.server.size);
        backend_.music.server.duration_sec = JsonInt(track, "durationSec",
                                                     JsonInt(track, "duration_sec", backend_.music.server.duration_sec));
        backend_.music.server.cacheable = JsonBool(track, "cacheable", backend_.music.server.cacheable);
        backend_.music.server.supports_range = JsonBool(track, "supportsRange",
                                                        JsonBool(track, "supports_range",
                                                                 backend_.music.server.supports_range));

        AppLocalMusicPlayer::GetInstance().Stop();
        const bool ok = AppServerMusicPlayer::GetInstance().Play(
            backend_.music.server.stream_url,
            backend_.music.server.title,
            !backend_.music.server.content_type.empty() ? backend_.music.server.content_type : backend_.music.server.format,
            backend_.music.server.download_url,
            backend_.music.server.sha256,
            backend_.music.server.cache_path,
            backend_.music.server.size,
            backend_.music.server.current_track_id,
            backend_.music.server.duration_sec,
            backend_.music.server.artist,
            backend_.music.server.source);
        subtitle_ = ok ? ("播放 " + backend_.music.server.title) : AppServerMusicPlayer::GetInstance().StatusLine();
        WakeDisplayForEvent("后台播放");
        ShowMusicServer();
    } else if (event_state.command_type == "media.server.next") {
        backend_.music.active_source = "server";
        AppLocalMusicPlayer::GetInstance().Stop();
        AppServerMusicPlayer::GetInstance().Next();
        subtitle_ = AppServerMusicPlayer::GetInstance().StatusLine();
        WakeDisplayForEvent("后台切歌");
        ShowMusicServer();
    } else if (event_state.command_type == "media.server.stop") {
        backend_.music.server.playing = false;
        AppServerMusicPlayer::GetInstance().Stop();
        subtitle_ = "服务器播客已停止";
        WakeDisplayForEvent("后台停止");
        ShowMusicServer();
    } else if (event_state.command_type == "media.server.cache") {
        AppServerMusicPlayer::GetInstance().CacheCurrent(
            backend_.music.server.stream_url,
            backend_.music.server.title,
            !backend_.music.server.content_type.empty() ? backend_.music.server.content_type : backend_.music.server.format,
            backend_.music.server.download_url,
            backend_.music.server.sha256,
            backend_.music.server.cache_path,
            backend_.music.server.size,
            backend_.music.server.current_track_id);
        subtitle_ = AppServerMusicPlayer::GetInstance().StatusLine();
        WakeDisplayForEvent("后台缓存");
        RefreshSubtitleOnly();
    } else if (event_state.command_type == "ui.toast") {
        subtitle_ = cJSON_IsObject(payload) ? JsonString(payload, "message", "收到后台消息") : "收到后台消息";
        WakeDisplayForEvent("后台消息");
        RefreshSubtitleOnly();
    } else {
        subtitle_ = "未知后台命令";
        RefreshSubtitleOnly();
    }

    cJSON_Delete(payload);
}

bool AppShell::StartBackendActionTask(const std::string& action, const std::string& params_json) {
    if (!CanRunBackendNetworkTasks()) {
        return false;
    }
    auto* context = new BackendActionContext{action, params_json.empty() ? "{}" : params_json};
    backend_action_busy_.store(true);
    last_backend_action_tick_ = tick_count_;
    auto result = xTaskCreateWithCaps(BackendActionTask, "app_action", 8192, context, 2, nullptr,
                                      MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (result != pdPASS) {
        delete context;
        backend_action_busy_.store(false);
        ESP_LOGE(TAG, "Failed to create backend action task");
        return false;
    }
    return true;
}

void AppShell::StartPageContextTask() {
    page_context_pending_.store(true);
    if (!CanRunBackendNetworkTasks() || page_context_running_.exchange(true)) {
        return;
    }
    page_context_pending_.store(false);
    if (xTaskCreateWithCaps(PageContextTask, "app_context", 4096, nullptr, 2, nullptr,
                            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) {
        page_context_running_.store(false);
        page_context_pending_.store(true);
        ESP_LOGW(TAG, "Failed to create page context task");
    }
}

void AppShell::StartBackendRefresh(bool force) {
    if (!initialized_) {
        return;
    }
    if (!CanRunBackendNetworkTasks()) {
        return;
    }
    if (!HasInternalSramReserve(kSramSoftReserveBytes)) {
        last_backend_refresh_status_ = "SRAM 保护: 暂停刷新";
        return;
    }
    if (!force && tick_count_ < kBackendStartupDelaySec) {
        return;
    }
    if (!force && tick_count_ - last_backend_refresh_tick_ < kBackendRefreshIntervalSec) {
        return;
    }
    if (!force && backend_action_pending_) {
        return;
    }
    if (backend_action_busy_.load() || backend_events_running_.load()) {
        return;
    }
    if (backend_refreshing_.exchange(true)) {
        return;
    }
    last_backend_refresh_tick_ = tick_count_;
    auto* context = new BackendRefreshContext{force, tick_count_};
    if (xTaskCreateWithCaps(BackendRefreshTask, "app_backend", 12288, context, 2, nullptr,
                            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) {
        delete context;
        backend_refreshing_.store(false);
        ESP_LOGE(TAG, "Failed to create backend refresh task");
    }
}

void AppShell::StartBackendEventTask() {
    if (!initialized_) {
        return;
    }
    if (!CanRunBackendNetworkTasks()) {
        return;
    }
    if (!HasInternalSramReserve(kSramSoftReserveBytes)) {
        last_backend_event_status_ = "SRAM 保护: 暂停探针";
        return;
    }
    if (backend_refreshing_.load() || backend_action_busy_.load()) {
        return;
    }
    if (backend_events_running_.exchange(true)) {
        return;
    }
    if (xTaskCreateWithCaps(BackendEventTask, "app_events", 4096, nullptr, 1, nullptr,
                            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) {
        backend_events_running_.store(false);
        ESP_LOGE(TAG, "Failed to create backend event task");
    }
}

void AppShell::BackendRefreshTask(void* arg) {
    auto* context = static_cast<BackendRefreshContext*>(arg);
    const bool force = context != nullptr && context->force;
    const int requested_tick = context != nullptr ? context->requested_tick : 0;
    delete context;

    auto& shell = AppShell::GetInstance();
    if (!shell.CanRunBackendNetworkTasks()) {
        Application::GetInstance().Schedule([requested_tick]() {
            auto& shell = AppShell::GetInstance();
            shell.backend_refreshing_.store(false);
            shell.last_backend_refresh_tick_ = requested_tick - kBackendRefreshIntervalSec;
        });
        vTaskDeleteWithCaps(nullptr);
        return;
    }
    AppBackendSnapshot snapshot;
    AppBackendClient::GetInstance().FetchSummary(snapshot);
    std::string refresh_status = snapshot.online ? "刷新成功" : ("刷新失败 " + snapshot.last_error);
    std::string resource_status;
    std::string heartbeat_status;
    bool remote_checked = false;
    bool heartbeat_posted = false;
    int remote_tick = -1;
    int resource_tick = -1;
    int heartbeat_tick = -1;
    if (snapshot.online) {
        const bool media_or_ai_active = AppLocalMusicPlayer::GetInstance().playing() ||
                                        AppServerMusicPlayer::GetInstance().playing() || shell.IsAiActive();
        const bool image_page = shell.page_ == Page::kContent || shell.page_ == Page::kScreensaver;
        const bool remote_due = requested_tick - shell.last_remote_page_tick_ >= kRemotePageRefreshIntervalSec;
        if (remote_due && !media_or_ai_active) {
            AppRemotePageRenderer::GetInstance().FetchAndValidate("apps");
            AppRemotePageRenderer::GetInstance().FetchAndValidate("english");
            AppRemotePageRenderer::GetInstance().FetchAndValidate("album");
            remote_checked = true;
            remote_tick = requested_tick;
        }

        const bool resource_due =
            requested_tick - shell.last_resource_manifest_tick_ >= kResourceManifestRefreshIntervalSec;
        if (resource_due && !media_or_ai_active && !image_page) {
            AppResourceManager::GetInstance().UpdateFromBackendManifest();
            resource_status = AppResourceManager::GetInstance().status().last_error;
            resource_tick = requested_tick;
        } else if (resource_due) {
            resource_status = "资源延后: 忙";
        }
        const bool heartbeat_due =
            requested_tick - shell.last_device_heartbeat_tick_ >= kDeviceHeartbeatIntervalSec;
        if (heartbeat_due && !media_or_ai_active) {
            const std::string heartbeat_data = shell.BuildDeviceHeartbeatData();
            heartbeat_posted = AppBackendClient::GetInstance().PostDeviceLog(
                "info", "appshell.heartbeat", "device heartbeat", heartbeat_data);
            heartbeat_status = heartbeat_posted ? "心跳已上报" : "心跳失败";
            if (heartbeat_posted) {
                heartbeat_tick = requested_tick;
            }
        } else if (heartbeat_due) {
            heartbeat_status = "心跳延后: 忙";
        }
        AppSyncQueue::GetInstance().FlushPending();
    } else {
        AppSyncQueue::GetInstance().AddEvent("backend.refresh.failed", MakeErrorPayload(snapshot.last_error));
    }
    Application::GetInstance().Schedule([snapshot, refresh_status, resource_status, heartbeat_status,
                                         remote_checked, heartbeat_posted, remote_tick, resource_tick,
                                         heartbeat_tick, requested_tick, force]() {
        auto& shell = AppShell::GetInstance();
        shell.backend_refreshing_.store(false);
        shell.last_backend_refresh_result_tick_ = requested_tick;
        shell.last_backend_refresh_status_ = refresh_status;
        if (!resource_status.empty()) {
            shell.last_resource_update_status_ = resource_status;
        }
        if (!heartbeat_status.empty()) {
            shell.last_backend_action_status_ = heartbeat_status;
        }
        if (remote_checked && remote_tick >= 0) {
            shell.last_remote_page_tick_ = remote_tick;
        }
        if (resource_tick >= 0) {
            shell.last_resource_manifest_tick_ = resource_tick;
        }
        if (heartbeat_posted && heartbeat_tick >= 0) {
            shell.last_device_heartbeat_tick_ = heartbeat_tick;
        }
        if (force && !snapshot.online) {
            shell.last_backend_event_status_ = "后端离线";
        }
        shell.OnBackendSnapshot(snapshot);
        shell.DispatchQueuedBackendAction();
    });
    vTaskDeleteWithCaps(nullptr);
}

void AppShell::BackendEventTask(void*) {
    auto& shell = AppShell::GetInstance();
    if (shell.initialized_ && shell.CanRunBackendNetworkTasks()) {
        AppBackendEventState event_state;
        std::string error;
        const bool ok = AppBackendClient::GetInstance().FetchEventState(event_state, error);
        if (ok) {
            const bool should_ack_command = !event_state.command_id.empty() &&
                                            event_state.command_id != shell.last_backend_command_id_;
            Application::GetInstance().Schedule([event_state]() {
                auto& shell = AppShell::GetInstance();
                if (!shell.initialized_) {
                    return;
                }
                shell.backend_event_failures_ = 0;
                shell.last_backend_event_tick_ = shell.tick_count_;
                shell.last_backend_event_status_ =
                    event_state.event_type.empty() ? "探针在线" : ("探针 " + event_state.event_type);
                const bool probe_ready = shell.backend_event_probe_ready_;
                const bool has_new_event = probe_ready && !event_state.event_id.empty() &&
                                           event_state.event_id != shell.last_backend_event_id_;
                const bool has_new_notification = probe_ready && !event_state.notification_key.empty() &&
                                                  event_state.notification_key != shell.last_wake_notification_key_;
                const bool has_new_command = !event_state.command_id.empty() &&
                                             event_state.command_id != shell.last_backend_command_id_;
                if (!event_state.event_id.empty()) {
                    shell.last_backend_event_id_ = event_state.event_id;
                }
                if (!event_state.notification_key.empty()) {
                    shell.last_wake_notification_key_ = event_state.notification_key;
                }
                shell.backend_event_probe_ready_ = true;
                if (!has_new_event && !has_new_notification && !has_new_command) {
                    return;
                }
                ESP_LOGI(TAG, "Backend event probe: %s", event_state.event_type.c_str());
                if (has_new_command) {
                    shell.ExecuteBackendCommand(event_state);
                }
                if (has_new_notification) {
                    shell.subtitle_ = "收到新消息";
                    shell.WakeDisplayForEvent("后端通知");
                    shell.RefreshSubtitleOnly();
                }
                shell.StartBackendRefresh(true);
            });
            if (should_ack_command) {
                AppBackendClient::GetInstance().AckDeviceCommand(event_state.command_id, "accepted",
                                                                 "received by esp32");
            }
        } else {
            if (error != "timeout" && error != "network not ready") {
                ESP_LOGW(TAG, "Backend event probe failed: %s", error.c_str());
            }
            Application::GetInstance().Schedule([error]() {
                auto& shell = AppShell::GetInstance();
                if (!shell.initialized_) {
                    return;
                }
                shell.backend_event_failures_++;
                shell.last_backend_event_tick_ = shell.tick_count_;
                shell.last_backend_event_status_ =
                    error == "network not ready" ? "探针无网络" : ("探针失败 " + error);
            });
        }
    }
    shell.backend_events_running_.store(false);
    vTaskDeleteWithCaps(nullptr);
}

void AppShell::BackendActionTask(void* arg) {
    auto* context = static_cast<BackendActionContext*>(arg);
    const std::string action = context->action;
    const std::string params = context->params;
    delete context;

    auto& shell = AppShell::GetInstance();
    if (!shell.CanRunBackendNetworkTasks()) {
        Application::GetInstance().Schedule([action, params]() {
            auto& shell = AppShell::GetInstance();
            shell.backend_action_busy_.store(false);
            shell.QueueBackendAction(action, params);
            shell.last_backend_action_status_ = "AI 会话后发送 " + ActionDisplayName(action);
            shell.RefreshSubtitleOnly();
        });
        vTaskDeleteWithCaps(nullptr);
        return;
    }

    AppBackendSnapshot snapshot;
    const bool ok = AppBackendClient::GetInstance().PostAction(action, params, &snapshot);
    if (!ok) {
        AppSyncQueue::GetInstance().AddActionEvent(action, params);
    }
    Application::GetInstance().Schedule([snapshot, ok, action]() {
        auto& shell = AppShell::GetInstance();
        shell.backend_action_busy_.store(false);
        if (action == "weather.refresh") {
            shell.weather_refreshing_.store(false);
            const bool refresh_failed = !ok || !snapshot.weather.last_refresh_error.empty();
            shell.subtitle_ = refresh_failed ? "更新失败 · 使用缓存" : "天气已更新";
            shell.last_backend_action_status_ = shell.subtitle_;
        } else {
            shell.subtitle_ = ok ? ("完成: " + ActionDisplayName(action)) :
                                  ("后端离线: " + ActionDisplayName(action));
            shell.last_backend_action_status_ = ok ? ("完成 " + ActionDisplayName(action)) :
                                                ("离线 " + ActionDisplayName(action));
        }
        shell.WakeDisplayForEvent("动作反馈");
        if (!IsVolumeAction(action)) {
            shell.OnBackendSnapshot(snapshot);
        } else {
            shell.RenderOrDefer();
        }
        shell.DispatchQueuedBackendAction();
    });
    vTaskDeleteWithCaps(nullptr);
}

void AppShell::PageContextTask(void*) {
    auto& shell = AppShell::GetInstance();
    const std::string page = shell.CurrentPageKey();
    const std::string family_mode = shell.CurrentFamilyMode();
    const std::string page_state = shell.CurrentPageStateJson();
    const bool ok = shell.CanRunBackendNetworkTasks() &&
                    AppBackendClient::GetInstance().PostDeviceContext(page, family_mode, page_state);
    Application::GetInstance().Schedule([page, ok]() {
        auto& shell = AppShell::GetInstance();
        shell.page_context_running_.store(false);
        if (ok) {
            shell.last_page_context_tick_ = shell.tick_count_;
        }
        const bool page_changed = shell.CurrentPageKey() != page;
        if (!ok || page_changed) {
            shell.page_context_pending_.store(true);
        }
        // A changed page should be coalesced immediately. Network failures are
        // retried by the one-second Tick loop so boot/offline states cannot
        // create a tight task-retry loop.
        if (ok && page_changed && shell.CanRunBackendNetworkTasks()) {
            shell.StartPageContextTask();
        }
    });
    vTaskDeleteWithCaps(nullptr);
}

bool AppShell::IsAiActive() const {
    return ai_state_ == kDeviceStateConnecting || ai_state_ == kDeviceStateListening ||
           ai_state_ == kDeviceStateSpeaking;
}

bool AppShell::CanRunBackendNetworkTasks() const {
    return initialized_ && AppConnectivityManager::GetInstance().status().online &&
           !IsAiActive() && tick_count_ >= backend_network_resume_tick_ &&
           HasInternalSramReserve(kSramCriticalReserveBytes);
}

bool AppShell::HasInternalSramReserve(size_t minimum_bytes) const {
    constexpr uint32_t kInternalCaps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
    return heap_caps_get_free_size(kInternalCaps) >= minimum_bytes;
}

std::string AppShell::DeviceIp() const {
    std::string ip = "--";
    auto root = cJSON_Parse(Board::GetInstance().GetBoardJson().c_str());
    if (root != nullptr) {
        ip = JsonString(root, "ip", ip);
        cJSON_Delete(root);
    }
    return ip;
}

std::string AppShell::DeviceStatusLine() const {
    std::string line = DeviceIp();
    auto root = cJSON_Parse(Board::GetInstance().GetDeviceStatusJson().c_str());
    if (root != nullptr) {
        auto screen = cJSON_GetObjectItem(root, "screen");
        auto brightness = cJSON_GetObjectItem(screen, "brightness");
        if (cJSON_IsNumber(brightness)) {
            line += " 亮度 ";
            line += std::to_string(brightness->valueint);
        }
        cJSON_Delete(root);
    }
    return line;
}

std::string AppShell::BuildDeviceHeartbeatData() const {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", Board::GetInstance().GetUuid().c_str());
    cJSON_AddStringToObject(root, "logicalDeviceId", "esp32-185b");
    cJSON_AddStringToObject(root, "profile", "waveshare-esp32-s3-touch-lcd-1.85b");
    cJSON_AddStringToObject(root, "page", PageTitle());
    cJSON_AddStringToObject(root, "aiState", AiStateText());
    cJSON_AddStringToObject(root, "familyMode", family_mode_.c_str());
    cJSON_AddStringToObject(root, "backend", backend_.online ? "online" : "offline");
    cJSON_AddStringToObject(root, "backendUrl", AppBackendClient::GetInstance().backend_url().c_str());
    cJSON_AddStringToObject(root, "wakeReason", last_wake_reason_.c_str());
    cJSON_AddStringToObject(root, "resetReason", last_reset_reason_.c_str());
    cJSON_AddNumberToObject(root, "resetCode", last_reset_code_);
    cJSON_AddNumberToObject(root, "bootCount", boot_count_);
    cJSON_AddStringToObject(root, "bootId", boot_id_.c_str());
    cJSON_AddNumberToObject(root, "bootSequence", boot_count_);
    cJSON_AddNumberToObject(root, "uptimeSec", esp_timer_get_time() / 1000000);
    cJSON_AddStringToObject(root, "firmwareBuild", firmware_build_.c_str());
    if (!panic_summary_.empty()) {
        cJSON_AddStringToObject(root, "panicSummary", panic_summary_.c_str());
    }
    cJSON_AddNumberToObject(root, "tick", tick_count_);
    cJSON_AddNumberToObject(root, "freeHeap", SystemInfo::GetFreeHeapSize());
    cJSON_AddNumberToObject(root, "minimumFreeHeap", SystemInfo::GetMinimumFreeHeapSize());
    constexpr uint32_t kInternalCaps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
    cJSON_AddNumberToObject(root, "freeInternalSram", heap_caps_get_free_size(kInternalCaps));
    cJSON_AddNumberToObject(root, "minimumFreeInternalSram", heap_caps_get_minimum_free_size(kInternalCaps));
    cJSON_AddStringToObject(root, "backendRefresh", last_backend_refresh_status_.c_str());
    cJSON_AddStringToObject(root, "backendProbe", last_backend_event_status_.c_str());
    cJSON_AddStringToObject(root, "backendAction", last_backend_action_status_.c_str());
    cJSON_AddStringToObject(root, "resourceUpdate", last_resource_update_status_.c_str());

    cJSON* board = cJSON_Parse(Board::GetInstance().GetBoardJson().c_str());
    if (cJSON_IsObject(board)) {
        cJSON_AddItemToObject(root, "board", board);
    } else if (board != nullptr) {
        cJSON_Delete(board);
    }

    cJSON* status = cJSON_Parse(Board::GetInstance().GetDeviceStatusJson().c_str());
    if (cJSON_IsObject(status)) {
        cJSON_AddItemToObject(root, "status", status);
    } else if (status != nullptr) {
        cJSON_Delete(status);
    }

    char* printed = cJSON_PrintUnformatted(root);
    const std::string result = printed != nullptr ? printed : "{}";
    if (printed != nullptr) {
        cJSON_free(printed);
    }
    cJSON_Delete(root);
    return result;
}

std::string AppShell::BuildWifiProvisionedData(const std::string& method) const {
    cJSON* root = cJSON_Parse(BuildDeviceHeartbeatData().c_str());
    if (!cJSON_IsObject(root)) {
        if (root != nullptr) {
            cJSON_Delete(root);
        }
        root = cJSON_CreateObject();
    }
    cJSON_AddStringToObject(root, "eventType", "wifi_provisioned");
    cJSON_AddStringToObject(root, "method", method.empty() ? "unknown" : method.c_str());
    cJSON_AddNumberToObject(root, "provisionedTick", tick_count_);
    char* printed = cJSON_PrintUnformatted(root);
    const std::string result = printed != nullptr ? printed : "{}";
    if (printed != nullptr) {
        cJSON_free(printed);
    }
    cJSON_Delete(root);
    return result;
}

void AppShell::ReportWifiProvisioned(const std::string& method) {
    if (!initialized_) {
        return;
    }
    auto* context = new std::string(method.empty() ? "unknown" : method);
    if (xTaskCreateWithCaps(WifiProvisionedReportTask, "wifi_prov_log", 6144, context, 2, nullptr,
                            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) {
        delete context;
        ESP_LOGE(TAG, "Failed to create wifi provisioned report task");
    }
}

void AppShell::WifiProvisionedReportTask(void* arg) {
    auto* method = static_cast<std::string*>(arg);
    std::string method_value = method != nullptr ? *method : "unknown";
    delete method;
    auto& shell = AppShell::GetInstance();
    const std::string data = shell.BuildWifiProvisionedData(method_value);
    const bool ok = AppBackendClient::GetInstance().PostDeviceLog(
        "info", "appshell.wifi_provisioned", "wifi provisioned", data);
    Application::GetInstance().Schedule([ok]() {
        auto& shell = AppShell::GetInstance();
        shell.last_backend_action_status_ = ok ? "配网证据已上报" : "配网证据上报失败";
        shell.last_wake_reason_ = "Wi-Fi 配网";
        shell.WakeDisplayForEvent("Wi-Fi 配网");
        shell.RenderOrDefer();
    });
    vTaskDeleteWithCaps(nullptr);
}

std::string AppShell::ResetStatusLine() const {
    std::string line = last_reset_reason_.empty() ? "未知" : last_reset_reason_;
    if (boot_count_ > 0) {
        line += " #";
        line += std::to_string(boot_count_);
    }
    return line;
}
