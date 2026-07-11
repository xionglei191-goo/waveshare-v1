#include <Arduino.h>
#include <Wire.h>
#include <time.h>

#include "app_config.h"
#include "board/board_config.h"
#include "drivers/display.h"
#include "drivers/io_expander.h"
#include "drivers/lvgl_port.h"
#include "drivers/touch.h"
#include "services/api_client.h"
#include "services/wifi_manager.h"
#include "ui/app_ui.h"

namespace {

IoExpander ioExpander(Wire, board::IoExpanderAddress);
DisplayDriver display(ioExpander);
TouchDriver touch(Wire, ioExpander);
LvglPort lvglPort;
WifiManager wifiManager;
ApiClient apiClient;
AppUi appUi(apiClient, wifiManager);

uint32_t lastClockUpdateMs = 0;
uint32_t lastWifiCheckMs = 0;
uint32_t lastLvTickMs = 0;

void syncTimeIfOnline() {
  if (!wifiManager.connected()) {
    return;
  }
  configTzTime("CST-8", "ntp.aliyun.com", "pool.ntp.org", "time.nist.gov");
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Waveshare ESP32-S3 1.85 LVGL app");

  Wire.begin(board::InternalI2cSda, board::InternalI2cScl, board::I2cFrequency);
  if constexpr (board::UseIoExpander) {
    if (!ioExpander.begin()) {
      Serial.println("TCA9554 init failed");
    }
  }

  if (!display.begin()) {
    Serial.println("Display init failed");
  }

  if (!touch.begin()) {
    Serial.println("Touch init failed");
  }

  lvglPort.begin(display, touch);
  appUi.begin();
  appUi.setStatus("WiFi 连接中");
  lv_timer_handler();

  if (wifiManager.begin()) {
    syncTimeIfOnline();
    appUi.setStatus("WiFi " + wifiManager.statusText());
  } else {
    appUi.setStatus(wifiManager.statusText());
  }
}

void loop() {
  const uint32_t now = millis();

  while (lastLvTickMs != now) {
    lvglPort.tick();
    ++lastLvTickMs;
  }

  if (now - lastClockUpdateMs >= 1000) {
    lastClockUpdateMs = now;
    appUi.updateClock();
  }

  if (now - lastWifiCheckMs >= 5000) {
    lastWifiCheckMs = now;
    wifiManager.ensureConnected();
  }

  lvglPort.loop();
  delay(5);
}
