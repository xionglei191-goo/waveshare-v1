#include "app_backend_client.h"

#include "board.h"
#include "settings.h"

#include <cJSON.h>
#include <esp_log.h>
#include <esp_http_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mbedtls/sha256.h>
#include <esp_wifi.h>
#include <wifi_manager.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <unistd.h>

namespace {
constexpr const char* TAG = "AppBackendClient";
constexpr const char* kSettingsNs = "appshell";
constexpr const char* kBackendUrlKey = "backend_url";
constexpr const char* kDeviceTokenKey = "device_token";
constexpr const char* kDefaultBackendUrl = "http://192.168.31.246:3100";
constexpr const char* kLegacyBackendUrl = "http://192.168.31.246:3000";
constexpr int kHttpTimeoutMs = 5000;
constexpr int kDownloadTimeoutMs = 5000;
constexpr int kMaxScheduleItems = 4;
constexpr int kMaxNotifications = 3;
constexpr int kMaxApps = 6;

esp_err_t BackendHttpEventHandler(esp_http_client_event_t* event) {
    if (event->event_id == HTTP_EVENT_ON_DATA && event->user_data != nullptr && event->data != nullptr &&
        event->data_len > 0) {
        auto* response = static_cast<std::string*>(event->user_data);
        response->append(static_cast<const char*>(event->data), event->data_len);
    }
    return ESP_OK;
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

int JsonTenths(cJSON* object, const char* key, int fallback = -1) {
    auto item = cJSON_GetObjectItem(object, key);
    if (cJSON_IsNumber(item)) {
        return static_cast<int>(item->valuedouble * 10.0 + (item->valuedouble >= 0 ? 0.5 : -0.5));
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

std::string Sha256Hex(const unsigned char digest[32]) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex;
    hex.resize(64);
    for (int i = 0; i < 32; ++i) {
        hex[i * 2] = kHex[(digest[i] >> 4) & 0x0f];
        hex[i * 2 + 1] = kHex[digest[i] & 0x0f];
    }
    return hex;
}

std::string TrimSseValue(const std::string& value) {
    size_t start = 0;
    while (start < value.size() && value[start] == ' ') {
        start++;
    }
    size_t end = value.size();
    while (end > start && (value[end - 1] == ' ' || value[end - 1] == '\r')) {
        end--;
    }
    return value.substr(start, end - start);
}

class WifiPowerSaveGuard {
public:
    WifiPowerSaveGuard() {
        restore_ = esp_wifi_get_ps(&previous_) == ESP_OK;
        esp_wifi_set_ps(WIFI_PS_NONE);
    }
    ~WifiPowerSaveGuard() {
        if (restore_) {
            esp_wifi_set_ps(previous_);
        }
    }

private:
    wifi_ps_type_t previous_ = WIFI_PS_MAX_MODEM;
    bool restore_ = false;
};

AppScheduleItem ParseScheduleItem(cJSON* item) {
    AppScheduleItem result;
    if (!cJSON_IsObject(item)) {
        return result;
    }
    result.id = JsonString(item, "id");
    result.title = JsonString(item, "title", result.title);
    result.time = JsonString(item, "time", result.time);
    result.note = JsonString(item, "note");
    result.done = JsonBool(item, "done", false);
    return result;
}

void ParseMusicChannel(cJSON* object, AppMusicChannelState& state) {
    if (!cJSON_IsObject(object)) {
        return;
    }

    state.available = JsonBool(object, "available", state.available);
    state.playing = JsonBool(object, "playing", state.playing);
    state.title = JsonString(object, "title", state.title);
    state.artist = JsonString(object, "artist", state.artist);
    state.source = JsonString(object, "source", state.source);
    state.detail = JsonString(object, "detail", state.detail);
    state.current_track_id = JsonString(object, "currentTrackId",
                                        JsonString(object, "current_track_id", state.current_track_id));
    state.stream_url = JsonString(object, "streamUrl", JsonString(object, "stream_url", state.stream_url));
    state.download_url = JsonString(object, "downloadUrl",
                                    JsonString(object, "download_url", state.download_url));
    state.format = JsonString(object, "format", state.format);
    state.content_type = JsonString(object, "contentType",
                                    JsonString(object, "content_type", state.content_type));
    state.sha256 = JsonString(object, "sha256", state.sha256);
    state.cache_path = JsonString(object, "cachePath", JsonString(object, "cache_path", state.cache_path));
    state.size = JsonInt(object, "size", state.size);
    state.cacheable = JsonBool(object, "cacheable", state.cacheable);
    state.supports_range = JsonBool(object, "supportsRange",
                                    JsonBool(object, "supports_range", state.supports_range));
    state.volume = JsonInt(object, "volume", state.volume);
    state.track_count = JsonInt(object, "trackCount", JsonInt(object, "track_count", state.track_count));
    state.duration_sec = JsonInt(object, "durationSec", JsonInt(object, "duration_sec", state.duration_sec));
}

void ParseScheduleArray(cJSON* array, std::vector<AppScheduleItem>& out) {
    if (!cJSON_IsArray(array)) {
        return;
    }

    const int count = std::min(cJSON_GetArraySize(array), kMaxScheduleItems);
    for (int i = 0; i < count; ++i) {
        out.push_back(ParseScheduleItem(cJSON_GetArrayItem(array, i)));
    }
}

void ParseNotifications(cJSON* array, std::vector<AppNotificationItem>& out) {
    if (!cJSON_IsArray(array)) {
        return;
    }

    const int count = std::min(cJSON_GetArraySize(array), kMaxNotifications);
    for (int i = 0; i < count; ++i) {
        auto item = cJSON_GetArrayItem(array, i);
        if (!cJSON_IsObject(item)) {
            continue;
        }
        AppNotificationItem notification;
        notification.id = JsonString(item, "id");
        notification.title = JsonString(item, "title", notification.title);
        notification.message = JsonString(item, "message");
        notification.level = JsonString(item, "level", notification.level);
        out.push_back(notification);
    }
}

void ParseApps(cJSON* array, std::vector<AppEntry>& out) {
    if (!cJSON_IsArray(array)) {
        return;
    }

    const int count = std::min(cJSON_GetArraySize(array), kMaxApps);
    for (int i = 0; i < count; ++i) {
        auto item = cJSON_GetArrayItem(array, i);
        if (!cJSON_IsObject(item)) {
            continue;
        }
        AppEntry app;
        app.id = JsonString(item, "id");
        app.title = JsonString(item, "title", app.title);
        app.subtitle = JsonString(item, "subtitle");
        app.action = JsonString(item, "action", app.action);
        out.push_back(app);
    }
}
} // namespace

AppBackendClient& AppBackendClient::GetInstance() {
    static AppBackendClient instance;
    return instance;
}

void AppBackendClient::LoadSettings() {
    Settings settings(kSettingsNs, false);
    backend_url_ = settings.GetString(kBackendUrlKey, kDefaultBackendUrl);
    device_token_ = settings.GetString(kDeviceTokenKey, "");
    if (backend_url_.empty() || backend_url_ == kLegacyBackendUrl) {
        backend_url_ = kDefaultBackendUrl;
        Settings writable_settings(kSettingsNs, true);
        writable_settings.SetString(kBackendUrlKey, backend_url_);
    }
}

void AppBackendClient::SetDeviceToken(const std::string& device_token) {
    device_token_ = device_token;
    Settings settings(kSettingsNs, true);
    settings.SetString(kDeviceTokenKey, device_token_);
}

void AppBackendClient::SetBackendUrl(const std::string& backend_url) {
    backend_url_ = backend_url.empty() ? kDefaultBackendUrl : backend_url;
    Settings settings(kSettingsNs, true);
    settings.SetString(kBackendUrlKey, backend_url_);
}

bool AppBackendClient::FetchSummary(AppBackendSnapshot& snapshot) {
    std::string response;
    std::string error;
    snapshot.backend_url = backend_url_;

    if (!Request("GET", "/api/device/summary", "", response, error)) {
        snapshot.online = false;
        snapshot.last_error = error;
        return false;
    }

    if (!ParseSummary(response, snapshot, error)) {
        snapshot.online = false;
        snapshot.last_error = error;
        return false;
    }

    snapshot.online = true;
    snapshot.backend_url = backend_url_;
    snapshot.last_error = "online";
    return true;
}

bool AppBackendClient::PostAction(const std::string& name, const std::string& params_json,
                                  AppBackendSnapshot* snapshot) {
    std::string body = R"({"type":"action.call","name":")" + name + R"(","params":)";
    body += params_json.empty() ? "{}" : params_json;
    body += "}";

    std::string response;
    std::string error;
    const bool ok = Request("POST", "/api/action", body, response, error);
    if (!ok) {
        if (snapshot != nullptr) {
            snapshot->online = false;
            snapshot->backend_url = backend_url_;
            snapshot->last_error = error;
        }
        return false;
    }

    if (snapshot != nullptr) {
        if (!ParseSummary(response, *snapshot, error)) {
            snapshot->online = false;
            snapshot->backend_url = backend_url_;
            snapshot->last_error = error;
            return false;
        }
        snapshot->online = true;
        snapshot->backend_url = backend_url_;
        snapshot->last_error = "online";
    }
    return true;
}

bool AppBackendClient::FetchRemotePage(const std::string& page, std::string& body, std::string& error) {
    std::string safe_page = page.empty() ? "home" : page;
    for (auto& ch : safe_page) {
        if (!(std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' || ch == '-')) {
            ch = '_';
        }
    }
    return Request("GET", ("/api/ui/page/" + safe_page).c_str(), "", body, error);
}

bool AppBackendClient::FetchResourceManifest(std::string& body, std::string& error) {
    return Request("GET", "/api/resources/manifest", "", body, error);
}

bool AppBackendClient::FetchServerTracks(std::string& body, std::string& error) {
    return Request("GET", "/api/media/server/tracks", "", body, error);
}

bool AppBackendClient::DownloadToFile(const std::string& url, const std::string& path, size_t max_bytes,
                                      std::string& sha256_hex, std::string& error) {
    std::lock_guard<std::mutex> request_lock(request_mutex_);

    auto& wifi_manager = WifiManager::GetInstance();
    if (!wifi_manager.IsInitialized() || !wifi_manager.IsConnected()) {
        error = "network not ready";
        return false;
    }
    WifiPowerSaveGuard ps_guard;

    const bool absolute = url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
    const std::string target_url = absolute ? url : BuildUrl(url.c_str());

    esp_http_client_config_t config = {};
    config.url = target_url.c_str();
    config.timeout_ms = kDownloadTimeoutMs;
    config.keep_alive_enable = false;
    config.buffer_size = 2048;
    config.buffer_size_tx = 1024;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == nullptr) {
        error = "http init failed";
        return false;
    }

    esp_http_client_set_method(client, HTTP_METHOD_GET);
    esp_http_client_set_header(client, "Accept", "*/*");
    esp_http_client_set_header(client, "Connection", "close");
    esp_http_client_set_header(client, "User-Agent", "xiaozhi-appshell/1");
    if (!device_token_.empty()) {
        esp_http_client_set_header(client, "X-Device-Token", device_token_.c_str());
    }

    FILE* file = std::fopen(path.c_str(), "wb");
    if (file == nullptr) {
        esp_http_client_cleanup(client);
        error = "open target failed";
        return false;
    }

    bool ok = false;
    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    if (mbedtls_sha256_starts(&sha, 0) != 0) {
        error = "sha init failed";
    } else {
        esp_err_t err = esp_http_client_open(client, 0);
        if (err != ESP_OK) {
            error = "open failed: " + std::to_string(static_cast<int>(err));
        } else {
            esp_http_client_fetch_headers(client);
            const int status = esp_http_client_get_status_code(client);
            if (status < 200 || status >= 300) {
                error = "http " + std::to_string(status);
            } else {
                char buffer[2048];
                size_t total = 0;
                while (true) {
                    const int read = esp_http_client_read(client, buffer, sizeof(buffer));
                    if (read < 0) {
                        error = "read failed";
                        break;
                    }
                    if (read == 0) {
                        ok = true;
                        break;
                    }
                    total += static_cast<size_t>(read);
                    if (max_bytes > 0 && total > max_bytes) {
                        error = "download too large";
                        break;
                    }
                    if (std::fwrite(buffer, 1, read, file) != static_cast<size_t>(read)) {
                        error = "write failed";
                        break;
                    }
                    mbedtls_sha256_update(&sha, reinterpret_cast<const unsigned char*>(buffer), read);
                    vTaskDelay(pdMS_TO_TICKS(1));
                }
                if (ok) {
                    unsigned char digest[32] = {};
                    if (mbedtls_sha256_finish(&sha, digest) != 0) {
                        error = "sha finish failed";
                        ok = false;
                    } else {
                        sha256_hex = Sha256Hex(digest);
                    }
                }
            }
            esp_http_client_close(client);
        }
    }

    mbedtls_sha256_free(&sha);
    std::fclose(file);
    esp_http_client_cleanup(client);
    if (!ok) {
        unlink(path.c_str());
        ESP_LOGW(TAG, "download %s failed: %s", target_url.c_str(), error.c_str());
    }
    return ok;
}

bool AppBackendClient::PostServerMediaProgress(const std::string& track_id, int position_sec, int duration_sec,
                                               bool completed) {
    if (track_id.empty()) {
        return false;
    }
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "trackId", track_id.c_str());
    cJSON_AddStringToObject(root, "deviceId", "esp32-185b");
    cJSON_AddNumberToObject(root, "positionSec", position_sec);
    cJSON_AddNumberToObject(root, "durationSec", duration_sec);
    cJSON_AddBoolToObject(root, "completed", completed);
    char* printed = cJSON_PrintUnformatted(root);
    const std::string body = printed != nullptr ? printed : "{}";
    if (printed != nullptr) {
        cJSON_free(printed);
    }
    cJSON_Delete(root);

    std::string response;
    std::string error;
    const bool ok = Request("POST", "/api/media/server/progress", body, response, error);
    if (!ok) {
        ESP_LOGW(TAG, "server media progress failed: %s", error.c_str());
    }
    return ok;
}

bool AppBackendClient::PostDeviceLog(const std::string& level, const std::string& source,
                                     const std::string& message, const std::string& data_json) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", Board::GetInstance().GetUuid().c_str());
    cJSON_AddStringToObject(root, "level", level.empty() ? "info" : level.c_str());
    cJSON_AddStringToObject(root, "source", source.empty() ? "appshell" : source.c_str());
    cJSON_AddStringToObject(root, "message", message.empty() ? "device heartbeat" : message.c_str());
    cJSON* data = cJSON_Parse(data_json.empty() ? "{}" : data_json.c_str());
    if (cJSON_IsObject(data)) {
        cJSON_AddItemToObject(root, "data", data);
    } else {
        if (data != nullptr) {
            cJSON_Delete(data);
        }
        cJSON_AddItemToObject(root, "data", cJSON_CreateObject());
    }
    char* printed = cJSON_PrintUnformatted(root);
    const std::string body = printed != nullptr ? printed : "{}";
    if (printed != nullptr) {
        cJSON_free(printed);
    }
    cJSON_Delete(root);

