import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import { findMcpServerBlock, getCodexConfigTomlPath, readCodexConfigToml } from "../lib/codex-config.js";
import { killPid } from "../lib/subprocess.js";

export function registerRestartCodexMcp(server: McpServer): void {
  server.registerTool(
    "restart_codex_mcp_process",
    {
      description:
        "Restart a Codex CLI MCP server process. Works reliably only for wrapped MCPs (via wrap_codex_mcp_stdio) by killing the wrapped child PID from its pidfile; otherwise you typically need to restart Codex CLI.",
      inputSchema: {
        mcp_name: z.string().describe("The mcp_servers.<name> entry in ~/.codex/config.toml to restart"),
      },
    },
    async ({ mcp_name }) => {
      try {
        const configPath = getCodexConfigTomlPath();
        const content = await readCodexConfigToml();
        const block = findMcpServerBlock(content, mcp_name);
        if (!block) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `Codex MCP server '${mcp_name}' not found in ${configPath}`,
                  error: "Not found",
                }),
              },
            ],
          };
        }

        let args: string[] | null = null;
        for (const line of block.lines) {
          const trimmed = line.trim();
          const m = trimmed.match(/^args\s*=\s*(\[.*\])\s*$/);
          if (m) {
            try {
              const parsed = JSON.parse(m[1]);
              if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
                args = parsed;
              }
            } catch {
              // ignore
            }
          }
        }

        const pidfileIndex = args ? args.indexOf("--pidfile") : -1;
        const pidfile = pidfileIndex >= 0 ? args?.[pidfileIndex + 1] : undefined;
        if (!pidfile) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message:
                    `Codex MCP '${mcp_name}' does not look wrapped (no --pidfile in args). Restart Codex CLI to restart it.`,
                  error: "Not wrapped",
                  data: { name: mcp_name },
                }),
              },
            ],
          };
        }

        const pidStr = (await fs.readFile(pidfile, "utf-8")).trim();
        const pid = Number(pidStr);
        if (!Number.isInteger(pid) || pid <= 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `Invalid PID '${pidStr}' in pidfile '${pidfile}'`,
                  error: "Invalid pidfile",
                  data: { name: mcp_name, pidfile, pidStr },
                }),
              },
            ],
          };
        }

        const ok = await killPid(pid);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: ok,
                  message: ok
                    ? `Killed wrapped child process ${pid} for Codex MCP '${mcp_name}'. Wrapper should respawn it automatically.`
                    : `Failed to kill wrapped child process ${pid} for Codex MCP '${mcp_name}'`,
                  data: { name: mcp_name, pid, pidfile },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[restart_codex_mcp_process] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to restart Codex MCP process",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}

