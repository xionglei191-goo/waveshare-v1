"""Deterministic page-first router for xiaozhi-esp32-server 0.9.5."""

import asyncio
import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor


PAGE_CONTEXT_TOOL = "self_page_get_context"
DEFAULT_BACKEND_URL = "http://192.168.31.246:3100"
DEFAULT_DEVICE_ID = "esp32-185b"
POSITIVE_CONFIRMATIONS = ("确认", "确定", "是的", "可以", "同意", "yes", "confirm")
NEGATIVE_CONFIRMATIONS = ("取消", "不要", "算了", "否", "no", "cancel")
COMPLEX_MARKERS = (
    "分析", "比较", "推理", "为什么", "方案", "代码", "设计", "规划", "总结", "解释",
    "量子", "纠缠", "证明", "算法", "架构",
    "analyze", "compare", "reason", "design", "plan", "code", "explain",
)

_http_local = threading.local()
_trace_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="family-trace")


def enabled(env=None):
    env = env if env is not None else os.environ
    return str(env.get("FAMILY_PAGE_ROUTER_ENABLED", "1")).strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def timeout_seconds(name, default_ms, env=None):
    env = env if env is not None else os.environ
    try:
        value = int(env.get(name, default_ms))
    except (TypeError, ValueError):
        value = default_ms
    return max(0.1, value / 1000.0)


def parse_context(raw):
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return None
    if not isinstance(raw, dict):
        return None
    page = str(raw.get("page") or "").strip().lower()
    family_mode = str(raw.get("familyMode") or "").strip()
    if not page or not family_mode:
        return None
    page_state = raw.get("pageState")
    return {
        "page": page,
        "familyMode": family_mode,
        "deviceId": str(raw.get("deviceId") or DEFAULT_DEVICE_ID).strip() or DEFAULT_DEVICE_ID,
        "pageState": page_state if isinstance(page_state, dict) else {},
    }


def build_request(context, utterance, confirmed=False, trace_id="", session_id="", device_id=""):
    text = str(utterance or "").strip()
    context = context if isinstance(context, dict) else {}
    body = {
        "text": text,
        "utterance": text,
        "inputType": "voice",
        "deviceId": str(context.get("deviceId") or device_id or DEFAULT_DEVICE_ID),
        "user": {"id": "device", "role": ""},
        "confirmed": bool(confirmed),
        "source": "selfhosted.voice.page_router",
        "traceId": str(trace_id or ""),
        "sessionId": str(session_id or ""),
        "requestId": str(trace_id or ""),
    }
    if context.get("page") and context.get("familyMode"):
        body.update(
            {
                "page": context["page"],
                "familyMode": context["familyMode"],
                "pageState": context.get("pageState") or {},
            }
        )
    return body


def parse_backend_response(status_code, payload):
    payload = payload if isinstance(payload, dict) else {}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    if data.get("handled") is not True:
        return None
    speech = str(data.get("speech") or "").strip() or "已处理。"
    for secret in (
        os.environ.get("XIAOZHI_TOOL_TOKEN", ""),
        os.environ.get("AI_TOOL_TOKEN", ""),
    ):
        if secret:
            speech = speech.replace(secret, "***")
    return {
        "handled": True,
        "speech": speech,
        "requiresConfirmation": bool(data.get("requiresConfirmation")),
        "fallbackReason": "",
        "traceId": str(data.get("traceId") or ""),
        "timings": data.get("timings") if isinstance(data.get("timings"), dict) else {},
        "httpStatus": int(status_code or 0),
    }


def confirmation_choice(text):
    normalized = str(text or "").strip().lower()
    if any(word in normalized for word in NEGATIVE_CONFIRMATIONS):
        return False
    if any(word in normalized for word in POSITIVE_CONFIRMATIONS):
        return True
    return None


def local_model_tier(utterance):
    text = str(utterance or "").strip().lower()
    return "complex" if len(text) > 80 or any(marker in text for marker in COMPLEX_MARKERS) else "lightweight"


def model_name_for_tier(tier):
    if tier == "complex":
        return os.environ.get("FAMILY_COMPLEX_MODEL", "gpt-5.5")
    return os.environ.get("FAMILY_LIGHTWEIGHT_MODEL", "gpt-5.4-mini")


