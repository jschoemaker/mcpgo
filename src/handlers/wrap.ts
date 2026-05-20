import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMcpConfig } from "../lib/config-reader.js";
import { replaceMcpConfig } from "../lib/config-writer.js";
import { ensureStableWrapper, getStableWrapperPath } from "../lib/wrapper-path.js";
import { assertValidMcpName, DEFAULT_WRAPPER_ENV_ALLOWLIST, InvalidMcpNameError, nameErrorResponse } from "../lib/security.js";

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

function hasEnvAllowlistArg(cfg: McpServerConfig): boolean {
  return !!cfg.args && cfg.args.includes("--env-allowlist");
}

function buildEnvAllowlist(declaredEnv: Record<string, string> | undefined): string {
  const declaredKeys = declaredEnv ? Object.keys(declaredEnv) : [];
  return [...DEFAULT_WRAPPER_ENV_ALLOWLIST, ...declaredKeys].join(",");
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
        try { assertValidMcpName(mcp_name); } catch (e) {
          if (e instanceof InvalidMcpNameError) return nameErrorResponse(mcp_name);
          throw e;
        }
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
        // If already wrapped AND the wrapping carries the current --env-allowlist
        // arg, this is idempotent — just refresh the on-disk wrapper. Otherwise
        // fall through to a full re-wrap so old wrappings pick up the new pattern.
        if (isAlreadyWrapped(existing, stableWrapperPath) && hasEnvAllowlistArg(existing)) {
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

        // If it was wrapped under the old pattern (no --env-allowlist), extract
        // the original command + args from after the `--` separator so we can
        // re-wrap it with the current pattern instead of double-wrapping.
        let baseCommand = existing.command;
        let baseArgs = existing.args ?? [];
        if (isAlreadyWrapped(existing, stableWrapperPath)) {
          const sepIdx = baseArgs.indexOf("--");
          if (sepIdx >= 0 && sepIdx + 1 < baseArgs.length) {
            const childArgs = baseArgs.slice(sepIdx + 1);
            baseCommand = childArgs[0];
            baseArgs = childArgs.slice(1);
          }
        }

        const command = baseCommand;
        const args = baseArgs;
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

        const envAllowlist = buildEnvAllowlist(existing.env);
        const newArgs = [
          wrapperPath,
          "--name", mcp_name,
          "--pidfile", pidfile,
          "--env-allowlist", envAllowlist,
          "--",
          command, ...args,
        ];

        const updated = await replaceMcpConfig(mcp_name, {
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