    std::string response;
    std::string error;
    const bool ok = Request("POST", "/api/device/logs", body, response, error);
    if (!ok) {
        ESP_LOGW(TAG, "device log failed: %s", error.c_str());
    }
    return ok;
}

bool AppBackendClient::PostDeviceContext(const std::string& page, const std::string& family_mode,
                                         const std::string& page_state_json) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", "esp32-185b");
    cJSON_AddStringToObject(root, "page", page.empty() ? "home" : page.c_str());
    cJSON_AddStringToObject(root, "familyMode", family_mode.empty() ? "默认" : family_mode.c_str());
    cJSON_AddStringToObject(root, "source", "appshell.page");
    cJSON* page_state = cJSON_Parse(page_state_json.empty() ? "{}" : page_state_json.c_str());
    if (!cJSON_IsObject(page_state)) {
        if (page_state != nullptr) {
            cJSON_Delete(page_state);
        }
        page_state = cJSON_CreateObject();
    }
    cJSON_AddItemToObject(root, "pageState", page_state);
    char* printed = cJSON_PrintUnformatted(root);
    const std::string body = printed != nullptr ? printed : "{}";
    if (printed != nullptr) {
        cJSON_free(printed);
    }
    cJSON_Delete(root);

    std::string response;
    std::string error;
    const bool ok = Request("POST", "/api/device/context", body, response, error);
    if (!ok) {
        ESP_LOGW(TAG, "device context failed: %s", error.c_str());
    }
    return ok;
}

