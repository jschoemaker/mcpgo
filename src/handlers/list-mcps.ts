import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readUserConfig } from "../lib/config-reader.js";

export function registerListMcps(server: McpServer): void {
  server.registerTool(
    "list_all_mcps",
    {
      description: "List all configured MCP servers from ~/.claude/mcp.json with their full configuration.",
    },
    async () => {
      try {
        const configs = await readUserConfig();
        const names = Object.keys(configs);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Found ${names.length} MCP server(s)`,
                  data: { servers: configs, count: names.length },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[list_all_mcps] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to list MCP servers",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
