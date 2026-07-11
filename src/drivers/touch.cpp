#include "drivers/touch.h"

#include "board/board_config.h"

TouchDriver::TouchDriver(TwoWire &wire, IoExpander &ioExpander)
    : wire_(wire), ioExpander_(ioExpander) {}

bool TouchDriver::begin() {
  pinMode(board::TouchInt, INPUT_PULLUP);
  resetController();
  wire_.begin(board::TouchSda, board::TouchScl, board::I2cFrequency);
  delay(50);

  wire_.beginTransmission(board::TouchAddress);
  return wire_.endTransmission() == 0;
}

bool TouchDriver::read(TouchPoint &point) {
  uint8_t data[6] = {0};
  if (!readBytes(0x01, data, sizeof(data))) {
    return false;
  }

  const uint8_t fingerCount = data[1] & 0x0F;
  if (fingerCount == 0) {
    return false;
  }

  int16_t x = static_cast<int16_t>(((data[2] & 0x0F) << 8) | data[3]);
  int16_t y = static_cast<int16_t>(((data[4] & 0x0F) << 8) | data[5]);

#if defined(TOUCH_SWAP_XY) && TOUCH_SWAP_XY
  int16_t tmp = x;
  x = y;
  y = tmp;
#endif

#if defined(TOUCH_INVERT_X) && TOUCH_INVERT_X
  x = board::ScreenWidth - 1 - x;
#endif

#if defined(TOUCH_INVERT_Y) && TOUCH_INVERT_Y
  y = board::ScreenHeight - 1 - y;
#endif

  point.x = constrain(x, 0, static_cast<int>(board::ScreenWidth - 1));
  point.y = constrain(y, 0, static_cast<int>(board::ScreenHeight - 1));
  return true;
}

void TouchDriver::resetController() {
  if constexpr (board::UseIoExpander) {
    ioExpander_.pinModeOutput(board::ExioTouchReset, true);
    delay(10);
    ioExpander_.digitalWrite(board::ExioTouchReset, false);
    delay(20);
    ioExpander_.digitalWrite(board::ExioTouchReset, true);
    delay(100);
    return;
  }

  pinMode(board::TouchReset, OUTPUT);
  digitalWrite(board::TouchReset, HIGH);
  delay(10);
  digitalWrite(board::TouchReset, LOW);
  delay(20);
  digitalWrite(board::TouchReset, HIGH);
  delay(100);
}

bool TouchDriver::readBytes(uint8_t reg, uint8_t *buffer, size_t length) {
  wire_.beginTransmission(board::TouchAddress);
  wire_.write(reg);
  if (wire_.endTransmission(false) != 0) {
    return false;
  }

  size_t received = wire_.requestFrom(
      static_cast<int>(board::TouchAddress),
      static_cast<int>(length));
  if (received != length) {
    return false;
  }

  for (size_t i = 0; i < length; ++i) {
    buffer[i] = wire_.read();
  }
  return true;
}
