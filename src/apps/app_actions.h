#pragma once

enum class AppAction {
  EnglishPractice,
  AskAi,
  MiniGame,
};

const char *appActionTitle(AppAction action);
const char *appActionEndpoint(AppAction action);
const char *appActionPayload(AppAction action);

