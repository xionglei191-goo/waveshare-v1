#ifndef APP_REMOTE_PAGE_H_
#define APP_REMOTE_PAGE_H_

#include <map>
#include <string>

struct _lv_obj_t;
typedef struct _lv_obj_t lv_obj_t;

struct AppRemotePageStatus {
    bool last_valid = false;
    std::string last_page = "--";
    std::string last_error = "远程页面未加载";
    int component_count = 0;
};

class AppRemotePageRenderer {
public:
    static AppRemotePageRenderer& GetInstance();

    bool Validate(const std::string& json, std::string& error);
    bool FetchAndValidate(const std::string& page);
    bool HasCachedPage(const std::string& page) const;
    bool RenderCachedPage(const std::string& page, lv_obj_t* parent);
    const AppRemotePageStatus& status() const { return status_; }
    std::string StatusLine() const;

private:
    AppRemotePageRenderer() = default;

    bool IsAllowedAction(const std::string& action) const;
    bool IsAllowedComponent(const std::string& type) const;
    bool ValidateComponentArray(void* array, std::string& error, int& count) const;

    AppRemotePageStatus status_;
    std::map<std::string, std::string> cached_pages_;
};

#endif
