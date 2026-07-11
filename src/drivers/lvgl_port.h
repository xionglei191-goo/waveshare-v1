#pragma once

#include <Arduino.h>
#include <lvgl.h>

#include "drivers/display.h"
#include "drivers/touch.h"

class LvglPort {
 public:
  bool begin(DisplayDriver &display, TouchDriver &touch);
  void tick();
  void loop();

 private:
  static void flush(lv_disp_drv_t *disp, const lv_area_t *area, lv_color_t *color);
  static void readTouch(lv_indev_drv_t *indev, lv_indev_data_t *data);

  static DisplayDriver *display_;
  static TouchDriver *touch_;
};

