#include "app_resource_manager.h"

#include "app_backend_client.h"
#include "app_storage_manager.h"

#include <cJSON.h>
#include <esp_log.h>
#include <mbedtls/sha256.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <mutex>

namespace {
constexpr const char* TAG = "AppResource";
constexpr const char* kSdPrefix = "/sdcard/";
constexpr size_t kMaxResourceBytes = 2 * 1024 * 1024;

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

bool IsSafeRelativePath(const std::string& path) {
    return !path.empty() && path[0] != '/' && path.find("..") == std::string::npos;
}

std::string EncodeUrlPath(const std::string& path) {
    static constexpr char kHex[] = "0123456789ABCDEF";
    std::string encoded;
    encoded.reserve(path.size());
    for (const unsigned char ch : path) {
        const bool unreserved =
            (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
            (ch >= '0' && ch <= '9') || ch == '-' || ch == '.' ||
            ch == '_' || ch == '~';
        if (unreserved || ch == '/') {
            encoded.push_back(static_cast<char>(ch));
        } else {
            encoded.push_back('%');
            encoded.push_back(kHex[(ch >> 4) & 0x0f]);
            encoded.push_back(kHex[ch & 0x0f]);
        }
    }
    return encoded;
}

void EnsureParentDirs(const std::string& file_path) {
    size_t slash = file_path.find('/', 1);
    while (slash != std::string::npos) {
        const std::string dir = file_path.substr(0, slash);
        mkdir(dir.c_str(), 0755);
        slash = file_path.find('/', slash + 1);
    }
}

std::string HexDigest(const unsigned char digest[32]) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex;
    hex.resize(64);
    for (int i = 0; i < 32; ++i) {
        hex[i * 2] = kHex[(digest[i] >> 4) & 0x0f];
        hex[i * 2 + 1] = kHex[digest[i] & 0x0f];
    }
    return hex;
}

bool FileSha256(const std::string& path, std::string& hex) {
    FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        return false;
    }
    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    bool ok = mbedtls_sha256_starts(&sha, 0) == 0;
    unsigned char buffer[1024];
    while (ok) {
        const size_t read = std::fread(buffer, 1, sizeof(buffer), file);
        if (read > 0 && mbedtls_sha256_update(&sha, buffer, read) != 0) {
            ok = false;
            break;
        }
        if (read < sizeof(buffer)) {
            break;
        }
    }
    if (ok) {
        unsigned char digest[32] = {};
        ok = mbedtls_sha256_finish(&sha, digest) == 0;
        if (ok) {
            hex = HexDigest(digest);
        }
    }
    mbedtls_sha256_free(&sha);
    std::fclose(file);
    return ok;
}
} // namespace

AppResourceManager& AppResourceManager::GetInstance() {
    static AppResourceManager instance;
    return instance;
}

void AppResourceManager::Initialize() {
    Refresh();
}

void AppResourceManager::Refresh() {
    auto& storage = AppStorageManager::GetInstance();
    storage.Refresh();
    const auto& storage_status = storage.status();
    status_.ready = storage_status.mounted;
    status_.version = storage_status.manifest_version;
    status_.device_profile = storage_status.device_profile;
    status_.music_count = storage_status.music_count;
    status_.image_count = storage_status.image_count;
    status_.last_error = storage_status.mounted ? "资源在线" : storage_status.last_error;
}

std::string AppResourceManager::StatusLine() const {
    if (!status_.ready) {
        return status_.last_error;
    }
    return "v" + status_.version + " 音乐" + std::to_string(status_.music_count) + " 图" +
           std::to_string(status_.image_count) + " 下" + std::to_string(status_.downloaded_count);
}

std::string AppResourceManager::Resolve(const std::string& relative_path) const {
    if (relative_path.empty()) {
        return "";
    }
    if (relative_path[0] == '/') {
        return relative_path;
    }
    return std::string(kSdPrefix) + relative_path;
}

