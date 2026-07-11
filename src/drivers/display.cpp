#include "drivers/display.h"

#include "board/board_config.h"

DisplayDriver::DisplayDriver(IoExpander &ioExpander) : ioExpander_(ioExpander) {}

bool DisplayDriver::begin() {
  pinMode(board::LcdBacklight, OUTPUT);
  digitalWrite(board::LcdBacklight, LOW);

  resetPanel();

  bus_ = new Arduino_ESP32QSPI(
      board::LcdCs,
      board::LcdSck,
      board::LcdSda0,
      board::LcdSda1,
      board::LcdSda2,
      board::LcdSda3,
      false);

  gfx_ = new Arduino_ST77916(
      bus_,
      -1,
      0,
      true,
      board::ScreenWidth,
      board::ScreenHeight);

  if (!gfx_->begin(80000000)) {
    return false;
  }

  gfx_->fillScreen(0x0000);
  setBrightness(220);
  return true;
}

void DisplayDriver::setBrightness(uint8_t brightness) {
  analogWrite(board::LcdBacklight, brightness);
}

Arduino_GFX &DisplayDriver::gfx() {
  return *gfx_;
}

void DisplayDriver::resetPanel() {
  if constexpr (board::UseIoExpander) {
    ioExpander_.pinModeOutput(board::ExioLcdReset, true);
    delay(10);
    ioExpander_.digitalWrite(board::ExioLcdReset, false);
    delay(20);
    ioExpander_.digitalWrite(board::ExioLcdReset, true);
    delay(120);
    return;
  }

  pinMode(board::LcdReset, OUTPUT);
  digitalWrite(board::LcdReset, HIGH);
  delay(10);
  digitalWrite(board::LcdReset, LOW);
  delay(20);
  digitalWrite(board::LcdReset, HIGH);
  delay(120);
}
