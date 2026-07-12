# SD Card Resource Pack

> 当前 Family AI OS 主文档见 [docs/family-ai-os/06-sd-resource-system.md](family-ai-os/06-sd-resource-system.md)。
>
> 本文件保留较细的资源包格式记录，后续产品级 SD 方向优先看 `docs/family-ai-os/06-sd-resource-system.md`。

## Decision

The project uses FAT32 as the standard SD card filesystem.

Reasons:

- It is the most stable path for ESP32 + FatFS.
- It avoids extra exFAT memory and compatibility work.
- It is enough for local music, photos, lessons, games, logs and cache.
- Normal firmware keeps automatic formatting disabled.

## Format Rules

- Filesystem: FAT32.
- Preferred card size: 8 GB to 64 GB.
- File names: use lowercase English letters, numbers, `-`, and `_`.
- Avoid spaces and Chinese file names in first-stage resource packs.
- Keep single files under 4 GB.
- Use SD card as a resource store, not as a database.
- Waveshare ESP32-S3-Touch-LCD-1.85B uses the official 4-bit SDMMC pins `CLK=GPIO15`, `CMD=GPIO14`, `D0=GPIO16`, `D1=GPIO17`, `D2=GPIO12`, and `D3=GPIO13`.
- Garbled directory entries usually mean the FAT directory area was corrupted. Reformat the card as FAT32 on a computer before retesting fixed firmware.

## Layout

```text
/sdcard
├── manifest.json
├── icons/
├── images/
├── animations/
├── fonts/
├── music/
│   ├── local/
│   └── cache/
├── courses/
│   ├── english/
│   ├── math/
│   └── stories/
├── games/
├── cache/
├── logs/
└── outbox/
```

Server resource mirror:

```text
/opt/xiaozhi-family-hub/data/resources
├── music/
│   └── server/
└── ...
```

## Current Media Support

- Local music: Ogg/Opus and MP3 playback paths are wired.
- Local music diagnostics: when `/sdcard/music/local` is empty, firmware may create `sample-success.ogg` from a built-in prompt sound for playback testing.
- Server podcast/music: Ogg/Opus and MP3 stream playback is wired through `GET /api/media/server/tracks` and `GET /api/media/server/stream/:id`.
- Server podcast streams support HTTP byte ranges (`206 Content-Range`) for future seek/resume behavior.
- Server podcast metadata includes `sha256`, `size`, `format`, `contentType`, `streamUrl`, `downloadUrl`, `cacheable`, `supportsRange`, and `cachePath`.
- Optional offline podcast cache writes to `/sdcard/music/cache/`; ESP32 downloads to a temporary file, verifies SHA-256/size, renames atomically, and prefers a valid cached file before online streaming.
- Server media directory: `/opt/xiaozhi-family-hub/data/resources/music/server` by default; configure `NAS_MUSIC_DIR` later for a real NAS share.
- MP3: server streams use `audio/mpeg`; ESP32 plays them through `esp_audio_simple_player` with HTTP IO enabled.
- Images: JPG/JPEG is the first supported family-photo screensaver format.
- Raw preview image: `.rgb565.bin`, fixed 192 x 104 RGB565 little-endian, used for lightweight generated assets and diagnostics.
- PNG/BMP: reserved for later validation.
- Manifest: managed resource packages include `path`, `size`, `sha256`, `contentType`, and `version`; ESP32 downloads to `/sdcard/cache/*.tmp`, verifies SHA-256, then renames into place.

## Safety Rule

Do not enable `APPSHELL_SD_FORMAT_ON_MOUNT_FAILED` in normal firmware. It is only a one-time recovery switch for unreadable cards.
Recovery builds must also explicitly set `APPSHELL_SD_RECOVERY_BUILD=1`; otherwise the firmware should fail to compile when auto-format is enabled.
