#pragma once

#include <Arduino.h>

namespace board {

constexpr uint16_t ScreenWidth = 360;
constexpr uint16_t ScreenHeight = 360;
constexpr uint16_t LvglBufferRows = 40;

// ST77916 QSPI LCD.
constexpr int LcdSda0 = 46;
constexpr int LcdSda1 = 45;
constexpr int LcdSda2 = 42;
constexpr int LcdSda3 = 41;
constexpr int LcdSck = 40;
constexpr int LcdCs = 21;
constexpr int LcdTe = 18;
constexpr int LcdBacklight = 5;
constexpr int LcdReset = 3;

constexpr bool UseIoExpander = false;

// Used by non-B revisions only.
constexpr int ExioLcdReset = 2;

// CST816 touch controller.
constexpr int TouchSda = 11;
constexpr int TouchScl = 10;
constexpr int TouchInt = 4;
constexpr int TouchReset = 1;
constexpr int ExioTouchReset = 1;
constexpr uint8_t TouchAddress = 0x15;

// Onboard I2C devices: TCA9554, QMI8658, PCF85063.
constexpr int InternalI2cSda = 11;
constexpr int InternalI2cScl = 10;
constexpr uint8_t IoExpanderAddress = 0x20;

// SD card on the 1.85B is wired as 4-bit SDMMC, not SPI.
// Authoritative source: xiaozhi-esp32-appshell/docs/family-ai-os/hardware-facts.md
// and .../boards/waveshare/esp32-s3-touch-lcd-1.85b-appshell/config.h.
// The old SPI-style mapping (SCK=14, MOSI=17, MISO=16, CS=3) is a deprecated
// 1-bit inference that causes send_op_cond ESP_ERR_TIMEOUT on this board.
constexpr int SdmmcClk = 15;
constexpr int SdmmcCmd = 14;
constexpr int SdmmcD0 = 16;
constexpr int SdmmcD1 = 17;
constexpr int SdmmcD2 = 12;
constexpr int SdmmcD3 = 13;
constexpr int SdmmcBusWidth = 4;

// Optional peripherals left as board constants for later modules.
constexpr int RtcInterrupt = 9;
constexpr int AudioMclk = 2;
constexpr int AudioWs = 38;
constexpr int AudioBclk = 48;
constexpr int AudioDin = 39;
constexpr int AudioDout = 47;
constexpr int AudioPa = 9;
constexpr int SpeakerDin = 47;
constexpr int SpeakerLrck = 38;
constexpr int SpeakerBck = 48;

constexpr uint32_t I2cFrequency = 400000;

}  // namespace board
