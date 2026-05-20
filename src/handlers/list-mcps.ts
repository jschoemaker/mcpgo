import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readUserConfig } from "../lib/config-reader.js";
import { redactEnvInConfigs } from "../lib/security.js";

export function registerListMcps(server: McpServer): void {
  server.registerTool(
    "list_all_mcps",
    {
      description:
        "List all configured MCP servers from ~/.claude.json with their configuration. By default, values inside each server's 'env' field are redacted to '***' so this tool can't be used to exfiltrate API keys stored in MCP env. Pass show_env_values=true to reveal them when you legitimately need them.",
      inputSchema: {
        show_env_values: z
          .boolean()
          .optional()
          .describe("If true, reveal raw 'env' values. Default false (values shown as '***')."),
      },
    },
    async ({ show_env_values }) => {
      try {
        const configs = await readUserConfig();
        const safe = redactEnvInConfigs(configs, show_env_values === true);
        const names = Object.keys(configs);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Found ${names.length} MCP server(s)`,
                  data: { servers: safe, count: names.length, env_redacted: show_env_values !== true },
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
