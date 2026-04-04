import fs from "fs/promises";
import path from "path";
import { getUserMcpConfigPath } from "./paths.js";

async function readFullConfig(): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(getUserMcpConfigPath(), "utf-8");
    return JSON.parse(content);
  } catch {
    return { mcpServers: {} };
  }
}

async function writeFullConfig(config: Record<string, unknown>): Promise<void> {
  const configPath = getUserMcpConfigPath();
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = configPath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  await fs.rename(tmpPath, configPath);
}

export async function addMcpConfig(name: string, serverConfig: object): Promise<void> {
  const full = await readFullConfig();
  if (!full.mcpServers) full.mcpServers = {};
  (full.mcpServers as Record<string, object>)[name] = serverConfig;
  await writeFullConfig(full);
}

export async function removeMcpConfig(name: string): Promise<void> {
  const full = await readFullConfig();
  if (full.mcpServers) {
    delete (full.mcpServers as Record<string, object>)[name];
  }
  await writeFullConfig(full);
}


export async function updateMcpConfig(name: string, updates: Partial<Record<string, unknown>>): Promise<object> {
  const full = await readFullConfig();
  if (!full.mcpServers) full.mcpServers = {};
  const servers = full.mcpServers as Record<string, object>;
  const existing = servers[name] || {};
  const merged = { ...existing, ...updates };
  servers[name] = merged;
  await writeFullConfig(full);
  return merged;
}
