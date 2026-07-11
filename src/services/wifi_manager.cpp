#include "services/wifi_manager.h"

#include <cstring>

#include <WiFi.h>

#include "app_config.h"

bool WifiManager::begin() {
  if (!hasCredentials()) {
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 12000) {
    delay(250);
  }
  return connected();
}

bool WifiManager::connected() const {
  return WiFi.status() == WL_CONNECTED;
}

String WifiManager::statusText() const {
  if (!hasCredentials()) {
    return "未配置 WiFi";
  }
  if (!connected()) {
    return "WiFi 未连接";
  }
  return WiFi.localIP().toString();
}

void WifiManager::ensureConnected() {
  if (!hasCredentials() || connected()) {
    return;
  }

  const uint32_t now = millis();
  if (now - lastReconnectAttemptMs_ < 15000) {
    return;
  }
  lastReconnectAttemptMs_ = now;
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool WifiManager::hasCredentials() const {
  return strlen(WIFI_SSID) > 0;
}
