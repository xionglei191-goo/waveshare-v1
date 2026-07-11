# Waveshare ESP32-S3 Touch LCD 1.85 LVGL App

PlatformIO + Arduino + LVGL starter project for the Waveshare ESP32-S3 1.85B-inch round touch LCD.

The structure follows the same broad separation as `infinition/waveshare-watch-rs`: board constants, low-level drivers, services, UI, and app actions.

## Repository Layout

This repository contains two separate projects that target the same board and the
same LAN backend, but at very different levels of maturity:

- **Root project (this directory)** — a lightweight PlatformIO + Arduino + LVGL
  starter. It renders a watch-style home screen and posts a few actions to a LAN
  API. Good as a minimal, easy-to-build baseline for the round screen.
- **[`xiaozhi-esp32-appshell/`](xiaozhi-esp32-appshell/)** — the full **Family AI OS**
  project: an ESP-IDF firmware built on the Xiaozhi voice AI mainline plus a
  Node.js Express **Family Capability Hub** backend. This is the production line
  (real-device flashed, long-run tested, backend deployed at
  `192.168.31.246:3100`). See its [`README_zh.md`](xiaozhi-esp32-appshell/README_zh.md),
  [`todo.md`](xiaozhi-esp32-appshell/todo.md), and
  [`docs/family-ai-os/`](xiaozhi-esp32-appshell/docs/family-ai-os/) for details.

The two projects do not share a build. Use the root project when you want a small
Arduino codebase; use `xiaozhi-esp32-appshell/` for the full voice AI + backend
ecosystem.

> Hardware pin definitions in this root project mirror the authoritative facts in
> [`xiaozhi-esp32-appshell/docs/family-ai-os/hardware-facts.md`](xiaozhi-esp32-appshell/docs/family-ai-os/hardware-facts.md).
> When they disagree, that file (and verified on-device serial logs) wins.

## Features

- Home screen with time display.
- Three LVGL buttons: `英语练习`, `问 AI`, `小游戏`.
- Button actions POST JSON to a LAN API at `http://192.168.31.246` by default.
- ST77916 QSPI display through Arduino_GFX.
- CST816 touch input through LVGL.
- Direct GPIO reset handling for the 1.85B LCD and touch controller.

## Configure

Copy the example secrets file and edit it:

```sh
cp include/secrets.example.h include/secrets.h
```

Set your WiFi credentials in `include/secrets.h`.

If your API uses a port, change:

```cpp
#define API_BASE_URL "http://192.168.31.246:8000"
```

The default routes are:

- `POST /api/english/practice`
- `POST /api/ai/ask`
- `POST /api/game/start`

Update `API_ENGLISH_ENDPOINT`, `API_ASK_AI_ENDPOINT`, and `API_MINI_GAME_ENDPOINT` in `include/secrets.h` if your backend uses different paths.

## Build And Upload

```sh
pio run
pio run -t upload
pio device monitor
```

This project uses pioarduino because the Waveshare Arduino docs require ESP32 Arduino 3.0.2 or newer, while official PlatformIO ESP32 Arduino support is still on Arduino 2.x.

## Hardware Notes

The pin constants are in `src/board/board_config.h`.

- LCD: ST77916, 360 x 360, QSPI pins `CS=21`, `SCK=40`, `D0=46`, `D1=45`, `D2=42`, `D3=41`, `RST=3`, `BL=5`.
- Touch: CST816, I2C address `0x15`, `SDA=11`, `SCL=10`, `RST=1`, `INT=4`.
- Audio pins for the 1.85B revision: `MCLK=2`, `WS=38`, `BCLK=48`, `DIN=39`, `DOUT=47`, `PA=9`.
- SD card is **4-bit SDMMC** (not SPI): `CLK=15`, `CMD=14`, `D0=16`, `D1=17`, `D2=12`, `D3=13`. Do not use the old SPI-style mapping (`SCK=14`, `MOSI=17`, `MISO=16`), which times out on this board.

## References

- https://github.com/infinition/waveshare-watch-rs
- https://www.waveshare.com/wiki/ESP32-S3-Touch-LCD-1.85
