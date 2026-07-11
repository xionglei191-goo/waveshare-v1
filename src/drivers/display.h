#pragma once

#include <Arduino.h>
#include <Arduino_GFX_Library.h>

#include "drivers/io_expander.h"

class DisplayDriver {
 public:
  explicit DisplayDriver(IoExpander &ioExpander);

  bool begin();
  void setBrightness(uint8_t brightness);
  Arduino_GFX &gfx();

 private:
  void resetPanel();

  IoExpander &ioExpander_;
  Arduino_DataBus *bus_ = nullptr;
  Arduino_GFX *gfx_ = nullptr;
};

