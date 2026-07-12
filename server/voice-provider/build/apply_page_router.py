"""Patch the verified 0.9.5 intent entry point during image construction."""

import hashlib
from pathlib import Path


TARGET = Path("/opt/xiaozhi-esp32-server/core/handle/intentHandler.py")
EXPECTED_SHA256 = "004702ad61a90454afb7f4cedff015973081c3c2a0587ec23a960f26de39d1c3"
MARKER = '''    if conn.intent_type == "function_call":
        # 使用支持function calling的聊天方法,不再进行意图分析
        return False
'''
REPLACEMENT = '''    if conn.intent_type == "function_call":
        # Route every final transcript through the current Page Agent first.
        from core.handle.family_page_router import route_family_page_turn

        page_decision = await route_family_page_turn(conn, text)
        if page_decision:
            conn.sentence_id = str(uuid.uuid4().hex)
            await send_stt_message(conn, text)
            conn.client_abort = False
            conn.dialogue.put(Message(role="user", content=text))
            speak_txt(conn, page_decision["speech"])
            return True
        # Family Hub explicitly declined or was unavailable; continue with LLM.
        return False
'''


source = TARGET.read_bytes()
actual = hashlib.sha256(source).hexdigest()
if actual != EXPECTED_SHA256:
    raise SystemExit(f"unsupported intentHandler.py sha256: {actual}")

text = source.decode("utf-8")
if text.count(MARKER) != 1:
    raise SystemExit("verified function_call marker not found exactly once")
TARGET.write_text(text.replace(MARKER, REPLACEMENT), encoding="utf-8")

CONNECTION_TARGET = Path("/opt/xiaozhi-esp32-server/core/connection.py")
CONNECTION_EXPECTED_SHA256 = "1ac593f707b51a5171d161f1b17f1f58dc23745701534102d73f0e67185ae1dc"
CONNECTION_MARKER = '''            self.logger.bind(tag=TAG).info(
                f"{self.client_ip} conn - Headers: {self.headers}"
            )
'''
CONNECTION_REPLACEMENT = '''            # Header values include bearer credentials and websocket nonces.
            # Keep connection diagnostics without persisting any secret value.
            header_names = sorted(self.headers.keys())
            self.logger.bind(tag=TAG).info(
                f"{self.client_ip} conn - Header names: {header_names}"
            )
'''

connection_source = CONNECTION_TARGET.read_bytes()
connection_actual = hashlib.sha256(connection_source).hexdigest()
if connection_actual != CONNECTION_EXPECTED_SHA256:
    raise SystemExit(f"unsupported connection.py sha256: {connection_actual}")

connection_text = connection_source.decode("utf-8")
if connection_text.count(CONNECTION_MARKER) != 1:
    raise SystemExit("verified connection header-log marker not found exactly once")
CONNECTION_TARGET.write_text(
    connection_text.replace(CONNECTION_MARKER, CONNECTION_REPLACEMENT), encoding="utf-8"
)

connection_text = CONNECTION_TARGET.read_text(encoding="utf-8")
CHAT_MARKER = '''        if query is not None:
            self.logger.bind(tag=TAG).info(f"大模型收到用户消息: {query}")
'''
CHAT_REPLACEMENT = '''        from core.handle.family_page_router import model_for_connection, sanitize_plain_stream, trace_llm_stream
        family_model_name = model_for_connection(self, query)
        if query is not None:
            self.logger.bind(tag=TAG).info(
                f"大模型收到用户消息，selected_model={family_model_name}, trace_id={getattr(self, 'family_trace_id', '')}"
            )
'''
if connection_text.count(CHAT_MARKER) != 1:
    raise SystemExit("verified connection chat marker not found exactly once")
connection_text = connection_text.replace(CHAT_MARKER, CHAT_REPLACEMENT)

