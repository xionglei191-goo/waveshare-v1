#include "audio_service.h"
#include <esp_log.h>
#include <esp_http_client.h>
#include <esp_wifi.h>
#include <freertos/idf_additions.h>
#include <algorithm>
#include <cstring>
#include <cstdio>
#include <atomic>
#include <sys/stat.h>

#define RATE_CVT_CFG(_src_rate, _dest_rate, _channel)        \
    (esp_ae_rate_cvt_cfg_t)                                  \
    {                                                        \
        .src_rate        = (uint32_t)(_src_rate),            \
        .dest_rate       = (uint32_t)(_dest_rate),           \
        .channel         = (uint8_t)(_channel),              \
        .bits_per_sample = ESP_AUDIO_BIT16,                  \
        .complexity      = 2,                                \
        .perf_type       = ESP_AE_RATE_CVT_PERF_TYPE_SPEED,  \
    }

#define OPUS_DEC_CFG(_sample_rate, _frame_duration_ms)                                                    \
    (esp_opus_dec_cfg_t)                                                                                  \
    {                                                                                                     \
        .sample_rate    = (uint32_t)(_sample_rate),                                                       \
        .channel        = ESP_AUDIO_MONO,                                                                 \
        .frame_duration = (esp_opus_dec_frame_duration_t)AS_OPUS_GET_FRAME_DRU_ENUM(_frame_duration_ms),  \
        .self_delimited = false,                                                                          \
    }

#if CONFIG_USE_AUDIO_PROCESSOR
#include "processors/afe_audio_processor.h"
#else
#include "processors/no_audio_processor.h"
#endif

#if CONFIG_IDF_TARGET_ESP32S3 || CONFIG_IDF_TARGET_ESP32P4
#include "wake_words/afe_wake_word.h"
#include "wake_words/custom_wake_word.h"
#else
#include "wake_words/esp_wake_word.h"
#endif

#define TAG "AudioService"

