const childProcess = require("child_process");
const fs = require("fs");

function executableStatus(command) {
  if (!command) return "missing command";
  try {
    fs.accessSync(command, fs.constants.X_OK);
    return "";
  } catch (error) {
    return error.code === "ENOENT" ? "command not found" : "command not executable";
  }
}

function outputSummary(value) {
  return String(value || "").trim().slice(0, 600);
}

function runOpenClawSync(command, target, timeoutMs) {
  const result = childProcess.spawnSync(command, [target], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 128 * 1024
  });
  return {
    pid: result.pid || null,
    status: typeof result.status === "number" ? result.status : null,
    signal: result.signal || null,
    stdout: outputSummary(result.stdout),
    stderr: outputSummary(result.stderr || result.error?.message || ""),
    timedOut: result.error?.code === "ETIMEDOUT",
    error: result.error || null
  };
}

function appendLimited(buffer, chunk, limit = 128 * 1024) {
  const next = `${buffer}${chunk}`;
  return next.length > limit ? next.slice(0, limit) : next;
}

function runOpenClaw(command, target, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        pid: child?.pid || null,
        stdout: outputSummary(stdout),
        stderr: outputSummary(stderr),
        timedOut,
        ...result
      });
    };
    try {
      child = childProcess.spawn(command, [target], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ status: null, signal: null, error });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, timeoutMs).unref();
    child.stdout.on("data", (chunk) => { stdout = appendLimited(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendLimited(stderr, chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ status: null, signal: null, error });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      finish({ status, signal, error: null });
    });
  });
}

module.exports = { executableStatus, outputSummary, runOpenClaw, runOpenClawSync };