bool AppBackendClient::PostSyncEvents(const std::string& batch_json) {
    std::string response;
    std::string error;
    const bool ok = Request("POST", "/api/sync/push", batch_json.empty() ? "{}" : batch_json, response, error);
    if (!ok) {
        ESP_LOGW(TAG, "sync push failed: %s", error.c_str());
    }
    return ok;
}

bool AppBackendClient::AckDeviceCommand(const std::string& command_id, const std::string& status,
                                        const std::string& message) {
    if (command_id.empty()) {
        return false;
    }
    cJSON* root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", "esp32-185b");
    cJSON_AddStringToObject(root, "status", status.empty() ? "accepted" : status.c_str());
    cJSON_AddStringToObject(root, "message", message.c_str());
    char* printed = cJSON_PrintUnformatted(root);
    const std::string body = printed != nullptr ? printed : "{}";
    if (printed != nullptr) {
        cJSON_free(printed);
    }
    cJSON_Delete(root);

    std::string response;
    std::string error;
    const std::string path = "/api/device/commands/" + command_id + "/ack";
    const bool ok = Request("POST", path, body, response, error);
    if (!ok) {
        ESP_LOGW(TAG, "device command ack failed: %s", error.c_str());
    }
    return ok;
}

bool AppBackendClient::FetchEventState(AppBackendEventState& state, std::string& error) {
    std::string response;
    state = AppBackendEventState();
    if (!Request("GET", "/api/events/latest", "", response, error)) {
        return false;
    }

    cJSON* root = cJSON_Parse(response.c_str());
    if (root == nullptr) {
        error = "invalid event json";
        return false;
    }
    cJSON* data = cJSON_GetObjectItem(root, "data");
    if (!cJSON_IsObject(data)) {
        data = root;
    }

    auto event = cJSON_GetObjectItem(data, "event");
    if (cJSON_IsObject(event)) {
        state.event_id = JsonString(event, "id");
        state.event_type = JsonString(event, "type");
    }
    auto notification = cJSON_GetObjectItem(data, "notification");
    if (cJSON_IsObject(notification)) {
        state.notification_title = JsonString(notification, "title");
        state.notification_message = JsonString(notification, "message");
    }
    state.notification_key = JsonString(data, "notificationKey");
    auto command = cJSON_GetObjectItem(data, "command");
    if (cJSON_IsObject(command)) {
        state.command_id = JsonString(command, "id");
        state.command_type = JsonString(command, "type");
        auto payload = cJSON_GetObjectItem(command, "payload");
        if (cJSON_IsObject(payload)) {
            char* printed = cJSON_PrintUnformatted(payload);
            if (printed != nullptr) {
                state.command_payload_json = printed;
                cJSON_free(printed);
            }
        }
    }

    cJSON_Delete(root);
    return true;
}

