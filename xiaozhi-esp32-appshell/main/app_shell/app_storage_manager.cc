#include "app_storage_manager.h"

#include "assets/lang_config.h"
#include "config.h"

#include <cJSON.h>
#include <dirent.h>
#include <esp_log.h>
#include <esp_vfs_fat.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <sdmmc_cmd.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <mutex>

#if __has_include(<driver/sdmmc_host.h>)
#include <driver/sdmmc_host.h>
#else
#include <sdmmc_host.h>
#endif

namespace {
constexpr const char* TAG = "AppStorage";
constexpr int kMaxListedFiles = 32;
constexpr int kSampleImageWidth = 192;
constexpr int kSampleImageHeight = 104;

#ifndef SDCARD_MOUNT_POINT
#define SDCARD_MOUNT_POINT "/sdcard"
#endif
#ifndef SDCARD_SDMMC_CLK_PIN
#define SDCARD_SDMMC_CLK_PIN GPIO_NUM_14
#endif
#ifndef SDCARD_SDMMC_CMD_PIN
#define SDCARD_SDMMC_CMD_PIN GPIO_NUM_17
#endif
#ifndef SDCARD_SDMMC_D0_PIN
#define SDCARD_SDMMC_D0_PIN GPIO_NUM_16
#endif
#ifndef SDCARD_SDMMC_D1_PIN
#define SDCARD_SDMMC_D1_PIN GPIO_NUM_17
#endif
#ifndef SDCARD_SDMMC_D2_PIN
#define SDCARD_SDMMC_D2_PIN GPIO_NUM_12
#endif
#ifndef SDCARD_SDMMC_D3_PIN
#define SDCARD_SDMMC_D3_PIN GPIO_NUM_13
#endif
#ifndef SDCARD_SDMMC_BUS_WIDTH
#define SDCARD_SDMMC_BUS_WIDTH 1
#endif
#ifndef APPSHELL_SD_FORMAT_ON_MOUNT_FAILED
#define APPSHELL_SD_FORMAT_ON_MOUNT_FAILED 0
#endif
#ifndef APPSHELL_SD_RECOVERY_BUILD
#define APPSHELL_SD_RECOVERY_BUILD 0
#endif

#if SDCARD_SDMMC_BUS_WIDTH != 1 && SDCARD_SDMMC_BUS_WIDTH != 4
#error "SDCARD_SDMMC_BUS_WIDTH must be 1 or 4"
#endif

#if APPSHELL_SD_FORMAT_ON_MOUNT_FAILED && !APPSHELL_SD_RECOVERY_BUILD
#error "APPSHELL_SD_FORMAT_ON_MOUNT_FAILED requires APPSHELL_SD_RECOVERY_BUILD=1"
#endif

bool EndsWithAny(const std::string& value, const char* const* extensions, size_t count) {
    std::string lower = value;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    for (size_t i = 0; i < count; ++i) {
        const std::string ext = extensions[i];
        if (lower.size() >= ext.size() && lower.compare(lower.size() - ext.size(), ext.size(), ext) == 0) {
            return true;
        }
    }
    return false;
}

std::string JsonString(cJSON* object, const char* key, const std::string& fallback = "--") {
    auto item = cJSON_GetObjectItem(object, key);
    if (cJSON_IsString(item) && item->valuestring != nullptr) {
        return item->valuestring;
    }
    return fallback;
}

void EnsureDir(const char* path) {
    if (mkdir(path, 0755) != 0 && errno != EEXIST) {
        ESP_LOGW(TAG, "mkdir %s failed: %d", path, errno);
    }
}

void ScanTypedFiles(const std::string& path, const char* const* extensions, size_t extension_count,
                    std::vector<std::string>& output) {
    output.clear();
    DIR* dir = opendir(path.c_str());
    if (dir == nullptr) {
        return;
    }

    while (auto* entry = readdir(dir)) {
        if (entry->d_name[0] == '.') {
            continue;
        }
        const std::string name = entry->d_name;
        if (!EndsWithAny(name, extensions, extension_count)) {
            continue;
        }
        output.push_back(path + "/" + name);
        if (output.size() >= kMaxListedFiles) {
            break;
        }
    }
    closedir(dir);
}
} // namespace

AppStorageManager& AppStorageManager::GetInstance() {
    static AppStorageManager instance;
    return instance;
}

void AppStorageManager::Initialize() {
    if (status_.initialized) {
        return;
    }
    status_.initialized = true;
    status_.mount_point = SDCARD_MOUNT_POINT;

    if (!Mount()) {
        return;
    }
    Refresh();
}

void AppStorageManager::Refresh() {
    std::lock_guard<std::recursive_mutex> lock(filesystem_mutex_);
    if (!status_.mounted) {
        return;
    }
    EnsureDirectories();
    EnsureSampleResources();
    ReadCapacity();
    ReadManifest();
    ScanResources();
    status_.outbox_count = CountFiles(status_.mount_point + "/outbox");
}

