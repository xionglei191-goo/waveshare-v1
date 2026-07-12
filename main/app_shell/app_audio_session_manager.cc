#include "app_audio_session_manager.h"

#include <esp_heap_caps.h>

namespace {
constexpr size_t kCriticalInternalSramReserveBytes = 12 * 1024;
}

AppAudioSessionManager& AppAudioSessionManager::GetInstance() {
    static AppAudioSessionManager instance;
    return instance;
}

bool AppAudioSessionManager::Request(AppAudioSessionType type, const std::string& name) {
    constexpr uint32_t kInternalCaps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
    const bool optional_audio = type == AppAudioSessionType::kGame || type == AppAudioSessionType::kMusic ||
                                type == AppAudioSessionType::kCourse;
    if (optional_audio && heap_caps_get_free_size(kInternalCaps) < kCriticalInternalSramReserveBytes) {
        return false;
    }
    const int priority = Priority(type);
    if (priority < status_.priority) {
        return false;
    }
    status_.owner = type;
    status_.owner_name = name.empty() ? "音频会话" : name;
    status_.priority = priority;
    return true;
}

void AppAudioSessionManager::Release(AppAudioSessionType type) {
    if (status_.owner != type) {
        return;
    }
    status_ = AppAudioSessionStatus();
}

std::string AppAudioSessionManager::StatusLine() const {
    return status_.owner_name;
}

int AppAudioSessionManager::Priority(AppAudioSessionType type) const {
    switch (type) {
        case AppAudioSessionType::kSystem: return 50;
        case AppAudioSessionType::kAi: return 40;
        case AppAudioSessionType::kCourse: return 30;
        case AppAudioSessionType::kMusic: return 20;
        case AppAudioSessionType::kGame: return 10;
        case AppAudioSessionType::kNone:
        default: return 0;
    }
}
