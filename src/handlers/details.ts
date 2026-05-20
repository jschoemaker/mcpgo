import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getMcpConfig } from "../lib/config-reader.js";
import { assertValidMcpName, InvalidMcpNameError, nameErrorResponse, redactEnvInConfig } from "../lib/security.js";

export function registerGetDetails(server: McpServer): void {
  server.registerTool(
    "get_mcp_details",
    {
      description: "Get the full configuration for a specific MCP server by name.",
      inputSchema: {
        mcp_name: z.string().describe("The name of the MCP server to get details for"),
        show_env_values: z
          .boolean()
          .optional()
          .describe("If true, reveal raw 'env' values. Default false (values shown as '***')."),
      },
    },
    async ({ mcp_name, show_env_values }) => {
      try {
        try { assertValidMcpName(mcp_name); } catch (e) {
          if (e instanceof InvalidMcpNameError) return nameErrorResponse(mcp_name);
          throw e;
        }
        const config = await getMcpConfig(mcp_name);
        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `MCP server '${mcp_name}' not found`,
                  error: "Not found",
                }),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Found configuration for '${mcp_name}'`,
                  data: {
                    name: mcp_name,
                    config: redactEnvInConfig(config, show_env_values === true),
                    env_redacted: show_env_values !== true,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[get_mcp_details] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to get MCP details",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