bool AppStorageManager::Mount() {
    esp_vfs_fat_sdmmc_mount_config_t mount_config = {
        .format_if_mount_failed = APPSHELL_SD_FORMAT_ON_MOUNT_FAILED,
        .max_files = 8,
        .allocation_unit_size = 16 * 1024,
        .disk_status_check_enable = false,
    };

    sdmmc_host_t host = SDMMC_HOST_DEFAULT();
    host.max_freq_khz = SDMMC_FREQ_DEFAULT;

    sdmmc_slot_config_t slot_config = SDMMC_SLOT_CONFIG_DEFAULT();
    slot_config.width = SDCARD_SDMMC_BUS_WIDTH;
    slot_config.clk = SDCARD_SDMMC_CLK_PIN;
    slot_config.cmd = SDCARD_SDMMC_CMD_PIN;
    slot_config.d0 = SDCARD_SDMMC_D0_PIN;
#if SDCARD_SDMMC_BUS_WIDTH == 4
    slot_config.d1 = SDCARD_SDMMC_D1_PIN;
    slot_config.d2 = SDCARD_SDMMC_D2_PIN;
    slot_config.d3 = SDCARD_SDMMC_D3_PIN;
#endif
    slot_config.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;

    ESP_LOGI(TAG, "Mount SD: width=%d format_if_failed=%d recovery_build=%d CLK=%d CMD=%d D0=%d",
             SDCARD_SDMMC_BUS_WIDTH, APPSHELL_SD_FORMAT_ON_MOUNT_FAILED,
             APPSHELL_SD_RECOVERY_BUILD, static_cast<int>(SDCARD_SDMMC_CLK_PIN),
             static_cast<int>(SDCARD_SDMMC_CMD_PIN), static_cast<int>(SDCARD_SDMMC_D0_PIN));
#if SDCARD_SDMMC_BUS_WIDTH == 4
    ESP_LOGI(TAG, "Mount SD 4-bit extra pins: D1=%d D2=%d D3=%d",
             static_cast<int>(SDCARD_SDMMC_D1_PIN), static_cast<int>(SDCARD_SDMMC_D2_PIN),
             static_cast<int>(SDCARD_SDMMC_D3_PIN));
#endif

    sdmmc_card_t* card = nullptr;
    esp_err_t err = ESP_FAIL;
    constexpr int kMountAttempts = 3;
    for (int attempt = 1; attempt <= kMountAttempts; ++attempt) {
        card = nullptr;
        err = esp_vfs_fat_sdmmc_mount(status_.mount_point.c_str(), &host, &slot_config, &mount_config, &card);
        if (err == ESP_OK) {
            break;
        }
        ESP_LOGW(TAG, "SD mount attempt %d/%d failed: %s", attempt, kMountAttempts, esp_err_to_name(err));
        if (host.deinit != nullptr) {
            host.deinit();
        }
        if (attempt < kMountAttempts) {
            vTaskDelay(pdMS_TO_TICKS(300));
        }
    }
    if (err != ESP_OK) {
        status_.mounted = false;
        if (err == ESP_FAIL) {
            status_.last_error = "SD 文件系统不可挂载";
        } else {
            status_.last_error = "SD 挂载失败 " + std::string(esp_err_to_name(err));
        }
        ESP_LOGW(TAG, "%s", status_.last_error.c_str());
        ESP_LOGW(TAG, "If vfs_fat_sdmmc reports code 13, the card is usually not FAT/FAT32 or has no valid filesystem.");
        return false;
    }

    card_ = card;
    status_.mounted = true;
    status_.last_error = "SD 在线";
    sdmmc_card_print_info(stdout, card);
    return true;
}

void AppStorageManager::EnsureDirectories() {
    EnsureDir((status_.mount_point + "/icons").c_str());
    EnsureDir((status_.mount_point + "/images").c_str());
    EnsureDir((status_.mount_point + "/animations").c_str());
    EnsureDir((status_.mount_point + "/fonts").c_str());
    EnsureDir((status_.mount_point + "/music").c_str());
    EnsureDir((status_.mount_point + "/music/local").c_str());
    EnsureDir((status_.mount_point + "/music/cache").c_str());
    EnsureDir((status_.mount_point + "/courses").c_str());
    EnsureDir((status_.mount_point + "/games").c_str());
    EnsureDir((status_.mount_point + "/cache").c_str());
    EnsureDir((status_.mount_point + "/logs").c_str());
    EnsureDir((status_.mount_point + "/outbox").c_str());
}

