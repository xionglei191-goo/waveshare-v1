# Repository Guidelines

## Project Structure & Module Organization

This repository is a Xiaozhi-based ESP32-S3 firmware with a Family AI OS AppShell extension.

The directory containing this file and the top-level `CMakeLists.txt` is the only
project root. Do not recreate or reference the retired `xiaozhi-esp32-appshell/`
subdirectory.

- `main/`: ESP-IDF firmware source, board integrations, audio, application logic.
- `main/app_shell/`: LVGL AppShell pages, backend client, Remote UI renderer, SD/resource/sync managers.
- `main/boards/waveshare/esp32-s3-touch-lcd-1.85b-appshell/`: target board support for Waveshare 1.85B.
- `server/`: Node.js Express Family Backend and LAN Action Hub.
- `docs/family-ai-os/`: canonical Family AI OS product, architecture, API, SD, deployment, and roadmap docs.
- `docs/xiaozhi-upstream/`: index of upstream Xiaozhi reference docs.
- `build/`: generated ESP-IDF output; do not edit by hand.

Before changing firmware, backend, page structure, SD, battery, audio, or deployment behavior, read:

- `docs/family-ai-os/current-state.md`
- `docs/family-ai-os/hardware-facts.md`
- `docs/family-ai-os/decision-log.md`
- `docs/family-ai-os/10-ai-agent-layer.md` when changing AI, tools, agents, roles, memory, or backend capability routing.
- `docs/family-ai-os/11-ai-service-v1.md` before implementing `/api/agent/*`, `family.agent.ask`, Page Agents, or Capability Tools.

Treat these as the cross-thread source of truth. If older chat history conflicts with them, follow verified hardware facts and update the decision log.

## Build, Test, and Development Commands

Firmware:

```sh
source /Users/xionglei/esp/esp-idf-v5.5.4/export.sh
idf.py build
idf.py -p /dev/cu.usbmodem101 flash
idf.py -p /dev/cu.usbmodem101 monitor
```

Backend:

```sh
cd server
npm run check        # Node syntax checks
npm run smoke        # API smoke test with JSON store
npm run smoke:sqlite # API smoke test with SQLite
npm run dev          # local watch mode
```

## Coding Style & Naming Conventions

Follow existing local style. C++ uses 4-space indentation, PascalCase class names, and lower_snake_case private fields with trailing underscores. Keep LVGL UI helpers small and page-specific logic inside `AppShell::Render...` methods. Node.js backend files use CommonJS, `const`/`let`, and lower-kebab filenames such as `ui-pages.js`.

## Testing Guidelines

Run `idf.py build` before firmware handoff. Run `npm run check` and at least one smoke test before backend deployment. For UI changes, verify the affected page on the 1.85B device and watch serial logs for panic, reboot loops, SD mount failures, and backend request errors.

## Commit & Pull Request Guidelines

Use concise imperative commit titles, matching upstream style, for example `Add ESP-VoCat battery emotes (#2090)`. PRs should describe user-visible behavior, list firmware/backend files touched, include test commands, and mention whether the device was flashed. Add screenshots or photos for UI changes when available.

## Security & Configuration Tips

Do not commit secrets, Wi-Fi credentials, tokens, or private server data. Keep backend defaults on `192.168.31.246:3100`; preserve `3000` for existing services. Remote JSON UI must remain whitelist-only: no scripts, HTML, CSS, or arbitrary actions.

## Hardware Truth Rules

The current target is Waveshare ESP32-S3 Touch LCD 1.85B. Its SD card uses official 4-bit SDMMC: `CLK=GPIO15`, `CMD=GPIO14`, `D0=GPIO16`, `D1=GPIO17`, `D2=GPIO12`, `D3=GPIO13`. Do not restore the deprecated 1-bit `GPIO14/17/16` mapping for this AppShell target. Normal firmware must not auto-format SD cards.
