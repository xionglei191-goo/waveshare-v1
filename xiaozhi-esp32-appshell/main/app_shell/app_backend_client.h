#ifndef APP_BACKEND_CLIENT_H_
#define APP_BACKEND_CLIENT_H_

#include <string>
#include <vector>
#include <mutex>

struct AppWeatherState {
    std::string summary = "天气待更新";
    std::string condition = "--";
    int temperature = 0;
    int humidity = 0;
    std::string air = "--";
    std::string location = "家";
    std::string updated_at;
    std::string updated_local_time;
    std::string provider;
    std::string air_level = "--";
    std::string last_refresh_error;
    int apparent_temperature = 0;
    int weather_code = -1;
    int aqi = -1;
    int pm25_tenths = -1;
    bool available = false;
    bool is_stale = true;
    bool tonight_available = false;
    std::string tonight_condition;
    int tonight_weather_code = -1;
    int tonight_temperature = 0;
    bool tomorrow_available = false;
    std::string tomorrow_condition;
    int tomorrow_weather_code = -1;
    int tomorrow_high = 0;
    int tomorrow_low = 0;
};

struct AppScheduleItem {
    std::string id;
    std::string title = "暂无日程";
    std::string time = "--:--";
    std::string note;
    bool done = false;
};

struct AppMusicChannelState {
    bool available = false;
    bool playing = false;
    std::string title = "未播放";
    std::string artist = "家庭播放器";
    std::string source = "--";
    std::string detail = "待连接";
    std::string current_track_id;
    std::string stream_url;
    std::string download_url;
    std::string format;
    std::string content_type;
    std::string sha256;
    std::string cache_path;
    int size = 0;
    bool cacheable = false;
    bool supports_range = false;
    int volume = 45;
    int track_count = 0;
    int duration_sec = 0;
};

struct AppMusicState {
    std::string active_source = "server";
    AppMusicChannelState sd = [] {
        AppMusicChannelState state;
        state.title = "SD 卡音乐";
        state.artist = "本地文件";
        state.source = "SD 卡";
        state.detail = "等待 SD 卡";
        return state;
    }();
    AppMusicChannelState server = [] {
        AppMusicChannelState state;
        state.available = true;
        state.title = "服务器音乐";
        state.artist = "Home Server";
        state.source = "服务器播客";
        state.detail = "局域网内容";
        return state;
    }();

    const AppMusicChannelState& Active() const { return active_source == "sd" ? sd : server; }
    bool IsPlaying() const { return Active().playing; }
    const char* ActiveLabel() const { return active_source == "sd" ? "SD 卡" : "服务器"; }
};

struct AppEnglishSession {
    std::string topic = "Daily Talk";
    std::string prompt = "Say one sentence about your day.";
    std::string progress = "0/5";
    int score = 0;
};

struct AppNotificationItem {
    std::string id;
    std::string title = "通知";
    std::string message;
    std::string level = "info";
};

struct AppEntry {
    std::string id;
    std::string title = "应用";
    std::string subtitle;
    std::string action = "app.open";
};

struct AppBackendSnapshot {
    bool online = false;
    std::string backend_url;
    std::string last_error = "后端未连接";
    std::string server_time;
    AppWeatherState weather;
    AppScheduleItem next_schedule;
    std::vector<AppScheduleItem> today_schedule;
    AppMusicState music;
    AppEnglishSession english;
    std::vector<AppNotificationItem> notifications;
    std::vector<AppEntry> apps;
    std::string family_mode = "默认";
};

struct AppBackendEventState {
    std::string event_id;
    std::string event_type;
    std::string notification_key;
    std::string notification_title;
    std::string notification_message;
    std::string command_id;
    std::string command_type;
    std::string command_payload_json;
};

class AppBackendClient {
public:
    static AppBackendClient& GetInstance();

    void LoadSettings();
    std::string backend_url() const { return backend_url_; }
    void SetBackendUrl(const std::string& backend_url);
    void SetDeviceToken(const std::string& device_token);

    bool FetchSummary(AppBackendSnapshot& snapshot);
    bool PostAction(const std::string& name, const std::string& params_json, AppBackendSnapshot* snapshot);
    bool FetchRemotePage(const std::string& page, std::string& body, std::string& error);
    bool FetchResourceManifest(std::string& body, std::string& error);
    bool FetchServerTracks(std::string& body, std::string& error);
    bool DownloadToFile(const std::string& url, const std::string& path, size_t max_bytes,
                        std::string& sha256_hex, std::string& error);
    bool PostServerMediaProgress(const std::string& track_id, int position_sec, int duration_sec, bool completed);
    bool PostDeviceLog(const std::string& level, const std::string& source, const std::string& message,
                       const std::string& data_json);
    bool PostDeviceContext(const std::string& page, const std::string& family_mode,
                           const std::string& page_state_json);
    bool PostSyncEvents(const std::string& batch_json);
    bool AckDeviceCommand(const std::string& command_id, const std::string& status, const std::string& message);
    bool FetchEventState(AppBackendEventState& state, std::string& error);
    bool WaitForEvent(std::string& event_name, std::string& event_data, int wait_ms, std::string& error);

private:
    AppBackendClient() = default;

    std::string BuildUrl(const char* path) const;
    bool Request(const std::string& method, const std::string& path, const std::string& body,
                 std::string& response, std::string& error);
    bool ParseSummary(const std::string& body, AppBackendSnapshot& snapshot, std::string& error);

    std::string backend_url_ = "http://192.168.31.246:3100";
    std::string device_token_;
    std::mutex request_mutex_;
};

#endif
