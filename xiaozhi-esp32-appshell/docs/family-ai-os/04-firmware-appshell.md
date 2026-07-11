# 固件 AppShell

## 核心模块

```text
AppShell
├── Local Pages
├── RemotePageRenderer
├── BackendClient
├── ConnectivityManager
├── ResourceManager
├── StorageManager
├── AudioSessionManager
└── SyncQueue
```

## 页面策略

- 首页、AI、设置必须有本地兜底。
- 天气、日程、音乐、英语、相册、应用可以接受后端数据增强。
- 应用页不承载设置、天气、音乐、英语、相册等一级页面。
- 相册页优先展示本地 SD 图片和屏保资源，远端 album 只做增强。

## 网络策略

业务代码通过 Connectivity Layer 访问网络，不直接绑定 Wi-Fi。

Provider 规划：

1. Wi-Fi：当前主通道。
2. BluFi/BLE：配网和后续手机伴侣。
3. USB：开发、诊断、资源导入。
4. Future Cellular：预留 4G/eSIM。

## 音频策略

`AudioSessionManager` 仲裁：

- 小智 AI。
- SD 本地音乐。
- 服务器播客/故事音频。
- 英语练习音频。
- 系统提示音。

AI 可抢占音乐；音乐不能抢占 AI。

