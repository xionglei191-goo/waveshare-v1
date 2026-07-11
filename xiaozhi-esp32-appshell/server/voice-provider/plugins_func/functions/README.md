# family_agent_ask — self-hosted voice provider page-agent plugin

Feature: `selfhosted-voice-provider-page-agents` (Tasks 10–13).

This is a self-contained, copy-paste deployable function-calling plugin for
[`xinnan-tech/xiaozhi-esp32-server`](https://github.com/xinnan-tech/xiaozhi-esp32-server).
On each voice turn the self-hosted server invokes `family_agent_ask`, which
HTTP-POSTs the page-scoped request to the unchanged Family Backend endpoint
`POST /api/agent/ask`. The backend remains the routing "brain".

## Files

- `family_agent_ask.py` — the plugin (schema + pure helpers + entry point).
- `__init__.py` — package marker.
- `../../tests/test_family_agent_ask.py` — unit tests for the pure logic.

## 1. Copy the plugin into xiaozhi-esp32-server

Copy `family_agent_ask.py` into the server checkout, next to the existing
plugins (e.g. `get_weather.py`, `hass_*.py`):

```bash
cp family_agent_ask.py <xiaozhi-esp32-server>/main/xiaozhi-server/plugins_func/functions/
```

(Path is typically `plugins_func/functions/` under the Python server root. Match
wherever the built-in plugins live in your version.)

## 2. Register the tool (Task 11)

In `data/.config.yaml`, add `family_agent_ask` to the function-calling tool
list so the LLM can select it:

```yaml
Intent:
  selected_module: function_call
  function_call:
    functions:
      - family_agent_ask
      # ... any other plugins you already enable
```

Also make sure the streaming profile is selected (see design.md), with
`Intent: function_call` so tool selection is inline in the LLM turn.

The tool advertises this description to the LLM:

> Route a page-scoped family request to the Family Backend Page Agent. Always
> call self.page.get_context first and pass the returned page and familyMode.

The device MCP tool `self.page.get_context` must be read first each turn so the
current `page` and `familyMode` are injected into the tool arguments.

## 3. Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `FAMILY_BACKEND_URL` | Family Backend base URL. `/api/agent/ask` is appended (trailing slash stripped). | `http://192.168.31.246:3100` |
| `XIAOZHI_TOOL_TOKEN` | Tool auth token sent as `Authorization: Bearer <token>`. | *(none)* |
| `AI_TOOL_TOKEN` | Fallback token if `XIAOZHI_TOOL_TOKEN` is unset. | *(none)* |

Example:

```bash
export FAMILY_BACKEND_URL="http://192.168.31.246:3100"
export XIAOZHI_TOOL_TOKEN="<your tool token>"
```

## 4. Behaviour notes

- **Request body** mirrors the Node bridge `callAgent`
  (`server/src/xiaozhi-mcp-bridge.js`): sends both `text` and `utterance`,
  plus `page`, `inputType: "voice"`, `deviceId`, `user`, `familyMode`,
  `pageState`, `confirmed`, `source: "selfhosted.voice"`.
- **Missing context (Req 4.4):** if `familyMode` is empty the tool defers and
  asks for device context to be fetched first — no backend call is made.
- **High-risk confirmation (contract):** when the backend returns
  `requiresConfirmation: true` (e.g. `family.openclaw.run`,
  `family.homeassistant.scene`), the plugin speaks the confirmation prompt and
  does **not** execute. The LLM re-invokes with `confirmed=true` after a "yes".
- **Secret redaction (Req 7.5):** any response key containing
  token/secret/authorization/api_key/apikey/password is stripped, and the
  literal token values are scrubbed from `speech`/`display`. Secrets never reach
  TTS, the UI, or the structured result.
- **Backend unreachable (Req 6.3):** returns a gentle general answer via the
  server's own LLM, without disclosing backend detail or a "reduced feature"
  disclaimer.

## 5. Run the tests

The pure logic is tested without the server runtime or the `requests`
dependency:

```bash
cd server/voice-provider
python3 -m pytest tests/test_family_agent_ask.py -v
```
