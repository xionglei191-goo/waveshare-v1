#include "app_connectivity_manager.h"

#include "sdkconfig.h"

#include <wifi_manager.h>

namespace {
AppConnectivityProviderStatus Provider(AppConnectivityProviderKind kind, const char* name, bool available,
                                       bool active, const char* detail) {
    AppConnectivityProviderStatus status;
    status.kind = kind;
    status.name = name;
    status.available = available;
    status.active = active;
    status.detail = detail;
    return status;
}
} // namespace

AppConnectivityManager& AppConnectivityManager::GetInstance() {
    static AppConnectivityManager instance;
    return instance;
}

void AppConnectivityManager::Refresh() {
    auto& wifi = WifiManager::GetInstance();
    const bool wifi_online = wifi.IsInitialized() && wifi.IsConnected();
    providers_.clear();
    providers_.push_back(Provider(AppConnectivityProviderKind::kWifi, "wifi", wifi.IsInitialized(), wifi_online,
                                  wifi_online ? "Wi-Fi 在线" : "Wi-Fi 未连接"));
#if CONFIG_USE_ESP_BLUFI_WIFI_PROVISIONING
    providers_.push_back(Provider(AppConnectivityProviderKind::kBleProxy, "ble", true,
                                  !wifi_online && wifi.IsInitialized(), "BluFi: Xiaozhi-Blufi"));
#else
    providers_.push_back(Provider(AppConnectivityProviderKind::kBleProxy, "ble", false, false, "BLE 配网未启用"));
#endif
    providers_.push_back(Provider(AppConnectivityProviderKind::kUsb, "usb", false, false, "USB 导入/诊断预留"));
    providers_.push_back(Provider(AppConnectivityProviderKind::kFutureCellular, "cellular", false, false,
                                  "4G/eSIM 预留"));

    if (wifi_online) {
        status_.online = true;
        status_.provider = "wifi";
        status_.detail = "Wi-Fi 在线";
        return;
    }
    status_.online = false;
    status_.provider = "offline";
    status_.detail = "网络未连接";
}

std::string AppConnectivityManager::StatusLine() const {
    return status_.provider + " " + status_.detail;
}

std::string AppConnectivityManager::ProvidersLine() const {
    std::string line;
    for (const auto& provider : providers_) {
        if (!line.empty()) {
            line += "/";
        }
        line += provider.active ? ("*" + provider.name) : provider.name;
        if (provider.kind == AppConnectivityProviderKind::kBleProxy && provider.available) {
            line += ":Xiaozhi-Blufi";
        }
    }
    return line.empty() ? "provider 未初始化" : line;
}
