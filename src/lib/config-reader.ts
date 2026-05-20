import fs from "fs/promises";
import { getUserMcpConfigPath } from "./paths.js";

export class ConfigParseError extends Error {
  constructor(public configPath: string, public cause: unknown) {
    super(`Failed to parse Claude config at '${configPath}': ${cause}`);
  }
}

export async function readUserConfig(): Promise<Record<string, object>> {
  const configPath = getUserMcpConfigPath();
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return {};
    // Permission errors, etc. — surface, don't pretend the config is empty.
    throw err;
  }
  let parsed: { mcpServers?: Record<string, object> };
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ConfigParseError(configPath, err);
  }
  return parsed.mcpServers || {};
}

export async function getMcpConfig(name: string): Promise<object | null> {
  const configs = await readUserConfig();
  return configs[name] || null;
}

export async function getAllMcpNames(): Promise<string[]> {
  const configs = await readUserConfig();
  return Object.keys(configs);
}
