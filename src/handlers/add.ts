import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addMcpConfig } from "../lib/config-writer.js";
import { getMcpConfig } from "../lib/config-reader.js";
import { validateMcpName, validateMcpConfig } from "../lib/validation.js";
import { hasShellMetacharacters } from "../lib/security.js";

export function registerAddMcp(server: McpServer): void {
  server.registerTool(
    "add_mcp",
    {
      description: "Add a new MCP server to the user configuration (~/.claude.json).",
      inputSchema: {
        mcp_name: z.string().describe("Name for the new MCP server (alphanumeric, dashes, underscores)"),
        transport: z
          .enum(["stdio", "http", "sse"])
          .describe("Transport type: stdio for local process, http/sse for remote server"),
        command: z.string().optional().describe("Command to run (required for stdio transport)"),
        args: z.array(z.string()).optional().describe("Arguments to pass to the command"),
        url: z.string().optional().describe("Server URL (required for http/sse transport)"),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables to set for the server"),
        headers: z.record(z.string(), z.string()).optional().describe("HTTP headers (for http/sse transport)"),
        allow_shell_metacharacters: z
          .boolean()
          .optional()
          .describe("Set true to override the safety refusal when 'command' contains shell metacharacters. Use only for genuinely shell-style commands you trust."),
      },
    },
    async ({ mcp_name, transport, command, args, url, env, headers, allow_shell_metacharacters }) => {
      try {
        // Validate name
        if (!validateMcpName(mcp_name)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `Invalid MCP name '${mcp_name}'. Use only alphanumeric characters, dashes, and underscores.`,
                  error: "Invalid name",
                }),
              },
            ],
          };
        }

        // Refuse shell-metacharacters in `command` unless caller explicitly
        // opted in. MCP commands are spawned without a shell by Claude Code,
        // so a value like `bash -c 'curl x | sh'` here means someone is
        // intentionally smuggling a shell pipeline through the config.
        if (command && hasShellMetacharacters(command) && !allow_shell_metacharacters) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `Refusing to add MCP '${mcp_name}': command contains shell metacharacters. Pass shell pipelines via 'args' (e.g. command='sh', args=['-c', '...']) or set allow_shell_metacharacters=true to override.`,
                  error: "Shell metacharacters in command",
                  data: { command },
                }),
              },
            ],
          };
        }

        // Validate config
        const validation = validateMcpConfig({ type: transport, command, url });
        if (!validation.valid) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: "Invalid MCP configuration",
                  error: validation.errors.join("; "),
                  data: { errors: validation.errors },
                }),
              },
            ],
          };
        }

        // Check for existing server with same name
        const existing = await getMcpConfig(mcp_name);
        if (existing) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: `MCP server '${mcp_name}' already exists. Use configure_mcp to update it.`,
                  error: "Already exists",
                  data: { existingConfig: existing },
                }),
              },
            ],
          };
        }

        // Build config object
        const serverConfig: Record<string, unknown> = { type: transport };
        if (command !== undefined) serverConfig["command"] = command;
        if (args !== undefined && args.length > 0) serverConfig["args"] = args;
        if (url !== undefined) serverConfig["url"] = url;
        if (env !== undefined && Object.keys(env).length > 0) serverConfig["env"] = env;
        if (headers !== undefined && Object.keys(headers).length > 0) serverConfig["headers"] = headers;

        await addMcpConfig(mcp_name, serverConfig);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Successfully added MCP server '${mcp_name}'`,
                  data: { name: mcp_name, config: serverConfig },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        process.stderr.write(`[add_mcp] error: ${err}\n`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Failed to add MCP server",
                error: String(err),
              }),
            },
          ],
        };
      }
    }
  );
}
