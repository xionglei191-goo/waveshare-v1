#include "ui/app_ui.h"

#include <cstdio>
#include <time.h>

#include "board/board_config.h"

namespace {

const char *weekdayName(int day) {
  static const char *names[] = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};
  if (day < 0 || day > 6) {
    return "";
  }
  return names[day];
}

}  // namespace

AppUi::AppUi(ApiClient &apiClient, WifiManager &wifiManager)
    : apiClient_(apiClient), wifiManager_(wifiManager) {}

void AppUi::begin() {
  lv_obj_t *screen = lv_scr_act();
  lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(screen, lv_color_hex(0x061015), 0);
  lv_obj_set_style_bg_grad_color(screen, lv_color_hex(0x14221A), 0);
  lv_obj_set_style_bg_grad_dir(screen, LV_GRAD_DIR_VER, 0);

  lv_obj_t *ring = lv_obj_create(screen);
  lv_obj_remove_style_all(ring);
  lv_obj_set_size(ring, board::ScreenWidth - 18, board::ScreenHeight - 18);
  lv_obj_align(ring, LV_ALIGN_CENTER, 0, 0);
  lv_obj_set_style_radius(ring, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_width(ring, 2, 0);
  lv_obj_set_style_border_color(ring, lv_color_hex(0x31545B), 0);
  lv_obj_clear_flag(ring, LV_OBJ_FLAG_CLICKABLE);

  timeLabel_ = lv_label_create(screen);
  lv_obj_set_style_text_font(timeLabel_, &lv_font_montserrat_48, 0);
  lv_obj_set_style_text_color(timeLabel_, lv_color_hex(0xF4F7EE), 0);
  lv_label_set_text(timeLabel_, "--:--");
  lv_obj_align(timeLabel_, LV_ALIGN_TOP_MID, 0, 38);

  dateLabel_ = lv_label_create(screen);
  applyLabelFont(dateLabel_);
  lv_obj_set_style_text_color(dateLabel_, lv_color_hex(0xAFC7C2), 0);
  lv_label_set_text(dateLabel_, "等待时间同步");
  lv_obj_align(dateLabel_, LV_ALIGN_TOP_MID, 0, 96);

  createButton(AppAction::EnglishPractice, "英语练习", 148, lv_color_hex(0x2E7D7C));
  createButton(AppAction::AskAi, "问 AI", 207, lv_color_hex(0x6750A4));
  createButton(AppAction::MiniGame, "小游戏", 266, lv_color_hex(0xB6682F));

  statusLabel_ = lv_label_create(screen);
  applyLabelFont(statusLabel_);
  lv_obj_set_style_text_color(statusLabel_, lv_color_hex(0xD0D7CD), 0);
  lv_label_set_long_mode(statusLabel_, LV_LABEL_LONG_DOT);
  lv_obj_set_width(statusLabel_, 270);
  lv_label_set_text(statusLabel_, wifiManager_.statusText().c_str());
  lv_obj_align(statusLabel_, LV_ALIGN_BOTTOM_MID, 0, -18);

  updateClock();
}

void AppUi::updateClock() {
  time_t now = time(nullptr);
  tm info = {};

  if (now > 1700000000 && localtime_r(&now, &info)) {
    char timeText[8] = {};
    char dateText[32] = {};
    strftime(timeText, sizeof(timeText), "%H:%M", &info);
    snprintf(dateText, sizeof(dateText), "%02d/%02d %s", info.tm_mon + 1, info.tm_mday, weekdayName(info.tm_wday));
    lv_label_set_text(timeLabel_, timeText);
    lv_label_set_text(dateLabel_, dateText);
    return;
  }

  const uint32_t seconds = millis() / 1000;
  const uint32_t minutes = seconds / 60;
  char uptimeText[8] = {};
  snprintf(uptimeText, sizeof(uptimeText), "%02lu:%02lu", (minutes / 60) % 24, minutes % 60);
  lv_label_set_text(timeLabel_, uptimeText);
  lv_label_set_text(dateLabel_, "本机运行时间");
}

void AppUi::setStatus(const String &status) {
  if (statusLabel_ == nullptr) {
    return;
  }
  lv_label_set_text(statusLabel_, status.c_str());
}

void AppUi::handleAction(AppAction action) {
  const String title(appActionTitle(action));
  setStatus(title + " 请求中");
  lv_timer_handler();

  const String result = apiClient_.sendAction(action);
  setStatus(title + " " + result);
}

void AppUi::onButtonEvent(lv_event_t *event) {
  if (lv_event_get_code(event) != LV_EVENT_CLICKED) {
    return;
  }

  AppUi *self = static_cast<AppUi *>(lv_event_get_user_data(event));
  AppAction action = static_cast<AppAction>(
      reinterpret_cast<uintptr_t>(lv_obj_get_user_data(lv_event_get_target(event))));
  self->handleAction(action);
}

void AppUi::createButton(AppAction action, const char *text, int16_t y, lv_color_t color) {
  lv_obj_t *button = lv_btn_create(lv_scr_act());
  lv_obj_set_size(button, 226, 48);
  lv_obj_align(button, LV_ALIGN_TOP_MID, 0, y);
  lv_obj_set_user_data(button, reinterpret_cast<void *>(static_cast<uintptr_t>(action)));
  lv_obj_add_event_cb(button, AppUi::onButtonEvent, LV_EVENT_CLICKED, this);
  lv_obj_set_style_radius(button, 18, 0);
  lv_obj_set_style_bg_color(button, color, 0);
  lv_obj_set_style_bg_opa(button, LV_OPA_90, 0);
  lv_obj_set_style_shadow_width(button, 0, 0);
  lv_obj_set_style_border_width(button, 1, 0);
  lv_obj_set_style_border_color(button, lv_color_hex(0xDCE7DF), 0);

  lv_obj_t *label = lv_label_create(button);
  applyLabelFont(label);
  lv_obj_set_style_text_color(label, lv_color_hex(0xFFFFFF), 0);
  lv_label_set_text(label, text);
  lv_obj_center(label);
}

void AppUi::applyLabelFont(lv_obj_t *label) {
  lv_obj_set_style_text_font(label, &lv_font_simsun_16_cjk, 0);
}
