import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CodexMcpBlock = {
  header: string;
  startLine: number;
  endLineExclusive: number;
  lines: string[];
};

export function getCodexConfigTomlPath(): string {
  return path.join(os.homedir(), ".codex", "config.toml");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTomlTableHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]") && !trimmed.startsWith("#");
}

export async function readCodexConfigToml(): Promise<string> {
  return await fs.readFile(getCodexConfigTomlPath(), "utf-8");
}

export async function writeCodexConfigToml(content: string): Promise<void> {
  const configPath = getCodexConfigTomlPath();
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = configPath + ".tmp";
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, configPath);
}

export function findMcpServerBlock(content: string, mcpName: string): CodexMcpBlock | null {
  const lines = content.split(/\r?\n/);
  const header = `[mcp_servers.${mcpName}]`;
  const headerRe = new RegExp(`^\\[mcp_servers\\.${escapeRegex(mcpName)}\\]\\s*$`);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isTomlTableHeaderLine(lines[i])) {
      end = i;
      break;
    }
  }

  return {
    header,
    startLine: start,
    endLineExclusive: end,
    lines: lines.slice(start, end),
  };
}

function formatTomlString(s: string): string {
  // Use JSON string escaping which is compatible with basic TOML strings for our needs.
  return JSON.stringify(s);
}

function formatTomlStringArray(arr: string[]): string {
  return `[${arr.map(formatTomlString).join(", ")}]`;
}

export function rewriteMcpServerCommandArgsInToml(
  content: string,
  mcpName: string,
  updates: { command: string; args: string[] }
): { updatedContent: string; previousBlock: CodexMcpBlock } {
  const block = findMcpServerBlock(content, mcpName);
  if (!block) {
    throw new Error(`MCP server '${mcpName}' not found in Codex config`);
  }

  const allLines = content.split(/\r?\n/);
  const oldBlockLines = block.lines.slice();

  const kept: string[] = [];
  for (let i = 1; i < oldBlockLines.length; i++) {
    const line = oldBlockLines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("command =")) continue;
    if (trimmed.startsWith("args =")) continue;
    kept.push(line);
  }

  const newBlockLines = [
    oldBlockLines[0],
    `command = ${formatTomlString(updates.command)}`,
    `args = ${formatTomlStringArray(updates.args)}`,
    ...kept,
  ];

  const newAll = [
    ...allLines.slice(0, block.startLine),
    ...newBlockLines,
    ...allLines.slice(block.endLineExclusive),
  ];

  return { updatedContent: newAll.join("\n"), previousBlock: block };
}

