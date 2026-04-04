import fs from "fs/promises";
import { getUserMcpConfigPath } from "./paths.js";

export async function readUserConfig(): Promise<Record<string, object>> {
  try {
    const content = await fs.readFile(getUserMcpConfigPath(), "utf-8");
    const parsed = JSON.parse(content);
    return parsed.mcpServers || {};
  } catch {
    return {};
  }
}

export async function getMcpConfig(name: string): Promise<object | null> {
  const configs = await readUserConfig();
  return configs[name] || null;
}

export async function getAllMcpNames(): Promise<string[]> {
  const configs = await readUserConfig();
  return Object.keys(configs);
}
