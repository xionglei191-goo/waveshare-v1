#ifndef APP_LOCAL_MUSIC_PLAYER_H_
#define APP_LOCAL_MUSIC_PLAYER_H_

#include <atomic>
#include <string>

class AppLocalMusicPlayer {
public:
    static AppLocalMusicPlayer& GetInstance();

    bool PlayPause();
    bool Previous();
    bool Next();
    bool SeekRelative(int delta_seconds);
    void Stop();
    bool playing() const { return playing_.load(); }
    std::string StatusLine() const;
    std::string CurrentTitle() const;
    std::string DisplayTitle() const;
    std::string MetadataLine() const;
    int track_index() const { return current_index_; }
    int position_ms() const;
    int duration_ms() const;
    bool has_reliable_duration() const;

private:
    AppLocalMusicPlayer() = default;

    bool StartCurrent();
    void PlaybackTask();
    static void PlaybackTaskEntry(void* arg);
    int FindNextSupportedIndex(int start) const;
    bool IsSupported(const std::string& path) const;

    std::atomic<bool> playing_{false};
    std::atomic<bool> stop_requested_{false};
    int current_index_ = 0;
    std::string last_error_ = "SD 音乐待命";
};

#endif
