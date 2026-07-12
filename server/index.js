const { createServer } = require("./src/app");
const { loadConfig } = require("./src/config");

const config = loadConfig();
const { app, store } = createServer(config);

app.listen(config.port, config.host, () => {
  console.log(`Xiaozhi family hub server listening on http://${config.host}:${config.port}`);
  console.log(`State file: ${store.filePath}`);
});