def model_for_connection(conn, query=""):
    tier = getattr(conn, "family_model_tier", "") or local_model_tier(query)
    model = getattr(conn, "family_model_name", "") or model_name_for_tier(tier)
    conn.family_model_tier = tier
    conn.family_model_name = model
    return model


def _headers():
    token = os.environ.get("XIAOZHI_TOOL_TOKEN") or os.environ.get("AI_TOOL_TOKEN") or ""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _session():
    import requests

    session = getattr(_http_local, "session", None)
    if session is None:
        session = requests.Session()
        session.headers.update(_headers())
        _http_local.session = session
    return session


def _post_json(path, body, timeout):
    base = (os.environ.get("FAMILY_BACKEND_URL") or DEFAULT_BACKEND_URL).rstrip("/")
    response = _session().post(
        f"{base}{path}",
        data=json.dumps(body, ensure_ascii=False),
        timeout=timeout,
    )
    try:
        payload = response.json()
    except Exception:
        payload = {}
    return response.status_code, payload


def _post_backend(body, timeout):
    return _post_json("/api/agent/ask", body, timeout)


def _post_trace(body, timeout=1.0):
    try:
        return _post_json("/api/ai/traces", body, timeout)
    except Exception:
        return 0, {}


def report_trace_async(conn, stage, status="active", timings=None, error_type="", model_name=""):
    if getattr(conn, "family_trace_enabled", True) is False:
        return
    trace_id = str(getattr(conn, "family_trace_id", "") or "")
    if not trace_id:
        return
    body = {
        "traceId": trace_id,
        "sessionId": str(getattr(conn, "session_id", "") or ""),
        "deviceId": str(getattr(conn, "family_device_id", "") or DEFAULT_DEVICE_ID),
        "stage": stage,
        "status": status,
        "fallbackReason": str(getattr(conn, "family_fallback_reason", "") or ""),
        "modelTier": str(getattr(conn, "family_model_tier", "") or ""),
        "modelName": model_name or str(getattr(conn, "family_model_name", "") or ""),
        "timings": timings or {},
        "errorType": error_type,
    }
    _trace_executor.submit(_post_trace, body, timeout_seconds("FAMILY_TRACE_TIMEOUT_MS", 800))


def report_first_audio(conn):
    if getattr(conn, "family_first_audio_reported", False):
        return
    started = float(getattr(conn, "family_turn_started_monotonic", 0.0) or 0.0)
    if not started:
        return
    conn.family_first_audio_reported = True
    timings = {"firstAudioMs": int((time.monotonic() - started) * 1000)}
    tts_started = float(getattr(conn, "family_tts_queued_monotonic", 0.0) or 0.0)
    if tts_started:
        timings["ttsFirstAudioMs"] = int((time.monotonic() - tts_started) * 1000)
    report_trace_async(
        conn,
        "first_audio",
        status="handled" if not getattr(conn, "family_fallback_reason", "") else "fallback",
        timings=timings,
    )


def report_tts_queued(conn):
    conn.family_tts_queued_monotonic = time.monotonic()
    report_trace_async(conn, "tts_queued", status="handled")


def visible_response_content(response):
    if isinstance(response, tuple):
        return response[0] if response else ""
    if isinstance(response, dict):
        return response.get("content") or ""
    return response if isinstance(response, str) else ""


def sanitize_plain_stream(responses):
    """Unwrap provider DSML direct_answer output without speaking protocol tags."""
    prefix = "<｜｜DSML｜｜tool_calls>"
    value_marker = 'name="response" string="true">'
    close_marker = "</｜｜DSML｜｜parameter>"
    buffer = ""
    mode = "detect"
    for response in responses:
        content = visible_response_content(response)
        if not content:
            continue
        if mode == "plain":
            yield content
            continue
        buffer += content
        if mode == "detect":
            stripped = buffer.lstrip()
            if prefix.startswith(stripped) and len(stripped) < len(prefix):
                continue
            if not stripped.startswith(prefix):
                mode = "plain"
                yield buffer
                buffer = ""
                continue
            marker_at = buffer.find(value_marker)
            if marker_at < 0:
                continue
            buffer = buffer[marker_at + len(value_marker):]
            mode = "dsml"
        if mode == "dsml":
            close_at = buffer.find(close_marker)
            if close_at >= 0:
                if close_at:
                    yield buffer[:close_at]
                return
            safe_end = max(0, len(buffer) - len(close_marker))
            if safe_end:
                yield buffer[:safe_end]
                buffer = buffer[safe_end:]
    if mode == "plain" and buffer:
        yield buffer
    elif mode == "dsml" and buffer:
        yield buffer