bool AppResourceManager::UpdateFromBackendManifest() {
    auto& storage = AppStorageManager::GetInstance();
    if (!storage.mounted()) {
        status_.last_error = "SD 不可用";
        return false;
    }

    std::string body;
    std::string error;
    if (!AppBackendClient::GetInstance().FetchResourceManifest(body, error)) {
        status_.last_error = "manifest 拉取失败";
        return false;
    }

    cJSON* root = cJSON_Parse(body.c_str());
    if (root == nullptr) {
        status_.last_error = "manifest JSON 无效";
        return false;
    }
    cJSON* data = cJSON_GetObjectItem(root, "data");
    if (!cJSON_IsObject(data)) {
        data = root;
    }

    const std::string profile = JsonString(data, "deviceProfile");
    if (!profile.empty() && profile.find("1.85b") == std::string::npos) {
        cJSON_Delete(root);
        status_.last_error = "manifest 设备不匹配";
        return false;
    }

    cJSON* packs = cJSON_GetObjectItem(data, "packs");
    if (!cJSON_IsArray(packs)) {
        cJSON_Delete(root);
        status_.last_error = "manifest 缺少 packs";
        return false;
    }

    std::lock_guard<std::recursive_mutex> fs_lock(storage.filesystem_mutex());
    int downloaded = 0;
    int checked = 0;
    const int pack_count = cJSON_GetArraySize(packs);
    for (int i = 0; i < pack_count; ++i) {
        cJSON* pack = cJSON_GetArrayItem(packs, i);
        cJSON* files = cJSON_IsObject(pack) ? cJSON_GetObjectItem(pack, "files") : nullptr;
        if (!cJSON_IsArray(files)) {
            continue;
        }
        const int file_count = cJSON_GetArraySize(files);
        for (int j = 0; j < file_count && checked < 32; ++j) {
            cJSON* item = cJSON_GetArrayItem(files, j);
            if (!cJSON_IsObject(item)) {
                continue;
            }
            const std::string relative = JsonString(item, "path");
            const std::string expected_sha = JsonString(item, "sha256");
            const int size = JsonInt(item, "size", 0);
            if (!IsSafeRelativePath(relative) || expected_sha.size() != 64 || size <= 0 ||
                static_cast<size_t>(size) > kMaxResourceBytes) {
                continue;
            }
            checked++;

            const std::string target = storage.status().mount_point + "/" + relative;
            std::string current_sha;
            if (FileSha256(target, current_sha) && current_sha == expected_sha) {
                continue;
            }

            EnsureParentDirs(target);
            const std::string tmp = storage.status().mount_point + "/cache/resource.tmp";
            unlink(tmp.c_str());
            // The manifest was fetched from the configured Family Hub. Keep
            // resource traffic on that same LAN origin instead of following a
            // public HTTPS baseUrl that this embedded client cannot verify.
            const std::string url = "/api/resources/file/" + EncodeUrlPath(relative);
            std::string actual_sha;
            if (!AppBackendClient::GetInstance().DownloadToFile(url, tmp, kMaxResourceBytes, actual_sha, error)) {
                unlink(tmp.c_str());
                ESP_LOGW(TAG, "download resource failed: %s", relative.c_str());
                continue;
            }
            if (actual_sha != expected_sha) {
                unlink(tmp.c_str());
                ESP_LOGW(TAG, "sha mismatch: %s", relative.c_str());
                continue;
            }
            unlink(target.c_str());
            if (rename(tmp.c_str(), target.c_str()) == 0) {
                downloaded++;
            } else {
                unlink(tmp.c_str());
                ESP_LOGW(TAG, "rename resource failed: %s", target.c_str());
            }
        }
    }

    const std::string manifest_path = storage.status().mount_point + "/manifest.json";
    const std::string manifest_tmp_path = storage.status().mount_point + "/cache/manifest.tmp";
    unlink(manifest_tmp_path.c_str());
    FILE* manifest = std::fopen(manifest_tmp_path.c_str(), "w");
    if (manifest != nullptr) {
        char* manifest_json = cJSON_PrintUnformatted(data);
        const std::string manifest_body = manifest_json == nullptr ? body : std::string(manifest_json);
        if (manifest_json != nullptr) {
            cJSON_free(manifest_json);
        }
        const bool write_ok =
            std::fwrite(manifest_body.data(), 1, manifest_body.size(), manifest) == manifest_body.size() &&
            std::fwrite("\n", 1, 1, manifest) == 1;
        std::fclose(manifest);
        if (write_ok) {
            unlink(manifest_path.c_str());
            if (rename(manifest_tmp_path.c_str(), manifest_path.c_str()) != 0) {
                unlink(manifest_tmp_path.c_str());
                ESP_LOGW(TAG, "rename manifest failed: %s", manifest_path.c_str());
            }
        } else {
            unlink(manifest_tmp_path.c_str());
            ESP_LOGW(TAG, "manifest write incomplete: %s", manifest_path.c_str());
        }
    }
    cJSON_Delete(root);

    const int total_downloaded = status_.downloaded_count + downloaded;
    const std::string update_message = downloaded > 0 ? ("下载 " + std::to_string(downloaded) + " 项") : "资源已是最新";
    Refresh();
    status_.downloaded_count = total_downloaded;
    status_.last_error = update_message;
    return true;
}
