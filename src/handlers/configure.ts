import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { updateMcpConfig } from "../lib/config-writer.js";
import { getMcpConfig } from "../lib/config-reader.js";

export function registerConfigureMcp(server: McpServer): void {
  server.registerTool(
    "configure_mcp",
    {
      description: "Update the configuration of an existing MCP server. Merges provided updates into the existing config.",
      inputSchema: {
        mcp_name: z.string().describe("The name of the MCP server to configure"),
        updates: z
          .object({
            command: z.string().optional().describe("New command to run"),
            args: z.array(z.string()).optional().describe("New arguments list"),
            env: z.record(z.string(), z.string()).optional().describe("Environment variables to set or update"),
            url: z.string().optional().describe("New URL for http/sse type servers"),
            headers: z.record(z.string(), z.string()).optional().describe("HTTP headers for http/sse type servers"),
          })
          .describe("Fields to update in the MCP server config"),
      },
    },
    async ({ mcp_name, updates }) => {
      try {
        // Check that the server exists first
        const existing = await getMcpConfig(mcp_name);
        if (!existing) {
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

        // Filter out undefined values from updates
        const cleanUpdates: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(updates)) {
          if (v !== undefined) cleanUpdates[k] = v;
        }

        const updated = await updateMcpConfig(mcp_name, cleanUpdates);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Successfully updated configuration for '${mcp_name}'`,
                  data: {
                    name: mcp_name,
                    previous: existing,
                    updated,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[configure_mcp] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to configure MCP server",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
