"""family_agent_ask plugin for xiaozhi-esp32-server.

Feature: selfhosted-voice-provider-page-agents

Routes a page-scoped family request from the self-hosted voice provider
(xiaozhi-esp32-server) to the Family Backend Page Agent endpoint
``POST /api/agent/ask``.

Design reference: design.md "Option A (recommended): local function-calling
plugin". The plugin is a thin delegator over the unchanged Family Backend
"brain" (server/src/agents.js).

Deployment: copy this file into the xiaozhi-esp32-server checkout under
``plugins_func/functions/`` and register ``family_agent_ask`` in
``data/.config.yaml`` under ``Intent.function_call.functions``. See the
neighbouring README.md for the full deployment steps and required environment
variables (FAMILY_BACKEND_URL, XIAOZHI_TOOL_TOKEN).

The core logic (request-body construction, response parsing, and secret
redaction) is implemented as pure functions so it can be unit-tested without
the xiaozhi-esp32-server runtime or the ``requests`` dependency. The registered
plugin entry point is a thin wrapper around those pure functions.
"""

import json
import os

# ---------------------------------------------------------------------------
# Framework imports (guarded)
#
# The register_function decorator, ToolType, Action and ActionResponse are
# provided by the xiaozhi-esp32-server runtime. When this module is imported
# outside that runtime (e.g. by the unit tests), the imports fall back to
# lightweight stand-ins so the pure functions remain importable and testable.
# ---------------------------------------------------------------------------
try:  # pragma: no cover - exercised only inside xiaozhi-esp32-server
    from plugins_func.register import register_function, ToolType, ActionResponse, Action
    _FRAMEWORK_AVAILABLE = True
except Exception:  # pragma: no cover - fallback for standalone/testing
    _FRAMEWORK_AVAILABLE = False

    from enum import Enum

    class ToolType(Enum):
        SYSTEM_CTL = 1
        WAIT = 2
        CHANGE_SYS_PROMPT = 3
        IOT_CTL = 4
        NONE = 5

    class Action(Enum):
        NOTFOUND = (0, "没有找到函数")
        NONE = (1, "啥也不干")
        RESPONSE = (2, "直接回复")
        REQLLM = (3, "调用函数后再请求llm生成回复")

        def __init__(self, code, message):
            self.code = code
            self.message = message

    class ActionResponse:
        def __init__(self, action=Action.NONE, result=None, response=None):
            self.action = action
            self.result = result
            self.response = response

    def register_function(name, desc, tool_type):
        def _decorator(func):
            func._function_name = name
            func._function_desc = desc
            func._tool_type = tool_type
            return func

        return _decorator


try:  # pragma: no cover - logger only present inside the runtime
    from config.logger import setup_logging

    TAG = __name__
    logger = setup_logging()
except Exception:  # pragma: no cover
    import logging

    logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_BACKEND_URL = "http://192.168.31.246:3100"
DEFAULT_DEVICE_ID = "esp32-185b"
AGENT_ASK_PATH = "/api/agent/ask"
REQUEST_TIMEOUT_SECONDS = 5
SOURCE_TAG = "selfhosted.voice"

# Substrings (case-insensitive) marking a dict key as secret-bearing.
_SECRET_KEY_MARKERS = (
    "token",
    "secret",
    "authorization",
    "api_key",
    "apikey",
    "password",
)
_REDACTED = "***"


# ---------------------------------------------------------------------------
# Function schema advertised to the LLM
# ---------------------------------------------------------------------------
FAMILY_AGENT_ASK_FUNCTION_DESC = {
    "type": "function",
    "function": {
        "name": "family_agent_ask",
        "description": (
            "Route a page-scoped family request to the Family Backend Page "
            "Agent. Always call self.page.get_context first and pass the "
            "returned page and familyMode."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "string",
                    "description": (
                        "Backend page key from device context (home, weather, "
                        "schedule, ai, music, album, apps, settings)"
                    ),
                },
                "utterance": {
                    "type": "string",
                    "description": "The user's final transcript",
                },
                "familyMode": {
                    "type": "string",
                    "description": "Current user mode: 默认 (parent) | 儿童 | 访客",
                },
                "deviceId": {
                    "type": "string",
                    "description": "Target device id (default esp32-185b)",
                },
                "pageState": {
                    "type": "object",
                    "description": (
                        "Optional page context (e.g. currentTrackId, "
                        "currentScheduleId)"
                    ),
                },
                "confirmed": {
                    "type": "boolean",
                    "description": (
                        "true when re-asking after a high-risk confirmation "
                        "prompt"
                    ),
                },
            },
            "required": ["page", "utterance", "familyMode", "deviceId"],
        },
    },
}