namespace {
class WifiPowerSaveGuard {
public:
    WifiPowerSaveGuard() {
        restore_ = esp_wifi_get_ps(&previous_) == ESP_OK;
        esp_wifi_set_ps(WIFI_PS_NONE);
    }
    ~WifiPowerSaveGuard() {
        if (restore_) {
            esp_wifi_set_ps(previous_);
        }
    }

private:
    wifi_ps_type_t previous_ = WIFI_PS_MAX_MODEM;
    bool restore_ = false;
};

// MPEG audio bitrate (kbps) tables keyed by "<version>-<layer>", and sample-rate
// tables keyed by version. Used to estimate MP3 duration from the first frame
// header without decoding the whole file.
const int kMp3BitrateKbps[6][16] = {
    {0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0}, // MPEG1 Layer I
    {0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0},    // MPEG1 Layer II
    {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0},     // MPEG1 Layer III
    {0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0},    // MPEG2 Layer I
    {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},         // MPEG2 Layer II
    {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},         // MPEG2 Layer III
};
const int kMp3SampleRate[3][4] = {
    {11025, 12000, 8000, 0},  // MPEG2.5
    {22050, 24000, 16000, 0}, // MPEG2
    {44100, 48000, 32000, 0}, // MPEG1
};

// Estimate an MP3 file's duration in milliseconds by parsing its first audio
// frame header. Prefers a Xing/Info VBR header for accuracy; otherwise falls
// back to file-size / bitrate (accurate for CBR). Returns 0 on any failure.
int Mp3DurationMsFromFile(const std::string& path, int file_bytes) {
    FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        return 0;
    }
    int result_ms = 0;
    do {
        unsigned char head[16];
        if (std::fread(head, 1, 10, file) < 10) {
            break;
        }
        // Skip an ID3v2 tag if present.
        long offset = 0;
        if (head[0] == 'I' && head[1] == 'D' && head[2] == '3') {
            offset = 10 + (long)((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 |
                                 (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
        }
        if (std::fseek(file, offset, SEEK_SET) != 0) {
            break;
        }
        unsigned char scan[4096];
        const size_t scan_read = std::fread(scan, 1, sizeof(scan), file);
        for (size_t i = 0; i + 4 <= scan_read; ++i) {
            if (scan[i] != 0xff || (scan[i + 1] & 0xe0) != 0xe0) {
                continue;
            }
            const int version_id = (scan[i + 1] >> 3) & 0x03; // 3=MPEG1,2=MPEG2,0=MPEG2.5
            const int layer_id = (scan[i + 1] >> 1) & 0x03;   // 3=I,2=II,1=III
            const int bitrate_idx = (scan[i + 2] >> 4) & 0x0f;
            const int sample_idx = (scan[i + 2] >> 2) & 0x03;
            if (version_id == 1 || layer_id == 0 || bitrate_idx == 0 || bitrate_idx == 15 ||
                sample_idx == 3) {
                continue; // reserved/invalid
            }
            const int version_row = version_id == 3 ? 0 : 1;      // MPEG1 vs MPEG2
            const int layer_off = 3 - layer_id;                   // 0=I,1=II,2=III
            const int bitrate = kMp3BitrateKbps[version_row * 3 + layer_off][bitrate_idx] * 1000;
            const int sr_row = version_id == 3 ? 2 : (version_id == 2 ? 1 : 0);
            const int sample_rate = kMp3SampleRate[sr_row][sample_idx];
            if (bitrate <= 0 || sample_rate <= 0) {
                break;
            }
            const int samples_per_frame =
                layer_id == 3 ? 384 : (layer_id == 2 ? 1152 : (version_id == 3 ? 1152 : 576));

            // Look for a Xing/Info VBR header inside this first frame.
            const int channel_mode = (scan[i + 3] >> 6) & 0x03; // 3=mono
            const size_t xing_off = i + 4 + (version_id == 3 ? (channel_mode == 3 ? 17 : 32)
                                                             : (channel_mode == 3 ? 9 : 17));
            if (xing_off + 12 <= scan_read &&
                ((scan[xing_off] == 'X' && scan[xing_off + 1] == 'i' && scan[xing_off + 2] == 'n' &&
                  scan[xing_off + 3] == 'g') ||
                 (scan[xing_off] == 'I' && scan[xing_off + 1] == 'n' && scan[xing_off + 2] == 'f' &&
                  scan[xing_off + 3] == 'o'))) {
                const uint32_t flags = (uint32_t)scan[xing_off + 4] << 24 |
                                       (uint32_t)scan[xing_off + 5] << 16 |
                                       (uint32_t)scan[xing_off + 6] << 8 | scan[xing_off + 7];
                if (flags & 0x01) {
                    const uint32_t frame_count = (uint32_t)scan[xing_off + 8] << 24 |
                                                 (uint32_t)scan[xing_off + 9] << 16 |
                                                 (uint32_t)scan[xing_off + 10] << 8 |
                                                 scan[xing_off + 11];
                    if (frame_count > 0) {
                        result_ms = (int)((uint64_t)frame_count * samples_per_frame * 1000 / sample_rate);
                        break;
                    }
                }
            }
            // No VBR header: assume CBR and use file size over bitrate.
            const long audio_bytes = (long)file_bytes - (offset + (long)i);
            if (file_bytes > 0 && audio_bytes > 0) {
                result_ms = (int)((uint64_t)audio_bytes * 8 * 1000 / bitrate);
            }
            break;
        }
    } while (false);
    std::fclose(file);
    return result_ms;
}

constexpr EventBits_t kMp3EventFinished = BIT0;
constexpr EventBits_t kMp3EventError = BIT1;

struct Mp3PlaybackContext {
    AudioService* service = nullptr;
    EventGroupHandle_t event_group = nullptr;
    std::atomic<bool> data_seen{false};
    std::atomic<bool> stop_requested{false};
    // Decoded PCM stream parameters, populated from the MUSIC_INFO event.
    std::atomic<int> sample_rate{0};
    std::atomic<int> channels{0};
    // Total decoded sample frames output so far (per channel).
    std::atomic<uint64_t> played_frames{0};
    // Source file size in bytes, used with bitrate to estimate duration.
    // Zero for streaming/URL playback where the size is unknown.
    int file_bytes = 0;
    // True when duration was seeded from a parsed file header (Xing/CBR), which
    // is more accurate than the MUSIC_INFO bitrate estimate; prevents the event
    // callback from overwriting a good value.
    bool duration_from_header = false;
};
} // namespace

AudioService::AudioService() {
    event_group_ = xEventGroupCreate();
}

AudioService::~AudioService() {
    if (event_group_ != nullptr) {
        vEventGroupDelete(event_group_);
    }
    if (opus_encoder_ != nullptr) {
        esp_opus_enc_close(opus_encoder_);
    }
    if (opus_decoder_ != nullptr) {
        esp_opus_dec_close(opus_decoder_);
    }
    if (input_resampler_ != nullptr) {
        esp_ae_rate_cvt_close(input_resampler_);
    }
    if (output_resampler_ != nullptr) {
        esp_ae_rate_cvt_close(output_resampler_);
    }
}

void AudioService::Initialize(AudioCodec* codec) {
    codec_ = codec;
    codec_->Start();

    esp_opus_dec_cfg_t opus_dec_cfg = OPUS_DEC_CFG(codec->output_sample_rate(), OPUS_FRAME_DURATION_MS);
    auto ret = esp_opus_dec_open(&opus_dec_cfg, sizeof(esp_opus_dec_cfg_t), &opus_decoder_);
    if (opus_decoder_ == nullptr) {
        ESP_LOGE(TAG, "Failed to create audio decoder, error code: %d", ret);
    } else {
        decoder_sample_rate_ = codec->output_sample_rate();
        decoder_duration_ms_ = OPUS_FRAME_DURATION_MS;
        decoder_frame_size_ = decoder_sample_rate_ / 1000 * OPUS_FRAME_DURATION_MS;
    }
    esp_opus_enc_config_t opus_enc_cfg = AS_OPUS_ENC_CONFIG();
    ret = esp_opus_enc_open(&opus_enc_cfg, sizeof(esp_opus_enc_config_t), &opus_encoder_);
    if (opus_encoder_ == nullptr) {
        ESP_LOGE(TAG, "Failed to create audio encoder, error code: %d", ret);
    } else {
        encoder_sample_rate_ = 16000;
        encoder_duration_ms_ = OPUS_FRAME_DURATION_MS;
        esp_opus_enc_get_frame_size(opus_encoder_, &encoder_frame_size_, &encoder_outbuf_size_);
        encoder_frame_size_ = encoder_frame_size_ / sizeof(int16_t);
    }

    if (codec->input_sample_rate() != 16000) {
        esp_ae_rate_cvt_cfg_t input_resampler_cfg = RATE_CVT_CFG(
            codec->input_sample_rate(), ESP_AUDIO_SAMPLE_RATE_16K, codec->input_channels());
        auto resampler_ret = esp_ae_rate_cvt_open(&input_resampler_cfg, &input_resampler_);
        if (input_resampler_ == nullptr) {
            ESP_LOGE(TAG, "Failed to create input resampler, error code: %d", resampler_ret);
        }
    }

#if CONFIG_USE_AUDIO_PROCESSOR
    audio_processor_ = std::make_unique<AfeAudioProcessor>();
#else
    audio_processor_ = std::make_unique<NoAudioProcessor>();
#endif

    audio_processor_->OnOutput([this](std::vector<int16_t>&& data) {
        PushTaskToEncodeQueue(kAudioTaskTypeEncodeToSendQueue, std::move(data));
    });

    audio_processor_->OnVadStateChange([this](bool speaking) {
        voice_detected_ = speaking;
        if (callbacks_.on_vad_change) {
            callbacks_.on_vad_change(speaking);
        }
    });

    esp_timer_create_args_t audio_power_timer_args = {
        .callback = [](void* arg) {
            AudioService* audio_service = (AudioService*)arg;
            audio_service->CheckAndUpdateAudioPowerState();
        },
        .arg = this,
        .dispatch_method = ESP_TIMER_TASK,
        .name = "audio_power_timer",
        .skip_unhandled_events = true,
    };
    esp_timer_create(&audio_power_timer_args, &audio_power_timer_);
}

void AudioService::Start() {
    service_stopped_ = false;
    xEventGroupClearBits(event_group_, AS_EVENT_AUDIO_TESTING_RUNNING | AS_EVENT_WAKE_WORD_RUNNING | AS_EVENT_AUDIO_PROCESSOR_RUNNING);

    esp_timer_start_periodic(audio_power_timer_, 1000000);

#if CONFIG_USE_AUDIO_PROCESSOR
    /* Start the audio input task */
    xTaskCreatePinnedToCore([](void* arg) {
        AudioService* audio_service = (AudioService*)arg;
        audio_service->AudioInputTask();
        vTaskDelete(NULL);
    }, "audio_input", 2048 * 3, this, 8, &audio_input_task_handle_, 0);

    /* Start the audio output task */
    xTaskCreate([](void* arg) {
        AudioService* audio_service = (AudioService*)arg;
        audio_service->AudioOutputTask();
        vTaskDelete(NULL);
    }, "audio_output", 2048 * 2, this, 4, &audio_output_task_handle_);
#else
    /* Start the audio input task */
    xTaskCreate([](void* arg) {
        AudioService* audio_service = (AudioService*)arg;
        audio_service->AudioInputTask();
        vTaskDelete(NULL);
    }, "audio_input", 2048 * 2, this, 8, &audio_input_task_handle_);

    /* Start the audio output task */
    xTaskCreate([](void* arg) {
        AudioService* audio_service = (AudioService*)arg;
        audio_service->AudioOutputTask();
        vTaskDelete(NULL);
    }, "audio_output", 2048, this, 4, &audio_output_task_handle_);
#endif

    /* Start the opus codec task */
    xTaskCreateWithCaps([](void* arg) {
        AudioService* audio_service = (AudioService*)arg;
        audio_service->OpusCodecTask();
        vTaskDeleteWithCaps(nullptr);
    }, "opus_codec", 2048 * 12, this, 5, &opus_codec_task_handle_,
        MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
}

void AudioService::Stop() {
    esp_timer_stop(audio_power_timer_);
    service_stopped_ = true;
    xEventGroupSetBits(event_group_, AS_EVENT_AUDIO_TESTING_RUNNING |
        AS_EVENT_WAKE_WORD_RUNNING |
        AS_EVENT_AUDIO_PROCESSOR_RUNNING);

    std::lock_guard<std::mutex> lock(audio_queue_mutex_);
    audio_encode_queue_.clear();
    audio_decode_queue_.clear();
    audio_playback_queue_.clear();
    audio_testing_queue_.clear();
    audio_queue_cv_.notify_all();
}

bool AudioService::ReadAudioData(std::vector<int16_t>& data, int sample_rate, int samples) {
    if (!codec_->input_enabled()) {
        esp_timer_stop(audio_power_timer_);
        esp_timer_start_periodic(audio_power_timer_, AUDIO_POWER_CHECK_INTERVAL_MS * 1000);
        codec_->EnableInput(true);
    }

    if (codec_->input_sample_rate() != sample_rate) {
        data.resize(samples * codec_->input_sample_rate() / sample_rate * codec_->input_channels());
        if (!codec_->InputData(data)) {
            return false;
        }
        if (input_resampler_ != nullptr) {
            std::lock_guard<std::mutex> lock(input_resampler_mutex_);
            uint32_t in_sample_num = data.size() / codec_->input_channels();
            uint32_t output_samples = 0;
            esp_ae_rate_cvt_get_max_out_sample_num(input_resampler_, in_sample_num, &output_samples);
            auto resampled = std::vector<int16_t>(output_samples * codec_->input_channels());
            uint32_t actual_output = output_samples;
            esp_ae_rate_cvt_process(input_resampler_, (esp_ae_sample_t)data.data(), in_sample_num,
                                   (esp_ae_sample_t)resampled.data(), &actual_output);
            resampled.resize(actual_output * codec_->input_channels());
            data = std::move(resampled);
        }
    } else {
        data.resize(samples * codec_->input_channels());
        if (!codec_->InputData(data)) {
            return false;
        }
    }

    /* Update the last input time */
    last_input_time_ = std::chrono::steady_clock::now();
    debug_statistics_.input_count++;

#if CONFIG_USE_AUDIO_DEBUGGER
    // 音频调试：发送原始音频数据
    if (audio_debugger_ == nullptr) {
        audio_debugger_ = std::make_unique<AudioDebugger>();
    }
    audio_debugger_->Feed(data);
#endif

    return true;
}

void AudioService::AudioInputTask() {
    while (true) {
        EventBits_t bits = xEventGroupWaitBits(event_group_, AS_EVENT_AUDIO_TESTING_RUNNING |
            AS_EVENT_WAKE_WORD_RUNNING | AS_EVENT_AUDIO_PROCESSOR_RUNNING,
            pdFALSE, pdFALSE, portMAX_DELAY);

        if (service_stopped_) {
            break;
        }
        if (audio_input_need_warmup_) {
            audio_input_need_warmup_ = false;
            vTaskDelay(pdMS_TO_TICKS(120));
            continue;
        }

        /* Used for audio testing in NetworkConfiguring mode by clicking the BOOT button */
        if (bits & AS_EVENT_AUDIO_TESTING_RUNNING) {
            if (audio_testing_queue_.size() >= AUDIO_TESTING_MAX_DURATION_MS / OPUS_FRAME_DURATION_MS) {
                ESP_LOGW(TAG, "Audio testing queue is full, stopping audio testing");
                EnableAudioTesting(false);
                continue;
            }
            std::vector<int16_t> data;
            int samples = OPUS_FRAME_DURATION_MS * 16000 / 1000;
            if (ReadAudioData(data, 16000, samples)) {
                // If input channels is 2, we need to fetch the left channel data
                if (codec_->input_channels() == 2) {
                    auto mono_data = std::vector<int16_t>(data.size() / 2);
                    for (size_t i = 0, j = 0; i < mono_data.size(); ++i, j += 2) {
                        mono_data[i] = data[j];
                    }
                    data = std::move(mono_data);
                }
                PushTaskToEncodeQueue(kAudioTaskTypeEncodeToTestingQueue, std::move(data));
                continue;
            }
        }

        /* Feed the wake word and/or audio processor */
        if (bits & (AS_EVENT_WAKE_WORD_RUNNING | AS_EVENT_AUDIO_PROCESSOR_RUNNING)) {
            int samples = 160; // 10ms
            std::vector<int16_t> data;
            if (ReadAudioData(data, 16000, samples)) {
                if (bits & AS_EVENT_WAKE_WORD_RUNNING) {
                    wake_word_->Feed(data);
                }
                if (bits & AS_EVENT_AUDIO_PROCESSOR_RUNNING) {
                    audio_processor_->Feed(std::move(data));
                }
                continue;
            }
        }

        // Read timeout/error should not terminate the input task.
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    ESP_LOGW(TAG, "Audio input task stopped");
}

void AudioService::AudioOutputTask() {
    while (true) {
        std::unique_lock<std::mutex> lock(audio_queue_mutex_);
        audio_queue_cv_.wait(lock, [this]() { return !audio_playback_queue_.empty() || service_stopped_; });
        if (service_stopped_) {
            break;
        }

        auto task = std::move(audio_playback_queue_.front());
        audio_playback_queue_.pop_front();
        audio_queue_cv_.notify_all();
        lock.unlock();

        if (!codec_->output_enabled()) {
            esp_timer_stop(audio_power_timer_);
            esp_timer_start_periodic(audio_power_timer_, AUDIO_POWER_CHECK_INTERVAL_MS * 1000);
            codec_->EnableOutput(true);
        }

        codec_->OutputData(task->pcm);
        if (first_playback_pcm_pending_.exchange(false) && callbacks_.on_first_playback_pcm) {
            callbacks_.on_first_playback_pcm();
        }

        /* Update the last output time */
        last_output_time_ = std::chrono::steady_clock::now();
        debug_statistics_.playback_count++;

#if CONFIG_USE_SERVER_AEC
        /* Record the timestamp for server AEC */
        if (task->timestamp > 0) {
            lock.lock();
            timestamp_queue_.push_back(task->timestamp);
        }
#endif
    }

    ESP_LOGW(TAG, "Audio output task stopped");
}

void AudioService::OpusCodecTask() {
    while (true) {
        std::unique_lock<std::mutex> lock(audio_queue_mutex_);
        audio_queue_cv_.wait(lock, [this]() {
            return service_stopped_ ||
                (!audio_encode_queue_.empty() && audio_send_queue_.size() < MAX_SEND_PACKETS_IN_QUEUE) ||
                (!audio_decode_queue_.empty() && audio_playback_queue_.size() < MAX_PLAYBACK_TASKS_IN_QUEUE);
        });
        if (service_stopped_) {
            break;
        }

        /* Decode the audio from decode queue */
        if (!audio_decode_queue_.empty() && audio_playback_queue_.size() < MAX_PLAYBACK_TASKS_IN_QUEUE) {
            auto packet = std::move(audio_decode_queue_.front());
            audio_decode_queue_.pop_front();
            audio_queue_cv_.notify_all();
            lock.unlock();

            auto task = std::make_unique<AudioTask>();
            task->type = kAudioTaskTypeDecodeToPlaybackQueue;
            task->timestamp = packet->timestamp;

            SetDecodeSampleRate(packet->sample_rate, packet->frame_duration);
            if (opus_decoder_ != nullptr) {
                task->pcm.resize(decoder_frame_size_);
                esp_audio_dec_in_raw_t raw = {
                    .buffer = (uint8_t *)(packet->payload.data()),
                    .len = (uint32_t)(packet->payload.size()),
                    .consumed = 0,
                    .frame_recover = ESP_AUDIO_DEC_RECOVERY_NONE,
                };
                esp_audio_dec_out_frame_t out_frame = {
                    .buffer = (uint8_t *)(task->pcm.data()),
                    .len = (uint32_t)(task->pcm.size() * sizeof(int16_t)),
                    .decoded_size = 0,
                };
                esp_audio_dec_info_t dec_info = {};
                std::unique_lock<std::mutex> decoder_lock(decoder_mutex_);
                auto ret = esp_opus_dec_decode(opus_decoder_, &raw, &out_frame, &dec_info);
                decoder_lock.unlock();
                if (ret == ESP_AUDIO_ERR_OK) {
                    task->pcm.resize(out_frame.decoded_size / sizeof(int16_t));
                    if (decoder_sample_rate_ != codec_->output_sample_rate() && output_resampler_ != nullptr) {
                        uint32_t target_size = 0;
                        esp_ae_rate_cvt_get_max_out_sample_num(output_resampler_, task->pcm.size(), &target_size);
                        std::vector<int16_t> resampled(target_size);
                        uint32_t actual_output = target_size;
                        esp_ae_rate_cvt_process(output_resampler_, (esp_ae_sample_t)task->pcm.data(), task->pcm.size(),
                                                (esp_ae_sample_t)resampled.data(), &actual_output);
                        resampled.resize(actual_output);
                        task->pcm = std::move(resampled);
                    }
                    lock.lock();
                    audio_playback_queue_.push_back(std::move(task));
                    playback_queue_peak_.store(std::max<uint32_t>(playback_queue_peak_.load(), audio_playback_queue_.size()));
                    audio_queue_cv_.notify_all();
                    debug_statistics_.decode_count++;
                } else {
                    ESP_LOGE(TAG, "Failed to decode audio after resize, error code: %d", ret);
                    lock.lock();
                }
            } else {
                ESP_LOGE(TAG, "Audio decoder is not configured");
                lock.lock();
            }
            debug_statistics_.decode_count++;
        }
        /* Encode the audio to send queue */
        if (!audio_encode_queue_.empty() && audio_send_queue_.size() < MAX_SEND_PACKETS_IN_QUEUE) {
            auto task = std::move(audio_encode_queue_.front());
            audio_encode_queue_.pop_front();
            audio_queue_cv_.notify_all();
            lock.unlock();

            auto packet = std::make_unique<AudioStreamPacket>();
            packet->frame_duration = OPUS_FRAME_DURATION_MS;
            packet->sample_rate = 16000;
            packet->timestamp = task->timestamp;

            if (opus_encoder_ != nullptr && task->pcm.size() == encoder_frame_size_) {
                std::vector<uint8_t> buf(encoder_outbuf_size_);
                esp_audio_enc_in_frame_t in = {
                    .buffer = (uint8_t *)(task->pcm.data()),
                    .len = (uint32_t)(encoder_frame_size_ * sizeof(int16_t)),
                };
                esp_audio_enc_out_frame_t out = {
                    .buffer = buf.data(),
                    .len = (uint32_t)encoder_outbuf_size_,
                    .encoded_bytes = 0,
                };
                auto ret = esp_opus_enc_process(opus_encoder_, &in, &out);
                if (ret == ESP_AUDIO_ERR_OK) {
                    packet->payload.assign(buf.data(), buf.data() + out.encoded_bytes);

                    if (task->type == kAudioTaskTypeEncodeToSendQueue) {
                        {
                            std::lock_guard<std::mutex> lock2(audio_queue_mutex_);
                            audio_send_queue_.push_back(std::move(packet));
                            send_queue_peak_.store(std::max<uint32_t>(send_queue_peak_.load(), audio_send_queue_.size()));
                        }
                        if (callbacks_.on_send_queue_available) {
                            callbacks_.on_send_queue_available();
                        }
                    } else if (task->type == kAudioTaskTypeEncodeToTestingQueue) {
                        std::lock_guard<std::mutex> lock2(audio_queue_mutex_);
                        audio_testing_queue_.push_back(std::move(packet));
                    }
                    debug_statistics_.encode_count++;
                } else {
                    ESP_LOGE(TAG, "Failed to encode audio, error code: %d", ret);
                }
            } else {
                ESP_LOGE(TAG, "Failed to encode audio: encoder not configured or invalid frame size (got %u, expected %u)",
                         task->pcm.size(), encoder_frame_size_);
            }
            lock.lock();
        }
    }

    ESP_LOGW(TAG, "Opus codec task stopped");
}

void AudioService::SetDecodeSampleRate(int sample_rate, int frame_duration) {
    if (decoder_sample_rate_ == sample_rate && decoder_duration_ms_ == frame_duration) {
        return;
    }
    std::unique_lock<std::mutex> decoder_lock(decoder_mutex_);
    if (opus_decoder_ != nullptr) {
        esp_opus_dec_close(opus_decoder_);
        opus_decoder_ = nullptr;
    }
    decoder_lock.unlock();
    esp_opus_dec_cfg_t opus_dec_cfg = OPUS_DEC_CFG(sample_rate, frame_duration);
    auto ret = esp_opus_dec_open(&opus_dec_cfg, sizeof(esp_opus_dec_cfg_t), &opus_decoder_);
    if (opus_decoder_ == nullptr) {
        ESP_LOGE(TAG, "Failed to create audio decoder, error code: %d", ret);
        return;
    }
    decoder_sample_rate_ = sample_rate;
    decoder_duration_ms_ = frame_duration;
    decoder_frame_size_ = decoder_sample_rate_ / 1000 * frame_duration;

    auto codec = Board::GetInstance().GetAudioCodec();
    if (decoder_sample_rate_ != codec->output_sample_rate()) {
        ESP_LOGI(TAG, "Resampling audio from %d to %d", decoder_sample_rate_, codec->output_sample_rate());
        if (output_resampler_ != nullptr) {
            esp_ae_rate_cvt_close(output_resampler_);
            output_resampler_ = nullptr;
        }
        esp_ae_rate_cvt_cfg_t output_resampler_cfg = RATE_CVT_CFG(
            decoder_sample_rate_, codec->output_sample_rate(), ESP_AUDIO_MONO);
        auto resampler_ret = esp_ae_rate_cvt_open(&output_resampler_cfg, &output_resampler_);
        if (output_resampler_ == nullptr) {
            ESP_LOGE(TAG, "Failed to create output resampler, error code: %d", resampler_ret);
        }
    }
}

void AudioService::PushTaskToEncodeQueue(AudioTaskType type, std::vector<int16_t>&& pcm) {
    auto task = std::make_unique<AudioTask>();
    task->type = type;
    task->pcm = std::move(pcm);
    /* Push the task to the encode queue */
    std::unique_lock<std::mutex> lock(audio_queue_mutex_);

    /* If the task is to send queue, we need to set the timestamp */
    if (type == kAudioTaskTypeEncodeToSendQueue && !timestamp_queue_.empty()) {
        if (timestamp_queue_.size() <= MAX_TIMESTAMPS_IN_QUEUE) {
            task->timestamp = timestamp_queue_.front();
        } else {
            ESP_LOGW(TAG, "Timestamp queue (%u) is full, dropping timestamp", timestamp_queue_.size());
        }
        timestamp_queue_.pop_front();
    }

    audio_queue_cv_.wait(lock, [this]() { return audio_encode_queue_.size() < MAX_ENCODE_TASKS_IN_QUEUE; });
    audio_encode_queue_.push_back(std::move(task));
    encode_queue_peak_.store(std::max<uint32_t>(encode_queue_peak_.load(), audio_encode_queue_.size()));
    audio_queue_cv_.notify_all();
}

bool AudioService::PushPacketToDecodeQueue(std::unique_ptr<AudioStreamPacket> packet, bool wait) {
    std::unique_lock<std::mutex> lock(audio_queue_mutex_);
    if (audio_decode_queue_.size() >= MAX_DECODE_PACKETS_IN_QUEUE) {
        if (wait) {
            audio_queue_cv_.wait(lock, [this]() { return audio_decode_queue_.size() < MAX_DECODE_PACKETS_IN_QUEUE; });
        } else {
            return false;
        }
    }
    audio_decode_queue_.push_back(std::move(packet));
    decode_queue_peak_.store(std::max<uint32_t>(decode_queue_peak_.load(), audio_decode_queue_.size()));
    audio_queue_cv_.notify_all();
    return true;
}

void AudioService::PrepareVoicePlayback() {
    ResetDecoder();
    first_playback_pcm_pending_.store(true);
    if (!codec_->output_enabled()) {
        esp_timer_stop(audio_power_timer_);
        esp_timer_start_periodic(audio_power_timer_, AUDIO_POWER_CHECK_INTERVAL_MS * 1000);
        codec_->EnableOutput(true);
    }
}

AudioQueueMetrics AudioService::GetAndResetVoiceQueueMetrics() {
    return {
        .encode_peak = encode_queue_peak_.exchange(0),
        .send_peak = send_queue_peak_.exchange(0),
        .decode_peak = decode_queue_peak_.exchange(0),
        .playback_peak = playback_queue_peak_.exchange(0),
    };
}

std::unique_ptr<AudioStreamPacket> AudioService::PopPacketFromSendQueue() {
    std::lock_guard<std::mutex> lock(audio_queue_mutex_);
    if (audio_send_queue_.empty()) {
        return nullptr;
    }
    auto packet = std::move(audio_send_queue_.front());
    audio_send_queue_.pop_front();
    audio_queue_cv_.notify_all();
    return packet;
}

void AudioService::EncodeWakeWord() {
    if (wake_word_) {
        wake_word_->EncodeWakeWordData();
    }
}

const std::string& AudioService::GetLastWakeWord() const {
    return wake_word_->GetLastDetectedWakeWord();
}

std::unique_ptr<AudioStreamPacket> AudioService::PopWakeWordPacket() {
    auto packet = std::make_unique<AudioStreamPacket>();
    if (wake_word_->GetWakeWordOpus(packet->payload)) {
        return packet;
    }
    return nullptr;
}

void AudioService::EnableWakeWordDetection(bool enable) {
    if (!wake_word_) {
        return;
    }

    ESP_LOGD(TAG, "%s wake word detection", enable ? "Enabling" : "Disabling");
    if (enable) {
        if (!wake_word_initialized_) {
            if (!wake_word_->Initialize(codec_, models_list_)) {
                ESP_LOGE(TAG, "Failed to initialize wake word");
                return;
            }
            wake_word_initialized_ = true;
        }
        // Reset input resampler to clear cached data from previous mode (e.g. AudioProcessor)
        // This prevents buffer overflow when switching between different feed sizes
        {
            std::lock_guard<std::mutex> lock(input_resampler_mutex_);
            if (input_resampler_ != nullptr) {
                esp_ae_rate_cvt_reset(input_resampler_);
            }
        }
        wake_word_->Start();
        xEventGroupSetBits(event_group_, AS_EVENT_WAKE_WORD_RUNNING);
    } else {
        wake_word_->Stop();
        xEventGroupClearBits(event_group_, AS_EVENT_WAKE_WORD_RUNNING);
    }
}

void AudioService::EnableVoiceProcessing(bool enable) {
    ESP_LOGD(TAG, "%s voice processing", enable ? "Enabling" : "Disabling");
    if (enable) {
        if (!audio_processor_initialized_) {
            audio_processor_->Initialize(codec_, OPUS_FRAME_DURATION_MS, models_list_);
            audio_processor_initialized_ = true;
        }

        /* We should make sure no audio is playing */
        ResetDecoder();
        audio_input_need_warmup_ = true;
        // Reset input resampler to clear cached data from previous mode (e.g. WakeWord)
        // This prevents buffer overflow when switching between different feed sizes
        {
            std::lock_guard<std::mutex> lock(input_resampler_mutex_);
            if (input_resampler_ != nullptr) {
                esp_ae_rate_cvt_reset(input_resampler_);
            }
        }
        audio_processor_->Start();
        xEventGroupSetBits(event_group_, AS_EVENT_AUDIO_PROCESSOR_RUNNING);
    } else {
        audio_processor_->Stop();
        xEventGroupClearBits(event_group_, AS_EVENT_AUDIO_PROCESSOR_RUNNING);
    }
}

void AudioService::EnableAudioTesting(bool enable) {
    ESP_LOGI(TAG, "%s audio testing", enable ? "Enabling" : "Disabling");
    if (enable) {
        xEventGroupSetBits(event_group_, AS_EVENT_AUDIO_TESTING_RUNNING);
    } else {
        xEventGroupClearBits(event_group_, AS_EVENT_AUDIO_TESTING_RUNNING);
        /* Copy audio_testing_queue_ to audio_decode_queue_ */
        std::lock_guard<std::mutex> lock(audio_queue_mutex_);
        audio_decode_queue_ = std::move(audio_testing_queue_);
        audio_queue_cv_.notify_all();
    }
}

void AudioService::EnableDeviceAec(bool enable) {
    ESP_LOGI(TAG, "%s device AEC", enable ? "Enabling" : "Disabling");
    if (!audio_processor_initialized_) {
        audio_processor_->Initialize(codec_, OPUS_FRAME_DURATION_MS, models_list_);
        audio_processor_initialized_ = true;
    }

    audio_processor_->EnableDeviceAec(enable);
}

void AudioService::SetCallbacks(AudioServiceCallbacks& callbacks) {
    callbacks_ = callbacks;
}

void AudioService::PlaySound(const std::string_view& ogg) {
    if (!codec_->output_enabled()) {
        esp_timer_stop(audio_power_timer_);
        esp_timer_start_periodic(audio_power_timer_, AUDIO_POWER_CHECK_INTERVAL_MS * 1000);
        codec_->EnableOutput(true);
    }

    const auto* buf = reinterpret_cast<const uint8_t*>(ogg.data());
    size_t size = ogg.size();

    auto demuxer = std::make_unique<OggDemuxer>();
    demuxer->OnDemuxerFinished([this](const uint8_t* data, int sample_rate, size_t size){
        auto packet = std::make_unique<AudioStreamPacket>();
        packet->sample_rate = sample_rate;
        packet->frame_duration = 60;
        packet->payload.resize(size);
        std::memcpy(packet->payload.data(), data, size);
        PushPacketToDecodeQueue(std::move(packet), true);
    });
    demuxer->Reset();
    demuxer->Process(buf, size);
}

bool AudioService::PlayOggFile(const std::string& path, std::function<bool()> should_stop) {
    FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        ESP_LOGW(TAG, "Failed to open ogg file: %s", path.c_str());
        return false;
    }

    if (!codec_->output_enabled()) {
        esp_timer_stop(audio_power_timer_);
        esp_timer_start_periodic(audio_power_timer_, AUDIO_POWER_CHECK_INTERVAL_MS * 1000);
        codec_->EnableOutput(true);
    }

    ResetMediaProgress();
    auto demuxer = std::make_unique<OggDemuxer>();
    demuxer->OnDemuxerFinished([this, &should_stop](const uint8_t* data, int sample_rate, size_t size) {
        if (should_stop && should_stop()) {
            return;
        }
        auto packet = std::make_unique<AudioStreamPacket>();
        packet->sample_rate = sample_rate;
        packet->frame_duration = 60;
        packet->payload.resize(size);
        std::memcpy(packet->payload.data(), data, size);
        if (PushPacketToDecodeQueue(std::move(packet), true)) {
            AdvanceMediaProgress(60);
        }
    });
    demuxer->Reset();

    uint8_t buffer[1024];
    bool ok = false;
    while (!should_stop || !should_stop()) {
        const size_t read = std::fread(buffer, 1, sizeof(buffer), file);
        if (read > 0) {
            demuxer->Process(buffer, read);
            ok = true;
        }
        if (read < sizeof(buffer)) {
            break;
        }
    }
    std::fclose(file);
    return ok;
}

bool AudioService::PlayOggUrl(const std::string& url, std::function<bool()> should_stop) {
    WifiPowerSaveGuard ps_guard;

    esp_http_client_config_t config = {};
    config.url = url.c_str();
    config.timeout_ms = 5000;
    config.keep_alive_enable = false;
    config.buffer_size = 2048;
    config.buffer_size_tx = 1024;

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == nullptr) {
        ESP_LOGW(TAG, "Failed to init ogg stream: %s", url.c_str());
        return false;
    }

    esp_http_client_set_method(client, HTTP_METHOD_GET);
    esp_http_client_set_header(client, "Accept", "audio/ogg,application/ogg,*/*");
    esp_http_client_set_header(client, "Connection", "close");
    esp_http_client_set_header(client, "User-Agent", "xiaozhi-appshell/1");

    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Failed to open ogg stream %s: %d", url.c_str(), static_cast<int>(err));
        esp_http_client_cleanup(client);
        return false;
    }
    esp_http_client_fetch_headers(client);
    const int status = esp_http_client_get_status_code(client);
    if (status < 200 || status >= 300) {
        ESP_LOGW(TAG, "Ogg stream returned http %d: %s", status, url.c_str());
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        return false;
    }
    ESP_LOGI(TAG, "Opened ogg stream http %d", status);

    if (!codec_->output_enabled()) {
        esp_timer_stop(audio_power_timer_);
        esp_timer_start_periodic(audio_power_timer_, AUDIO_POWER_CHECK_INTERVAL_MS * 1000);
        codec_->EnableOutput(true);
    }

    ResetMediaProgress();
    auto demuxer = std::make_unique<OggDemuxer>();
    demuxer->OnDemuxerFinished([this, &should_stop](const uint8_t* data, int sample_rate, size_t size) {
        if (should_stop && should_stop()) {
            return;
        }
        auto packet = std::make_unique<AudioStreamPacket>();
        packet->sample_rate = sample_rate;
        packet->frame_duration = 60;
        packet->payload.resize(size);
        std::memcpy(packet->payload.data(), data, size);
        if (PushPacketToDecodeQueue(std::move(packet), true)) {
            AdvanceMediaProgress(60);
        }
    });
    demuxer->Reset();

    char buffer[2048];
    bool ok = false;
    size_t total_read = 0;
    while (!should_stop || !should_stop()) {
        const int read = esp_http_client_read(client, buffer, sizeof(buffer));
        if (read < 0) {
            ESP_LOGW(TAG, "Read ogg stream failed: %s", url.c_str());
            ok = false;
            break;
        }
        if (read == 0) {
            break;
        }
        total_read += static_cast<size_t>(read);
        demuxer->Process(reinterpret_cast<const uint8_t*>(buffer), read);
        ok = true;
        vTaskDelay(pdMS_TO_TICKS(1));
    }

    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    ESP_LOGI(TAG, "Closed ogg stream: %u bytes, %s", static_cast<unsigned>(total_read), ok ? "ok" : "empty");
    return ok;
}

bool AudioService::PlayMp3File(const std::string& path, std::function<bool()> should_stop) {
    if (path.empty()) {
        ESP_LOGW(TAG, "MP3 file path is empty");
        return false;
    }

    // File size lets us estimate total duration together with the bitrate
    // reported in the MUSIC_INFO event. Best-effort: 0 if stat fails.
    int file_bytes = 0;
    struct stat st = {};
    if (stat(path.c_str(), &st) == 0 && st.st_size > 0) {
        file_bytes = static_cast<int>(st.st_size);
    }

    // Parse the file's own frame header up front for an accurate total duration
    // (exact for VBR via the Xing header). 0 if parsing fails; the MUSIC_INFO
    // bitrate estimate then serves as the fallback.
    const int parsed_duration_ms = Mp3DurationMsFromFile(path, file_bytes);

    const std::string uri = path[0] == '/' ? ("file://" + path.substr(1)) : ("file://" + path);
    return PlayMp3Uri(uri, "mp3 file", should_stop, file_bytes, parsed_duration_ms);
}

bool AudioService::PlayMp3Url(const std::string& url, std::function<bool()> should_stop) {
    if (url.empty()) {
        ESP_LOGW(TAG, "MP3 url is empty");
        return false;
    }

    WifiPowerSaveGuard ps_guard;
    // Streaming source: size unknown, so duration estimation is disabled.
    return PlayMp3Uri(url, "mp3 stream", should_stop, 0, 0);
}

bool AudioService::PlayMp3Uri(const std::string& uri, const char* label, std::function<bool()> should_stop,
                              int file_bytes, int preset_duration_ms) {
    if (uri.empty()) {
        ESP_LOGW(TAG, "MP3 uri is empty");
        return false;
    }

    if (!codec_->output_enabled()) {
        esp_timer_stop(audio_power_timer_);
        esp_timer_start_periodic(audio_power_timer_, AUDIO_POWER_CHECK_INTERVAL_MS * 1000);
        codec_->EnableOutput(true);
    }

    Mp3PlaybackContext context;
    context.service = this;
    context.file_bytes = file_bytes;
    // A positive preset comes from the file-header parse (Xing = exact, even for
    // VBR); when present it wins over the MUSIC_INFO CBR estimate below.
    context.duration_from_header = preset_duration_ms > 0;
    context.event_group = xEventGroupCreate();
    if (context.event_group == nullptr) {
        ESP_LOGW(TAG, "Failed to create mp3 event group");
        return false;
    }

    // Reset any progress from a previous track before this one starts.
    // A duration parsed from the file header (Xing/CBR) seeds the value so the
    // UI has a total immediately; the MUSIC_INFO event may refine it later.
    ResetMediaProgress(preset_duration_ms);

    esp_asp_cfg_t cfg = {};
    cfg.out.cb = Mp3OutputCallback;
    cfg.out.user_ctx = &context;
    cfg.task_prio = 5;
    // MP3 playback creates a GMF worker task. Keep that stack out of internal
    // SRAM so server/local music does not collapse the same heap reserve used
    // by wake word, WebSocket fallback and AppShell network workers.
    cfg.task_stack = 6 * 1024;
    cfg.task_stack_in_ext = true;

    esp_asp_handle_t player = nullptr;
    esp_gmf_err_t err = esp_audio_simple_player_new(&cfg, &player);
    if (err != ESP_GMF_ERR_OK || player == nullptr) {
        ESP_LOGW(TAG, "Failed to create mp3 player: %d", static_cast<int>(err));
        vEventGroupDelete(context.event_group);
        return false;
    }

    esp_audio_simple_player_set_event(player, Mp3EventCallback, &context);

    ESP_LOGI(TAG, "Start %s: %s", label ? label : "mp3", uri.c_str());
    err = esp_audio_simple_player_run(player, uri.c_str(), nullptr);
    if (err != ESP_GMF_ERR_OK) {
        ESP_LOGW(TAG, "Failed to run mp3 player: %d", static_cast<int>(err));
        esp_audio_simple_player_destroy(player);
        vEventGroupDelete(context.event_group);
        return false;
    }

    bool ok = false;
    while (true) {
        if (should_stop && should_stop()) {
            context.stop_requested.store(true);
            esp_audio_simple_player_stop(player);
            ok = context.data_seen.load();
            break;
        }
        const EventBits_t bits = xEventGroupWaitBits(context.event_group,
                                                     kMp3EventFinished | kMp3EventError,
                                                     pdFALSE,
                                                     pdFALSE,
                                                     pdMS_TO_TICKS(100));
        // Update the elapsed position from decoded frames so the UI progress
        // bar can advance while playback runs.
        const int rate = context.sample_rate.load();
        if (rate > 0) {
            const uint64_t frames = context.played_frames.load();
            media_position_ms_.store(static_cast<int>(frames * 1000 / rate));
        }
        if (bits & kMp3EventFinished) {
            ok = context.data_seen.load();
            break;
        }
        if (bits & kMp3EventError) {
            ok = false;
            break;
        }
    }

    esp_audio_simple_player_stop(player);
    esp_audio_simple_player_destroy(player);
    vEventGroupDelete(context.event_group);
    ESP_LOGI(TAG, "Closed %s: %s", label ? label : "mp3", ok ? "ok" : "failed");
    return ok;
}

void AudioService::OutputMp3Pcm(const uint8_t* data, int data_size) {
    if (data == nullptr || data_size <= 0 || codec_ == nullptr) {
        return;
    }
    if (!codec_->output_enabled()) {
        codec_->EnableOutput(true);
    }

    const int sample_count = data_size / static_cast<int>(sizeof(int16_t));
    if (sample_count <= 0) {
        return;
    }
    std::vector<int16_t> pcm(sample_count);
    std::memcpy(pcm.data(), data, sample_count * sizeof(int16_t));
    codec_->OutputData(pcm);
    last_output_time_ = std::chrono::steady_clock::now();
}

int AudioService::Mp3OutputCallback(uint8_t* data, int data_size, void* ctx) {
    auto* context = static_cast<Mp3PlaybackContext*>(ctx);
    if (context == nullptr || context->service == nullptr || context->stop_requested.load()) {
        return 0;
    }
    context->service->OutputMp3Pcm(data, data_size);
    context->data_seen.store(true);

    // Accumulate decoded frames (per channel) so the playback loop can derive
    // the elapsed position. data_size is bytes of interleaved int16 samples.
    const int channels = context->channels.load();
    if (channels > 0) {
        const int samples = data_size / static_cast<int>(sizeof(int16_t));
        context->played_frames.fetch_add(static_cast<uint64_t>(samples) / channels);
    }
    return 0;
}

int AudioService::Mp3EventCallback(esp_asp_event_pkt_t* event, void* ctx) {
    auto* context = static_cast<Mp3PlaybackContext*>(ctx);
    if (event == nullptr || context == nullptr || context->event_group == nullptr) {
        return 0;
    }

    if (event->type == ESP_ASP_EVENT_TYPE_MUSIC_INFO) {
        esp_asp_music_info_t info = {};
        if (event->payload != nullptr && event->payload_size >= sizeof(info)) {
            std::memcpy(&info, event->payload, sizeof(info));
            ESP_LOGI(TAG, "MP3 info: rate=%d channels=%d bits=%d bitrate=%d",
                     info.sample_rate, info.channels, info.bits, info.bitrate);
            context->sample_rate.store(info.sample_rate);
            context->channels.store(info.channels);
            // Estimate total duration from file size and bitrate. Accurate for
            // CBR; VBR will drift. Requires a known file size (local files only).
            // Skip when a header-parsed preset already seeded a better value.
            if (!context->duration_from_header && info.bitrate > 0 && context->file_bytes > 0) {
                const uint64_t duration_ms =
                    static_cast<uint64_t>(context->file_bytes) * 8 * 1000 / info.bitrate;
                context->service->media_duration_ms_.store(static_cast<int>(duration_ms));
            }
        }
    } else if (event->type == ESP_ASP_EVENT_TYPE_STATE) {
        esp_asp_state_t state = ESP_ASP_STATE_NONE;
        if (event->payload != nullptr && event->payload_size >= sizeof(state)) {
            std::memcpy(&state, event->payload, sizeof(state));
            ESP_LOGI(TAG, "MP3 state: %s", esp_audio_simple_player_state_to_str(state));
            if (state == ESP_ASP_STATE_FINISHED) {
                xEventGroupSetBits(context->event_group, kMp3EventFinished);
            } else if (state == ESP_ASP_STATE_ERROR) {
                xEventGroupSetBits(context->event_group, kMp3EventError);
            }
        }
    }
    return 0;
}

bool AudioService::IsIdle() {
    std::lock_guard<std::mutex> lock(audio_queue_mutex_);
    return audio_encode_queue_.empty() && audio_decode_queue_.empty() && audio_playback_queue_.empty() && audio_testing_queue_.empty();
}

void AudioService::ResetMediaProgress(int duration_ms) {
    media_position_ms_.store(0);
    media_duration_ms_.store(std::max(0, duration_ms));
}

void AudioService::AdvanceMediaProgress(int delta_ms) {
    if (delta_ms <= 0) {
        return;
    }
    const int duration_ms = media_duration_ms_.load();
    int next = media_position_ms_.fetch_add(delta_ms) + delta_ms;
    if (duration_ms > 0 && next > duration_ms) {
        media_position_ms_.store(duration_ms);
    }
}

void AudioService::WaitForPlaybackQueueEmpty() {
    std::unique_lock<std::mutex> lock(audio_queue_mutex_);
    audio_queue_cv_.wait(lock, [this]() { 
        return service_stopped_ || (audio_decode_queue_.empty() && audio_playback_queue_.empty()); 
    });
}

void AudioService::ResetDecoder() {
    std::lock_guard<std::mutex> lock(audio_queue_mutex_);
    std::unique_lock<std::mutex> decoder_lock(decoder_mutex_);
    if (opus_decoder_ != nullptr) {
        esp_opus_dec_reset(opus_decoder_);
    }
    decoder_lock.unlock();
    timestamp_queue_.clear();
    audio_decode_queue_.clear();
    audio_playback_queue_.clear();
    audio_testing_queue_.clear();
    audio_queue_cv_.notify_all();
}

void AudioService::CheckAndUpdateAudioPowerState() {
    auto now = std::chrono::steady_clock::now();
    auto input_elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_input_time_).count();
    auto output_elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_output_time_).count();
    if (input_elapsed > AUDIO_POWER_TIMEOUT_MS && codec_->input_enabled()) {
        codec_->EnableInput(false);
    }
    if (output_elapsed > AUDIO_POWER_TIMEOUT_MS && codec_->output_enabled()) {
        // Keep TX clock when duplex RX is active; otherwise RX may stall on some boards.
        if (!(codec_->duplex() && codec_->input_enabled())) {
            codec_->EnableOutput(false);
        }
    }
    if (!codec_->input_enabled() && !codec_->output_enabled()) {
        esp_timer_stop(audio_power_timer_);
    }
}

