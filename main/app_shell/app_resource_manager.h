#ifndef APP_RESOURCE_MANAGER_H_
#define APP_RESOURCE_MANAGER_H_

#include <string>

struct AppResourceStatus {
    bool ready = false;
    std::string version = "--";
    std::string device_profile = "--";
    int music_count = 0;
    int image_count = 0;
    int downloaded_count = 0;
    std::string last_error = "资源未初始化";
};

class AppResourceManager {
public:
    static AppResourceManager& GetInstance();

    void Initialize();
    void Refresh();
    bool UpdateFromBackendManifest();
    const AppResourceStatus& status() const { return status_; }
    std::string StatusLine() const;
    std::string Resolve(const std::string& relative_path) const;

private:
    AppResourceManager() = default;

    AppResourceStatus status_;
};

#endif
