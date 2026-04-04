import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCodexConfigTomlPath,
  findMcpServerBlock,
  readCodexConfigToml,
  rewriteMcpServerCommandArgsInToml,
  writeCodexConfigToml,
} from "../lib/codex-config.js";

function getBuiltWrapperPath(): string {
  // When running from build/, this module is build/handlers/wrap-codex.js and wrapper is build/wrapper.js
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../wrapper.js");
}

function defaultPidfile(name: string): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || os.tmpdir();
    return path.join(base, "mcpmanager", "pids", `codex.${name}.pid`);
  }
  return path.join(os.tmpdir(), "mcpmanager", "pids", `codex.${name}.pid`);
}

async function writeBackupToml(name: string, content: string): Promise<string> {
  const dir = path.join(os.homedir(), ".mcpmanager", "backups");
  await fs.mkdir(dir, { recursive: true });
  const backupPath = path.join(dir, `codex.${name}.${Date.now()}.toml`);
  await fs.writeFile(backupPath, content, "utf-8");
  return backupPath;
}

export function registerWrapCodexMcp(server: McpServer): void {
  server.registerTool(
    "wrap_codex_mcp_stdio",
    {
      description:
        "Wrap a Codex CLI stdio MCP server (from ~/.codex/config.toml) so it can be restarted reliably. Rewrites the MCP entry to launch mcp-manager's Node wrapper that respawns the original command. Restart Codex CLI to take effect.",
      inputSchema: {
        mcp_name: z.string().describe("The mcp_servers.<name> entry in ~/.codex/config.toml to wrap"),
      },
    },
    async ({ mcp_name }) => {
      try {
        if (mcp_name === "mcp-manager") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: "Refusing to wrap 'mcp-manager' in Codex (would self-wrap and likely break)",
                  error: "Refused",
                }),
              },
            ],
          };
        }

        const wrapperPath = getBuiltWrapperPath();
        try {
          await fs.access(wrapperPath);
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `Wrapper entrypoint not found at '${wrapperPath}'. Run 'npm run build' for mcp-manager first.`,
                  error: "Wrapper not built",
                  data: { wrapperPath },
                }),
              },
            ],
          };
        }

        const configPath = getCodexConfigTomlPath();
        const content = await readCodexConfigToml();
        const backupPath = await writeBackupToml(mcp_name, content);

        const pidfile = defaultPidfile(mcp_name);
        const newArgs = [wrapperPath, "--name", `codex.${mcp_name}`, "--pidfile", pidfile, "--"];

        const block = findMcpServerBlock(content, mcp_name);
        if (!block) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `MCP server '${mcp_name}' not found in ${configPath}`,
                  error: "Not found",
                }),
              },
            ],
          };
        }

        let originalCommand: string | null = null;
        let originalArgs: string[] = [];
        for (const line of block.lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("command")) {
            const m = trimmed.match(/^command\s*=\s*"([^"]*)"\s*$/);
            if (m) originalCommand = m[1];
          }
          if (trimmed.startsWith("args")) {
            const m = trimmed.match(/^args\s*=\s*(\[.*\])\s*$/);
            if (m) {
              const raw = m[1];
              try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
                  originalArgs = parsed;
                }
              } catch {
                // ignore; best-effort only
              }
            }
          }
        }

        if (!originalCommand) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `MCP server '${mcp_name}' has no command in ${configPath}`,
                  error: "Invalid config",
                }),
              },
            ],
          };
        }

        const alreadyWrapped =
          originalCommand === process.execPath && originalArgs.length > 0 && path.resolve(originalArgs[0]) === path.resolve(wrapperPath);
        if (alreadyWrapped) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: `Codex MCP '${mcp_name}' is already wrapped`,
                  data: { name: mcp_name, wrapperPath },
                }),
              },
            ],
          };
        }

        const updatedArgs = [...newArgs, originalCommand, ...originalArgs];
        const { updatedContent, previousBlock } = rewriteMcpServerCommandArgsInToml(content, mcp_name, {
          command: process.execPath,
          args: updatedArgs,
        });
        await writeCodexConfigToml(updatedContent);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Wrapped Codex MCP '${mcp_name}'. Restart Codex CLI for it to take effect.`,
                  data: {
                    name: mcp_name,
                    configPath,
                    backupPath,
                    wrapperPath,
                    pidfile,
                    previousBlock: {
                      header: previousBlock.header,
                      startLine: previousBlock.startLine + 1,
                    },
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[wrap_codex_mcp_stdio] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to wrap Codex MCP server",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
