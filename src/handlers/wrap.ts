import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMcpConfig } from "../lib/config-reader.js";
import { updateMcpConfig } from "../lib/config-writer.js";
import { ensureStableWrapper, getStableWrapperPath } from "../lib/wrapper-path.js";

type McpServerConfig = {
  type?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

function getBuiltWrapperPath(): string {
  // When running from build/, this module is build/handlers/wrap.js and wrapper is build/wrapper.js
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../wrapper.js");
}

async function writeBackup(name: string, config: object): Promise<string> {
  const dir = path.join(os.homedir(), ".mcpgo", "backups");
  await fs.mkdir(dir, { recursive: true });
  const backupPath = path.join(dir, `${name}.${Date.now()}.json`);
  await fs.writeFile(backupPath, JSON.stringify(config, null, 2), "utf-8");
  return backupPath;
}

function defaultPidfile(name: string): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || os.tmpdir();
    return path.join(base, "mcpgo", "pids", `${name}.pid`);
  }
  return path.join(os.tmpdir(), "mcpgo", "pids", `${name}.pid`);
}

function isAlreadyWrapped(cfg: McpServerConfig, wrapperPath: string): boolean {
  if (!cfg.args || cfg.args.length === 0) return false;
  const hasWrapper = cfg.args.some(a => {
    try { return path.resolve(a) === path.resolve(wrapperPath); } catch { return false; }
  });
  const hasSeparator = cfg.args.includes("--");
  return hasWrapper && hasSeparator;
}

export function registerWrapMcp(server: McpServer): void {
  server.registerTool(
    "wrap_mcp_stdio",
    {
      description:
        "Wrap a stdio MCP server so it can be restarted reliably. Updates ~/.claude.json to launch a Node wrapper that spawns the original command and respawns it when killed. Requires restarting Claude CLI to take effect.",
      inputSchema: {
        mcp_name: z.string().describe("The name of the MCP server to wrap"),
      },
    },
    async ({ mcp_name }) => {
      try {
        if (mcp_name === "mcpgo") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: "Refusing to wrap 'mcpgo' (would self-wrap and likely break)",
                  error: "Refused",
                }),
              },
            ],
          };
        }

        const existing = (await getMcpConfig(mcp_name)) as McpServerConfig | null;
        if (!existing) {
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

        const builtWrapperPath = getBuiltWrapperPath();
        try {
          await fs.access(builtWrapperPath);
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `Wrapper entrypoint not found at '${builtWrapperPath}'. Run 'npm run build' for mcpgo first.`,
                  error: "Wrapper not built",
                  data: { wrapperPath: builtWrapperPath },
                }),
              },
            ],
          };
        }

        const stableWrapperPath = getStableWrapperPath();
        if (isAlreadyWrapped(existing, stableWrapperPath)) {
          // Re-copy wrapper to stable location in case it was updated
          await ensureStableWrapper(builtWrapperPath);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: `MCP server '${mcp_name}' is already wrapped`,
                  data: { name: mcp_name, wrapperPath: stableWrapperPath },
                }),
              },
            ],
          };
        }

        const command = existing.command;
        const args = existing.args ?? [];
        if (!command) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `MCP server '${mcp_name}' has no command configured`,
                  error: "Invalid config",
                }),
              },
            ],
          };
        }

        const backupPath = await writeBackup(mcp_name, existing);
        const pidfile = defaultPidfile(mcp_name);
        const wrapperPath = await ensureStableWrapper(builtWrapperPath);

        const newArgs = [wrapperPath, "--name", mcp_name, "--pidfile", pidfile, "--", command, ...args];

        const updated = await updateMcpConfig(mcp_name, {
          type: existing.type ?? "stdio",
          command: process.execPath,
          args: newArgs,
          ...(existing.cwd ? { cwd: existing.cwd } : {}),
          ...(existing.env ? { env: existing.env } : {}),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Wrapped MCP server '${mcp_name}'. Restart Claude CLI for it to take effect.`,
                  data: { name: mcp_name, backupPath, wrapperPath, pidfile, updated },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[wrap_mcp_stdio] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to wrap MCP server",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