bool AppBackendClient::WaitForEvent(std::string& event_name, std::string& event_data, int wait_ms,
                                    std::string& error) {
    event_name.clear();
    event_data.clear();

    auto& wifi_manager = WifiManager::GetInstance();
    if (!wifi_manager.IsInitialized() || !wifi_manager.IsConnected()) {
        error = "network not ready";
        return false;
    }

    const std::string url = BuildUrl("/api/events");
    esp_http_client_config_t config = {};
    config.url = url.c_str();
    config.timeout_ms = 2000;
    config.keep_alive_enable = true;
    config.buffer_size = 1024;
    config.buffer_size_tx = 512;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == nullptr) {
        error = "event init failed";
        return false;
    }

    esp_http_client_set_method(client, HTTP_METHOD_GET);
    esp_http_client_set_header(client, "Accept", "text/event-stream");
    esp_http_client_set_header(client, "Cache-Control", "no-cache");
    esp_http_client_set_header(client, "User-Agent", "xiaozhi-appshell/1");

    bool ok = false;
    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        error = "event open failed: " + std::to_string(static_cast<int>(err));
    } else {
        esp_http_client_fetch_headers(client);
        const int status = esp_http_client_get_status_code(client);
        if (status < 200 || status >= 300) {
            error = "event http " + std::to_string(status);
        } else {
            char buffer[256];
            std::string line;
            std::string current_event;
            std::string current_data;
            const TickType_t start = xTaskGetTickCount();
            const TickType_t wait_ticks = pdMS_TO_TICKS(wait_ms <= 0 ? 30000 : wait_ms);

            auto finish_event = [&]() -> bool {
                if (current_event.empty() && current_data.empty()) {
                    return false;
                }
                if (current_event == "heartbeat" || current_event == "connected") {
                    current_event.clear();
                    current_data.clear();
                    return false;
                }
                event_name = current_event.empty() ? "message" : current_event;
                event_data = current_data;
                return true;
            };

            while (xTaskGetTickCount() - start < wait_ticks) {
                const int read = esp_http_client_read(client, buffer, sizeof(buffer));
                if (read == -ESP_ERR_HTTP_EAGAIN) {
                    vTaskDelay(pdMS_TO_TICKS(50));
                    continue;
                }
                if (read < 0) {
                    error = "event read failed: " + std::to_string(read);
                    break;
                }
                if (read == 0) {
                    vTaskDelay(pdMS_TO_TICKS(100));
                    continue;
                }
                for (int i = 0; i < read; ++i) {
                    const char ch = buffer[i];
                    if (ch == '\r') {
                        continue;
                    }
                    if (ch != '\n') {
                        if (line.size() < 512) {
                            line.push_back(ch);
                        }
                        continue;
                    }
                    if (line.empty()) {
                        if (finish_event()) {
                            ok = true;
                            break;
                        }
                    } else if (line.rfind("event:", 0) == 0) {
                        current_event = TrimSseValue(line.substr(6));
                    } else if (line.rfind("data:", 0) == 0) {
                        if (!current_data.empty()) {
                            current_data.push_back('\n');
                        }
                        current_data += TrimSseValue(line.substr(5));
                    }
                    line.clear();
                }
                if (ok) {
                    break;
                }
            }
            if (!ok && error.empty()) {
                error = "timeout";
            }
        }
        esp_http_client_close(client);
    }

    esp_http_client_cleanup(client);
    return ok;
}

