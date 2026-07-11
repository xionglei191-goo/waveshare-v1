// Read-only local check for the `real-family-content` external acceptance item.
//
// It loads the same store/config the server uses and reuses the backend
// `buildAcceptanceReadiness` logic, so this script never drifts from the real
// readiness definition. It does not call the network, mutate state, import
// files or record any acceptance evidence. Use it before and after importing
// real family assets to see exactly which of the five readiness checks still
// fail.

const { loadConfig } = require("../src/config");
const { createStore } = require("../src/store");
const { buildResourceManifest } = require("../src/resources");
const { buildAcceptanceReadiness } = require("../src/routes");

function main() {
  const config = loadConfig();
  const store = createStore(config);
  const state = store.snapshot();
  const manifest = buildResourceManifest(state, config);
  const readiness = buildAcceptanceReadiness(state, config, manifest);
  const item = (readiness.items || []).find((entry) => entry.id === "real-family-content");

  console.log(`Store: ${store.driver} (${store.filePath || config.sqliteFile})`);
  console.log(`Resource dir: ${config.resourceDir}`);

  if (!item) {
    console.error("real-family-content readiness item not found; backend readiness shape may have changed.");
    process.exit(1);
  }

  console.log(`\nreal-family-content: ${item.status} ${item.okCount}/${item.total}`);
  for (const check of item.checks) {
    const mark = check.ok ? "PASS" : "MISS";
    console.log(`  [${mark}] ${check.label}: ${check.detail}`);
  }

  const missing = item.checks.filter((check) => !check.ok);
  if (missing.length === 0) {
    console.log("\nAll readiness checks pass. Device-side display/playback evidence is still required before recording acceptance as passed.");
  } else {
    console.log(`\n${missing.length} check(s) still missing. Import real (non-sample) album/podcast/english/game assets via 'npm run content:import-real', then re-run this check.`);
  }
}

main();