LLM_MARKER = '''            if self.intent_type == "function_call" and functions is not None:
                # 使用支持functions的streaming接口
                llm_responses = self.llm.response_with_functions(
                    self.session_id,
                    self.dialogue.get_llm_dialogue_with_memory(
                        memory_str, self.config.get("voiceprint", {})
                    ),
                    functions=functions,
                )
            else:
                llm_responses = self.llm.response(
                    self.session_id,
                    self.dialogue.get_llm_dialogue_with_memory(
                        memory_str, self.config.get("voiceprint", {})
                    ),
                )
'''
LLM_REPLACEMENT = '''            if self.intent_type == "function_call" and functions is not None:
                family_use_tools = bool(getattr(self, "family_allow_provider_tools", True))
            else:
                family_use_tools = False
            family_lightweight = getattr(self, "family_model_tier", "lightweight") != "complex"
            family_llm_kwargs = {
                "model_name": family_model_name,
                "disable_thinking": family_lightweight and os.environ.get("FAMILY_LIGHTWEIGHT_DISABLE_THINKING", "1") != "0",
            }
            if family_lightweight:
                family_llm_kwargs["max_tokens"] = int(os.environ.get("FAMILY_LIGHTWEIGHT_MAX_TOKENS", "160"))
            if family_use_tools:
                # 使用支持functions的streaming接口
                llm_responses = self.llm.response_with_functions(
                    self.session_id,
                    self.dialogue.get_llm_dialogue_with_memory(
                        memory_str, self.config.get("voiceprint", {})
                    ),
                    functions=functions,
                    **family_llm_kwargs,
                )
            else:
                llm_responses = self.llm.response(
                    self.session_id,
                    self.dialogue.get_llm_dialogue_with_memory(
                        memory_str, self.config.get("voiceprint", {})
                    ),
                    **family_llm_kwargs,
                )
            if not family_use_tools:
                llm_responses = sanitize_plain_stream(llm_responses)
            llm_responses = trace_llm_stream(self, llm_responses, family_model_name)
'''
if connection_text.count(LLM_MARKER) != 1:
    raise SystemExit("verified connection LLM marker not found exactly once")
CONNECTION_TARGET.write_text(connection_text.replace(LLM_MARKER, LLM_REPLACEMENT), encoding="utf-8")

connection_text = CONNECTION_TARGET.read_text(encoding="utf-8")
FUNCTION_STREAM_MARKER = '''                if self.intent_type == "function_call" and functions is not None:
                    content, tools_call = response
'''
FUNCTION_STREAM_REPLACEMENT = '''                if family_use_tools:
                    content, tools_call = response
'''
if connection_text.count(FUNCTION_STREAM_MARKER) != 1:
    raise SystemExit("verified function stream marker not found exactly once")
CONNECTION_TARGET.write_text(
    connection_text.replace(FUNCTION_STREAM_MARKER, FUNCTION_STREAM_REPLACEMENT), encoding="utf-8"
)

intent_text = TARGET.read_text(encoding="utf-8")
SPEAK_MARKER = '''def speak_txt(conn: "ConnectionHandler", text):
    # 记录文本到 sentence_id 映射
'''
SPEAK_REPLACEMENT = '''def speak_txt(conn: "ConnectionHandler", text):
    from core.handle.family_page_router import report_tts_queued
    report_tts_queued(conn)
    # 记录文本到 sentence_id 映射
'''
if intent_text.count(SPEAK_MARKER) != 1:
    raise SystemExit("verified intent speak marker not found exactly once")
TARGET.write_text(intent_text.replace(SPEAK_MARKER, SPEAK_REPLACEMENT), encoding="utf-8")

OPENAI_TARGET = Path("/opt/xiaozhi-esp32-server/core/providers/llm/openai/openai.py")
OPENAI_EXPECTED_SHA256 = "5e3c3405faa7a13ff16ebe9e9115c0277af4ccc43e765a7e4b6c345d6af5a2a7"
openai_source = OPENAI_TARGET.read_bytes()
openai_actual = hashlib.sha256(openai_source).hexdigest()
if openai_actual != OPENAI_EXPECTED_SHA256:
    raise SystemExit(f"unsupported OpenAI LLM provider sha256: {openai_actual}")
openai_text = openai_source.decode("utf-8")
OPENAI_MODEL_MARKER = '            "model": self.model_name,\n'
if openai_text.count(OPENAI_MODEL_MARKER) != 2:
    raise SystemExit("verified OpenAI model markers not found exactly twice")
OPENAI_TARGET.write_text(
    openai_text.replace(OPENAI_MODEL_MARKER, '            "model": kwargs.get("model_name", self.model_name),\n'),
    encoding="utf-8",
)

openai_text = OPENAI_TARGET.read_text(encoding="utf-8")
OPENAI_THINKING_MARKER = '''        # 禁用思考模式
        self._apply_thinking_disabled(request_params)
'''
OPENAI_THINKING_REPLACEMENT = '''        # Family voice turns disable hidden reasoning only for the lightweight tier.
        if kwargs.get("disable_thinking"):
            request_params.setdefault("extra_body", {}).update({"thinking": {"type": "disabled"}})
        else:
            self._apply_thinking_disabled(request_params)
'''
if openai_text.count(OPENAI_THINKING_MARKER) != 2:
    raise SystemExit("verified OpenAI thinking markers not found exactly twice")
OPENAI_TARGET.write_text(
    openai_text.replace(OPENAI_THINKING_MARKER, OPENAI_THINKING_REPLACEMENT), encoding="utf-8"
)

