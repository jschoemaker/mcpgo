import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import { getMcpConfig } from "../lib/config-reader.js";
import { assertValidMcpName, InvalidMcpNameError, isAllowedPidfilePath, nameErrorResponse } from "../lib/security.js";

async function isPidRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function registerCheckHealth(server: McpServer): void {
  server.registerTool(
    "check_mcp_health",
    {
      description: "Check the health of an MCP server — whether it is configured, wrapped, and its process is running.",
      inputSchema: {
        mcp_name: z.string().describe("The name of the MCP server to check"),
      },
    },
    async ({ mcp_name }) => {
      try {
        try { assertValidMcpName(mcp_name); } catch (e) {
          if (e instanceof InvalidMcpNameError) return nameErrorResponse(mcp_name);
          throw e;
        }
        const config = await getMcpConfig(mcp_name) as Record<string, unknown> | null;
        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  data: { name: mcp_name, configured: false, wrapped: false, status: "not_configured" },
                }),
              },
            ],
          };
        }

        const args = config["args"] as string[] | undefined;
        const pidfileIndex = args ? args.indexOf("--pidfile") : -1;
        const pidfile = pidfileIndex >= 0 ? args?.[pidfileIndex + 1] : undefined;
        const wrapped = !!pidfile;

        let childPid: number | null = null;
        let childRunning: boolean | null = null;
        let status = "unknown";

        if (pidfile) {
          if (!isAllowedPidfilePath(pidfile, mcp_name, "claude")) {
            // A config entry pointed at a pidfile outside the canonical mcpgo
            // dirs. Don't touch it — just report.
            status = "pidfile_outside_mcpgo";
          } else {
            try {
              const pidStr = (await fs.readFile(pidfile, "utf-8")).trim();
              childPid = Number(pidStr);
              if (Number.isInteger(childPid) && childPid > 0) {
                childRunning = await isPidRunning(childPid);
                status = childRunning ? "running" : "child_dead";
              } else {
                status = "invalid_pidfile";
              }
            } catch {
              status = "pidfile_missing";
            }
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: {
                    name: mcp_name,
                    configured: true,
                    wrapped,
                    status,
                    ...(wrapped ? { pidfile, childPid, childRunning } : {}),
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[check_mcp_health] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to check MCP health",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
