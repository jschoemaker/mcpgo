import path from "path";
import os from "os";

export function getClaudeConfigPath(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "Claude", "claude_desktop_config.json");
  } else if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(os.homedir(), ".claude.json");
}

export function getUserMcpConfigPath(): string {
  return path.join(os.homedir(), ".claude.json");
}

export function getProjectMcpConfigPath(cwd: string): string {
  return path.join(cwd, ".mcp.json");
}
