"""Unit tests for the family_agent_ask plugin.

Feature: selfhosted-voice-provider-page-agents
secret redaction unit test (Req 7.5)

These tests exercise the framework-independent pure functions
(build_request_body, parse_response, _redact/sanitize_data, endpoint/token
resolution) plus the thin plugin entry point with the HTTP call monkeypatched.
They do not require the xiaozhi-esp32-server runtime or the ``requests``
dependency.
"""

import os
import sys
import types
import unittest

# Make the plugin module importable without the xiaozhi-esp32-server runtime.
_FUNCTIONS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "plugins_func",
    "functions",
)
sys.path.insert(0, _FUNCTIONS_DIR)

import family_agent_ask as faa  # noqa: E402


class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class BuildRequestBodyTests(unittest.TestCase):
    def test_body_has_required_fields(self):
        body = faa.build_request_body(
            page="music",
            utterance="继续播放上次没听完的",
            familyMode="默认",
            deviceId="esp32-185b",
        )
        self.assertEqual(body["page"], "music")
        self.assertEqual(body["utterance"], "继续播放上次没听完的")
        self.assertEqual(body["familyMode"], "默认")
        self.assertEqual(body["deviceId"], "esp32-185b")
        # text mirrors utterance (parity with the Node bridge callAgent)
        self.assertEqual(body["text"], body["utterance"])
        self.assertEqual(body["inputType"], "voice")
        self.assertEqual(body["source"], "selfhosted.voice")
        self.assertEqual(body["confirmed"], False)
        self.assertEqual(body["pageState"], {})
        self.assertIn("user", body)

    def test_defaults_and_confirmed(self):
        body = faa.build_request_body(
            page="settings",
            utterance="状态",
            familyMode="访客",
            deviceId="",
            pageState={"currentTrackId": "t1"},
            confirmed=True,
        )
        self.assertEqual(body["deviceId"], faa.DEFAULT_DEVICE_ID)
        self.assertEqual(body["confirmed"], True)
        self.assertEqual(body["pageState"], {"currentTrackId": "t1"})


class EndpointAndTokenTests(unittest.TestCase):
    def test_endpoint_from_env_strips_trailing_slash(self):
        env = {"FAMILY_BACKEND_URL": "http://10.0.0.5:3100/"}
        self.assertEqual(
            faa.endpoint_from_env(env), "http://10.0.0.5:3100/api/agent/ask"
        )

    def test_endpoint_default(self):
        self.assertEqual(
            faa.endpoint_from_env({}),
            "http://192.168.31.246:3100/api/agent/ask",
        )

    def test_token_prefers_xiaozhi_then_ai(self):
        self.assertEqual(faa.token_from_env({"XIAOZHI_TOOL_TOKEN": "abc"}), "abc")
        self.assertEqual(faa.token_from_env({"AI_TOOL_TOKEN": "def"}), "def")
        self.assertEqual(faa.token_from_env({}), "")

    def test_build_headers_attaches_bearer(self):
        headers = faa.build_headers("secret-token")
        self.assertEqual(headers["Authorization"], "Bearer secret-token")

    def test_build_headers_no_token(self):
        headers = faa.build_headers("")
        self.assertNotIn("Authorization", headers)


class RedactionTests(unittest.TestCase):
    def test_redact_strips_secret_keys(self):
        obj = {
            "speech": "ok",
            "token": "SEKRET",
            "nested": {"api_key": "K", "apiKey": "K2", "keep": 1},
            "list": [{"password": "p", "value": 2}],
            "authorization": "Bearer x",
        }
        out = faa._redact(obj)
        self.assertNotIn("token", out)
        self.assertNotIn("authorization", out)
        self.assertNotIn("api_key", out["nested"])
        self.assertNotIn("apiKey", out["nested"])
        self.assertEqual(out["nested"]["keep"], 1)
        self.assertNotIn("password", out["list"][0])
        self.assertEqual(out["list"][0]["value"], 2)

    def test_sanitize_scrubs_literal_token_from_speech_and_display(self):
        token = "TOK-12345"
        data = {
            "speech": f"your token is {token}",
            "display": {"toast": f"debug {token}"},
        }
        safe = faa.sanitize_data(data, secret_values=(token,))
        self.assertNotIn(token, safe["speech"])
        self.assertNotIn(token, safe["display"]["toast"])

    def test_parse_response_never_leaks_token(self):
        token = "XZ-TOOL-TOKEN-XYZ"
        payload = {
            "ok": True,
            "data": {
                "speech": "好的",
                "display": {"page": "music"},
                "authorization": f"Bearer {token}",
                "requiresConfirmation": False,
            },
        }
        result = faa.parse_response(200, payload, secret_values=(token,))
        blob = repr(result)
        self.assertNotIn(token, blob)
        self.assertNotIn("authorization", result["data"])


