#!/usr/bin/env bash
# Restore ESP-IDF v5.5 and build the AppShell firmware (ESP32-S3).
# The prebuilt toolchain in ~/.espressif is reused; only the framework source
# tree (previously at .tools/esp-idf) is restored. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
IDF_DIR="${IDF_DIR:-${PROJECT_DIR}/.tools/esp-idf}"
IDF_BRANCH="${IDF_BRANCH:-v5.5}"

echo "==> ESP-IDF dir: ${IDF_DIR}"
if [ ! -f "${IDF_DIR}/export.sh" ]; then
  echo "==> ESP-IDF source missing; cloning ${IDF_BRANCH} (this is large) ..."
  mkdir -p "$(dirname "${IDF_DIR}")"
  git clone -b "${IDF_BRANCH}" --recursive https://github.com/espressif/esp-idf.git "${IDF_DIR}"
  echo "==> Running install.sh esp32s3 (reuses ~/.espressif tools) ..."
  "${IDF_DIR}/install.sh" esp32s3
else
  echo "==> ESP-IDF source already present; skipping clone/install."
fi

echo "==> Sourcing export.sh ..."
# shellcheck disable=SC1091
. "${IDF_DIR}/export.sh"

cd "${PROJECT_DIR}"

if [ ! -f "sdkconfig" ]; then
  echo "==> No sdkconfig; setting target esp32s3 ..."
  idf.py set-target esp32s3
fi

echo "==> Building ..."
idf.py build
echo "==> Build finished."
