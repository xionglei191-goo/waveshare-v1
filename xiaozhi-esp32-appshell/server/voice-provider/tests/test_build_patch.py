"""Static checks for the pinned upstream image patch."""

import ast
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PATCHER = ROOT / "build" / "apply_page_router.py"


class BuildPatchTests(unittest.TestCase):
    def test_patcher_parses_and_redacts_connection_headers(self):
        source = PATCHER.read_text(encoding="utf-8")
        ast.parse(source)
        self.assertIn("CONNECTION_EXPECTED_SHA256", source)
        self.assertIn("OPENAI_EXPECTED_SHA256", source)
        self.assertIn("SEND_AUDIO_EXPECTED_SHA256", source)
        self.assertIn("ALI_TTS_EXPECTED_SHA256", source)
        self.assertIn("ASR_BASE_EXPECTED_SHA256", source)
        self.assertIn("trace_llm_stream", source)
        self.assertIn("old_task_id = self._active_task_id", source)
        self.assertIn("self._active_task_id = session_id", source)
        self.assertIn("识别文本完成: chars=", source)
        self.assertIn('kwargs.get("model_name", self.model_name)', source)
        self.assertIn("Header names", source)
        self.assertNotIn('conn - Headers: {self.headers}', source.split("CONNECTION_REPLACEMENT", 1)[1])


if __name__ == "__main__":
    unittest.main()