class ParseResponseTests(unittest.TestCase):
    def test_success_returns_response_kind(self):
        payload = {
            "ok": True,
            "data": {
                "agent": "media",
                "speech": "好的，继续播放。",
                "display": {"page": "music", "toast": "继续播放"},
                "requiresConfirmation": False,
            },
        }
        result = faa.parse_response(200, payload)
        self.assertEqual(result["kind"], "response")
        self.assertEqual(result["speech"], "好的，继续播放。")
        self.assertFalse(result["requiresConfirmation"])

    def test_requires_confirmation(self):
        payload = {
            "ok": True,
            "data": {
                "speech": "确认要运行这个高风险操作吗？",
                "tool": "family.openclaw.run",
                "requiresConfirmation": True,
            },
        }
        result = faa.parse_response(200, payload)
        self.assertEqual(result["kind"], "confirm")
        self.assertTrue(result["requiresConfirmation"])

    def test_backend_not_ok(self):
        payload = {"ok": False, "error": "boom", "data": {"speech": "抱歉出错了"}}
        result = faa.parse_response(500, payload)
        self.assertEqual(result["kind"], "error")
        self.assertEqual(result["error"], "backend_not_ok")

    def test_http_error_status(self):
        result = faa.parse_response(403, {"ok": True, "data": {"speech": "x"}})
        self.assertEqual(result["kind"], "error")

    def test_unhandled_requests_provider_llm_fallback(self):
        result = faa.parse_response(
            200,
            {
                "ok": True,
                "data": {"handled": False, "fallbackReason": "general_query"},
            },
        )
        self.assertEqual(result["kind"], "fallback")


class PluginEntryTests(unittest.TestCase):
    """Thin-wrapper behaviour with the HTTP call monkeypatched."""

    def setUp(self):
        self._captured = {}
        self._orig_post = faa._http_post
        self._orig_environ = dict(os.environ)

        def fake_post(url, headers, body, timeout=faa.REQUEST_TIMEOUT_SECONDS):
            self._captured["url"] = url
            self._captured["headers"] = headers
            self._captured["body"] = body
            return _FakeResponse(
                200,
                {
                    "ok": True,
                    "data": {
                        "agent": "media",
                        "speech": "好的，继续播放。",
                        "display": {"page": "music"},
                        "requiresConfirmation": False,
                    },
                },
            )

        faa._http_post = fake_post

    def tearDown(self):
        faa._http_post = self._orig_post
        os.environ.clear()
        os.environ.update(self._orig_environ)

    def test_post_body_shape_and_auth_header(self):
        os.environ["XIAOZHI_TOOL_TOKEN"] = "unit-token"
        resp = faa.family_agent_ask(
            conn=None,
            page="music",
            utterance="继续",
            familyMode="默认",
            deviceId="esp32-185b",
        )
        body = self._captured["body"]
        self.assertEqual(body["page"], "music")
        self.assertEqual(body["utterance"], "继续")
        self.assertEqual(body["familyMode"], "默认")
        self.assertEqual(body["deviceId"], "esp32-185b")
        self.assertEqual(
            self._captured["headers"]["Authorization"], "Bearer unit-token"
        )
        # Speech is spoken directly.
        self.assertEqual(resp.action, faa.Action.RESPONSE)
        self.assertEqual(resp.response, "好的，继续播放。")

    def test_missing_family_mode_defers(self):
        called = {"post": False}

        def guard_post(*args, **kwargs):
            called["post"] = True
            return _FakeResponse(200, {"ok": True, "data": {}})

        faa._http_post = guard_post
        resp = faa.family_agent_ask(
            conn=None,
            page="music",
            utterance="继续",
            familyMode="",
            deviceId="esp32-185b",
        )
        self.assertFalse(called["post"])  # no backend call without context
        self.assertEqual(resp.action, faa.Action.RESPONSE)
        self.assertEqual(resp.response, faa.MISSING_CONTEXT_SPEECH)

    def test_requires_confirmation_does_not_execute(self):
        def confirm_post(url, headers, body, timeout=faa.REQUEST_TIMEOUT_SECONDS):
            return _FakeResponse(
                200,
                {
                    "ok": True,
                    "data": {
                        "speech": "确认要运行这个高风险操作吗？",
                        "tool": "family.openclaw.run",
                        "requiresConfirmation": True,
                    },
                },
            )

        faa._http_post = confirm_post
        resp = faa.family_agent_ask(
            conn=None,
            page="apps",
            utterance="运行 openclaw",
            familyMode="默认",
            deviceId="esp32-185b",
        )
        self.assertEqual(resp.action, faa.Action.RESPONSE)
        self.assertIn("确认", resp.response)

    def test_token_never_appears_in_response(self):
        token = "SUPER-SECRET-TOOL-TOKEN"
        os.environ["XIAOZHI_TOOL_TOKEN"] = token

        def leaky_post(url, headers, body, timeout=faa.REQUEST_TIMEOUT_SECONDS):
            return _FakeResponse(
                200,
                {
                    "ok": True,
                    "data": {
                        "speech": f"echo {token}",
                        "display": {"toast": f"dbg {token}"},
                        "authorization": f"Bearer {token}",
                        "requiresConfirmation": False,
                    },
                },
            )

        faa._http_post = leaky_post
        resp = faa.family_agent_ask(
            conn=None,
            page="ai",
            utterance="hi",
            familyMode="默认",
            deviceId="esp32-185b",
        )
        self.assertNotIn(token, str(resp.response))
        self.assertNotIn(token, repr(resp.result))

    def test_network_error_returns_general_answer(self):
        def boom_post(*args, **kwargs):
            raise OSError("connection refused")

        faa._http_post = boom_post
        resp = faa.family_agent_ask(
            conn=None,
            page="home",
            utterance="今天天气怎么样",
            familyMode="默认",
            deviceId="esp32-185b",
        )
        # Falls back to the server's own LLM, no backend-detail disclosure.
        self.assertEqual(resp.action, faa.Action.REQLLM)


if __name__ == "__main__":
    unittest.main()
