#include "app_server_music_player.h"

#include "app_audio_session_manager.h"
#include "app_backend_client.h"
#include "app_storage_manager.h"
#include "application.h"

#include <cJSON.h>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/idf_additions.h>
#include <freertos/task.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha256.h>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>

namespace {
constexpr const char* TAG = "AppServerMusic";

std::string JsonString(cJSON* object, const char* key, const std::string& fallback = "") {
    auto item = cJSON_GetObjectItem(object, key);
    if (cJSON_IsString(item) && item->valuestring != nullptr) {
        return item->valuestring;
    }
    return fallback;
}

int JsonInt(cJSON* object, const char* key, int fallback = 0) {
    auto item = cJSON_GetObjectItem(object, key);
    if (cJSON_IsNumber(item)) {
        return item->valueint;
    }
    return fallback;
}

std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool IsMp3Format(const std::string& format) {
    const std::string lower = Lower(format);
    return lower == "mp3" || lower == "audio/mpeg" || lower == "audio/mp3" ||
           lower.find("mpeg") != std::string::npos;
}

bool IsSafeRelativePath(const std::string& path) {
    return !path.empty() && path[0] != '/' && path.find("..") == std::string::npos;
}

bool FileExists(const std::string& path) {
    struct stat st = {};
    return stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode);
}

bool FileSizeMatches(const std::string& path, int expected_size) {
    if (expected_size <= 0) {
        return true;
    }
    struct stat st = {};
    return stat(path.c_str(), &st) == 0 && static_cast<int>(st.st_size) == expected_size;
}

bool EnsureDirectoryTree(const std::string& dir) {
    if (dir.empty()) {
        return false;
    }
    std::string current;
    current.reserve(dir.size());
    for (size_t i = 0; i < dir.size(); ++i) {
        current.push_back(dir[i]);
        if (dir[i] != '/' || current.size() <= 1) {
            continue;
        }
        mkdir(current.c_str(), 0755);
    }
    mkdir(dir.c_str(), 0755);
    struct stat st = {};
    return stat(dir.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

std::string Sha256Hex(const unsigned char digest[32]) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string out;
    out.resize(64);
    for (int i = 0; i < 32; ++i) {
        out[i * 2] = kHex[(digest[i] >> 4) & 0x0F];
        out[i * 2 + 1] = kHex[digest[i] & 0x0F];
    }
    return out;
}

bool FileSha256(const std::string& path, std::string& hex) {
    FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        return false;
    }

    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    bool ok = mbedtls_sha256_starts(&sha, 0) == 0;
    unsigned char buffer[2048];
    while (ok) {
        const size_t read = std::fread(buffer, 1, sizeof(buffer), file);
        if (read > 0 && mbedtls_sha256_update(&sha, buffer, read) != 0) {
            ok = false;
            break;
        }
        if (read < sizeof(buffer)) {
            break;
        }
    }
    if (ok) {
        unsigned char digest[32] = {};
        ok = mbedtls_sha256_finish(&sha, digest) == 0;
        if (ok) {
            hex = Sha256Hex(digest);
        }
    }
    mbedtls_sha256_free(&sha);
    std::fclose(file);
    return ok;
}

