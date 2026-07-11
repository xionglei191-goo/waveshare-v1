"""Tests for deterministic page-first routing without the upstream runtime."""

import asyncio
import os
import sys
import unittest


_ROUTER_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "core", "handle"
)
sys.path.insert(0, _ROUTER_DIR)

import family_page_router as router  # noqa: E402


class _Conn:
    family_page_pending_request = None
    session_id = "session-test"


async def _context(_timeout):
    return '{"page":"music","familyMode":"默认","deviceId":"esp32-185b","pageState":{"currentTrackId":"t1"}}'


class RouterPureTests(unittest.TestCase):
    def test_context_and_body(self):
        context = router.parse_context(
            '{"page":"schedule","familyMode":"儿童","pageState":{"currentScheduleId":"s1"}}'
        )
        body = router.build_request(context, "完成", confirmed=True)
        self.assertEqual(body["page"], "schedule")
        self.assertEqual(body["pageState"]["currentScheduleId"], "s1")
        self.assertTrue(body["confirmed"])

    def test_missing_context_falls_back(self):
        self.assertIsNone(router.parse_context('{"page":"music"}'))

    def test_handled_contract(self):
        decision = router.parse_backend_response(
            200, {"ok": True, "data": {"handled": True, "speech": "好的"}}
        )
        self.assertEqual(decision["speech"], "好的")
        self.assertIsNone(
            router.parse_backend_response(
                200,
                {
                    "ok": True,
                    "data": {"handled": False, "fallbackReason": "general_query"},
                },
            )
        )

    def test_backend_speech_redacts_tool_token(self):
        old = os.environ.get("XIAOZHI_TOOL_TOKEN")
        os.environ["XIAOZHI_TOOL_TOKEN"] = "router-secret"
        try:
            decision = router.parse_backend_response(
                200,
                {
                    "ok": True,
                    "data": {"handled": True, "speech": "token router-secret"},
                },
            )
            self.assertNotIn("router-secret", decision["speech"])
        finally:
            if old is None:
                os.environ.pop("XIAOZHI_TOOL_TOKEN", None)
            else:
                os.environ["XIAOZHI_TOOL_TOKEN"] = old


class RouterAsyncTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.old_env = dict(os.environ)
        os.environ["FAMILY_PAGE_ROUTER_ENABLED"] = "1"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)

    async def test_handled_response_stops_at_page_agent(self):
        calls = []

        def post(body, timeout):
            calls.append(body)
            return 200, {"ok": True, "data": {"handled": True, "speech": "继续播放"}}

        decision = await router.route_family_page_turn(
            _Conn(), "继续", post_backend=post, call_context=_context
        )
        self.assertEqual(decision["speech"], "继续播放")
        self.assertEqual(calls[0]["deviceId"], "esp32-185b")
        self.assertTrue(calls[0]["traceId"])
        self.assertNotIn("page", calls[0])

    async def test_backend_context_cache_miss_reads_device_once_and_retries(self):
        calls = []

        def post(body, timeout):
            calls.append(body)
            if len(calls) == 1:
                return 428, {
                    "ok": False,
                    "error": "page_context_required",
                    "data": {"contextRequired": True},
                }
            return 200, {"ok": True, "data": {"handled": True, "speech": "继续播放"}}

        decision = await router.route_family_page_turn(
            _Conn(), "继续", post_backend=post, call_context=_context
        )
        self.assertEqual(decision["speech"], "继续播放")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["page"], "music")
        self.assertEqual(calls[1]["pageState"]["currentTrackId"], "t1")

    async def test_unhandled_and_errors_fall_through_once(self):
        calls = []

        def unhandled(body, timeout):
            calls.append(body)
            return 200, {"ok": True, "data": {"handled": False, "fallbackReason": "general_query"}}

        decision = await router.route_family_page_turn(
            _Conn(), "解释量子纠缠", post_backend=unhandled, call_context=_context
        )
        self.assertIsNone(decision)
        self.assertEqual(len(calls), 1)
        self.assertEqual(router.model_for_connection(_Conn(), "你好"), "gpt-5.4-mini")

        def failed(body, timeout):
            raise TimeoutError("backend timeout")

        self.assertIsNone(
            await router.route_family_page_turn(
                _Conn(), "你好", post_backend=failed, call_context=_context
            )
        )

    async def test_confirmation_reuses_original_utterance(self):
        conn = _Conn()
        bodies = []

        def post(body, timeout):
            bodies.append(body)
            if not body["confirmed"]:
                return 200, {
                    "ok": True,
                    "data": {
                        "handled": True,
                        "speech": "请确认",
                        "requiresConfirmation": True,
                    },
                }
            return 200, {"ok": True, "data": {"handled": True, "speech": "已执行"}}

        first = await router.route_family_page_turn(
            conn, "运行家庭场景", post_backend=post, call_context=_context
        )
        second = await router.route_family_page_turn(
            conn, "确认", post_backend=post, call_context=_context
        )
        self.assertTrue(first["requiresConfirmation"])
        self.assertEqual(second["speech"], "已执行")
        self.assertEqual(bodies[1]["utterance"], "运行家庭场景")
        self.assertTrue(bodies[1]["confirmed"])

    async def test_disabled_skips_context_and_backend(self):
        os.environ["FAMILY_PAGE_ROUTER_ENABLED"] = "0"
        called = False

        async def context(_timeout):
            nonlocal called
            called = True
            return "{}"

        self.assertIsNone(
            await router.route_family_page_turn(_Conn(), "hello", call_context=context)
        )
        self.assertFalse(called)

    async def test_three_backend_failures_open_circuit(self):
        conn = _Conn()
        calls = 0

        def failed(body, timeout):
            nonlocal calls
            calls += 1
            raise TimeoutError("backend timeout")

        for _ in range(3):
            self.assertIsNone(
                await router.route_family_page_turn(
                    conn, "你好", post_backend=failed, call_context=_context
                )
            )
        self.assertIsNone(
            await router.route_family_page_turn(
                conn, "你好", post_backend=failed, call_context=_context
            )
        )
        self.assertEqual(calls, 3)
        self.assertEqual(conn.family_fallback_reason, "backend_circuit_open")


if __name__ == "__main__":
    unittest.main()
