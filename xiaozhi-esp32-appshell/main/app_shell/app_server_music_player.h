#ifndef APP_SERVER_MUSIC_PLAYER_H_
#define APP_SERVER_MUSIC_PLAYER_H_

#include <atomic>
#include <string>
#include <vector>

class AppServerMusicPlayer {
public:
    static AppServerMusicPlayer& GetInstance();

    bool Play(const std::string& preferred_url = "", const std::string& preferred_title = "",
              const std::string& preferred_format = "", const std::string& preferred_download_url = "",
              const std::string& preferred_sha256 = "", const std::string& preferred_cache_path = "",
              int preferred_size = 0, const std::string& preferred_id = "", int preferred_duration_sec = 0,
              const std::string& preferred_artist = "", const std::string& preferred_source = "");
    bool PlayPause(const std::string& preferred_url = "", const std::string& preferred_title = "",
                   const std::string& preferred_format = "", const std::string& preferred_download_url = "",
                   const std::string& preferred_sha256 = "", const std::string& preferred_cache_path = "",
                   int preferred_size = 0, const std::string& preferred_id = "", int preferred_duration_sec = 0,
                   const std::string& preferred_artist = "", const std::string& preferred_source = "");
    bool Next();
    bool CacheCurrent(const std::string& preferred_url = "", const std::string& preferred_title = "",
                      const std::string& preferred_format = "", const std::string& preferred_download_url = "",
                      const std::string& preferred_sha256 = "", const std::string& preferred_cache_path = "",
                      int preferred_size = 0, const std::string& preferred_id = "");
    void Stop();
    bool playing() const { return playing_.load(); }
    std::string StatusLine() const;
    std::string CurrentTitle() const;
    std::string DisplayTitle() const;
    std::string MetadataLine() const;
    int track_index() const { return current_index_; }
    int track_total() const { return static_cast<int>(tracks_.size()); }
    int position_ms() const;
    int duration_ms() const;
    bool has_reliable_duration() const;

private:
    struct Track {
        std::string id;
        std::string title;
        std::string artist;
        std::string source;
        std::string url;
        std::string format;
        std::string content_type;
        std::string download_url;
        std::string sha256;
        std::string cache_path;
        int size = 0;
        int duration_sec = 0;  // 服务端下发的精确时长(秒),0 表示未知
    };

    AppServerMusicPlayer() = default;

    bool RefreshTracks();
    bool StartTrack(const Track& track);
    bool StartCurrent();
    bool CacheTrack(const Track& track);
    std::string ResolveCachedPath(const Track& track);
    void PlaybackTask();
    static void CacheTaskEntry(void* arg);
    static void PlaybackTaskEntry(void* arg);

    std::atomic<bool> playing_{false};
    std::atomic<bool> stop_requested_{false};
    std::atomic<bool> cache_in_progress_{false};
    std::vector<Track> tracks_;
    int current_index_ = 0;
    Track current_track_;
    std::string current_url_;
    std::string current_title_ = "服务器播客";
    std::string current_format_;
    std::string last_error_ = "服务器播客待命";
};

#endif
