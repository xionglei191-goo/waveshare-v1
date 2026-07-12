#ifndef APP_AUDIO_SESSION_MANAGER_H_
#define APP_AUDIO_SESSION_MANAGER_H_

#include <string>

enum class AppAudioSessionType {
    kNone,
    kGame,
    kMusic,
    kCourse,
    kAi,
    kSystem,
};

struct AppAudioSessionStatus {
    AppAudioSessionType owner = AppAudioSessionType::kNone;
    std::string owner_name = "空闲";
    int priority = 0;
};

class AppAudioSessionManager {
public:
    static AppAudioSessionManager& GetInstance();

    bool Request(AppAudioSessionType type, const std::string& name);
    void Release(AppAudioSessionType type);
    const AppAudioSessionStatus& status() const { return status_; }
    std::string StatusLine() const;

private:
    AppAudioSessionManager() = default;

    int Priority(AppAudioSessionType type) const;

    AppAudioSessionStatus status_;
};

#endif
