#ifndef APP_CONNECTIVITY_MANAGER_H_
#define APP_CONNECTIVITY_MANAGER_H_

#include <string>
#include <vector>

enum class AppConnectivityProviderKind {
    kWifi,
    kBleProxy,
    kUsb,
    kFutureCellular,
};

struct AppConnectivityProviderStatus {
    AppConnectivityProviderKind kind = AppConnectivityProviderKind::kWifi;
    std::string name = "wifi";
    bool available = false;
    bool active = false;
    std::string detail = "未启用";
};

struct AppConnectivityStatus {
    bool online = false;
    std::string provider = "offline";
    std::string detail = "网络未连接";
};

class AppConnectivityManager {
public:
    static AppConnectivityManager& GetInstance();

    void Refresh();
    const AppConnectivityStatus& status() const { return status_; }
    const std::vector<AppConnectivityProviderStatus>& providers() const { return providers_; }
    std::string StatusLine() const;
    std::string ProvidersLine() const;

private:
    AppConnectivityManager() = default;

    AppConnectivityStatus status_;
    std::vector<AppConnectivityProviderStatus> providers_;
};

#endif
