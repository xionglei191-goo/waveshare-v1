#pragma once

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID ""
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD ""
#endif

#ifndef API_BASE_URL
#define API_BASE_URL "http://192.168.31.246"
#endif

#ifndef API_ENGLISH_ENDPOINT
#define API_ENGLISH_ENDPOINT "/api/english/practice"
#endif

#ifndef API_ASK_AI_ENDPOINT
#define API_ASK_AI_ENDPOINT "/api/ai/ask"
#endif

#ifndef API_MINI_GAME_ENDPOINT
#define API_MINI_GAME_ENDPOINT "/api/game/start"
#endif

#ifndef DEVICE_NAME
#define DEVICE_NAME "waveshare-round-s3"
#endif

