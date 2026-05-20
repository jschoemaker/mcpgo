import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import { getMcpConfig } from "../lib/config-reader.js";
import { findAllProcessesByCommand, killPid } from "../lib/subprocess.js";
import { assertValidMcpName, InvalidMcpNameError, isAllowedPidfilePath, nameErrorResponse, sanitizeWqlKeyword } from "../lib/security.js";

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
        // SECURITY: the pidfile path is taken from config args (attacker-controllable
        // if a config entry was planted), so we only honor it when it points at a
        // canonical mcpgo/mcpmanager pidfile directory with the expected filename.
        // Otherwise we'd be a primitive for killing arbitrary user-owned PIDs.
        const pidfileIndex = args ? args.indexOf("--pidfile") : -1;
        const pidfile = pidfileIndex >= 0 ? args?.[pidfileIndex + 1] : undefined;
        if (pidfile) {
          if (!isAllowedPidfilePath(pidfile, mcp_name, "claude")) {
            process.stderr.write(`[restart_mcp_process] refusing pidfile outside mcpgo dirs: '${pidfile}'\n`);
          } else {
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
        }

        // Find a useful keyword to search by
        // For wrapped MCPs actually running via wrapper, use pidfile filename (unique per MCP)
        // For unwrapped MCPs (or wrapped config but not yet restarted), search by child command
        let keyword = mcp_name;
        const allowedPidfile = pidfile && isAllowedPidfilePath(pidfile, mcp_name, "claude") ? pidfile : undefined;
        let pidfileExists = false;
        if (allowedPidfile) {
          try { await fs.access(allowedPidfile); pidfileExists = true; } catch { /* not running wrapped */ }
        }
        if (pidfileExists && allowedPidfile) {
          // Use pidfile filename as keyword — unique per MCP, won't match other wrappers
          keyword = allowedPidfile.split(/[/\\]/).pop() || mcp_name;
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

        // Defense in depth: even though findAllProcessesByCommand now uses
        // execFile (no shell) and sanitizes inputs, scrub here too.
        const safeKeyword = sanitizeWqlKeyword(keyword);
        const safeRoot = rootCommand ? sanitizeWqlKeyword(rootCommand) : undefined;
        if (!safeKeyword) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `No safe process-search keyword for MCP server '${mcp_name}'`,
                  error: "No keyword",
                }),
              },
            ],
          };
        }
        process.stderr.write(`[restart_mcp_process] searching for processes with keyword: '${safeKeyword}', rootCommand: '${safeRoot}'\n`);
        const pids = await findAllProcessesByCommand(safeKeyword, safeRoot);

        if (pids.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `No running process found for MCP server '${mcp_name}' (searched for '${safeKeyword}')`,
                  error: "Process not found",
                  data: { keyword: safeKeyword },
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
                  data: { name: mcp_name, killedPid, pids, keyword: safeKeyword },
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
