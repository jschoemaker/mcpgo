import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { removeMcpConfig } from "../lib/config-writer.js";
import { getMcpConfig } from "../lib/config-reader.js";

export function registerRemoveMcp(server: McpServer): void {
  server.registerTool(
    "remove_mcp",
    {
      description: "Remove an MCP server from the user configuration (~/.claude/mcp.json).",
      inputSchema: {
        mcp_name: z.string().describe("The name of the MCP server to remove"),
      },
    },
    async ({ mcp_name }) => {
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

        await removeMcpConfig(mcp_name);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Successfully removed MCP server '${mcp_name}'`,
                  data: { name: mcp_name, removedConfig: existing },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[remove_mcp] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to remove MCP server",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