SEND_AUDIO_TARGET = Path("/opt/xiaozhi-esp32-server/core/handle/sendAudioHandle.py")
SEND_AUDIO_EXPECTED_SHA256 = "7dcc59670aa15a214748900cb8d117410455f8376bf73005a10d22c768e6b3a1"
send_audio_source = SEND_AUDIO_TARGET.read_bytes()
send_audio_actual = hashlib.sha256(send_audio_source).hexdigest()
if send_audio_actual != SEND_AUDIO_EXPECTED_SHA256:
    raise SystemExit(f"unsupported sendAudioHandle.py sha256: {send_audio_actual}")
send_audio_text = send_audio_source.decode("utf-8")
FIRST_AUDIO_MARKER = '''    packet_index = flow_control.get("packet_count", 0)
    sequence = flow_control.get("sequence", 0)
'''
FIRST_AUDIO_REPLACEMENT = '''    packet_index = flow_control.get("packet_count", 0)
    sequence = flow_control.get("sequence", 0)
    if packet_index == 0:
        from core.handle.family_page_router import report_first_audio
        report_first_audio(conn)
'''
if send_audio_text.count(FIRST_AUDIO_MARKER) != 1:
    raise SystemExit("verified first-audio marker not found exactly once")
SEND_AUDIO_TARGET.write_text(
    send_audio_text.replace(FIRST_AUDIO_MARKER, FIRST_AUDIO_REPLACEMENT), encoding="utf-8"
)

ALI_TTS_TARGET = Path("/opt/xiaozhi-esp32-server/core/providers/tts/alibl_stream.py")
ALI_TTS_EXPECTED_SHA256 = "c6fb5ea6237c55fea85dc7d41e3ca3d30ac8d5d80017357dd79985e98dd57053"
ali_tts_source = ALI_TTS_TARGET.read_bytes()
ali_tts_actual = hashlib.sha256(ali_tts_source).hexdigest()
if ali_tts_actual != ALI_TTS_EXPECTED_SHA256:
    raise SystemExit(f"unsupported AliBL TTS provider sha256: {ali_tts_actual}")
ali_tts_text = ali_tts_source.decode("utf-8")
ALI_TTS_STATE_MARKER = '''        self.last_active_time = None

        # 模型和音色配置
'''
ALI_TTS_STATE_REPLACEMENT = '''        self.last_active_time = None
        self._connection_lock = asyncio.Lock()

        # 模型和音色配置
'''
if ali_tts_text.count(ALI_TTS_STATE_MARKER) != 1:
    raise SystemExit("verified AliBL TTS state marker not found exactly once")
ali_tts_text = ali_tts_text.replace(ALI_TTS_STATE_MARKER, ALI_TTS_STATE_REPLACEMENT)

ALI_TTS_CONNECT_MARKER = '''    async def _ensure_connection(self):
        """确保WebSocket连接可用，支持60秒内连接复用"""
'''
ALI_TTS_CONNECT_REPLACEMENT = '''    async def _ensure_connection(self):
        async with self._connection_lock:
            return await self._ensure_connection_locked()

    async def _ensure_connection_locked(self):
        """确保WebSocket连接可用，支持60秒内连接复用"""
'''
if ali_tts_text.count(ALI_TTS_CONNECT_MARKER) != 1:
    raise SystemExit("verified AliBL TTS connection marker not found exactly once")
ali_tts_text = ali_tts_text.replace(ALI_TTS_CONNECT_MARKER, ALI_TTS_CONNECT_REPLACEMENT)

ALI_TTS_TARGET.write_text(ali_tts_text, encoding="utf-8")

ASR_BASE_TARGET = Path("/opt/xiaozhi-esp32-server/core/providers/asr/base.py")
ASR_BASE_EXPECTED_SHA256 = "ea691ef2075808039e9b3af4d5591ff5c51f51d661738ad176caffdd4aca2965"
asr_base_source = ASR_BASE_TARGET.read_bytes()
asr_base_actual = hashlib.sha256(asr_base_source).hexdigest()
if asr_base_actual != ASR_BASE_EXPECTED_SHA256:
    raise SystemExit(f"unsupported ASR base provider sha256: {asr_base_actual}")
asr_base_text = asr_base_source.decode("utf-8")
ASR_CONTENT_MARKER = '                    logger.bind(tag=TAG).info(f"识别文本: {raw_text[\'content\']}")\n'
ASR_CONTENT_REPLACEMENT = '                    logger.bind(tag=TAG).info(f"识别文本完成: chars={len(str(raw_text[\'content\']))}")\n'
ASR_TEXT_MARKER = '                    logger.bind(tag=TAG).info(f"识别文本: {raw_text}")\n'
ASR_TEXT_REPLACEMENT = '                    logger.bind(tag=TAG).info(f"识别文本完成: chars={len(str(raw_text))}")\n'
if asr_base_text.count(ASR_CONTENT_MARKER) != 1 or asr_base_text.count(ASR_TEXT_MARKER) != 1:
    raise SystemExit("verified ASR text log markers not found exactly once")
