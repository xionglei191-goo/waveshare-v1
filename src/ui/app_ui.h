#pragma once

#include <Arduino.h>
#include <lvgl.h>

#include "services/api_client.h"
#include "services/wifi_manager.h"

class AppUi {
 public:
  AppUi(ApiClient &apiClient, WifiManager &wifiManager);

  void begin();
  void updateClock();
  void setStatus(const String &status);
  void handleAction(AppAction action);

 private:
  static void onButtonEvent(lv_event_t *event);

  void createButton(AppAction action, const char *text, int16_t y, lv_color_t color);
  void applyLabelFont(lv_obj_t *label);

  ApiClient &apiClient_;
  WifiManager &wifiManager_;
  lv_obj_t *timeLabel_ = nullptr;
  lv_obj_t *dateLabel_ = nullptr;
  lv_obj_t *statusLabel_ = nullptr;
};