void AppStorageManager::EnsureSampleResources() {
    const std::string image_dir = status_.mount_point + "/images";
    if (CountFiles(image_dir) == 0) {
        const std::string path = image_dir + "/sample.rgb565.bin";
        FILE* file = std::fopen(path.c_str(), "wb");
        if (file == nullptr) {
            ESP_LOGW(TAG, "create sample image failed: %s", path.c_str());
        } else {
            std::vector<uint16_t> line(kSampleImageWidth);
            for (int y = 0; y < kSampleImageHeight; ++y) {
                for (int x = 0; x < kSampleImageWidth; ++x) {
                    const uint8_t r = static_cast<uint8_t>(20 + x * 160 / kSampleImageWidth);
                    const uint8_t g = static_cast<uint8_t>(40 + y * 140 / kSampleImageHeight);
                    const uint8_t b = static_cast<uint8_t>(140 + (x + y) * 70 / (kSampleImageWidth + kSampleImageHeight));
                    line[x] = static_cast<uint16_t>(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3));
                }
                if (std::fwrite(line.data(), sizeof(uint16_t), line.size(), file) != line.size()) {
                    std::fclose(file);
                    unlink(path.c_str());
                    ESP_LOGW(TAG, "sample image write incomplete: %s", path.c_str());
                    file = nullptr;
                    break;
                }
            }
            if (file != nullptr) {
                std::fclose(file);
                ESP_LOGI(TAG, "created sample image: %s", path.c_str());
            }
        }
    }

    const std::string music_dir = status_.mount_point + "/music/local";
    if (CountFiles(music_dir) == 0 && !Lang::Sounds::OGG_SUCCESS.empty()) {
        const std::string path = music_dir + "/sample-success.ogg";
        FILE* file = std::fopen(path.c_str(), "wb");
        if (file == nullptr) {
            ESP_LOGW(TAG, "create sample music failed: %s", path.c_str());
            return;
        }
        const size_t written = std::fwrite(Lang::Sounds::OGG_SUCCESS.data(), 1, Lang::Sounds::OGG_SUCCESS.size(), file);
        std::fclose(file);
        if (written != Lang::Sounds::OGG_SUCCESS.size()) {
            unlink(path.c_str());
            ESP_LOGW(TAG, "sample music write incomplete: %s", path.c_str());
            return;
        }
        ESP_LOGI(TAG, "created sample music: %s", path.c_str());
    }
}

void AppStorageManager::ReadCapacity() {
    auto* card = static_cast<sdmmc_card_t*>(card_);
    if (card == nullptr || card->csd.capacity <= 0 || card->csd.sector_size <= 0) {
        status_.total_kb = 0;
        status_.free_kb = 0;
        return;
    }
    status_.total_kb = static_cast<uint64_t>(card->csd.capacity) * card->csd.sector_size / 1024;
    status_.free_kb = 0;
}

void AppStorageManager::ReadManifest() {
    const std::string path = status_.mount_point + "/manifest.json";
    FILE* file = std::fopen(path.c_str(), "r");
    if (file == nullptr) {
        status_.manifest_version = "未发现";
        status_.device_profile = "--";
        return;
    }

    char buffer[2048] = {};
    const size_t read = std::fread(buffer, 1, sizeof(buffer) - 1, file);
    std::fclose(file);
    buffer[read] = '\0';

    cJSON* root = cJSON_Parse(buffer);
    if (root == nullptr) {
        status_.manifest_version = "manifest 无效";
        status_.device_profile = "--";
        return;
    }
    status_.manifest_version = JsonString(root, "version", "未标记");
    status_.device_profile = JsonString(root, "deviceProfile", "--");
    cJSON_Delete(root);
}

void AppStorageManager::ScanResources() {
    static const char* kMusicExt[] = {".mp3", ".opus", ".ogg", ".wav", ".m4a"};
    static const char* kImageExt[] = {".jpg", ".jpeg", ".png", ".bmp", ".bin"};
    ScanTypedFiles(status_.mount_point + "/music/local", kMusicExt, sizeof(kMusicExt) / sizeof(kMusicExt[0]), music_files_);
    ScanTypedFiles(status_.mount_point + "/images", kImageExt, sizeof(kImageExt) / sizeof(kImageExt[0]), image_files_);
    status_.music_count = static_cast<int>(music_files_.size());
    status_.image_count = static_cast<int>(image_files_.size());
}

int AppStorageManager::CountFiles(const std::string& path) const {
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

std::string AppStorageManager::StatusLine() const {
    if (!status_.mounted) {
        return status_.last_error;
    }
    if (status_.total_kb > 0) {
        return "SD 在线 " + std::to_string(status_.total_kb / 1024) + "MB";
    }
    return "SD 在线";
}

std::string AppStorageManager::ResourceLine() const {
    if (!status_.mounted) {
        return "资源离线";
    }
    return "v" + status_.manifest_version + " 音乐" + std::to_string(status_.music_count) + " 图" +
           std::to_string(status_.image_count);
}
