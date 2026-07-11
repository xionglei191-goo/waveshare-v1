#pragma once

// Copy this file to include/secrets.h and fill in your local settings.
// include/secrets.h is ignored by git.

#define WIFI_SSID "your-wifi-ssid"
#define WIFI_PASSWORD "your-wifi-password"

// Add a port if your LAN API uses one, for example:
// #define API_BASE_URL "http://192.168.31.246:8000"
#define API_BASE_URL "http://192.168.31.246"

// Adjust these to match your server routes.
#define API_ENGLISH_ENDPOINT "/api/english/practice"
#define API_ASK_AI_ENDPOINT "/api/ai/ask"
#define API_MINI_GAME_ENDPOINT "/api/game/start"