# ---------------------------------------------------------------------------
# Pure helpers (framework-independent, unit-testable)
# ---------------------------------------------------------------------------
def endpoint_from_env(env=None):
    """Resolve the /api/agent/ask endpoint.

    Reads FAMILY_BACKEND_URL (trailing slash stripped) and appends the agent
    ask path, falling back to the default backend URL.
    """
    env = env if env is not None else os.environ
    base = (env.get("FAMILY_BACKEND_URL") or DEFAULT_BACKEND_URL).rstrip("/")
    return f"{base}{AGENT_ASK_PATH}"


def token_from_env(env=None):
    """Resolve the tool auth token from XIAOZHI_TOOL_TOKEN, then AI_TOOL_TOKEN."""
    env = env if env is not None else os.environ
    return env.get("XIAOZHI_TOOL_TOKEN") or env.get("AI_TOOL_TOKEN") or ""


def build_headers(token):
    """Build request headers, attaching a bearer token when present."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def build_request_body(
    page,
    utterance,
    familyMode,
    deviceId,
    pageState=None,
    confirmed=False,
):
    """Build the POST body for /api/agent/ask.

    Mirrors the Node bridge callAgent (server/src/xiaozhi-mcp-bridge.js): sends
    both ``text`` and ``utterance`` (same value), plus the page-agent routing
    fields required by the backend contract (server/src/agents.js).
    """
    text = utterance or ""
    return {
        "text": text,
        "utterance": text,
        "page": page or "",
        "inputType": "voice",
        "deviceId": deviceId or DEFAULT_DEVICE_ID,
        "user": {"id": "device", "role": ""},
        "familyMode": familyMode or "",
        "pageState": pageState if isinstance(pageState, dict) else {},
        "confirmed": bool(confirmed),
        "source": SOURCE_TAG,
    }


def needs_context(familyMode):
    """True when familyMode is missing/empty (Req 4.4 defer without context)."""
    return not (familyMode and str(familyMode).strip())


def _key_is_secret(key):
    lowered = str(key).lower()
    return any(marker in lowered for marker in _SECRET_KEY_MARKERS)


def _redact(obj):
    """Recursively strip any key whose name marks it as secret-bearing.

    Keys containing token/secret/authorization/api_key/apikey/password
    (case-insensitive) are removed entirely. Returns a redacted copy; the input
    is not mutated.
    """
    if isinstance(obj, dict):
        return {
            key: _redact(value)
            for key, value in obj.items()
            if not _key_is_secret(key)
        }
    if isinstance(obj, list):
        return [_redact(item) for item in obj]
    if isinstance(obj, tuple):
        return tuple(_redact(item) for item in obj)
    return obj


def _redact_text(value, secret_values):
    """Replace any literal secret value occurrence in a string with ``***``."""
    if value is None:
        return value
    if isinstance(value, str):
        redacted = value
        for secret in secret_values:
            if secret:
                redacted = redacted.replace(secret, _REDACTED)
        return redacted
    if isinstance(value, dict):
        return {k: _redact_text(v, secret_values) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_text(item, secret_values) for item in value]
    return value


def sanitize_data(data, secret_values=()):
    """Apply structural key redaction plus literal secret-value scrubbing.

    Ensures secrets never enter TTS speech, the display payload, or the
    structured result handed back to the LLM (Req 7.5).
    """
    if not isinstance(data, dict):
        return data
    stripped = _redact(data)
    return _redact_text(stripped, tuple(s for s in secret_values if s))


def parse_response(status_code, payload, secret_values=()):
    """Parse a backend response into a normalized, redacted result.

    The backend wraps replies as ``{ok: bool, data: {...}, error?}``. On success
    (HTTP 2xx and payload.ok truthy) the sanitized ``data`` is returned. On
    failure a gentle error result is produced without leaking backend detail.

    Returns a dict:
      {
        "kind": "response" | "confirm" | "error",
        "speech": str,            # TTS-safe, redacted
        "display": Any,           # redacted
        "data": dict,             # sanitized structured result
        "requiresConfirmation": bool,
        "error": str | None,
      }
    """
    payload = payload if isinstance(payload, dict) else {}
    ok_status = isinstance(status_code, int) and 200 <= status_code < 300

    if not ok_status or not payload.get("ok"):
        # Failure path: surface backend-provided speech when safe, otherwise a
        # gentle generic phrase. Never expose HTTP/backend internals.
        fallback_data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        speech = sanitize_data({"speech": fallback_data.get("speech")}, secret_values).get("speech")
        return {
            "kind": "error",
            "speech": speech or "",
            "display": {},
            "data": {},
            "requiresConfirmation": False,
            "error": "backend_not_ok",
        }

    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    safe = sanitize_data(data, secret_values)
    if safe.get("handled") is False:
        return {
            "kind": "fallback",
            "speech": "",
            "display": {},
            "data": safe,
            "requiresConfirmation": False,
            "error": None,
        }
    requires_confirmation = bool(safe.get("requiresConfirmation"))
    speech = safe.get("speech") or ""
    display = safe.get("display", {})

    return {
        "kind": "confirm" if requires_confirmation else "response",
        "speech": speech,
        "display": display,
        "data": safe,
        "requiresConfirmation": requires_confirmation,
        "error": None,
    }


# Gentle, backend-agnostic phrasing used when the backend is unreachable
# (Req 6.3 — no "reduced feature" disclaimer, no backend detail).
NETWORK_ERROR_SPEECH = "我先直接帮你回答这个问题。"
MISSING_CONTEXT_SPEECH = "请先获取当前页面信息，再让我处理这个请求。"


def _http_post(url, headers, body, timeout=REQUEST_TIMEOUT_SECONDS):
    """Perform the HTTP POST. Isolated so tests can monkeypatch it.

    ``requests`` is imported lazily so the module (and its pure helpers) import
    cleanly in environments without the dependency.
    """
    import requests

    return requests.post(url, headers=headers, data=json.dumps(body), timeout=timeout)


# ---------------------------------------------------------------------------
# Plugin entry point (thin wrapper over the pure helpers)
# ---------------------------------------------------------------------------
@register_function("family_agent_ask", FAMILY_AGENT_ASK_FUNCTION_DESC, ToolType.SYSTEM_CTL)
def family_agent_ask(
    conn,
    page,
    utterance,
    familyMode,
    deviceId=DEFAULT_DEVICE_ID,
    pageState=None,
    confirmed=False,
):
    """Route a page-scoped family request to the Family Backend Page Agent.

    The LLM MUST call the device MCP tool ``self.page.get_context`` first and
    pass the returned ``page`` and ``familyMode`` into this tool. When
    ``familyMode`` is missing, the call is deferred with a prompt to fetch the
    device context first (Req 4.4).

    High-risk actions returned with ``requiresConfirmation: true`` are NOT
    executed automatically; the user must confirm and the tool must be
    re-invoked with ``confirmed=true`` (contract: agents.js HIGH_RISK_TOOLS).

    Secrets (XIAOZHI_TOOL_TOKEN / AI_TOOL_TOKEN) are never placed into speech,
    display, or the structured result (Req 7.5).
    """
    # Defer when the device context (familyMode) has not been provided yet.
    if needs_context(familyMode):
        return ActionResponse(Action.RESPONSE, None, MISSING_CONTEXT_SPEECH)

    token = token_from_env()
    secret_values = (token, os.environ.get("XIAOZHI_TOOL_TOKEN", ""), os.environ.get("AI_TOOL_TOKEN", ""))
    url = endpoint_from_env()
    headers = build_headers(token)
    body = build_request_body(page, utterance, familyMode, deviceId, pageState, confirmed)

    try:
        response = _http_post(url, headers, body)
        status_code = getattr(response, "status_code", 0)
        try:
            payload = response.json()
        except Exception:
            payload = {}
    except Exception as exc:  # network unreachable / timeout
        logger.warning(f"family_agent_ask backend unreachable: {exc}")
        # Answer from the voice server's own LLM as a general answer, without
        # disclosing that features are reduced (Req 6.3).
        return ActionResponse(Action.REQLLM, NETWORK_ERROR_SPEECH, None)

    result = parse_response(status_code, payload, secret_values)

    if result["kind"] == "error":
        speech = result["speech"] or NETWORK_ERROR_SPEECH
        return ActionResponse(Action.REQLLM, speech, None)

    if result["kind"] == "fallback":
        return ActionResponse(Action.REQLLM, NETWORK_ERROR_SPEECH, None)

    if result["kind"] == "confirm":
        # High-risk action: speak the confirmation prompt and stop. Do not
        # execute. The LLM should re-invoke with confirmed=true after a "yes".
        return ActionResponse(Action.RESPONSE, result["data"], result["speech"])

    # Normal response: speak the backend speech, hand back sanitized data.
    return ActionResponse(Action.RESPONSE, result["data"], result["speech"])
