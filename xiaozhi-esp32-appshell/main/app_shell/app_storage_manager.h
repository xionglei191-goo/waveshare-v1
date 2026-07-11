#ifndef APP_STORAGE_MANAGER_H_
#define APP_STORAGE_MANAGER_H_

#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

struct AppStorageStatus {
    bool initialized = false;
    bool mounted = false;
    std::string mount_point = "/sdcard";
    std::string last_error = "SD 未初始化";
    std::string manifest_version = "--";
    std::string device_profile = "--";
    uint64_t total_kb = 0;
    uint64_t free_kb = 0;
    int music_count = 0;
    int image_count = 0;
    int outbox_count = 0;
};

class AppStorageManager {
public:
    static AppStorageManager& GetInstance();

    void Initialize();
    void Refresh();
    const AppStorageStatus& status() const { return status_; }
    const std::vector<std::string>& music_files() const { return music_files_; }
    const std::vector<std::string>& image_files() const { return image_files_; }
    bool mounted() const { return status_.mounted; }
    std::recursive_mutex& filesystem_mutex() { return filesystem_mutex_; }
    std::string StatusLine() const;
    std::string ResourceLine() const;

private:
    AppStorageManager() = default;

    bool Mount();
    void EnsureDirectories();
    void EnsureSampleResources();
    void ReadCapacity();
    void ReadManifest();
    void ScanResources();
    int CountFiles(const std::string& path) const;

    AppStorageStatus status_;
    std::vector<std::string> music_files_;
    std::vector<std::string> image_files_;
    std::recursive_mutex filesystem_mutex_;
    void* card_ = nullptr;
};

#endif
