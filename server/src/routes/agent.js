const crypto = require("crypto");

const { planAgentRequest } = require("../agents");
const {
  agentBodyWithDeviceContext,
  modelTierForFallback,
  upsertAiTrace
} = require("../ai-runtime");
const {
  executeCapability,
  listCapabilities,
  normalizeArgs,
  normalizeContext,
  prepareCapability
} = require("../capabilities");
const { personalizeSpeech } = require("../member-context");
const { recordAgentInteraction } = require("../memory");

function agentStatus(result) {
  if (result?.denied) return 403;
  if (result?.accepted && result?.command) return 202;
  if (result?.accepted) return 200;
  return 400;
}

function latestDeviceSramMinimum(state, logicalDeviceId = "esp32-185b") {
  const log = (state.deviceLogs || []).find((item) =>
    item?.source === "appshell.heartbeat" &&
    (!logicalDeviceId || item?.data?.logicalDeviceId === logicalDeviceId)
  );
  const value = Number(log?.data?.minimumFreeInternalSram);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function registerAgentRoutes(router, context) {
  const {
    store,
    config,
    requireAiGatewayToken,
    updateAndPublish,
    updateAndPublishAsync,
    publishDeviceCommandResult,
    deviceSummary,
    snapshotWithServerMedia
  } = context;

  router.get("/agent/capabilities", (req, res) => {
    res.json({ ok: true, data: listCapabilities() });
  });

  router.post("/agent/tools/:name", async (req, res, next) => {
    if (!requireAiGatewayToken(req, res, config, store)) return;
    try {
      const name = req.params.name;
      const args = normalizeArgs(req.body?.args || req.body?.params || req.body || {});
      const capabilityContext = normalizeContext(store.snapshot(), {
        ...(req.body || {}),
        requestId: req.body?.requestId || req.body?.request_id || req.requestId,
        source: req.body?.source || "agent.tool"
      });
      const prepared = await prepareCapability(name, args, store.snapshot(), config, capabilityContext);
      let result = null;
      const snapshot = await updateAndPublishAsync(`agent.tool.${name}`, async (state) => {
        result = await executeCapability(state, config, name, args, capabilityContext, prepared);
      });
      publishDeviceCommandResult(result);
      res.status(agentStatus(result)).json({
        ok: Boolean(result?.accepted),
        data: {
          ...result,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/agent/ask", async (req, res, next) => {
    if (!requireAiGatewayToken(req, res, config, store)) return;
    const startedAt = Date.now();
    const traceId = String(req.body?.traceId || req.body?.trace_id || `trace_${crypto.randomBytes(12).toString("hex")}`).slice(0, 96);
    let contextResolution = null;
    let plan = null;
    try {
      contextResolution = agentBodyWithDeviceContext(
        store.snapshot(),
        { requestId: req.body?.requestId || req.body?.request_id || req.get("x-request-id") || "", ...(req.body || {}), traceId },
        config.aiDeviceContextTtlMs
      );
      if (!contextResolution.contextFresh) {
        res.status(428).json({
          ok: false,
          error: "page_context_required",
          data: {
            traceId,
            contextRequired: true,
            contextSource: contextResolution.contextSource,
            contextAgeMs: contextResolution.contextAgeMs
          }
        });
        return;
      }
      const planStartedAt = Date.now();
      plan = await planAgentRequest(store.snapshot(), config, contextResolution.body);
      const planMs = Date.now() - planStartedAt;
      if (!plan.tool) {
        const modelTier = modelTierForFallback(contextResolution.body.utterance || contextResolution.body.text, plan.fallbackReason);
        const totalMs = Date.now() - startedAt;
        const snapshot = updateAndPublish(`agent.ask.${plan.agent}.${plan.intent}.context`, (state) => {
          recordAgentInteraction(state, {
            memberId: plan.context.memberId,
            page: plan.page,
            agent: plan.agent,
            intent: plan.intent,
            utterance: req.body?.utterance || req.body?.text || "",
            speech: plan.speech,
            storeConversationText: config.aiStoreConversationText
          });
          upsertAiTrace(state, {
            traceId,
            sessionId: plan.sessionId,
            deviceId: contextResolution.body.deviceId,
            page: plan.page,
            familyMode: contextResolution.body.familyMode,
            stage: "backend_complete",
            status: "fallback",
            agent: plan.agent,
            intent: plan.intent,
            handled: false,
            fallbackReason: plan.fallbackReason,
            modelTier,
            modelName: modelTier === "complex" ? config.aiComplexModel : config.aiLightweightModel,
            utterance: contextResolution.body.utterance || contextResolution.body.text,
            contextSource: contextResolution.contextSource,
            timings: {
              planMs,
              backendMs: totalMs,
              sramMinBytes: latestDeviceSramMinimum(state, contextResolution.body.deviceId)
            }
          }, { limit: config.aiTraceLimit, storeText: config.aiTraceStoreText });
        });
        res.json({
          ok: true,
          data: {
            handled: plan.handled,
            fallbackReason: plan.fallbackReason,
            traceId,
            sessionId: plan.sessionId,
            contextSource: contextResolution.contextSource,
            contextAgeMs: contextResolution.contextAgeMs,
            modelTier,
            modelName: modelTier === "complex" ? config.aiComplexModel : config.aiLightweightModel,
            timings: { planMs, backendMs: totalMs },
            agent: plan.agent,
            page: plan.page,
            intent: plan.intent,
            confidence: plan.confidence,
            speech: plan.speech,
            display: plan.display,
            actions: [],
            handoff: plan.handoff,
            requiresConfirmation: plan.requiresConfirmation,
            memberContext: plan.memberContext,
            summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
          }
        });
        return;
      }

      const preparedStartedAt = Date.now();
      const prepared = await prepareCapability(plan.tool, plan.args, store.snapshot(), config, plan.context);
      const prepareMs = Date.now() - preparedStartedAt;
      let result = null;
      let responseSpeech = plan.speech;
      let toolMs = 0;
      const snapshot = await updateAndPublishAsync(`agent.ask.${plan.agent}.${plan.intent}`, async (state) => {
        const toolStartedAt = Date.now();
        result = await executeCapability(state, config, plan.tool, plan.args, plan.context, prepared);
        toolMs = Date.now() - toolStartedAt;
        responseSpeech = personalizeSpeech(result?.speech || plan.speech, plan.memberContext);
        recordAgentInteraction(state, {
          memberId: plan.context.memberId,
          page: plan.page,
          agent: plan.agent,
          intent: plan.intent,
          utterance: req.body?.utterance || req.body?.text || "",
          speech: responseSpeech,
          storeConversationText: config.aiStoreConversationText
        });
        upsertAiTrace(state, {
          traceId,
          sessionId: plan.sessionId,
          deviceId: contextResolution.body.deviceId,
          page: plan.page,
          familyMode: contextResolution.body.familyMode,
          stage: "backend_complete",
          status: result?.accepted ? "handled" : "failed",
          agent: plan.agent,
          intent: plan.intent,
          handled: true,
          utterance: contextResolution.body.utterance || contextResolution.body.text,
          contextSource: contextResolution.contextSource,
          timings: {
            planMs,
            prepareMs,
            toolMs,
            backendMs: Date.now() - startedAt,
            sramMinBytes: latestDeviceSramMinimum(state, contextResolution.body.deviceId)
          }
        }, { limit: config.aiTraceLimit, storeText: config.aiTraceStoreText });
      });
      publishDeviceCommandResult(result);

      const action = {
        tool: plan.tool,
        intent: plan.intent,
        status: result?.status || (result?.accepted ? "accepted" : "failed"),
        accepted: Boolean(result?.accepted),
        result: {
          commandId: result?.command?.id || "",
          command: result?.command || null,
          track: result?.track || null,
          progress: result?.progress || null,
          item: result?.result?.item || null,
          reason: result?.reason || ""
        }
      };

      res.status(agentStatus(result)).json({
        ok: Boolean(result?.accepted),
        data: {
          handled: true,
          fallbackReason: "",
          requestId: plan.requestId,
          traceId,
          sessionId: plan.sessionId,
          contextSource: contextResolution.contextSource,
          contextAgeMs: contextResolution.contextAgeMs,
          modelTier: "none",
          modelName: "",
          timings: { planMs, prepareMs, toolMs, backendMs: Date.now() - startedAt },
          agent: plan.agent,
          page: plan.page,
          intent: plan.intent,
          confidence: plan.confidence,
          speech: responseSpeech,
          display: { ...(plan.display || {}), ...(result?.display || {}) },
          actions: [action],
          handoff: plan.handoff,
          requiresConfirmation: plan.requiresConfirmation,
          memberContext: plan.memberContext,
          denied: Boolean(result?.denied),
          reason: result?.reason || "",
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      try {
        store.update((state) => {
          upsertAiTrace(state, {
            traceId,
            sessionId: plan?.sessionId || req.body?.sessionId,
            deviceId: contextResolution?.body?.deviceId || req.body?.deviceId,
            page: plan?.page || contextResolution?.body?.page,
            familyMode: contextResolution?.body?.familyMode,
            stage: "backend_error",
            status: "failed",
            errorType: error?.name || "Error",
            timings: { backendMs: Date.now() - startedAt }
          }, { limit: config.aiTraceLimit, storeText: false });
        });
      } catch (traceError) {
        // The original request error remains authoritative.
      }
      next(error);
    }
  });
}

module.exports = { registerAgentRoutes };
