#include "drivers/io_expander.h"

namespace {
constexpr uint8_t RegInput = 0x00;
constexpr uint8_t RegOutput = 0x01;
constexpr uint8_t RegPolarity = 0x02;
constexpr uint8_t RegConfig = 0x03;
}  // namespace

IoExpander::IoExpander(TwoWire &wire, uint8_t address) : wire_(wire), address_(address) {}

bool IoExpander::begin() {
  uint8_t current = 0;
  if (!readRegister(RegOutput, current)) {
    return false;
  }
  outputReg_ = current;
  if (!readRegister(RegConfig, current)) {
    return false;
  }
  configReg_ = current;
  return writeRegister(RegPolarity, 0x00);
}

bool IoExpander::pinModeOutput(uint8_t pin, bool initialHigh) {
  if (pin > 7) {
    return false;
  }
  if (initialHigh) {
    outputReg_ |= (1U << pin);
  } else {
    outputReg_ &= ~(1U << pin);
  }
  if (!writeRegister(RegOutput, outputReg_)) {
    return false;
  }
  configReg_ &= ~(1U << pin);
  return writeRegister(RegConfig, configReg_);
}

bool IoExpander::pinModeInput(uint8_t pin) {
  if (pin > 7) {
    return false;
  }
  configReg_ |= (1U << pin);
  return writeRegister(RegConfig, configReg_);
}

bool IoExpander::digitalWrite(uint8_t pin, bool high) {
  if (pin > 7) {
    return false;
  }
  if (high) {
    outputReg_ |= (1U << pin);
  } else {
    outputReg_ &= ~(1U << pin);
  }
  return writeRegister(RegOutput, outputReg_);
}

bool IoExpander::digitalRead(uint8_t pin, bool &high) {
  if (pin > 7) {
    return false;
  }
  uint8_t value = 0;
  if (!readRegister(RegInput, value)) {
    return false;
  }
  high = (value & (1U << pin)) != 0;
  return true;
}

bool IoExpander::writeRegister(uint8_t reg, uint8_t value) {
  wire_.beginTransmission(address_);
  wire_.write(reg);
  wire_.write(value);
  return wire_.endTransmission() == 0;
}

bool IoExpander::readRegister(uint8_t reg, uint8_t &value) {
  wire_.beginTransmission(address_);
  wire_.write(reg);
  if (wire_.endTransmission(false) != 0) {
    return false;
  }
  if (wire_.requestFrom(static_cast<int>(address_), 1) != 1) {
    return false;
  }
  value = wire_.read();
  return true;
}

