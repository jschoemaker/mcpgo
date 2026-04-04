#!/usr/bin/env node
import { createMcpServer, startServer } from "./server.js";
import { registerToolHandlers } from "./handlers/index.js";

async function main() {
  const server = createMcpServer();
  await registerToolHandlers(server);
  await startServer(server);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