asr_base_text = asr_base_text.replace(ASR_CONTENT_MARKER, ASR_CONTENT_REPLACEMENT)
asr_base_text = asr_base_text.replace(ASR_TEXT_MARKER, ASR_TEXT_REPLACEMENT)
ASR_BASE_TARGET.write_text(asr_base_text, encoding="utf-8")

ALI_ASR_TARGET = Path("/opt/xiaozhi-esp32-server/core/providers/asr/aliyunbl_stream.py")
ALI_ASR_EXPECTED_SHA256 = "8e7c79c5e163b670c735aa7fa37e1decdf174cd96d5c2f26bd1f3f3779d398ca"
ali_asr_source = ALI_ASR_TARGET.read_bytes()
if hashlib.sha256(ali_asr_source).hexdigest() != ALI_ASR_EXPECTED_SHA256:
    raise SystemExit("unsupported Aliyun BL ASR provider sha256")
ali_asr_text = ali_asr_source.decode("utf-8")
ALI_ASR_FINISH_MARKER = '''                    elif event == "task-finished":
                        logger.bind(tag=TAG).debug("任务已完成")
                        break
'''
ALI_ASR_FINISH_REPLACEMENT = '''                    elif event == "task-finished":
                        logger.bind(tag=TAG).debug("任务已完成")
                        if conn.client_listen_mode == "manual" and conn.client_voice_stop and self.text:
                            logger.bind(tag=TAG).info("ASR任务完成，提交手动模式已累积识别文本")
                            await self.handle_voice_stop(conn, audio_data)
                        break
'''
if ali_asr_text.count(ALI_ASR_FINISH_MARKER) != 1:
    raise SystemExit("verified Aliyun BL ASR task-finished marker not found exactly once")
ALI_ASR_TARGET.write_text(ali_asr_text.replace(ALI_ASR_FINISH_MARKER, ALI_ASR_FINISH_REPLACEMENT), encoding="utf-8")

LISTEN_TARGET = Path("/opt/xiaozhi-esp32-server/core/handle/textHandler/listenMessageHandler.py")
LISTEN_EXPECTED_SHA256 = "4337bf92e55adeafbd0bf3411b59b74cadf1561bac47ef96e6b80c02d0d1dd3c"
listen_source = LISTEN_TARGET.read_bytes()
if hashlib.sha256(listen_source).hexdigest() != LISTEN_EXPECTED_SHA256:
    raise SystemExit("unsupported listen handler sha256")
listen_text = listen_source.decode("utf-8")
LISTEN_IMPORT_MARKER = '''import time
import uuid
import asyncio
'''
LISTEN_IMPORT_REPLACEMENT = '''import os
import time
import uuid
import asyncio
'''
LISTEN_START_MARKER = '''        if msg_json["state"] == "start":
            # 设备从播放模式切回录音模式,清除所有音频状态和缓冲区
            conn.reset_audio_states()
'''
LISTEN_START_REPLACEMENT = '''        if msg_json["state"] == "start":
            # 设备从播放模式切回录音模式,清除所有音频状态和缓冲区
            conn.reset_audio_states()
            conn.family_listen_started_monotonic = time.monotonic()
            if os.environ.get("FAMILY_TTS_PREWARM", "1") != "0" and conn.tts and hasattr(conn.tts, "_ensure_connection"):
                task = asyncio.create_task(conn.tts._ensure_connection())
                task.add_done_callback(lambda item: item.exception() if not item.cancelled() else None)
'''
LISTEN_STOP_MARKER = '''        elif msg_json["state"] == "stop":
            # 收到stop但asr未初始化，跳过处理
'''
LISTEN_STOP_REPLACEMENT = '''        elif msg_json["state"] == "stop":
            conn.family_listen_stopped_monotonic = time.monotonic()
            # 收到stop但asr未初始化，跳过处理
'''
if (listen_text.count(LISTEN_IMPORT_MARKER) != 1 or listen_text.count(LISTEN_START_MARKER) != 1 or
        listen_text.count(LISTEN_STOP_MARKER) != 1):
    raise SystemExit("verified listen timing markers not found exactly once")
listen_text = listen_text.replace(LISTEN_IMPORT_MARKER, LISTEN_IMPORT_REPLACEMENT)
listen_text = listen_text.replace(LISTEN_START_MARKER, LISTEN_START_REPLACEMENT)
listen_text = listen_text.replace(LISTEN_STOP_MARKER, LISTEN_STOP_REPLACEMENT)
LISTEN_TARGET.write_text(listen_text, encoding="utf-8")
