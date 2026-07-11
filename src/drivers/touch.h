#pragma once

#include <Arduino.h>
#include <Wire.h>

#include "drivers/io_expander.h"

struct TouchPoint {
  int16_t x = 0;
  int16_t y = 0;
};

class TouchDriver {
 public:
  TouchDriver(TwoWire &wire, IoExpander &ioExpander);

  bool begin();
  bool read(TouchPoint &point);

 private:
  void resetController();
  bool readBytes(uint8_t reg, uint8_t *buffer, size_t length);

  TwoWire &wire_;
  IoExpander &ioExpander_;
};

