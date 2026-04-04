import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getMcpConfig } from "../lib/config-reader.js";

export function registerGetDetails(server: McpServer): void {
  server.registerTool(
    "get_mcp_details",
    {
      description: "Get the full configuration for a specific MCP server by name.",
      inputSchema: {
        mcp_name: z.string().describe("The name of the MCP server to get details for"),
      },
    },
    async ({ mcp_name }) => {
      try {
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
                  data: { name: mcp_name, config },
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
