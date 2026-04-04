import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function getStableWrapperPath(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || os.homedir();
    return path.join(base, "mcpgo", "wrapper.js");
  }
  return path.join(os.homedir(), ".mcpgo", "wrapper.js");
}

/**
 * Copies the built wrapper.js to a stable user-data location and returns that path.
 * This ensures the path in ~/.claude.json survives npx cache clears and version upgrades.
 */
export async function ensureStableWrapper(builtWrapperPath: string): Promise<string> {
  const stablePath = getStableWrapperPath();
  await fs.mkdir(path.dirname(stablePath), { recursive: true });
  await fs.copyFile(builtWrapperPath, stablePath);
  return stablePath;
}