void AudioService::SetModelsList(srmodel_list_t* models_list) {
    models_list_ = models_list;

#if CONFIG_IDF_TARGET_ESP32S3 || CONFIG_IDF_TARGET_ESP32P4
    if (esp_srmodel_filter(models_list_, ESP_MN_PREFIX, NULL) != nullptr) {
        wake_word_ = std::make_unique<CustomWakeWord>();
    } else if (esp_srmodel_filter(models_list_, ESP_WN_PREFIX, NULL) != nullptr) {
        wake_word_ = std::make_unique<AfeWakeWord>();
    } else {
        wake_word_ = nullptr;
    }
#else
    if (esp_srmodel_filter(models_list_, ESP_WN_PREFIX, NULL) != nullptr) {
        wake_word_ = std::make_unique<EspWakeWord>();
    } else {
        wake_word_ = nullptr;
    }
#endif

    if (wake_word_) {
        wake_word_->OnWakeWordDetected([this](const std::string& wake_word) {
            if (callbacks_.on_wake_word_detected) {
                callbacks_.on_wake_word_detected(wake_word);
            }
        });
    }
}

bool AudioService::IsAfeWakeWord() {
#if CONFIG_IDF_TARGET_ESP32S3 || CONFIG_IDF_TARGET_ESP32P4
    return wake_word_ != nullptr && dynamic_cast<AfeWakeWord*>(wake_word_.get()) != nullptr;
#else
    return false;
#endif
}
