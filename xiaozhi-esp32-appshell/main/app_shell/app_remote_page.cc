#include "app_remote_page.h"

#include "app_backend_client.h"
#include "app_shell.h"
#include "application.h"

#include <cJSON.h>
#include <lvgl.h>

#include <algorithm>
#include <cstring>

namespace {
constexpr int kMaxComponents = 16;
constexpr int kMaxTextLength = 96;
constexpr int kMaxActionParamsLength = 256;
constexpr int kRemoteSafeBottom = 176;
constexpr uint32_t kRemoteBg = 0x141b24;
constexpr uint32_t kRemoteSoftBg = 0x1d2732;
constexpr uint32_t kRemoteActiveBg = 0x17362f;
constexpr uint32_t kRemoteBorder = 0x2d3a46;
constexpr uint32_t kRemoteText = 0xf3f7fb;
constexpr uint32_t kRemoteMutedText = 0x94a3b2;
constexpr uint32_t kRemoteAccent = 0x63e6be;
constexpr uint32_t kRemoteBlue = 0x6aa8ff;
constexpr uint32_t kRemoteWarm = 0xffc857;

struct RemoteActionContext {
    std::string action;
    std::string params;
};

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

bool TextTooLong(cJSON* object, const char* key) {
    auto item = cJSON_GetObjectItem(object, key);
    return cJSON_IsString(item) && item->valuestring != nullptr && std::strlen(item->valuestring) > kMaxTextLength;
}

std::string PrintJson(cJSON* object) {
    if (object == nullptr) {
        return "{}";
    }
    char* raw = cJSON_PrintUnformatted(object);
    if (raw == nullptr) {
        return "{}";
    }
    std::string result(raw);
    cJSON_free(raw);
    return result;
}

std::string ActionName(cJSON* action) {
    if (!cJSON_IsObject(action)) {
        return "";
    }
    std::string name = JsonString(action, "type");
    if (name.empty()) {
        name = JsonString(action, "name");
    }
    return name;
}

bool IsAllowedRemoteAction(const std::string& action) {
    static const char* kAllowed[] = {
        "ai.toggle", "ai.start", "ai.stop", "music.play_pause", "music.next", "music.volume",
        "music.set_source", "music.sd.scan", "music.sd.play_pause", "music.sd.next",
        "music.server.play_pause", "music.server.next", "music.server.cache",
        "screensaver.start", "screensaver.stop",
        "english.start", "schedule.complete", "schedule.snooze", "app.open", "openclaw.run",
        "content.recommend", "memory.add", "homeassistant.call", "homeassistant.scene", "nas.music.scan",
        "family.mode", "family.member.status", "voice.intent", "toast", "dialog.open", "notification.push"
    };
    return std::find(std::begin(kAllowed), std::end(kAllowed), action) != std::end(kAllowed);
}

std::string ActionParams(cJSON* action) {
    if (!cJSON_IsObject(action)) {
        return "{}";
    }
    cJSON* params = cJSON_GetObjectItem(action, "params");
    return cJSON_IsObject(params) ? PrintJson(params) : "{}";
}

bool FitsRemoteArea(int y, int height) {
    return y + height <= kRemoteSafeBottom;
}

std::string ParamsStringValue(const std::string& params, const char* key) {
    cJSON* root = cJSON_Parse(params.c_str());
    if (root == nullptr) {
        return "";
    }
    const std::string value = JsonString(root, key);
    cJSON_Delete(root);
    return value;
}

bool IsPrimaryPageAppOpenId(const std::string& id) {
    static const char* kDenied[] = {
        "settings", "setting", "family", "mode", "weather", "music", "english", "album", "content",
        "schedule", "notifications", "notification", "ai", "ask_ai", "podcast", "story"
    };
    return std::find(std::begin(kDenied), std::end(kDenied), id) != std::end(kDenied);
}

bool IsDeniedRemoteAction(cJSON* action) {
    const std::string name = ActionName(action);
    if (name != "app.open") {
        return false;
    }
    const std::string id = ParamsStringValue(ActionParams(action), "id");
    return IsPrimaryPageAppOpenId(id);
}

bool ScheduleLocalAppOpen(const std::string& id) {
    enum class Route {
        kNone,
        kHome,
        kApps,
        kMiniGame,
    };
    Route route = Route::kNone;
    if (id == "home") {
        route = Route::kHome;
    } else if (id == "apps" || id == "applications") {
        route = Route::kApps;
    } else if (id == "tap" || id == "minigame" || id == "game" || id == "game-focus-tap") {
        route = Route::kMiniGame;
    } else if (id == "settings" || id == "family" || id == "mode" || id == "weather" || id == "music" ||
               id == "english" || id == "album" || id == "content" || id == "schedule" || id == "ai") {
        Application::GetInstance().Schedule([]() {
            AppShell::GetInstance().OnSystemMessage("一级页面请用系统入口");
        });
        return true;
    }
    if (route == Route::kNone) {
        return false;
    }

    Application::GetInstance().Schedule([route]() {
        auto& shell = AppShell::GetInstance();
        switch (route) {
            case Route::kHome: shell.ShowHome(); break;
            case Route::kApps: shell.ShowApps(); break;
            case Route::kMiniGame: shell.ShowMiniGame(); break;
            case Route::kNone: break;
        }
    });
    return true;
}

bool HandleLocalAppOpen(const std::string& action, const std::string& params) {
    if (action != "app.open") {
        return false;
    }

    const std::string id = ParamsStringValue(params.empty() ? "{}" : params, "id");
    return ScheduleLocalAppOpen(id);
}

lv_obj_t* RemoteLabel(lv_obj_t* parent, const char* text, int x, int y, int width, uint32_t color,
                      lv_text_align_t align = LV_TEXT_ALIGN_CENTER,
                      lv_label_long_mode_t long_mode = LV_LABEL_LONG_DOT) {
    auto label = lv_label_create(parent);
    lv_label_set_text(label, text);
    lv_label_set_long_mode(label, long_mode);
    lv_obj_set_width(label, width);
    lv_obj_set_style_text_align(label, align, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
    lv_obj_set_style_text_letter_space(label, 0, 0);
    lv_obj_set_style_text_line_space(label, 1, 0);
    lv_obj_align(label, LV_ALIGN_TOP_MID, x, y);
    return label;
}

lv_obj_t* RemotePanel(lv_obj_t* parent, int x, int y, int width, int height, uint32_t bg,
                      uint32_t border = kRemoteBorder, int radius = 18) {
    auto panel = lv_obj_create(parent);
    lv_obj_remove_style_all(panel);
    lv_obj_clear_flag(panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(panel, width, height);
    lv_obj_set_style_radius(panel, radius, 0);
    lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(panel, lv_color_hex(bg), 0);
    lv_obj_set_style_border_width(panel, 1, 0);
    lv_obj_set_style_border_color(panel, lv_color_hex(border), 0);
    lv_obj_align(panel, LV_ALIGN_TOP_MID, x, y);
    return panel;
}

void RemoteActionEvent(lv_event_t* event) {
    auto* context = static_cast<RemoteActionContext*>(lv_event_get_user_data(event));
    if (context == nullptr) {
        return;
    }
    if (lv_event_get_code(event) == LV_EVENT_DELETE) {
        delete context;
        return;
    }
    if (lv_event_get_code(event) == LV_EVENT_CLICKED || lv_event_get_code(event) == LV_EVENT_PRESSED) {
        if (HandleLocalAppOpen(context->action, context->params)) {
            return;
        }
        AppShell::GetInstance().RunBackendAction(context->action, context->params.empty() ? "{}" : context->params);
    }
}

void AttachAction(lv_obj_t* obj, cJSON* action) {
    const std::string name = ActionName(action);
    if (name.empty() || !IsAllowedRemoteAction(name) || IsDeniedRemoteAction(action)) {
        return;
    }
    auto* context = new RemoteActionContext{name, ActionParams(action)};
    lv_obj_add_flag(obj, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(obj, RemoteActionEvent, LV_EVENT_CLICKED, context);
    lv_obj_add_event_cb(obj, RemoteActionEvent, LV_EVENT_DELETE, context);
}

lv_obj_t* RemoteButton(lv_obj_t* parent, const char* text, int x, int y, int width, int height, cJSON* action,
                       bool active = false) {
    auto button = RemotePanel(parent, x, y, width, height, active ? kRemoteActiveBg : kRemoteBg,
                              active ? kRemoteAccent : kRemoteBorder, height / 2);
    AttachAction(button, action);
    auto label = lv_label_create(button);
    lv_label_set_text(label, text);
    lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
    lv_obj_set_width(label, width - 16);
    lv_obj_set_style_text_align(label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(active ? kRemoteAccent : kRemoteText), 0);
    lv_obj_center(label);
    return button;
}

uint32_t StyleColor(const std::string& style) {
    if (style == "accent" || style == "active" || style == "title") {
        return kRemoteAccent;
    }
    if (style == "secondary") {
        return kRemoteBlue;
    }
    if (style == "warn") {
        return kRemoteWarm;
    }
    if (style == "muted") {
        return kRemoteMutedText;
    }
    return kRemoteText;
}

bool RenderListItem(lv_obj_t* parent, cJSON* item, int y) {
    if (!cJSON_IsObject(item)) {
        return false;
    }
    auto row = RemotePanel(parent, 0, y, 264, 38, kRemoteBg, kRemoteBorder, 14);
    RemoteLabel(row, JsonString(item, "title", "项目").c_str(), 8, 5, 210, kRemoteText, LV_TEXT_ALIGN_LEFT);
    RemoteLabel(row, JsonString(item, "subtitle", "--").c_str(), 8, 21, 210, kRemoteMutedText, LV_TEXT_ALIGN_LEFT);
    AttachAction(row, cJSON_GetObjectItem(item, "action"));
    return true;
}
} // namespace

AppRemotePageRenderer& AppRemotePageRenderer::GetInstance() {
    static AppRemotePageRenderer instance;
    return instance;
}

bool AppRemotePageRenderer::FetchAndValidate(const std::string& page) {
    std::string body;
    std::string error;
    if (!AppBackendClient::GetInstance().FetchRemotePage(page, body, error)) {
        status_.last_valid = false;
        status_.last_page = page;
        status_.last_error = error;
        status_.component_count = 0;
        return false;
    }
    const bool ok = Validate(body, error);
    status_.last_page = page;
    status_.last_error = ok ? "远程页面可用" : error;
    if (ok) {
        cached_pages_[page] = body;
    }
    return ok;
}

bool AppRemotePageRenderer::HasCachedPage(const std::string& page) const {
    return cached_pages_.find(page) != cached_pages_.end();
}

bool AppRemotePageRenderer::Validate(const std::string& json, std::string& error) {
    cJSON* root = cJSON_Parse(json.c_str());
    if (root == nullptr) {
        error = "远程页面 JSON 无效";
        status_.last_valid = false;
        return false;
    }

    cJSON* data = cJSON_GetObjectItem(root, "data");
    if (!cJSON_IsObject(data)) {
        data = root;
    }

    int version = JsonInt(data, "schemaVersion", JsonInt(data, "version", 1));
    if (version < 1 || version > 2) {
        cJSON_Delete(root);
        error = "远程页面 schema 不兼容";
        status_.last_valid = false;
        return false;
    }

    const std::string profile = JsonString(data, "deviceProfile");
    if (!profile.empty() && profile.size() > 64) {
        cJSON_Delete(root);
        error = "设备 profile 过长";
        status_.last_valid = false;
        return false;
    }

    if (TextTooLong(data, "title")) {
        cJSON_Delete(root);
        error = "远程页面标题过长";
        status_.last_valid = false;
        return false;
    }

    cJSON* components = cJSON_GetObjectItem(data, "components");
    if (!cJSON_IsArray(components)) {
        components = cJSON_GetObjectItem(data, "children");
    }

    int count = 0;
    const bool ok = ValidateComponentArray(components, error, count);
    status_.last_valid = ok;
    status_.component_count = ok ? count : 0;
    if (ok) {
        status_.last_page = JsonString(data, "page", "--");
        status_.last_error = "远程页面可用";
    }
    cJSON_Delete(root);
    return ok;
}

bool AppRemotePageRenderer::ValidateComponentArray(void* array_ptr, std::string& error, int& count) const {
    auto* array = static_cast<cJSON*>(array_ptr);
    if (!cJSON_IsArray(array)) {
        error = "远程页面缺少组件数组";
        return false;
    }

    const int size = cJSON_GetArraySize(array);
    if (size > kMaxComponents) {
        error = "远程页面组件过多";
        return false;
    }

    count = 0;
    for (int i = 0; i < size; ++i) {
        auto* component = cJSON_GetArrayItem(array, i);
        if (!cJSON_IsObject(component)) {
            continue;
        }
        const std::string type = JsonString(component, "type");
        if (!IsAllowedComponent(type)) {
            continue;
        }
        cJSON* action = cJSON_GetObjectItem(component, "action");
        const std::string action_name = ActionName(action);
        if (!action_name.empty() && (!IsAllowedAction(action_name) || IsDeniedRemoteAction(action))) {
            cJSON_DeleteItemFromObject(component, "action");
            action = nullptr;
        }
        const std::string params = ActionParams(action);
        if (params.size() > kMaxActionParamsLength) {
            error = "动作参数过长";
            return false;
        }
        if (TextTooLong(component, "text") || TextTooLong(component, "title") || TextTooLong(component, "subtitle")) {
            error = "组件文本过长";
            return false;
        }
        cJSON* items = cJSON_GetObjectItem(component, "items");
        if (cJSON_IsArray(items)) {
            const int item_count = cJSON_GetArraySize(items);
            if (item_count > 8) {
                error = "组件条目过多";
                return false;
            }
            for (int j = 0; j < item_count; ++j) {
                auto* item = cJSON_GetArrayItem(items, j);
                if (!cJSON_IsObject(item)) {
                    continue;
                }
                if (TextTooLong(item, "label") || TextTooLong(item, "title") || TextTooLong(item, "subtitle")) {
                    error = "条目文本过长";
                    return false;
                }
                cJSON* item_action = cJSON_GetObjectItem(item, "action");
                const std::string item_action_name = ActionName(item_action);
                if (!item_action_name.empty() &&
                    (!IsAllowedAction(item_action_name) || IsDeniedRemoteAction(item_action))) {
                    cJSON_DeleteItemFromObject(item, "action");
                    item_action = nullptr;
                }
                const std::string item_params = ActionParams(item_action);
                if (item_params.size() > kMaxActionParamsLength) {
                    error = "条目动作参数过长";
                    return false;
                }
            }
        }
        count++;
    }
    return true;
}

bool AppRemotePageRenderer::IsAllowedAction(const std::string& action) const {
    static const char* kAllowed[] = {
        "ai.toggle", "ai.start", "ai.stop", "music.play_pause", "music.next", "music.volume",
        "music.set_source", "music.sd.scan", "music.sd.play_pause", "music.sd.next",
        "music.server.play_pause", "music.server.next", "music.server.cache",
        "screensaver.start", "screensaver.stop",
        "english.start", "schedule.complete", "schedule.snooze", "app.open", "openclaw.run",
        "content.recommend", "memory.add", "homeassistant.call", "homeassistant.scene", "nas.music.scan",
        "family.mode", "family.member.status", "voice.intent", "toast", "dialog.open", "notification.push"
    };
    return std::find(std::begin(kAllowed), std::end(kAllowed), action) != std::end(kAllowed);
}

bool AppRemotePageRenderer::IsAllowedComponent(const std::string& type) const {
    static const char* kAllowed[] = {
        "hero_status", "app_grid", "big_button", "card", "list", "progress_ring", "media_player",
        "quiz_card", "voice_orb", "toast", "dialog", "text", "button", "progress", "spacer"
    };
    return std::find(std::begin(kAllowed), std::end(kAllowed), type) != std::end(kAllowed);
}

std::string AppRemotePageRenderer::StatusLine() const {
    if (!status_.last_valid) {
        return status_.last_error;
    }
    return status_.last_page + " " + std::to_string(status_.component_count) + " 组件";
}

bool AppRemotePageRenderer::RenderCachedPage(const std::string& page, lv_obj_t* parent) {
    auto it = cached_pages_.find(page);
    if (it == cached_pages_.end() || parent == nullptr) {
        return false;
    }

    cJSON* root = cJSON_Parse(it->second.c_str());
    if (root == nullptr) {
        return false;
    }
    cJSON* data = cJSON_GetObjectItem(root, "data");
    if (!cJSON_IsObject(data)) {
        data = root;
    }
    cJSON* components = cJSON_GetObjectItem(data, "components");
    if (!cJSON_IsArray(components)) {
        components = cJSON_GetObjectItem(data, "children");
    }
    if (!cJSON_IsArray(components)) {
        cJSON_Delete(root);
        return false;
    }

    int cursor_y = 0;
    int rendered = 0;
    const int count = cJSON_GetArraySize(components);
    for (int i = 0; i < count && cursor_y < kRemoteSafeBottom; ++i) {
        cJSON* component = cJSON_GetArrayItem(components, i);
        if (!cJSON_IsObject(component)) {
            continue;
        }
        const std::string type = JsonString(component, "type");
        if (type == "text") {
            const std::string style = JsonString(component, "style", "body");
            const int step = style == "title" ? 30 : 24;
            if (!FitsRemoteArea(cursor_y, step)) {
                break;
            }
            RemoteLabel(parent, JsonString(component, "text", "--").c_str(), 0, cursor_y, 252, StyleColor(style),
                        LV_TEXT_ALIGN_CENTER, style == "body" ? LV_LABEL_LONG_WRAP : LV_LABEL_LONG_DOT);
            cursor_y += step;
            rendered++;
        } else if (type == "button" || type == "big_button") {
            const bool active = JsonString(component, "style") == "active";
            const int height = type == "big_button" ? 46 : 36;
            if (!FitsRemoteArea(cursor_y, height)) {
                break;
            }
            RemoteButton(parent, JsonString(component, "text", "动作").c_str(), 0, cursor_y, 172,
                         height, cJSON_GetObjectItem(component, "action"), active);
            cursor_y += type == "big_button" ? 52 : 42;
            rendered++;
        } else if (type == "card" || type == "hero_status") {
            const int height = type == "hero_status" ? 58 : 50;
            if (!FitsRemoteArea(cursor_y, height)) {
                break;
            }
            auto card = RemotePanel(parent, 0, cursor_y, 268, height,
                                    type == "hero_status" ? kRemoteActiveBg : kRemoteBg,
                                    type == "hero_status" ? kRemoteAccent : kRemoteBorder, 20);
            RemoteLabel(card, JsonString(component, "title", JsonString(component, "text", "状态")).c_str(), 0, 8,
                        220, kRemoteText, LV_TEXT_ALIGN_CENTER);
            RemoteLabel(card, JsonString(component, "subtitle", "--").c_str(), 0, 31, 220, kRemoteMutedText,
                        LV_TEXT_ALIGN_CENTER);
            AttachAction(card, cJSON_GetObjectItem(component, "action"));
            cursor_y += type == "hero_status" ? 66 : 58;
            rendered++;
        } else if (type == "list") {
            cJSON* items = cJSON_GetObjectItem(component, "items");
            const int item_count = cJSON_IsArray(items) ? cJSON_GetArraySize(items) : 0;
            for (int j = 0; j < item_count && j < 4 && FitsRemoteArea(cursor_y, 38); ++j) {
                if (RenderListItem(parent, cJSON_GetArrayItem(items, j), cursor_y)) {
                    cursor_y += 42;
                    rendered++;
                }
            }
        } else if (type == "app_grid") {
            cJSON* items = cJSON_GetObjectItem(component, "items");
            const int item_count = cJSON_IsArray(items) ? cJSON_GetArraySize(items) : 0;
            const int rendered_count = std::min(item_count, 4);
            const int rows = (rendered_count + 1) / 2;
            const int grid_height = rows <= 1 ? 52 : 110;
            if (rendered_count <= 0 || !FitsRemoteArea(cursor_y, grid_height)) {
                break;
            }
            for (int j = 0; j < rendered_count; ++j) {
                cJSON* item = cJSON_GetArrayItem(items, j);
                if (!cJSON_IsObject(item)) {
                    continue;
                }
                const int x = (j % 2 == 0) ? -70 : 70;
                const int y = cursor_y + (j / 2) * 58;
                auto tile = RemotePanel(parent, x, y, 132, 52, kRemoteSoftBg, kRemoteBorder, 18);
                RemoteLabel(tile, JsonString(item, "label", JsonString(item, "title", "应用")).c_str(), 0, 8,
                            108, kRemoteText, LV_TEXT_ALIGN_CENTER);
                RemoteLabel(tile, JsonString(item, "subtitle", "--").c_str(), 0, 30, 108, kRemoteMutedText,
                            LV_TEXT_ALIGN_CENTER);
                AttachAction(tile, cJSON_GetObjectItem(item, "action"));
                rendered++;
            }
            cursor_y += rows > 1 ? 116 : 58;
        } else if (type == "progress" || type == "progress_ring") {
            const int min = JsonInt(component, "min", 0);
            const int max = JsonInt(component, "max", 100);
            const int value = JsonInt(component, "value", 0);
            if (type == "progress_ring") {
                if (!FitsRemoteArea(cursor_y, 76)) {
                    break;
                }
                auto arc = lv_arc_create(parent);
                lv_obj_set_size(arc, 76, 76);
                lv_arc_set_range(arc, min, max);
                lv_arc_set_value(arc, value);
                lv_obj_remove_flag(arc, LV_OBJ_FLAG_CLICKABLE);
                lv_obj_align(arc, LV_ALIGN_TOP_MID, 0, cursor_y);
                cursor_y += 84;
            } else {
                if (!FitsRemoteArea(cursor_y, 34)) {
                    break;
                }
                RemoteLabel(parent, JsonString(component, "label", "进度").c_str(), 0, cursor_y, 180,
                            kRemoteMutedText);
                auto bar = lv_bar_create(parent);
                lv_obj_set_size(bar, 210, 8);
                lv_obj_align(bar, LV_ALIGN_TOP_MID, 0, cursor_y + 24);
                lv_bar_set_range(bar, min, max);
                lv_bar_set_value(bar, value, LV_ANIM_OFF);
                lv_obj_set_style_bg_color(bar, lv_color_hex(kRemoteBg), 0);
                lv_obj_set_style_bg_color(bar, lv_color_hex(kRemoteAccent), LV_PART_INDICATOR);
                cursor_y += 42;
            }
            rendered++;
        } else if (type == "media_player") {
            if (!FitsRemoteArea(cursor_y, 76)) {
                break;
            }
            auto panel = RemotePanel(parent, 0, cursor_y, 268, 76, kRemoteBg, kRemoteWarm, 20);
            RemoteLabel(panel, JsonString(component, "title", "媒体").c_str(), 0, 10, 222, kRemoteText);
            RemoteLabel(panel, JsonString(component, "subtitle", "--").c_str(), 0, 34, 222, kRemoteMutedText);
            RemoteButton(panel, JsonString(component, "button", "播放").c_str(), 0, 50, 90, 24,
                         cJSON_GetObjectItem(component, "action"));
            cursor_y += 84;
            rendered++;
        } else if (type == "quiz_card") {
            if (!FitsRemoteArea(cursor_y, 70)) {
                break;
            }
            auto panel = RemotePanel(parent, 0, cursor_y, 268, 70, kRemoteBg, kRemoteBlue, 20);
            RemoteLabel(panel, JsonString(component, "title", "练习").c_str(), 0, 10, 220, kRemoteText);
            RemoteLabel(panel, JsonString(component, "subtitle", JsonString(component, "text", "--")).c_str(), 0,
                        34, 220, kRemoteMutedText, LV_TEXT_ALIGN_CENTER, LV_LABEL_LONG_WRAP);
            cursor_y += 78;
            rendered++;
        } else if (type == "voice_orb") {
            if (!FitsRemoteArea(cursor_y, 88)) {
                break;
            }
            auto outer = RemotePanel(parent, 0, cursor_y, 88, 88, kRemoteActiveBg, kRemoteAccent, 44);
            RemoteLabel(outer, JsonString(component, "text", "AI").c_str(), 0, 30, 70, kRemoteAccent);
            cursor_y += 96;
            rendered++;
        } else if (type == "toast" || type == "dialog") {
            if (!FitsRemoteArea(cursor_y, 24)) {
                break;
            }
            RemoteLabel(parent, JsonString(component, "text", JsonString(component, "title", "提示")).c_str(), 0,
                        cursor_y, 230, kRemoteWarm);
            cursor_y += 28;
            rendered++;
        } else if (type == "spacer") {
            cursor_y += JsonInt(component, "height", 12);
        }
    }
    cJSON_Delete(root);
    return rendered > 0;
}