def trace_llm_stream(conn, responses, model_name):
    started = time.monotonic()
    report_trace_async(conn, "llm_start", model_name=model_name)
    first = True
    try:
        for response in responses:
            if first and visible_response_content(response):
                first = False
                report_trace_async(
                    conn,
                    "llm_first_token",
                    timings={"llmFirstTokenMs": int((time.monotonic() - started) * 1000)},
                    model_name=model_name,
                )
            yield response
    except Exception as exc:
        report_trace_async(
            conn,
            "llm_error",
            status="failed",
            timings={"llmMs": int((time.monotonic() - started) * 1000)},
            error_type=type(exc).__name__,
            model_name=model_name,
        )
        raise
    finally:
        report_trace_async(
            conn,
            "llm_complete",
            status="fallback",
            timings={"llmMs": int((time.monotonic() - started) * 1000)},
            model_name=model_name,
        )


def _circuit_open(conn):
    return time.monotonic() < float(getattr(conn, "family_backend_open_until", 0.0) or 0.0)


def _record_backend_success(conn):
    conn.family_backend_failures = 0
    conn.family_backend_open_until = 0.0


def _record_backend_failure(conn):
    failures = int(getattr(conn, "family_backend_failures", 0) or 0) + 1
    conn.family_backend_failures = failures
    threshold = max(1, int(os.environ.get("FAMILY_BACKEND_CIRCUIT_FAILURES", "3")))
    if failures >= threshold:
        cooldown = timeout_seconds("FAMILY_BACKEND_CIRCUIT_COOLDOWN_MS", 15000)
        conn.family_backend_open_until = time.monotonic() + cooldown


def _set_fallback_metadata(conn, utterance, payload=None, reason=""):
    data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else {}
    tier = str(data.get("modelTier") or local_model_tier(utterance))
    conn.family_fallback_reason = str(data.get("fallbackReason") or reason or "general_query")
    conn.family_model_tier = tier
    conn.family_model_name = str(data.get("modelName") or model_name_for_tier(tier))


