#include "app_local_music_player.h"

#include "app_audio_session_manager.h"
#include "app_storage_manager.h"
#include "application.h"

#include <freertos/FreeRTOS.h>
#include <freertos/idf_additions.h>
#include <freertos/task.h>

#include <algorithm>
#include <cctype>
#include <cstring>

namespace {
std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string FileNameOf(const std::string& path) {
    const auto pos = path.find_last_of("/\\");
    if (pos == std::string::npos) {
        return path;
    }
    return path.substr(pos + 1);
}

std::string StripAudioExtension(std::string value) {
    const std::string lower = Lower(value);
    for (const char* extension : {".opus", ".mp3", ".ogg"}) {
        const size_t length = std::strlen(extension);
        if (lower.size() >= length && lower.rfind(extension) == lower.size() - length) {
            value.resize(value.size() - length);
            break;
        }
    }
    return value;
}
} // namespace

AppLocalMusicPlayer& AppLocalMusicPlayer::GetInstance() {
    static AppLocalMusicPlayer instance;
    return instance;
}

bool AppLocalMusicPlayer::PlayPause() {
    if (playing_.load()) {
        Stop();
        last_error_ = "SD 音乐已暂停";
        return true;
    }
    return StartCurrent();
}

bool AppLocalMusicPlayer::Next() {
    const auto& files = AppStorageManager::GetInstance().music_files();
    if (files.empty()) {
        last_error_ = "未发现 SD 音乐";
        return false;
    }
    Stop();
    current_index_ = FindNextSupportedIndex(current_index_ + 1);
    return StartCurrent();
}

void AppLocalMusicPlayer::Stop() {
    stop_requested_.store(true);
    const bool was_playing = playing_.exchange(false);
    if (was_playing) {
        Application::GetInstance().GetAudioService().ResetDecoder();
    }
    AppAudioSessionManager::GetInstance().Release(AppAudioSessionType::kMusic);
}

std::string AppLocalMusicPlayer::StatusLine() const {
    if (playing_.load()) {
        return "播放 " + CurrentTitle();
    }
    return last_error_;
}

std::string AppLocalMusicPlayer::CurrentTitle() const {
    const auto& files = AppStorageManager::GetInstance().music_files();
    if (files.empty() || current_index_ < 0 || current_index_ >= static_cast<int>(files.size())) {
        return "--";
    }
    return FileNameOf(files[current_index_]);
}

std::string AppLocalMusicPlayer::DisplayTitle() const {
    return StripAudioExtension(CurrentTitle());
}

std::string AppLocalMusicPlayer::MetadataLine() const {
    return "SD 卡 · 本地文件";
}

int AppLocalMusicPlayer::position_ms() const {
    return Application::GetInstance().GetAudioService().media_position_ms();
}

int AppLocalMusicPlayer::duration_ms() const {
    return Application::GetInstance().GetAudioService().media_duration_ms();
}

bool AppLocalMusicPlayer::has_reliable_duration() const {
    const std::string lower = Lower(CurrentTitle());
    return duration_ms() > 0 && lower.size() >= 4 && lower.rfind(".mp3") == lower.size() - 4;
}

bool AppLocalMusicPlayer::StartCurrent() {
    auto& storage = AppStorageManager::GetInstance();
    storage.Refresh();
    const auto& files = storage.music_files();
    if (files.empty()) {
        last_error_ = "未发现 SD 音乐";
        return false;
    }

    current_index_ = FindNextSupportedIndex(current_index_);
    if (current_index_ < 0 || current_index_ >= static_cast<int>(files.size()) || !IsSupported(files[current_index_])) {
        last_error_ = "仅支持 MP3/Ogg/Opus";
        return false;
    }
    if (!AppAudioSessionManager::GetInstance().Request(AppAudioSessionType::kMusic, "SD 音乐")) {
        last_error_ = "AI/课程占用音频";
        return false;
    }

    stop_requested_.store(false);
    playing_.store(true);
    last_error_ = "播放 " + CurrentTitle();
    if (xTaskCreateWithCaps(PlaybackTaskEntry, "sd_music", 6144, this, 2, nullptr,
                            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) {
        playing_.store(false);
        AppAudioSessionManager::GetInstance().Release(AppAudioSessionType::kMusic);
        last_error_ = "创建播放任务失败";
        return false;
    }
    return true;
}

void AppLocalMusicPlayer::PlaybackTask() {
    const auto& files = AppStorageManager::GetInstance().music_files();
    const std::string path = (current_index_ >= 0 && current_index_ < static_cast<int>(files.size())) ?
                             files[current_index_] : "";
    bool ok = false;
    if (!path.empty()) {
        const std::string lower = Lower(path);
        if (lower.size() >= 4 && lower.rfind(".mp3") == lower.size() - 4) {
            ok = Application::GetInstance().GetAudioService().PlayMp3File(path, [this]() {
                return stop_requested_.load();
            });
        } else {
            ok = Application::GetInstance().GetAudioService().PlayOggFile(path, [this]() {
                return stop_requested_.load();
            });
        }
    }
    if (!stop_requested_.load()) {
        Application::GetInstance().GetAudioService().WaitForPlaybackQueueEmpty();
        last_error_ = ok ? "SD 音乐播放完成" : "SD 音乐播放失败";
    }
    playing_.store(false);
    AppAudioSessionManager::GetInstance().Release(AppAudioSessionType::kMusic);
}

void AppLocalMusicPlayer::PlaybackTaskEntry(void* arg) {
    static_cast<AppLocalMusicPlayer*>(arg)->PlaybackTask();
    vTaskDeleteWithCaps(nullptr);
}

int AppLocalMusicPlayer::FindNextSupportedIndex(int start) const {
    const auto& files = AppStorageManager::GetInstance().music_files();
    if (files.empty()) {
        return 0;
    }
    for (int offset = 0; offset < static_cast<int>(files.size()); ++offset) {
        const int index = (start + offset + static_cast<int>(files.size())) % static_cast<int>(files.size());
        if (IsSupported(files[index])) {
            return index;
        }
    }
    return 0;
}

bool AppLocalMusicPlayer::IsSupported(const std::string& path) const {
    const std::string lower = Lower(path);
    const bool ogg = lower.size() >= 4 && lower.rfind(".ogg") == lower.size() - 4;
    const bool opus = lower.size() >= 5 && lower.rfind(".opus") == lower.size() - 5;
    const bool mp3 = lower.size() >= 4 && lower.rfind(".mp3") == lower.size() - 4;
    return ogg || opus || mp3;
}
