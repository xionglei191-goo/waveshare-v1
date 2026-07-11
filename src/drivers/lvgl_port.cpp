#include "drivers/lvgl_port.h"

#include "board/board_config.h"

DisplayDriver *LvglPort::display_ = nullptr;
TouchDriver *LvglPort::touch_ = nullptr;

namespace {
lv_disp_draw_buf_t drawBuffer;
lv_disp_drv_t displayDriver;
lv_indev_drv_t inputDriver;
lv_color_t buffer1[board::ScreenWidth * board::LvglBufferRows];
}  // namespace

bool LvglPort::begin(DisplayDriver &display, TouchDriver &touch) {
  display_ = &display;
  touch_ = &touch;

  lv_init();

  lv_disp_draw_buf_init(
      &drawBuffer,
      buffer1,
      nullptr,
      board::ScreenWidth * board::LvglBufferRows);

  lv_disp_drv_init(&displayDriver);
  displayDriver.hor_res = board::ScreenWidth;
  displayDriver.ver_res = board::ScreenHeight;
  displayDriver.flush_cb = LvglPort::flush;
  displayDriver.draw_buf = &drawBuffer;
  lv_disp_drv_register(&displayDriver);

  lv_indev_drv_init(&inputDriver);
  inputDriver.type = LV_INDEV_TYPE_POINTER;
  inputDriver.read_cb = LvglPort::readTouch;
  lv_indev_drv_register(&inputDriver);

  return true;
}

void LvglPort::tick() {
  lv_tick_inc(1);
}

void LvglPort::loop() {
  lv_timer_handler();
}

void LvglPort::flush(lv_disp_drv_t *disp, const lv_area_t *area, lv_color_t *color) {
  (void)disp;
  if (display_ == nullptr) {
    lv_disp_flush_ready(disp);
    return;
  }

  const int32_t width = area->x2 - area->x1 + 1;
  const int32_t height = area->y2 - area->y1 + 1;
  display_->gfx().draw16bitRGBBitmap(
      area->x1,
      area->y1,
      reinterpret_cast<uint16_t *>(color),
      width,
      height);
  lv_disp_flush_ready(disp);
}

void LvglPort::readTouch(lv_indev_drv_t *indev, lv_indev_data_t *data) {
  (void)indev;
  if (touch_ == nullptr) {
    data->state = LV_INDEV_STATE_REL;
    return;
  }

  TouchPoint point;
  if (touch_->read(point)) {
    data->point.x = point.x;
    data->point.y = point.y;
    data->state = LV_INDEV_STATE_PR;
  } else {
    data->state = LV_INDEV_STATE_REL;
  }
}