async def route_family_page_turn(conn, utterance, post_backend=None, call_context=None, post_trace=None):
    """Return a handled decision or None so the normal provider LLM can answer."""
    if not enabled():
        return None

    logger = getattr(conn, "logger", None)
    started = time.monotonic()
    trace_id = uuid.uuid4().hex
    conn.family_trace_id = trace_id
    conn.family_turn_started_monotonic = started
    conn.family_first_audio_reported = False
    conn.family_trace_enabled = post_backend is None or post_trace is not None
    conn.family_device_id = os.environ.get("FAMILY_DEVICE_ID", DEFAULT_DEVICE_ID)
    conn.family_fallback_reason = ""
    conn.family_model_tier = ""
    conn.family_model_name = ""
    conn.family_allow_provider_tools = True
    conn.family_tts_queued_monotonic = 0.0
    listen_stopped = float(getattr(conn, "family_listen_stopped_monotonic", 0.0) or 0.0)
    if listen_stopped:
        report_trace_async(
            conn,
            "asr_final",
            timings={"asrFinalizeMs": int((started - listen_stopped) * 1000)},
        )

    pending = getattr(conn, "family_page_pending_request", None)
    choice = confirmation_choice(utterance) if isinstance(pending, dict) else None
    if isinstance(pending, dict) and choice is False:
        conn.family_page_pending_request = None
        return {
            "handled": True,
            "speech": "已取消。",
            "requiresConfirmation": False,
            "traceId": trace_id,
        }

    confirmed = isinstance(pending, dict) and choice is True
    routed_utterance = pending.get("utterance", utterance) if confirmed else utterance
    if isinstance(pending, dict) and choice is None:
        conn.family_page_pending_request = None

    if _circuit_open(conn):
        _set_fallback_metadata(conn, routed_utterance, reason="backend_circuit_open")
        report_trace_async(conn, "backend_circuit_open", status="fallback")
        return None

    try:
        backend_timeout = timeout_seconds("FAMILY_BACKEND_TIMEOUT_MS", 2000)
        post = post_backend or _post_backend
        body = build_request(
            None,
            routed_utterance,
            confirmed=confirmed,
            trace_id=trace_id,
            session_id=getattr(conn, "session_id", ""),
            device_id=conn.family_device_id,
        )
        backend_started = time.monotonic()
        status_code, payload = await asyncio.wait_for(
            asyncio.to_thread(post, body, backend_timeout),
            timeout=backend_timeout + 0.2,
        )
        context_ms = 0

        data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else {}
        if status_code == 428 and data.get("contextRequired"):
            if call_context is None:
                if not getattr(conn, "mcp_client", None):
                    _record_backend_failure(conn)
                    _set_fallback_metadata(conn, routed_utterance, reason="page_context_missing")
                    return None
                from core.providers.tools.device_mcp.mcp_handler import call_mcp_tool

                async def call_context(timeout):
                    return await call_mcp_tool(
                        conn,
                        conn.mcp_client,
                        PAGE_CONTEXT_TOOL,
                        "{}",
                        timeout=max(1, int(timeout + 0.999)),
                    )

            context_started = time.monotonic()
            context_timeout = timeout_seconds("FAMILY_CONTEXT_TIMEOUT_MS", 1000)
            raw_context = await asyncio.wait_for(call_context(context_timeout), timeout=context_timeout + 0.1)
            context = parse_context(raw_context)
            context_ms = int((time.monotonic() - context_started) * 1000)
            if context is None:
                _record_backend_failure(conn)
                _set_fallback_metadata(conn, routed_utterance, reason="page_context_invalid")
                return None
            conn.family_page_context = context
            conn.family_device_id = context["deviceId"]
            body = build_request(
                context,
                routed_utterance,
                confirmed=confirmed,
                trace_id=trace_id,
                session_id=getattr(conn, "session_id", ""),
            )
            status_code, payload = await asyncio.wait_for(
                asyncio.to_thread(post, body, backend_timeout),
                timeout=backend_timeout + 0.2,
            )

        backend_ms = int((time.monotonic() - backend_started) * 1000)
        if status_code < 200 or status_code >= 300:
            _record_backend_failure(conn)
            _set_fallback_metadata(conn, routed_utterance, payload, reason=f"backend_http_{status_code}")
            report_trace_async(
                conn,
                "backend_error",
                status="fallback",
                timings={"contextMs": context_ms, "providerBackendMs": backend_ms},
                error_type=f"HTTP{status_code}",
            )
            return None

        _record_backend_success(conn)
        decision = parse_backend_response(status_code, payload)
        if decision is None:
            conn.family_allow_provider_tools = False
            _set_fallback_metadata(conn, routed_utterance, payload)
            report_trace_async(
                conn,
                "router_fallback",
                status="fallback",
                timings={
                    "contextMs": context_ms,
                    "providerBackendMs": backend_ms,
                    "routerMs": int((time.monotonic() - started) * 1000),
                },
            )
            return None
        if decision["requiresConfirmation"]:
            conn.family_page_pending_request = {"utterance": routed_utterance}
        else:
            conn.family_page_pending_request = None
        decision["traceId"] = decision.get("traceId") or trace_id
        report_trace_async(
            conn,
            "router_handled",
            status="handled",
            timings={
                "contextMs": context_ms,
                "providerBackendMs": backend_ms,
                "routerMs": int((time.monotonic() - started) * 1000),
            },
        )
        return decision
    except Exception as exc:
        _record_backend_failure(conn)
        _set_fallback_metadata(conn, routed_utterance, reason=type(exc).__name__)
        report_trace_async(
            conn,
            "router_error",
            status="fallback",
            timings={"routerMs": int((time.monotonic() - started) * 1000)},
            error_type=type(exc).__name__,
        )
        if logger is not None:
            try:
                logger.bind(tag=__name__).warning(
                    f"family page router fallback: {type(exc).__name__}"
                )
            except Exception:
                pass
        return None
