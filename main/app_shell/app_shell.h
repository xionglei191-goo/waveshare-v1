#ifndef APP_SHELL_H_
#define APP_SHELL_H_

#include "app_backend_client.h"
#include "device_state.h"

#include <atomic>
#include <cstdint>
#include <string>

class Display;
struct _lv_obj_t;
typedef struct _lv_obj_t lv_obj_t;

class AppShell {
public:
    enum class Page {
        kHome,
        kWeather,
        kAskAi,
        kMusicLocal,
        kMusicServer,
        kScreensaver,
        kApps,
        kContent,
        kEnglishPractice,
        kSchedule,
        kNotifications,
        kSettings,
        kSettingsNetwork,
        kSettingsConnectivity,
        kSettingsWifi,
        kSettingsPower,
        kSettingsStorage,
        kSettingsSystem,
        kSettingsDiagnostics,
        kFamilyMode,
        kMiniGame,
        kPomodoro,
    };

    enum class PomodoroPhase {
        kFocus,
        kBreak,
    };

    // 屏幕电源梯度:全亮 -> 降暗 -> 熄屏。由 AppShell 统一掌管背光,
    // 板级 PowerSaveTimer 不再直接控制亮度,避免两处抢背光。
    enum class ScreenPower {
        kActive,
        kDim,
        kOff,
    };

    static AppShell& GetInstance();

    void Initialize(Display* display);
    bool IsInitialized() const { return initialized_; }

    void ShowHome();
    void ShowWeather();
    void RefreshWeather();
    void ShowAskAi();
    void ShowMusicLocal();
    void ShowMusicServer();
    void ShowScreensaver();
    void ShowApps();
    void ShowContent();
    void ShowEnglishPractice();
    void ShowSchedule();
    void ShowNotifications();
    void ShowSettings();
    void ShowSettingsNetwork();
    void ShowSettingsConnectivity();
    void ShowSettingsWifi();
    void ShowSettingsPower();
    void ShowSettingsStorage();
    void ShowSettingsSystem();
    void ShowSettingsDiagnostics();
    void ShowFamilyMode();
    void ShowMiniGame();
    void ShowPomodoro();
    void ShowNextApp();

    void RefreshBackend();
    void ToggleAiListening();
    void RunBackendAction(const std::string& action, const std::string& params_json = "{}");
    void CompleteNextSchedule();
    void SnoozeNextSchedule();
    void CycleFamilyMode();
    void SetFamilyMode(const std::string& mode);
    void OpenModePopup();
    void SelectModeByIndex(int index);
    void CloseModePopup();
    void TapMiniGame();
    void ResetMiniGame();
    void TogglePomodoro();
    void ResetPomodoro();

    // Wi-Fi credential management. The device stores up to 10 SSID/password
    // pairs in NVS (SsidManager) and auto-connects the strongest saved network
    // on scan. These actions let the round screen switch the preferred network,
    // forget a saved one, and jump to phone BluFi provisioning for a new one.
    void SelectWifiByIndex(int index);
    void SwitchToSelectedWifi();
    void ForgetWifiByIndex(int index);
    void EnterWifiProvisioning();

    void Tick();
    // 熄屏吞噬层被点按时调用:仅唤醒亮屏,不触发下方按钮。
    void WakeFromScreenOff();
    void OnAiStateChanged(DeviceState state);
    void OnUserTranscript(const std::string& text);
    void OnAssistantTranscript(const std::string& text);
    void OnSystemMessage(const std::string& text);
    void OnBackendSnapshot(const AppBackendSnapshot& snapshot);
    void ReportWifiProvisioned(const std::string& method);

    // Read-only accessors exposing the current one-level page key and family
    // mode for routing the self-hosted voice provider's family.agent.ask tool.
    // CurrentPageKey() returns the normalized backend Page_Key for page_;
    // CurrentFamilyMode() returns family_mode_. Both read existing members
    // directly, matching the lock-free convention of PageTitle()/FamilyModeText().
    std::string CurrentPageKey() const;
    std::string CurrentFamilyMode() const;
    std::string CurrentPageStateJson() const;

private:
    AppShell() = default;

    void EnsureUi();
    void Render();
    void RenderHome();
    void RenderWeather();
    void RenderAskAi();
    void RenderMusicLocal();
    void RenderMusicServer();
    void RenderScreensaver();
    void RenderApps();
    void RenderContent();
    void RenderEnglishPractice();
    void RenderSchedule();
    void RenderNotifications();
    void RenderSettings();
    void RenderSettingsNetwork();
    void RenderSettingsConnectivity();
    void RenderSettingsWifi();
    void RenderSettingsPower();
    void RenderSettingsStorage();
    void RenderSettingsSystem();
    void RenderSettingsDiagnostics();
    void RenderFamilyMode();
    void RenderMiniGame();
    void RenderPomodoro();
    void DeleteModePopupLocked();

