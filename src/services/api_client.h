#pragma once

#include <Arduino.h>

#include "apps/app_actions.h"

class ApiClient {
 public:
  String sendAction(AppAction action);

 private:
  String postJson(const char *endpoint, const char *payload);
  String buildUrl(const char *endpoint) const;
};