std::string AppBackendClient::BuildUrl(const char* path) const {
    std::string base = backend_url_.empty() ? kDefaultBackendUrl : backend_url_;
    while (!base.empty() && base.back() == '/') {
        base.pop_back();
    }
    return base + path;
}

bool AppBackendClient::Request(const std::string& method, const std::string& path, const std::string& body,
                               std::string& response, std::string& error) {
    std::lock_guard<std::mutex> request_lock(request_mutex_);

    auto& wifi_manager = WifiManager::GetInstance();
    if (!wifi_manager.IsInitialized() || !wifi_manager.IsConnected()) {
        error = "network not ready";
        return false;
    }
    WifiPowerSaveGuard ps_guard;

    const std::string url = BuildUrl(path.c_str());

    esp_http_client_config_t config = {};
    config.url = url.c_str();
    config.timeout_ms = kHttpTimeoutMs;
    config.event_handler = BackendHttpEventHandler;
    config.user_data = &response;
    config.keep_alive_enable = false;
    config.buffer_size = 768;
    config.buffer_size_tx = 512;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == nullptr) {
        error = "http init failed";
        ESP_LOGW(TAG, "%s %s failed: %s", method.c_str(), url.c_str(), error.c_str());
        return false;
    }

    esp_http_client_set_method(client, method == "POST" ? HTTP_METHOD_POST : HTTP_METHOD_GET);
    esp_http_client_set_header(client, "Accept", "application/json");
    esp_http_client_set_header(client, "Connection", "close");
    esp_http_client_set_header(client, "User-Agent", "xiaozhi-appshell/1");
    if (!body.empty()) {
        esp_http_client_set_header(client, "Content-Type", "application/json");
        esp_http_client_set_post_field(client, body.data(), body.size());
    }

    response.clear();
    esp_err_t err = esp_http_client_perform(client);
    const int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK) {
        error = "perform failed: " + std::to_string(static_cast<int>(err));
        ESP_LOGW(TAG, "%s %s failed: %s", method.c_str(), url.c_str(), error.c_str());
        return false;
    }

    if (status < 200 || status >= 300) {
        error = "http " + std::to_string(status);
        ESP_LOGW(TAG, "%s %s returned %s", method.c_str(), url.c_str(), error.c_str());
        return false;
    }
    return true;
}

