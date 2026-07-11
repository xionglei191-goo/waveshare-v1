# 部署与验收

## 固件构建

```sh
source /Users/xionglei/esp/esp-idf-v5.5.4/export.sh
idf.py build
```

## 真机刷入

```sh
source /Users/xionglei/esp/esp-idf-v5.5.4/export.sh
idf.py -p /dev/cu.usbmodem101 flash
```

## 串口观察

```sh
source /Users/xionglei/esp/esp-idf-v5.5.4/export.sh
idf.py -p /dev/cu.usbmodem101 monitor
```

退出 monitor：`Ctrl+]`。

## 后端验证

```sh
cd server
npm run check
npm run smoke
```

远端验证：

```sh
curl http://192.168.31.246:3100/api/health
curl http://192.168.31.246:3100/api/ui/page/apps
curl http://192.168.31.246:3100/api/ui/page/album
```

## 真机验收重点

- 启动无 panic、assert、重启循环。
- LCD、触摸、SD、Wi-Fi、音频 codec 正常。
- 小智 OTA/MQTT、唤醒词正常。
- 天气页不显示日程。
- 应用页不显示设置、天气、音乐、英语、相册、家庭模式。
- 相册页显示本地照片/屏保资源，而不是内容资源列表。
- 设置页只做设备中心。

## BluFi 新 Wi-Fi 验收

这项用于勾选 `todo.md` 里的“新 Wi-Fi 配置可写入并验证联网”和“手机可完成新 Wi-Fi 配网”。没有手机端实际写入前，不要勾选。

前置条件：

- 固件启用 `CONFIG_USE_ESP_BLUFI_WIFI_PROVISIONING=y`。
- 设备设置页连接详情能显示 `BluFi: Xiaozhi-Blufi`。
- 手机安装 EspBlufi App 或等价 BluFi 客户端。
- 准备一个与当前已保存网络不同的 2.4GHz Wi-Fi，或先清除旧 Wi-Fi 凭据。

验收步骤：

1. 让设备进入配网状态，手机扫描并连接 `Xiaozhi-Blufi`。
2. 通过 EspBlufi 写入新 Wi-Fi SSID 和密码，等待 App 返回连接成功。
3. 在圆屏设置页确认 Wi-Fi SSID/IP/RSSI 更新，后端状态在线。
4. 打开 `http://192.168.31.246:3100/companion` 刷新，确认 `/api/device/summary` 能看到设备状态更新时间。
5. 唤醒小智，确认 OTA/MQTT、唤醒词和基础对话仍正常。
6. 串口观察至少 3 分钟，无 panic、重启循环或 Wi-Fi 反复断连。

通过证据：

- EspBlufi App 成功页面或手机记录。
- 圆屏设置页的新 IP/SSID。
- `/api/device/summary` 的设备更新时间。
- 串口日志中小智 OTA/MQTT/唤醒词恢复正常。
