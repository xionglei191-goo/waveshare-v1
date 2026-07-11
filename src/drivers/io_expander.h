#pragma once

#include <Arduino.h>
#include <Wire.h>

class IoExpander {
 public:
  IoExpander(TwoWire &wire, uint8_t address);

  bool begin();
  bool pinModeOutput(uint8_t pin, bool initialHigh);
  bool pinModeInput(uint8_t pin);
  bool digitalWrite(uint8_t pin, bool high);
  bool digitalRead(uint8_t pin, bool &high);

 private:
  bool writeRegister(uint8_t reg, uint8_t value);
  bool readRegister(uint8_t reg, uint8_t &value);

  TwoWire &wire_;
  uint8_t address_;
  uint8_t outputReg_ = 0xFF;
  uint8_t configReg_ = 0xFF;
};

