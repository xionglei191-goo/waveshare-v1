const childProcess = require("child_process");

function outputSummary(value) {
  return String(value || "").trim().slice(0, 600);
}

function runHomeAssistantService(config, domain, service, serviceData) {
  const url = `${config.homeAssistantUrl.replace(/\/$/, "")}/api/services/${domain}/${service}`;
  const timeoutSec = Math.max(1, Math.ceil(Number(config.homeAssistantTimeoutMs || 5000) / 1000));
  const startedAt = Date.now();
  const result = childProcess.spawnSync("curl", [
    "--silent",
    "--show-error",
    "--max-time",
    String(timeoutSec),
    "-X",
    "POST",
    "-H",
    `Authorization: Bearer ${config.homeAssistantToken}`,
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify(serviceData || {}),
    "--write-out",
    "\n%{http_code}",
    url
  ], {
    encoding: "utf8",
    timeout: Number(config.homeAssistantTimeoutMs || 5000) + 1000,
    maxBuffer: 128 * 1024
  });
  const durationMs = Date.now() - startedAt;
  const stdout = String(result.stdout || "");
  const lines = stdout.split(/\r?\n/);
  const maybeCode = lines[lines.length - 1];
  const httpCode = /^\d{3}$/.test(maybeCode) ? Number(maybeCode) : 0;
  const body = httpCode ? lines.slice(0, -1).join("\n") : stdout;
  const ok = result.status === 0 && httpCode >= 200 && httpCode < 300;
  return {
    ok,
    durationMs,
    httpCode,
    exitCode: typeof result.status === "number" ? result.status : null,
    signal: result.signal || null,
    stdout: outputSummary(body),
    stderr: outputSummary(result.stderr || result.error?.message || "")
  };
}

module.exports = {
  runHomeAssistantService
};
