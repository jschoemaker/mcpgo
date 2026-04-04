import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListMcps } from "./list-mcps.js";
import { registerGetDetails } from "./details.js";
import { registerCheckHealth } from "./health.js";
import { registerRestartMcp } from "./restart.js";
import { registerConfigureMcp } from "./configure.js";
import { registerRemoveMcp } from "./remove.js";
import { registerAddMcp } from "./add.js";
import { registerWrapMcp } from "./wrap.js";
import { registerUnwrapMcp } from "./unwrap.js";
import { registerWrapCodexMcp } from "./wrap-codex.js";
import { registerRestartCodexMcp } from "./restart-codex.js";

export async function registerToolHandlers(server: McpServer): Promise<void> {
  registerListMcps(server);
  registerGetDetails(server);
  registerCheckHealth(server);
  registerRestartMcp(server);
  registerRestartCodexMcp(server);
  registerWrapMcp(server);
  registerUnwrapMcp(server);
  registerWrapCodexMcp(server);
  registerConfigureMcp(server);
  registerRemoveMcp(server);
  registerAddMcp(server);
}