    void UpdateClock();
    void UpdateHeader();
    void UpdateSubtitle();
    const char* AiButtonText() const;
    void SetPage(Page page);
    void SetPageLocked(Page page);
    void RenderOrDefer();
    const char* PageTitle() const;
    const char* AiStateText() const;
    const char* FamilyModeText() const;
    void ClearContent();
    void RefreshSubtitleOnly();
    bool LoadScreensaverImage(const std::string& path);
    bool SetScreensaverImageBuffer(const std::string& path, void* buffer, int data_size, int width, int height);
    void ReleaseScreensaverImage();
    void WakeDisplayForEvent(const std::string& reason = "事件");
    // 根据空闲秒数推进屏幕电源梯度(降暗/熄屏),幂等,只在档位变化时写背光。
    void UpdateScreenPower();
    void ApplyScreenPower(ScreenPower level);
    bool ApplyLocalVolumeDelta(int delta);
    void QueueLocalVolumeDelta(int delta);
    bool ApplyQueuedLocalVolumeDelta();
    void QueueBackendAction(const std::string& action, const std::string& params_json);
    bool DispatchQueuedBackendAction();
    void ExecuteBackendCommand(const AppBackendEventState& event_state);
    bool StartBackendActionTask(const std::string& action, const std::string& params_json);
    void StartPageContextTask();
    void StartBackendRefresh(bool force);
    void StartBackendEventTask();
    std::string BuildDeviceHeartbeatData() const;
    std::string BuildWifiProvisionedData(const std::string& method) const;
    static void BackendRefreshTask(void* arg);
    static void WifiProvisionedReportTask(void* arg);
    static void BackendActionTask(void* arg);
    static void BackendEventTask(void* arg);
    static void PageContextTask(void* arg);
    bool IsAiActive() const;
    bool CanRunBackendNetworkTasks() const;
    bool CanRunBackgroundNetworkTasks() const;
    bool HasInternalSramReserve(size_t minimum_bytes) const;
    std::string DeviceIp() const;
    std::string DeviceStatusLine() const;
    std::string ResetStatusLine() const;

    Display* display_ = nullptr;
    bool initialized_ = false;
    Page page_ = Page::kHome;
    bool render_pending_ = false;
    DeviceState ai_state_ = kDeviceStateUnknown;
    std::string subtitle_ = "AI 待命";
    std::string last_user_transcript_;
    std::string last_assistant_transcript_;
    std::string family_mode_ = "默认";
    int wifi_selected_index_ = 0;
    // Transient one-line feedback shown on the Wi-Fi page after an action
    // (switch/forget/provision). Cleared each time the page is opened.
    std::string wifi_action_hint_;
    int mini_game_score_ = 0;
    int mini_game_level_ = 1;
    PomodoroPhase pomodoro_phase_ = PomodoroPhase::kFocus;
    int pomodoro_remaining_sec_ = 25 * 60;
    int pomodoro_completed_ = 0;
    bool pomodoro_running_ = false;
    int tick_count_ = 0;
    int ai_anim_frame_ = 0;
    int last_backend_refresh_tick_ = -1000;
    int last_backend_refresh_result_tick_ = -1000;
    int last_backend_action_tick_ = -1000;
    int last_backend_event_tick_ = -1000;
    int backend_network_resume_tick_ = 0;
    bool server_media_was_playing_ = false;
    int last_remote_page_tick_ = 0;
    int last_resource_manifest_tick_ = 0;
    int last_device_heartbeat_tick_ = -1000;
    int last_page_context_tick_ = -1000;
    int idle_seconds_ = 0;
    int last_reset_code_ = 0;
    int boot_count_ = 0;
    int backend_event_failures_ = 0;
    int pending_volume_delta_ = 0;
    bool backend_action_pending_ = false;
    bool backend_event_probe_ready_ = false;
    std::string pending_backend_action_;
    std::string pending_backend_params_;
    std::string last_reset_reason_ = "未知";
    std::string boot_id_;
    std::string firmware_build_;
    std::string panic_summary_;
    std::string last_backend_refresh_status_ = "后端未刷新";
    std::string last_backend_event_status_ = "探针待启动";
    std::string last_backend_action_status_ = "暂无动作";
    std::string last_resource_update_status_ = "资源未检查";
    std::string last_wake_reason_ = "启动";
    std::string last_wake_notification_key_;
    std::string last_backend_event_id_;
    std::string last_backend_command_id_;

    AppBackendSnapshot backend_;
    std::atomic<bool> backend_refreshing_{false};
    std::atomic<bool> backend_action_busy_{false};
    std::atomic<bool> backend_events_running_{false};
    std::atomic<bool> weather_refreshing_{false};
    std::atomic<bool> page_context_running_{false};
    std::atomic<bool> page_context_pending_{false};
    TaskHandle_t backend_refresh_task_handle_ = nullptr;
    TaskHandle_t backend_event_task_handle_ = nullptr;
    TaskHandle_t page_context_task_handle_ = nullptr;
    std::atomic<bool> backend_refresh_force_{false};
    std::atomic<int> backend_refresh_requested_tick_{0};

    lv_obj_t* root_ = nullptr;
    lv_obj_t* header_title_label_ = nullptr;
    lv_obj_t* header_state_label_ = nullptr;
    lv_obj_t* mode_switch_btn_ = nullptr;
    lv_obj_t* mode_popup_ = nullptr;
    lv_obj_t* time_label_ = nullptr;
    lv_obj_t* subtitle_label_ = nullptr;
    lv_obj_t* ai_button_ = nullptr;
    lv_obj_t* content_ = nullptr;

    void* screensaver_image_buffer_ = nullptr;
    void* screensaver_image_dsc_ = nullptr;
    std::string screensaver_image_path_;
    int screensaver_image_width_ = 0;
    int screensaver_image_height_ = 0;

    // 屏幕电源梯度状态。screen_power_ 记录当前已应用的档位;
    // screen_off_swallow_ 是熄屏时置于最顶层的全屏透明遮挡层,
    // 保证熄屏后第一次触摸只唤醒、不穿透到下方按钮。
    ScreenPower screen_power_ = ScreenPower::kActive;
    lv_obj_t* screen_off_swallow_ = nullptr;
};

#endif
