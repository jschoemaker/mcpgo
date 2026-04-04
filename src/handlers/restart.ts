import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import { getMcpConfig } from "../lib/config-reader.js";
import { findAllProcessesByCommand, killPid } from "../lib/subprocess.js";

export function registerRestartMcp(server: McpServer): void {
  server.registerTool(
    "restart_mcp_process",
    {
      description:
        "Restart the underlying process for an MCP server by finding and killing its process. For wrapped stdio MCPs (via wrap_mcp_stdio), the wrapper will respawn automatically; otherwise you typically need to restart Claude CLI.",
      inputSchema: {
        mcp_name: z.string().describe("The name of the MCP server whose process should be restarted"),
      },
    },
    async ({ mcp_name }) => {
      try {
        const config = await getMcpConfig(mcp_name) as Record<string, unknown> | null;
        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `MCP server '${mcp_name}' not found in config`,
                  error: "Not found",
                }),
              },
            ],
          };
        }

        // Extract the command keyword from the config
        const command = config["command"] as string | undefined;
        const args = config["args"] as string[] | undefined;

        // If this MCP is wrapped, prefer killing the wrapped child PID from the pidfile.
        const pidfileIndex = args ? args.indexOf("--pidfile") : -1;
        const pidfile = pidfileIndex >= 0 ? args?.[pidfileIndex + 1] : undefined;
        if (pidfile) {
          try {
            const pidStr = (await fs.readFile(pidfile, "utf-8")).trim();
            const pid = Number(pidStr);
            if (Number.isInteger(pid) && pid > 0) {
              process.stderr.write(`[restart_mcp_process] killing wrapped child PID ${pid} from pidfile '${pidfile}'...\n`);
              const ok = await killPid(pid);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        success: ok,
                        message: ok
                          ? `Killed wrapped child process ${pid} for MCP server '${mcp_name}'. Wrapper should respawn it automatically.`
                          : `Failed to kill wrapped child process ${pid} for MCP server '${mcp_name}'`,
                        data: { name: mcp_name, pid, pidfile },
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            }
          } catch (err) {
            process.stderr.write(`[restart_mcp_process] pidfile read/kill failed (${pidfile}): ${err}\n`);
          }
        }

        // Find a useful keyword to search by
        // For wrapped MCPs actually running via wrapper, use pidfile filename (unique per MCP)
        // For unwrapped MCPs (or wrapped config but not yet restarted), search by child command
        let keyword = mcp_name;
        let pidfileExists = false;
        if (pidfile) {
          try { await fs.access(pidfile); pidfileExists = true; } catch { /* not running wrapped */ }
        }
        if (pidfileExists && pidfile) {
          // Use pidfile filename as keyword — unique per MCP, won't match other wrappers
          keyword = pidfile.split(/[/\\]/).pop() || mcp_name;
        } else if (args && args.length > 0) {
          // Pick the longest arg after "--" separator (the actual child command), or longest path arg
          const sepIdx = args.indexOf("--");
          const searchArgs = sepIdx >= 0 ? args.slice(sepIdx + 1) : args;
          const scriptArgs = searchArgs.filter(a =>
            a.endsWith(".py") || a.endsWith(".js") || a.endsWith(".ts") ||
            (a.length > 3 && (a.includes("/") || a.includes("\\")))
          );
          const scriptArg = scriptArgs.sort((a, b) => b.length - a.length)[0];
          if (scriptArg) keyword = scriptArg.split(/[/\\]/).pop() || mcp_name;
        } else if (command) {
          keyword = command.split(/[/\\]/).pop() || command;
        }

        // On Windows, search only for the root executable to avoid killing child processes
        const rootCommand = process.platform === "win32" && command
          ? command.split(/[/\\]/).pop()?.replace(/\.exe$/i, "") + ".exe"
          : undefined;

        process.stderr.write(`[restart_mcp_process] searching for processes with keyword: '${keyword}', rootCommand: '${rootCommand}'\n`);
        const pids = await findAllProcessesByCommand(keyword, rootCommand);

        if (pids.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `No running process found for MCP server '${mcp_name}' (searched for '${keyword}')`,
                  error: "Process not found",
                  data: { keyword },
                }),
              },
            ],
          };
        }

        // Try each PID until one is successfully killed
        let killedPid: number | null = null;
        for (const pid of pids) {
          process.stderr.write(`[restart_mcp_process] trying PID ${pid}...\n`);
          if (await killPid(pid)) { killedPid = pid; break; }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: killedPid !== null,
                  message: killedPid !== null
                    ? `Successfully killed process ${killedPid} for MCP server '${mcp_name}'. Reconnect via /mcp to restore the connection (or wrap it first for auto-respawn).`
                    : `Failed to kill any process for MCP server '${mcp_name}'`,
                  data: { name: mcp_name, killedPid, pids, keyword },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[restart_mcp_process] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to restart MCP process",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
