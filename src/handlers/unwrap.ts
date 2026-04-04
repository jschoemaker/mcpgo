import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { getMcpConfig } from "../lib/config-reader.js";
import { updateMcpConfig } from "../lib/config-writer.js";

export function registerUnwrapMcp(server: McpServer): void {
  server.registerTool(
    "unwrap_mcp_stdio",
    {
      description: "Unwrap a previously wrapped stdio MCP server, restoring its original command. Requires restarting Claude Code to take effect.",
      inputSchema: {
        mcp_name: z.string().describe("The name of the MCP server to unwrap"),
      },
    },
    async ({ mcp_name }) => {
      try {
        const config = await getMcpConfig(mcp_name) as Record<string, unknown> | null;
        if (!config) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: `MCP server '${mcp_name}' not found`, error: "Not found" }) }],
          };
        }

        const args = config["args"] as string[] | undefined;
        const sepIdx = args ? args.indexOf("--") : -1;

        if (sepIdx < 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: `MCP server '${mcp_name}' does not appear to be wrapped (no '--' separator in args)`, error: "Not wrapped" }) }],
          };
        }

        const childArgs = args!.slice(sepIdx + 1);
        if (childArgs.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: `No child command found after '--' in args`, error: "Invalid wrap" }) }],
          };
        }

        const [originalCommand, ...originalArgs] = childArgs;

        // Try to restore env from existing config (env is preserved by wrap)
        const env = config["env"] as Record<string, string> | undefined;
        const cwd = config["cwd"] as string | undefined;

        const restored: Record<string, unknown> = {
          type: "stdio",
          command: originalCommand,
          ...(originalArgs.length > 0 ? { args: originalArgs } : {}),
          ...(env && Object.keys(env).length > 0 ? { env } : {}),
          ...(cwd ? { cwd } : {}),
        };

        // Clean up pidfile if it exists
        const pidfileIndex = args!.indexOf("--pidfile");
        const pidfile = pidfileIndex >= 0 ? args![pidfileIndex + 1] : undefined;
        if (pidfile) {
          try { await fs.unlink(pidfile); } catch { /* ignore */ }
        }

        await updateMcpConfig(mcp_name, restored);

        // Write backup of wrapped config
        const backupDir = path.join(process.env.USERPROFILE || process.env.HOME || "", ".mcpgo", "backups");
        await fs.mkdir(backupDir, { recursive: true });
        const backupPath = path.join(backupDir, `${mcp_name}.unwrap.${Date.now()}.json`);
        await fs.writeFile(backupPath, JSON.stringify(config, null, 2), "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Unwrapped MCP server '${mcp_name}'. Restart Claude Code for it to take effect.`,
                  data: { name: mcp_name, restored, backupPath },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[unwrap_mcp_stdio] error: ${err}\n`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: "Failed to unwrap MCP server", error: String(err) }) }],
        };
      }
    }
  );
}
