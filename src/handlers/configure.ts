import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { updateMcpConfig } from "../lib/config-writer.js";
import { getMcpConfig } from "../lib/config-reader.js";
import { assertValidMcpName, findFootgunArg, findFootgunEnvKey, hasShellMetacharacters, InvalidMcpNameError, nameErrorResponse } from "../lib/security.js";

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
        allow_shell_metacharacters: z
          .boolean()
          .optional()
          .describe("Set true to override the safety refusal when 'updates.command' contains shell metacharacters."),
        allow_footgun_args: z
          .boolean()
          .optional()
          .describe("Set true to override the safety refusal when updates.args include code-injection flags like -e/--eval/-c."),
        allow_footgun_env: z
          .boolean()
          .optional()
          .describe("Set true to override the safety refusal when updates.env sets a code-injection key like NODE_OPTIONS, LD_PRELOAD, PYTHONSTARTUP."),
      },
    },
    async ({ mcp_name, updates, allow_shell_metacharacters, allow_footgun_args, allow_footgun_env }) => {
      try {
        try { assertValidMcpName(mcp_name); } catch (e) {
          if (e instanceof InvalidMcpNameError) return nameErrorResponse(mcp_name);
          throw e;
        }
        // Resolve the effective command + args + env after merge so footgun
        // checks see what will actually be written. configure_mcp may update
        // only one of {command, args, env} but the danger lives in their
        // combination (e.g. existing command="node", new args=["-e", ...]).
        const existingObj = (await getMcpConfig(mcp_name)) as Record<string, unknown> | null;
        const effectiveCommand = (updates.command as string | undefined) ?? (existingObj?.["command"] as string | undefined);
        const effectiveArgs = (updates.args as string[] | undefined) ?? (existingObj?.["args"] as string[] | undefined);
        const effectiveEnv = (updates.env as Record<string, string> | undefined) ?? (existingObj?.["env"] as Record<string, string> | undefined);

        if (updates.command && hasShellMetacharacters(updates.command) && !allow_shell_metacharacters) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `Refusing to configure MCP '${mcp_name}': new command contains shell metacharacters. Pass shell pipelines via 'args' or set allow_shell_metacharacters=true to override.`,
                  error: "Shell metacharacters in command",
                  data: { command: updates.command },
                }),
              },
            ],
          };
        }
        if (effectiveCommand && effectiveArgs && (updates.args || updates.command) && !allow_footgun_args) {
          const hit = findFootgunArg(effectiveCommand, effectiveArgs);
          if (hit) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    message: `Refusing to configure MCP '${mcp_name}': resulting args include '${hit.flag}' for ${hit.interpreter}, which evaluates arbitrary code. Set allow_footgun_args=true to override.`,
                    error: "Footgun arg",
                    data: { interpreter: hit.interpreter, flag: hit.flag },
                  }),
                },
              ],
            };
          }
        }

        if (updates.env && !allow_footgun_env) {
          const hitKey = findFootgunEnvKey(effectiveEnv);
          if (hitKey) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    success: false,
                    message: `Refusing to configure MCP '${mcp_name}': env sets '${hitKey}', which loads code at process start. Set allow_footgun_env=true to override.`,
                    error: "Footgun env",
                    data: { key: hitKey },
                  }),
                },
              ],
            };
          }
        }

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
