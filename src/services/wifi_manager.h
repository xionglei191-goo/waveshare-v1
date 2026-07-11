#pragma once

#include <Arduino.h>

class WifiManager {
 public:
  bool begin();
  bool connected() const;
  String statusText() const;
  void ensureConnected();

 private:
  bool hasCredentials() const;
  uint32_t lastReconnectAttemptMs_ = 0;
};

