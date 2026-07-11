#ifndef APP_SYNC_QUEUE_H_
#define APP_SYNC_QUEUE_H_

#include <string>

struct AppSyncStatus {
    bool available = false;
    int pending_count = 0;
    int last_pushed_count = 0;
    std::string last_error = "同步队列未初始化";
};

class AppSyncQueue {
public:
    static AppSyncQueue& GetInstance();

    void Initialize();
    void Refresh();
    bool AddEvent(const std::string& type, const std::string& payload_json);
    bool AddActionEvent(const std::string& action, const std::string& params_json);
    bool FlushPending();
    const AppSyncStatus& status() const { return status_; }
    std::string StatusLine() const;

private:
    AppSyncQueue() = default;

    std::string OutboxPath() const;
    std::string MakeEventPath() const;
    std::string BuildBatchJson(int max_events, int& loaded_count, std::string file_paths[], int max_paths) const;

    AppSyncStatus status_;
};

#endif