std::string ExtensionFromFormat(const std::string& format) {
    if (IsMp3Format(format)) {
        return ".mp3";
    }
    const std::string lower = Lower(format);
    if (lower == "opus") {
        return ".opus";
    }
    return ".ogg";
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

std::string FileNameOf(const std::string& path) {
    const auto pos = path.find_last_of("/\\");
    return pos == std::string::npos ? path : path.substr(pos + 1);
}

std::string DecodeEncodedAudioName(const std::string& value) {
    if (value.size() < 8 || value.find_first_of(" \t\r\n") != std::string::npos) {
        return value;
    }

    std::string encoded = value;
    for (char& ch : encoded) {
        if (ch == '-') {
            ch = '+';
        } else if (ch == '_') {
            ch = '/';
        } else if (!(std::isalnum(static_cast<unsigned char>(ch)) || ch == '+' || ch == '/' || ch == '=')) {
            return value;
        }
    }
    while (encoded.size() % 4 != 0) {
        encoded.push_back('=');
    }

    size_t output_size = 0;
    if (mbedtls_base64_decode(nullptr, 0, &output_size,
                              reinterpret_cast<const unsigned char*>(encoded.data()), encoded.size()) !=
            MBEDTLS_ERR_BASE64_BUFFER_TOO_SMALL ||
        output_size == 0 || output_size > 256) {
        return value;
    }

    std::string decoded(output_size, '\0');
    if (mbedtls_base64_decode(reinterpret_cast<unsigned char*>(decoded.data()), decoded.size(), &output_size,
                              reinterpret_cast<const unsigned char*>(encoded.data()), encoded.size()) != 0) {
        return value;
    }
    decoded.resize(output_size);

    const std::string lower = Lower(decoded);
    const bool audio_name = lower.size() >= 4 &&
                            (lower.rfind(".mp3") == lower.size() - 4 ||
                             lower.rfind(".ogg") == lower.size() - 4 ||
                             (lower.size() >= 5 && lower.rfind(".opus") == lower.size() - 5));
    return audio_name ? FileNameOf(decoded) : value;
}

std::string NormalizeDisplayTitle(const std::string& value) {
    return StripAudioExtension(FileNameOf(DecodeEncodedAudioName(value)));
}
} // namespace

AppServerMusicPlayer& AppServerMusicPlayer::GetInstance() {
    static AppServerMusicPlayer instance;
    return instance;
}

