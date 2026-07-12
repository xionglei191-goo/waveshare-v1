#include "app_sync_queue.h"

#include "app_backend_client.h"
#include "app_storage_manager.h"
#include "board.h"

#include <cJSON.h>
#include <dirent.h>
#include <esp_log.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <ctime>
#include <mutex>

namespace {
constexpr const char* TAG = "AppSyncQueue";
constexpr int kMaxFlushEvents = 8;
constexpr int kMaxOutboxEvents = 64;

std::string JsonPrint(cJSON* object) {
    char* raw = cJSON_PrintUnformatted(object);
    if (raw == nullptr) {
        return "{}";
    }
    std::string result(raw);
    cJSON_free(raw);
    return result;
}

int CountOutbox(const std::string& path) {
    int count = 0;
    DIR* dir = opendir(path.c_str());
    if (dir == nullptr) {
        return 0;
    }
    while (auto* entry = readdir(dir)) {
        if (entry->d_name[0] != '.') {
            count++;
        }
    }
    closedir(dir);
    return count;
}
} // namespace

AppSyncQueue& AppSyncQueue::GetInstance() {
    static AppSyncQueue instance;
    return instance;
}

void AppSyncQueue::Initialize() {
    Refresh();
}

void AppSyncQueue::Refresh() {
    auto& storage = AppStorageManager::GetInstance();
    std::lock_guard<std::recursive_mutex> fs_lock(storage.filesystem_mutex());
    const bool ready = storage.mounted();
    status_.available = ready;
    if (!ready) {
        status_.pending_count = 0;
        status_.last_error = "SD 不可用";
        return;
    }
    const std::string outbox = OutboxPath();
    mkdir(outbox.c_str(), 0755);
    status_.pending_count = CountOutbox(outbox);
    status_.last_error = "同步队列在线";
}

bool AppSyncQueue::AddActionEvent(const std::string& action, const std::string& params_json) {
    cJSON* payload = cJSON_CreateObject();
    cJSON_AddStringToObject(payload, "action", action.c_str());
    cJSON* params = cJSON_Parse(params_json.empty() ? "{}" : params_json.c_str());
    if (params != nullptr) {
        cJSON_AddItemToObject(payload, "params", params);
    } else {
        cJSON_AddStringToObject(payload, "paramsRaw", params_json.c_str());
    }
    const std::string payload_json = JsonPrint(payload);
    cJSON_Delete(payload);
    return AddEvent("backend.action.offline", payload_json);
}

bool AppSyncQueue::AddEvent(const std::string& type, const std::string& payload_json) {
    auto& storage = AppStorageManager::GetInstance();
    std::lock_guard<std::recursive_mutex> fs_lock(storage.filesystem_mutex());
    Refresh();
    if (!status_.available) {
        return false;
    }
    if (status_.pending_count >= kMaxOutboxEvents) {
        status_.last_error = "outbox 已满";
        ESP_LOGW(TAG, "%s: %d", status_.last_error.c_str(), status_.pending_count);
        return false;
    }

    const std::string path = MakeEventPath();
    cJSON* root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "schema", 1);
    cJSON_AddStringToObject(root, "id", path.c_str());
    cJSON_AddStringToObject(root, "type", type.c_str());
    cJSON_AddStringToObject(root, "createdAt", std::to_string(static_cast<long long>(time(nullptr))).c_str());
    cJSON* payload = cJSON_Parse(payload_json.empty() ? "{}" : payload_json.c_str());
    if (payload != nullptr) {
        cJSON_AddItemToObject(root, "payload", payload);
    } else {
        cJSON_AddStringToObject(root, "payloadRaw", payload_json.c_str());
    }
    const std::string json = JsonPrint(root);
    cJSON_Delete(root);

    FILE* file = std::fopen(path.c_str(), "w");
    if (file == nullptr) {
        status_.last_error = "写入 outbox 失败";
        ESP_LOGW(TAG, "%s: %s", status_.last_error.c_str(), path.c_str());
        return false;
    }
    const bool write_ok =
        std::fwrite(json.data(), 1, json.size(), file) == json.size() && std::fwrite("\n", 1, 1, file) == 1;
    std::fclose(file);
    if (!write_ok) {
        unlink(path.c_str());
        status_.last_error = "写入 outbox 不完整";
        ESP_LOGW(TAG, "%s: %s", status_.last_error.c_str(), path.c_str());
        return false;
    }
    Refresh();
    return true;
}

bool AppSyncQueue::FlushPending() {
    auto& storage = AppStorageManager::GetInstance();
    std::lock_guard<std::recursive_mutex> fs_lock(storage.filesystem_mutex());
    Refresh();
    if (!status_.available || status_.pending_count == 0) {
        return true;
    }

    std::string file_paths[kMaxFlushEvents];
    int loaded_count = 0;
    const std::string batch = BuildBatchJson(kMaxFlushEvents, loaded_count, file_paths, kMaxFlushEvents);
    if (loaded_count == 0) {
        return true;
    }

    if (!AppBackendClient::GetInstance().PostSyncEvents(batch)) {
        status_.last_error = "同步上传失败";
        return false;
    }

    for (int i = 0; i < loaded_count; ++i) {
        unlink(file_paths[i].c_str());
    }
    status_.last_pushed_count = loaded_count;
    Refresh();
    return true;
}

std::string AppSyncQueue::StatusLine() const {
    if (!status_.available) {
        return status_.last_error;
    }
    return "待同步 " + std::to_string(status_.pending_count);
}

std::string AppSyncQueue::OutboxPath() const {
    return AppStorageManager::GetInstance().status().mount_point + "/outbox";
}

std::string AppSyncQueue::MakeEventPath() const {
    static uint32_t counter = 0;
    counter++;
    return OutboxPath() + "/evt_" + std::to_string(static_cast<long long>(time(nullptr))) + "_" +
           std::to_string(counter) + ".json";
}

std::string AppSyncQueue::BuildBatchJson(int max_events, int& loaded_count, std::string file_paths[],
                                         int max_paths) const {
    loaded_count = 0;
    cJSON* root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "schema", 1);
    cJSON_AddStringToObject(root, "deviceId", Board::GetInstance().GetUuid().c_str());
    cJSON* events = cJSON_AddArrayToObject(root, "events");

    DIR* dir = opendir(OutboxPath().c_str());
    if (dir != nullptr) {
        while (auto* entry = readdir(dir)) {
            if (loaded_count >= max_events || loaded_count >= max_paths) {
                break;
            }
            if (entry->d_name[0] == '.') {
                continue;
            }
            const std::string path = OutboxPath() + "/" + entry->d_name;
            FILE* file = std::fopen(path.c_str(), "r");
            if (file == nullptr) {
                continue;
            }
            char buffer[1536] = {};
            const size_t read = std::fread(buffer, 1, sizeof(buffer) - 1, file);
            std::fclose(file);
            buffer[read] = '\0';
            cJSON* event = cJSON_Parse(buffer);
            if (event == nullptr) {
                continue;
            }
            cJSON_AddItemToArray(events, event);
            file_paths[loaded_count] = path;
            loaded_count++;
        }
        closedir(dir);
    }

    const std::string json = JsonPrint(root);
    cJSON_Delete(root);
    return json;
}