bool AppBackendClient::ParseSummary(const std::string& body, AppBackendSnapshot& snapshot, std::string& error) {
    cJSON* root = cJSON_Parse(body.c_str());
    if (root == nullptr) {
        error = "invalid json";
        return false;
    }

    cJSON* data = cJSON_GetObjectItem(root, "data");
    if (!cJSON_IsObject(data)) {
        data = root;
    }

    snapshot = AppBackendSnapshot();
    snapshot.backend_url = backend_url_;
    snapshot.online = true;
    snapshot.server_time = JsonString(data, "serverTime");

    auto weather = cJSON_GetObjectItem(data, "weather");
    if (cJSON_IsObject(weather)) {
        snapshot.weather.summary = JsonString(weather, "summary", snapshot.weather.summary);
        snapshot.weather.condition = JsonString(weather, "condition", snapshot.weather.condition);
        snapshot.weather.temperature = JsonInt(weather, "temperature", snapshot.weather.temperature);
        snapshot.weather.humidity = JsonInt(weather, "humidity", snapshot.weather.humidity);
        snapshot.weather.air = JsonString(weather, "air", snapshot.weather.air);
        snapshot.weather.location = JsonString(weather, "location", snapshot.weather.location);
        snapshot.weather.updated_at = JsonString(weather, "updatedAt",
                                                 JsonString(weather, "updated_at", snapshot.weather.updated_at));
        snapshot.weather.updated_local_time =
            JsonString(weather, "updatedLocalTime",
                       JsonString(weather, "updated_local_time", snapshot.weather.updated_local_time));
        snapshot.weather.provider = JsonString(weather, "provider", snapshot.weather.provider);
        snapshot.weather.apparent_temperature =
            JsonInt(weather, "apparentTemperature",
                    JsonInt(weather, "apparent_temperature", snapshot.weather.apparent_temperature));
        snapshot.weather.weather_code =
            JsonInt(weather, "weatherCode", JsonInt(weather, "weather_code", snapshot.weather.weather_code));
        snapshot.weather.is_stale = JsonBool(weather, "isStale", true);
        snapshot.weather.last_refresh_error =
            JsonString(weather, "lastRefreshError",
                       JsonString(weather, "last_refresh_error", snapshot.weather.last_refresh_error));
        snapshot.weather.available = snapshot.weather.weather_code >= 0 &&
                                     snapshot.weather.condition != "--" &&
                                     !snapshot.weather.updated_at.empty();

        auto air_quality = cJSON_GetObjectItem(weather, "airQuality");
        if (!cJSON_IsObject(air_quality)) {
            air_quality = cJSON_GetObjectItem(weather, "air_quality");
        }
        if (cJSON_IsObject(air_quality)) {
            snapshot.weather.aqi = JsonInt(air_quality, "aqi", snapshot.weather.aqi);
            snapshot.weather.pm25_tenths =
                JsonTenths(air_quality, "pm25", JsonTenths(air_quality, "pm2_5", snapshot.weather.pm25_tenths));
            snapshot.weather.air_level = JsonString(air_quality, "level", snapshot.weather.air_level);
        }

        auto forecast = cJSON_GetObjectItem(weather, "forecast");
        if (cJSON_IsObject(forecast)) {
            auto tonight = cJSON_GetObjectItem(forecast, "tonight");
            if (cJSON_IsObject(tonight)) {
                snapshot.weather.tonight_condition =
                    JsonString(tonight, "condition", snapshot.weather.tonight_condition);
                snapshot.weather.tonight_weather_code =
                    JsonInt(tonight, "weatherCode",
                            JsonInt(tonight, "weather_code", snapshot.weather.tonight_weather_code));
                snapshot.weather.tonight_temperature =
                    JsonInt(tonight, "temperature", snapshot.weather.tonight_temperature);
                snapshot.weather.tonight_available = snapshot.weather.tonight_weather_code >= 0;
            }
            auto tomorrow = cJSON_GetObjectItem(forecast, "tomorrow");
            if (cJSON_IsObject(tomorrow)) {
                snapshot.weather.tomorrow_condition =
                    JsonString(tomorrow, "condition", snapshot.weather.tomorrow_condition);
                snapshot.weather.tomorrow_weather_code =
                    JsonInt(tomorrow, "weatherCode",
                            JsonInt(tomorrow, "weather_code", snapshot.weather.tomorrow_weather_code));
                snapshot.weather.tomorrow_high = JsonInt(tomorrow, "high", snapshot.weather.tomorrow_high);
                snapshot.weather.tomorrow_low = JsonInt(tomorrow, "low", snapshot.weather.tomorrow_low);
                snapshot.weather.tomorrow_available = snapshot.weather.tomorrow_weather_code >= 0;
            }
        }
    }

    auto schedule = cJSON_GetObjectItem(data, "schedule");
    if (cJSON_IsObject(schedule)) {
        auto next = cJSON_GetObjectItem(schedule, "next");
        if (cJSON_IsObject(next)) {
            snapshot.next_schedule = ParseScheduleItem(next);
        }
        ParseScheduleArray(cJSON_GetObjectItem(schedule, "today"), snapshot.today_schedule);
    }

    auto music = cJSON_GetObjectItem(data, "music");
    if (cJSON_IsObject(music)) {
        snapshot.music.active_source = JsonString(music, "activeSource",
                                                  JsonString(music, "active_source", snapshot.music.active_source));
        auto sd = cJSON_GetObjectItem(music, "sd");
        auto server = cJSON_GetObjectItem(music, "server");
        if (cJSON_IsObject(sd) || cJSON_IsObject(server)) {
            ParseMusicChannel(sd, snapshot.music.sd);
            ParseMusicChannel(server, snapshot.music.server);
        } else {
            snapshot.music.active_source = "server";
            snapshot.music.server.playing = JsonBool(music, "playing", snapshot.music.server.playing);
            snapshot.music.server.title = JsonString(music, "title", snapshot.music.server.title);
            snapshot.music.server.artist = JsonString(music, "artist", snapshot.music.server.artist);
            snapshot.music.server.source = JsonString(music, "source", snapshot.music.server.source);
            snapshot.music.server.volume = JsonInt(music, "volume", snapshot.music.server.volume);
            snapshot.music.server.available = true;
        }
        if (snapshot.music.active_source != "sd" && snapshot.music.active_source != "server") {
            snapshot.music.active_source = "server";
        }
    }

    auto english = cJSON_GetObjectItem(data, "english");
    if (cJSON_IsObject(english)) {
        snapshot.english.topic = JsonString(english, "topic", snapshot.english.topic);
        snapshot.english.prompt = JsonString(english, "prompt", snapshot.english.prompt);
        snapshot.english.progress = JsonString(english, "progress", snapshot.english.progress);
        snapshot.english.score = JsonInt(english, "score", snapshot.english.score);
    }

    ParseNotifications(cJSON_GetObjectItem(data, "notifications"), snapshot.notifications);
    ParseApps(cJSON_GetObjectItem(data, "apps"), snapshot.apps);
    snapshot.family_mode = JsonString(data, "familyMode", JsonString(data, "family_mode", snapshot.family_mode));

    cJSON_Delete(root);
    return true;
}