bool AppServerMusicPlayer::Play(const std::string& preferred_url, const std::string& preferred_title,
                                const std::string& preferred_format,
                                const std::string& preferred_download_url,
                                const std::string& preferred_sha256,
                                const std::string& preferred_cache_path,
                                int preferred_size,
                                const std::string& preferred_id,
                                int preferred_duration_sec,
                                const std::string& preferred_artist,
                                const std::string& preferred_source) {
    if (playing_.load()) {
        Stop();
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    if (!preferred_url.empty()) {
        Track track;
        track.id = preferred_id;
        track.title = preferred_title.empty() ? "服务器播客" : preferred_title;
        track.artist = preferred_artist;
        track.source = preferred_source;
        track.url = preferred_url;
        track.format = preferred_format;
        track.content_type = preferred_format;
        track.download_url = preferred_download_url;
        track.sha256 = preferred_sha256;
        track.cache_path = preferred_cache_path;
        track.size = preferred_size;
        track.duration_sec = preferred_duration_sec;
        return StartTrack(track);
    }
    return StartCurrent();
}

bool AppServerMusicPlayer::PlayPause(const std::string& preferred_url, const std::string& preferred_title,
                                     const std::string& preferred_format,
                                     const std::string& preferred_download_url,
                                     const std::string& preferred_sha256,
                                     const std::string& preferred_cache_path,
                                     int preferred_size,
                                     const std::string& preferred_id,
                                     int preferred_duration_sec,
                                     const std::string& preferred_artist,
                                     const std::string& preferred_source) {
    if (playing_.load()) {
        Stop();
        last_error_ = "服务器播客已暂停";
        return true;
    }
    if (!preferred_url.empty()) {
        Track track;
        track.id = preferred_id;
        track.title = preferred_title.empty() ? "服务器播客" : preferred_title;
        track.artist = preferred_artist;
        track.source = preferred_source;
        track.url = preferred_url;
        track.format = preferred_format;
        track.content_type = preferred_format;
        track.download_url = preferred_download_url;
        track.sha256 = preferred_sha256;
        track.cache_path = preferred_cache_path;
        track.size = preferred_size;
        track.duration_sec = preferred_duration_sec;
        return StartTrack(track);
    }
    return StartCurrent();
}

bool AppServerMusicPlayer::Next() {
    Stop();
    if (tracks_.empty() && !RefreshTracks()) {
        return false;
    }
    if (tracks_.empty()) {
        last_error_ = "未发现服务器播客";
        return false;
    }
    current_index_ = (current_index_ + 1) % static_cast<int>(tracks_.size());
    return StartCurrent();
}

bool AppServerMusicPlayer::Previous() {
    Stop();
    if (tracks_.empty() && !RefreshTracks()) {
        return false;
    }
    if (tracks_.empty()) {
        last_error_ = "未发现服务器播客";
        return false;
    }
    current_index_ = (current_index_ - 1 + static_cast<int>(tracks_.size())) % static_cast<int>(tracks_.size());
    return StartCurrent();
}

bool AppServerMusicPlayer::SeekRelative(int delta_seconds) {
    (void)delta_seconds;
    last_error_ = "暂不支持快进快退";
    return false;
}

void AppServerMusicPlayer::Stop() {
    stop_requested_.store(true);
    const bool was_playing = playing_.exchange(false);
    if (was_playing) {
        Application::GetInstance().GetAudioService().ResetDecoder();
    }
    AppAudioSessionManager::GetInstance().Release(AppAudioSessionType::kMusic);
}

std::string AppServerMusicPlayer::StatusLine() const {
    if (playing_.load()) {
        return "播放 " + CurrentTitle();
    }
    return last_error_;
}

std::string AppServerMusicPlayer::CurrentTitle() const {
    return current_title_.empty() ? "服务器播客" : current_title_;
}

std::string AppServerMusicPlayer::DisplayTitle() const {
    return NormalizeDisplayTitle(CurrentTitle());
}

std::string AppServerMusicPlayer::MetadataLine() const {
    const std::string artist = current_track_.artist.empty() ? "家庭媒体" : current_track_.artist;
    const std::string source = current_track_.source.empty() ? "在线" : current_track_.source;
    return artist + " · " + source;
}

int AppServerMusicPlayer::position_ms() const {
    return Application::GetInstance().GetAudioService().media_position_ms();
}

int AppServerMusicPlayer::duration_ms() const {
    if (current_track_.duration_sec > 0) {
        return current_track_.duration_sec * 1000;
    }
    return Application::GetInstance().GetAudioService().media_duration_ms();
}

bool AppServerMusicPlayer::has_reliable_duration() const {
    return duration_ms() > 0;
}

bool AppServerMusicPlayer::RefreshTracks() {
    std::string body;
    std::string error;
    if (!AppBackendClient::GetInstance().FetchServerTracks(body, error)) {
        last_error_ = "曲目拉取失败";
        return false;
    }

    cJSON* root = cJSON_Parse(body.c_str());
    if (root == nullptr) {
        last_error_ = "曲目 JSON 无效";
        return false;
    }
    cJSON* data = cJSON_GetObjectItem(root, "data");
    if (!cJSON_IsObject(data)) {
        data = root;
    }
    cJSON* tracks = cJSON_GetObjectItem(data, "tracks");
    if (!cJSON_IsArray(tracks)) {
        cJSON_Delete(root);
        last_error_ = "曲目列表为空";
        return false;
    }

    tracks_.clear();
    const int count = cJSON_GetArraySize(tracks);
    for (int i = 0; i < count && i < 32; ++i) {
        cJSON* item = cJSON_GetArrayItem(tracks, i);
        if (!cJSON_IsObject(item)) {
            continue;
        }
        Track track;
        track.id = JsonString(item, "id");
        track.title = JsonString(item, "title", "服务器播客");
        track.artist = JsonString(item, "artist", "Family Server");
        track.source = JsonString(item, "source", "在线");
        track.url = JsonString(item, "streamUrl", JsonString(item, "stream_url"));
        track.format = JsonString(item, "format");
        track.content_type = JsonString(item, "contentType", JsonString(item, "content_type"));
        track.download_url = JsonString(item, "downloadUrl", JsonString(item, "download_url", track.url));
        track.sha256 = JsonString(item, "sha256");
        track.cache_path = JsonString(item, "cachePath", JsonString(item, "cache_path"));
        auto size = cJSON_GetObjectItem(item, "size");
        if (cJSON_IsNumber(size)) {
            track.size = size->valueint;
        }
        track.duration_sec = JsonInt(item, "durationSec", JsonInt(item, "duration_sec"));
        if (!track.url.empty()) {
            tracks_.push_back(track);
        }
    }
    cJSON_Delete(root);
    if (current_index_ >= static_cast<int>(tracks_.size())) {
        current_index_ = 0;
    }
    last_error_ = tracks_.empty() ? "未发现服务器播客" : ("发现 " + std::to_string(tracks_.size()) + " 项");
    return !tracks_.empty();
}

bool AppServerMusicPlayer::StartTrack(const Track& track) {
    if (track.url.empty()) {
        last_error_ = "服务器播客地址为空";
        return false;
    }
    if (!AppAudioSessionManager::GetInstance().Request(AppAudioSessionType::kMusic, "服务器播客")) {
        last_error_ = "AI/课程占用音频";
        return false;
    }

    current_track_ = track;
    current_url_ = track.url;
    current_title_ = track.title.empty() ? "服务器播客" : track.title;
    current_format_ = !track.content_type.empty() ? track.content_type : track.format;
    stop_requested_.store(false);
    playing_.store(true);
    last_error_ = "播放 " + current_title_;
    ESP_LOGI(TAG, "Start server podcast: %s", current_title_.c_str());
    if (xTaskCreateWithCaps(PlaybackTaskEntry, "srv_music", 8192, this, 2, nullptr,
                            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) {
        playing_.store(false);
        AppAudioSessionManager::GetInstance().Release(AppAudioSessionType::kMusic);
        last_error_ = "创建播放任务失败";
        return false;
    }
    return true;
}

bool AppServerMusicPlayer::StartCurrent() {
    if (tracks_.empty() && !RefreshTracks()) {
        return false;
    }
    if (tracks_.empty()) {
        last_error_ = "未发现服务器播客";
        return false;
    }
    const auto& track = tracks_[current_index_];
    return StartTrack(track);
}

std::string AppServerMusicPlayer::ResolveCachedPath(const Track& track) {
    auto& storage = AppStorageManager::GetInstance();
    if (!storage.mounted()) {
        return "";
    }

    std::string relative = track.cache_path;
    if (!IsSafeRelativePath(relative)) {
        relative = "music/cache/server-" + (track.id.empty() ? "current" : track.id) +
                   ExtensionFromFormat(!track.content_type.empty() ? track.content_type : track.format);
    }
    const std::string path = storage.status().mount_point + "/" + relative;
    if (!FileExists(path) || !FileSizeMatches(path, track.size)) {
        return "";
    }
    if (!track.sha256.empty()) {
        std::string actual;
        if (!FileSha256(path, actual) || actual != track.sha256) {
            ESP_LOGW(TAG, "cached podcast sha mismatch: %s", path.c_str());
            return "";
        }
    }
    return path;
}

bool AppServerMusicPlayer::CacheTrack(const Track& track) {
    auto& storage = AppStorageManager::GetInstance();
    if (!storage.mounted()) {
        last_error_ = "SD 未挂载，无法缓存";
        return false;
    }
    if (track.url.empty() && track.download_url.empty()) {
        last_error_ = "播客下载地址为空";
        return false;
    }

    std::string relative = track.cache_path;
    if (!IsSafeRelativePath(relative)) {
        relative = "music/cache/server-" + (track.id.empty() ? "current" : track.id) +
                   ExtensionFromFormat(!track.content_type.empty() ? track.content_type : track.format);
    }
    const std::string target = storage.status().mount_point + "/" + relative;
    const std::string tmp = target + ".tmp";

    const auto slash = target.find_last_of('/');
    if (slash != std::string::npos) {
        const std::string dir = target.substr(0, slash);
        if (!EnsureDirectoryTree(dir)) {
            last_error_ = "缓存目录创建失败";
            return false;
        }
    }

    if (!ResolveCachedPath(track).empty()) {
        last_error_ = "播客已缓存";
        return true;
    }

    std::string actual_sha;
    std::string error;
    const std::string url = track.download_url.empty() ? track.url : track.download_url;
    constexpr size_t kMaxPodcastCacheBytes = 80 * 1024 * 1024;
    ESP_LOGI(TAG, "Cache server podcast: %s -> %s", url.c_str(), target.c_str());
    {
        std::lock_guard<std::recursive_mutex> fs_lock(storage.filesystem_mutex());
        unlink(tmp.c_str());
        if (!AppBackendClient::GetInstance().DownloadToFile(url, tmp, kMaxPodcastCacheBytes, actual_sha, error)) {
            last_error_ = "缓存失败: " + error;
            unlink(tmp.c_str());
            return false;
        }
        if (!track.sha256.empty() && actual_sha != track.sha256) {
            last_error_ = "缓存校验失败";
            unlink(tmp.c_str());
            return false;
        }
        unlink(target.c_str());
        if (rename(tmp.c_str(), target.c_str()) != 0) {
            last_error_ = "缓存保存失败";
            unlink(tmp.c_str());
            return false;
        }
    }
    storage.Refresh();
    last_error_ = "已缓存 " + (track.title.empty() ? std::string("服务器播客") : track.title);
    return true;
}

bool AppServerMusicPlayer::CacheCurrent(const std::string& preferred_url, const std::string& preferred_title,
                                        const std::string& preferred_format,
                                        const std::string& preferred_download_url,
                                        const std::string& preferred_sha256,
                                        const std::string& preferred_cache_path,
                                        int preferred_size,
                                        const std::string& preferred_id) {
    if (cache_in_progress_.exchange(true)) {
        last_error_ = "播客正在缓存";
        return false;
    }

    Track track = current_track_;
    if (!preferred_url.empty()) {
        track.id = preferred_id;
        track.title = preferred_title.empty() ? "服务器播客" : preferred_title;
        track.url = preferred_url;
        track.format = preferred_format;
        track.content_type = preferred_format;
        track.download_url = preferred_download_url;
        track.sha256 = preferred_sha256;
        track.cache_path = preferred_cache_path;
        track.size = preferred_size;
    } else if (track.url.empty()) {
        if (tracks_.empty() && !RefreshTracks()) {
            cache_in_progress_.store(false);
            return false;
        }
        if (tracks_.empty()) {
            last_error_ = "未发现服务器播客";
            cache_in_progress_.store(false);
            return false;
        }
        track = tracks_[current_index_];
    }

    auto* job = new Track(track);
    if (xTaskCreateWithCaps(CacheTaskEntry, "srv_cache", 8192, job, 2, nullptr,
                            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS) {
        delete job;
        cache_in_progress_.store(false);
        last_error_ = "创建缓存任务失败";
        return false;
    }
    last_error_ = "开始缓存 " + (track.title.empty() ? std::string("服务器播客") : track.title);
    return true;
}

void AppServerMusicPlayer::PlaybackTask() {
    const std::string url = current_url_;
    const std::string format = current_format_;
    const Track track = current_track_;
    bool ok = false;
    const std::string cached_path = ResolveCachedPath(track);
    if (!cached_path.empty()) {
        ESP_LOGI(TAG, "Play cached server podcast: %s", cached_path.c_str());
        if (IsMp3Format(format)) {
            ok = Application::GetInstance().GetAudioService().PlayMp3File(cached_path, [this]() {
                return stop_requested_.load();
            });
        } else {
            ok = Application::GetInstance().GetAudioService().PlayOggFile(cached_path, [this]() {
                return stop_requested_.load();
            });
        }
    } else if (!url.empty()) {
        if (IsMp3Format(format)) {
            ok = Application::GetInstance().GetAudioService().PlayMp3Url(url, [this]() {
                return stop_requested_.load();
            });
        } else {
            ok = Application::GetInstance().GetAudioService().PlayOggUrl(url, [this]() {
                return stop_requested_.load();
            });
        }
    }
    if (!stop_requested_.load()) {
        Application::GetInstance().GetAudioService().WaitForPlaybackQueueEmpty();
        last_error_ = ok ? "服务器播客播放完成" : "服务器播客播放失败";
        if (ok && !track.id.empty()) {
            AppBackendClient::GetInstance().PostServerMediaProgress(track.id, 0, 0, true);
        }
        ESP_LOGI(TAG, "Server podcast finished: %s", ok ? "ok" : "failed");
    }
    playing_.store(false);
    AppAudioSessionManager::GetInstance().Release(AppAudioSessionType::kMusic);
}

void AppServerMusicPlayer::CacheTaskEntry(void* arg) {
    auto* track = static_cast<Track*>(arg);
    AppServerMusicPlayer::GetInstance().CacheTrack(*track);
    AppServerMusicPlayer::GetInstance().cache_in_progress_.store(false);
    delete track;
    vTaskDeleteWithCaps(nullptr);
}

void AppServerMusicPlayer::PlaybackTaskEntry(void* arg) {
    static_cast<AppServerMusicPlayer*>(arg)->PlaybackTask();
    vTaskDeleteWithCaps(nullptr);
}
