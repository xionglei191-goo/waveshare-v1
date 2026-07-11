#include "services/api_client.h"

#include <cstring>

#include <HTTPClient.h>
#include <WiFi.h>

#include "app_config.h"

String ApiClient::sendAction(AppAction action) {
  return postJson(appActionEndpoint(action), appActionPayload(action));
}

String ApiClient::postJson(const char *endpoint, const char *payload) {
  if (WiFi.status() != WL_CONNECTED) {
    return "WiFi 未连接";
  }

  HTTPClient http;
  const String url = buildUrl(endpoint);
  http.setTimeout(6000);

  if (!http.begin(url)) {
    return "API 地址无效";
  }

  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(String(payload));
  String body = http.getString();
  http.end();

  if (code <= 0) {
    return "请求失败";
  }

  body.trim();
  if (body.length() > 30) {
    body = body.substring(0, 30);
    body += "...";
  }

  if (body.length() == 0) {
    return String(code) + " OK";
  }
  return String(code) + " " + body;
}

String ApiClient::buildUrl(const char *endpoint) const {
  String url(API_BASE_URL);
  if (!url.endsWith("/") && endpoint[0] != '/') {
    url += "/";
  }
  if (url.endsWith("/") && endpoint[0] == '/') {
    url.remove(url.length() - 1);
  }
  url += endpoint;
  return url;
}
