# SD 资源系统

SD 卡是本地资源仓库，不只是音乐盘。

## 文件系统

- 当前标准：FAT32。
- 正式固件禁止自动格式化。
- `APPSHELL_SD_FORMAT_ON_MOUNT_FAILED` 只作为一次性恢复开关。
- Waveshare ESP32-S3-Touch-LCD-1.85B 的 TF 卡采用官方 4-bit SDMMC：`CLK=GPIO15`、`CMD=GPIO14`、`D0=GPIO16`、`D1=GPIO17`、`D2=GPIO12`、`D3=GPIO13`。
- 路径优先使用英文、数字、`-`、`_`。
- 如果卡里出现乱码文件，通常表示 FAT 目录区已经损坏；先在电脑上重新 FAT32 格式化，再用正常固件验证。

## 目标目录

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
├── games/
├── logs/
└── outbox/
```

## 当前优先级

- `/sdcard/images`：家庭相册和屏保。
- `/sdcard/music/local`：本地 Ogg/Opus 音乐。
- `/sdcard/outbox`：离线事件。
- `/sdcard/manifest.json`：资源包版本和校验。

## 相册规则

- 圆屏端相册页只展示照片、幻灯片和屏保资源。
- 故事、播客归音乐音频内容。
- 英语素材归英语页。
- 小游戏资源归应用页。
- 资源导入和版本管理归后端/伴侣页。
