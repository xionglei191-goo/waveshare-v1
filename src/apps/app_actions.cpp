#include "apps/app_actions.h"

#include "app_config.h"

const char *appActionTitle(AppAction action) {
  switch (action) {
    case AppAction::EnglishPractice:
      return "英语练习";
    case AppAction::AskAi:
      return "问 AI";
    case AppAction::MiniGame:
      return "小游戏";
  }
  return "未知";
}

const char *appActionEndpoint(AppAction action) {
  switch (action) {
    case AppAction::EnglishPractice:
      return API_ENGLISH_ENDPOINT;
    case AppAction::AskAi:
      return API_ASK_AI_ENDPOINT;
    case AppAction::MiniGame:
      return API_MINI_GAME_ENDPOINT;
  }
  return "/";
}

const char *appActionPayload(AppAction action) {
  switch (action) {
    case AppAction::EnglishPractice:
      return "{\"device\":\"" DEVICE_NAME "\",\"action\":\"english_practice\"}";
    case AppAction::AskAi:
      return "{\"device\":\"" DEVICE_NAME "\",\"action\":\"ask_ai\",\"prompt\":\"hello\"}";
    case AppAction::MiniGame:
      return "{\"device\":\"" DEVICE_NAME "\",\"action\":\"mini_game\"}";
  }
  return "{\"device\":\"" DEVICE_NAME "\",\"action\":\"unknown\"}";
}

