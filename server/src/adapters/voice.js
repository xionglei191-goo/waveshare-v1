function recordVoiceIntent(state, event) {
  state.voice = state.voice || { history: [] };
  state.voice.history.unshift({
    id: `voice_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    at: new Date().toISOString(),
    text: String(event.text || "").slice(0, 500),
    matched: Boolean(event.matched),
    action: event.action || "",
    reason: event.reason || ""
  });
  state.voice.history = state.voice.history.slice(0, 50);
}

module.exports = { recordVoiceIntent };
