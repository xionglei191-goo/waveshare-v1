# Hardware Facts

This file is the hardware source of truth for the current Family AI OS target.

## Evidence Priority

Use this order when sources disagree:

1. `Verified` serial logs or direct hardware tests on the current device.
2. `Official` Waveshare ESP32-S3-Touch-LCD-1.85B BSP.
3. Current repository code that has passed `idf.py build`.
4. Generic Waveshare wiki pages or older 1.85 references.
5. Prior chat conclusions or inferred notes.

## Target Device

- Status: `Verified`
- Device: Waveshare ESP32-S3 Touch LCD 1.85B.
- Firmware board path: `main/boards/waveshare/esp32-s3-touch-lcd-1.85b-appshell/`.
- Flash target: `/dev/cu.usbmodem101`.
- Display: ST77916, 360 x 360, QSPI.
- Touch: CST816S.
- Battery gauge: BQ27220 with 500mAh profile.
- Audio: ES8311 output, ES7210 mic input, Xiaozhi official wake word/audio chain retained.

## Buttons

- Status: `Verified`
- Two physical buttons only.
- Power button: hardware power/reset line, not a readable/programmable GPIO.
- BOOT button: GPIO0, `#define BOOT_BUTTON_GPIO GPIO_NUM_0`, the only programmable physical key.
- BOOT actions: single click = cycle one-level pages (or WiFi config during startup); long press = toggle AI voice chat; double click (only when `CONFIG_USE_DEVICE_AEC`) = toggle device-side AEC.

## SD Card

- Status: `Verified` and `Official`
- Filesystem standard: FAT32.
- Mode: 4-bit SDMMC.
- Pins: `CLK=GPIO15`, `CMD=GPIO14`, `D0=GPIO16`, `D1=GPIO17`, `D2=GPIO12`, `D3=GPIO13`.
- Evidence:
  - Waveshare official 1.85B BSP defines these pins.
  - Serial log confirmed `Mount SD: width=4`, `Name: SDABC`, `SSR: bus_width=4`.
- Normal firmware must keep `APPSHELL_SD_FORMAT_ON_MOUNT_FAILED=0`.
- Automatic format is allowed only in an explicit recovery build.

## Deprecated Hardware Conclusions

- Status: `Deprecated`
- Old conclusion: 1-bit SDMMC with `CLK=GPIO14`, `CMD=GPIO17`, `D0=GPIO16`.
- Why deprecated: it came from generic 1.85/wiki-era inference, not the current 1.85B BSP. On the current 1.85B device it caused `send_op_cond ESP_ERR_TIMEOUT`.
- Do not reintroduce this mapping for the AppShell 1.85B target.

## Backend And Network

- Status: `Verified`
- Family Backend: `http://192.168.31.246:3100`.
- Port `3000` is reserved for existing services.
- Xiaozhi official AI remains the low-latency voice path; Family Backend augments tools, resources, sync, memory and Remote UI.
